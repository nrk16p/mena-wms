// lib/core-return/core.ts — ติดตามซากอะไหล่ (ล้วน ไม่แตะ DB): สถานะ · ตรวจค่าที่กรอก · ค้นหาแบบไม่สนขีด/ช่องว่าง · ค้างกี่วัน
//
// ฐานข้อมูลมาจาก core-return-base/load_base.py (master_data.core_return_base) — โค้ดนี้อ่าน/เขียนรูปแบบนั้นตรง ๆ
// ฟิลด์ที่ระบบนี้เพิ่มเอง (ret / sale / rebuild / noCore / followUp / coreUpdatedAt) loader ไม่แตะ เพราะ loader $set เฉพาะฟิลด์ฐาน

export const CORE_STATUSES = ["pending", "legacy", "sell_waiting", "sold", "rebuild", "rebuilt", "no_core"] as const
export type CoreStatus = (typeof CORE_STATUSES)[number]

export const STATUS_LABEL: Record<CoreStatus, string> = {
  pending: "รอคืนซาก",
  legacy: "มีในไฟล์ติดตามเดิม",
  sell_waiting: "S1 ซากมีมูลค่า · อยู่คลังซากรอขาย",
  sold: "ขายซากแล้ว",
  rebuild: "A2 ส่งรีบิ้ว",
  rebuilt: "A2 รีบิ้วเสร็จ",
  no_core: "S2 ซากไม่มีมูลค่า",
}

/** ยังไม่คืนซาก (legacy ทำงานเหมือน pending) */
export const OUTSTANDING: CoreStatus[] = ["pending", "legacy"]
/** ยังไม่จบ — ตามงานได้ */
export const OPEN: CoreStatus[] = ["pending", "legacy", "sell_waiting", "rebuild"]

export const isStatus = (v: unknown): v is CoreStatus => (CORE_STATUSES as readonly string[]).includes(v as string)

export type ReturnChoice = "sell" | "rebuild" | "no_core"
export const CHOICE_TO: Record<ReturnChoice, CoreStatus> = { sell: "sell_waiting", rebuild: "rebuild", no_core: "no_core" }
export const NO_CORE_REASONS = ["ของสิ้นเปลือง", "ซากเสียหายทิ้ง", "อื่นๆ"] as const

export type Actor = { email: string; name: string; via: "web" | "api" }

/** แถวใน master_data.core_return_base (ฟิลด์ฐานจาก loader + ฟิลด์ที่ระบบนี้เพิ่ม) */
export type CoreRow = {
  _id?: unknown
  row_key: string
  issuedDate: string // YYYY-MM-DD
  yearMonth?: string | null
  warehouse?: string | null
  wdCode?: string | null
  mrCode?: string | null
  purpose?: string | null
  skuCode?: string | null
  skuName?: string | null
  productGroup?: string | null
  vehicleNo?: string | null
  plate?: string | null
  driver?: string | null
  serialNo?: string | null
  qtyIssued?: number | null
  unitCost?: number | null
  amount?: number | null
  remark?: string | null
  source?: string | null
  legacySheet?: string | null
  legacyRound?: string | null
  legacyNote?: string | null
  coreStatus: CoreStatus
  coreQtyReturned?: number
  createdAt?: Date
  loadedAt?: Date
  // ── ระบบนี้เพิ่ม ──
  ret?: { choice: ReturnChoice; qty: number; shortReason: string | null; note: string; at: Date; by: { email: string; name: string }; attachmentIds?: string[] } | null
  /** จำนวนไฟล์แนบที่ยืนยันแล้ว (นับตอน confirm) */
  attachCount?: number
  sale?: { scrapInDate: string | null; soldDate: string | null; roundNo?: string | null; price: number | null; buyer: string | null; note: string; soldAt: Date | null; soldBy: { email: string; name: string } | null } | null
  rebuild?: { sentDate: string | null; vendor: string | null; doneDate: string | null; note: string; doneAt: Date | null; doneBy: { email: string; name: string } | null } | null
  noCore?: { reason: string; note: string } | null
  followUp?: { count: number; lastAt: Date; lastNote: string; lastBy: { email: string; name: string }; nextDate: string | null } | null
  /** อู่ที่ซากน่าจะอยู่ (load_base.py / ใบเบิก WMS): อู่ใน | อู่นอก | Mobile/PM · garage = ชื่ออู่ (หลายเจ้าคั่นด้วย " / ") */
  garageType?: string | null
  garage?: string | null
  garageSource?: string | null
  // ── แถวจากใบเบิก WMS (source "wms.store-withdraw") · แถวจาก ATMS ไม่มีกลุ่มนี้ ──
  swNo?: string
  swLineIndex?: number
  swUsageIndex?: number | null
  requester?: { email: string; name: string } | null
  mrItemLabel?: string | null
  /** อยู่ในรอบขายซาก (core_sale_rounds) · ไม่มี/null = ยังไม่เข้ารอบ */
  saleRoundNo?: string | null
  coreUpdatedAt?: Date
}

