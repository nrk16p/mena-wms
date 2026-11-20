// scripts/check-hub-ledger.ts — เช็กยอด Hub: hub_stock ต้องเท่ากับผลรวม hub_moves ทุก (คลัง × Sub × SKU)
// อ่านอย่างเดียว ไม่เขียนอะไร · จำกัดเวลา 30 วิ/คำสั่ง · ดึงเฉพาะ field ที่ใช้
//   MONGO_URI=... npx tsx scripts/check-hub-ledger.ts            # ผู้ใช้รันเองกับ DB จริง (db = STORE_WITHDRAW_DB หรือ master_data)
//   npx tsx scripts/check-hub-ledger.ts --self-test              # เทสต์ตัวเองกับ memory Mongo (ไม่แตะ DB จริง)
// ผลลัพธ์: พิมพ์เฉพาะแถวที่ไม่ตรง + จำนวน · ไม่ตรง = exit 1 · ตรงหมด = exit 0
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { hubLedgerMismatches } from "../lib/store-withdraw/hub-ledger"

async function report(client: MongoClient, dbName: string): Promise<number> {
  const { checked, mismatches } = await hubLedgerMismatches(client.db(dbName))
  for (const m of mismatches) {
    console.log(`ไม่ตรง คลัง ${m.inventoryId} · Sub ${m.vendorCode} · SKU ${m.skuId} · ยอด ${m.stock ?? "(ไม่มีแถว)"} · สมุด ${m.moves}`)
  }
  console.log(`เช็กแล้ว ${checked} รายการ · ไม่ตรง ${mismatches.length}`)
  return mismatches.length
}

async function selfTest() {
  delete process.env.MONGO_URI // ห้ามแตะ cluster จริง
  const { MongoMemoryServer } = await import("mongodb-memory-server")
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  try {
    const db = client.db("hub_ledger_test")
    const by = { email: "t", name: "t" }
    await db.collection("hub_moves").insertMany([
      { type: "receive", inventoryId: 4, vendorCode: "V1", skuId: 1, qty: 5, refNo: "D1", lineIndex: null, by, at: new Date() },
      { type: "issue", inventoryId: 4, vendorCode: "V1", skuId: 1, qty: -2, refNo: "SW-1", lineIndex: 0, by, at: new Date() },
      { type: "receive", inventoryId: 4, vendorCode: "V1", skuId: 2, qty: 3, refNo: "D1", lineIndex: null, by, at: new Date() },
    ])
    await db.collection("hub_stock").insertMany([
      { inventoryId: 4, vendorCode: "V1", skuId: 1, qty: 3 },
      { inventoryId: 4, vendorCode: "V1", skuId: 2, qty: 3 },
    ])
    let r = await hubLedgerMismatches(db)
    assert.equal(r.checked, 2); assert.equal(r.mismatches.length, 0)
    assert.equal(await report(client, "hub_ledger_test"), 0)

    // บังคับให้ไม่ตรง: ยอดถูกแก้ตรง ๆ + มีสมุดแต่ไม่มีแถวยอด + มีแถวยอดแต่ไม่มีสมุด
    await db.collection("hub_stock").updateOne({ skuId: 2 }, { $set: { qty: 7 } })
    await db.collection("hub_moves").insertOne({ type: "receive", inventoryId: 9, vendorCode: "V2", skuId: 5, qty: 1, refNo: "D2", lineIndex: null, by, at: new Date() })
    await db.collection("hub_stock").insertOne({ inventoryId: 4, vendorCode: "V3", skuId: 8, qty: 4 })
    r = await hubLedgerMismatches(db)
    assert.deepEqual(r.mismatches, [
      { inventoryId: 4, vendorCode: "V1", skuId: 2, stock: 7, moves: 3 },
      { inventoryId: 4, vendorCode: "V3", skuId: 8, stock: 4, moves: 0 },
      { inventoryId: 9, vendorCode: "V2", skuId: 5, stock: null, moves: 1 },
    ])
    assert.equal(await report(client, "hub_ledger_test"), 3)
    // อ่านอย่างเดียว: ไม่มีอะไรถูกแก้
    assert.equal((await db.collection("hub_stock").findOne({ skuId: 2 }))!.qty, 7)
    assert.equal(await db.collection("hub_moves").countDocuments(), 4)
    // ทาง CLI จริง (ชี้ไปที่ memory Mongo เท่านั้น): ไม่ตรง = exit 1 · ตรง = exit 0
    const { spawnSync } = await import("node:child_process")
    const cli = () => spawnSync(process.execPath, [...process.execArgv, process.argv[1]], {
      env: { ...process.env, MONGO_URI: mongod.getUri(), STORE_WITHDRAW_DB: "hub_ledger_test" }, encoding: "utf8",
    })
    let run = cli()
    assert.equal(run.status, 1, run.stderr); assert.match(run.stdout, /ไม่ตรง 3/)
    await db.collection("hub_stock").updateOne({ skuId: 2 }, { $set: { qty: 3 } })
    await db.collection("hub_stock").deleteOne({ vendorCode: "V3" })
    await db.collection("hub_moves").deleteOne({ vendorCode: "V2" })
    run = cli()
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /ไม่ตรง 0/)
    console.log("check-hub-ledger self-test: OK")
  } finally {
    await client.close(); await mongod.stop()
  }
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest()
  const uri = process.env.MONGO_URI
  if (!uri) { console.error("ตั้ง MONGO_URI ก่อน (หรือ --self-test)"); process.exit(2) }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  try {
    const bad = await report(client, process.env.STORE_WITHDRAW_DB || "master_data")
    if (bad > 0) process.exitCode = 1
  } finally {
    await client.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
