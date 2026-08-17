"use client"

// ขอบเขตสาขาของผู้ใช้ที่ login อยู่ (ดูกติกาที่ lib/branch-scope.ts)
// `ready` = session โหลดเสร็จแล้ว — ระหว่างยังไม่เสร็จอย่าเพิ่งยิง API
// ไม่งั้นคนที่ถูกล็อกสาขาจะเห็นข้อมูลอีกสาขาแวบหนึ่งก่อนตัวกรองจะทำงาน

import { useMemo } from "react"
import { useSession } from "next-auth/react"
import { ALL_BRANCHES_SCOPE, branchScope, type BranchScope } from "@/lib/branch-scope"

export function useBranchScope(): BranchScope & { ready: boolean } {
  const { data: session, status } = useSession()
  const emp  = session?.user?.employee
  const role = session?.user?.role

  return useMemo(() => {
    if (status === "loading") return { ...ALL_BRANCHES_SCOPE, ready: false }
    return { ...branchScope(emp, role), ready: true }
  }, [status, emp, role])
}
