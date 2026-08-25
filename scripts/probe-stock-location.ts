// scripts/probe-stock-location.ts
// รัน: npx tsx scripts/probe-stock-location.ts [inventoryId ...]
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB — ตรวจว่าดึง "สถานที่จัดเก็บ" จากตารางประวัติสต๊อกของ ATMS ได้ครบไหม
// ใช้โค้ดเส้นทางเดียวกับที่ cron ใช้จริง (fetchStockLocationPage) จะได้รู้ตัวก่อนว่าหน้า ATMS เปลี่ยนรูปหรือยัง
import { atmsSkuSession, ensureRowsPerPage, fetchStockLocationPage } from "../lib/atms-sku-log"
import { ictDdmmyyyy } from "../lib/atms-parse"
import { WAREHOUSES } from "../lib/safety-stock-core"

const PACE_MS = 3000
const MAX_PAGES = 15
const DATE_LOOKBACK = 7
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : WAREHOUSES.map((w) => w.id)
  const phpsessid = atmsSkuSession()
  await ensureRowsPerPage(phpsessid, 1000)

  for (const inventoryId of targets) {
    const name = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? inventoryId
    let dateText = ""
    let total: number | null = null
    const map = new Map<string, string>()
    let fetched = 0

    for (let back = 0; back <= DATE_LOOKBACK; back++) {
      const d = ictDdmmyyyy(back)
      const res = await fetchStockLocationPage(inventoryId, 1, d, phpsessid)
      if (res.rows.length > 0) {
        dateText = d; total = res.total; fetched = res.rows.length
        for (const r of res.rows) map.set(r.code, r.location)
        break
      }
      console.log(`  ${name}: ${d} ยังไม่มีแถวประวัติสต๊อก — ถอยไปอีกวัน`)
      await sleep(PACE_MS)
    }
    if (!dateText) { console.log(`❌ ${name}: ไม่พบข้อมูลย้อนหลัง ${DATE_LOOKBACK} วัน`); continue }

    for (let page = 2; page <= MAX_PAGES && fetched < (total ?? 0); page++) {
      await sleep(PACE_MS)
      const res = await fetchStockLocationPage(inventoryId, page, dateText, phpsessid)
      for (const r of res.rows) map.set(r.code, r.location)
      fetched += res.rows.length
      if (res.rows.length === 0) break
    }

    const filled = [...map.values()].filter(Boolean).length
    const vals = new Set([...map.values()].filter(Boolean))
    console.log(`\n=== ${name} (inventory_id=${inventoryId}) · วันที่ ${dateText} ===`)
    console.log(`  ATMS รายงาน ${total ?? "?"} แถว · ดึงมา ${fetched} แถว · รหัสไม่ซ้ำ ${map.size}`)
    console.log(`  กรอกสถานที่จัดเก็บแล้ว ${filled} รหัส (${map.size ? Math.round((filled / map.size) * 100) : 0}%) · ค่าไม่ซ้ำ ${vals.size} ค่า`)
    console.log(`  ตัวอย่าง: ${[...vals].slice(0, 12).join(" · ")}`)
    if (total !== null && fetched < total) console.log(`  ⚠️ ดึงไม่ครบ (${fetched}/${total}) — ตรวจ order_by หรือ MAX_PAGES`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
