// lib/po-export.ts — หน้า /po: กรองใบสั่งซื้อตามวันที่ + ส่งออก Excel (หัวใบ + รายการสินค้า)
// ตรรกะล้วน ไม่แตะ DB/React — ใช้ร่วมกันทั้ง API, หน้าเว็บ และ scripts/check-po-export.ts
//
// ที่มา: atms.purchase_orders (หัวใบจากหน้า list ของ ATMS — ชื่อคอลัมน์ไทยตามหัวตาราง)
//   + purchase_requests (ผู้ขอซื้อ/คลัง/แผนก/หมายเหตุที่มีเลขใบแจ้งซ่อม)
//   + deposit_header.purchase_order (ใบรับของ DD) + purchase_order_items (รายการสินค้า)
// ฟิลด์หัวใบที่ไม่รู้จักติดไปใน extra ทั้งหมด — ATMS เพิ่มคอลัมน์เมื่อไหร่ Excel ก็ได้ครบเอง

export const PO_KEY = "รหัส"
export const PR_KEY = "ใบขอสั่งซื้อ (PR)"

export type PoDateField = "po" | "due"
/** ฟิลด์วันที่ใน purchase_orders (string DD/MM/YYYY) */
export const PO_DATE_FIELDS: Record<PoDateField, string> = { po: "วันที่", due: "กำหนดส่งสินค้า" }
export const PO_DATE_LABELS: Record<PoDateField, string> = { po: "วันที่ PO", due: "กำหนดส่งสินค้า" }

export const PO_MAX_DAYS = 366       // เลือกได้ไม่เกิน 1 ปีต่อครั้ง
export const PO_PAGE_SIZE = 1500     // แถวต่อ request (~1.2 MB) — ต่ำกว่าเพดาน 4.5 MB ของ Vercel
export const PO_MAX_ROWS = 15000     // เกินนี้ให้แบ่งช่วงวันที่
export const PO_ITEMS_CHUNK = 200    // เลข PO ต่อ request รายการสินค้า (ส่งทาง query string)

type Doc = Record<string, unknown>

/** ข้อความ: \xa0 (มากับชื่อซัพพลายเออร์ใน ATMS) และช่องว่างซ้อน → ช่องเดียว */
export const s = (v: unknown) => (v == null ? "" : String(v)).replace(/[\s ]+/g, " ").trim()

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const t = s(v).replace(/,/g, "")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const realDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const pad = (n: number) => String(n).padStart(2, "0")

/** "05/10/2026" หรือ "5/10/2026 14:20" → "2026-10-05" · อ่านไม่ได้ = "" */
export function atmsDateISO(v: unknown): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(s(v))
  if (!m) return ""
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
  return realDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : ""
}

function isoParts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  return realDate(y, mo, d) ? [y, mo, d] : null
}
const isoMs = (p: [number, number, number]) => Date.UTC(p[0], p[1] - 1, p[2])

/** ตรวจช่วงวันที่ (YYYY-MM-DD) · ผ่าน = null · ไม่ผ่าน = ข้อความบอกผู้ใช้ */
export function poRangeError(from: string, to: string): string | null {
  const a = isoParts(from), b = isoParts(to)
  if (!a || !b) return "เลือกวันที่เริ่มและวันที่สิ้นสุดให้ครบ"
  if (isoMs(a) > isoMs(b)) return "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด"
  if ((isoMs(b) - isoMs(a)) / 86400000 + 1 > PO_MAX_DAYS) return "เลือกได้ไม่เกิน 1 ปีต่อครั้ง แบ่งช่วงวันที่แล้วลองใหม่"
  return null
}

