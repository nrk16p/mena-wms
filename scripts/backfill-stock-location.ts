// scripts/backfill-stock-location.ts
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/backfill-stock-location.ts [inventoryId ...]
//
// เติม "สถานที่จัดเก็บ" ย้อนหลังครั้งเดียว ไม่ต้องรอ cron คืนถัดไป (25/08/2026 — รอบแรกที่เปิดใช้ฟีเจอร์นี้)
// เขียนแค่ฟิลด์ storageLocation ฟิลด์เดียว ไม่แตะฟิลด์อื่นเลย:
//   • atms_sku_master      — filter ด้วย skuPk (unique index) ให้ build คืนถัดไปมีค่าใช้ต่อ
//   • safety_stock_snapshot — filter ด้วย _id = "{inventoryId}|{code}" (primary key) ให้หน้าเว็บเห็นทันที
// ทั้งสอง collection ยิงตรงตาม index ไม่มี collscan · ไม่แตะ aggregation บน stockmovement_v5 เลย
// จึงไม่ต้อง rebuild snapshot ใหม่ทั้งก้อนซึ่งกิน DB หนักกว่ามาก
//
// เขียนเฉพาะแถวที่ค่าเปลี่ยนจริง — รันซ้ำได้ ไม่มีผลข้างเคียง (รอบสองจะรายงาน 0 แถว)
import clientPromise from "../lib/mongo"
import { atmsSkuSession, ensureRowsPerPage, fetchStockLocationPage } from "../lib/atms-sku-log"
import { ictDdmmyyyy } from "../lib/atms-parse"
import { WAREHOUSES } from "../lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"
const PACE_MS = 3000
const MAX_PAGES = 15
const DATE_LOOKBACK = 7
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** แมปรหัสสินค้า → สถานที่จัดเก็บ ของทั้งคลัง · โยน error ถ้าได้มาไม่ครบ (ห้ามเขียนแมปครึ่งเดียวทับของจริง) */
async function fetchLocations(inventoryId: string, phpsessid: string): Promise<{ map: Map<string, string>; dateText: string }> {
  let dateText = ""
  let total: number | null = null
  let fetched = 0
  const map = new Map<string, string>()

  for (let back = 0; back <= DATE_LOOKBACK; back++) {
    const d = ictDdmmyyyy(back)
    const res = await fetchStockLocationPage(inventoryId, 1, d, phpsessid)
    if (res.rows.length > 0) {
      dateText = d; total = res.total; fetched = res.rows.length
      for (const r of res.rows) map.set(r.code, r.location)
      break
    }
    console.log(`  ${d} ยังไม่มีแถวประวัติสต๊อก — ถอยไปอีกวัน`)
    await sleep(PACE_MS)
  }
  if (!dateText) throw new Error(`ไม่พบแถวประวัติสต๊อกย้อนหลัง ${DATE_LOOKBACK} วัน`)

  for (let page = 2; page <= MAX_PAGES && fetched < (total ?? 0); page++) {
    await sleep(PACE_MS)
    const res = await fetchStockLocationPage(inventoryId, page, dateText, phpsessid)
    if (res.rows.length === 0) break
    for (const r of res.rows) map.set(r.code, r.location)
    fetched += res.rows.length
  }
  if (total !== null && fetched < total) throw new Error(`ดึงไม่ครบ — ได้ ${fetched} จาก ${total} แถว`)
  return { map, dateText }
}

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : WAREHOUSES.map((w) => w.id)
  const phpsessid = atmsSkuSession()
  const client = await clientPromise
  const db = client.db(DB)
  const masterCol = db.collection("atms_sku_master")
  const snapCol = db.collection("safety_stock_snapshot")

  await ensureRowsPerPage(phpsessid, 1000)

  for (const inventoryId of targets) {
    const name = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? inventoryId
    console.log(`\n=== ${name} (inventory_id=${inventoryId}) ===`)
    const { map, dateText } = await fetchLocations(inventoryId, phpsessid)
    const filled = [...map.values()].filter(Boolean).length
    console.log(`  ATMS ${dateText}: ${map.size} รหัส · กรอกสถานที่แล้ว ${filled} รหัส`)

    // atms_sku_master — อ่าน skuPk/code/ค่าเดิมมาก่อน แล้วเขียนเฉพาะแถวที่เปลี่ยนจริง (filter ด้วย skuPk = unique index)
    const masters = await masterCol
      .find({ inventoryId }, { projection: { _id: 0, skuPk: 1, code: 1, storageLocation: 1 } })
      .toArray()
    const masterOps = masters
      .map((m) => ({ skuPk: m.skuPk as number, next: map.get(String(m.code)) ?? "", prev: String(m.storageLocation ?? "") }))
      .filter((x) => x.next !== x.prev)
      .map((x) => ({ updateOne: { filter: { skuPk: x.skuPk }, update: { $set: { storageLocation: x.next } } } }))
    if (masterOps.length) await masterCol.bulkWrite(masterOps, { ordered: false })
    console.log(`  atms_sku_master: ${masters.length} แถวในคลัง → เขียน ${masterOps.length} แถว`)

    // safety_stock_snapshot — _id คือ "{inventoryId}|{code}" อยู่แล้ว ยิงตรง primary key
    const snaps = await snapCol
      .find({ inventoryId }, { projection: { _id: 1, code: 1, storageLocation: 1 } })
      .toArray()
    const snapOps = snaps
      .map((s) => ({ id: s._id, next: map.get(String(s.code)) ?? "", prev: String(s.storageLocation ?? "") }))
      .filter((x) => x.next !== x.prev)
      .map((x) => ({ updateOne: { filter: { _id: x.id }, update: { $set: { storageLocation: x.next } } } }))
    if (snapOps.length) await snapCol.bulkWrite(snapOps, { ordered: false })
    const snapFilled = snaps.filter((s) => map.get(String(s.code))).length
    console.log(`  safety_stock_snapshot: ${snaps.length} แถว → เขียน ${snapOps.length} แถว · มีสถานที่ ${snapFilled}/${snaps.length} (${snaps.length ? Math.round((snapFilled / snaps.length) * 100) : 0}%)`)

    if (targets.indexOf(inventoryId) < targets.length - 1) await sleep(PACE_MS)
  }

  console.log("\n✅ เสร็จ — หน้า /safety-stock ต้องกด \"ดึงข้อมูลใหม่\" (หรือรอ TTL cache 1 ชม.) ถึงจะเห็นค่าใหม่")
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
