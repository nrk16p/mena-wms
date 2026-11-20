// GET /api/vendor-portal/hub-stock — ยอดฝากขาย (Hub) ของเจ้าที่ล็อกอิน เห็นเฉพาะของตัวเอง
import { NextRequest, NextResponse } from "next/server"
import { hubStockForVendor } from "@/lib/store-withdraw/hub-portal"
import { requireVpAccount } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const auth = await requireVpAccount(req)
    if (!auth) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
    const out = await hubStockForVendor(auth.acc.atmsCode)
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[vendor-portal/hub-stock]", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
