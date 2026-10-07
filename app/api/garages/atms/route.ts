import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getAtmsGarages } from "@/lib/atms-garage"

export const dynamic = "force-dynamic"

// GET /api/garages/atms — รายชื่ออู่ชุดเดียวกับ Mena-Next (atms.supplier_master) สำหรับ dropdown อู่
// ประเภท "อู่" ขึ้นก่อน · ประเภทอื่น (อะไหล่/แอร์/ยาง ...) ยังเลือกได้ เพราะบางงานซ่อมที่ร้านเหล่านี้
export async function GET() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ garages: await getAtmsGarages() })
  } catch (e) {
    console.error("[garages/atms] GET", e)
    return NextResponse.json({ error: "โหลดรายชื่ออู่จาก ATMS ไม่สำเร็จ" }, { status: 500 })
  }
}
