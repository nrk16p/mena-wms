// scripts/probe-on-order.ts
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/probe-on-order.ts [inventoryId ...]
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB และไม่แตะ aggregation บน stockmovement_v5
// ตรวจว่า "กำลังสั่งซื้อ" (PR ที่ยังไม่มี DD) ที่ build จะเขียนลง snapshot ออกมาเป็นตัวเลขเท่าไร
// ใช้ฟังก์ชันตัวเดียวกับที่ build เรียกจริง (fetchOnOrderBySku) จะได้รู้ตัวถ้า ATMS เปลี่ยนรูปข้อมูล
import clientPromise from "../lib/mongo"
import { fetchOnOrderBySku } from "../lib/on-order"
import { derive, isPartsPolicyRow, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, WAREHOUSES, type SnapshotRow } from "../lib/safety-stock-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const thb = (n: number) => Math.round(n).toLocaleString("th-TH")

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : WAREHOUSES.map((w) => w.id)
  const client = await clientPromise
  const snapCol = client.db(MASTER_DB).collection("safety_stock_snapshot")
  const asOf = new Date()

  for (const inventoryId of targets) {
    const name = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? inventoryId
    const t0 = Date.now()
    const onOrder = await fetchOnOrderBySku(client.db("atms"), inventoryId, asOf)
    const ms = Date.now() - t0
    const totalQty = [...onOrder.values()].reduce((a, o) => a + o.qty, 0)
    console.log(`\n=== ${name} (inventory_id=${inventoryId}) · query ${ms} ms ===`)
    console.log(`  รหัสที่มีของกำลังมา ${onOrder.size} รหัส · รวม ${totalQty.toLocaleString()} หน่วย`)

    const rows = (await snapCol.find({ inventoryId }).project({ _id: 0 }).toArray()) as unknown as SnapshotRow[]
    const parts = rows.filter(isPartsPolicyRow)
    const hit = parts.filter((r) => onOrder.get(r.code))
    let covered = 0, savedBaht = 0, needNow = 0
    for (const r of parts) {
      const before = derive(r, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS)
      const after = derive(r, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, onOrder.get(r.code)?.qty ?? 0)
      if (before.status === "out" || before.status === "below_rop" || before.status === "below_min") needNow++
      if (after.coveredByOrder) { covered++; savedBaht += before.suggestQty * r.cost }
    }
    console.log(`  แถวบนหน้า /safety-stock ${parts.length} · มีของกำลังมา ${hit.length}`)
    console.log(`  ตอนนี้ต้องสั่ง ${needNow} แถว → ขึ้นป้าย "สั่งแล้ว รอของ" ${covered} แถว ≈ ${thb(savedBaht)} บาทที่จะไม่สั่งซ้ำ`)
    const old = hit.filter((r) => (onOrder.get(r.code)?.oldestDays ?? 0) > 30)
    if (old.length) console.log(`  ⚠️ ${old.length} รหัสมีใบ PR ค้างเกิน 30 วัน — ควรตามของ ไม่ใช่สั่งเพิ่ม`)
    hit.slice(0, 6).forEach((r) => {
      const o = onOrder.get(r.code)!
      console.log(`    ${r.code.padEnd(16)} คงเหลือ ${String(r.stockQty).padStart(8)} + กำลังมา ${String(o.qty).padStart(6)} · PR ${o.prCount} ใบ (เก่าสุด ${o.oldestDays} วัน) ${o.prCodes[0] ?? ""}`)
    })
  }
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
