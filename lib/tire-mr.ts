/**
 * MR (ใบซ่อมรถกินยาง) — สาเหตุ "รถกินยาง" เป็นสาเหตุเดียวที่ต้องซ่อมรถก่อน
 * ถึงจะอนุมัติเปลี่ยนยางได้ ไฟล์นี้เก็บกติกาสถานะไว้ที่เดียว ทั้ง API และหน้าจอใช้ร่วมกัน
 * (เดิมป้ายสถานะเขียนซ้ำในแต่ละหน้า ข้อความจึงเพี้ยนกัน เช่น "ซ่อมเสร็จ" กับ "ซ่อมเสร็จแล้ว")
 */

export const MR_STATUSES = ["pending", "in_progress", "completed"] as const
export type MrStatus = (typeof MR_STATUSES)[number]

export const MR_LABEL: Record<MrStatus, string> = {
  pending:     "รอดำเนินการ",
  in_progress: "กำลังซ่อม",
  completed:   "ซ่อมเสร็จแล้ว",
}

/** สถานะถัดไปที่กดได้ — เดินหน้าทีละขั้นเท่านั้น ปิดแล้วจบ */
export const MR_NEXT: Record<MrStatus, MrStatus | null> = {
  pending:     "in_progress",
  in_progress: "completed",
  completed:   null,
}

export const isMrStatus = (s: unknown): s is MrStatus =>
  typeof s === "string" && (MR_STATUSES as readonly string[]).includes(s)

/** อนุญาตเฉพาะ pending → in_progress → completed (ห้ามย้อน/ห้ามข้ามขั้น) */
export const canMrTransition = (from: string, to: MrStatus) =>
  isMrStatus(from) && MR_NEXT[from] === to

export function mrChip(status: string): { label: string; cls: string } {
  switch (status) {
    case "completed":   return { label: MR_LABEL.completed,   cls: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" }
    case "in_progress": return { label: MR_LABEL.in_progress, cls: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" }
    case "pending":     return { label: MR_LABEL.pending,     cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" }
    default:            return { label: status,               cls: "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400" }
  }
}

/** หนึ่งบรรทัดในไทม์ไลน์ MR — บันทึกทุกครั้งที่สร้าง/เปลี่ยนสถานะ */
export type MrLog = {
  status:    string
  note:      string
  updatedBy: string
  updatedAt: string
}

/** สรุป MR ล่าสุดของทะเบียน (payload ของ /api/tire-mr/latest) */
export type MrSummary = {
  mrId:      string
  status:    string
  note:      string
  updatedBy: string
  updatedAt: string
  createdBy: string
  createdAt: string
  logsCount: number
}
