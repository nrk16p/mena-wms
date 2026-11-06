/**
 * ทะเบียนยางสระบุรี (แบบชีต) — ย้ายจาก Google Sheet "[2026]ข้อมูลยางสระบุรี" มาไว้ใน WMS
 *
 * ระยะ 1 ตั้งใจให้ "เหมือนชีตเดิมมากที่สุด": คอลัมน์ ชื่อช่อง และลำดับเดียวกับแท็บ 11R22.5 / 1000-20
 * ต่างจากชีตแค่ 3 อย่าง: ส่งข้อมูลแล้วไม่ลบแถว · มีปุ่มดึงบางช่องจาก ATMS · PDF แสดงยางทุกชีวิต
 *
 * ไฟล์นี้ไม่แตะฐานข้อมูล ใช้ได้ทั้งฝั่ง server และหน้าเว็บ
 */

export const SHEET_DB = process.env.MONGO_DB ?? "master_data"
export const ROWS_COLL = "tyre_sheet_rows"
export const STORAGE_COLL = "tyre_sheet_storage"
export const SALES_COLL = "tyre_sheet_sales"
export const ROUNDS_COLL = "tyre_sheet_rounds"
export const OPTIONS_COLL = "tyre_sheet_options"

export const SIZES = ["11R22.5", "1000-20"] as const
export type TyreSize = (typeof SIZES)[number]
export const SIZE_LABEL: Record<TyreSize, string> = {
  "11R22.5": "ยางนอก 11R22.5",
  "1000-20": "ยางนอก 1000-20",
}
/** "ยางนอก 11R22.5" / "S9R00001 : ยางนอก 11R22.5" → "11R22.5" */
export function sizeFromText(s: unknown): TyreSize | null {
  const t = String(s ?? "")
  if (t.includes("11R22.5")) return "11R22.5"
  if (t.includes("1000-20")) return "1000-20"
  return null
}

export type Stage = "prep" | "sent"

export type ColType = "text" | "date" | "num"
export type SheetCol = {
  key: string
  label: string
  type: ColType
  /** ช่องที่ระบบคิดให้ (เดิมเป็นสูตรในชีต) — แก้ในตารางไม่ได้ */
  computed?: boolean
  /** รายการ dropdown จากแท็บ options */
  options?: keyof SheetOptions
  width?: number
}

/** คอลัมน์ A–AN ของแท็บ 11R22.5 / 1000-20 เรียงตามชีต + ช่องใหม่ช่องเดียว (เบอร์ยางเส้นใหม่) */
export const ROW_COLS: SheetCol[] = [
  { key: "seq", label: "ลำดับ", type: "num", computed: true, width: 56 },
  { key: "bookingDate", label: "วันที่จอง", type: "date", width: 112 },
  { key: "installDate", label: "วันที่เปลี่ยนยางใหม่", type: "date", width: 112 },
  { key: "prevChangeDate", label: "วันที่เปลี่ยน(รอบที่แล้ว)", type: "date", width: 112 },
  { key: "driver", label: "ชื่อพจส.", type: "text", options: "drivers", width: 150 },
  { key: "plate", label: "ทะเบียน", type: "text", options: "plates", width: 100 },
  { key: "position", label: "ตำแหน่งยาง", type: "text", options: "positions", width: 190 },
  { key: "mrNo", label: "NO.ใบแจ้งซ่อม", type: "text", width: 120 },
  { key: "oldSerial", label: "เบอร์ยางเก่า", type: "text", width: 170 },
  { key: "storageType", label: "ประเภทการเก็บ", type: "text", options: "storageTypes", width: 120 },
  { key: "tyreType", label: "ชนิดยางเก่า", type: "text", options: "tyreTypes", width: 120 },
  { key: "mileagePrev", label: "เลขไมล์เดิม", type: "num", width: 96 },
  { key: "mileageBooking", label: "เลขไมล์วันจอง", type: "num", width: 96 },
  { key: "mileageChange", label: "เลขไมล์วันเปลี่ยนยาง", type: "num", width: 96 },
  { key: "mileageDiff", label: "ผลต่างเลขไมล์วันจองยาง", type: "num", computed: true, width: 96 },
  { key: "mileageDiffChange", label: "ผลต่างเลขไมล์วันเปลี่ยนยาง", type: "num", computed: true, width: 96 },
  { key: "depthPrev", label: "มิลยางเดิม", type: "num", width: 70 },
  { key: "depthBooking", label: "มิลยางวันจอง", type: "num", width: 70 },
  { key: "depthChange", label: "มิลยางวันเปลี่ยน", type: "num", width: 70 },
  { key: "ageY", label: "ปี", type: "num", computed: true, width: 44 },
  { key: "ageM", label: "ด", type: "num", computed: true, width: 44 },
  { key: "ageD", label: "ว", type: "num", computed: true, width: 44 },
  { key: "symptom", label: "กลุ่มอาการ", type: "text", options: "symptoms", width: 110 },
  { key: "note", label: "หมายเหตุ", type: "text", width: 200 },
  { key: "customer", label: "ลูกค้า", type: "text", width: 80 },
  { key: "plant", label: "แพล้นท์", type: "text", width: 90 },
  { key: "price", label: "ราคา", type: "num", width: 90 },
  { key: "bpk", label: "บาท/กม.", type: "num", computed: true, width: 80 },
  { key: "fullDepth", label: "มิลยางเต็ม", type: "num", width: 70 },
  { key: "ratedKm", label: "ระยะกำหนด", type: "num", width: 90 },
  { key: "depthUsed", label: "มิลยางที่ใช้ไป", type: "num", computed: true, width: 70 },
  { key: "expectedKm", label: "เลขไมล์ตามกำหนดที่ต้องใช้ได้", type: "num", computed: true, width: 100 },
  { key: "summary", label: "สรุป", type: "num", computed: true, width: 70 },
  { key: "brand", label: "ยี่ห้อยาง", type: "text", width: 100 },
  { key: "headTail", label: "ประเภทหัวหาง", type: "text", computed: true, width: 70 },
  { key: "pr", label: "PR", type: "text", width: 120 },
  { key: "status", label: "สถานะ (ขายแล้ว, รอขาย, ส่งเคลม, ยางสำรอง)", type: "text", width: 120 },
  { key: "storagePlace", label: "สถานที่เก็บ (พจส, อู่, ศูนย์)", type: "text", width: 110 },
  { key: "carcass", label: "คุณภาพโครงยาง", type: "text", width: 90 },
  { key: "salePrice", label: "ราคาขาย", type: "num", width: 80 },
  { key: "newSerial", label: "เบอร์ยางเส้นใหม่ (ใหม่)", type: "text", width: 170 },
]

