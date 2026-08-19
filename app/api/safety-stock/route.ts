import { NextRequest, NextResponse } from "next/server"
import { getSafetyStock } from "@/lib/safety-stock"
import { INVENTORY_ID } from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic" // cache จัดการเองใน lib (TTL 1 ชม.)

export async function GET(req: NextRequest) {
  try {
    const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
    const data = await getSafetyStock(inventoryId, req.nextUrl.searchParams.get("refresh") === "1")
    return NextResponse.json(data)
  } catch (e) {
    console.error("[safety-stock] ", e)
    return NextResponse.json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
