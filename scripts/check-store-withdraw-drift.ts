/* eslint-disable @typescript-eslint/no-explicit-any */
// scripts/check-store-withdraw-drift.ts
// รัน: npx tsx scripts/check-store-withdraw-drift.ts  (Mongo ในเครื่อง · stub api-ncac ด้วย globalThis.fetch · ไม่แตะ ATMS จริง)
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_drift_test"
process.env.ATMS_LOOKUP_USERNAME = "reader"
process.env.ATMS_LOOKUP_PASSWORD = "reader-pw"
process.env.STORE_WITHDRAW_API_KEYS = "key-one,key-two"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, any>
let calls: { path: string; headers: Record<string, string> }[] = []
let handler: (path: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} })
globalThis.fetch = (async (input: any, init: any = {}) => {
  const path = new URL(String(input)).pathname
  calls.push({ path, headers: init.headers ?? {} })
  const r = handler(path)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol } = await import("../lib/store-withdraw/db")
  const { checkDrift, checkDriftDetailed, driftTick, DRIFT_DELETED, DRIFT_UNAPPROVED } = await import("../lib/store-withdraw/drift")
  setStoreWithdrawClient(client)

  const atms = (gmId: number | null, p: Json = {}) => ({ gmId, done: [0], approved: true, code: `WD-${gmId}`, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null, ...p })
  const line = (skuCode: string, requestedQty: number, issuedQty: number | null) => ({ skuId: 1, skuCode, skuName: skuCode, requestedQty, issuedQty, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "" })
  async function seed(no: string, gmId: number | null, p: Json = {}) {
    const now = new Date()
    await (await swCol()).insertOne({
      no, kind: "stock", status: "ISSUED", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "ซ่อมรถ", plate: "70-1",
      mrCode: null, urgent: false, remark: "", lines: [line("A-1", 5, 4), line("B-2", 2, 0), line("C-3", 1, null)],
      requestedBy: { email: "u@x.co", name: "U", via: "web" }, claimedBy: null, rejectReason: null, atms: atms(gmId), returns: [],
      createdAt: now, updatedAt: now, ...p,
    } as any)
  }
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!
  // ATMS ที่ตรงกับ WMS: A-1 = 4 (issuedQty) , C-3 = 1 (requestedQty เพราะ issuedQty null) , B-2 = 0 ไม่ถูกส่ง
  const good = { id: 1, code: "WD-1", approved: true, items: [{ sku_code: "A-1", amount: 3 }, { sku_code: "A-1", amount: 1 }, { sku_code: "C-3", amount: 1 }] }
  const reply = (body: unknown, status = 200) => { handler = () => ({ status, body }) }

  // ---- ตรงกัน → drift null (และล้างค่าเดิม) ----
  await seed("T-OK", 101, { atms: atms(101, { drift: "ค่าเก่า" }) })
  reply(good)
  const r = await checkDrift("T-OK")
  eq(r.atms.drift, null)
  assert.ok(r.atms.lastCheckAt instanceof Date)
  assert.equal(calls.at(-1)!.path, "/atms/withdraw/101")
  assert.equal(calls.at(-1)!.headers["X-ATMS-Username"], "reader", "อ่านด้วยบัญชีค้นข้อมูล")
  const before = await get("T-OK")

  // ---- ไม่เปลี่ยนข้อมูลอื่น ----
  const o = { ...before } as Json
  const a = { ...before.atms } as Json
  delete o.atms; delete a.drift; delete a.lastCheckAt
  const base = await seed("T-FIELDS", 102).then(() => get("T-FIELDS"))
  reply({ ...good, approved: false })
  const after = await checkDrift("T-FIELDS")
  eq(after.lines, base.lines); eq(after.status, base.status); eq(after.updatedAt, base.updatedAt); eq(after.atms.code, base.atms.code); eq(after.atms.gmId, 102)

  // ---- ถอนอนุมัติ ----
  eq((await checkDrift("T-FIELDS")).atms.drift, DRIFT_UNAPPROVED)
  assert.equal(DRIFT_UNAPPROVED, "ใบถูกถอนอนุมัติใน ATMS")

  // ---- จำนวนไม่ตรง ----
  await seed("T-QTY", 103)
  reply({ ...good, items: [{ sku_code: "A-1", amount: 2 }, { sku_code: "C-3", amount: 1 }] })
  eq((await checkDrift("T-QTY")).atms.drift, "จำนวน A-1 ใน ATMS เป็น 2 แต่ WMS จ่าย 4")

  // ---- SKU หาย / เกิน ----
  await seed("T-MISS", 104)
  reply({ ...good, items: [{ sku_code: "A-1", amount: 4 }] })
  assert.match((await checkDrift("T-MISS")).atms.drift!, /C-3/)
  await seed("T-EXTRA", 105)
  reply({ ...good, items: [...good.items, { sku_code: "Z-9", amount: 7 }] })
  assert.match((await checkDrift("T-EXTRA")).atms.drift!, /Z-9/)
  // บรรทัดที่ qty 0 (B-2) ไม่ถูกส่ง — ถ้า ATMS มี B-2 = เกิน
  reply({ ...good, items: [...good.items, { sku_code: "B-2", amount: 2 }] })
  assert.match((await checkDrift("T-EXTRA")).atms.drift!, /B-2/)

  // ---- 404 → ถูกลบ ----
  await seed("T-404", 106)
  reply({ detail: "not found" }, 404)
  eq((await checkDrift("T-404")).atms.drift, DRIFT_DELETED)
  assert.equal(DRIFT_DELETED, "ใบถูกลบใน ATMS")

  // ---- 5xx / ล่ม / 401 → ไม่แก้อะไร ----
  await seed("T-5XX", 107, { atms: atms(107, { drift: "ของเดิม" }) })
  reply({ detail: "boom" }, 502)
  let d = await checkDriftDetailed("T-5XX")
  eq(d.state, "skipped"); eq(d.request!.atms.drift, "ของเดิม"); eq((await get("T-5XX")).atms.lastCheckAt, null)
  const savedFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("ECONNRESET") }) as typeof fetch
  d = await checkDriftDetailed("T-5XX")
  eq(d.state, "skipped"); eq((await get("T-5XX")).atms.drift, "ของเดิม")
  globalThis.fetch = savedFetch
  reply({ detail: "login" }, 401)
  eq((await checkDriftDetailed("T-5XX")).state, "skipped")

  // ---- ไม่มี gmId / ไม่ตั้งบัญชีอ่าน → ข้ามโดยไม่เรียก ATMS ----
  await seed("T-NOGM", null)
  calls = []
  eq((await checkDriftDetailed("T-NOGM")).state, "skipped"); eq(calls.length, 0)
  const u = process.env.ATMS_LOOKUP_USERNAME
  delete process.env.ATMS_LOOKUP_USERNAME
  eq((await checkDriftDetailed("T-OK")).state, "skipped"); eq(calls.length, 0)
  process.env.ATMS_LOOKUP_USERNAME = u

  // ================= drift-tick =================
  await (await swCol()).deleteMany({})
  const day = 86_400_000
  const nowMs = Date.now()
  // 45 ใบเข้าเกณฑ์: lastCheckAt เรียงจากเก่าไปใหม่ตามเลข (T000 เก่าสุด) — สลับลำดับ insert
  const ids = Array.from({ length: 45 }, (_, i) => i)
  for (const i of [...ids].reverse()) {
    await seed(`T${String(i).padStart(3, "0")}`, 1000 + i, {
      status: i % 2 ? "RECEIVED" : "ISSUED",
      atms: atms(1000 + i, { lastCheckAt: new Date(nowMs - (100 - i) * 60_000) }),
    })
  }
  await seed("T-NEVER", 2000) // ไม่เคยตรวจ → ต้องมาก่อน
  await seed("T-OLD", 2001, { updatedAt: new Date(nowMs - 8 * day) })
  await seed("T-NEW", 2002, { status: "NEW" })
  await seed("T-NOGMID", null)
  handler = (path) => (path.endsWith("/1005") || path.endsWith("/1006") ? { status: 200, body: { ...good, approved: false } } : { status: 200, body: good })
  calls = []
  const sleeps: number[] = []
  const res = await driftTick({ sleep: async (ms) => { sleeps.push(ms) } })
  eq(res.checked, 40); eq(res.skipped, 0); eq(res.drifted, 2)
  eq(calls.length, 40)
  eq(sleeps.length, 39); assert.ok(sleeps.every((m) => m === 1000), "ห่างกัน 1 วินาที")
  const order = calls.map((c) => Number(c.path.split("/").pop()))
  eq(order[0], 2000, "ใบที่ไม่เคยตรวจมาก่อน")
  eq(order.slice(1), Array.from({ length: 39 }, (_, i) => 1000 + i), "เก่าสุดก่อน")
  assert.ok(!order.includes(2001) && !order.includes(2002), "เกิน 7 วัน / ยังไม่ส่งของ ไม่ตรวจ")

  // งบเวลา: budget สั้นมาก → หยุดก่อน ไม่เรียกครบ
  calls = []
  const short = await driftTick({ budgetMs: 15_000 + 10, sleep: async () => { await new Promise((r) => setTimeout(r, 30)) } })
  assert.ok(short.checked < 40 && short.checked >= 1, `หยุดก่อนครบ (checked=${short.checked})`)
  eq(short.skipped, 40 - short.checked)

  // ---- route: ต้องมี x-api-key ----
  const { POST } = await import("../app/api/store-withdraw/drift-tick/route")
  const mk = (h: Record<string, string>) => new Request("http://x/api/store-withdraw/drift-tick", { method: "POST", headers: h }) as any
  eq((await POST(mk({}))).status, 401)
  eq((await POST(mk({ "x-api-key": "nope" }))).status, 401)
  eq((await POST(mk({ "x-user": "a@b.c" }))).status, 401)
  await (await swCol()).deleteMany({})
  await seed("T-R1", 3001)
  reply(good)
  const ok = await POST(mk({ "x-api-key": "key-two" }))
  eq(ok.status, 200)
  const body = await ok.json()
  eq(Object.keys(body).sort(), ["checked", "drifted", "skipped"])
  eq(body.checked, 1)

  await client.close(); await mongod.stop()
  console.log("check-store-withdraw-drift: ok")
}
main().catch((e) => { console.error(e); process.exit(1) })
