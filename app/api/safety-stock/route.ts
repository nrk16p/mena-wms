import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { getSafetyStock } from "@/lib/safety-stock"
import { INVENTORY_ID } from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.)

export async function GET(req: NextRequest) {
  try {
    const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID

    // middleware บังคับแค่ต้อง login — ผู้ใช้ที่ login แล้วทุกคนเรียก ?refresh=1 ซ้ำๆ ได้ไม่จำกัด แต่ละครั้งคือ
    // find ~4,100 doc + findOne อีก 2 ครั้ง เจาะ TTL cache 1 ชม.ทิ้งไปเปล่าๆ ต้องเช็คสิทธิ์แอดมินซ้ำที่นี่
    // (ปุ่ม "ดึงข้อมูลใหม่" ใน UI ซ่อนไว้แล้วสำหรับ non-admin แต่การกัน UI อย่างเดียวไม่พอ ต้องกันที่ API ด้วย)
    // non-admin ที่ขอ refresh มา — เงียบๆ คืน cache แทนการฟ้อง error ผู้ใช้ทั่วไปไม่ควรรู้สึกว่าปุ่มพัง
    let forceRefresh = false
    if (req.nextUrl.searchParams.get("refresh") === "1") {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      forceRefresh = token?.role === "admin"
    }

    // scope "parts": ตัดกลุ่ม "ยาง" + ต้องมีทั้ง min และ max พร้อมกัน — มุมมอง "นโยบายอะไหล่" ของหน้า /safety-stock
    // เอง เท่านั้น ไม่ใช่พฤติกรรมของ getSafetyStock โดยรวม — /api/tire-stock/safety ยังเรียกแบบ scope เดิม
    // ("full") เพื่อให้ /tire/{branch}/stock-tire เห็นข้อมูลครบเหมือนเดิมทุกประการ (ดู lib/safety-stock.ts)
    const data = await getSafetyStock(inventoryId, forceRefresh, "parts")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[safety-stock] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
