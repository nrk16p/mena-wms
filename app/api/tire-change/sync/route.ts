import { NextRequest, NextResponse } from "next/server"
import { runBranchSync, BRANCH_IDS, AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"

// POST /api/tire-change/sync — { branch: "latkrabang" | "saraburi", phpsessid? }
export async function POST(request: NextRequest) {
  const body       = await request.json().catch(() => ({}))
  const branch     = String(body.branch ?? "")
  const phpsessid  = String(body.phpsessid || process.env.ATMS_SESSION || "")

  if (!BRANCH_IDS[branch]) return NextResponse.json({ error: "branch must be latkrabang or saraburi" }, { status: 400 })
  if (!phpsessid)           return NextResponse.json({ error: "PHPSESSID is required" }, { status: 400 })

  try {
    const result = await runBranchSync(branch, phpsessid)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AtmsSessionError)
      return NextResponse.json({ error: "Session expired — วาง PHPSESSID ใหม่แล้วลองอีกครั้ง" }, { status: 401 })
    if (err instanceof AtmsNetworkError)
      return NextResponse.json({ error: `Failed to reach ATMS server: ${err.message}` }, { status: 502 })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
