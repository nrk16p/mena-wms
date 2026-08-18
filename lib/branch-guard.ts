import { getServerSession } from "next-auth"
import { notFound } from "next/navigation"
import { authOptions } from "./auth"
import { branchScope, canSeeBranch } from "./branch-scope"

/** guard หน้าเฉพาะสาขา — คนสาขาอื่นเปิด URL ตรงๆ จะเจอ 404 (ไม่ใช่แค่ซ่อนเมนู) */
export async function assertBranchAccess(branch: string) {
  const session = await getServerSession(authOptions)
  const scope = branchScope(session?.user?.employee, session?.user?.role)
  if (!canSeeBranch(scope, branch)) notFound()
}
