// scripts/run-safety-stock-build.ts
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/run-safety-stock-build.ts [inventoryId]
//
// เรียก build ของหน้า /safety-stock จากเครื่องตัวเอง — งานเดียวกับที่ /api/cron/safety-stock-build
// (และ chain ท้าย /api/cron/atms-sku-report) รันทุกคืน ต่างแค่ไม่มี time budget จึงไม่ข้ามคลัง
// ใช้ตอนอยากให้ข้อมูลใหม่ขึ้นหน้าเว็บทันทีโดยไม่ต้องรอรอบตี 3
//
// เขียน safety_stock_snapshot ของคลังที่ระบุ (ไม่ระบุ = ทุกคลังใน WAREHOUSES) — งานหนักที่สุดคือ
// aggregation บน atms.stockmovement_v5 (~476k แถว) เท่ากับที่ cron ทำอยู่แล้วทุกคืน
import { runSafetyStockBuild } from "../lib/safety-stock-build"

async function main() {
  const inventoryId = process.argv[2] ?? null
  const t0 = Date.now()
  const res = await runSafetyStockBuild(inventoryId)
  console.log(`\nเสร็จใน ${Math.round((Date.now() - t0) / 1000)} วินาที · ok=${res.ok} error=${res.error ?? "-"}`)
  for (const r of res.results) {
    console.log(`  คลัง ${r.inventoryId}: เขียน ${r.written} แถว · เคลื่อนไหวล่าสุด ${r.latestMovementDate ?? "-"} · error=${r.error ?? "-"}`)
  }
  process.exit(res.ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
