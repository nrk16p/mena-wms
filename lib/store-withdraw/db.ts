// lib/store-withdraw/db.ts — Mongo ของงานเบิกของหน้าร้านคลัง
// ชื่อ db จาก env STORE_WITHDRAW_DB (ค่าเริ่มต้น master_data) · เทสต์ inject MongoClient ได้ด้วย setStoreWithdrawClient
import type { Collection, Db, MongoClient } from "mongodb"
import { formatNo, nextStatus } from "./core"
import type { SwAction, SwRequest } from "./types"

export class ConflictError extends Error {
  constructor(message = "สถานะเปลี่ยนไปแล้ว ลองรีเฟรช") {
    super(message)
    this.name = "ConflictError"
  }
}

export type Actor = { email: string; name: string; via: "web" | "api" }

export type CredDoc = {
  email: string
  atmsUsername: string
  passwordEnc: string // เข้ารหัสด้วย encryptSecret เท่านั้น
  branch: string | null
  profile: Record<string, unknown> | null
  updatedAt: Date
}

export type LogDoc = {
  no: string
  action: string
  from: string | null
  to: string | null
  actor: { email: string; name: string; via: string }
  at: Date
  note?: string
}

let injected: MongoClient | null = null
const indexed = new WeakSet<Db>()

/** ใช้ในเทสต์เท่านั้น — ส่ง null เพื่อกลับไปใช้ client จริงของแอป */
export function setStoreWithdrawClient(c: MongoClient | null) {
  injected = c
}

export async function getDb(): Promise<Db> {
  const client = injected ?? (await (await import("../mongo")).default)
  const db = client.db(process.env.STORE_WITHDRAW_DB || "master_data")
  if (!indexed.has(db)) {
    await Promise.all([
      db.collection("store_withdraw_requests").createIndex({ no: 1 }, { unique: true }),
      db.collection("store_withdraw_requests").createIndex({ inventoryId: 1, status: 1, createdAt: 1 }),
      db.collection("store_atms_creds").createIndex({ email: 1 }, { unique: true }),
      db.collection("store_withdraw_atms_cache").createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 180 }),
    ])
    indexed.add(db)
  }
  return db
}

export async function swCol(): Promise<Collection<SwRequest>> {
  return (await getDb()).collection<SwRequest>("store_withdraw_requests")
}
export async function swLogCol(): Promise<Collection<LogDoc>> {
  return (await getDb()).collection<LogDoc>("store_withdraw_log")
}
export async function credCol(): Promise<Collection<CredDoc>> {
  return (await getDb()).collection<CredDoc>("store_atms_creds")
}
export async function atmsCacheCol(): Promise<Collection<{ key: string; data: unknown; fetchedAt: Date }>> {
  return (await getDb()).collection("store_withdraw_atms_cache")
}

const BKK = "Asia/Bangkok"

/** YYMM ตามเวลาไทย */
export function yymmBkk(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: BKK, year: "2-digit", month: "2-digit" }).formatToParts(d)
  const get = (t: string) => p.find((x) => x.type === t)!.value
  return get("year") + get("month")
}

/** DD/MM/YYYY ตามเวลาไทย — รูปแบบวันที่ที่ api-ncac/ATMS ต้องการ */
export function ddmmyyyyBkk(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d)
  const get = (t: string) => p.find((x) => x.type === t)!.value
  return `${get("day")}/${get("month")}/${get("year")}`
}

/** ออกเลข SW-YYMM-NNN แบบ atomic — เลขที่ข้ามไปไม่นำกลับมาใช้ */
export async function nextNo(now: Date): Promise<string> {
  const yymm = yymmBkk(now)
  const r = await (await getDb()).collection<{ _id: string; seq: number }>("counters").findOneAndUpdate(
    { _id: `store_withdraw:${yymm}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  )
  if (!r || typeof r.seq !== "number") throw new Error("nextNo: counter update returned no document")
  return formatNo(yymm, r.seq)
}

export async function writeLog(entry: Omit<LogDoc, "at">, at = new Date()) {
  await (await swLogCol()).insertOne({ ...entry, at })
}

/**
 * เปลี่ยนสถานะแบบ atomic: อ่าน → nextStatus → findOneAndUpdate({no, status: เดิม})
 * ไม่เจอ = มีคนเปลี่ยนไปก่อน → ConflictError (ตัวกันยิงซ้ำของ issue ก็คือจุดนี้)
 */
export async function transition(
  no: string,
  action: SwAction,
  actor: Actor,
  patch: Partial<SwRequest> = {},
): Promise<SwRequest> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new ConflictError("ไม่พบใบขอเบิกนี้")
  const to = nextStatus(cur, action)
  if (!to) throw new ConflictError()
  const { _id: _ignore, no: _no, status: _st, ...safe } = patch
  void _ignore; void _no; void _st
  const after = await col.findOneAndUpdate(
    { no, status: cur.status },
    { $set: { ...safe, status: to, updatedAt: new Date() } },
    { returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  await writeLog({ no, action, from: cur.status, to, actor: { email: actor.email, name: actor.name, via: actor.via } })
  return after
}
