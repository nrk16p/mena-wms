// เกณฑ์ "ยางถึงกำหนดเปลี่ยน" — ฝั่ง cron ที่คำนวณ และฝั่งหน้าเว็บที่แสดงผล อ่านไฟล์นี้ตัวเดียวกัน
// แก้เกณฑ์ที่นี่ที่เดียวแล้วมีผลทั้งระบบ อย่าไป hardcode ซ้ำที่อื่น

import { splitPosition } from "@/lib/tire"

export const DUE_OVER = 100 // ใช้ระยะครบแล้ว
export const DUE_DUE  = 90  // ถึงกำหนดเปลี่ยน — เกณฑ์แจ้งเตือนหลัก
export const DUE_WARN = 80  // เฝ้าระวัง เริ่มวางแผนได้

/** ตัวเลือกระยะเวลาพักการแจ้งเตือน — ใช้ชุดเดียวกันทั้งเว็บและแอปคนขับ */
export const SNOOZE_OPTIONS = [
  { days:  7, label: "1 สัปดาห์" },
  { days: 14, label: "2 สัปดาห์" },
  { days: 30, label: "1 เดือน" },
] as const

/** ค่าเริ่มต้นเมื่อไม่ได้ระบุ */
export const SNOOZE_DAYS = 14

/** รับเฉพาะค่าที่อยู่ในตัวเลือก — กันแอปส่งเลขมั่วมาแล้วยางเงียบไปเป็นปี */
export function snoozeDays(input: unknown): number {
  const n = Number(input)
  return SNOOZE_OPTIONS.some((o) => o.days === n) ? n : SNOOZE_DAYS
}

export type DueLevel = "over" | "due" | "warn" | "ok" | "unknown"

export function dueLevel(usedPct: number | null | undefined): DueLevel {
  if (usedPct == null || !isFinite(usedPct)) return "unknown"
  if (usedPct >= DUE_OVER) return "over"
  if (usedPct >= DUE_DUE)  return "due"
  if (usedPct >= DUE_WARN) return "warn"
  return "ok"
}

// ระดับที่ถือว่า "ต้องทำอะไรสักอย่าง" — ใช้เป็นตัวนับ badge บนแท็บ
export const ALERT_LEVELS: DueLevel[] = ["over", "due"]

export const DUE_LABEL: Record<DueLevel, string> = {
  over:    "เกินกำหนด",
  due:     "ถึงกำหนดเปลี่ยน",
  warn:    "เฝ้าระวัง",
  ok:      "ปกติ",
  unknown: "คำนวณไม่ได้",
}

export const dueChipCls: Record<DueLevel, string> = {
  over:    "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  due:     "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  warn:    "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  ok:      "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  unknown: "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400",
}

export const dueBarCls: Record<DueLevel, string> = {
  over: "bg-red-500", due: "bg-orange-500", warn: "bg-amber-500", ok: "bg-green-500", unknown: "bg-gray-300",
}

// คำสั้นสำหรับปุ่มล้อบนโครงรถ — ป้ายเต็ม (DUE_LABEL) ยาวเกินช่องกว้าง ~46px
// ต้องตรงกับ DUE_LEVELS[].wheel ในแอปคนขับ (mena-go-lb / mena-go-srb)
export const DUE_WHEEL: Record<DueLevel, string> = {
  over: "เกินรอบ", due: "ถึงรอบ", warn: "ใกล้รอบ", ok: "ปกติ", unknown: "ไม่มีข้อมูล",
}

// สีล้อบนโครงรถ — ชุดเดียวกับ DUE_LEVELS[].gradient ในแอปคนขับ
export const dueGradientCls: Record<DueLevel, string> = {
  over:    "from-red-500/95 to-transparent",
  due:     "from-orange-500/95 to-transparent",
  warn:    "from-amber-500/90 to-transparent",
  ok:      "from-green-500/90 to-transparent",
  unknown: "from-gray-500/70 to-transparent",
}

