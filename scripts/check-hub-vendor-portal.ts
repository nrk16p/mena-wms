// scripts/check-hub-vendor-portal.ts — Sub เห็นแค่ยอด Hub ของตัวเอง
// รัน: npx tsx scripts/check-hub-vendor-portal.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server)
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_WITHDRAW_DB = "hub_vp_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient } = await import("../lib/store-withdraw/db")
  setStoreWithdrawClient(client)
  const { hubCols } = await import("../lib/store-withdraw/hub-db")
  const { hubStockForVendor } = await import("../lib/store-withdraw/hub-portal")
    const c = await hubCols()
  const now = new Date()

  await c.vendors.insertMany([
    { code: "VEN-00008", name: "อู่แปด", active: true, createdAt: now },
    { code: "V2", name: "อู่สอง", active: true, createdAt: now },
    { code: "VEN-00009", name: "อู่เก้า ปิดแล้ว", active: false, createdAt: now },
  ])
  const item = (vendorCode: string, skuId: number, skuCode: string, price: number | null) => ({
    inventoryId: 4, vendorCode, skuId, skuCode, skuName: `ชื่อ ${skuCode}`, unit: "ชิ้น", price, active: true, updatedAt: now,
  })
  await c.items.insertMany([item("VEN-00008", 1, "A-1", 99), item("VEN-00008", 2, "A-2", null), item("V2", 3, "B-1", 50), item("VEN-00009", 4, "C-1", 10)])
  await c.stock.insertMany([
    { inventoryId: 4, vendorCode: "VEN-00008", skuId: 1, qty: 5 },
    { inventoryId: 4, vendorCode: "VEN-00008", skuId: 2, qty: 0 },
    { inventoryId: 4, vendorCode: "V2", skuId: 3, qty: 7 },
    { inventoryId: 4, vendorCode: "VEN-00009", skuId: 4, qty: 3 },
  ])

  // ตรงตัวเท่านั้น: "8" ไม่เห็น VEN-00008 · ตัวพิมพ์/ช่องว่างไม่สำคัญ
  eq(await hubStockForVendor("8"), { enabled: false, rows: [] })
  const r8 = await hubStockForVendor(" ven-00008 ")
  eq(r8.enabled, true)
  eq(r8.rows.map((r) => r.skuCode), ["A-1", "A-2"])
  eq(r8.rows.map((r) => r.qty), [5, 0])
  for (const r of r8.rows) eq(Object.keys(r).sort(), ["qty", "skuCode", "skuName", "unit"])

  const r2 = await hubStockForVendor("V2")
  eq(r2.rows.map((r) => r.skuCode), ["B-1"])
  eq(JSON.stringify(r8).includes("B-1"), false)
  for (const alias of ["2", "VEN-00002", "X-2"]) eq(await hubStockForVendor(alias), { enabled: false, rows: [] }, alias)

  // 182 กับ VEN-00182 แยกกัน
  await c.vendors.insertOne({ code: "VEN-00182", name: "อู่ 182", active: true, createdAt: now })
  await c.items.insertOne(item("VEN-00182", 8, "D-1", null))
  await c.stock.insertOne({ inventoryId: 4, vendorCode: "VEN-00182", skuId: 8, qty: 1 })
  eq(await hubStockForVendor("182"), { enabled: false, rows: [] })
  eq((await hubStockForVendor("VEN-00182")).rows.length, 1)

  // SKU เดียวกันหลาย Hub → รวมเป็นแถวเดียว
  await c.items.insertOne({ ...item("VEN-00008", 1, "A-1", 99), inventoryId: 5 })
  await c.stock.insertOne({ inventoryId: 5, vendorCode: "VEN-00008", skuId: 1, qty: 4 })
  const merged = await hubStockForVendor("VEN-00008")
  eq(merged.rows.map((r) => [r.skuCode, r.qty]), [["A-1", 9], ["A-2", 0]])

  // ขยะ/ปิดใช้งาน → ปิดแท็บ
  for (const bad of ["77", "VEN-00009", "", "   ", null, undefined, "abc", 0]) {
    eq(await hubStockForVendor(bad), { enabled: false, rows: [] }, `bad=${String(bad)}`)
  }

  // Sub ที่ active แต่ยังไม่มีของ → เปิดแท็บ แถวว่าง
  await c.vendors.insertOne({ code: "VEN-00050", name: "ใหม่", active: true, createdAt: now })
  eq(await hubStockForVendor("VEN-00050"), { enabled: true, rows: [] })

  setStoreWithdrawClient(null)
  await client.close()
  await mongod.stop()
  console.log("check-hub-vendor-portal: OK")
}
main().catch((e) => { console.error(e); process.exit(1) })