/** แท็บ "บันทึกการจัดเก็บยาง" */
export const STORAGE_COLS: SheetCol[] = [
  { key: "date", label: "วันที่", type: "date", width: 112 },
  { key: "warehouse", label: "คลังสินค้า", type: "text", width: 110 },
  { key: "fleet", label: "Fleet", type: "text", width: 80 },
  { key: "serial", label: "เบอร์ยางเก่า", type: "text", width: 170 },
  { key: "tyreType", label: "ชนิดยาง", type: "text", options: "tyreTypes", width: 130 },
  { key: "carcass", label: "โครงยาง", type: "text", width: 80 },
  { key: "status", label: "สถานะ", type: "text", width: 100 },
  { key: "note", label: "หมายเหตุ", type: "text", width: 260 },
]

/** Sheet16 — ขายยางเก่าแบบเหมาเป็นล็อต */
export const SALES_COLS: SheetCol[] = [
  { key: "item", label: "รายการ", type: "text", width: 170 },
  { key: "date", label: "วันที่ขาย", type: "date", width: 112 },
  { key: "refPrice", label: "ราคากลางยาง (ยานยนต์เป็นผู้หาราคา)", type: "num", width: 130 },
  { key: "qty", label: "จำนวน", type: "num", width: 80 },
  { key: "marketPrice", label: "ราคาตลาดยางเก่า", type: "num", width: 110 },
  { key: "goodQty", label: "โครงยางดี", type: "num", width: 90 },
  { key: "badQty", label: "โครงยางเสีย", type: "num", width: 90 },
  { key: "unitPrice", label: "ราคา/หน่วย", type: "num", width: 90 },
  { key: "lumpPrice", label: "ราคาเหมา", type: "num", width: 100 },
  { key: "total", label: "รวม", type: "num", width: 110 },
]

/**
 * ค่าจาก ATMS ที่จะเติมให้ — เติมเฉพาะช่องที่ยังว่าง (ค่าที่กรอกในชีตชนะเสมอ)
 * ช่องที่กรอกไว้แล้วแต่ไม่ตรง จะขึ้นเป็นคำแนะนำผ่าน atmsHints() แทน
 */