export class CoreHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = "CoreHttpError"
  }
}
const bad = (m: string) => new CoreHttpError(m, 400)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false
  const d = new Date(v + "T00:00:00Z")
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** วันนี้ตามเวลาไทย YYYY-MM-DD */
export const todayBkk = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)

/** ค้างกี่วัน นับจาก issuedDate ถึงวันนี้ (เวลาไทย) · วันที่เสีย = null */
export function daysSince(issuedDate: string | null | undefined, now = new Date()): number | null {
  if (!isYmd(issuedDate)) return null
  const ms = Date.parse(todayBkk(now) + "T00:00:00Z") - Date.parse(issuedDate + "T00:00:00Z")
  return Math.max(0, Math.round(ms / 86_400_000))
}
export const OVERDUE_DAYS = 14
/** ระดับสีของจำนวนวันค้าง: <=14 เทา · 15–60 เหลือง · >60 แดง (กฎ "ค้างเกิน 14 วัน" ของคิวตามงานไม่เกี่ยว) */
export type AgingTier = "ok" | "warn" | "late"
export const AGING_LATE_DAYS = 60
export function agingTier(days: number | null | undefined): AgingTier {
  if (days == null || !(days > OVERDUE_DAYS)) return "ok"
  return days > AGING_LATE_DAYS ? "late" : "warn"
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function dateField(v: unknown, label: string, opt: { required: boolean; today: string; min?: string | null; minLabel?: string }): string | null {
  if (v === null || v === undefined || v === "") {
    if (opt.required) throw bad(`ใส่${label}ก่อน`)
    return null
  }
  if (!isYmd(v)) throw bad(`${label}ไม่ถูกต้อง`)
  if (v > opt.today) throw bad(`${label}ต้องไม่เกินวันนี้`)
  if (opt.min && isYmd(opt.min) && v < opt.min) throw bad(`${label}ต้องไม่ก่อน${opt.minLabel ?? "วันที่เบิก"}`)
  return v
}

export type ReturnInput = {
  choice: ReturnChoice; qty: number; shortReason: string | null; note: string
  scrapInDate: string | null; rebuildSentDate: string | null; rebuildVendor: string | null; noCoreReason: string | null
}

/** ตรวจค่าคืนซาก · qty ค่าเริ่มต้น = จำนวนที่เบิก · คืนไม่ครบต้องบอกเหตุผล · S1 ต้องมีวันที่เข้าคลังซาก */
export function parseReturn(body: Record<string, unknown>, row: Pick<CoreRow, "qtyIssued" | "issuedDate">, now = new Date()): ReturnInput {
  const choice = body.choice
  if (choice !== "sell" && choice !== "rebuild" && choice !== "no_core") throw bad("เลือกก่อนว่า S1 ซากมีมูลค่า / S2 ซากไม่มีมูลค่า / A2 ของรีบิ้ว")
  const today = todayBkk(now)
  const issued = typeof row.qtyIssued === "number" && row.qtyIssued > 0 ? row.qtyIssued : null
  const note = str(body.note)
  if (choice === "no_core") {
    const reason = str(body.noCoreReason, 100)
    if (!reason) throw bad("บอกเหตุผลที่ซากไม่มีมูลค่า")
    if (reason === "อื่นๆ" && !note) throw bad("เลือก อื่นๆ ต้องเขียนหมายเหตุด้วย")
    return { choice, qty: 0, shortReason: null, note, scrapInDate: null, rebuildSentDate: null, rebuildVendor: null, noCoreReason: reason }
  }
  const rawQty = num(body.qty)
  const qty = rawQty === null ? issued ?? 1 : rawQty
  if (!(qty > 0)) throw bad("จำนวนที่คืนต้องมากกว่า 0")
  if (issued !== null && qty > issued) throw bad(`คืนได้ไม่เกิน ${issued} ตามที่เบิก`)
  const short = issued !== null && qty < issued
  const shortReason = short ? str(body.shortReason, 300) : ""
  if (short && !shortReason) throw bad("คืนไม่ครบ บอกเหตุผลด้วย")
  if (choice === "sell") {
    const scrapInDate = dateField(body.scrapInDate, "วันที่เข้าคลังซาก", { required: true, today, min: row.issuedDate })
    return { choice, qty, shortReason: short ? shortReason : null, note, scrapInDate, rebuildSentDate: null, rebuildVendor: null, noCoreReason: null }
  }
  const rebuildSentDate = dateField(body.rebuildSentDate, "วันที่ส่งรีบิ้ว", { required: false, today, min: row.issuedDate })
  return { choice, qty, shortReason: short ? shortReason : null, note, scrapInDate: null, rebuildSentDate, rebuildVendor: str(body.rebuildVendor, 200) || null, noCoreReason: null }
}

export function parseSold(body: Record<string, unknown>, row: Pick<CoreRow, "sale" | "issuedDate">, now = new Date()) {
  const today = todayBkk(now)
  const soldDate = dateField(body.soldDate, "วันที่ขาย", { required: true, today, min: row.sale?.scrapInDate ?? row.issuedDate, minLabel: row.sale?.scrapInDate ? "วันที่เข้าคลังซาก" : "วันที่เบิก" })!
  const price = num(body.price)
  if (price !== null && price < 0) throw bad("ราคาขายติดลบไม่ได้")
  return { soldDate, price, buyer: str(body.buyer, 200) || null, note: str(body.note) }
}

export function parseRebuilt(body: Record<string, unknown>, row: Pick<CoreRow, "rebuild" | "issuedDate">, now = new Date()) {
  const today = todayBkk(now)
  const doneDate = dateField(body.rebuiltDate, "วันที่รีบิ้วเสร็จ", { required: true, today, min: row.rebuild?.sentDate ?? row.issuedDate, minLabel: row.rebuild?.sentDate ? "วันที่ส่งรีบิ้ว" : "วันที่เบิก" })!
  return { doneDate, note: str(body.note) }
}

export function parseFollowUp(body: Record<string, unknown>, now = new Date()) {
  const note = str(body.note)
  if (!note) throw bad("เขียนสั้น ๆ ว่าตามอะไร กับใคร")
  const next = body.nextDate
  let nextDate: string | null = null
  if (next !== null && next !== undefined && next !== "") {
    if (!isYmd(next)) throw bad("วันที่ตามครั้งถัดไปไม่ถูกต้อง")
    if (next < todayBkk(now)) throw bad("วันที่ตามครั้งถัดไปต้องเป็นวันนี้หรือหลังจากนี้")
    nextDate = next
  }
  return { note, nextDate }
}

// ── ค้นหา: ตัดช่องว่าง/ขีด/จุด ไม่สนตัวพิมพ์ · "สบ 71-4018" เจอ "สบ.71-4018" ─────────────────────
const SEP = /[\s\-._/]+/g
export const normalizeQ = (q: string) => q.replace(SEP, "").toLowerCase()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** regex ที่ยอมให้มีช่องว่าง/ขีด/จุดคั่นระหว่างตัวอักษร · ว่าง = null */
export function forgivingRegex(q: string): string | null {
  const n = normalizeQ(q.slice(0, 60))
  if (!n) return null
  return Array.from(n).map(escapeRe).join("[\\s\\-._/]*")
}
export const SEARCH_FIELDS = ["plate", "vehicleNo", "wdCode", "mrCode", "skuCode", "skuName", "garage"] as const
/** ที่มาของชื่ออู่ที่ยังไม่แน่ใจ (อาจเป็นร้านอะไหล่ ไม่ใช่อู่) */
export const UNCERTAIN_GARAGE_SOURCES = ["PO ของ MR (อาจเป็นร้านอะไหล่)", "มีค่าแรงแต่ไม่พบ PO"]

export type ListFilters = {
  status?: CoreStatus[]
  warehouse?: string | null
  q?: string | null
  from?: string | null
  to?: string | null
  plate?: string | null
  vehicleNo?: string | null
  mrCode?: string | null
  followed?: "yes" | "no" | null
  due?: boolean
  garageType?: string | null
  garage?: string | null
  /** เฉพาะแถวที่คนนี้เบิก (แถวจากใบเบิก WMS เท่านั้นที่มีผู้ขอ) */
  requesterEmail?: string | null
  /** เฉพาะแถวที่เลือก (Export ที่เลือก) · สูงสุด 200 */
  keys?: string[] | null
  /** คิวให้จัดซื้อตาม: ยังไม่คืนซาก และ (ถึงกำหนดตาม หรือ ค้างเกิน 14 วันแต่ยังไม่เคยตาม) */
  queue?: "followup" | null
}

export const MAX_KEYS = 200

export function parseFilters(sp: URLSearchParams): ListFilters {
  const status = (sp.get("status") ?? "").split(",").map((s) => s.trim()).filter(isStatus)
  const ymdOr = (k: string) => { const v = sp.get(k); return isYmd(v) ? v : null }
  const f = sp.get("followed")
  return {
    status: status.length ? status : undefined,
    warehouse: sp.get("warehouse")?.trim() || null,
    q: sp.get("q")?.slice(0, 100) || null,
    from: ymdOr("from"),
    to: ymdOr("to"),
    plate: sp.has("plate") ? sp.get("plate") ?? "" : null,
    vehicleNo: sp.has("vehicleNo") ? sp.get("vehicleNo") ?? "" : null,
    mrCode: sp.has("mr") ? sp.get("mr") ?? "" : null,
    followed: f === "yes" || f === "no" ? f : null,
    due: sp.get("due") === "1",
    queue: sp.get("queue") === "followup" ? "followup" : null,
    garageType: sp.get("garageType")?.trim() || null,
    garage: sp.has("garage") ? sp.get("garage") ?? "" : null,
    keys: sp.get("keys") ? sp.get("keys")!.split("\n").map((k) => k.trim()).filter(Boolean).slice(0, MAX_KEYS) : null,
  }
}

/** ตัวกรอง Mongo · omitStatus = ใช้กับการ์ดสรุปที่นับทุกสถานะ */
export function buildQuery(f: ListFilters, opt: { omitStatus?: boolean; now?: Date } = {}): Record<string, unknown> {
  const and: Record<string, unknown>[] = []
  if (!opt.omitStatus && f.status?.length) and.push({ coreStatus: f.status.length === 1 ? f.status[0] : { $in: f.status } })
  if (f.warehouse) and.push({ warehouse: f.warehouse })
  if (f.keys?.length) and.push({ row_key: { $in: f.keys } })
  if (f.requesterEmail) and.push({ "requester.email": f.requesterEmail })
  if (f.from || f.to) and.push({ issuedDate: { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) } })
  // ค่าว่าง = กลุ่มที่ไม่มีทะเบียน/เลขรถ/MR (ตรงกับ group-by ที่รวม null กับ "")
  // เลขรถในฐาน ATMS มีทั้งข้อความและตัวเลข (เช่น 6616) — เทียบทั้งสองแบบ
  const exact = (field: string, v: string | null | undefined) => {
    if (v === null || v === undefined) return
    if (v === "") return void and.push({ [field]: { $in: [null, ""] } })
    and.push(/^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? { [field]: { $in: [v, Number(v)] } } : { [field]: v })
  }
  exact("plate", f.plate)
  exact("vehicleNo", f.vehicleNo)
  exact("mrCode", f.mrCode)
  exact("garage", f.garage)
  if (f.garageType) and.push({ garageType: f.garageType })
  const re = f.q ? forgivingRegex(f.q) : null
  if (re) {
    const n = normalizeQ(f.q ?? "")
    const ors: Record<string, unknown>[] = SEARCH_FIELDS.map((k) => ({ [k]: { $regex: re, $options: "i" } }))
    if (/^\d+$/.test(n) && Number.isSafeInteger(Number(n))) ors.push({ vehicleNo: Number(n) })
    and.push({ $or: ors })
  }
  if (f.followed === "yes") and.push({ "followUp.count": { $gt: 0 } })
  if (f.followed === "no") and.push({ $or: [{ followUp: null }, { followUp: { $exists: false } }, { "followUp.count": { $lte: 0 } }] })
  if (f.due) and.push({ coreStatus: { $in: OPEN }, "followUp.nextDate": { $ne: null, $lte: todayBkk(opt.now) } })
  if (f.queue === "followup") {
    const today = todayBkk(opt.now)
    const old = new Date(Date.parse(today + "T00:00:00Z") - OVERDUE_DAYS * 86_400_000).toISOString().slice(0, 10)
    and.push({ coreStatus: { $in: OUTSTANDING } })
    and.push({ $or: [
      { "followUp.nextDate": { $ne: null, $lte: today } },
      { issuedDate: { $lt: old }, $or: [{ followUp: null }, { followUp: { $exists: false } }] },
    ] })
  }
  return and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and }
}

