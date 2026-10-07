// lib/external-auditors.ts — ผู้ตรวจสอบภายนอก (AMT Audit) เข้า WMS ชั่วคราว (ผู้ใช้สั่ง 2026-10-07)
//
//   • เฉพาะ 5 อีเมลด้านล่าง · login ด้วย Google Workspace ของ amtaudit.com
//   • สิทธิ์ = เท่าแผนกจัดซื้อ แต่ "ดูอย่างเดียว" ทุกส่วน (lib/access-policy.ts accessFor) — ตั้งทับรายคนไม่ได้
//   • หมดสิทธิ์อัตโนมัติ 31/10/2569 23:59 เวลาไทย: login ไม่ได้ + middleware ตัดคนที่ค้าง login อยู่
//   • ไม่มีโปรไฟล์ HR → ใช้ auditorProfile() แทน (แผนกแสดงในหน้า /admin/users)
// ต่ออายุ / เพิ่มคน = แก้ค่าในไฟล์นี้ · ตรวจด้วย scripts/check-external-auditors.ts
import type { EmployeeProfile } from "./mena-api"

export const EMPLOYEE_DOMAIN = "menatransport.co.th"
export const AUDITOR_DOMAIN = "amtaudit.com"

export const EXTERNAL_AUDITORS = [
  "panthip@amtaudit.com",
  "jirapinya@amtaudit.com",
  "pannakan@amtaudit.com",
  "panida@amtaudit.com",
  "piyarat.w@amtaudit.com",
] as const

/** สิ้นวัน 31 ต.ค. 2569 เวลาไทย */
export const AUDITOR_EXPIRES_AT = Date.parse("2026-10-31T23:59:59.999+07:00")
export const AUDITOR_EXPIRES_LABEL = "31 ต.ค. 2569"
export const AUDITOR_DEPARTMENT = "ผู้ตรวจสอบภายนอก (AMT Audit)"

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase()
const LIST = new Set<string>(EXTERNAL_AUDITORS)

export function isExternalAuditor(email: string | null | undefined): boolean {
  return LIST.has(norm(email))
}

export function auditorActive(email: string | null | undefined, now: number = Date.now()): boolean {
  return isExternalAuditor(email) && now <= AUDITOR_EXPIRES_AT
}

/**
 * อีเมลนี้ login ได้ไหม (ส่วนโดเมน) — hd = Google Workspace ของบัญชี ถ้ามีต้องตรงโดเมนอีเมล
 * (การยืนยันอีเมล email_verified ยังตรวจใน lib/auth.ts)
 */
export function signInAllowed(email: string | null | undefined, hd: string | null | undefined, now: number = Date.now()): boolean {
  const e = norm(email)
  const domain = e.split("@")[1] ?? ""
  const h = hd ? hd.toLowerCase() : null
  if (domain === EMPLOYEE_DOMAIN) return !h || h === EMPLOYEE_DOMAIN
  if (auditorActive(e, now)) return !h || h === domain
  return false
}

/** โปรไฟล์แทน HR — department_id 5 (จัดซื้อจัดจ้าง) ให้หน้าติดตามคำสั่งซื้อเห็นทุกแผนกเท่าจัดซื้อ */
export function auditorProfile(email: string): EmployeeProfile {
  const e = norm(email)
  return {
    email: e,
    // ต้องมี username / department / position ไม่งั้น session-guard บังคับ logout (lib/session-profile.ts)
    username: e.split("@")[0],
    department_id: 5,
    department: AUDITOR_DEPARTMENT,
    position: `ผู้ตรวจสอบภายนอก — ดูอย่างเดียว ถึง ${AUDITOR_EXPIRES_LABEL}`,
  }
}
