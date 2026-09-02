// app/api/vendors/capability/log/route.ts
// ประวัติการแก้ตารางความสามารถของอู่ 1 ราย — ใครติ๊กช่องไหน เอาออกเมื่อไหร่
// อ่านได้ทุกคนที่ล็อกอิน (ตารางนี้ทุกคนกรอกได้ ประวัติจึงต้องเปิดให้ตรวจสอบกันเองได้)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listVendorLog } from "@/lib/vendor"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: "ต้องล็อกอินก่อน" }, { status: 401 })
  }

  const vendor = (req.nextUrl.searchParams.get("vendor") ?? "").trim()
  if (!vendor) return NextResponse.json({ error: "ต้องระบุชื่ออู่" }, { status: 400 })

  const n = Number(req.nextUrl.searchParams.get("limit") ?? 300)
  const limit = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 1000) : 300

  try {
    return NextResponse.json(await listVendorLog(vendor, limit))
  } catch (e) {
    console.error("[vendors/capability/log] GET", e)
    return NextResponse.json({ error: "อ่านประวัติไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