export function atmsFill(r: AnyRow, a: AtmsSnapshot): AnyRow {
  const patch: AnyRow = {}
  const empty = (k: string) => r[k] === null || r[k] === undefined || String(r[k]).trim() === "" || (typeof r[k] === "number" && r[k] === 0 && k !== "seq")
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "" && empty(k)) patch[k] = v }
  put("mrNo", a.mrNo)
  put("bookingDate", a.bookingDate)
  put("driver", a.driver)
  put("plate", a.plate)
  put("mileageBooking", a.mileageBooking)
  put("mileageChange", a.mileageChange)
  put("tyreType", a.tyreType)
  put("price", a.price)
  put("oldSerial", a.oldSerial)
  put("installDate", a.installDate)
  put("mileagePrev", a.mileagePrev)
  put("newSerial", a.newSerial ?? (a.newSerials?.length === 1 ? a.newSerials[0] : undefined))
  return patch
}

export type SheetKind = "rows" | "storage" | "sales"
export const KIND_COLL: Record<SheetKind, string> = { rows: ROWS_COLL, storage: STORAGE_COLL, sales: SALES_COLL }
export const KIND_COLS: Record<SheetKind, SheetCol[]> = { rows: ROW_COLS, storage: STORAGE_COLS, sales: SALES_COLS }
export const isKind = (k: string): k is SheetKind => k === "rows" || k === "storage" || k === "sales"

