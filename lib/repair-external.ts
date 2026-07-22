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
  { value: "รถเสร็จ",          emoji: "🏁", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
]

export const REPAIR_STATUS_VALUES = REPAIR_STATUSES.map((s) => s.value)

// สถานะ "รถเสร็จ" = ปิดงาน — แยกไปหน้า "รถซ่อมเสร็จ" ส่วนที่เหลือคือ "รถซ่อมอู่นอก"
export const REPAIR_DONE_STATUS = "รถเสร็จ"

const STATUS_MAP = new Map(REPAIR_STATUSES.map((s) => [s.value, s]))

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
  receivedDate: string  // YYYY-MM-DD  วันที่รับแจ้ง
  garageInDate: string  // YYYY-MM-DD  วันที่รถเข้าอู่ซ่อม
  dueDate:      string  // YYYY-MM-DD  วันกำหนดเสร็จ (คาดว่าเสร็จ)
  completedDate:string  // YYYY-MM-DD  วันที่ซ่อมเสร็จ (จริง)
  mrNo:         string  // เลขใบแจ้งซ่อม MR
  symptom:      string  // รายละเอียดอาการ
  plate:        string  // ทะเบียนรถ
  fleetNo:      string  // เบอร์รถ
  fleet:        string  // ฟลีท (auto จาก atms.vehicle_daily)
  plant:        string  // แพล้นท์ (auto จาก atms.vehicle_daily)
  garage:       string  // อู่
  status:       string  // สถานะ
  prCode:       string  // รหัส PR
  poCode:       string  // รหัส PO
  note:         string  // หมายเหตุ
  repairPrice:  number  // ราคาซ่อม
  warranty:     string  // รับประกัน
  offerPrice:      number       // ราคาเสนอครั้งแรก (ก่อนต่อรอง)
  negotiatedPrice: number       // ราคาต่อรอง (หลังต่อรอง)
  offerWarranty:   string       // ประกันเสนอครั้งแรก
  negotiationImages?: RepairImage[] // ไฟล์หลักฐานการต่อรอง
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
}

// สถานะที่วัด SLA จาก "วันกำหนดเสร็จ" (dueDate) แทน statusSince
export const REPAIR_SLA_FROM_DUE = new Set<string>(["ซ่อมมีกำหนดเสร็จ"])

// คำอธิบาย SLA สำหรับแสดงบน UI
export const REPAIR_SLA_NOTE =
  "รอรถเข้า / รถเข้าอู่ซ่อม / รอใบเสนอราคา / รออนุมัติ / ซ่อมไม่มีกำหนด ไม่ควรค้างเกิน 2 วัน (นับจากวันเข้าสถานะ) · ซ่อมมีกำหนดเสร็จ ไม่ควรเกิน 2 วันจากวันกำหนดเสร็จ"

export type RepairField = keyof Omit<RepairExternal, "_id">

// ฟิลด์ที่ "ต้องกรอก" เมื่อเลือกสถานะนั้น (workflow-driven) — ใช้ทั้ง validate และ hint บน UI
export const REPAIR_STATUS_REQUIRED_FIELD: Record<string, { field: RepairField; label: string }> = {
  "รถเข้าอู่ซ่อม":    { field: "garageInDate",  label: "วันที่รถเข้าซ่อม" },
  // รอใบเสนอราคา: PR ไม่บังคับ (ยังไม่มี PR ก็ได้)
  "รออนุมัติ":        { field: "poCode",        label: "รหัส PO" },
  "ซ่อมมีกำหนดเสร็จ": { field: "dueDate",       label: "วันกำหนดเสร็จ" },
  "รถเสร็จ":          { field: "completedDate", label: "วันที่ซ่อมเสร็จ" },
}

// สถานะปลายทาง (ปิดงาน) — ห้ามย้อนสถานะกลับเมื่อถึงสถานะนี้แล้ว
export const REPAIR_LOCKED_STATUS = "รถเสร็จ"

// ฟิลด์ที่ต้องกรอก "สะสม" ถึงสถานะเป้าหมาย — รวมของทุกสถานะก่อนหน้าใน workflow ด้วย
// (ข้ามสถานะได้ก็ต่อเมื่อกรอกข้อมูลของสถานะที่ข้ามครบ)
export function requiredFieldsFor(status: string): { field: RepairField; label: string }[] {
  const idx = REPAIR_STATUSES.findIndex((s) => s.value === status)
  if (idx < 0) return []
  const out: { field: RepairField; label: string }[] = []
  for (let i = 0; i <= idx; i++) {
    const req = REPAIR_STATUS_REQUIRED_FIELD[REPAIR_STATUSES[i].value]
    if (req) out.push(req)
  }
  return out
}
