// app/api/vendors/route.ts
// Vendor List (Approved Vendor List) — ประวัติงานซ่อมรายอู่ + สถานะอนุมัติ
import { NextRequest, NextResponse } from "next/server"
import { getVendors } from "@/lib/vendor"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.) ไม่พึ่ง route cache

export async function GET(req: NextRequest) {
  try {
    const data = await getVendors(req.nextUrl.searchParams.get("refresh") === "1")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[vendors] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
