import "next-auth"
import "next-auth/jwt"
import type { EmployeeProfile } from "@/lib/mena-api"
import type { Access } from "@/lib/access-policy"

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null
      email?: string | null
      image?: string | null
      role: "admin" | "user"
      /** โปรไฟล์พนักงานจาก Mena API (undefined ถ้า login ฝั่ง API ไม่สำเร็จ) */
      employee?: EmployeeProfile
      /** สิทธิ์ต่อส่วนงานที่คำนวณแล้ว (แผนก + override + admin) — lib/access-policy.ts */
      access: Access
      isSuperAdmin: boolean
    }
    /** ข้อความ error ถ้าแลก id_token กับ Mena API ไม่ผ่าน */
    apiAuthError?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "admin" | "user"
    /** access token ของ Mena API — อยู่ใน JWT cookie (HttpOnly) เท่านั้น ไม่ส่งออกไปที่ client session */
    apiToken?: string
    apiTokenExpires?: number
    employee?: EmployeeProfile
    apiAuthError?: string
    /** override รายส่วนงานที่ superadmin ตั้งทับ (wms_access_overrides) */
    accessOverrides?: Record<string, unknown>
    /** เวลาที่รีเฟรชสิทธิ์ล่าสุด (ms) — lib/access-refresh.ts */
    accessAt?: number
  }
}
