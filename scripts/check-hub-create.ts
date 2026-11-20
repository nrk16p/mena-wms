// scripts/check-hub-create.ts — ยื่นคำขอที่มีบรรทัด Hub
// รัน: npx tsx scripts/check-hub-create.ts  (Mongo ในเครื่อง + stub api-ncac ด้วย globalThis.fetch)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "hub_create_test"
process.env.ATMS_LOOKUP_USERNAME = "reader"
process.env.ATMS_LOOKUP_PASSWORD = "reader-pw"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const actor = { email: "mech@menatransport.co.th", name: "ช่าง", via: "web" as const }
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "ซ่อมรถ" }] }), { status: 200 })) as typeof fetch

const fail = async (p: Promise<unknown>) => p.then(() => ({ status: 0, message: "" }), (e: { status?: number; message?: string }) => ({ status: e.status ?? -1, message: e.message ?? "" }))

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient } = await import("../lib/store-withdraw/db")
  setStoreWithdrawClient(client)
  const { createRequest } = await import("../lib/store-withdraw/service")
  const { hubCols } = await import("../lib/store-withdraw/hub-db")
  const c = await hubCols()
  const now = new Date()
  await c.sites.insertOne({ inventoryId: 4, atmsHubInventoryId: 99, active: true })
  await c.items.insertMany([
    { inventoryId: 4, vendorCode: "V1", skuId: 100, skuCode: "H100", skuName: "ผ้าเบรก", unit: "ชิ้น", price: 10, active: true, updatedAt: now },
    { inventoryId: 4, vendorCode: "V1", skuId: 101, skuCode: "H101", skuName: "ปิด", unit: "ชิ้น", price: 10, active: false, updatedAt: now },
    { inventoryId: 4, vendorCode: "V2", skuId: 102, skuCode: "H102", skuName: "ของ V2", unit: "ชิ้น", price: 10, active: true, updatedAt: now },
  ])

  const normal = { skuId: 100, skuCode: "H100", skuName: "ผ้าเบรก", requestedQty: 1 }
  const hubLine = (o: Record<string, unknown> = {}) => ({ ...normal, requestedQty: 2, hub: { vendorCode: "V1" }, ...o })
  const base = (lines: unknown[], o: Record<string, unknown> = {}) => ({ workType: "garage_in", plate: "70-1234", inventoryId: 4, pickToId: 7, lines, ...o })
  const BAD = "รายการอะไหล่ Hub ไม่ถูกต้อง เลือกจากผลค้นหาใหม่"

  // ปกติ + Hub SKU เดียวกัน → แยก 2 บรรทัด
  const r = await createRequest(base([normal, hubLine()]), actor)
  eq(r.lines.length, 2)
  assert.ok(!r.lines[0].hub)
  eq(r.lines[1].hub?.vendorCode, "V1")
  eq(r.hubStatus, "WAIT_ISSUE")
  assert.ok(r.hubWd && r.hubWd.code === null)
  assert.ok(!r.hubPr)

  // Hub ซ้ำ SKU+เจ้าเดียวกัน = รวม
  const m = await createRequest(base([hubLine(), hubLine()]), actor)
  eq(m.lines.length, 1); eq(m.lines[0].requestedQty, 4)

  // vendorCode ที่เก็บมาจาก hub_items (ไม่ใช่ที่ client ส่ง รูปแบบเว้นวรรค)
  eq((await fail(createRequest(base([hubLine({ hub: { vendorCode: "V2" } })]), actor))).message, BAD) // SKU 100 ไม่ใช่ของ V2
  eq((await fail(createRequest(base([hubLine({ skuId: 101, skuCode: "H101" })]), actor))).message, BAD) // ปิดอยู่
  eq((await fail(createRequest(base([hubLine({ skuId: 999 })]), actor))).message, BAD)
  eq((await fail(createRequest(base([hubLine({ hub: { vendorCode: "" } })]), actor))).status, 400)

  // garage_out
  const go = await fail(createRequest(base([hubLine()], { workType: "garage_out" }), actor))
  eq(go.status, 400); eq(go.message, "งานอู่นอกเบิกอะไหล่ Hub ไม่ได้")

  // hubPr
  const p = await createRequest(base([hubLine()], { hubPr: { code: "LBPR2611001", id: 55 } }), actor)
  eq(p.hubPr?.code, "LBPR2611001"); eq(p.hubPr?.id, 55); eq(p.hubPr?.by.email, actor.email); assert.ok(p.hubPr?.at instanceof Date)
  eq((await fail(createRequest(base([hubLine()], { hubPr: { code: "x" } }), actor))).status, 400)

  // ไม่มี Hub → ไม่มี field hub เลย (hubPr ถูกเมิน)
  const n = await createRequest(base([normal], { hubPr: { code: "LBPR2611001" } }), actor)
  for (const k of ["hubWd", "hubStatus", "hubPr", "hubIssuedAt"]) assert.ok(!(k in n), k)

  // คลังไม่เปิด Hub
  await c.sites.updateOne({ inventoryId: 4 }, { $set: { active: false } })
  const ns = await fail(createRequest(base([hubLine()]), actor))
  eq(ns.status, 400); eq(ns.message, "คลังนี้ยังไม่เปิดอะไหล่ Hub")
  assert.ok((await createRequest(base([normal]), actor)).no) // ใบปกติไม่กระทบ

  console.log("check-hub-create: OK")
  await client.close(); await mongod.stop()
}
main().catch((e) => { console.error(e); process.exit(1) })
