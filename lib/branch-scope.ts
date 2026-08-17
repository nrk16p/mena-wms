// ขอบเขต "สาขา" ของโมดูลยาง — ตัดการมองเห็นจาก site_id ของพนักงาน (HR)
//
//   • site_id 2 (ศลบ.) → เห็นเฉพาะลาดกระบัง
//   • site_id 3 (สสบ.) → เห็นเฉพาะสระบุรี
//   • site_id อื่น / ไม่มีโปรไฟล์ / role = admin → เห็นทุกสาขาตามเดิม
//
// ใช้ทั้งฝั่ง client (ซ่อนเมนู + ล็อกตัวกรองสาขา) และ server (guard หน้าเฉพาะสาขา)
// หมายเหตุ: เป็นการตัด "การแสดงผล" — API ยังรับ branch ได้ทุกค่าเหมือนเดิม

import type { EmployeeProfile } from "./mena-api"

export const BRANCHES = [
  { value: "latkrabang", label: "ลาดกระบัง" },
  { value: "saraburi",   label: "สระบุรี" },
]

/** site_id ฝั่ง HR → สาขาของโมดูลยาง (site_id อื่นไม่ผูกกับสาขายาง = เห็นทุกสาขา) */
const BRANCH_BY_SITE_ID: Record<number, string> = { 2: "latkrabang", 3: "saraburi" }

export type BranchScope = {
  /** true = เห็นทุกสาขา (admin / site_id ที่ไม่ได้ผูกกับสาขายาง) */
  all: boolean
  /** สาขาเดียวที่เห็นได้ — null เมื่อเห็นทุกสาขา */
  only: string | null
  /** สาขาที่เห็นได้ทั้งหมด — ใช้ยิง API/วนลูป */
  branches: string[]
}

export const ALL_BRANCHES_SCOPE: BranchScope = {
  all: true, only: null, branches: BRANCHES.map((b) => b.value),
}

export function branchScope(emp?: EmployeeProfile | null, role?: string): BranchScope {
  if (role === "admin") return ALL_BRANCHES_SCOPE
  const only = emp?.site_id != null ? BRANCH_BY_SITE_ID[Number(emp.site_id)] : undefined
  return only ? { all: false, only, branches: [only] } : ALL_BRANCHES_SCOPE
}

export function canSeeBranch(scope: BranchScope, branch: string): boolean {
  return scope.all || scope.branches.includes(branch)
}
