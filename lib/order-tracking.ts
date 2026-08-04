// ติดตามคำสั่งซื้อ (Order Request Tracking) — ตั๋วงานครอบระบบ PR
// เกิดก่อนมี PR ได้ · เมื่อผูกเลข PR แล้ว sync สถานะจากข้อมูล ATMS (PR → PO → DD)

export type OtStatus = {
  value: string
  emoji: string
  cls: string    // tailwind chip (light + dark)
  color: string  // สีทึบ (chips/บาร์)
}

export const OT_STATUSES: OtStatus[] = [
  { value: "แจ้งเรื่อง",     emoji: "🆕", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",           color: "#9ca3af" },
  { value: "รับเรื่องแล้ว",   emoji: "🔄", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300", color: "#eab308" },
  { value: "เปิด PR แล้ว",   emoji: "📋", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",         color: "#06b6d4" },
  { value: "เปิด PO-รอของ", emoji: "📦", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",         color: "#3b82f6" },
  { value: "ปิดงาน",         emoji: "✅", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",     color: "#22c55e" },
]

export const OT_DONE_STATUS = "ปิดงาน"
export const OT_ACTIVE_STATUSES = OT_STATUSES.filter((s) => s.value !== OT_DONE_STATUS)

const OT_MAP = new Map(OT_STATUSES.map((s) => [s.value, s]))
export function otStatusMeta(value: string): OtStatus {
  return OT_MAP.get(value) ?? { value: value || "—", emoji: "", cls: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400", color: "#9ca3af" }
}

// ข้อมูล PR ที่ cache ไว้จากการ sync (อ่านอย่างเดียวจาก atms — ไม่แก้ต้นทาง)
export type PrSnapshot = {
  date:       string    // วันที่ PR
  warehouse:  string
  dept:       string
  requester:  string    // ผู้ขอซื้อใน PR
  total:      number
  poCodes:    string[]
  poTotal:    number
  suppliers:  string[]
  expectedDelivery: string  // วันคาดว่าจะได้รับ (manual จาก pr_tracking หรือจาก PO)
  hasDD:      boolean       // มีใบรับของแล้ว (เกณฑ์ปิดงานเดียวกับหน้า /pr)
}

export type OrderTracking = {
  _id:        string
  prCode:     string       // "" = ยังไม่มี PR
  title:      string       // เรื่องที่ขอ (สั้น)
  detail:     string       // รายละเอียดที่ต้องการ
  note:       string
  dept:       string       // แผนกผู้ขอ (dropdown จากแผนกใน PR)
  requester:  string       // ชื่อผู้เปิดเรื่อง (จาก session)
  requesterEmail: string
  status:     string
  acceptedBy: string       // จัดซื้อผู้รับเรื่อง (จาก session ตอนกดรับเรื่อง)
  acceptedAt: string       // YYYY-MM-DD
  estimatedDone: string    // YYYY-MM-DD ประมาณการเสร็จ (จัดซื้อกรอก)
  prSnapshot?: PrSnapshot | null
  prSyncedAt?: string
  closedAt:   string       // YYYY-MM-DD
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
}

// คำนวณสถานะจากข้อมูล PR จริง (ใช้ทั้งตอนสร้าง/แก้ไข/sync)
//  มี DD → ปิดงาน · มี PO → เปิด PO-รอของ · มีแค่ PR → เปิด PR แล้ว
export function statusFromSnapshot(snap: PrSnapshot | null | undefined, fallback: string): string {
  if (!snap) return fallback
  if (snap.hasDD) return OT_DONE_STATUS
  if (snap.poCodes.length > 0) return "เปิด PO-รอของ"
  return "เปิด PR แล้ว"
}
