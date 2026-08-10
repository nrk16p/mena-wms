// เชื่อม "แผนก + สาขาของพนักงาน" (HR API) เข้ากับ "แผนกผู้ขอ" ของ ATMS (string ใน PR/order_tracking)
//
// ทำไมต้อง map: สองระบบใช้คนละคีย์
//   • HR   → department_id + site_id            เช่น 3 = "ยานยนต์", site 2 = ศลบ.
//   • ATMS → string ที่รวมสาขาไว้ในตัว           เช่น "ลาดกระบัง : ยานยนต์ (ศลบ)"
// หนึ่งแผนก HR จึงกินหลายรายการของ ATMS (กระจายตามสาขา) → ตัดให้เหลือเฉพาะสาขาตัวเองอีกชั้น
//
// กติกา: เห็นเฉพาะ "แผนกตัวเอง + สาขาตัวเอง"
//        ยกเว้น department_id 1 (ผู้บริหาร), 5 (จัดซื้อจัดจ้าง) และ role = admin → ทุกแผนก ทุกสาขา
//
// ใช้ที่: /order-tracking — ทั้งฝั่ง server (API) และ client (dropdown)

import type { EmployeeProfile } from "./mena-api"

export type HrDepartment = {
  id: number
  /** department_name_th ฝั่ง HR */
  name: string
  /** ค่า "แผนก" ฝั่ง ATMS ที่ถือว่าเป็นแผนกเดียวกัน (ทุกสาขา) */
  atms: string[]
}

/** department_id ที่เห็นได้ทุกแผนก — ผู้บริหาร (1) และจัดซื้อจัดจ้าง (5) */
export const FULL_ACCESS_DEPT_IDS = new Set([1, 5])

export const HR_DEPARTMENTS: HrDepartment[] = [
  {
    id: 1, name: "ผู้บริหาร", atms: [
      "กรุงเทพฯ : คณะกรรมการบริหาร",
      "กรุงเทพฯ : ฝ่ายบริหาร",
      "กรุงเทพฯ : สำนักกรรมการผู้จัดการ",
    ]
  },
  {
    id: 2, name: "วิเคราะห์ข้อมูลและต้นทุน", atms: [
      "กรุงเทพฯ : แผนกวิเคราะห์ข้อมูล (สกท)",
      "ลาดกระบัง : วิเคราะห์เชื้อเพลิง(ศลบ)",
    ]
  },
  {
    id: 3, name: "ยานยนต์", atms: [
      "ขอนแก่น : ยานยนต์ (ศขก)",
      "ลาดกระบัง : ยานยนต์ (ศลบ)",
      "สระบุรี : ยานยนต์ (สสบ)",
    ]
  },
  {
    id: 4, name: "การเงิน", atms: [
      "กรุงเทพฯ : บัญชีการเงิน (สกท)",
      "ลาดกระบัง : บัญชีการเงิน (ศลบ)",
      "สระบุรี : บัญชีการเงิน (สสบ)",
    ]
  },
  {
    id: 5, name: "จัดซื้อจัดจ้าง", atms: [
      "กรุงเทพฯ : จัดซื้อ กรุงเทพ",
      "ขอนแก่น : จัดซื้อจัดจ้าง(ศขก)",
      "ขอนแก่น : จัดซื้อสโตร์(ศขก)",
      "ลาดกระบัง : จัดซื้อจัดจ้าง(ศลบ)",
      "ลาดกระบัง : จัดซื้อสโตร์(ศลบ)",
      "สระบุรี : จัดซื้อจัดจ้าง(สสบ)",
      "สระบุรี : จัดซื้อสโตร์(สสบ)",
    ]
  },
  {
    id: 6, name: "บัญชี", atms: [
      "กรุงเทพฯ : บัญชีการเงิน (สกท)",
      "ลาดกระบัง : บัญชีการเงิน (ศลบ)",
      "สระบุรี : บัญชีการเงิน (สสบ)",
    ]
  },
  // ทรัพยากรบุคคลแตกเป็น 4 department_id ฝั่ง HR แต่ ATMS มองเป็น HR ของแต่ละสาขา
  { id: 7, name: "ทรัพยากรบุคคล [ค่าจ้างและสวัสดิการ]", atms: HR_SITE_DEPTS() },
  { id: 22, name: "ทรัพยากรบุคคล [สรรหา Mass]", atms: HR_SITE_DEPTS() },
  { id: 23, name: "ทรัพยากรบุคคล [สรรหา HRBP]", atms: HR_SITE_DEPTS() },
  { id: 24, name: "ทรัพยากรบุคคล [พัฒนาบุคลากรและองค์กร]", atms: HR_SITE_DEPTS() },
  // Safety ก็แตกหลาย department_id เช่นกัน — ATMS รวมเป็น "มาตรฐานความปลอดภัย" รายสาขา
  { id: 8, name: "มาตรฐานความปลอดภัย [Safety]", atms: SAFETY_SITE_DEPTS() },
  { id: 16, name: "Safety", atms: SAFETY_SITE_DEPTS() },
  { id: 17, name: "มาตรฐานความปลอดภัย [Compliance]", atms: SAFETY_SITE_DEPTS() },
  {
    id: 9, name: "ขายและรถร่วม", atms: [
      "กรุงเทพฯ : ขายสินค้า(ศลบ)",
      "ลาดกระบัง : ขายรถร่วม(ศลบ)",
    ]
  },
  {
    id: 10, name: "สำนักเลขาและงานกำกับดูแลการปฎิบัติงาน", atms: [
      "กรุงเทพฯ : สำนักเลขาและงานกำกับดูแลการปฎิบัติงาน",
    ]
  },
  { id: 11, name: "Operation Support", atms: ["กรุงเทพฯ : Operation Support"] },
  { id: 15, name: "จัดส่งลาดกระบัง", atms: ["ลาดกระบัง : จัดส่งลาดกระบัง"] },
  { id: 19, name: "จัดส่งสระบุรี", atms: ["สระบุรี : บริการจัดส่ง (สระบุรี)"] },
  { id: 20, name: "จัดส่งบางปะกง", atms: ["บางปะกง : จัดส่ง (บางปะกง)"] },
  { id: 21, name: "เทคโนโลยีสารสนเทศ", atms: ["กรุงเทพฯ : เทคโนโลยีสารสนเทศ"] },
]

