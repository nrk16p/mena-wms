// lib/store-withdraw/db.ts — Mongo ของงานเบิกของหน้าร้านคลัง
// ชื่อ db จาก env STORE_WITHDRAW_DB (ค่าเริ่มต้น master_data) · เทสต์ inject MongoClient ได้ด้วย setStoreWithdrawClient
import type { Collection, Db, MongoClient } from "mongodb"
import { entryHash } from "./chain"
import { formatNo, nextStatus, workTypeFromKind } from "./core"
import type { SwAction, SwRequest } from "./types"

export class ConflictError extends Error {
  constructor(message = "สถานะเปลี่ยนไปแล้ว ลองรีเฟรช") {
    super(message)
    this.name = "ConflictError"
  }
}

export class NotFoundError extends Error {
  constructor(message = "ไม่พบใบขอเบิกนี้ ตรวจเลขที่ใบอีกครั้ง") {
    super(message)
    this.name = "NotFoundError"
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
  /** ลำดับต่อใบ เริ่ม 1 + แฮชต่อกัน (ดู chain.ts) · รายการเก่าก่อนมีฟีเจอร์ไม่มีสองช่องนี้ */
  seq?: number
  hash?: string
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
      db.collection("store_withdraw_requests").createIndex({ "requestedBy.email": 1, createdAt: -1 }),
      db.collection("store_withdraw_requests").createIndex({ "ref.code": 1, createdAt: -1 }, { sparse: true }),
      db.collection("store_withdraw_log").createIndex({ no: 1, at: 1 }),
      db.collection("store_withdraw_log").createIndex({ no: 1, seq: 1 }, { unique: true, partialFilterExpression: { seq: { $gt: 0 } } }),
      db.collection("store_withdraw_requests").createIndex({ createdAt: 1 }),
      db.collection("store_withdraw_attachments").createIndex({ no: 1, context: 1, confirmedAt: 1 }),
      db.collection("store_atms_creds").createIndex({ email: 1 }, { unique: true }),
      db.collection("store_withdraw_atms_cache").createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 180 }),
    ])
    indexed.add(db)
  }
  return db
}

/** สำเนาทะเบียนสินค้า ATMS (อ่านอย่างเดียว) — db ตาม MONGO_DB ไม่ใช่ db ของงานเบิก */
export async function skuMasterCol() {
  const client = injected ?? (await (await import("../mongo")).default)
  return client.db(process.env.MONGO_DB ?? "master_data").collection("atms_sku_master")
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
// fetchedAt = ตัวที่ TTL index ลบทิ้ง · savedAt = สำเนาถาวร (ไม่มี fetchedAt จึงไม่โดน TTL)
export async function atmsCacheCol(): Promise<Collection<{ key: string; data: unknown; fetchedAt?: Date; savedAt?: Date }>> {
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

/**
 * เขียน log แบบต่อโซ่แฮช: seq = ท้ายโซ่ + 1 · hash = sha256(hash ก่อนหน้า + รายการ)
 * เขียนพร้อมกันหลายตัว: unique index {no, seq} ทำให้มีตัวเดียวได้ seq นั้น ตัวที่แพ้อ่านท้ายโซ่ใหม่แล้วลองอีก
 */
export async function writeLog(entry: Omit<LogDoc, "at" | "seq" | "hash">, at = new Date()) {
  const col = await swLogCol()
  for (let attempt = 0; attempt < 60; attempt++) {
    const last = await col.find({ no: entry.no, seq: { $gt: 0 } }, { projection: { seq: 1, hash: 1 } }).sort({ seq: -1 }).limit(1).next()
    const seq = (last?.seq ?? 0) + 1
    const base: Record<string, unknown> = { ...entry, at, seq }
    for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k]
    const hash = entryHash(last?.hash ?? "", base)
    try {
      await col.insertOne({ ...base, hash } as unknown as LogDoc)
      return
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)))
    }
  }
  throw new Error("writeLog: เขียน log ไม่สำเร็จหลังลองซ้ำหลายครั้ง")
}

/**
 * เปลี่ยนสถานะแบบ atomic: อ่าน → nextStatus → findOneAndUpdate({no, status: เดิม})
 * ไม่เจอ = มีคนเปลี่ยนไปก่อน → ConflictError (ตัวกันยิงซ้ำของ issue ก็คือจุดนี้)
 */
export async function transition(
  no: string,
  action: SwAction,
  actor: Actor,
  patch: Partial<SwRequest> | Record<string, unknown> = {},
): Promise<SwRequest> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new NotFoundError()
  const to = nextStatus(cur, action)
  if (!to) throw new ConflictError()
  const { _id: _ignore, no: _no, status: _st, ...safe } = patch as Record<string, unknown>
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

/** ใบเก่าก่อนมีฟีเจอร์อ้างอิง PO/DD ไม่มี field ref และใบก่อนมี workType ไม่มี workType — response ทุกเส้นคืน ref: null และ workType ที่อนุมานจาก kind ให้เสมอ */
export const withRef = <T extends { kind: SwRequest["kind"]; ref?: SwRequest["ref"]; workType?: SwRequest["workType"] }>(d: T): T & { ref: NonNullable<SwRequest["ref"]> | null; workType: NonNullable<SwRequest["workType"]> } =>
  ({ ...d, ref: d.ref ?? null, workType: d.workType ?? workTypeFromKind(d.kind) })