/** regex กรองเดือนก่อน (วันที่เป็น string DD/MM/YYYY) — ช่วยให้ Mongo ไม่ต้องแปลงวันที่ทุกใบ */
export function poMonthRegex(from: string, to: string): string {
  const a = isoParts(from), b = isoParts(to)
  if (!a || !b) return "^$"
  const alts: string[] = []
  let y = a[0], m = a[1]
  while (y < b[0] || (y === b[0] && m <= b[1])) {
    alts.push(`${m >= 10 ? m : `0?${m}`}/${y}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return `^\\d{1,2}/(?:${alts.join("|")})(?:\\s|$)`
}

// ── สถานะการรับสินค้า (ค่าจาก ATMS) ─────────────────────────────────────
export type PoStatusKey = "all" | "partial" | "none" | "cancel" | "other"
export const PO_STATUS_ORDER: PoStatusKey[] = ["none", "partial", "all", "cancel", "other"]
export const PO_STATUS_LABEL: Record<PoStatusKey, string> = {
  none: "ยังไม่รับ", partial: "รับบางส่วน", all: "รับครบแล้ว", cancel: "ยกเลิก", other: "ไม่ระบุ",
}
export function poStatusKey(status: string): PoStatusKey {
  const t = s(status)
  if (t.includes("ยกเลิก")) return "cancel"
  if (t.includes("ทั้งหมด")) return "all"
  if (t.includes("บางส่วน")) return "partial"
  if (t.includes("ยังไม่")) return "none"
  return "other"
}

// ── แถว PO ─────────────────────────────────────────────────────────────
export type PoDd = { code: string; date: string }
export type PoRow = {
  code: string
  date: string          // YYYY-MM-DD
  due: string           // YYYY-MM-DD
  status: string        // ข้อความเดิมจาก ATMS
  statusKey: PoStatusKey
  supplier: string
  total: number | null
  apTerm: string
  pr: string
  prDate: string
  requester: string
  warehouse: string
  dept: string
  vehicle: string
  fleetNo: string
  user: string
  approver: string
  prNote: string
  dd: PoDd[]
  /** ฟิลด์หัวใบอื่นที่ ATMS มี (ชื่อคอลัมน์เดิม) */
  extra: Record<string, string>
}

const KNOWN_PO_KEYS = new Set([
  "_id", "scraped_at", PO_KEY, "วันที่", PR_KEY, "ซัพพลายเออร์", "ยานพาหนะ", "รวม", "กำหนดส่งสินค้า",
  "สถานะการรับสินค้า", "ap term", "ผู้ใช้งาน", "approver", "คลังสินค้า", "แผนก",
])

export function poRowOf(po: Doc, ctx: { pr?: Doc | null; dd?: { code: string; date: unknown }[]; fleetNo?: string }): PoRow {
  const pr = ctx.pr ?? {}
  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(po)) {
    if (KNOWN_PO_KEYS.has(k) || k.startsWith("_") || v == null || typeof v === "object") continue
    const t = s(v)
    if (t) extra[k] = t
  }
  const status = s(po["สถานะการรับสินค้า"])
  return {
    code: s(po[PO_KEY]),
    date: atmsDateISO(po["วันที่"]),
    due: atmsDateISO(po["กำหนดส่งสินค้า"]),
    status,
    statusKey: poStatusKey(status),
    supplier: s(po["ซัพพลายเออร์"]),
    total: num(po["รวม"]),
    apTerm: s(po["ap term"]),
    pr: s(po[PR_KEY]),
    prDate: atmsDateISO(pr["วันที่"]),
    requester: s(pr["ผู้ขอซื้อ"]),
    warehouse: s(po["คลังสินค้า"]) || s(pr["คลังสินค้า"]),
    dept: s(po["แผนก"]) || s(pr["แผนก"]),
    vehicle: s(po["ยานพาหนะ"]) || s(pr["ทะเบียน"]),
    fleetNo: s(ctx.fleetNo),
    user: s(po["ผู้ใช้งาน"]),
    approver: s(po["approver"]),
    prNote: s(pr["หมายเหตุ"]),
    dd: (ctx.dd ?? [])
      .map((d) => ({ code: s(d.code), date: atmsDateISO(d.date) }))
      .filter((d) => d.code)
      .sort((x, y) => x.date.localeCompare(y.date) || x.code.localeCompare(y.code)),
    extra,
  }
}

const squash = (t: string) => t.toLowerCase().replace(/[\s\-]+/g, "")

// ข้อความค้นของหัวใบ — คำนวณครั้งเดียวต่อแถว (พิมพ์ค้นทุกตัวอักษรไม่ต้อง join ใหม่)
const rowHayCache = new WeakMap<PoRow, string>()
function rowHay(r: PoRow): string {
  let h = rowHayCache.get(r)
  if (h === undefined) {
    h = squash([r.code, r.pr, r.supplier, r.vehicle, r.fleetNo, r.prNote, r.requester, r.user,
      r.warehouse, r.dept, ...r.dd.map((d) => d.code)].join("|"))
    rowHayCache.set(r, h)
  }
  return h
}
const itemHay = (it: PoItem) => squash([it.sku, it.name, it.group, it.note].join("|"))

/** ตัวกรองหน้า /po — ใช้ทั้งแท็บรายการสินค้าและแท็บใบสั่งซื้อ */
export type PoFilter = { q?: string; statuses?: PoStatusKey[]; suppliers?: string[]; skus?: string[] }

type Prepared = { q: string; st: Set<PoStatusKey>; sup: Set<string>; sku: Set<string> }
const prep = (f: PoFilter): Prepared => ({
  q: squash(f.q ?? ""), st: new Set(f.statuses ?? []), sup: new Set(f.suppliers ?? []), sku: new Set(f.skus ?? []),
})
const headOk = (r: PoRow, p: Prepared) => (!p.st.size || p.st.has(r.statusKey)) && (!p.sup.size || p.sup.has(r.supplier))
const lineOk = (r: PoRow, it: PoItem, hay: string | null, p: Prepared) =>
  headOk(r, p) && (!p.sku.size || p.sku.has(it.sku)) && (!p.q || rowHay(r).includes(p.q) || (hay ?? itemHay(it)).includes(p.q))

/**
 * กรองใบสั่งซื้อ: สถานะ · ซัพพลายเออร์ · รหัสสินค้า · คำค้น (เลข PO/PR/DD, ซัพ, ทะเบียน, เบอร์รถ, หมายเหตุ PR, ชื่อ/รหัสสินค้า)
 * เงื่อนไขที่ต้องดูรายการสินค้า ใบนั้นต้องมีอย่างน้อยหนึ่งบรรทัดที่ตรง — ตรงกับแท็บรายการสินค้าเสมอ
 */
export function filterPoRows(rows: PoRow[], f: PoFilter, items?: Map<string, PoItem[]>): PoRow[] {
  const p = prep(f)
  return rows.filter((r) => {
    if (!headOk(r, p)) return false
    if (!p.sku.size && (!p.q || rowHay(r).includes(p.q))) return true
    return (items?.get(r.code) ?? []).some((it) => lineOk(r, it, null, p))
  })
}

/** หนึ่งบรรทัดสินค้าในใบ (แท็บรายการสินค้า) */
export type PoLine = { key: string; row: PoRow; item: PoItem; hay: string }

/** บรรทัดสินค้าทั้งหมดของใบที่ให้มา เรียงตามลำดับใบ · ใบที่ยังไม่มีรายการไม่ขึ้น */
export function poLines(rows: PoRow[], items: Map<string, PoItem[]>): PoLine[] {
  const out: PoLine[] = []
  for (const r of rows) {
    const list = items.get(r.code)
    if (!list) continue
    list.forEach((it, i) => out.push({ key: `${r.code}#${i}`, row: r, item: it, hay: itemHay(it) }))
  }
  return out
}

export function filterPoLines(lines: PoLine[], f: PoFilter): PoLine[] {
  const p = prep(f)
  return lines.filter((l) => lineOk(l.row, l.item, l.hay, p))
}

// ── รายชื่อให้เลือก (autocomplete) ───────────────────────────────────
export type PoOption = { value: string; label: string; sub: string; count: number }

const byCount = (a: PoOption, b: PoOption) => b.count - a.count || a.label.localeCompare(b.label, "th")

/** ซัพพลายเออร์ที่มีในข้อมูลชุดนี้ · count = จำนวนใบ */
export function poSupplierOptions(rows: PoRow[]): PoOption[] {
  const n = new Map<string, number>()
  for (const r of rows) if (r.supplier) n.set(r.supplier, (n.get(r.supplier) ?? 0) + 1)
  return [...n].map(([v, c]) => ({ value: v, label: v, sub: "", count: c })).sort(byCount)
}

/** รหัสสินค้าที่มีในข้อมูลชุดนี้ · sub = ชื่อที่ใช้บ่อยสุด · count = จำนวนบรรทัด */
export function poSkuOptions(lines: PoLine[]): PoOption[] {
  const by = new Map<string, { count: number; names: Map<string, number> }>()
  for (const { item } of lines) {
    if (!item.sku) continue
    let e = by.get(item.sku)
    if (!e) { e = { count: 0, names: new Map() }; by.set(item.sku, e) }
    e.count++
    if (item.name) e.names.set(item.name, (e.names.get(item.name) ?? 0) + 1)
  }
  return [...by].map(([sku, e]) => ({
    value: sku, label: sku, count: e.count,
    sub: [...e.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
  })).sort(byCount)
}

/**
 * คัดรายชื่อตามที่พิมพ์: ทุกคำต้องเจอ (สลับลำดับได้ ไม่สนขีด/ตัวพิมพ์) · คำที่ขึ้นต้นตรงมาก่อน แล้วเรียงตามจำนวน
 * ยังไม่พิมพ์ = ตัวที่ใช้บ่อยสุด · ตัวที่เลือกแล้วไม่ขึ้นซ้ำ
 */
export function poMatchOptions(opts: PoOption[], query: string, exclude: string[] = [], limit = 8): PoOption[] {
  const skip = new Set(exclude)
  const toks = query.toLowerCase().split(/\s+/).map(squash).filter(Boolean)
  const scored: { o: PoOption; rank: number }[] = []
  for (const o of opts) {
    if (skip.has(o.value)) continue
    if (!toks.length) { scored.push({ o, rank: 0 }); continue }
    const text = `${o.value} ${o.label} ${o.sub}`.toLowerCase()
    const hay = squash(text)
    if (!toks.every((t) => hay.includes(t))) continue
    const prefix = squash(o.value).startsWith(toks.join("")) || text.split(/\s+/).some((w) => squash(w).startsWith(toks[0]))
    scored.push({ o, rank: prefix ? 0 : 1 })
  }
  return scored.sort((a, b) => a.rank - b.rank || byCount(a.o, b.o)).slice(0, limit).map((x) => x.o)
}

// ── Excel ──────────────────────────────────────────────────────────────
type Cell = string | number
const blank = (v: string | number | null | undefined): Cell => (v == null ? "" : v)
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")

/** คอลัมน์วันที่ (ค่าเป็น YYYY-MM-DD) — ตัวสร้าง Excel แปลงเป็นวันที่จริง */
export const PO_SHEET_DATE_COLS = new Set(["วันที่ PO", "กำหนดส่งสินค้า", "วันที่ PR"])
export const PO_SHEET_MONEY_COLS = new Set(["ยอดรวม", "ราคาต่อหน่วย", "รวม"])

/** ชีต "ใบสั่งซื้อ" — หนึ่งแถวต่อ PO · ฟิลด์อื่นของ ATMS ต่อท้าย ทุกแถวมีคอลัมน์ครบเท่ากัน */
export function poSheetRows(rows: PoRow[], itemCounts?: Map<string, number>): Record<string, Cell>[] {
  const extraKeys: string[] = []
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.extra)) if (!seen.has(k)) { seen.add(k); extraKeys.push(k) }
  return rows.map((r) => {
    const out: Record<string, Cell> = {
      "เลขที่ PO": r.code,
      "วันที่ PO": r.date,
      "กำหนดส่งสินค้า": r.due,
      "สถานะการรับสินค้า": r.status,
      "ซัพพลายเออร์": r.supplier,
      "ยอดรวม": blank(r.total),
      "เครดิต": r.apTerm,
      "ใบขอซื้อ (PR)": r.pr,
      "วันที่ PR": r.prDate,
      "ผู้ขอซื้อ": r.requester,
      "คลังสินค้า": r.warehouse,
      "แผนก": r.dept,
      "ทะเบียน": r.vehicle,
      "เบอร์รถ": r.fleetNo,
      "ผู้เปิด PO": r.user,
      "ผู้อนุมัติ": r.approver,
      "ใบรับของ (DD)": r.dd.map((d) => d.code).join(", "),
      "วันที่รับของ": r.dd.map((d) => dmy(d.date)).filter(Boolean).join(", "),
      "หมายเหตุ PR": r.prNote,
      "จำนวนรายการ": itemCounts ? itemCounts.get(r.code) ?? 0 : "",
    }
    for (const k of extraKeys) out[k] = r.extra[k] ?? ""
    return out
  })
}

