// lib/store-withdraw/link.ts — ผูกบัญชี ATMS ของสโตร์ (ตรวจกับ ATMS ผ่าน api-ncac แล้วเก็บแบบเข้ารหัส)
import { credStatus, saveCreds, type AtmsProfile } from "./creds"
import type { Actor } from "./db"
import { HttpError } from "./http"
import { NCAC_CONFIG_MSG, NcacConfigError, ncac } from "./ncac"

export const NO_CRED_KEY_MSG = "ยังไม่ได้ตั้งกุญแจเข้ารหัสบัญชี ATMS — แจ้งแอดมิน"

export async function linkAtmsAccount(actor: Actor, username: string, password: string) {
  if (!username || !password) throw new HttpError("กรอกชื่อผู้ใช้และรหัสผ่าน ATMS ให้ครบ", 400)
  // เช็กกุญแจเข้ารหัสก่อนแตะ ATMS — ไม่งั้นผู้ใช้กรอกรหัสผ่านไปแล้วค่อยไปพังตอนบันทึก
  if (!process.env.STORE_ATMS_CRED_KEY) {
    console.warn("[store-withdraw] ยังไม่ได้ตั้ง STORE_ATMS_CRED_KEY ผูกบัญชี ATMS ไม่ได้")
    throw new HttpError(NO_CRED_KEY_MSG, 503)
  }
  let r: { status: number; data: AtmsProfile | null }
  try {
    r = await ncac<AtmsProfile | null>("GET", "/atms/withdraw/whoami", { creds: { username, password } })
  } catch (e) {
    if (e instanceof NcacConfigError) throw new HttpError(NCAC_CONFIG_MSG, 502)
    throw new HttpError("ติดต่อ ATMS ไม่ได้ตอนนี้ รอสักครู่แล้วลองผูกใหม่", 502)
  }
  // 403 = api-ncac ไม่รับ key ของ WMS (ตั้งค่า) ไม่ใช่รหัสผ่านผู้ใช้ผิด · 401 = ATMS ไม่รับบัญชีนี้
  if (r.status === 403) throw new HttpError(NCAC_CONFIG_MSG, 502)
  if (r.status === 401) throw new HttpError("ATMS ไม่รับชื่อผู้ใช้หรือรหัสผ่านนี้ ตรวจแล้วลองใหม่", 422)
  if (r.status < 200 || r.status >= 300 || !r.data) throw new HttpError("อ่านโปรไฟล์จาก ATMS ไม่ได้ ลองใหม่อีกครั้ง", 502)
  const atmsEmail = String(r.data.email ?? "").trim().toLowerCase()
  if (atmsEmail !== actor.email) {
    throw new HttpError("อีเมลของบัญชี ATMS นี้ไม่ตรงกับอีเมลที่ล็อกอิน WMS ผูกได้เฉพาะบัญชีของตัวเอง", 403)
  }
  await saveCreds(actor.email, username, password, r.data)
  return credStatus(actor.email)
}
