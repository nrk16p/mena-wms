// lib/store-withdraw/service.ts — ตรรกะหลัง route: ตัวเลือก/ค้นหาจาก ATMS (บัญชีค้นข้อมูลของ WMS) · สร้างใบ · ขอคืน · จอคิว
import { randomBytes } from "node:crypto"
import { atmsCacheCol, ddmmyyyyBkk, nextNo, swCol, writeLog, ConflictError, type Actor } from "./db"
import { queueSort, returnableQty } from "./core"
import { HttpError } from "./http"
import { ncac } from "./ncac"
import type { AtmsProgress, SwKind, SwLine, SwRequest } from "./types"

export const emptyAtms = (): AtmsProgress => ({
  gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null,
})

// ---------- อ่านข้อมูลจาก ATMS ด้วยบัญชีค้นข้อมูลของ WMS (ผู้ขอไม่มีบัญชี ATMS) ----------

function lookupCreds() {
  const username = process.env.ATMS_LOOKUP_USERNAME
  const password = process.env.ATMS_LOOKUP_PASSWORD
  if (!username || !password) throw new HttpError("ยังไม่ได้ตั้งบัญชี ATMS สำหรับค้นข้อมูล", 503)
  return { username, password }
}

async function ncacRead<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const creds = lookupCreds()
  let r: { status: number; data: T }
  try {
    r = await ncac<T>("GET", path, { creds, query })
  } catch {
    throw new HttpError("ติดต่อ ATMS ไม่ได้ในตอนนี้ — รอสักครู่แล้วลองใหม่", 502)
  }
  if (r.status === 401) throw new HttpError("ATMS ไม่รับบัญชีค้นข้อมูลของ WMS — แจ้งผู้ดูแลให้ตรวจรหัสผ่าน", 502)
  if (r.status < 200 || r.status >= 300) throw new HttpError("ATMS ตอบกลับผิดปกติ — ลองใหม่อีกครั้ง", 502)
  return r.data
}

export type Option = { id: number; name: string }
export type Options = { inventories: Option[]; pickTos: Option[] }

export async function getOptions(): Promise<Options> {
  const cache = await atmsCacheCol()
  const hit = await cache.findOne({ key: "options" })
  if (hit) return hit.data as Options
  const d = await ncacRead<{ inventories?: Option[]; pick_tos?: Option[] }>("/atms/withdraw/options")
  const data: Options = { inventories: d.inventories ?? [], pickTos: d.pick_tos ?? [] }
  await cache.replaceOne({ key: "options" }, { key: "options", data, fetchedAt: new Date() }, { upsert: true })
  return data
}

const KINDS: Record<string, string> = { mr: "mr_item", mr_item: "mr_item", sku: "sku", serial: "serial", wd: "wd" }
export const lookupKind = (k: string) => KINDS[k] ?? null

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? "" : String(v).trim())

export async function lookup(kind: string, q: string, limit: number, inventoryId?: number, skuId?: number): Promise<Row[]> {
  const d = await ncacRead<{ results?: Row[] }>(`/atms/withdraw/lookup/${kind}`, { q, limit, inventory_id: inventoryId, sku_id: skuId })
  const rows = d.results ?? []
  if (kind !== "sku") return rows
  return mergeStock(rows, inventoryId)
}

/** รวมผล sku.json ของ ATMS กับ stockQty ใน master_data.atms_sku_master (key skuPk) · ไม่มีข้อมูล = null */
async function mergeStock(rows: Row[], inventoryId?: number): Promise<Row[]> {
  const norm = rows.map((r) => ({
    skuId: Number(r.id ?? r.sku_id),
    skuCode: str(r.code ?? r.sku_code),
    skuName: str(r.name ?? r.label ?? r.text ?? r.value),
    raw: r,
  }))
  const ids = norm.map((r) => r.skuId).filter((n) => Number.isFinite(n))
  const stock = new Map<number, number>()
  if (ids.length) {
    const client = await (await import("../mongo")).default
    const docs = await client.db(process.env.MONGO_DB ?? "master_data").collection("atms_sku_master")
      .find({ skuPk: { $in: ids } }, { projection: { _id: 0, skuPk: 1, stockQty: 1, inventoryId: 1 } }).toArray()
    for (const m of docs) {
      const inv = typeof m.inventoryId === "number" ? m.inventoryId : null
      if (inventoryId != null && inv != null && inv !== inventoryId) continue
      if (typeof m.stockQty === "number") stock.set(Number(m.skuPk), m.stockQty)
    }
  }
  return norm.map((r) => ({ ...r, stockQty: stock.get(r.skuId) ?? null }))
}

