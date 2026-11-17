// lib/safety-stock-live-sync.ts — ปุ่ม "ดึงข้อมูลล่าสุดจาก ATMS" ในหน้า /safety-stock (ผู้ใช้สั่ง 17/11/2026)
//
// กดแล้ว api-ncac (/pipeline/wms-live-sync) ทำ 5 ขั้นต่อกันฝั่งเซิร์ฟเวอร์ ปิดหน้าเว็บไปก็ยังเดินต่อ:
//   sku → build1 → movement → procurement → build2  (ดู run_wms_live_sync ใน api-ncac routes/pipeline)
// ไฟล์นี้ไม่ import อะไร — ใช้ร่วมกันทั้ง route (ตัดสิน cooldown) และหน้าเว็บ (ป้ายขั้นตอน/นับถอยหลัง)

/** ย้อนหลังกี่วัน — ทั้งความเคลื่อนไหวและ PR/PO/DD */
export const LIVE_SYNC_DAYS = 14
/** กดซ้ำได้หลังรอบก่อนเริ่มไปแล้วเท่านี้ — ทั้งสายยิง ATMS หลายร้อยครั้ง กดรัวแล้ว ATMS ล่มทั้งบริษัท */
export const LIVE_SYNC_COOLDOWN_MIN = 15

export type LiveStepKey = "sku" | "build1" | "movement" | "procurement" | "build2"
export type LiveStepStatus = "pending" | "running" | "ok" | "error"
export type LiveStep = { status: LiveStepStatus; startedAt: string | null; finishedAt: string | null; note: string | null }
export type LiveSyncState = {
  status: "idle" | "running" | "ok" | "error"
  inventory?: string
  days?: number
  user?: string | null
  startedAt?: string
  finishedAt?: string | null
  error?: string | null
  steps?: Record<LiveStepKey, LiveStep>
}

export const LIVE_STEPS: { key: LiveStepKey; label: string }[] = [
  { key: "sku", label: "คงเหลือ/min/max" },
  { key: "build1", label: "คำนวณรอบแรก" },
  { key: "movement", label: `รับ/เบิก ${LIVE_SYNC_DAYS} วัน` },
  { key: "procurement", label: `PR/PO/DD ${LIVE_SYNC_DAYS} วัน` },
  { key: "build2", label: "คำนวณรอบสุดท้าย" },
]

/** นาทีที่ต้องรอก่อนกดได้อีก (0 = กดได้) */
export function liveSyncWaitMin(lastStartedAt: Date | string | null | undefined, now: number): number {
  if (!lastStartedAt) return 0
  const t = new Date(lastStartedAt).getTime()
  if (isNaN(t)) return 0
  const ageMin = (now - t) / 60_000
  return ageMin < LIVE_SYNC_COOLDOWN_MIN ? Math.max(1, Math.ceil(LIVE_SYNC_COOLDOWN_MIN - ageMin)) : 0
}

/** เวลาที่คำนวณรอบล่าสุดของสายนี้เสร็จ (build2 ก่อน ไม่มีก็ build1) — หน้าเว็บส่งเป็น ?after= ให้เจาะแคช
 *  null = ยังไม่มีรอบคำนวณไหนเสร็จ */
export function lastBuildDoneAt(s: LiveSyncState | null | undefined): string | null {
  const st = s?.steps
  if (!st) return null
  if (st.build2?.status === "ok" && st.build2.finishedAt) return st.build2.finishedAt
  if (st.build1?.status === "ok" && st.build1.finishedAt) return st.build1.finishedAt
  return null
}
