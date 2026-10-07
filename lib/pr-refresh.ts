// lib/pr-refresh.ts — กติกาปุ่ม "ดึงข้อมูล ATMS" (หน้า /pr และ /ap-tracking ใช้ endpoint เดียวกัน)
//
// กดได้ทุก 30 นาที (ผู้ใช้กำหนด 2026-10-07) นับจากรอบ "ดึงเต็ม" ล่าสุดเท่านั้น
// ไม่นับรอบ PR รายชั่วโมง (atms_pr_quick) — เดิมนับทุกรอบ ปุ่มเลยล็อกเกือบตลอด
// ใช้ร่วมกันทั้ง server (ตัดสิน 429) และหน้าเว็บ (นับถอยหลังบนปุ่ม) — ไม่ import อะไร

export const REFRESH_COOLDOWN_MIN = 30
export const REFRESH_COUNTED_PIPELINES = ["atms_procurement_light", "atms_procurement"]

/** เวลาใน procurement_runs เป็น string ไม่มี timezone = UTC · คืน ms หรือ null */
export function parseRunTime(v: string | Date | null | undefined): number | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime()
  const s = String(v)
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)
  const t = Date.parse(hasTz ? s : s + "Z")
  return isNaN(t) ? null : t
}

/** นาทีที่ต้องรอก่อนกดได้อีก (0 = กดได้) */
export function refreshWaitMin(lastFullRunAt: string | Date | null | undefined, now: number): number {
  const t = parseRunTime(lastFullRunAt)
  if (t === null) return 0
  const ageMin = (now - t) / 60_000
  return ageMin < REFRESH_COOLDOWN_MIN ? Math.max(1, Math.ceil(REFRESH_COOLDOWN_MIN - ageMin)) : 0
}
