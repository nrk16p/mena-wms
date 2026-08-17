export const ADMIN_EMAILS = new Set([
  "bunphak.p@menatransport.co.th",
  "kittaboon.l@menatransport.co.th",
  "narongkorn.a@menatransport.co.th",
])

export function isAdmin(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has(email ?? "")
}

// ── ฝ่ายบัญชี ────────────────────────────────────────────────────────────────
// ใช้กับ "บัญชีตรวจเอกสาร" ในหน้า /ap-tracking — คนนอกฝ่ายเห็นผลตรวจได้แต่แก้ไม่ได้
// ระบุสิทธิ์ 2 ทางเพื่อไม่ให้ติดล็อกฝั่งใดฝั่งหนึ่ง:
//   1) department จาก HR (session.user.employee.department) ที่มีคำว่า บัญชี / account
//      → คนใหม่ที่ HR ย้ายเข้าฝ่ายได้สิทธิ์เองโดยไม่ต้องแก้โค้ด
//   2) อีเมลในลิสต์ข้างล่าง → ไว้เพิ่มคนที่ department ไม่ตรง (เช่นชื่อฝ่ายเขียนต่างออกไป)
export const ACCOUNTING_EMAILS = new Set<string>([
  // เพิ่มอีเมลฝ่ายบัญชีที่ department ไม่ตรงเกณฑ์ที่นี่
])

const ACCOUNTING_DEPT_RE = /บัญชี|account/i

export function isAccounting(
  email: string | null | undefined,
  department: string | null | undefined,
): boolean {
  // แอดมินระบบแก้ได้เสมอ — ไว้แก้แทนตอนฝ่ายบัญชีติดปัญหา และกันเคสลิสต์ว่างจนไม่มีใครแก้ได้เลย
  if (isAdmin(email)) return true
  if (ACCOUNTING_EMAILS.has(email ?? "")) return true
  return ACCOUNTING_DEPT_RE.test(department ?? "")
}
