// app/api/cron/atms-sku-sync/route.ts
import { NextRequest, NextResponse } from "next/server"
import { runSkuSync } from "@/lib/safety-stock-sync"

export const maxDuration = 300
export const dynamic = "force-dynamic"

// GET /api/cron/atms-sku-sync — ดึง SKU ทุกคลังใน WAREHOUSES จากหน้า index ของ ATMS (ทีละคลัง)
// upsert stock/min/max เข้า atms_sku_master ให้ /api/cron/safety-stock-build ใช้ต่อ
// ?inventory=<id> ซิงก์คลังเดียว — ข้าม WAREHOUSES ทั้งหมด
// ป้องกันด้วย Authorization: Bearer <CRON_SECRET>
// ตรรกะจริงอยู่ใน lib/safety-stock-sync.ts (runSkuSync) — ที่นี่เหลือแค่ auth guard + wiring response
// เพราะ /api/cron/atms-sku-report เรียกฟังก์ชันเดียวกันนี้ต่อท้ายงานของตัวเองด้วย (ดูคอมเมนต์ในไฟล์นั้น)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryParam = req.nextUrl.searchParams.get("inventory")
  const result = await runSkuSync(inventoryParam)

  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