function HR_SITE_DEPTS() {
  return [
    "กรุงเทพฯ : HR กรุงเทพ",
    "บางปะกง : ทรัพยากรบุคคล(ศบก)",
    "ลาดกระบัง : HR ลาดกระบัง",
    "สระบุรี : HR สระบุรี",
  ]
}

function SAFETY_SITE_DEPTS() {
  return [
    "DIST : มาตรฐานความปลอดภัย(Dist)",
    "ขอนแก่น : มาตรฐานความปลอดภัย(ศขก)",
    "ลาดกระบัง : มาตรฐานความปลอดภัย(ศลบ)",
    "สระบุรี : มาตรฐานความปลอดภัย(สสบ)",
  ]
}

/**
 * แผนกฝั่ง ATMS ที่ยังไม่มี department_id ฝั่ง HR รองรับ
 * → คนในแผนกเหล่านี้จะเห็นเฉพาะเรื่องที่ตัวเองเปิด จนกว่าจะเพิ่ม mapping ด้านบน
 */
export const UNMAPPED_ATMS_DEPTS = [
  "กรุงเทพฯ : Business Development",
  "ขอนแก่น : จัดส่ง ขอนแก่น",
  "DIST : จัดส่ง DIST",
]

// ── สาขา ──────────────────────────────────────────────────────────────────
// master จาก GET {MENA_API_URL}/sites/ (ดึง 2026-08-10) — เก็บไว้อ้างอิง/แสดงผล
// การมองเห็นไม่ได้ตัดตามสาขา: 1 แผนกเห็นสาขาย่อยของแผนกตัวเองครบทุกสาขา (ตามที่ตกลง 2026-08-10)

export type SiteRef = {
  id: number
  /** site_code / site_name_th ฝั่ง HR */
  code: string
  nameEn: string
  /** prefix ที่ใช้ใน string แผนกของ ATMS — null = ATMS ยังไม่มีแผนกของสาขานี้ */
  atms: string | null
}

