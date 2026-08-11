import { NextRequest, NextResponse } from "next/server"
import { fetchAtmsTimeline } from "@/lib/atms-board"

// GET /api/repair-external/atms-timeline?plate=<ทะเบียน>&mr=<mr_id>
// Timeline รายคันจาก ATMS (maintenance-requests) — ใช้แสดงใน modal งานอู่นอก
export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("plate")?.trim() ?? ""
  const mr    = req.nextUrl.searchParams.get("mr")?.trim() ?? ""
  if (!plate) return NextResponse.json({ ok: false, error: "กรุณาระบุ ?plate=" }, { status: 400 })
  try {
    const data = await fetchAtmsTimeline(plate, mr || undefined)
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}