// ---------- สร้างใบ ----------

export type CreateInput = Record<string, unknown>

function posNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const optInt = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null)

export async function createRequest(body: CreateInput, actor: Actor): Promise<SwRequest> {
  const kind = body.kind
  if (kind !== "stock" && kind !== "cutoff") throw new HttpError("เลือกประเภทคำขอ (เบิกจากสต๊อก หรือ เบิกตัดยอด)", 400)
  const plate = str(body.plate)
  if (!plate) throw new HttpError("ใส่ทะเบียนรถก่อนยื่นคำขอ", 400)
  const rawLines = Array.isArray(body.lines) ? (body.lines as Row[]) : []
  if (rawLines.length === 0) throw new HttpError("เพิ่มรายการอะไหล่อย่างน้อย 1 รายการ", 400)

  const opts = await getOptions()
  const inv = opts.inventories.find((o) => o.id === Number(body.inventoryId))
  const pick = opts.pickTos.find((o) => o.id === Number(body.pickToId))
  if (!inv) throw new HttpError("เลือกคลังจากรายการที่มีให้", 400)
  if (!pick) throw new HttpError("เลือกจุดประสงค์การเบิกจากรายการที่มีให้", 400)

  const merged = new Map<number, SwLine>()
  for (const r of rawLines) {
    const skuId = Number(r.skuId)
    const qty = posNum(r.requestedQty)
    const skuCode = str(r.skuCode)
    const skuName = str(r.skuName)
    if (!Number.isInteger(skuId) || skuId <= 0) throw new HttpError("รายการอะไหล่ไม่ถูกต้อง — เลือกจากผลค้นหาใหม่", 400)
    if (qty == null) throw new HttpError("จำนวนที่ขอต้องมากกว่า 0", 400)
    if (!skuCode || !skuName) throw new HttpError("รายการอะไหล่ขาดรหัสหรือชื่อ — เลือกจากผลค้นหาใหม่", 400)
    const prev = merged.get(skuId)
    if (prev) { prev.requestedQty += qty; continue } // sku ซ้ำในใบเดียว = รวมให้
    merged.set(skuId, {
      skuId, skuCode, skuName, requestedQty: qty, issuedQty: null, short: false, returnedQty: 0,
      mrItemId: optInt(r.mrItemId), mrItemLabel: str(r.mrItemLabel) || null, serialNoId: optInt(r.serialNoId), remark: str(r.remark),
    })
  }

  const now = new Date()
  const doc: SwRequest = {
    no: await nextNo(now),
    kind: kind as SwKind,
    status: "NEW",
    inventoryId: inv.id, inventoryName: inv.name,
    pickToId: pick.id, pickToName: pick.name,
    plate,
    mrCode: str(body.mrCode) || null,
    urgent: body.urgent === true,
    remark: str(body.remark),
    lines: [...merged.values()],
    requestedBy: { email: actor.email, name: actor.name, via: actor.via },
    claimedBy: null, rejectReason: null,
    atms: emptyAtms(), returns: [],
    createdAt: now, updatedAt: now,
  }
  await (await swCol()).insertOne(doc as Parameters<Awaited<ReturnType<typeof swCol>>["insertOne"]>[0])
  await writeLog({ no: doc.no, action: "create", from: null, to: "NEW", actor: { email: actor.email, name: actor.name, via: actor.via } })
  const { _id: _drop, ...clean } = doc
  void _drop
  return clean
}

// ---------- ขอคืน ----------

const RETURN_HOLD = ["RETURN_REQUESTED", "RETURNING", "RETURN_FAILED"]

