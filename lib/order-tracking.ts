// ติดตามคำขอเปิด PO (Order Request Tracking) — ตั๋วงานครอบระบบ PR
// เกิดก่อนมี PR ได้ · เมื่อผูกเลข PR แล้ว sync สถานะจากข้อมูล ATMS (PR → PO → DD)

export type OtStatus = {
  value: string
  emoji: string
  cls: string    // tailwind chip (light + dark)
  color: string  // สีทึบ (chips/บาร์)
}

// flow 4 ขั้น — แจ้งเรื่อง (มีหรือไม่มี PR = ขั้นเดียวกัน) → รับเรื่อง → PO → ปิดงาน
export const OT_STATUSES: OtStatus[] = [
  { value: "แจ้งเรื่อง",     emoji: "🆕", cls: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",           color: "#9ca3af" },
  { value: "รับเรื่องแล้ว",   emoji: "🔄", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300", color: "#eab308" },
  { value: "เปิด PO-รอของ", emoji: "📦", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",         color: "#3b82f6" },
  { value: "ปิดงาน",         emoji: "✅", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",     color: "#22c55e" },
]

// สถานะเก่า "เปิด PR แล้ว" ถูกยุบรวมกับแจ้งเรื่อง (2026-08-04) — map เอกสารเดิมให้เข้าขั้นที่ถูกต้อง
export function normalizeOtStatus(status: string, acceptedBy?: string): string {
  if (status === "เปิด PR แล้ว") return acceptedBy ? "รับเรื่องแล้ว" : "แจ้งเรื่อง"
  return status
}

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
  note:       string    // หมายเหตุจาก PR (sync มาแสดง)
  total:      number
  poCodes:    string[]
  poTotal:    number
  suppliers:  string[]
  expectedDelivery: string  // วันคาดว่าจะได้รับ (manual จาก pr_tracking หรือจาก PO)
  hasDD:      boolean       // มีใบรับของแล้ว (เกณฑ์ปิดงานเดียวกับหน้า /pr)
}

// รายชื่อแผนกทั้งหมดจาก dropdown ของ ATMS (ดึง 2026-08-04) — merge กับ distinct จาก PR ตอนใช้งาน
// เผื่อแผนกที่ยังไม่เคยเปิด PR ก็เลือกได้
export const DEPT_MASTER = [
  "DIST : จัดส่ง DIST",
  "DIST : มาตรฐานความปลอดภัย(Dist)",
  "กรุงเทพฯ : Business Development",
  "กรุงเทพฯ : HR กรุงเทพ",
  "กรุงเทพฯ : Operation Support",
  "กรุงเทพฯ : ขายสินค้า(ศลบ)",
  "กรุงเทพฯ : คณะกรรมการบริหาร",
  "กรุงเทพฯ : จัดซื้อ กรุงเทพ",
  "กรุงเทพฯ : บัญชีการเงิน (สกท)",
  "กรุงเทพฯ : ฝ่ายบริหาร",
  "กรุงเทพฯ : สำนักกรรมการผู้จัดการ",
  "กรุงเทพฯ : สำนักเลขาและงานกำกับดูแลการปฎิบัติงาน",
  "กรุงเทพฯ : เทคโนโลยีสารสนเทศ",
  "กรุงเทพฯ : แผนกวิเคราะห์ข้อมูล (สกท)",
  "ขอนแก่น : จัดซื้อจัดจ้าง(ศขก)",
  "ขอนแก่น : จัดซื้อสโตร์(ศขก)",
  "ขอนแก่น : จัดส่ง ขอนแก่น",
  "ขอนแก่น : มาตรฐานความปลอดภัย(ศขก)",
  "ขอนแก่น : ยานยนต์ (ศขก)",
  "บางปะกง : จัดส่ง (บางปะกง)",
  "บางปะกง : ทรัพยากรบุคคล(ศบก)",
  "ลาดกระบัง : HR ลาดกระบัง",
  "ลาดกระบัง : ขายรถร่วม(ศลบ)",
  "ลาดกระบัง : จัดซื้อจัดจ้าง(ศลบ)",
  "ลาดกระบัง : จัดซื้อสโตร์(ศลบ)",
  "ลาดกระบัง : จัดส่งลาดกระบัง",
  "ลาดกระบัง : บัญชีการเงิน (ศลบ)",
  "ลาดกระบัง : มาตรฐานความปลอดภัย(ศลบ)",
  "ลาดกระบัง : ยานยนต์ (ศลบ)",
  "ลาดกระบัง : วิเคราะห์เชื้อเพลิง(ศลบ)",
  "สระบุรี : HR สระบุรี",
  "สระบุรี : จัดซื้อจัดจ้าง(สสบ)",
  "สระบุรี : จัดซื้อสโตร์(สสบ)",
  "สระบุรี : บริการจัดส่ง (สระบุรี)",
  "สระบุรี : บัญชีการเงิน (สสบ)",
  "สระบุรี : มาตรฐานความปลอดภัย(สสบ)",
  "สระบุรี : ยานยนต์ (สสบ)",
]

// ไฟล์แนบ (ตามรูปแบบ SkuImage ของ lib/media)
export type OtImage = {
  mediaId:      number
  batchId:      string
  filename:     string
  webpUrl:      string
  thumbnailUrl: string
}

// บันทึกเหตุการณ์ของเรื่อง — ใครทำอะไรเมื่อไร (อิงชื่อ + email จาก session)
export type OtLogEntry = {
  action: "create" | "accept" | "update" | "close"
  by:      string
  byEmail: string
  at:      string   // ISO datetime
  note?:   string
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
  images?:    OtImage[]    // ไฟล์แนบ (รูป/เอกสาร)
  links?:     string[]     // ลิงก์แนบ (URL)
  log?:       OtLogEntry[] // เหตุการณ์: เปิดเรื่อง/รับเรื่อง/แก้ไข/ปิดงาน
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
}

// ลิงก์แนบ — รับเฉพาะ http(s), trim, ไม่เกิน 20 ลิงก์
export function cleanLinks(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => /^https?:\/\//i.test(x))
    .slice(0, 20)
}

// คำนวณสถานะจากข้อมูล PR จริง (ใช้ทั้งตอนสร้าง/แก้ไข/sync)
//  มี DD → ปิดงาน · มี PO → เปิด PO-รอของ · มีแค่ PR → คงขั้น manual เดิม (แจ้งเรื่อง/รับเรื่องแล้ว)
export function statusFromSnapshot(snap: PrSnapshot | null | undefined, fallback: string): string {
  if (!snap) return fallback
  if (snap.hasDD) return OT_DONE_STATUS
  if (snap.poCodes.length > 0) return "เปิด PO-รอของ"
  return fallback
}
