// lib/store-withdraw/env.ts — ค่าตั้งของงานเบิกอะไหล่ ใช้ค่าที่มีอยู่แล้วเป็นค่าเริ่มต้น (ไม่ต้องตั้ง env ใหม่ถ้าไม่จำเป็น)
// ไม่มี import ของ node — middleware (edge) ใช้ร่วมได้
//
//   กุญแจ drift-tick  : STORE_WITHDRAW_TICK_KEY  → ไม่ตั้ง = NCAC_API_KEY (ค่าเดียวกับ PIPELINE_API_KEY ของ api-ncac ที่มีอยู่แล้ว)
//   กุญแจผู้ขอ (API)  : STORE_WITHDRAW_API_KEYS  → ไม่ตั้ง = ATMS_API_KEY (กุญแจที่ Mena-Next ใช้คุยกับ WMS อยู่แล้ว)
//   บัญชีค้น ATMS     : ATMS_LOOKUP_USERNAME/PASSWORD → ไม่ตั้ง = ให้ api-ncac ใช้บัญชี ATMS ของตัวเอง (อ่านอย่างเดียว)

const list = (v: string | undefined) => (v ?? "").split(",").map((k) => k.trim()).filter(Boolean)

/** กุญแจของงานตั้งเวลา drift-tick */
export function tickKeys(): string[] {
  const own = list(process.env.STORE_WITHDRAW_TICK_KEY)
  return own.length ? own : list(process.env.NCAC_API_KEY)
}

/** กุญแจฝั่งผู้ขอ · กุญแจที่ตรงกับกุญแจ tick ใช้ไม่ได้เสมอ (แยกสองงานขาดจากกัน) */
export function requesterKeys(): string[] {
  const own = list(process.env.STORE_WITHDRAW_API_KEYS)
  const tick = tickKeys()
  return (own.length ? own : list(process.env.ATMS_API_KEY)).filter((k) => !tick.includes(k))
}

/** บัญชี ATMS สำหรับอ่าน · null = ไม่ส่งบัญชีไป ให้ api-ncac ใช้บัญชีของตัวเอง (เฉพาะ endpoint อ่าน) */
export function lookupCreds(): { username: string; password: string } | null {
  const username = process.env.ATMS_LOOKUP_USERNAME
  const password = process.env.ATMS_LOOKUP_PASSWORD
  return username && password ? { username, password } : null
}