export type SheetOptions = {
  drivers: string[]
  plates: string[]
  /** ทะเบียน → หัว / หาง (แทน VLOOKUP options!B:C) */
  plateHeadTail: Record<string, string>
  positions: string[]
  tyreTypes: string[]
  storageTypes: string[]
  symptoms: string[]
}
export const EMPTY_OPTIONS: SheetOptions = {
  drivers: [], plates: [], plateHeadTail: {}, positions: [],
  tyreTypes: ["ยางนอก 11R22.5", "ยางนอก 1000-20"],
  storageTypes: ["รอขาย", "ยางรถร่วม", "เก็บสำรอง(A1)", "ส่งเคลม", "นำทำลาย"],
  symptoms: ["ปกติ", "รถกินยาง", "ยางสำรอง", "ยางระเบิด", "ยางติดรถ", "ยางบวม", "ยางฉีก", "ยางปริแตก"],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRow = Record<string, any>

/** ค่าที่ ATMS ให้มาตอนกดดึง — เก็บไว้ในแถวเพื่อโชว์ "แนะนำ" เมื่อค่าที่กรอกไม่ตรง */
export type AtmsSnapshot = {
  at: string
  mrNo: string
  bookingDate?: string
  driver?: string
  plate?: string
  mileageBooking?: number
  /** วันรถเข้าอู่ของใบนี้ = วันเปลี่ยนยางจริง (ชีตไม่มีช่องนี้ เก็บไว้ดูเฉย ๆ) */
  changeDate?: string
  mileageChange?: number
  price?: number
  tyreType?: string
  newSerials?: string[]
  /** จากประวัติยาง ATMS ของตำแหน่งนี้: ยางเส้นเก่า วันที่ใส่ ไมล์ตอนใส่ */
  oldSerial?: string
  installDate?: string
  mileagePrev?: number
  newSerial?: string
}

// ── ตัวเลข / วันที่ ────────────────────────────────────────────────────────────────

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** วันที่เก็บเป็นสตริง "YYYY-MM-DD" (ไม่มีเวลา ไม่มีโซน) */
export function isoDate(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m > 12 || d > 31) return null
  if (y > 2400) y -= 543 // ปี พ.ศ.
  if (y < 100) y += 2000
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** รับ "DD/MM/YYYY" · "D/M/YYYY" · "YYYY-MM-DD" · Date → "YYYY-MM-DD" (วัน/เดือน แบบไทยเสมอ) */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) return isoDate(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return isoDate(+m[1], +m[2], +m[3])
  return null
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (แบบที่ชีตโชว์) */
export function fmtDate(iso: unknown): string {
  const s = String(iso ?? "")
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

/** อายุ ปี/เดือน/วัน จาก a ถึง b (ตรรกะเดียวกับ expire_cal ใน Apps Script เดิม) */
export function ageYmd(fromIso: string | null | undefined, toIso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!fromIso || !toIso) return null
  const [y1, m1, d1] = fromIso.split("-").map(Number)
  const [y2, m2, d2] = toIso.split("-").map(Number)
  if (!y1 || !y2) return null
  let y = y2 - y1, m = m2 - m1, d = d2 - d1
  if (d < 0) {
    m--
    d += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate()
  }
  if (m < 0) { y--; m += 12 }
  if (y < 0) return null
  return { y, m, d }
}

export const fmtAge = (a: { y: number; m: number; d: number } | null) => (a ? `${a.y} ปี ${a.m} เดือน ${a.d} วัน` : "-")

// ── เบอร์ยาง ────────────────────────────────────────────────────────────────────

/**
 * กุญแจต่อชีวิตยาง: ตัวแรกก่อนช่องว่าง ตัวพิมพ์ใหญ่
 *   "L4212A3094 NGR-AZ670"  → "L4212A3094"
 *   "L4212A3094 A1-72-8509" → "L4212A3094"  (ยางเส้นเดิม เก็บสำรองช่อง A1 จากรถ 72-8509)
 * ส่วนท้ายยังเก็บไว้ในช่องเดิมตามที่กรอก ไม่แก้
 */
export function serialKey(s: unknown): string {
  const t = String(s ?? "").trim().toUpperCase()
  if (!t) return ""
  return t.split(/\s+/)[0]
}

// ── ช่องที่ระบบคิดให้ (เดิมเป็นสูตร / พิมพ์มือในชีต) ──────────────────────────────────

/** ผลต่างเลขไมล์ = สูตรเดิม IF(M>=L, M-L, M+(999999-L)) */
export function mileageDiff(prev: unknown, cur: unknown): number | null {
  const a = toNum(prev), b = toNum(cur)
  if (b === null || b === 0) return null
  const p = a ?? 0
  return b >= p ? b - p : b + (999999 - p)
}

/** คิดช่องสูตรทั้งหมดของแถว — ถ้าข้อมูลไม่พอ ใช้ค่าที่นำเข้าจากชีตแทน (ไม่ทิ้งค่าเดิม) */
export function computeRow(r: AnyRow, opts?: Pick<SheetOptions, "plateHeadTail">): AnyRow {
  const out: AnyRow = { ...r }
  const diff = mileageDiff(r.mileagePrev, r.mileageBooking)
  out.mileageDiff = diff ?? toNum(r.mileageDiff)
  out.mileageDiffChange = mileageDiff(r.mileagePrev, r.mileageChange) ?? toNum(r.mileageDiffChange)

  const price = toNum(r.price)
  const d = toNum(out.mileageDiff)
  out.bpk = price !== null && d ? price / d : toNum(r.bpk)

  const age = ageYmd(r.installDate, r.bookingDate)
  if (age) { out.ageY = age.y; out.ageM = age.m; out.ageD = age.d }

  const full = toNum(r.fullDepth), cur = toNum(r.depthBooking), rated = toNum(r.ratedKm)
  out.depthUsed = full !== null && cur !== null ? full - cur : toNum(r.depthUsed)
  const used = toNum(out.depthUsed)
  out.expectedKm = rated !== null && full && used !== null ? (rated / full) * used : toNum(r.expectedKm)
  const exp = toNum(out.expectedKm)
  out.summary = d && exp ? d / exp : toNum(r.summary)

  const ht = opts?.plateHeadTail?.[String(r.plate ?? "").trim()]
  out.headTail = ht || r.headTail || ""
  return out
}

/** เทียบค่าที่กรอกกับ ATMS — คืนรายการช่องที่ไม่ตรง (ใช้โชว์คำแนะนำ ไม่แก้ทับเอง) */
export function atmsHints(r: AnyRow): { key: string; label: string; atms: string }[] {
  const a = r.atms as AtmsSnapshot | undefined
  if (!a) return []
  const hints: { key: string; label: string; atms: string }[] = []
  const num = (k: keyof AtmsSnapshot, label: string) => {
    const av = toNum(a[k]); const rv = toNum(r[k])
    if (av !== null && av !== 0 && rv !== null && rv !== av) hints.push({ key: k, label, atms: av.toLocaleString("th-TH") })
  }
  const str = (k: keyof AtmsSnapshot, label: string, fmt: (v: string) => string = (v) => v) => {
    const av = String(a[k] ?? "").trim(); const rv = String(r[k] ?? "").trim()
    if (av && rv && av !== rv) hints.push({ key: k, label, atms: fmt(av) })
  }
  num("price", "ราคา")
  num("mileageBooking", "เลขไมล์วันจอง")
  num("mileageChange", "เลขไมล์วันเปลี่ยนยาง")
  num("mileagePrev", "เลขไมล์เดิม")
  str("plate", "ทะเบียน")
  str("bookingDate", "วันที่จอง", fmtDate)
  str("installDate", "วันที่เปลี่ยนยางใหม่", fmtDate)
  const ak = serialKey(a.oldSerial), rk = serialKey(r.oldSerial)
  if (ak && rk && ak !== rk) hints.push({ key: "oldSerial", label: "เบอร์ยางเก่า", atms: String(a.oldSerial) })
  return hints
}

/** เก็บเฉพาะช่องที่รู้จัก แปลงชนิดให้ถูก (กันคนยิงฟิลด์แปลก ๆ เข้ามา) */
export function cleanFields(kind: SheetKind, input: AnyRow): AnyRow {
  const cols = KIND_COLS[kind]
  const out: AnyRow = {}
  for (const c of cols) {
    if (c.computed && !(kind === "rows" && c.key === "seq")) continue
    if (!(c.key in input)) continue
    const v = input[c.key]
    if (c.type === "num") out[c.key] = toNum(v)
    else if (c.type === "date") out[c.key] = parseDate(v)
    else out[c.key] = v === null || v === undefined ? "" : String(v).trim()
  }
  return out
}

// ── ยางหลายชีวิต (สำหรับ PDF) ──────────────────────────────────────────────────────

export type Life = {
  id: string
  bookingDate: string | null
  plate: string
  position: string
  mrNo: string
  oldSerial: string
  km: number | null
  depthFrom: number | null
  depthTo: number | null
  symptom: string
  spare: string
  storageType: string
  price: number | null
  ratedKm: number | null
  isCurrent: boolean
}

export const SPARE_SYMPTOM = "ยางสำรอง"

/** แถว → ชีวิตหนึ่งรอบ · "ยางสำรอง" ไม่นับเป็นอาการ แยกไปช่องใช้เป็นยางสำรอง */
export function toLife(r: AnyRow, isCurrent: boolean): Life {
  const c = computeRow(r)
  const symptom = String(r.symptom ?? "").trim()
  const storageType = String(r.storageType ?? "").trim()
  const spare = symptom === SPARE_SYMPTOM ? "ใช้เป็นยางสำรอง" : storageType.includes("สำรอง") ? storageType : ""
  return {
    id: String(r._id ?? ""),
    bookingDate: r.bookingDate ?? null,
    plate: String(r.plate ?? ""),
    position: String(r.position ?? ""),
    mrNo: String(r.mrNo ?? ""),
    oldSerial: String(r.oldSerial ?? ""),
    km: toNum(c.mileageDiff),
    depthFrom: toNum(r.fullDepth),
    depthTo: toNum(r.depthBooking),
    symptom: symptom === SPARE_SYMPTOM ? "" : symptom,
    spare,
    storageType,
    price: toNum(r.price),
    ratedKm: toNum(r.ratedKm),
    isCurrent,
  }
}

export type LifeSummary = {
  lives: Life[]
  totalKm: number | null
  price: number | null
  ratedKm: number | null
  cpkTotal: number | null
  cpkStandard: number | null
  cpkLatest: number | null
  pctOfRated: number | null
  depthUsedTotal: number | null
  fullDepth: number | null
}

/**
 * รวมทุกชีวิตของยางเส้นเดียว (เรียงเก่า → ใหม่ ชีวิตสุดท้าย = รอบนี้)
 *   CPK รวม     = ราคา ÷ ระยะรวมทุกชีวิต
 *   CPK มาตรฐาน = ราคา ÷ ระยะกำหนด (ของชีวิตแรก = ตอนเป็นยางใหม่)
 *   ราคานับครั้งเดียว ไม่บวกซ้ำทุกชีวิต
 */
export function summarizeLives(lives: Life[]): LifeSummary {
  const kms = lives.map((l) => l.km).filter((k): k is number => k !== null && k > 0)
  const totalKm = kms.length ? kms.reduce((a, b) => a + b, 0) : null
  const cur = lives[lives.length - 1]
  const price = cur?.price && cur.price > 1 ? cur.price : (lives.find((l) => l.price && l.price > 1)?.price ?? null)
  const ratedKm = lives.find((l) => l.ratedKm && l.ratedKm > 0)?.ratedKm ?? null
  const used = lives
    .map((l) => (l.depthFrom !== null && l.depthTo !== null ? l.depthFrom - l.depthTo : null))
    .filter((x): x is number => x !== null && x >= 0)
  return {
    lives,
    totalKm,
    price,
    ratedKm,
    cpkTotal: price && totalKm ? price / totalKm : null,
    cpkStandard: price && ratedKm ? price / ratedKm : null,
    cpkLatest: price && cur?.km ? price / cur.km : null,
    pctOfRated: totalKm && ratedKm ? totalKm / ratedKm : null,
    depthUsedTotal: used.length ? used.reduce((a, b) => a + b, 0) : null,
    fullDepth: lives[0]?.depthFrom ?? null,
  }
}
