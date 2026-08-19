// แผนเข้าซ่อมอู่นอกล่วงหน้า — 1 ทะเบียนมีได้หลายแผน (คนละชั้นกับใบงานจริง repair_external
// ซึ่งกันซ้ำไว้ 1 งาน active ต่อคัน) · แปลงเป็นใบงานจริงเมื่อรถเข้าอู่ ผ่าน linkedRepairId

export type PlanStatusMeta = {
  value: string
  emoji: string
  cls: string   // tailwind chip (light + dark)
  bar: string   // สีแท่งบน gantt
}

export const PLAN_STATUSES: PlanStatusMeta[] = [
  { value: "วางแผน",     emoji: "⚪", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",              bar: "bg-gray-400 dark:bg-gray-500" },
  { value: "ยืนยันนัด",   emoji: "🔵", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",           bar: "bg-blue-500" },
  { value: "เข้าอู่แล้ว", emoji: "🟢", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",       bar: "bg-[#1B8C4B]" },
  { value: "ยกเลิก",      emoji: "❌", cls: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",               bar: "bg-red-300 dark:bg-red-800" },
]

export const PLAN_STATUS_VALUES = PLAN_STATUSES.map((s) => s.value)

// เข้าอู่แล้ว = แปลงเป็นใบงานจริงแล้ว (ผูก linkedRepairId) · ยกเลิก = ไม่แสดงบน gantt
export const PLAN_CONVERTED = "เข้าอู่แล้ว"
export const PLAN_CANCELLED = "ยกเลิก"

export function planStatusMeta(value: string): PlanStatusMeta {
  return (
    PLAN_STATUSES.find((s) => s.value === value) ?? {
      value: value || "—",
      emoji: "",
      cls: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400",
      bar: "bg-gray-400",
    }
  )
}

// รูปแบบเอกสารใน Mongo (master_data.repair_plans)
export type RepairPlan = {
  _id:            string
  plate:          string  // ทะเบียนรถ
  fleetNo:        string  // เบอร์รถ
  repairItems:    string  // รายการที่ต้องซ่อม (ขึ้นบรรทัดใหม่ = หลายรายการ)
  garage:         string  // อู่ที่จะเข้า
  plannedInDate:  string  // YYYY-MM-DD วันนัดเข้าอู่
  plannedOutDate: string  // YYYY-MM-DD วันคาดว่าเสร็จ ("" = แท่ง 1 วัน)
  planStatus:     string
  linkedRepairId: string  // _id ใบงาน repair_external เมื่อแปลงแล้ว
  note:           string
  // ประวัติเลื่อนนัด — ระบบ push เองเมื่อ plannedInDate เปลี่ยน (PUT)
  dateHistory?:   { from: string; to: string; by: string; at: string }[]
  createdBy?:     string
  editedBy?:      string
}
