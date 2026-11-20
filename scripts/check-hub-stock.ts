// scripts/check-hub-stock.ts — ยอด Hub (master + stock + moves)
// รัน: npx tsx scripts/check-hub-stock.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server)
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_WITHDRAW_DB = "hub_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const by = { email: "store@x.co", name: "คลัง" }
const cut = (lineIndex: number, skuId: number, qty: number, vendorCode = "V1") => ({ lineIndex, vendorCode, skuId, qty })

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient } = await import("../lib/store-withdraw/db")
  setStoreWithdrawClient(client)
  const h = await import("../lib/store-withdraw/hub-db")
  const cols = await h.hubCols()

  await cols.sites.insertOne({ inventoryId: 4, atmsHubInventoryId: 99, active: true })
  await cols.sites.insertOne({ inventoryId: 5, atmsHubInventoryId: 98, active: false })
  await cols.vendors.insertMany([
    { code: "V1", name: "อู่หนึ่ง", active: true, createdAt: new Date() },
    { code: "V2", name: "อู่สอง", active: false, createdAt: new Date() },
  ])
  eq((await h.getHubSite(4))?.atmsHubInventoryId, 99)
  eq(await h.getHubSite(5), null)
  eq(await h.getHubSite(6), null)

  const stockOf = async (skuId: number, vendorCode = "V1") =>
    (await cols.stock.findOne({ inventoryId: 4, vendorCode, skuId }))?.qty ?? 0
  // ผลรวม moves ต่อ key ต้องเท่ายอด stock ทุกขั้น
  const ledger = async () => {
    for (const s of await cols.stock.find({}).toArray()) {
      const sum = (await cols.moves.find({ inventoryId: s.inventoryId, vendorCode: s.vendorCode, skuId: s.skuId }).toArray()).reduce((n, m) => n + m.qty, 0)
      assert.equal(sum, s.qty, `ledger ${s.vendorCode}/${s.skuId}`)
      assert.ok(s.qty >= 0)
    }
  }

  // vendor ที่ไม่ active รับเข้าไม่ได้
  await assert.rejects(h.receiveHub({ inventoryId: 4, vendorCode: "V2", refNo: "R0", lines: [{ skuId: 501, skuCode: "S501", skuName: "x", qty: 1 }] }, by))
  await assert.rejects(h.receiveHub({ inventoryId: 4, vendorCode: "ZZ", refNo: "R0", lines: [{ skuId: 501, skuCode: "S501", skuName: "x", qty: 1 }] }, by))

  // receive
  const mv = await h.receiveHub({ inventoryId: 4, vendorCode: "V1", refNo: "R1", lines: [{ skuId: 501, skuCode: "S501", skuName: "น็อต", unit: "ชิ้น", price: 12, qty: 10 }] }, by)
  eq(mv.length, 1)
  eq(await stockOf(501), 10)
  eq(await cols.moves.countDocuments(), 1)
  // รับซ้ำ refNo เดิมหลายบรรทัดได้ + ไม่ส่งราคา = ไม่ทับราคาเดิม
  await h.receiveHub({ inventoryId: 4, vendorCode: "V1", refNo: "R1", lines: [{ skuId: 501, skuCode: "S501", skuName: "น็อต", qty: 0.0 + 1 }, { skuId: 503, skuCode: "S503", skuName: "สลัก", qty: 2 }] }, by)
  eq((await cols.items.findOne({ skuId: 501 }))?.price, 12)
  eq((await cols.items.findOne({ skuId: 503 }))?.price, null)
  eq(await stockOf(501), 11)
  await h.cutHubForRequest("SW-0", [cut(0, 501, 1)], 4, by) // เอาให้กลับมา 10
  eq(await stockOf(501), 10)
  await ledger()

  // cut
  eq(await h.cutHubForRequest("SW-1", [cut(0, 501, 4)], 4, by), { ok: true })
  eq(await stockOf(501), 6)
  eq(await h.cutHubForRequest("SW-1", [cut(0, 501, 4)], 4, by), { ok: true })
  eq(await stockOf(501), 6) // ซ้ำ = ไม่ตัดซ้ำ
  await ledger()

  // ไม่พอ
  eq(await h.cutHubForRequest("SW-2", [cut(0, 501, 7)], 4, by), { ok: false, short: [{ skuCode: "S501", skuId: 501, have: 6, need: 7 }] })
  eq(await stockOf(501), 6)

  // สองบรรทัด บรรทัดหลังไม่มีสต๊อก → ถอยบรรทัดแรก
  const r3 = await h.cutHubForRequest("SW-3", [cut(0, 501, 2), cut(1, 502, 1)], 4, by)
  assert.equal(r3.ok, false)
  if (!r3.ok) eq(r3.short.map((s) => [s.skuId, s.have, s.need]), [[502, 0, 1]])
  eq(await stockOf(501), 6)
  eq(await cols.moves.countDocuments({ refNo: "SW-3" }), 0)
  await ledger()

  // พร้อมกัน
  const [a, b] = await Promise.all([
    h.cutHubForRequest("SW-4", [cut(0, 501, 4)], 4, by),
    h.cutHubForRequest("SW-5", [cut(0, 501, 4)], 4, by),
  ])
  eq([a.ok, b.ok].filter(Boolean).length, 1)
  eq(await stockOf(501), 2)
  await ledger()

  // ใบเดียวกันยิงพร้อมกัน: บรรทัดที่สองไม่พอ → ห้ามได้ ok โดยมีบรรทัดไม่ถูกตัด
  const plan9 = [cut(0, 501, 1), cut(1, 502, 1)]
  const res9 = await Promise.all([h.cutHubForRequest("SW-9", plan9, 4, by), h.cutHubForRequest("SW-9", plan9, 4, by)])
  for (const r of res9) {
    if (r.ok) for (const p of plan9) assert.equal(await cols.moves.countDocuments({ type: "issue", refNo: "SW-9", lineIndex: p.lineIndex }), 1)
  }
  assert.ok(res9.every((r) => !r.ok))
  eq(await stockOf(501), 2)
  eq(await cols.locks.countDocuments(), 0)
  await ledger()
  // ทั้งสองบรรทัดมีของ: หักครั้งเดียวรวม (ตัวที่แพ้ล็อกอาจได้ busy)
  await h.receiveHub({ inventoryId: 4, vendorCode: "V1", refNo: "R9", lines: [{ skuId: 502, skuCode: "S502", skuName: "y", qty: 5 }] }, by)
  const res10 = await Promise.all([h.cutHubForRequest("SW-10", plan9, 4, by), h.cutHubForRequest("SW-10", plan9, 4, by)])
  assert.ok(res10.some((r) => r.ok))
  for (const p of plan9) assert.equal(await cols.moves.countDocuments({ type: "issue", refNo: "SW-10", lineIndex: p.lineIndex }), 1)
  eq(await stockOf(501), 1)
  eq(await stockOf(502), 4)
  await ledger()
  await h.restoreHubForRequest("SW-10", by, "x")
  // ล็อกค้างเกิน 60 วิ ถูกยึดต่อ · ล็อกสดคืน busy
  await cols.locks.insertOne({ _id: "cut:SW-11", at: new Date() })
  eq(await h.cutHubForRequest("SW-11", [cut(0, 501, 1)], 4, by), { ok: false, short: [], busy: true })
  await cols.locks.updateOne({ _id: "cut:SW-11" }, { $set: { at: new Date(Date.now() - 120_000) } })
  eq(await h.cutHubForRequest("SW-11", [cut(0, 501, 1)], 4, by), { ok: true })
  await h.restoreHubForRequest("SW-11", by, "x")
  eq(await stockOf(501), 2)
  await ledger()

  // restore
  eq(await h.restoreHubForRequest("SW-1", by, "ยกเลิกใบ"), 1)
  eq(await stockOf(501), 6)
  eq(await h.restoreHubForRequest("SW-1", by, "ยกเลิกใบ"), 0)
  eq(await stockOf(501), 6)
  await ledger()

  // return leftover (unique ต่อบรรทัด)
  eq(await h.cutHubForRequest("SW-6", [cut(0, 501, 3)], 4, by), { ok: true })
  await h.returnHubLeftover("SW-6", [{ lineIndex: 0, vendorCode: "V1", skuId: 501, qty: 2 }], 4, by)
  eq(await stockOf(501), 5)
  await h.returnHubLeftover("SW-6", [{ lineIndex: 0, vendorCode: "V1", skuId: 501, qty: 2 }], 4, by)
  eq(await stockOf(501), 5) // คืนซ้ำ = ไม่บวกซ้ำ
  await ledger()

  // search / list
  await cols.items.insertOne({ inventoryId: 4, vendorCode: "V1", skuId: 900, skuCode: "ABC.1", skuName: "ซีล (a+b)", unit: "ชิ้น", price: null, active: false, updatedAt: new Date() })
  const s = await h.searchHubItems(4, "s501", 10)
  eq(s.length, 1)
  eq([s[0].qty, s[0].vendorName], [5, "อู่หนึ่ง"])
  eq((await h.searchHubItems(4, "น็อต", 10)).length, 1)
  eq((await h.searchHubItems(4, "abc", 10)).length, 0) // ไม่ active
  eq((await h.searchHubItems(4, "(a+b", 10)).length, 0) // escape regex ไม่พัง
  eq((await h.searchHubItems(3, "s501", 10)).length, 0)
  const ls = await h.listHubStock({ vendorCode: "V1" })
  eq(ls.find((x) => x.skuId === 503)?.qty, 2)
  eq((await h.listHubStock({ inventoryId: 3 })).length, 0)
  const mvs = await h.listHubMoves({ vendorCode: "V1", skuId: 501 }, 3)
  eq(mvs.length, 3)
  assert.ok(mvs[0].at >= mvs[1].at)
  eq(await h.listHubMoves({ vendorCode: "" }, 10), [])
  eq((await h.listHubMoves({ from: new Date(Date.now() + 60_000) }, 10)).length, 0)

  console.log("hub-stock ok")
  setStoreWithdrawClient(null)
  await client.close()
  await mongod.stop()
}
main().catch((e) => { console.error(e); process.exit(1) })
