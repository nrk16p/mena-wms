// app/api/cron/safety-stock-build/route.ts
import { NextRequest, NextResponse } from "next/server"
import { runSafetyStockBuild } from "@/lib/safety-stock-build"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// GET /api/cron/safety-stock-build — สร้าง safety_stock_snapshot จาก atms_sku_master + v5 + PR
// ต้องรันหลัง /api/cron/atms-sku-sync
// เดินทุกคลังใน WAREHOUSES ตามลำดับ (ทีละคลัง กันโหลด Mongo พร้อมกัน) — ?inventory=<id> จำกัดคลังเดียว
// ตรรกะจริงอยู่ใน lib/safety-stock-build.ts (runSafetyStockBuild) — ที่นี่เหลือแค่ auth guard + wiring response
// เพราะ /api/cron/atms-sku-report เรียกฟังก์ชันเดียวกันนี้ต่อท้ายงานของตัวเองด้วย (ดูคอมเมนต์ในไฟล์นั้น)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryParam = req.nextUrl.searchParams.get("inventory")
  const result = await runSafetyStockBuild(inventoryParam)

  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