// สีตัวเลข % บนปุ่มล้อ (พื้นขาว ต้องใช้ hex ไม่ใช่ class เพราะอยู่ใน style)
export const dueHex: Record<DueLevel, string> = {
  over: "#dc2626", due: "#ea580c", warn: "#ca8a04", ok: "#16a34a", unknown: "#6b7280",
}

export type DistanceSource = "gps" | "trip" | "none"

export const SOURCE_LABEL: Record<DistanceSource, string> = {
  gps: "GPS", trip: "ค่าเที่ยว", none: "—",
}

// ── ทะเบียน ────────────────────────────────────────────────────────────────
// ฝั่งยาง/ค่าเที่ยวเก็บเป็น "สบ.71-8645" แต่ GPS เก็บเป็น "71-8645"
// และมีขยะปนมาแบบ "70-6293 (แจ้งยกเลิก26.06.2026)" — ตัดทิ้งทั้งคู่ก่อนจับคู่
export function normalizePlateForGps(plate: string | null | undefined): string {
  return String(plate ?? "")
    .replace(/\(.*?\)/g, "")
    .replace(/^[ก-ฮ]{1,3}\.?\s*/, "")
    .replace(/\s+/g, "")
    .trim()
}

// ทะเบียนที่ไม่ต้องติดตามในแท็บนี้ — รถยนต์/กระบะที่ไม่ได้อยู่ในงานขนส่ง
// ยางพวกนี้ไม่ได้อยู่ในแผนเปลี่ยนของฝ่ายซ่อมบำรุง (ผู้ใช้สั่งตัดทั้งชุด 2026-09-14)
//
// เก็บเป็นรายทะเบียน ไม่ใช่กฎรูปแบบทะเบียน เพราะรถ 4 ล้อจัมโบ้ตู้แห้ง (3ฒณ-1052…1056)
// ใช้ยางขนาดรถยนต์เหมือนกันแต่เป็นรถในฟลีต ต้องติดตามต่อ — กฎเหมาจะตัดทิ้งไปด้วย
//
// เทียบแบบตัดช่องว่างทิ้ง เพราะ ATMS คีย์ทั้ง "กว 4507", "กธ2607" และ "กท-8258" ปนกัน
const IGNORED_PLATES = new Set([
  "ณย5251", "กธ9215", "บร8747", "บธ5392", "ฮง2710", "บร4492", "กม9654", "บล3759",
  "กว4507", "กว4506", "บธ7904", "บร8748", "กน9364", "บล3760", "กธ2607", "กน9363",
  "บร8751", "บร8750", "บน9004", "บน4080", "บบ9765", "ปข4603",
  "กท-8258",
  // รถที่ไม่มีข้อมูลระยะทางเลยและไม่มีใน vehicle_master (ผู้ใช้สั่งตัด 2026-09-15)
  "53-5034", "53-5039", "53-5041",
  "62-3382", "62-3384", "62-3386", "62-5691", "62-5692", "62-5693",
])

export const isIgnoredPlate = (plate: string | null | undefined): boolean =>
  IGNORED_PLATES.has(String(plate ?? "").replace(/\s+/g, "").trim())

// ── ชื่อสินค้า ──────────────────────────────────────────────────────────────
// ชื่อยางจาก ATMS เขียนไม่นิ่ง ("P.1000.20" / "P.1000-20" / "1000 - 20")
// ตัดช่องว่าง จุด ขีด ออกให้หมดก่อนจับคู่กับ tire_spec_master
export function normalizeProductKey(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[\s.\-/_]/g, "").trim()
}

