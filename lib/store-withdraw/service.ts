// lib/store-withdraw/service.ts ตรรกะหลัง route: ตัวเลือก/ค้นหาจาก ATMS (บัญชีค้นข้อมูลของ WMS) · สร้างใบ · ขอคืน · จอคิว
import { randomBytes } from "node:crypto"
import { lookupCreds } from "./env"
import { atmsCacheCol, ddmmyyyyBkk, nextNo, skuMasterCol, swCol, withRef, writeLog, ConflictError, NotFoundError, type Actor } from "./db"
import { docWarnings, parseRef, queueSort, returnableQty, tallyCut } from "./core"
import { HttpError } from "./http"
import { NCAC_CONFIG_MSG, NcacConfigError, ncac } from "./ncac"
import type { AtmsProgress, SwKind, SwLine, SwRequest } from "./types"

export const emptyAtms = (): AtmsProgress => ({
  gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null,
})

// ---------- อ่านข้อมูลจาก ATMS ด้วยบัญชีค้นข้อมูลของ WMS (ผู้ขอไม่มีบัญชี ATMS) ----------

// บัญชีอ่าน: ATMS_LOOKUP_* ถ้าตั้งไว้ · ไม่ตั้ง = api-ncac ใช้บัญชี ATMS ของตัวเอง (lib/store-withdraw/env.ts)

async function ncacRead<T>(path: string, query?: Record<string, string | number | undefined>, notFoundMsg?: string): Promise<T> {
  const creds = lookupCreds() ?? undefined
  let r: { status: number; data: T }
  try {
    r = await ncac<T>("GET", path, { creds, query })
  } catch (e) {
    if (e instanceof NcacConfigError) throw new HttpError(NCAC_CONFIG_MSG, 502)
    throw new HttpError("ติดต่อ ATMS ไม่ได้ตอนนี้ รอสักครู่แล้วลองใหม่", 502)
  }
  // 403 = api-ncac ไม่รับ key ของ WMS (ตั้งค่า) · 401 = ATMS ไม่รับบัญชีค้นข้อมูล
  if (r.status === 403) throw new HttpError(NCAC_CONFIG_MSG, 502)
  if (r.status === 401) throw new HttpError("ATMS ไม่รับบัญชีค้นข้อมูลของ WMS แจ้งผู้ดูแลให้ตรวจรหัสผ่าน", 502)
  if (r.status === 404 && notFoundMsg) throw new HttpError(notFoundMsg, 404)
  if (r.status < 200 || r.status >= 300) throw new HttpError("ATMS ตอบกลับผิดปกติ ลองใหม่อีกครั้ง", 502)
  return r.data
}

export type Option = { id: number; name: string }
export type Options = { inventories: Option[]; pickTos: Option[] }

export async function getOptions(): Promise<Options> {
  const cache = await atmsCacheCol()
  const hit = await cache.findOne({ key: "options" })
  if (hit) return hit.data as Options
  let data: Options
  try {
    const d = await ncacRead<{ inventories?: Option[]; pick_tos?: Option[] }>("/atms/withdraw/options")
    data = { inventories: d.inventories ?? [], pickTos: d.pick_tos ?? [] }
  } catch (e) {
    // ATMS / api-ncac ล่ม: ใช้สำเนาล่าสุด (ไม่มี TTL) ให้ยื่นคำขอต่อได้ · ไม่เคยมีสำเนา = ปล่อย error เดิม
    const last = await cache.findOne({ key: "options:last" })
    if (last) {
      console.warn("[store-withdraw] ดึงตัวเลือกจาก ATMS ไม่ได้ ใช้สำเนาล่าสุด:", e instanceof Error ? e.message : e)
      return last.data as Options
    }
    throw e
  }
  const now = new Date()
  await cache.replaceOne({ key: "options" }, { key: "options", data, fetchedAt: now }, { upsert: true })
  // สำเนาถาวร: ใช้ savedAt (ไม่ใช่ fetchedAt) เพื่อไม่ให้ TTL index ลบ
  await cache.replaceOne({ key: "options:last" }, { key: "options:last", data, savedAt: now }, { upsert: true })
  return data
}

