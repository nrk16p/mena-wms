import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { getSafetyStock } from "@/lib/safety-stock"
import type { SafetyStockPayload } from "@/lib/safety-stock-core"
import { BRANCH_INVENTORY_ID, isTireRow } from "@/lib/tire-stock-safety"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.)

/** สต็อกยางของสาขา — ใช้ snapshot ตัวเดียวกับ /api/safety-stock แล้วกรองเหลือเฉพาะกลุ่ม "ยาง" หน่วย "เส้น"
 *  getSafetyStock() คืน structuredClone ทุกครั้ง การกรองตรงนี้จึงไม่แตะ cache ที่หน้า Safety Stock ใช้ร่วมกัน */
export async function GET(req: NextRequest) {
  try {
    const branch = req.nextUrl.searchParams.get("branch") ?? ""
    const inventoryId = BRANCH_INVENTORY_ID[branch]
    if (!inventoryId) {
      return NextResponse.json({ error: `ไม่รู้จักสาขา "${branch}"` }, { status: 400 })
    }

    // เหตุผลเดียวกับ /api/safety-stock: ?refresh=1 คือ full scan ~4,100 doc + เจาะ TTL cache 1 ชม.
    // ผู้ใช้ที่ login แล้วทุกคนยิงซ้ำได้ไม่จำกัดถ้าไม่กัน — non-admin คืน cache เงียบๆ ไม่ต้องฟ้อง error
    let forceRefresh = false
    if (req.nextUrl.searchParams.get("refresh") === "1") {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      forceRefresh = token?.role === "admin"
    }

    const data = await getSafetyStock(inventoryId, forceRefresh)
    const payload: SafetyStockPayload = { ...data, rows: data.rows.filter(isTireRow) }
    return NextResponse.json(payload)
  } catch (e) {
    console.error("[tire-stock/safety] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