export type PoItem = {
  poCode: string
  seq: number | null
  group: string
  sku: string
  name: string
  qty: number | null
  unitPrice: number | null
  total: number | null
  received: number | null
  outstanding: number | null
  warehouse: string
  note: string
}

export function poItemOf(d: Doc): PoItem {
  return {
    poCode: s(d.po_code),
    seq: num(d.seq),
    group: s(d.group),
    sku: s(d.sku),
    name: s(d.name),
    qty: num(d.amount),
    unitPrice: num(d.unit_price),
    total: num(d.total),
    received: num(d.received),
    outstanding: num(d.outstanding),
    warehouse: s(d.warehouse),
    note: s(d.note),
  }
}

/** ชีต "รายการสินค้า" — หนึ่งแถวต่อรายการ · PO ที่ยังไม่มีรายการขึ้นหนึ่งแถวบอกไว้ ไม่หายเงียบ */
export function poItemSheetRows(rows: PoRow[], items: Map<string, PoItem[]>): Record<string, Cell>[] {
  const out: Record<string, Cell>[] = []
  for (const r of rows) {
    const head = {
      "เลขที่ PO": r.code, "วันที่ PO": r.date, "สถานะการรับสินค้า": r.status, "ซัพพลายเออร์": r.supplier,
      "ทะเบียน": r.vehicle, "เบอร์รถ": r.fleetNo,
    }
    const list = items.get(r.code) ?? []
    if (!list.length) {
      out.push({ ...head, "ลำดับ": "", "กลุ่มสินค้า": "", "รหัสสินค้า": "", "ชื่อสินค้า": "ยังไม่มีรายการในระบบ",
        "จำนวน": "", "ราคาต่อหน่วย": "", "รวม": "", "รับแล้ว": "", "ค้างรับ": "", "คลังสินค้า": "", "หมายเหตุ": "" })
      continue
    }
    for (const it of list) {
      out.push({
        ...head,
        "ลำดับ": blank(it.seq), "กลุ่มสินค้า": it.group, "รหัสสินค้า": it.sku, "ชื่อสินค้า": it.name,
        "จำนวน": blank(it.qty), "ราคาต่อหน่วย": blank(it.unitPrice), "รวม": blank(it.total),
        "รับแล้ว": blank(it.received), "ค้างรับ": blank(it.outstanding), "คลังสินค้า": it.warehouse, "หมายเหตุ": it.note,
      })
    }
  }
  return out
}

