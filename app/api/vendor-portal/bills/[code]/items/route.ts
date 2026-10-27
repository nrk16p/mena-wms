// GET /api/vendor-portal/bills/[code]/items — รายการสินค้าในใบ DD
// ไม่ใช่ใบของเจ้านี้ / นอกช่วง / คลังสระบุรี / ไม่มีใบ → 404 แบบเดียวกันหมด (เดาไม่ได้ว่าใบมีอยู่จริงไหม)
import { NextRequest, NextResponse } from "next/server"
import { todayICT } from "@/lib/ap-tracking"
import { loadVpItems, requireVpAccount, vpSupplierNames } from "@/lib/vendor-portal-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params
    const auth = await requireVpAccount(req)
    if (!auth) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
    const { acc, db } = auth
    const names = await vpSupplierNames(db, acc.atmsCode)
    const out = await loadVpItems(db, decodeURIComponent(code ?? ""), names, todayICT())
    if (!out) return NextResponse.json({ error: "ไม่พบใบนี้" }, { status: 404 })
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[vendor-portal/items]", e)
    return NextResponse.json({ error: "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
