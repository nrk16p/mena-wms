import { NextRequest, NextResponse } from "next/server"
import { fetchAtmsTimeline } from "@/lib/atms-board"

export const dynamic = "force-dynamic"

// GET ?plate=สบ.71-2380[&mr_id=175657] — Timeline ประวัติซ่อมรายคันจาก ATMS
export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("plate")?.trim() ?? ""
  const mrId = req.nextUrl.searchParams.get("mr_id")?.trim() ?? ""
  if (!plate) return NextResponse.json({ error: "กรุณาระบุทะเบียนรถ" }, { status: 400 })
  try {
    const data = await fetchAtmsTimeline(plate, mrId || undefined)
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}
