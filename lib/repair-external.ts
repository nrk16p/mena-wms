// สถานะงานซ่อมอู่นอก — เรียงตามลำดับการทำงาน (ลำดับนี้คือแหล่งความจริงของ workflow:
// ทั้งชิปกรอง แถบความคืบหน้า และฟิลด์บังคับสะสมตอนปิดงาน อ่านจากลำดับในอาร์เรย์นี้)
export type RepairStatus = {
  value: string
  emoji: string
  cls: string  // tailwind chip (light + dark)
}

export const REPAIR_STATUSES: RepairStatus[] = [
  { value: "แจ้งซ่อมอู่นอก",          emoji: "⏳", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300" },
  { value: "รถเข้าซ่อมอู่นอก",  emoji: "🔧", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  { value: "จัดทำใบเสนอราคา",   emoji: "🧾", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  // "รอใบเสนอราคา" ถูกถอดจาก workflow อู่นอก (2026-08-11) → เป็น tickbox waitingQuote แทน (ยังเป็นสถานะของอะไหล่ลงคันอยู่)
  { value: "รอ PR",        emoji: "⏰", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "รอ PR อนุมัติ",     emoji: "🖊️", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" },
  { value: "ซ่อมไม่มีกำหนด",    emoji: "🛠️", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "ซ่อมมีกำหนดเสร็จ",  emoji: "✅", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  { value: "รถเสร็จ(ไม่มี PR)", emoji: "🏁", cls: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300" },
  { value: "รถเสร็จ",          emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  // ปิดงานแบบเคลมอู่ — อู่รับผิดชอบค่าซ่อมเอง ไม่มีการจัดซื้อ จึงไม่มี PR/PO ให้กรอก
  // วางท้ายสุดของ workflow ตั้งใจ: requiredFieldsFor() สะสมฟิลด์ตามลำดับขั้น ถ้าแทรกไว้ก่อน
  // "รถเสร็จ" จะทำให้เงื่อนไขปิดงานปกติเปลี่ยนไปด้วย
  { value: "รถเสร็จ(เคลมอู่)", emoji: "🛡️", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  // ชะลองานซ่อม — ยังไม่ได้ซ่อม แต่พักไว้ก่อน ไม่ต้องตามงานรายวันแล้ว
  // นับเป็นสถานะจบเหมือนกัน (ออกจากหน้างานค้าง → ไปแท็บรถซ่อมเสร็จ) และไม่กินโควตา 1 คัน 1 ใบ
  { value: "ชะลองานซ่อม",      emoji: "⏸️", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200" },
]

export const REPAIR_STATUS_VALUES = REPAIR_STATUSES.map((s) => s.value)

/** ชื่อสถานะเดิมที่เปลี่ยนไปแล้ว → ชื่อปัจจุบัน
 *  2026-08-20: "รอรถเข้า" → "รอประเมินการซ่อม" ให้ตรงกับสถานะฝั่ง Mena-Next
 *  2026-09-21: "รอประเมินการซ่อม" → "แจ้งซ่อมอู่นอก" · "รถเข้าอู่ซ่อม" → "รถเข้าซ่อมอู่นอก"
 *              (ทีมเรียกแบบนี้ · ชื่อเดิมยังส่งเข้ามาทาง sync API ได้ alias แปลงให้)
 *  คงไว้เพื่อ (1) เอกสารเก่าที่ยังไม่ถูก migrate แสดงผลถูก (2) ทีมภายนอกที่ยังส่งค่าเดิม
 *  เข้ามาทาง sync API ไม่โดน 400 — ถอดออกได้เมื่อมั่นใจว่าไม่มีใครส่งค่าเก่าแล้ว */
export const STATUS_ALIASES: Record<string, string> = {
  "รอรถเข้า":          "แจ้งซ่อมอู่นอก",
  "รอประเมินการซ่อม":  "แจ้งซ่อมอู่นอก",
  "รถเข้าอู่ซ่อม":      "รถเข้าซ่อมอู่นอก",
}
/** ค่าที่ต้องใช้ค้นใน DB สำหรับสถานะหนึ่ง — ชื่อปัจจุบัน + ชื่อเก่าทุกตัวที่ map มาที่ชื่อนี้
 *  (ใบที่คีย์ไว้ก่อนเปลี่ยนชื่อยังเก็บค่าเดิม กรองด้วยชื่อใหม่อย่างเดียวจะหาไม่เจอ) */
export const statusQueryValues = (status: string): string[] => {
  const v = normalizeStatus(status)
  return [v, ...Object.entries(STATUS_ALIASES).filter(([, to]) => to === v).map(([from]) => from)]
}

export const normalizeStatus = (s: string) => {
  const t = (s ?? "").trim()
  return STATUS_ALIASES[t] ?? t
}

/**
 * วันที่ที่ปีเป็น พ.ศ. → ค.ศ. (YYYY-MM-DD) · ช่อง <input type="date"> เป็นปฏิทิน ค.ศ.
 * คนพิมพ์ปี 2569 ลงไปตรง ๆ จะได้ "2569-09-17" ซึ่งเป็นปี ค.ศ. 2569 (เคส NL22 22/09/2569)
 * ปี 2400–2700 ไม่มีทางเป็นวันที่จริงของงานซ่อม → ลบ 543 · ค่าอื่นคืนเดิม
 */
export const fixBeYear = (s: string): string => {
  const m = /^(\d{4})(-\d{2}-\d{2}.*)$/.exec((s ?? "").trim())
  if (!m) return (s ?? "").trim()
  const y = Number(m[1])
  return y >= 2400 && y <= 2700 ? `${y - 543}${m[2]}` : `${m[1]}${m[2]}`
}

/** ช่องวันที่ของใบงาน — ใช้ตรวจปีผิดตอนบันทึก (ทุกทางเขียน) และเตือนใต้ช่องในฟอร์ม */
export const REPAIR_DATE_FIELDS = [
  { field: "receivedDate",  label: "วันที่รับแจ้ง" },
  { field: "garageInDate",  label: "วันที่รถเข้าอู่ซ่อม" },
  { field: "dueDate",       label: "วันกำหนดเสร็จ" },
  { field: "completedDate", label: "วันที่ซ่อมเสร็จ" },
  { field: "stageEta",      label: "วันคาดว่าจะพ้นสถานะ" },
] as const

/**
 * วันที่ YYYY-MM-DD ที่ปีเป็นไปได้ (ค.ศ. 2000–2100)
 * ปีอื่นคือพิมพ์ผิดในช่องปี เช่น 0259 / 0026 / 0001 (เคส F014 22/09/2569 โชว์ "645384 วัน")
 */
export const isPlausibleDate = (s: string | null | undefined): boolean => {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec((s ?? "").trim())
  if (!m) return false
  const y = Number(m[1])
  return y >= 2000 && y <= 2100
}

/**
 * คำเตือนใต้ช่องวันที่ในฟอร์ม — null = ว่างหรือปกติ
 * - be  = พิมพ์ปี พ.ศ. → บันทึกได้ ระบบแปลงเป็น ค.ศ. ให้ (fixBeYear)
 * - bad = ปีเป็นไปไม่ได้ → บันทึกไม่ได้จนกว่าจะแก้ (badDateError)
 */
export function dateYearHint(v: string | null | undefined): { tone: "be" | "bad"; text: string } | null {
  const raw = (v ?? "").trim()
  if (!raw || isPlausibleDate(raw)) return null
  const fixed = fixBeYear(raw)
  if (isPlausibleDate(fixed))
    return { tone: "be", text: `ปี ${raw.slice(0, 4)} เป็น พ.ศ. — ช่องนี้ใช้ปี ค.ศ. ระบบจะบันทึกเป็น ${fixed.slice(0, 4)} ให้` }
  return { tone: "bad", text: `ปี ${raw.slice(0, 4)} ไม่ถูกต้อง — ใส่ปี ค.ศ. เช่น ${new Date().getFullYear()} (บันทึกไม่ได้จนกว่าจะแก้)` }
}

/**
 * ข้อความ error เมื่อช่องวันที่ที่ "เพิ่งกรอก/แก้" มีปีเป็นไปไม่ได้ (หลังแปลง พ.ศ. แล้ว) — null = ผ่าน
 * ค่าเดิมที่ผิดอยู่แล้วไม่บล็อก: แก้ช่องอื่นของใบนั้นได้ และ API ภายนอกที่ PATCH ช่องอื่นไม่พัง
 */
export function badDateError(
  doc: Record<string, unknown>,
  existing?: Record<string, unknown> | null,
): string | null {
  const bad = REPAIR_DATE_FIELDS.filter(({ field }) => {
    const v = fixBeYear(String(doc[field] ?? ""))
    return !!v && !isPlausibleDate(v) && (!existing || String(existing[field] ?? "").trim() !== v)
  })
  if (!bad.length) return null
  const list = bad.map((b) => `${b.label} (ปี ${String(doc[b.field] ?? "").trim().slice(0, 4)})`).join(" · ")
  return `วันที่ไม่ถูกต้อง: ${list} — ใส่ปี ค.ศ. เช่น ${new Date().getFullYear()}`
}

// สถานะ "รถเสร็จ" = ปิดงาน — แยกไปหน้า "รถซ่อมเสร็จ" ส่วนที่เหลือคือ "รถซ่อมอู่นอก"
export const REPAIR_DONE_STATUS = "รถเสร็จ"

// ซ่อมเสร็จแล้วแต่ยังไม่มี PR — ยังไม่ปิดงาน ใบยังอยู่หน้ารายการ (ใช้ทั้งใน UI และรายงาน)
export const REPAIR_DONE_NO_PR_STATUS = "รถเสร็จ(ไม่มี PR)"

// ปิดงานแบบ "เคลมอู่" = อู่รับผิดชอบค่าซ่อม (งานในประกันของอู่) ไม่มี PR/PO ในระบบจัดซื้อ
// เป็นสถานะปิดงานเต็มตัวเหมือน "รถเสร็จ" (ย้ายไปหน้ารถซ่อมเสร็จ + ล็อกห้ามย้อน)
// ต่างกันที่ฟิลด์บังคับ — ดู requiredFieldsFor()
export const REPAIR_CLAIM_DONE_STATUS = "รถเสร็จ(เคลมอู่)"

// พักงานไว้ก่อน (ยังไม่ซ่อม) — ออกจากคิวงานที่กำลังเดิน ไปอยู่แท็บเดียวกับงานที่ปิดแล้ว
// ไม่ต้องกรอกอะไรเพิ่ม เหตุผลอยู่ในข้อความอัพเดทงานที่ระบบบังคับให้พิมพ์ตอนเปลี่ยนสถานะอยู่แล้ว
export const REPAIR_DEFER_STATUS = "ชะลองานซ่อม"

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
export const DONE_STATUSES = [REPAIR_DONE_STATUS, REPAIR_CLAIM_DONE_STATUS, REPAIR_DEFER_STATUS, PARTS_DONE_STATUS]
export const isDoneStatus = (s: string) => DONE_STATUSES.includes(s)

/**
 * วันเริ่มนับอายุงาน = วันที่เร็วที่สุดระหว่าง "วันรับแจ้ง" กับ "วันรถเข้าอู่"
 * รายการที่คีย์ย้อนหลัง (นำงานเก่าเข้าระบบ) จะมี receivedDate = วันที่คีย์ ซึ่งช้ากว่าวันรถเข้าอู่จริง
 * ถ้านับจาก receivedDate อย่างเดียว อายุงานจะต่ำกว่าความจริงมาก (เคยเจอโชว์ 6 วัน ทั้งที่จอดจริง 111 วัน)
 */
export const jobStartDate = (r: { receivedDate?: string; garageInDate?: string }): string => {
  // ปีพิมพ์ผิด (0259 ฯลฯ) น้อยกว่าทุกวันจริงเสมอ → ถ้าไม่ตัดทิ้ง จะถูกเลือกเป็นวันเริ่มแล้วอายุงานกลายเป็นหลักแสนวัน
  const rc = isPlausibleDate(r.receivedDate) ? (r.receivedDate ?? "").trim() : ""
  const gi = isPlausibleDate(r.garageInDate) ? (r.garageInDate ?? "").trim() : ""
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

/**
 * เงื่อนไขค้นหา "ใบที่ชนกัน" ตอนบันทึก — null = ประเภทนี้เปิดซ้ำคันได้ ไม่ต้องเช็ค
 * กติกา (ผู้ใช้กำหนด 21/09/2569): โควตา 1 คัน 1 ใบที่ยังไม่ปิด ใช้กับ **งานอู่นอกเท่านั้น**
 *   · อะไหล่ลงคัน — เบอร์รถเดียวเปิดได้หลายใบ และเปิดคู่กับใบอู่นอกของคันเดียวกันได้
 *   · อู่นอก — ชนกันเฉพาะกับใบอู่นอกด้วยกัน (เอกสารเก่าไม่มี jobType = อู่นอก ซึ่ง $ne จับให้ด้วย)
 * ผู้เรียกเติม `_id: { $ne: ... }` เองเมื่อเป็นการแก้ใบเดิม
 */
export function openJobConflictFilter(
  doc: { jobType?: string; plate?: string; fleetNo?: string },
): Record<string, unknown> | null {
  if (jobTypeOf(doc) === JOB_TYPE_PARTS) return null
  const plate   = String(doc.plate ?? "").trim()
  const fleetNo = String(doc.fleetNo ?? "").trim()
  const or: Record<string, string>[] = []
  if (plate)   or.push({ plate })
  if (fleetNo) or.push({ fleetNo })
  if (!or.length) return null
  return { jobType: { $ne: JOB_TYPE_PARTS }, status: { $nin: DONE_STATUSES }, $or: or }
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
  stageEta:     string  // YYYY-MM-DD คาดว่าจะพ้น "สถานะปัจจุบัน" เมื่อไหร่ — ผูกกับขั้น ไม่ใช่กับงานทั้งใบ (คนละตัวกับ dueDate)
  statusSinceAt?: string // ISO datetime เวลาที่เข้าสถานะ (สำหรับ SLA รายชั่วโมง เช่น รอ PR 24 ชม.)
  createdBy?:   string  // ผู้สร้าง (ระบบตั้งจาก session)
  createdAt?:   string  // เวลาสร้างรายการ (ISO) — ระบบตั้งตอนสร้าง
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
  "รถเข้าซ่อมอู่นอก":  { field: "garageInDate",  label: "วันที่รถเข้าซ่อม" },
  // รอใบเสนอราคา: PR ไม่บังคับ (ยังไม่มี PR ก็ได้)
  "รอ PR":        { field: "poCode",        label: "รหัส PO" },
  // มี PR แล้วจึงรออนุมัติได้ — ซ้ำกับฟิลด์ของ "รถเสร็จ" โดยตั้งใจ requiredFieldsFor ตัดซ้ำให้
  "รอ PR อนุมัติ":   { field: "prCode",        label: "รหัส PR" },
  "ซ่อมมีกำหนดเสร็จ": { field: "dueDate",       label: "วันกำหนดเสร็จ" },
  "รถเสร็จ(ไม่มี PR)": { field: "completedDate", label: "วันที่ซ่อมเสร็จ" },
  "รถเสร็จ":          { field: "prCode",        label: "รหัส PR" },  // ปิดงานสมบูรณ์ต้องมี PR (completedDate สะสมมาจากขั้นก่อน)
  // เคลมอู่: ไม่มี PR/PO ให้กรอก — ขอแค่วันที่ซ่อมเสร็จ (ไม่สะสมฟิลด์ขั้นก่อน ดู requiredFieldsFor)
  "รถเสร็จ(เคลมอู่)":   { field: "completedDate", label: "วันที่ซ่อมเสร็จ" },
  // อะไหล่ลงคัน
  "สั่งซื้อแล้ว-รอของ": { field: "dueDate",        label: "กำหนดของถึง" },
  "ลงคันเสร็จ":        { field: "completedDate",  label: "วันที่ลงคันเสร็จ" },
}

// สถานะจบที่ไม่นับฟิลด์สะสมของขั้นก่อน — ดู requiredFieldsFor
export const NO_ACCUM_CLOSE = new Set<string>([REPAIR_CLAIM_DONE_STATUS, REPAIR_DEFER_STATUS])

// สถานะปลายทาง (ปิดงาน) — ห้ามย้อนสถานะกลับเมื่อถึงสถานะนี้แล้ว (ต่อประเภทดู doneStatusFor/isDoneStatus)
export const REPAIR_LOCKED_STATUS = "รถเสร็จ"

// ฟิลด์ที่ต้องกรอก "สะสม" ถึงสถานะเป้าหมาย — รวมของทุกสถานะก่อนหน้าใน workflow ของประเภทนั้น
// (ข้ามสถานะได้ก็ต่อเมื่อกรอกข้อมูลของสถานะที่ข้ามครบ)
export function requiredFieldsFor(status: string, jobType: string = JOB_TYPE_GARAGE): { field: RepairField; label: string }[] {
  // สถานะจบที่ไม่ได้เดินผ่านสายจัดซื้อ (เคลมอู่ / ชะลองานซ่อม) — ไม่สะสมฟิลด์ของขั้นก่อน
  // ปิดจากสถานะไหนก็ได้ ขอแค่ฟิลด์ของตัวเอง (เคลมอู่ = วันที่ซ่อมเสร็จ · ชะลอ = ไม่ต้องมี)
  if (NO_ACCUM_CLOSE.has(status)) {
    const req = REPAIR_STATUS_REQUIRED_FIELD[status]
    return req ? [req] : []
  }
  const flow = statusesFor(jobType)
  const idx  = flow.findIndex((s) => s.value === status)
  if (idx < 0) return []
  const out: { field: RepairField; label: string }[] = []
  for (let i = 0; i <= idx; i++) {
    const req = REPAIR_STATUS_REQUIRED_FIELD[flow[i].value]
    // ฟิลด์เดียวกันบังคับได้หลายขั้น (เช่น รหัส PR ที่ขั้นรออนุมัติและขั้นรถเสร็จ) — เก็บครั้งแรกครั้งเดียว
    if (req && !out.some((o) => o.field === req.field)) out.push(req)
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
  /** ลิงก์เปิดใบงานใน WMS — ต่อท้ายสุดให้คนในกลุ่มกดเข้าใบงานได้ (ผู้ใช้ขอ 17/09/2026) */
  link?:           string
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
  if (t(r.link))        lines.push(`🔗 WMS ${t(r.link)}`)

  return lines.join("\n")
}

/* ── ผู้รับผิดชอบตามฟลีท (ผู้ใช้กำหนด 21/09/2569) ──────────────────────────
 * ใช้แยกรายการ "ไม่มี PR" ให้ส่งตรงถึงคนที่ต้องไปเปิด PR จริง ๆ
 * key = ค่าฟิลด์ fleet ที่ระบบเติมให้จาก atms.vehicle_daily (เทียบแบบไม่สนตัวพิมพ์)
 * ฟลีทที่ไม่อยู่ในนี้ (RP / รถสำนักงาน / ว่าง) ตกไปที่ OWNER_NO_FLEET
 */
export const FLEET_OWNER: Record<string, string> = {
  "Asia":               "เบญ",   // ASIA ML
  "Asia MS":            "เบญ",
  "ที.เอ็น.ซีเมนต์บล็อค": "เบญ",   // TN
  "Cpac ML":            "กุ้ง",
  "Cpac MS":            "กุ้ง",
  "Kpac ML":            "กุ้ง",   // KPAC
  "UMO":                "กุ้ง",
  "Scco ML":            "ติ๊ก",
  "Scco MS":            "ติ๊ก",
  "Fast":               "ติ๊ก",
  "Acon":               "ติ๊ก",
}
export const OWNER_NO_FLEET = "ไม่ระบุผู้รับผิดชอบ"

/* ── ผู้รับผิดชอบฝั่งจัดซื้อ (ผู้ใช้กำหนด 21/09/2569) — คนละชุดกับผู้ดูแลงานซ่อมด้านบน ──
 * เนส ดูแลฟลีทตามรายการนี้ · ที่เหลือทั้งหมดเป็นของต่าย (รวมใบที่ยังไม่รู้ฟลีท)
 * ใส่ชื่อย่อที่ทีมเรียก (Asia ML / TN / Kpac) คู่กับค่าจริงในฐานข้อมูลไว้ด้วย
 */
export const BUYER_NES = "เนส"
export const BUYER_TAI = "ต่าย"
export const BUYERS = [BUYER_NES, BUYER_TAI]
export const BUYER_NES_FLEETS = [
  "Asia", "Asia ML", "Asia MS", "TN", "ที.เอ็น.ซีเมนต์บล็อค",
  "UMO", "Fast", "Acon", "Kpac", "Kpac ML", "จิรโชติ",
]
const NES_KEYS = new Set(BUYER_NES_FLEETS.map((f) => f.trim().toLowerCase()))
/** ฟลีทไหนเป็นของใครฝั่งจัดซื้อ — ไม่ตรงรายการของเนส = ต่ายเสมอ (ไม่มีกลุ่ม "ไม่ระบุ") */
export const buyerOfFleet = (fleet?: string) =>
  NES_KEYS.has(String(fleet ?? "").trim().toLowerCase()) ? BUYER_NES : BUYER_TAI
const OWNER_BY_KEY = new Map(Object.entries(FLEET_OWNER).map(([f, o]) => [f.trim().toLowerCase(), o]))
export const ownerOfFleet = (fleet?: string) =>
  OWNER_BY_KEY.get(String(fleet ?? "").trim().toLowerCase()) ?? OWNER_NO_FLEET
/** ชื่อที่ใช้เรียกในข้อความ — "คุณเบญ" · กลุ่มไม่ระบุใช้ชื่อเต็มเฉย ๆ */
export const ownerLabel = (owner: string) => (owner === OWNER_NO_FLEET ? owner : `คุณ${owner}`)
/** ฟลีทที่คนนี้ดูแล (เรียงตามที่ประกาศไว้) — ใช้พิมพ์กำกับในวงเล็บ */
export const fleetsOfOwner = (owner: string) =>
  Object.entries(FLEET_OWNER).filter(([, o]) => o === owner).map(([f]) => f)

// ── งานที่ยังไม่มี PR แยกตามคนสร้าง (ส่งไลน์ทีละคน · ผู้ใช้ขอ 17/09/2026) ─────────────
// ลิงก์ทุกคันยาวเกินจะส่งรวมข้อความเดียว (123 คัน ≈ 15,000 ตัวอักษร) จึงแยกข้อความต่อคนสร้าง
// ไม่มี PR กี่วัน = วันนี้ − noPrSince (ครั้งล่าสุดที่ PR ถูกลบ จาก log) ถ้าไม่เคยมี PR = วันที่สร้างรายการ
// (ผู้ใช้ขอ 17/09/2026 — เดิมนับจากวันสร้างอย่างเดียว TH1141 ขึ้น 35 วันทั้งที่เพิ่งลบ PR วันนี้)
// ตามปฏิทินไทย · ใบเก่าที่ไม่มี createdAt ใช้วันเริ่มงาน · ต่างจากอายุงานเมื่อไหร่แสดง "เปิดงาน N วัน" คู่กัน
export type NoPrRow = {
  _id: string; createdBy?: string; createdAt?: string | Date; fleetNo?: string; plate?: string
  status?: string; prCode?: string; receivedDate?: string; garageInDate?: string; fleet?: string
  /** เวลาที่ PR ถูกลบครั้งล่าสุด (ไม่มี = ไม่เคยมี PR) — ฝั่ง server เติมจาก repair_external_log */
  noPrSince?: string | Date
}
export type NoPrGroup = { creator: string; count: number; avgDays: number; maxDays: number; text: string }

const NO_CREATOR = "ไม่ระบุคนสร้าง"
const dayNum = (ymd: string) => Math.floor(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) / 86400000)
const bkkYmd = (v: string | Date) => {
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return isNaN(t) ? "" : new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** ชื่อสั้นบนปุ่ม — ชื่อเล่นในวงเล็บท้ายชื่อ ("Jeeraporn Ployprasert (Ben)" → "Ben") ไม่มีวงเล็บใช้คำแรก */
export function creatorShortName(name: string): string {
  const t = String(name ?? "").trim()
  if (t === NO_CREATOR) return t
  return t.match(/\(([^()]+)\)$/)?.[1].trim() || t.split(/\s+/)[0] || ""
}

type NoPrGroupOpts = {
  today: string
  origin: string
  /** จัดกลุ่มด้วยอะไร — ค่าเริ่มต้น = คนสร้างใบ */
  groupOf?: (r: NoPrRow) => string
  /** กลุ่มที่ต้องอยู่ท้ายสุดเสมอ (ส่งหาใครไม่ได้) */
  lastKey?: string
  /** ชื่อที่พิมพ์ในข้อความ (ค่าเริ่มต้น = คีย์) */
  labelOf?: (key: string) => string
  /** ต่อท้ายรถแต่ละคันด้วยชื่อฟลีท — ใช้ตอนแยกตามผู้รับผิดชอบ */
  showFleet?: boolean
}

/** แยกตามผู้รับผิดชอบฟลีท (เบญ/กุ้ง/ติ๊ก) — ข้อความส่งไลน์ให้คนที่ต้องไปเปิด PR */
export function buildNoPrByOwner(rows: NoPrRow[], opts: { today: string; origin: string }): NoPrGroup[] {
  return buildNoPrByCreator(rows, {
    ...opts,
    groupOf:  (r) => ownerOfFleet(r.fleet),
    lastKey:  OWNER_NO_FLEET,
    labelOf:  ownerLabel,
    showFleet: true,
  })
}

export function buildNoPrByCreator(rows: NoPrRow[], opts: NoPrGroupOpts): NoPrGroup[] {
  const groupOf = opts.groupOf ?? ((r: NoPrRow) => String(r.createdBy ?? "").trim() || NO_CREATOR)
  const lastKey = opts.lastKey ?? NO_CREATOR
  const labelOf = opts.labelOf ?? ((k: string) => k)
  const byCreator = new Map<string, { r: NoPrRow; days: number; openDays: number }[]>()
  for (const r of rows) {
    if (isDoneStatus(String(r.status ?? "")) || String(r.prCode ?? "").trim()) continue
    const since = (d: string) => (d ? Math.max(0, dayNum(opts.today) - dayNum(d)) : 0)
    const opened   = (r.createdAt ? bkkYmd(r.createdAt) : "") || jobStartDate(r)
    const openDays = since(opened)
    const cleared  = r.noPrSince ? bkkYmd(r.noPrSince) : ""
    // PR ถูกลบก่อนวันสร้าง (ข้อมูลเพี้ยน) ไม่มีทางเป็นจริง → ใช้อายุงาน
    const days  = cleared && cleared >= opened ? since(cleared) : openDays
    const who   = groupOf(r)
    byCreator.set(who, [...(byCreator.get(who) ?? []), { r, days, openDays }])
  }
  return [...byCreator.entries()]
    // กลุ่ม "ไม่ระบุ" ไว้ท้ายสุดเสมอ (ส่งหาใครไม่ได้) · ที่เหลือค้างมากสุดก่อน
    .sort((a, b) => Number(a[0] === lastKey) - Number(b[0] === lastKey) || b[1].length - a[1].length || a[0].localeCompare(b[0], "th"))
    .map(([creator, list]) => {
      list.sort((a, b) => b.days - a.days)
      const maxDays = list[0].days
      const avgDays = Math.round(list.reduce((n, x) => n + x.days, 0) / list.length)
      const lines = [
        `📋 งานที่ยังไม่มี PR — ${labelOf(creator)} ${list.length} คัน`,
        `⏱️ ไม่มี PR เฉลี่ย ${avgDays} วัน · นานสุด ${maxDays} วัน`,
        "━━━━━━━━━━━━━━",
      ]
      list.forEach(({ r, days, openDays }, i) => {
        const fleet  = opts.showFleet ? String(r.fleet ?? "").trim() : ""
        const car    = [String(r.fleetNo ?? "").trim(), String(r.plate ?? "").trim(), fleet].filter(Boolean).join(" · ") || "-"
        const status = String(r.status ?? "")
        const opened = openDays !== days ? ` · เปิดงาน ${openDays} วัน` : ""
        lines.push(`${i + 1}. ${car} — ไม่มี PR ${days} วัน${opened} (${statusMeta(status).emoji} ${status})`)
        lines.push(`${opts.origin}/repair-external?id=${r._id}`)
      })
      lines.push("", "📌 กดลิงก์ → ใส่รหัส PR → กด “อัพเดทงาน”")
      return { creator, count: list.length, avgDays, maxDays, text: lines.join("\n") }
    })
}

/**
 * ใบที่ออกจากคิววันนี้ (ปิด/ชะลอ) — คันเดียวกันหลายใบในกลุ่มเดียวกัน นับเป็นคันเดียว
 * (ผู้ใช้สั่ง 22/09/2569: NL22 สร้าง-ปิดซ้ำ 3 ใบ MR/PR/PO เดียวกัน → รายงานขึ้น NL22 ×3)
 * เก็บใบที่เปิดก่อนสุดของแต่ละคันต่อกลุ่ม · ใบที่ไม่รู้ว่าคันไหนไม่ตัด
 * ผู้เรียกต้องใช้ชุดที่คืนไปนับทุกยอด (ต้นวัน/รับใหม่/เสร็จ/ชะลอ) — ใบที่ตัดหายจากฝั่งเข้าและฝั่งออกพร้อมกัน
 * สมการ ต้นวัน + ใหม่ − เสร็จ − ชะลอ = สิ้นวัน จึงยังลงตัว
 */
export function dropSameDayRepeats<T extends { fleetNo?: string; plate?: string; createdAt?: Date | string }>(
  rows: T[], groupOf: (r: T) => string,
): T[] {
  const unit = (r: T) => String(r.fleetNo || r.plate || "").replace(/[\s.]/g, "").toUpperCase()
  const time = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() : 0) || 0
  const seen = new Set<string>()
  return [...rows].sort((a, b) => time(a) - time(b)).filter((r) => {
    if (!unit(r)) return true
    const k = `${groupOf(r)}|${unit(r)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* ── รายงานสรุปประจำวันส่งกลุ่มไลน์ (รูปแบบที่ทีมใช้จริง · ผู้ใช้กำหนด 21/09/2569) ──
 * นับเฉพาะงาน "อู่นอก" ในระบบนี้เท่านั้น ไม่ดึงงานอู่ในจาก Mena-Next (ผู้ใช้สั่ง)
 * ตัวเลขมาจาก /api/repair-external/daily-summary ที่เดียว ฝั่งนี้แค่เรียงเป็นข้อความ
 */
export type DailySummary = {
  /** วันที่ของสรุป (YYYY-MM-DD เวลาไทย) */
  date:          string
  /** งานที่ยังไม่ปิด ณ ต้นวัน = เปิดก่อนวันนี้ และยังไม่ปิด หรือเพิ่งปิด/ชะลอวันนี้ */
  startOfDay:    number
  openedToday:   number
  /** ปิดเป็น "รถเสร็จ" หรือ "รถเสร็จ(เคลมอู่)" วันนี้ (นับจากวันที่สถานะเปลี่ยน ไม่ใช่ช่องวันที่ซ่อมเสร็จ) */
  closedToday:   number
  /** "เบอร์รถ (ทะเบียน)" ของคันที่ปิดวันนี้ — รูปแบบเดียวกับรายการที่ชะลอ */
  closedUnits:   string[]
  /** ชะลองานซ่อมวันนี้ — ออกจากคิวเหมือนกัน ต้องพิมพ์ด้วยยอดถึงจะบวกลบลงตัว */
  deferredToday: number
  /** "เบอร์รถ (ทะเบียน)" ของคันที่ชะลอวันนี้ — ทีมขอให้เห็นทั้งสองอย่าง */
  deferredUnits: string[]
  /** งานที่ยังไม่ปิดตอนนี้ */
  endOfDay:      number
  byStatus:      { status: string; count: number }[]
  noPr:          { owner: string; count: number; fleets: { fleet: string; units: string[] }[] }[]
  /** งานที่ต้องเร่งตาม = ซ่อมเสร็จแล้ว (รถเสร็จ(ไม่มี PR)) แต่เลยวันกำหนดเสร็จ · ค้างนานสุดขึ้นก่อน */
  urgent:        { units: string[] }
}

const TH_MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/** "2026-09-21" → "21/9/2569" (แบบที่ทีมเขียนในรายงาน) */
export function thaiDateShort(ymd: string): string {
  const [y, m, d] = String(ymd ?? "").split("-").map(Number)
  return y && m && d ? `${d}/${m}/${y + 543}` : String(ymd ?? "")
}
/** ข้อความ "ไม่มี PR แยกตามผู้รับผิดชอบและฟลีท" — แยกส่งคนละข้อความกับรายงานสรุป
 *  (ผู้ใช้สั่ง 21/09/2569: รายงานสรุปยาวไป เอารายชื่อรถออกไปอีกข้อความ) */
export function buildNoPrOverviewText(s: DailySummary, opts: { origin: string }): string {
  const total = s.noPr.reduce((n, g) => n + g.count, 0)
  if (!total) return `🎉 งานอู่นอกมี PR ครบทุกใบแล้ว (${thaiDateShort(s.date)})`
  const L: string[] = [`📋 ไม่มี PR ${total} คัน — แยกตามผู้รับผิดชอบและฟลีท · ${thaiDateShort(s.date)}`, ""]
  for (const g of s.noPr) {
    L.push(`* ${ownerLabel(g.owner)} : ${g.count} คัน`)
    for (const f of g.fleets) L.push(`   - ${f.fleet || "ไม่ระบุฟลีท"} (${f.units.length}) : ${f.units.join(" / ")}`)
  }
  if (opts.origin) L.push("", `🔗 ${opts.origin}/repair-external`)
  return L.join("\n")
}

/**
 * ชื่อสถานะที่ใช้ "เฉพาะในรายงานส่งไลน์" — ในระบบ/หน้าเว็บยังเป็นชื่อเดิม
 * (ผู้ใช้กำหนด 21/09/2569 — กลุ่มไลน์คุยกันด้วยคำชุดนี้)
 * สองสถานะที่ map มาชื่อเดียวกันจะถูกรวมเป็นบรรทัดเดียวในรายงาน
 */
export const REPORT_STATUS_LABEL: Record<string, string> = {
  "แจ้งซ่อมอู่นอก":    "รอส่ง JR ประเมินงานซ่อม",
  "รถเข้าซ่อมอู่นอก":  "รอราคา",
  "จัดทำใบเสนอราคา":   "รอราคา",
}

/** ยุบ byStatus เป็นบรรทัดของรายงาน — เรียงตามลำดับขั้นเดิม ใช้อีโมจิของขั้นแรกในกลุ่ม
 *  from = ชื่อสถานะจริงในระบบที่รวมอยู่ในบรรทัดนี้ (ไว้พิมพ์ในวงเล็บให้เทียบกับหน้าเว็บได้) */
export function reportStatusLines(byStatus: { status: string; count: number }[]) {
  const out: { label: string; emoji: string; count: number; from: string[] }[] = []
  for (const x of byStatus) {
    const label = REPORT_STATUS_LABEL[x.status] ?? x.status
    const hit = out.find((o) => o.label === label)
    if (hit) { hit.count += x.count; hit.from.push(x.status) }
    else out.push({ label, emoji: statusMeta(x.status).emoji, count: x.count, from: [x.status] })
  }
  return out
}

export function buildDailySummaryText(s: DailySummary, opts: { origin: string }): string {
  const L: string[] = [`📌 รายงานสรุปงานซ่อมอู่นอก ประจำวันที่ ${thaiDateShort(s.date)}`, "", "🔷 สรุปภาพรวม", ""]
  L.push(`🚗 คงค้างต้นวัน : ${s.startOfDay} คัน`)
  L.push(`📥 รับแจ้งซ่อมอู่นอกใหม่วันนี้ : ${s.openedToday} คัน`)
  L.push(`✅ ซ่อมเสร็จส่งมอบวันนี้ : ${s.closedToday} คัน`)
  if (s.closedUnits.length) L.push(`   ${s.closedUnits.join(" / ")}`)
  // พิมพ์เสมอแม้เป็น 0 — ต้นวัน + ใหม่ − เสร็จ − ชะลอ = สิ้นวัน คนอ่านบวกลบตามได้ครบ
  L.push(`⏸️ ชะลองานซ่อมวันนี้ : ${s.deferredToday} คัน`)
  if (s.deferredUnits.length) L.push(`   ${s.deferredUnits.join(" / ")}`)
  L.push(`📌 คงค้างสิ้นวัน : ${s.endOfDay} คัน`)

  // ยอดค้างลดลงเท่าไหร่ — ตัวเลขที่ทีมดูเป็นอันดับแรกว่าวันนี้ระบายงานได้ไหม
  const diff = s.startOfDay - s.endOfDay
  L.push("", `📊 Backlog ${diff >= 0 ? "ลด" : "เพิ่ม"} : ${Math.abs(diff)} คัน`)

  if (s.byStatus.length) {
    L.push("", "↗️ สถานะงานที่คงค้าง", "")
    // พิมพ์ครบทุกขั้นแม้วันนั้นเป็น 0 — บรรทัดเท่ากันทุกวัน ทีมเทียบกับเมื่อวานได้ทันที
    // ใช้ชื่อเฉพาะของรายงาน (REPORT_STATUS_LABEL) และยุบขั้นที่ใช้ชื่อเดียวกันเป็นบรรทัดเดียว
    for (const x of reportStatusLines(s.byStatus)) {
      // วงเล็บบอกสถานะจริงในระบบ — เฉพาะบรรทัดที่ใช้ชื่อต่างจากหน้าเว็บ จะได้กดเข้าไปหาได้ถูก
      const orig = x.from.join(" + ") === x.label ? "" : ` (${x.from.join(" + ")})`
      L.push(`* ${x.emoji} ${x.label}${orig} : ${x.count} คัน`)
    }
  }

  if (s.urgent.units.length) {
    L.push("", "🎯 แผนติดตามวันถัดไป", "")
    L.push(`* รถเกินกำหนดเสร็จ : ${s.urgent.units.length} คัน`)
    L.push(s.urgent.units.join(" / "))
  }

  if (opts.origin) L.push("", `🔗 ${opts.origin}/repair-external`)
  return L.join("\n")
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
  "แจ้งซ่อมอู่นอก": 1,
  "รอ PR": 2,
  "จัดทำใบเสนอราคา": 2,
  "รอ PR อนุมัติ": 2,
  "รถเข้าซ่อมอู่นอก": 3,
  "ซ่อมมีกำหนดเสร็จ": 3,
  "ซ่อมไม่มีกำหนด": 4,
  "รถเสร็จ(ไม่มี PR)": 5,
  "รถเสร็จ": 5,
  "รถเสร็จ(เคลมอู่)": 5,
  "ชะลองานซ่อม": 4,
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

/* ── วันคาดพ้นขั้น (stageEta) ────────────────────────────────────────────────
 * ทุกครั้งที่เปลี่ยนสถานะ ผู้ใช้ต้องบอกว่าคาดจะพ้นขั้นใหม่นั้นเมื่อไหร่
 * ต่างจาก dueDate (วันกำหนดเสร็จของงานทั้งใบ) — งานหนึ่งใบมีวันคาดได้หลายค่า ค่าละขั้น
 * ค่าเดิมทุกค่าถูกเก็บไว้ใน repair_external_log จึงย้อนดูได้ว่าแต่ละขั้นเคยสัญญาอะไรไว้
 */

/** สถานะปิดงานไม่ต้องมีวันคาด — ไม่มีขั้นถัดไปให้คาดแล้ว */
export const stageEtaRequired = (status: string) => !!status && !isDoneStatus(status)

/** ข้อความ error ถ้าไม่ผ่าน (null = ผ่าน) — ใช้ตอนเปลี่ยนสถานะเท่านั้น */
export function validateStageEta(status: string, stageEta: string): string | null {
  if (!stageEtaRequired(status)) return null
  return String(stageEta ?? "").trim()
    ? null
    : `กรุณาระบุวันที่คาดว่าจะพ้นสถานะ "${status}"`
}

/** เลยวันคาดมากี่วัน — 0 = ยังไม่เลย/ไม่มีวันคาด/ปิดงานแล้ว */
export function stageEtaOverdueDays(
  r: { status?: string; stageEta?: string },
  today: string,
): number {
  const eta = String(r.stageEta ?? "").trim()
  if (!eta || !stageEtaRequired(String(r.status ?? "")) || eta >= today) return 0
  const d = Math.floor((Date.parse(today) - Date.parse(eta)) / 86400000)
  return d > 0 ? d : 0
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

/* ── อัพเดทงาน (job update) ──────────────────────────────────────────────────
 * ทุกความเคลื่อนไหวของงาน = "อัพเดทงาน" 1 ครั้ง = สถานะ + วันคาดพ้นขั้น + ข้อความ
 * เลือกสถานะเดิมได้ (= ยังค้างขั้นเดิม แต่ต้องเล่าว่าติดอะไร)
 * หน้ารายละเอียดส่งช่องข้อมูลที่แก้มาพร้อมกันได้ (2026-09-17) — ถ้าแก้แค่ช่องข้อมูล
 * โดยสถานะ/วันคาดเดิม ไม่ต้องพิมพ์ข้อความ · เปลี่ยนสถานะหรือวันคาดเมื่อไหร่ ต้องมีข้อความเสมอ
 * กติกาเดียวกันนี้ใช้ทั้งฝั่ง API (กันยิงตรง) และฝั่งหน้าเว็บ (กันกดปุ่มไปก่อน)
 */

// ข้อความที่พิมพ์ซ้ำ ๆ ทุกวัน — กดเติมได้ ไม่ต้องพิมพ์เอง (ยังแก้ต่อได้)
export const QUICK_NOTES: readonly string[] = [
  "อู่แจ้งว่ารออะไหล่",
  "รออนุมัติราคา",
  "อู่รับรถแล้ว เริ่มซ่อม",
  "รอคิวช่าง",
  "ซ่อมเสร็จ รอส่งมอบ",
  "ตามแล้ว ยังไม่คืบหน้า",
]

/** ข้อความอัพเดทสั้นกว่านี้ไม่รับ — กัน "." หรือ "ok" ที่ไม่ได้บอกอะไรเลย */
export const UPDATE_NOTE_MIN = 3

export type JobUpdateInput = {
  status:   string
  stageEta: string
  note:     string
  /** ใบงานปัจจุบัน (เอกสารจาก Mongo ก็ส่งมาตรง ๆ ได้) — ใช้ตรวจล็อกสถานะปิดงาน
   *  ประเภทงาน และฟิลด์บังคับตอนปิดงาน */
  current:  Record<string, unknown>
  /** ช่องข้อมูลที่แก้มาพร้อมกัน — ตรวจฟิลด์บังคับตอนปิดงานจากค่าใหม่ (ปิดงานได้ในคลิกเดียว) */
  fields?:  Record<string, unknown> | null
  /** ช่องข้อมูลมีการแก้จริง — มีแล้วไม่บังคับข้อความ ถ้าสถานะและวันคาดไม่เปลี่ยน */
  fieldsChanged?: boolean
}

/** null = ผ่าน · missing = ฟิลด์ที่ต้องไปกรอกในฟอร์มแก้ไขก่อนปิดงาน */
export type JobUpdateError = { error: string; missing?: { field: RepairField; label: string }[] }

export function validateJobUpdate(input: JobUpdateInput): JobUpdateError | null {
  const status  = normalizeStatus(String(input.status ?? "").trim())
  const note    = String(input.note ?? "").trim()
  const current = input.current ?? {}
  const merged  = input.fields ? { ...current, ...input.fields } : current
  const from    = normalizeStatus(String(current.status ?? "").trim())
  const jobType = jobTypeOf(merged)

  if (!status) return { error: "กรุณาเลือกสถานะ" }
  const stageMoved = status !== from || String(input.stageEta ?? "").trim() !== String(current.stageEta ?? "").trim()
  // "แก้ช่องข้อมูลอย่างเดียว" (สถานะ/วันคาดเดิม ไม่พิมพ์ข้อความ) = ไม่บังคับข้อความและวันคาด
  // เหมือนปุ่มบันทึกการแก้ไขเดิม — ใบเก่าที่ยังไม่มีวันคาดจะได้เติมเลข PR ได้โดยไม่ติด
  const fieldsOnly = !!input.fieldsChanged && !stageMoved && !note
  if (!fieldsOnly && note.length < UPDATE_NOTE_MIN) {
    return { error: stageMoved && input.fieldsChanged
      ? `เปลี่ยนสถานะหรือวันคาด ต้องพิมพ์ข้อความว่าเกิดอะไรขึ้น อย่างน้อย ${UPDATE_NOTE_MIN} ตัวอักษร`
      : `กรุณาพิมพ์ข้อความอัพเดทอย่างน้อย ${UPDATE_NOTE_MIN} ตัวอักษร` }
  }
  // ปิดงานแล้วห้ามขยับ — กติกาเดียวกับ PUT /api/repair-external/[id]
  if (isDoneStatus(from) && status !== from) {
    return { error: "รายการที่ปิดงานแล้ว ย้อนสถานะกลับไม่ได้" }
  }
  if (!statusesFor(jobType).some((s) => s.value === status)) {
    return { error: `สถานะ "${status}" ไม่อยู่ในขั้นตอนของงานประเภท "${jobType}"` }
  }
  const etaErr = fieldsOnly ? null : validateStageEta(status, String(input.stageEta ?? "").trim())
  if (etaErr) return { error: etaErr }

  // ปิดงานต้องมีข้อมูลครบ — สถานะกลางไม่บังคับ (ยังไม่มี PR/PO ได้)
  // ใช้ isDoneStatus ไม่ใช่ doneStatusFor เพราะอู่นอกมีสถานะปิดงาน 2 แบบ (รถเสร็จ / เคลมอู่)
  if (isDoneStatus(status)) {
    const missing = requiredFieldsFor(status, jobType)
      .filter((f) => !String(merged[f.field] ?? "").trim())
    if (missing.length) {
      return {
        error: `ปิดงานเป็น "${status}" ต้องกรอกข้อมูลให้ครบก่อน: ${missing.map((m) => m.label).join(" · ")}`,
        missing,
      }
    }
  }
  return null
}
