// POST /api/vendor-portal/export-items {codes: string[]} — รายการสินค้าของหลายใบ สำหรับชีตที่ 2 ของ Excel
// ใบที่ไม่ใช่ของเจ้าที่ล็อกอิน / นอกช่วง / คลังสระบุรี ถูกตัดทิ้ง (ไม่บอกว่ามีอยู่จริงไหม)
import { NextRequest, NextResponse } from "next/server"
import { todayICT } from "@/lib/ap-tracking"
import { vpParseCodes, VP_EXPORT_MAX } from "@/lib/vendor-portal"
import { loadVpItemsBulk, requireVpAccount, vpSupplierNames } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const auth = await requireVpAccount(req)
    if (!auth) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
    const codes = vpParseCodes(await req.json().catch(() => null))
    if (codes === null) return NextResponse.json({ error: `ดาวน์โหลดได้ครั้งละไม่เกิน ${VP_EXPORT_MAX} ใบ กรองให้น้อยลงแล้วลองใหม่` }, { status: 400 })
    const { acc, db } = auth
    const names = await vpSupplierNames(db, acc.atmsCode)
    const rows = await loadVpItemsBulk(db, codes, names, todayICT())
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[vendor-portal/export-items]", e)
    return NextResponse.json({ error: "เตรียมไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
