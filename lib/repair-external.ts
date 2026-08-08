// สถานะงานซ่อมอู่นอก — workflow 7 ขั้น (เรียงตามลำดับการทำงาน)
export type RepairStatus = {
  value: string
  emoji: string
  cls: string  // tailwind chip (light + dark)
}

export const REPAIR_STATUSES: RepairStatus[] = [
  { value: "รอรถเข้า",         emoji: "⏳", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300" },
  { value: "รถเข้าอู่ซ่อม",     emoji: "🔧", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  { value: "รอใบเสนอราคา",     emoji: "🔍", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  { value: "รออนุมัติ",        emoji: "⏰", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "ซ่อมไม่มีกำหนด",    emoji: "🛠️", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "ซ่อมมีกำหนดเสร็จ",  emoji: "✅", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  { value: "รถเสร็จ(ไม่มี PR)", emoji: "🏁", cls: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300" },
  { value: "รถเสร็จ",          emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
]

export const REPAIR_STATUS_VALUES = REPAIR_STATUSES.map((s) => s.value)

// สถานะ "รถเสร็จ" = ปิดงาน — แยกไปหน้า "รถซ่อมเสร็จ" ส่วนที่เหลือคือ "รถซ่อมอู่นอก"
export const REPAIR_DONE_STATUS = "รถเสร็จ"

// ── ประเภทงาน: อู่นอก (ซ่อมอู่ภายนอก) | อะไหล่ลงคัน (สั่งซื้ออะไหล่มาลงคัน) ──
// เอกสารเก่าที่ไม่มี field jobType = อู่นอก
export const JOB_TYPE_GARAGE = "อู่นอก"
export const JOB_TYPE_PARTS  = "อะไหล่ลงคัน"
export const JOB_TYPES = [JOB_TYPE_GARAGE, JOB_TYPE_PARTS]

export const jobTypeOf = (r: { jobType?: string }) =>
  r.jobType === JOB_TYPE_PARTS ? JOB_TYPE_PARTS : JOB_TYPE_GARAGE

// workflow อะไหล่ลงคัน 6 ขั้น — "รอใบเสนอราคา"/"รออนุมัติ" ใช้ชื่อร่วมกับอู่นอก
export const PARTS_STATUSES: RepairStatus[] = [
  { value: "รอดำเนินการ",      emoji: "⏳", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300" },
  { value: "รอใบเสนอราคา",     emoji: "🔍", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" },
  { value: "รออนุมัติ",        emoji: "⏰", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "สั่งซื้อแล้ว-รอของ", emoji: "📦", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "ของถึง-รอลงคัน",   emoji: "🔩", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  { value: "ลงคันเสร็จ",       emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
]

export const PARTS_DONE_STATUS = "ลงคันเสร็จ"

// สถานะปิดงานของทั้ง 2 ประเภท — ใช้แยก active/done ทุกจุด (list, stats, sync, กันซ้ำ)
export const DONE_STATUSES = [REPAIR_DONE_STATUS, PARTS_DONE_STATUS]
export const isDoneStatus = (s: string) => DONE_STATUSES.includes(s)

export const statusesFor   = (jobType: string) => (jobType === JOB_TYPE_PARTS ? PARTS_STATUSES : REPAIR_STATUSES)
export const doneStatusFor = (jobType: string) => (jobType === JOB_TYPE_PARTS ? PARTS_DONE_STATUS : REPAIR_DONE_STATUS)

// ชื่อสถานะซ้ำกันระหว่าง 2 workflow ให้ meta ของอู่นอกชนะ (ความหมายเดียวกัน)
const STATUS_MAP = new Map([...PARTS_STATUSES, ...REPAIR_STATUSES].map((s) => [s.value, s] as const))

export function statusMeta(value: string): RepairStatus {
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

// SLA: สถานะที่ "ไม่ควรค้างเกิน N วัน" — เกินแล้วถือว่าค้าง (สถานะที่ไม่อยู่ในลิสต์ = ไม่จำกัด)
// ปกติวัดจาก statusSince (วันที่เข้าสถานะ) · ยกเว้นใน REPAIR_SLA_FROM_DUE ที่วัดจาก dueDate (วันกำหนดเสร็จ)
export const REPAIR_STATUS_SLA_DAYS: Record<string, number> = {
  "รอรถเข้า":       2,
  "รถเข้าอู่ซ่อม":   2,
  "รอใบเสนอราคา":   2,
  "รออนุมัติ":      2,
  "ซ่อมไม่มีกำหนด":  2,
  "ซ่อมมีกำหนดเสร็จ": 2,
  "รถเสร็จ(ไม่มี PR)": 2,
  // อะไหล่ลงคัน (ชื่อร่วม "รอใบเสนอราคา"/"รออนุมัติ" ใช้ค่าด้านบน)
  "รอดำเนินการ":      2,
  "สั่งซื้อแล้ว-รอของ": 2,
  "ของถึง-รอลงคัน":   2,
}

// สถานะที่วัด SLA จาก "วันกำหนดเสร็จ/ของถึง" (dueDate) แทน statusSince
export const REPAIR_SLA_FROM_DUE = new Set<string>(["ซ่อมมีกำหนดเสร็จ", "สั่งซื้อแล้ว-รอของ"])

// คำอธิบาย SLA สำหรับแสดงบน UI
export const REPAIR_SLA_NOTE =
  "ทุกสถานะไม่ควรค้างเกิน 2 วัน (นับจากวันเข้าสถานะ) · ยกเว้น ซ่อมมีกำหนดเสร็จ / สั่งซื้อแล้ว-รอของ นับจากวันกำหนดเสร็จ/กำหนดของถึง"

export type RepairField = keyof Omit<RepairExternal, "_id">

// ฟิลด์ที่ "ต้องกรอก" เมื่อเลือกสถานะนั้น (workflow-driven) — ใช้ทั้ง validate และ hint บน UI
export const REPAIR_STATUS_REQUIRED_FIELD: Record<string, { field: RepairField; label: string }> = {
  "รถเข้าอู่ซ่อม":    { field: "garageInDate",  label: "วันที่รถเข้าซ่อม" },
  // รอใบเสนอราคา: PR ไม่บังคับ (ยังไม่มี PR ก็ได้)
  "รออนุมัติ":        { field: "poCode",        label: "รหัส PO" },
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
