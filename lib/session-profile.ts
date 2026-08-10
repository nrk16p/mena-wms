// ฟิลด์โปรไฟล์พนักงานที่ WMS ถือว่า "จำเป็น" ต้องมีใน session
// ใช้ร่วมกันทั้งฝั่ง server (lib/auth.ts ตอนสร้าง JWT) และ client (components/session-guard.tsx)

import type { EmployeeProfile } from "./mena-api"

export const REQUIRED_EMPLOYEE_FIELDS = ["username", "department", "position"] as const

export type RequiredEmployeeField = (typeof REQUIRED_EMPLOYEE_FIELDS)[number]

export const EMPLOYEE_FIELD_LABELS: Record<RequiredEmployeeField, string> = {
  username:   "ชื่อผู้ใช้ (username)",
  department: "แผนก (department)",
  position:   "ตำแหน่ง (position)",
}

/** คืนรายชื่อฟิลด์จำเป็นที่ยังขาด — ว่าง = ข้อมูลครบ (ไม่มีโปรไฟล์เลย = ขาดทุกฟิลด์) */
export function missingEmployeeFields(emp?: EmployeeProfile | null): RequiredEmployeeField[] {
  if (!emp) return [...REQUIRED_EMPLOYEE_FIELDS]
  return REQUIRED_EMPLOYEE_FIELDS.filter((f) => {
    const v = emp[f]
    return v === undefined || v === null || String(v).trim() === ""
  })
}