/** เรียง: ค้างนานสุดก่อน (issuedDate เก่าก่อน) แล้ว row_key ให้ลำดับนิ่งเวลาเปลี่ยนหน้า */
export const LIST_SORT = { issuedDate: 1, row_key: 1 } as const
export const SORTS = ["oldest", "newest", "amount"] as const
export type SortKey = (typeof SORTS)[number]
export const SORT_LABEL: Record<SortKey, string> = { oldest: "เก่าสุดก่อน", newest: "ใหม่สุดก่อน", amount: "ยอดเงินมากสุด" }
export const parseSort = (v: unknown): SortKey => (SORTS as readonly string[]).includes(v as string) ? (v as SortKey) : "oldest"
/** ลำดับเรียงฝั่งเซิร์ฟเวอร์ · ทุกแบบมี row_key กันลำดับกระโดดเวลาเปลี่ยนหน้า (newest ใช้ทิศตรงข้ามทั้งคู่ = อ่านย้อนดัชนี issuedDate+row_key) */
export function sortSpec(s: SortKey): Record<string, 1 | -1> {
  return s === "newest" ? { issuedDate: -1, row_key: -1 } : s === "amount" ? { amount: -1, row_key: 1 } : { ...LIST_SORT }
}
export const PAGE_SIZE = 50

export type GroupBy = "vehicle" | "mr" | "warehouse" | "garage"
export const isGroupBy = (v: unknown): v is GroupBy => v === "vehicle" || v === "mr" || v === "warehouse" || v === "garage"

/** ข้อความ "ตามแล้ว N ครั้ง · ล่าสุด dd/mm" */
export function followUpText(f: CoreRow["followUp"]): string {
  if (!f || !f.count) return "ยังไม่เคยตาม"
  const d = new Date(new Date(f.lastAt).getTime() + 7 * 3600_000)
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `ตามแล้ว ${f.count} ครั้ง · ล่าสุด ${dd}/${mm}`
}
