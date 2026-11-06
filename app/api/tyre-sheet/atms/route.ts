import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { lookupAtms } from "@/lib/tyre-sheet-db"

// GET /api/tyre-sheet/atms?mr=SBMR26080286&plate=สบ.72-8509&position=RA4... — ปุ่มดึงจาก ATMS (ไม่บังคับ)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const mr = (sp.get("mr") ?? "").trim()
  if (!mr) return NextResponse.json({ error: "ใส่เลขใบแจ้งซ่อมก่อน" }, { status: 400 })
  try {
    const r = await lookupAtms(mr, sp.get("plate") ?? undefined, sp.get("position") ?? undefined)
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: `ดึงจาก ATMS ไม่สำเร็จ: ${String((e as Error).message ?? e)}` }, { status: 502 })
  }
}
