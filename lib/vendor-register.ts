// ลงทะเบียน Vendor (/form-vendor) — ตรวจข้อมูลชุดเดียวใช้ทั้งฟอร์ม (client) และ API (server)
// เก็บที่ datawarehouse.vendor_registration (Bew 2026-10-27) — 1 เอกสาร = 1 ครั้งที่ส่งฟอร์ม
//
// {
//   _id:          ObjectId
//   firstName:    string            ชื่อ
//   lastName:     string            นามสกุล
//   fullName:     string            "ชื่อ นามสกุล" ไว้ค้น/แสดง
//   onBehalf:     string | null     ในนาม (ร้าน/บริษัทที่ออกบิล)
//   address:      string            ที่อยู่ (หลายบรรทัดได้)
//   phone:        string            ตัวเลขล้วน 9–10 หลัก ขึ้นต้น 0
//   taxId:        string            ตัวเลขล้วน 13 หลัก ผ่าน checksum
//   status:       "pending" | "approved" | "rejected"   ฝ่ายจัดซื้อตรวจ — เริ่มที่ pending
//   reviewedBy:   { name, email } | null
//   reviewedAt:   Date | null
//   reviewNote:   string | null
//   vendorCode:   string | null     รหัส vendor ในระบบหลัก — ใส่ตอนอนุมัติ/ผูกกับ vendor เดิม
//   source:       "form-vendor"
//   meta:         { ip: string | null, userAgent: string | null }
//   createdAt:    Date
//   updatedAt:    Date
// }
// index: { taxId: 1 } · { status: 1, createdAt: -1 } · { createdAt: -1 }

export const VR_DB = "datawarehouse"
export const VR_COLL = "vendor_registration"

export type VendorRegisterInput = { firstName: string; lastName: string; onBehalf: string; address: string; phone: string; taxId: string }
export type VendorRegisterKey = keyof VendorRegisterInput
export type VendorRegisterStatus = "pending" | "approved" | "rejected"

/** ความยาวสูงสุดต่อช่อง — กันข้อมูลขยะจากลิงก์สาธารณะ */
export const VR_MAX: Record<VendorRegisterKey, number> = { firstName: 100, lastName: 100, onBehalf: 200, address: 500, phone: 10, taxId: 13 }

/** เลขประจำตัวผู้เสียภาษี 13 หลัก — หลักสุดท้ายคือเลขตรวจสอบ (mod 11) แบบเดียวกับเลขบัตรประชาชน */
export function taxIdOk(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(id[12])
}

export function validateVendorRegister(f: VendorRegisterInput): Partial<Record<VendorRegisterKey, string>> {
  const e: Partial<Record<VendorRegisterKey, string>> = {}
  if (!f.firstName.trim()) e.firstName = "กรอกชื่อ"
  if (!f.lastName.trim()) e.lastName = "กรอกนามสกุล"
  if (!f.address.trim()) e.address = "กรอกที่อยู่"
  if (!/^0\d{8,9}$/.test(f.phone)) e.phone = "เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0"
  if (f.taxId.length !== 13) e.taxId = "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก"
  else if (!taxIdOk(f.taxId)) e.taxId = "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง — ตรวจสอบอีกครั้ง"
  for (const k of Object.keys(VR_MAX) as VendorRegisterKey[]) {
    if (!e[k] && f[k].trim().length > VR_MAX[k]) e[k] = `ยาวเกิน ${VR_MAX[k]} ตัวอักษร`
  }
  return e
}

/** รับ body ใด ๆ แล้วคืนเป็น input ที่ trim แล้ว (ช่องที่ไม่ใช่ string = ว่าง) */
export function normalizeVendorRegister(body: unknown): VendorRegisterInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "")
  const digits = (k: string) => s(k).replace(/\D/g, "")
  return { firstName: s("firstName"), lastName: s("lastName"), onBehalf: s("onBehalf"), address: s("address"), phone: digits("phone"), taxId: digits("taxId") }
}