export async function requestReturn(no: string, body: CreateInput, actor: Actor): Promise<{ rid: string }> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new ConflictError("ไม่พบใบขอเบิกนี้")
  if (cur.requestedBy.email.trim().toLowerCase() !== actor.email) throw new HttpError("ใบนี้ไม่ใช่ของคุณ — ขอคืนได้เฉพาะใบที่ตัวเองยื่น", 403)
  if (cur.status !== "ISSUED" && cur.status !== "RECEIVED") throw new ConflictError("ใบนี้ยังไม่ได้ส่งของ ขอคืนไม่ได้")
  const raw = Array.isArray(body.lines) ? (body.lines as Row[]) : []
  if (raw.length === 0) throw new HttpError("เลือกรายการที่จะคืนอย่างน้อย 1 รายการ", 400)

  const want = new Map<number, number>()
  for (const r of raw) {
    const i = Number(r.lineIndex)
    const q = posNum(r.qty)
    if (!Number.isInteger(i) || i < 0 || i >= cur.lines.length) throw new HttpError("รายการที่จะคืนไม่ถูกต้อง", 400)
    if (q == null) throw new HttpError("จำนวนที่คืนต้องมากกว่า 0", 400)
    want.set(i, (want.get(i) ?? 0) + q)
  }
  const pending = new Map<number, number>()
  for (const o of cur.returns) {
    if (!RETURN_HOLD.includes(o.status)) continue
    for (const l of o.lines) pending.set(l.lineIndex, (pending.get(l.lineIndex) ?? 0) + l.qty)
  }
  for (const [i, q] of want) {
    if (q > returnableQty(cur.lines[i], pending.get(i) ?? 0)) throw new ConflictError("คืนเกินจำนวนที่เบิกไป — ตรวจจำนวนที่คืนได้แล้วลองใหม่")
  }

  const rid = "R" + randomBytes(3).toString("hex").toUpperCase()
  const ret = {
    rid, status: "RETURN_REQUESTED" as const,
    lines: [...want].map(([lineIndex, qty]) => ({ lineIndex, qty })),
    requestedBy: actor.email, acceptedBy: null, atms: emptyAtms(), createdAt: new Date(),
  }
  // เงื่อนไขจำนวน returns เดิม — ถ้ามีคนขอคืนซ้อนระหว่างนี้จะไม่ผ่าน (กันคืนเกิน)
  const after = await col.findOneAndUpdate(
    { no, status: cur.status, returns: { $size: cur.returns.length } },
    { $push: { returns: ret }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  await writeLog({ no, action: "returnRequest", from: cur.status, to: "RETURN_REQUESTED", actor: { email: actor.email, name: actor.name, via: actor.via }, note: rid })
  return { rid }
}

// ---------- จอคิว ----------

export type QueueItem = SwRequest & { itemType: "request" | "return"; return?: SwRequest["returns"][number] }

export async function buildQueue(inventoryId: number | null, now = new Date()) {
  const col = await swCol()
  const open = ["NEW", "PREPARING", "READY", "ISSUING", "ISSUE_FAILED"]
  const filter: Record<string, unknown> = {
    $or: [
      { status: { $in: open } },
      { status: { $in: ["ISSUED", "RECEIVED"] }, updatedAt: { $gte: new Date(now.getTime() - 48 * 3600_000) } },
      { status: { $in: ["ISSUED", "RECEIVED"] }, "returns.status": { $in: RETURN_HOLD } },
    ],
  }
  if (inventoryId != null) filter.inventoryId = inventoryId
  // เรียงก่อน limit: งานค้างเก่าสุดต้องไม่หลุดออกจากคิวเมื่อมีใบสะสมเกิน 500
  const docs = await col.find(filter, { projection: { _id: 0 } }).sort({ urgent: -1, createdAt: 1 }).limit(500).toArray()

  const cols: Record<"NEW" | "PREPARING" | "READY" | "DONE_TODAY", QueueItem[]> = { NEW: [], PREPARING: [], READY: [], DONE_TODAY: [] }
  const today = ddmmyyyyBkk(now)
  for (const d of docs) {
    const item: QueueItem = { ...d, itemType: "request" }
    if (d.status === "NEW") cols.NEW.push(item)
    else if (d.status === "PREPARING") cols.PREPARING.push(item)
    else if (d.status === "READY") cols.READY.push(item)
    else if (d.status === "ISSUING" || d.status === "ISSUE_FAILED") (d.kind === "cutoff" ? cols.NEW : cols.READY).push(item)
    else if (ddmmyyyyBkk(d.updatedAt) === today) cols.DONE_TODAY.push(item)
    for (const r of d.returns) {
      if (r.status === "RETURN_REQUESTED" || r.status === "RETURNING" || r.status === "RETURN_FAILED") {
        cols.NEW.push({ ...d, itemType: "return", return: r, createdAt: r.createdAt })
      }
    }
  }
  return {
    NEW: queueSort(cols.NEW), PREPARING: queueSort(cols.PREPARING), READY: queueSort(cols.READY),
    DONE_TODAY: [...cols.DONE_TODAY].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
  }
}

// ---------- WD ที่คีย์ตรงใน ATMS (อ่านอย่างเดียว) ----------

export type AtmsKeyedRow = {
  id: number | null
  code: string
  pick_to: string
  user: string
  remark: string
  created_at: string
  approved: boolean
}

const toKeyed = (r: Row): AtmsKeyedRow => ({
  id: r.id == null || r.id === "" || !Number.isFinite(Number(r.id)) ? null : Number(r.id),
  code: str(r.code),
  pick_to: str(r.pick_to),
  user: str(r.user),
  remark: str(r.remark),
  created_at: str(r.created_at),
  approved: r.approved === true,
})

export const KEYED_LIST_TIMEOUT_MS = 5_000
export const KEYED_FRESH_MS = 180_000 // TTL index ลบช้าได้ ~60 วิ จึงเช็กอายุเองตอนอ่านด้วย
export const KEYED_FAIL_MS = 120_000 // ดึงพลาดแล้วพัก 2 นาที ไม่ยิง ATMS ซ้ำ

const inflight = new Map<string, Promise<AtmsKeyedRow[] | null>>()

async function fetchKeyed(inventoryId: number, date: string): Promise<AtmsKeyedRow[] | null> {
  const username = process.env.ATMS_LOOKUP_USERNAME
  const password = process.env.ATMS_LOOKUP_PASSWORD
  if (!username || !password) return null
  try {
    const r = await ncac<{ rows?: Row[] } | null>("GET", "/atms/withdraw/list", {
      creds: { username, password }, query: { inventory_id: inventoryId, date }, timeoutMs: KEYED_LIST_TIMEOUT_MS,
    })
    if (r.status < 200 || r.status >= 300) return null
    return (r.data?.rows ?? []).map(toKeyed)
  } catch {
    return null
  }
}

/**
 * WD วันนี้ของคลังนั้นที่ถูกคีย์ตรงใน ATMS (อ่านอย่างเดียว) · อ่านด้วยบัญชีค้นข้อมูลของ WMS (env ATMS_LOOKUP_*) ไม่ใช้บัญชีสโตร์
 * กันหน้าจอค้างและกันยิง ATMS รัว: timeout 5 วิ · พลาดแล้วจำไว้ 2 นาที (คืนแถวแคชล่าสุดถ้ามี ไม่งั้น []) · 1 คีย์ = 1 คำขอพร้อมกัน
 * แคช 3 นาที ใช้ร่วมทุกจอ · ตัดแถวที่ id ตรงกับ atms.gmId ของใบใน WMS (ที่ WMS ตัดเอง) ออก
 */
export async function listAtmsKeyed(inventoryId: number, now: Date): Promise<AtmsKeyedRow[]> {
  const date = ddmmyyyyBkk(now)
  const key = `wd-list:${inventoryId}:${date}`
  const cache = await atmsCacheCol()
  const doc = await cache.findOne({ key }) as ({ data?: unknown; fetchedAt: Date; failedAt?: Date } | null)
  const stale = doc && Array.isArray(doc.data) ? (doc.data as AtmsKeyedRow[]) : null
  const age = (d?: Date) => (d ? now.getTime() - new Date(d).getTime() : Infinity)

  let rows: AtmsKeyedRow[]
  if (stale && age(doc!.fetchedAt) < KEYED_FRESH_MS) rows = stale
  else if (doc?.failedAt && age(doc.failedAt) < KEYED_FAIL_MS) rows = stale ?? []
  else {
    let p = inflight.get(key)
    if (!p) {
      p = fetchKeyed(inventoryId, date).then(async (got) => {
        try {
          if (got) await cache.replaceOne({ key }, { key, data: got, fetchedAt: new Date() }, { upsert: true })
          else await cache.updateOne({ key }, { $set: { failedAt: new Date() }, $setOnInsert: { fetchedAt: new Date() } }, { upsert: true })
        } catch { /* แคชเขียนไม่ได้ก็ไม่เป็นไร */ }
        return got
      }).finally(() => { inflight.delete(key) })
      inflight.set(key, p)
    }
    rows = (await p) ?? stale ?? []
  }

  const mine = await (await swCol()).find(
    { inventoryId, "atms.gmId": { $ne: null } },
    { projection: { _id: 0, "atms.gmId": 1, "returns.atms.gmId": 1 } },
  ).toArray()
  const own = new Set<number>()
  for (const d of mine) {
    if (d.atms?.gmId != null) own.add(d.atms.gmId)
    for (const x of d.returns ?? []) if (x.atms?.gmId != null) own.add(x.atms.gmId)
  }
  return rows.filter((r) => r.id == null || !own.has(r.id))
}