const KINDS: Record<string, string> = { mr: "mr_item", mr_item: "mr_item", sku: "sku", serial: "serial", wd: "wd", po: "po", dd: "dd" }
export const lookupKind = (k: string) => KINDS[k] ?? null

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? "" : String(v).trim())

export async function lookup(kind: string, q: string, limit: number, inventoryId?: number, skuId?: number): Promise<Row[]> {
  if (kind === "po" || kind === "dd") {
    // ค้นเลขใบ PO / DD ผ่าน api-ncac (อ่านอย่างเดียว) · ส่งต่อผลตามสัญญา ไม่ดัดแปลง
    const d = await ncacRead<{ results?: Row[] }>("/atms/withdraw/doc/search", { kind, q, inventory_id: inventoryId, limit })
    return d.results ?? []
  }
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

export const MAX_LINES = 50
export const MAX_REMARK = 500
export const MAX_PLATE = 20

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
  if (plate.length > MAX_PLATE) throw new HttpError(`ทะเบียนรถยาวเกิน ${MAX_PLATE} ตัวอักษร`, 400)
  if (str(body.remark).length > MAX_REMARK) throw new HttpError(`หมายเหตุยาวเกิน ${MAX_REMARK} ตัวอักษร`, 400)
  const rawLines = Array.isArray(body.lines) ? (body.lines as Row[]) : []
  if (rawLines.length === 0) throw new HttpError("เพิ่มรายการอะไหล่อย่างน้อย 1 รายการ", 400)
  if (rawLines.length > MAX_LINES) throw new HttpError(`ใส่ได้ไม่เกิน ${MAX_LINES} รายการต่อใบ แยกเป็นหลายใบ`, 400)

  const parsedRef = parseRef(body.ref)
  if ("error" in parsedRef) throw new HttpError(parsedRef.error, 400)

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
    if (!Number.isInteger(skuId) || skuId <= 0) throw new HttpError("รายการอะไหล่ไม่ถูกต้อง เลือกจากผลค้นหาใหม่", 400)
    if (qty == null) throw new HttpError("จำนวนที่ขอต้องมากกว่า 0", 400)
    if (!skuCode || !skuName) throw new HttpError("รายการอะไหล่ขาดรหัสหรือชื่อ เลือกจากผลค้นหาใหม่", 400)
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
    ref: parsedRef.ref,
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
  if (!cur) throw new NotFoundError()
  if (cur.requestedBy.email.trim().toLowerCase() !== actor.email) throw new HttpError("ใบนี้ไม่ใช่ของคุณ ขอคืนได้เฉพาะใบที่ตัวเองยื่น", 403)
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
    if (q > returnableQty(cur.lines[i], pending.get(i) ?? 0)) throw new ConflictError("คืนเกินจำนวนที่เบิกไป ตรวจจำนวนที่คืนได้แล้วลองใหม่")
  }

  const rid = "R" + randomBytes(3).toString("hex").toUpperCase()
  const ret = {
    rid, status: "RETURN_REQUESTED" as const,
    lines: [...want].map(([lineIndex, qty]) => ({ lineIndex, qty })),
    requestedBy: actor.email, acceptedBy: null, atms: emptyAtms(), createdAt: new Date(),
  }
  // เงื่อนไขจำนวน returns เดิม ถ้ามีคนขอคืนซ้อนระหว่างนี้จะไม่ผ่าน (กันคืนเกิน)
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
    const item: QueueItem = { ...withRef(d), itemType: "request" }
    if (d.status === "NEW") cols.NEW.push(item)
    else if (d.status === "PREPARING") cols.PREPARING.push(item)
    else if (d.status === "READY") cols.READY.push(item)
    else if (d.status === "ISSUING" || d.status === "ISSUE_FAILED") (d.kind === "cutoff" ? cols.NEW : cols.READY).push(item)
    else if (ddmmyyyyBkk(d.updatedAt) === today) cols.DONE_TODAY.push(item)
    for (const r of d.returns) {
      if (r.status === "RETURN_REQUESTED" || r.status === "RETURNING" || r.status === "RETURN_FAILED") {
        cols.NEW.push({ ...withRef(d), itemType: "return", return: r, createdAt: r.createdAt })
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
  try {
    const r = await ncac<{ rows?: Row[] } | null>("GET", "/atms/withdraw/list", {
      creds: lookupCreds() ?? undefined, query: { inventory_id: inventoryId, date }, timeoutMs: KEYED_LIST_TIMEOUT_MS,
    })
    if (r.status < 200 || r.status >= 300) return null
    return (r.data?.rows ?? []).map(toKeyed)
  } catch {
    return null
  }
}

/**
 * WD วันนี้ของคลังนั้นที่ถูกคีย์ตรงใน ATMS (อ่านอย่างเดียว) · อ่านด้วยบัญชีค้นข้อมูล (ATMS_LOOKUP_* หรือบัญชีของ api-ncac) ไม่ใช้บัญชีสโตร์
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


// ---------- อ้างอิงใบ PO / DD: รายการในใบ + จับคู่ SKU + ยอดที่ตัดไปแล้ว (อ่านอย่างเดียว) ----------

export const DOC_SKU_LOOKUP_CAP = 25 // ค้น SKU ใน ATMS ต่อใบไม่เกินกี่ครั้ง (ที่เหลือ = ไม่พบ)
let docPaceMs = 1_000 // กฎ pace ของ ATMS: ห่างกัน ≥ 1 วิ · เทสต์ปรับได้
export const setDocPaceMs = (ms: number) => { docPaceMs = ms }

type NcacDocLine = {
  sku_code?: string; sku_name?: string; group?: string
  amount?: number | null; received?: number | null; remaining?: number | null
  unit_price?: number | null; total?: number | null; remark?: string; is_labour?: boolean
}
type NcacDoc = {
  id: number; code: string; kind: "po" | "dd"; date?: string | null; supplier?: string | null
  pr?: string | null; po?: string | null; withdraw?: string | null; lines?: NcacDocLine[]
}

export type DocLine = {
  skuCode: string; skuName: string; group: string; isLabour: boolean
  docQty: number; receivedQty: number; qty: number; unitPrice: number | null
  skuId: number | null; stockQty: number | null; alreadyCut: number; cutBy: string[]
}
export type DocDetail = {
  doc: { id: number; code: string; kind: "po" | "dd"; date: string | null; supplier: string | null; pr: string | null; po: string | null }
  lines: DocLine[]
  warnings: string[]
}

const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type MasterHit = { skuId: number; stockQty: number | null }

/** รหัสสินค้า → skuId + สต๊อกจากสำเนา atms_sku_master (สต๊อกนับเฉพาะแถวของคลังที่เลือก · ไม่มี inventoryId = นับ) */
async function masterByCode(codes: string[], inventoryId?: number): Promise<Map<string, MasterHit>> {
  const out = new Map<string, MasterHit>()
  if (codes.length === 0) return out
  const docs = await (await skuMasterCol())
    .find({ code: { $in: codes } }, { projection: { _id: 0, skuPk: 1, code: 1, stockQty: 1, inventoryId: 1 } }).toArray()
  for (const m of docs) {
    const skuId = Number(m.skuPk)
    const code = str(m.code)
    if (!Number.isInteger(skuId) || skuId <= 0 || !code) continue
    const invRaw = m.inventoryId == null || m.inventoryId === "" ? null : Number(m.inventoryId)
    const sameInv = inventoryId == null || invRaw == null || invRaw === inventoryId
    const stockQty = sameInv && typeof m.stockQty === "number" ? m.stockQty : null
    const prev = out.get(code)
    // แถวคลังตรงกันชนะแถวอื่น
    if (!prev || (prev.stockQty == null && stockQty != null)) out.set(code, { skuId, stockQty })
  }
  return out
}

/** รายการในใบ PO / DD พร้อมข้อมูลช่วยตัดสินใจ · 404 ถ้าไม่พบใบ */
export async function getDocDetail(kind: "po" | "dd", id: number, inventoryId?: number): Promise<DocDetail> {
  const d = await ncacRead<NcacDoc>(`/atms/withdraw/doc/${kind}/${id}`, undefined, "ไม่พบใบนี้ใน ATMS ตรวจเลขใบอีกครั้ง")
  const raw = Array.isArray(d.lines) ? d.lines : []
  const base = raw.map((l) => {
    const skuName = str(l.sku_name)
    const skuCode = str(l.sku_code) || skuName.split(" : ")[0].trim()
    const docQty = numOr(l.amount, 0)
    // DD: จำนวนในใบ = จำนวนที่รับแล้ว · PO: คอลัมน์ "รับ"
    const receivedQty = kind === "dd" ? numOr(l.received, docQty) : numOr(l.received, 0)
    return {
      skuCode, skuName: skuName || skuCode, group: str(l.group), isLabour: l.is_labour === true,
      docQty, receivedQty, qty: receivedQty, unitPrice: typeof l.unit_price === "number" ? l.unit_price : null,
    }
  })

  // จับคู่ SKU: สำเนา Mongo ก่อน แล้วค่อยถาม ATMS ทีละรหัส (รหัสตรงเป๊ะเท่านั้น · เพดาน + pace)
  const codes = [...new Set(base.map((b) => b.skuCode).filter(Boolean))]
  const hits = await masterByCode(codes, inventoryId)
  const extra: string[] = []
  let lookups = 0
  let lookupFailed = false
  let capped = false
  for (const code of codes) {
    if (hits.has(code)) continue
    if (lookupFailed) break
    if (lookups >= DOC_SKU_LOOKUP_CAP) { capped = true; break }
    if (lookups > 0) await sleep(docPaceMs)
    lookups++
    try {
      const r = await ncacRead<{ results?: Row[] }>("/atms/withdraw/lookup/sku", { q: code, limit: 20, inventory_id: inventoryId })
      const exact = (r.results ?? []).find((x) => str(x.code ?? x.sku_code) === code)
      const skuId = exact ? Number(exact.id ?? exact.sku_id) : NaN
      if (Number.isInteger(skuId) && skuId > 0) { hits.set(code, { skuId, stockQty: null }); extra.push(code) }
    } catch {
      lookupFailed = true
    }
  }
  // รหัสที่เพิ่งเจอจาก ATMS: ลองหาสต๊อกจากสำเนาด้วย skuPk
  if (extra.length) {
    const ids = extra.map((c) => hits.get(c)!.skuId)
    const docs = await (await skuMasterCol())
      .find({ skuPk: { $in: ids } }, { projection: { _id: 0, skuPk: 1, stockQty: 1, inventoryId: 1 } }).toArray()
    for (const m of docs) {
      const invRaw = m.inventoryId == null || m.inventoryId === "" ? null : Number(m.inventoryId)
      if (inventoryId != null && invRaw != null && invRaw !== inventoryId) continue
      const code = extra.find((c) => hits.get(c)!.skuId === Number(m.skuPk))
      if (code && typeof m.stockQty === "number") hits.get(code)!.stockQty = m.stockQty
    }
  }

  // ตัดไปแล้ว: คำขออื่นที่อ้างใบนี้ (ไม่นับที่ยกเลิก/ปฏิเสธ)
  const mine = await (await swCol()).find(
    { "ref.code": d.code, "ref.type": kind, status: { $nin: ["CANCELLED", "REJECTED"] } },
    { projection: { _id: 0, no: 1, status: 1, lines: 1 } },
  ).sort({ createdAt: 1, no: 1 }).limit(500).toArray()
  const cut = tallyCut(mine)

  const lines: DocLine[] = base.map((b) => {
    const h = hits.get(b.skuCode)
    const c = cut.get(b.skuCode)
    return { ...b, skuId: h?.skuId ?? null, stockQty: h?.stockQty ?? null, alreadyCut: c?.qty ?? 0, cutBy: c?.by ?? [] }
  })
  const warnings = docWarnings(kind, lines)
  if (capped) warnings.push("ค้น SKU ใน ATMS ได้ไม่ครบ บางบรรทัดอาจขึ้นว่าไม่พบ ลองเปิดใบใหม่อีกครั้ง")
  if (lookupFailed) warnings.push("ติดต่อ ATMS ค้น SKU ไม่ได้ในบางบรรทัด ลองเปิดใบใหม่อีกครั้ง")
  return {
    doc: { id: numOr(d.id, id), code: str(d.code), kind, date: d.date ?? null, supplier: d.supplier ?? null, pr: d.pr ?? null, po: d.po ?? null },
    lines, warnings,
  }
}
