// สถานะงานซ่อมอู่นอก — workflow 7 ขั้น (เรียงตามลำดับการทำงาน)
export type RepairStatus = {
  value: string
  emoji: string
  cls: string  // tailwind chip (light + dark)
}

export const REPAIR_STATUSES: RepairStatus[] = [
  { value: "รอประเมินการซ่อม",         emoji: "⏳", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300" },
  { value: "รถเข้าอู่ซ่อม",     emoji: "🔧", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  // "รอใบเสนอราคา" ถูกถอดจาก workflow อู่นอก (2026-08-11) → เป็น tickbox waitingQuote แทน (ยังเป็นสถานะของอะไหล่ลงคันอยู่)
  { value: "รอ PR",        emoji: "⏰", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "ซ่อมไม่มีกำหนด",    emoji: "🛠️", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "ซ่อมมีกำหนดเสร็จ",  emoji: "✅", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  { value: "รถเสร็จ(ไม่มี PR)", emoji: "🏁", cls: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300" },
  { value: "รถเสร็จ",          emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
]

export const REPAIR_STATUS_VALUES = REPAIR_STATUSES.map((s) => s.value)

/** ชื่อสถานะเดิมที่เปลี่ยนไปแล้ว → ชื่อปัจจุบัน
 *  2026-08-20: "รอรถเข้า" → "รอประเมินการซ่อม" ให้ตรงกับสถานะฝั่ง Mena-Next
 *  คงไว้เพื่อ (1) เอกสารเก่าที่ยังไม่ถูก migrate แสดงผลถูก (2) ทีมภายนอกที่ยังส่งค่าเดิม
 *  เข้ามาทาง sync API ไม่โดน 400 — ถอดออกได้เมื่อมั่นใจว่าไม่มีใครส่งค่าเก่าแล้ว */
export const STATUS_ALIASES: Record<string, string> = {
  "รอรถเข้า": "รอประเมินการซ่อม",
}
export const normalizeStatus = (s: string) => {
  const t = (s ?? "").trim()
  return STATUS_ALIASES[t] ?? t
}

// สถานะ "รถเสร็จ" = ปิดงาน — แยกไปหน้า "รถซ่อมเสร็จ" ส่วนที่เหลือคือ "รถซ่อมอู่นอก"
export const REPAIR_DONE_STATUS = "รถเสร็จ"

// ── ประเภทงาน: อู่นอก (ซ่อมอู่ภายนอก) | อะไหล่ลงคัน (สั่งซื้ออะไหล่มาลงคัน) ──
// เอกสารเก่าที่ไม่มี field jobType = อู่นอก
export const JOB_TYPE_GARAGE = "อู่นอก"
export const JOB_TYPE_PARTS  = "อะไหล่ลงคัน"
export const JOB_TYPES = [JOB_TYPE_GARAGE, JOB_TYPE_PARTS]

export const jobTypeOf = (r: { jobType?: string }) =>
  r.jobType === JOB_TYPE_PARTS ? JOB_TYPE_PARTS : JOB_TYPE_GARAGE

// workflow อะไหล่ลงคัน 6 ขั้น — "รอใบเสนอราคา"/"รอ PR" ใช้ชื่อร่วมกับอู่นอก
export const PARTS_STATUSES: RepairStatus[] = [
  { value: "รอดำเนินการ",      emoji: "⏳", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300" },
  { value: "รอใบเสนอราคา",     emoji: "🔍", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  { value: "รอ PR",        emoji: "⏰", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "สั่งซื้อแล้ว-รอของ", emoji: "📦", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "ของถึง-รอลงคัน",   emoji: "🔩", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  { value: "ลงคันเสร็จ",       emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
]

export const PARTS_DONE_STATUS = "ลงคันเสร็จ"

// สถานะปิดงานของทั้ง 2 ประเภท — ใช้แยก active/done ทุกจุด (list, stats, sync, กันซ้ำ)
export const DONE_STATUSES = [REPAIR_DONE_STATUS, PARTS_DONE_STATUS]
export const isDoneStatus = (s: string) => DONE_STATUSES.includes(s)

/**
 * วันเริ่มนับอายุงาน = วันที่เร็วที่สุดระหว่าง "วันรับแจ้ง" กับ "วันรถเข้าอู่"
 * รายการที่คีย์ย้อนหลัง (นำงานเก่าเข้าระบบ) จะมี receivedDate = วันที่คีย์ ซึ่งช้ากว่าวันรถเข้าอู่จริง
 * ถ้านับจาก receivedDate อย่างเดียว อายุงานจะต่ำกว่าความจริงมาก (เคยเจอโชว์ 6 วัน ทั้งที่จอดจริง 111 วัน)
 */
export const jobStartDate = (r: { receivedDate?: string; garageInDate?: string }): string => {
  const rc = (r.receivedDate ?? "").trim()
  const gi = (r.garageInDate ?? "").trim()
  if (!rc) return gi
  if (!gi) return rc
  return gi < rc ? gi : rc
}

/**
 * ชื่อย่อของอู่สำหรับเทียบว่าเป็นอู่เดียวกันไหม — ตัดคำนำหน้านิติบุคคล/คำว่าอู่-ช่าง และวงเล็บ
 * คืนได้หลายค่า: ชื่อหลัก + ชื่อในวงเล็บ (เช่น "เอ็มดีทรานสปอร์ต (อู่ช่างเมฆ)" → เอ็มดีทรานสปอร์ต, เมฆ)
 */
export function garageAliases(name: string): string[] {
  const out = new Set<string>()
  const paren = name.match(/\(([^)]+)\)/)?.[1]
  for (const raw of [name.replace(/\([^)]*\)/g, ""), paren ?? ""]) {
    let t = raw.replace(/[\s.·\-—()]/g, "")
    if (!t) continue
    t = t.replace(/^(บริษัท|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|หจก|นางสาว|นาย|นาง|นส|ร้าน)/, "")
    t = t.replace(/(จำกัด|จํากัด|มหาชน)+$/, "")
    t = t.replace(/^อู่/, "").replace(/^ช่าง/, "")
    // ตัดคำต่อท้ายที่ไม่ได้แยกตัวตนอู่ — "ช่างกี้" กับ "ช่างกี้ เซอร์วิส" คืออู่เดียวกัน
    t = t.replace(/(เซอร์วิส|การช่าง|บริการ|ยนต์)+$/, "")
    if (t.length >= 3) out.add(t)
  }
  return [...out]
}

/** จัดกลุ่มชื่ออู่ที่น่าจะเป็นอู่เดียวกัน — คืนเฉพาะกลุ่มที่มีมากกว่า 1 ชื่อ */
export function groupSimilarGarages(names: string[]): string[][] {
  const alias = new Map(names.map((n) => [n, garageAliases(n)] as const))
  // ชื่อ A กับ B เป็นกลุ่มเดียวกันเมื่อ alias ตรงกันเป๊ะ หรือ alias หนึ่งเป็นคำขึ้นต้นของอีกอัน (ยาว ≥ 6 กันจับมั่ว)
  const related = (a: string, b: string) =>
    (alias.get(a) ?? []).some((x) =>
      (alias.get(b) ?? []).some((y) => x === y || (x.length >= 6 && y.startsWith(x)) || (y.length >= 6 && x.startsWith(y))))
  const groups: string[][] = []
  const used = new Set<string>()
  for (const n of names) {
    if (used.has(n)) continue
    const fam = names.filter((m) => !used.has(m) && (m === n || related(n, m)))
    fam.forEach((m) => used.add(m))
    if (fam.length > 1) groups.push(fam)
  }
  return groups
}

export const statusesFor   = (jobType: string) => (jobType === JOB_TYPE_PARTS ? PARTS_STATUSES : REPAIR_STATUSES)
export const doneStatusFor = (jobType: string) => (jobType === JOB_TYPE_PARTS ? PARTS_DONE_STATUS : REPAIR_DONE_STATUS)

// ชื่อสถานะซ้ำกันระหว่าง 2 workflow ให้ meta ของอู่นอกชนะ (ความหมายเดียวกัน)
const STATUS_MAP = new Map([...PARTS_STATUSES, ...REPAIR_STATUSES].map((s) => [s.value, s] as const))

export function statusMeta(rawValue: string): RepairStatus {
  // แปลงชื่อเก่าก่อน — เอกสารที่ยังไม่ migrate จะได้ไม่ตกไปที่ fallback
  const value = normalizeStatus(rawValue)
  return (
    STATUS_MAP.get(value) ?? {
      value: value || "—",
      emoji: "",
      cls: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400",
    }
  )
}

// ตัวเลือกระยะรับประกัน (dropdown) — เรียงจากสั้น→ยาว
export const WARRANTY_OPTIONS = [
  "ไม่รับประกัน",
  "3 วัน",
  "7 วัน",
  "15 วัน",
  "30 วัน",
  "1 เดือน",
  "2 เดือน",
  "3 เดือน",
  "6 เดือน",
  "1 ปี",
  "2 ปี",
]

// รูปแบบเอกสารฝั่ง repair-external ที่เก็บใน Mongo
export type RepairExternal = {
  _id:          string
  jobType?:     string  // "อู่นอก" | "อะไหล่ลงคัน" (ไม่มี field = อู่นอก)
  receivedDate: string  // YYYY-MM-DD  วันที่รับแจ้ง
  garageInDate: string  // YYYY-MM-DD  วันที่รถเข้าอู่ซ่อม
  dueDate:      string  // YYYY-MM-DD  วันกำหนดเสร็จ (คาดว่าเสร็จ)
  completedDate:string  // YYYY-MM-DD  วันที่ซ่อมเสร็จ (จริง)
  mrNo:         string  // เลขใบแจ้งซ่อม MR
  symptom:      string  // รายละเอียดอาการ
  plate:        string  // ทะเบียนรถ
  fleetNo:      string  // เบอร์รถ
  driverName:   string  // ชื่อคนขับ
  driverPhone:  string  // เบอร์โทรคนขับ
  breakdownLocation: string  // พิกัดที่รถเสีย (ลิงก์แผนที่ / lat,long / คำอธิบาย)
  cementStatus: string  // สถานะปูนในโม่: "" | "มีปูน" | "ไม่มีปูน"
  drivableStatus: string  // สภาพรถ: "" | "วิ่งได้" | "วิ่งไม่ได้"
  fleet:        string  // ฟลีท (auto จาก atms.vehicle_daily)
  plant:        string  // แพล้นท์ (auto จาก atms.vehicle_daily)
  garage:       string  // อู่
  status:       string  // สถานะ
  waitingQuote: string  // "" | "รอใบเสนอราคา" — tickbox แทนสถานะเดิม (เฉพาะอู่นอก) แสดง badge เมื่อติ๊ก
  lastCheckedAt?:  string  // ISO — เวลายืนยันตรวจเช็คประจำวันล่าสุด (ไม่อยู่ใน buildDoc — เขียนผ่าน /check เท่านั้น)
  lastCheckedBy?:  string
  lastCheckedByEmail?: string
  dailyChecks?: { date: string; by: string; at: string }[]  // ประวัติเช็ครายวัน (date = YYYY-MM-DD เวลาไทย) — ใช้วาดปฏิทิน
  prCode:       string  // รหัส PR
  poCode:       string  // รหัส PO
  note:         string  // หมายเหตุ
  repairPrice:  number  // ราคาซ่อม
  warranty:     string  // รับประกัน
  negotiationScope: string      // ขอบเขตต่อรอง: "ทั้งหมด" | "ระบุสินค้า/บริการ"
  negotiationItem:  string      // สินค้า/บริการที่ต่อรอง (เมื่อเลือก "ระบุสินค้า/บริการ")
  offerPrice:      number       // ราคาเสนอครั้งแรก (ก่อนต่อรอง)
  negotiatedPrice: number       // ราคาต่อรอง (หลังต่อรอง)
  offerWarranty:   string       // ประกันเสนอครั้งแรก
  negotiationImages?: RepairImage[] // ไฟล์หลักฐานการต่อรอง
  quotationDetail: string           // รายละเอียดใบเสนอราคา (free text)
  quotationImages?: RepairImage[]   // ไฟล์ใบเสนอราคา (PDF/รูป)
  statusSince:  string  // YYYY-MM-DD วันที่เข้าสู่สถานะปัจจุบัน (ระบบตั้งเมื่อเปลี่ยนสถานะ)
  statusSinceAt?: string // ISO datetime เวลาที่เข้าสถานะ (สำหรับ SLA รายชั่วโมง เช่น รอ PR 24 ชม.)
  createdBy?:   string  // ผู้สร้าง (ระบบตั้งจาก session)
  editedBy?:    string  // ผู้แก้ไขล่าสุด (ระบบตั้งจาก session)
  images?:      RepairImage[] // ไฟล์แนบ (รูป/เอกสาร)
}

// อ้างอิงไฟล์แนบ (ตามรูปแบบ SkuImage ของ lib/media)
export type RepairImage = {
  mediaId:      number
  batchId:      string
  filename:     string
  webpUrl:      string
  thumbnailUrl: string
}

// SLA (2026-08-08: ตัดกฎ 2 วันของทุกสถานะออก) — เหลือกฎเดียว:
// "รอ PR" ค้างได้ไม่เกิน 24 ชั่วโมง นับจากเวลาที่เข้าสถานะ (statusSinceAt)
// ค่าในนี้ = จำนวนวัน (1 = 24 ชม.) · สถานะอื่นไม่จำกัด · "ซ่อมเกินกำหนด" ดูจาก dueDate แยกต่างหาก
export const REPAIR_STATUS_SLA_DAYS: Record<string, number> = {
  "รอ PR": 1,
}

// (เลิกใช้แล้ว — คงไว้กัน import พัง) สถานะที่วัด SLA จาก dueDate
export const REPAIR_SLA_FROM_DUE = new Set<string>([])

// คำอธิบาย SLA สำหรับแสดงบน UI
export const REPAIR_SLA_NOTE =
  "สถานะ \"รอ PR\" ค้างได้ไม่เกิน 24 ชั่วโมงนับจากเวลาที่เข้าสถานะ · สถานะอื่นไม่จำกัดเวลา · รายการเลยวันกำหนดเสร็จดูที่ป้าย \"เลยกำหนด\""

export type RepairField = keyof Omit<RepairExternal, "_id">

// ฟิลด์ที่ "ต้องกรอก" เมื่อเลือกสถานะนั้น (workflow-driven) — ใช้ทั้ง validate และ hint บน UI
export const REPAIR_STATUS_REQUIRED_FIELD: Record<string, { field: RepairField; label: string }> = {
  "รถเข้าอู่ซ่อม":    { field: "garageInDate",  label: "วันที่รถเข้าซ่อม" },
  // รอใบเสนอราคา: PR ไม่บังคับ (ยังไม่มี PR ก็ได้)
  "รอ PR":        { field: "poCode",        label: "รหัส PO" },
  "ซ่อมมีกำหนดเสร็จ": { field: "dueDate",       label: "วันกำหนดเสร็จ" },
  "รถเสร็จ(ไม่มี PR)": { field: "completedDate", label: "วันที่ซ่อมเสร็จ" },
  "รถเสร็จ":          { field: "prCode",        label: "รหัส PR" },  // ปิดงานสมบูรณ์ต้องมี PR (completedDate สะสมมาจากขั้นก่อน)
  // อะไหล่ลงคัน
  "สั่งซื้อแล้ว-รอของ": { field: "dueDate",        label: "กำหนดของถึง" },
  "ลงคันเสร็จ":        { field: "completedDate",  label: "วันที่ลงคันเสร็จ" },
}

// สถานะปลายทาง (ปิดงาน) — ห้ามย้อนสถานะกลับเมื่อถึงสถานะนี้แล้ว (ต่อประเภทดู doneStatusFor/isDoneStatus)
export const REPAIR_LOCKED_STATUS = "รถเสร็จ"

// ฟิลด์ที่ต้องกรอก "สะสม" ถึงสถานะเป้าหมาย — รวมของทุกสถานะก่อนหน้าใน workflow ของประเภทนั้น
// (ข้ามสถานะได้ก็ต่อเมื่อกรอกข้อมูลของสถานะที่ข้ามครบ)
export function requiredFieldsFor(status: string, jobType: string = JOB_TYPE_GARAGE): { field: RepairField; label: string }[] {
  const flow = statusesFor(jobType)
  const idx  = flow.findIndex((s) => s.value === status)
  if (idx < 0) return []
  const out: { field: RepairField; label: string }[] = []
  for (let i = 0; i <= idx; i++) {
    const req = REPAIR_STATUS_REQUIRED_FIELD[flow[i].value]
    if (req) out.push(req)
  }
  return out
}

// ── สรุปใบแจ้งซ่อมสำหรับส่งกลุ่มไลน์ ─────────────────────────────────
// ใช้อิโมจิจริง ไม่ใช่ shortcode แบบ (car)/(sun) — shortcode พวกนั้นคือสิ่งที่ LINE
// แปลงออกมาตอนก็อปข้อความ ถ้าส่งกลับเข้าไปดิบ ๆ บางที่จะเห็นเป็นวงเล็บแทนรูป
// ช่องไหนว่าง = ตัดทั้งบรรทัดทิ้ง ไม่ปล่อยหัวข้อลอย ๆ เข้ากลุ่ม เช่น "☀️ เบอร์ "
export type RepairSummaryInput = {
  fleetNo?:        string
  brand?:          string   // ไม่ได้เก็บในใบแจ้งซ่อม — ผู้เรียกดึงจาก vehicle_master มาให้
  model?:          string
  driverName?:     string
  driverPhone?:    string
  symptom?:        string
  note?:           string
  breakdownLocation?: string
  plant?:          string
  cementStatus?:   string
  drivableStatus?: string
}

/**
 * จุดที่รถเสีย → ลิงก์แผนที่ (รับทั้งลิงก์เต็มและ lat,long) · คืน null ถ้าเป็นคำบรรยายเฉย ๆ
 * อยู่ใน lib เพราะทั้งหน้าเว็บและข้อความสรุปส่งไลน์ต้องตีความค่าเดียวกันให้ตรงกัน
 */
export function mapUrl(v: string): string | null {
  const t = (v ?? "").trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(t)) return `https://www.google.com/maps?q=${encodeURIComponent(t)}`
  return null
}

// ถ้อยคำในไลน์ต่างจากค่าที่เก็บ — กลุ่มอ่าน "รถวิ่งเข้าอู่ได้" เข้าใจกว่า "วิ่งได้"
const DRIVABLE_LINE_TEXT: Record<string, string> = {
  "วิ่งได้":     "รถวิ่งเข้าอู่ได้",
  "วิ่งไม่ได้":  "รถวิ่งเข้าอู่ไม่ได้",
}

export function buildRepairSummary(r: RepairSummaryInput): string {
  const t = (v?: string) => String(v ?? "").trim()
  const lines: string[] = []

  const fleetNo = t(r.fleetNo)
  if (fleetNo) {
    const spec = [t(r.brand), t(r.model)].filter(Boolean).join(" ")
    lines.push(`🚗 เบอร์รถ ${fleetNo}${spec ? ` /${spec}` : ""}`)
  }
  if (t(r.driverName))  lines.push(`👤 ชื่อ ${t(r.driverName)}`)
  if (t(r.driverPhone)) lines.push(`📞 เบอร์ ${t(r.driverPhone)}`)
  if (t(r.symptom))     lines.push(`🚑 ${t(r.symptom)}`)
  if (t(r.note))        lines.push(t(r.note))
  // พิกัด/ลิงก์ → ส่งเป็น URL ให้กดเปิดแผนที่ในไลน์ได้เลย · คำบรรยายสถานที่ → ส่งข้อความตามที่พิมพ์
  const loc = t(r.breakdownLocation)
  if (loc)              lines.push(`📍 จุดที่รถเสีย ${mapUrl(loc) ?? loc}`)
  if (t(r.plant))       lines.push(`🔧 แพล้น${t(r.plant)}`)

  const tail = [t(r.cementStatus), DRIVABLE_LINE_TEXT[t(r.drivableStatus)] ?? ""].filter(Boolean).join(" / ")
  if (tail) lines.push(`💰 ${tail}`)

  return lines.join("\n")
}

/* ── เทียบขั้นตอนงานกับ Mena-Next (ATMS) ─────────────────────────────────────
 * คำสองระบบไม่ใช่ชุดเดียวกัน: Mena-Next มี 15 สถานะที่ครอบคลุมงาน "อู่ใน" ด้วย
 * (รอเข้าช่อง / ซ่อมเสร็จภายในอู่ / รอทำความสะอาด / รอตรวจสภาพ / ยาง / แย็กโม่)
 * ส่วน WMS หน้านี้ดูเฉพาะ "อู่นอก" — จึงยุบทั้งสองฝั่งลงเป็นขั้นกลางแล้วเทียบขั้น
 * แทนการเทียบข้อความ ทำให้ทนต่อการที่ Mena-Next เพิ่ม/เปลี่ยน label ในอนาคต
 * (ระบบต้นทางเราแก้ไม่ได้ — ถ้าเจอ label ใหม่จะกลายเป็น "เทียบไม่ได้" ไม่ใช่ "ไม่ตรง")
 * ขั้น 4 ไม่ได้อยู่ในลำดับ 3→5 — เป็นงานที่ถูกแขวนไว้ จับคู่กับตัวเองเท่านั้น
 */
export const REPAIR_STAGES: Record<number, string> = {
  1: "รอเข้าซ่อม",
  2: "รอราคา/อนุมัติ/ของ",
  3: "กำลังซ่อม",
  4: "ชะลอ/ไม่มีกำหนด",
  5: "เสร็จ/รอปิด",
}

/** step ของ Mena-Next (current_step.step.label_th) → ขั้น */
const NEXT_STEP_STAGE: Record<string, number> = {
  "ยังไม่มีสถานะ": 1,
  "รอประเมินการซ่อม": 1,
  "รอคนขับ": 1,
  "รอเข้าช่อง": 1,
  "รอราคา": 2,
  "รออนุมัติ": 2,
  "รออะไหล่": 2,
  "รถซ่อม": 3,
  "ยาง": 3,
  "แย็กโม่": 3,
  "รถที่ชะลอการซ่อม": 4,
  "ซ่อมเสร็จภายในอู่": 5,
  "รอทำความสะอาด": 5,
  "รอตรวจสภาพ": 5,
  "รถซ่อมเสร็จสิ้น": 5,
}

/** สถานะงานอู่นอกใน WMS → ขั้น (อะไหล่ลงคันไม่เทียบ — Mena-Next ไม่มี workflow นั้น) */
const WMS_STATUS_STAGE: Record<string, number> = {
  "รอประเมินการซ่อม": 1,
  "รอ PR": 2,
  "รถเข้าอู่ซ่อม": 3,
  "ซ่อมมีกำหนดเสร็จ": 3,
  "ซ่อมไม่มีกำหนด": 4,
  "รถเสร็จ(ไม่มี PR)": 5,
  "รถเสร็จ": 5,
}

/** 0 = ไม่รู้จัก/เทียบไม่ได้ */
export const stageOfNextStep = (step: string) => NEXT_STEP_STAGE[(step ?? "").trim()] ?? 0

/** ขั้นของงานอู่นอกใน WMS — tickbox "รอใบเสนอราคา" (waitingQuote) นับเป็นขั้นรอราคา
 *  เพราะถูกถอดออกจาก workflow ไปเป็น flag แล้ว (2026-08-11) ไม่งั้นรถที่ติ๊กรอราคา
 *  จะขึ้นว่าไม่ตรงทั้งที่ Mena-Next ก็อยู่ขั้น "รอราคา" เหมือนกัน */
export function stageOfRepair(r: { status?: string; waitingQuote?: string; jobType?: string }): number {
  if (jobTypeOf(r) === JOB_TYPE_PARTS) return 0
  const base = WMS_STATUS_STAGE[String(r.status ?? "").trim()] ?? 0
  // แทนที่เฉพาะขั้นที่งานยังเดินอยู่จริง — งานที่ชะลอ/เสร็จแล้ว flag ไม่ควรทับ
  if ((base === 1 || base === 3) && String(r.waitingQuote ?? "").trim()) return 2
  return base
}

export type StageCompare = "same" | "diff" | "unknown"

/** เทียบขั้นของงาน WMS กับ step ของ Mena-Next — unknown = ฝั่งใดฝั่งหนึ่งไม่รู้จัก */
export function compareStage(
  r: { status?: string; waitingQuote?: string; jobType?: string },
  step: string,
): StageCompare {
  const a = stageOfRepair(r), b = stageOfNextStep(step)
  if (!a || !b) return "unknown"
  return a === b ? "same" : "diff"
}