/**
 * ข้อมูล 2 ชีตตามตัวกรอง: ชีตหัวใบ = ใบที่ตรง · ชีตรายการ = เฉพาะบรรทัดที่ตรง (ใบที่ยังไม่มีรายการขึ้นหนึ่งแถวบอกไว้)
 * "จำนวนรายการ" ในชีตหัวใบนับทั้งใบ ไม่ใช่เฉพาะที่กรอง
 */
export function poExportSheets(rows: PoRow[], items: Map<string, PoItem[]>, f: PoFilter) {
  const shown = filterPoRows(rows, f, items)
  const matched = new Map<string, PoItem[]>()
  for (const l of filterPoLines(poLines(shown, items), f)) {
    const list = matched.get(l.row.code)
    if (list) list.push(l.item)
    else matched.set(l.row.code, [l.item])
  }
  const counts = new Map([...items].map(([code, list]) => [code, list.length]))
  return { po: poSheetRows(shown, counts), items: poItemSheetRows(shown, matched) }
}

export function poExportFileName(from: string, to: string, field: PoDateField): string {
  return `PO_${field === "due" ? "กำหนดส่ง" : "วันที่PO"}_${from}_ถึง_${to}.xlsx`
}

/** "A,B,,A" → ["A","B"] · เกิน PO_ITEMS_CHUNK = null (ให้ API ตอบ 400) */
export function poParseCodes(raw: string | null): string[] | null {
  if (!raw) return []
  const codes = [...new Set(raw.split(",").map((c) => c.trim()).filter((c) => /^[A-Za-z0-9_\-/]{1,40}$/.test(c)))]
  return codes.length > PO_ITEMS_CHUNK ? null : codes
}

// ── แสดงผล ─────────────────────────────────────────────────────────────
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
/** "2026-10-03" → "3 ต.ค. 69" */
export function poThaiDate(iso: string): string {
  const p = isoParts(iso)
  return p ? `${p[2]} ${TH_MONTH[p[1] - 1]} ${String(p[0] + 543).slice(-2)}` : "—"
}
