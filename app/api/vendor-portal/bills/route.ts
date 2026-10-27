// GET /api/vendor-portal/bills — ใบ DD ของเจ้าที่ล็อกอิน (ผ่าน whitelist ใน vpBillOf แล้ว)
import { NextRequest, NextResponse } from "next/server"
import { todayICT } from "@/lib/ap-tracking"
import { vpNextTransfer, vpWindowStart } from "@/lib/vendor-portal"
import { loadVpBills, requireVpAccount, vpSupplierNames } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const auth = await requireVpAccount(req)
    if (!auth) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
    const { acc, db } = auth
    const today = todayICT()
    const names = await vpSupplierNames(db, acc.atmsCode)
    const bills = await loadVpBills(db, names, today)
    return NextResponse.json(
      { vendor: { name: acc.displayName, username: acc.username }, today, windowStart: vpWindowStart(today), bills, next: vpNextTransfer(bills, today) },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    console.error("[vendor-portal/bills]", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
