// เวลาไทย (Asia/Bangkok, UTC+7) — เซิร์ฟเวอร์ Vercel รันบน UTC
// ห้ามใช้ new Date().toISOString().slice(0,10) เป็น "วันนี้" เพราะช่วง 00:00-07:00 ตามเวลาไทย
// จะได้วันที่ของ "เมื่อวาน" (UTC ยังไม่ข้ามวัน)

export const BKK_OFFSET_MS = 7 * 3600 * 1000

/** วันที่ปัจจุบันตามเวลาไทย "YYYY-MM-DD" */
export const bkkToday = (): string =>
  new Date(Date.now() + BKK_OFFSET_MS).toISOString().slice(0, 10)

/** แปลงเวลาเป็นวันที่ไทย "YYYY-MM-DD" (รับ Date / ISO string) */
export function bkkDate(v: Date | string | null | undefined): string {
  if (!v) return ""
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  if (isNaN(t)) return typeof v === "string" ? v : ""
  return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * ISO 8601 พร้อม offset ไทย เช่น "2026-07-18T10:12:45.000+07:00"
 * เป็นเวลาเดียวกับ UTC แต่ผู้อ่าน/ระบบปลายทางเห็นเป็นเวลาไทยตรง ๆ
 * (ค่าที่ไม่ใช่เวลา เช่น "2026-07-18" คืนค่าเดิม)
 */
export function toBkkIso(v: Date | string | null | undefined): string {
  if (!v) return ""
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  if (isNaN(t)) return typeof v === "string" ? v : ""
  return new Date(t + BKK_OFFSET_MS).toISOString().replace("Z", "+07:00")
}

/**
 * จำนวนวันตามปฏิทินไทย จากวันที่ (YYYY-MM-DD) ถึงวันนี้
 * นับเป็น "วัน" จริง ไม่ใช่ 24 ชม. — เดิมใช้ (Date.now() - parse)/86400000 ทำให้ขาดไป 1 วัน
 * ในช่วง 00:00-07:00 เวลาไทย
 */
export function daysSince(dateStr: string): number | null {
  if (!dateStr) return null
  const t = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`)
  if (isNaN(t)) return null
  const todayDay = Math.floor((Date.now() + BKK_OFFSET_MS) / 86400000)
  return Math.max(0, todayDay - Math.floor(t / 86400000))
}

/** ปี พ.ศ./ค.ศ. ปัจจุบันตามเวลาไทย */
export const bkkYear = (): number => new Date(Date.now() + BKK_OFFSET_MS).getUTCFullYear()

/** วันที่ไทยย้อนหลัง n วัน "YYYY-MM-DD" */
export const bkkDaysAgo = (n: number): string =>
  new Date(Date.now() + BKK_OFFSET_MS - n * 86400000).toISOString().slice(0, 10)

/** แปลง field เวลาในอ็อบเจ็กต์ให้เป็นเวลาไทย (ใช้ก่อนส่งออก API) */
export function bkkTimestamps<T extends Record<string, unknown>>(obj: T, fields: string[]): T {
  const out = { ...obj } as Record<string, unknown>
  for (const f of fields) {
    const v = out[f]
    if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))) {
      out[f] = toBkkIso(v as Date | string)
    }
  }
  return out as T
}
