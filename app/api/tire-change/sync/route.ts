import { NextRequest, NextResponse } from "next/server"
import { runBranchSync, BRANCH_IDS, AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { autoResolveTireRequests } from "@/lib/tire-request-auto"

// POST /api/tire-change/sync — { branch: "latkrabang" | "saraburi", phpsessid? }
export async function POST(request: NextRequest) {
  const body       = await request.json().catch(() => ({}))
  const branch     = String(body.branch ?? "")
  const phpsessid  = String(body.phpsessid || process.env.ATMS_SESSION || "")

  if (!BRANCH_IDS[branch]) return NextResponse.json({ error: "branch must be latkrabang or saraburi" }, { status: 400 })
  if (!phpsessid)           return NextResponse.json({ error: "PHPSESSID is required" }, { status: 400 })

  try {
    const result = await runBranchSync(branch, phpsessid)

    // sync สาขานี้สำเร็จแล้ว — ปิด/ปฏิเสธคำขอเปลี่ยนยางอัตโนมัติต่อเลยเฉพาะสาขานี้
    // (เหมือน cron/tire-sync แต่ขอบเขตแค่สาขาที่เพิ่ง sync) ครอบ try/catch กันพลาดแล้วทำให้
    // response การ sync หลักพัง — sync สำเร็จแล้วต้องคืนผลให้ผู้ใช้ได้ แม้ auto-resolve ล้ม
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let autoResolve: any = null
    try {
      autoResolve = await autoResolveTireRequests({ branches: [branch], rejectBranches: [branch] })
    } catch (err) {
      autoResolve = { error: err instanceof Error ? err.message : String(err) }
    }

    return NextResponse.json({ ...result, autoResolve })
  } catch (err) {
    if (err instanceof AtmsSessionError)
      return NextResponse.json({ error: "Session expired — วาง PHPSESSID ใหม่แล้วลองอีกครั้ง" }, { status: 401 })
    if (err instanceof AtmsNetworkError)
      return NextResponse.json({ error: `Failed to reach ATMS server: ${err.message}` }, { status: 502 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