export const SITES: SiteRef[] = [
  { id: 1, code: "สกท.", nameEn: "Bangkok HQ", atms: "กรุงเทพฯ" },
  { id: 2, code: "ศลบ.", nameEn: "Lat Krabang", atms: "ลาดกระบัง" },
  { id: 3, code: "สสบ.", nameEn: "Saraburi", atms: "สระบุรี" },
  { id: 4, code: "ศรย.", nameEn: "Rayong", atms: null },
  { id: 5, code: "ศขก.", nameEn: "Khon Kaen", atms: "ขอนแก่น" },
  { id: 6, code: "ศบก.", nameEn: "Bang Pakong", atms: "บางปะกง" },
]

// prefix "DIST" ของ ATMS ไม่ใช่สาขาในระบบ HR (ไม่มี site_id) — ผูกไว้ที่ระดับแผนกแทน
// เช่น "DIST : มาตรฐานความปลอดภัย(Dist)" อยู่ในชุดของแผนก Safety

const BY_ID = new Map(HR_DEPARTMENTS.map((d) => [d.id, d]))
const BY_NAME = new Map(HR_DEPARTMENTS.map((d) => [d.name.trim(), d]))
const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]))
const SITE_BY_CODE = new Map(SITES.map((s) => [s.code.replace(/\.$/, ""), s]))

/** สาขาของ string แผนกฝั่ง ATMS — ส่วนหน้า " : " เช่น "ลาดกระบัง : ยานยนต์ (ศลบ)" → "ลาดกระบัง" */
export function atmsSiteOf(dept: string): string {
  const i = dept.indexOf(":")
  return (i < 0 ? dept : dept.slice(0, i)).trim()
}

/** สาขาของพนักงาน — จาก site_id ก่อน ถ้าไม่มีค่อยเทียบรหัสสาขา (รองรับทั้ง "ศลบ." และ "ศลบ") */
export function resolveSite(emp: EmployeeProfile | null | undefined): SiteRef | null {
  if (emp?.site_id != null) {
    const byId = SITE_BY_ID.get(Number(emp.site_id))
    if (byId) return byId
  }
  const raw = emp?.site?.trim().replace(/\.$/, "")
  return raw ? SITE_BY_CODE.get(raw) ?? null : null
}

export type DeptScope = {
  /** true = เห็นได้ทุกแผนก (admin / ผู้บริหาร / จัดซื้อ) */
  all: boolean
  /** รายชื่อแผนกฝั่ง ATMS ที่มองเห็นได้ — แผนกตัวเองครบทุกสาขา (ว่าง = เห็นเฉพาะเรื่องที่ตัวเองเปิด) */
  depts: string[]
  /** แผนก HR ที่ resolve ได้ — null ถ้าโปรไฟล์ไม่มีข้อมูลแผนก */
  hr: HrDepartment | null
  /** สาขาต้นสังกัด — ใช้แสดงผลเท่านั้น ไม่ได้ใช้ตัดสิทธิ์ */
  site: SiteRef | null
}

/**
 * สรุปสิทธิ์การมองเห็นของผู้ใช้คนหนึ่ง — ยึด "แผนก" เป็นหลัก ครอบสาขาย่อยของแผนกนั้นทั้งหมด
 * ใช้ทั้งฝั่ง server (บังคับใน query) และ client (จำกัดตัวเลือกใน dropdown)
 */
export function deptScope(emp: EmployeeProfile | null | undefined, role?: string): DeptScope {
  if (role === "admin") return { all: true, depts: [], hr: null, site: null }

  // resolve ด้วย department_id ก่อน — ถ้าไม่มีค่อยเทียบจากชื่อแผนก (โปรไฟล์บางชุดมาแค่ชื่อ)
  const hr =
    (emp?.department_id != null ? BY_ID.get(Number(emp.department_id)) : undefined) ??
    (emp?.department ? BY_NAME.get(emp.department.trim()) : undefined) ??
    null

  const site = resolveSite(emp)
  if (hr && FULL_ACCESS_DEPT_IDS.has(hr.id)) return { all: true, depts: [], hr, site }

  return { all: false, depts: hr?.atms ?? [], hr, site }
}

/** ผู้ใช้คนนี้เลือก/บันทึกแผนกนี้ได้ไหม */
export function canUseDept(scope: DeptScope, dept: string): boolean {
  return scope.all || scope.depts.includes(dept.trim())
}