// ── ระยะทางรายเดือน ────────────────────────────────────────────────────────
export const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`

export function monthRange(from: Date, to: Date): string[] {
  const out: string[] = []
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1)
  while (cur.getTime() <= end) {
    out.push(monthKey(cur))
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return out
}

// รวมระยะทางตั้งแต่ `from` ถึง `through` จากยอด "รายเดือน"
//
// ทำไมไม่ใช้รายวัน: ยางแต่ละเส้นเริ่มนับคนละวัน (พันกว่าคู่ ทะเบียน×วันเปลี่ยนเข้า)
// ถ้าถาม GPS ทีละคู่คือพันกว่า request ต่อรอบ — ดึงยอดรายเดือนทั้งกองเดือนละครั้งแล้วเฉลี่ยเอา
//
// แต่ละเดือนคิดสัดส่วน overlap ÷ elapsed ไม่ใช่ overlap ÷ จำนวนวันทั้งเดือน
// เพราะยอดของ "เดือนปัจจุบัน" คือยอดเท่าที่วิ่งมาถึงวันนี้ ไม่ใช่ยอดทั้งเดือน
// ถ้าหารด้วยจำนวนวันทั้งเดือนจะได้ค่าต่ำกว่าจริงทุกครั้งที่ยางเพิ่งเปลี่ยนในเดือนนี้
export function sumMonthlyDistance(monthly: Map<string, number>, from: Date, through: Date): number {
  if (!(from instanceof Date) || isNaN(from.getTime())) return 0
  if (through.getTime() <= from.getTime()) return 0

  let total = 0
  for (const key of monthRange(from, through)) {
    const km = monthly.get(key)
    if (!km) continue
    const [y, m] = key.split("-").map(Number)
    const monthStart = Date.UTC(y, m - 1, 1)
    const monthEnd   = Date.UTC(y, m, 1)
    const elapsed = Math.min(monthEnd, through.getTime()) - monthStart
    const overlap = Math.min(monthEnd, through.getTime()) - Math.max(monthStart, from.getTime())
    if (elapsed <= 0 || overlap <= 0) continue
    total += km * Math.min(1, overlap / elapsed)
  }
  return Math.round(total)
}

// เรียงยางตามตำแหน่งจริงบนรถ หน้า → หลัง → หาง (F1 F2 · RA1…RA8 · RB1…RB13)
// ไม่เรียงตาม % เพราะเวลาเดินดูรถหรือสั่งงานช่าง คนไล่ทีละเพลา ไม่ได้ไล่ตามตัวเลข
const AXLE_ORDER: Record<string, number> = { F: 0, RA: 1, RB: 2 }

export function positionOrder(tirePosition: string): number {
  const { code } = splitPosition(tirePosition)
  const m = code.match(/^([A-Z]+)(\d+)$/)
  if (!m) return 9_999
  return (AXLE_ORDER[m[1]] ?? 8) * 100 + Number(m[2])
}

// ล้อหน้าเป็นล้อบังคับเลี้ยว สึกเร็วกว่าล้อหลังราวเท่าตัว — ระยะกำหนดของฟลีตจึงแยกหน้า/หลัง
// (ผ้าใบ 1000-20 ที่ลาดกระบัง: ล้อหน้า 20,000 กม. · ล้อหลัง 40,000 กม.)
export const isFrontTire = (tirePosition: string): boolean =>
  /^F\s*\d/i.test(String(tirePosition ?? "").trim())

// ยางอะไหล่ยังไม่ได้แตะถนน — ถ้าปล่อยเข้าสูตรจะโดนคิดระยะเท่ากับล้อที่วิ่งจริง
// แล้วขึ้นเตือน "เกินกำหนด" ทั้งที่ยางยังใหม่ (พบ 38 เส้นตอนรันรอบแรก)
export const isSpareTire = (tirePosition: string): boolean =>
  /^RB\s*13\b/i.test(String(tirePosition ?? "").trim()) || String(tirePosition ?? "").includes("อะไหล่")

// ATMS บันทึกงานที่ไม่ใช่ "ยาง 1 เส้น" ปนมาในช่องชื่อสินค้าเดียวกัน — ไม่ต้องเอาเข้าระบบเตือน
export const isNotATire = (product: string): boolean =>
  /ยางรองคอ|ถอดแกะยาง/.test(String(product ?? ""))

// ยางหาง (รหัส RB หรือชื่อตำแหน่งมีคำว่า "หาง") ต้องใช้ระยะของทะเบียนหาง ไม่ใช่ของหัวรถ
export const isTrailerUnit = (tirePosition: string): boolean =>
  /^RB/i.test(String(tirePosition ?? "").trim()) || String(tirePosition ?? "").includes("หาง")
