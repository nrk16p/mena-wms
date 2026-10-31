// scripts/check-store-withdraw-service.ts
// รัน: npx tsx scripts/check-store-withdraw-service.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · stub api-ncac ด้วย globalThis.fetch)
// ครอบ: สร้างใบ (เพดาน) · ตัวเลือกสำรอง · 403 ของ api-ncac · ผูกบัญชี · 404 · กุญแจแยก tick/ผู้ขอ · index
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_service_test"
process.env.ATMS_LOOKUP_USERNAME = "reader"
process.env.ATMS_LOOKUP_PASSWORD = "reader-pw"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const actor = { email: "mech@menatransport.co.th", name: "ช่าง", via: "web" as const }

let calls: { path: string }[] = []
let handler: (path: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown) => {
  const path = new URL(String(input)).pathname
  calls.push({ path })
  const r = handler(path)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch

const okOptions = () => ({ status: 200, body: { inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "ซ่อมรถ" }] } })
const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number; name?: string }) => e.status ?? e.name ?? -1)

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, atmsCacheCol, getDb, transition } = await import("../lib/store-withdraw/db")
  const { createRequest, getOptions, lookup, requestReturn, MAX_LINES, MAX_REMARK, MAX_PLATE } = await import("../lib/store-withdraw/service")
  const { linkAtmsAccount } = await import("../lib/store-withdraw/link")
  const { apiKeyValid, tickKeyValid } = await import("../lib/store-withdraw/http")
  const { listAtmsKeyed } = await import("../lib/store-withdraw/service")
  setStoreWithdrawClient(client)

  // ---- index ----
  const db = await getDb()
  const idx = async (c: string) => (await db.collection(c).indexes()).map((i) => JSON.stringify(i.key))
  assert.ok((await idx("store_withdraw_log")).includes('{"no":1,"at":1}'))
  assert.ok((await idx("store_withdraw_requests")).includes('{"requestedBy.email":1,"createdAt":-1}'))

  // ---- ตัวเลือก: สำรองล่าสุดเมื่อ ATMS ล่ม ----
  handler = (p) => (p === "/atms/withdraw/options" ? okOptions() : { status: 404, body: {} })
  eq((await getOptions()).inventories[0].id, 4)
  await (await atmsCacheCol()).deleteOne({ key: "options" }) // จำลอง TTL ลบสำเนาสด
  handler = () => ({ status: 500, body: { detail: "down" } })
  eq((await getOptions()).pickTos[0].id, 7) // ได้สำเนาล่าสุด
  const last = await (await atmsCacheCol()).findOne({ key: "options:last" })
  assert.ok(last && !("fetchedAt" in last), "สำเนาถาวรต้องไม่มี fetchedAt (กัน TTL ลบ)")
  await (await atmsCacheCol()).deleteMany({})
  eq(await status(getOptions()), 502) // ไม่เคยมีสำเนา = error เดิม

  // ---- 403 ของ api-ncac = ตั้งค่า (502 + ข้อความตั้งค่า) ไม่ใช่รหัสผ่านผิด ----
  handler = () => ({ status: 403, body: { detail: "bad key" } })
  const e1 = await getOptions().catch((e) => e)
  eq(e1.status, 502); eq(e1.message, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน")
  const e2 = await lookup("sku", "oil", 20).catch((e) => e)
  eq(e2.message, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน")
  handler = () => ({ status: 401, body: {} })
  assert.match(((await lookup("sku", "oil", 20).catch((e) => e)) as Error).message, /บัญชีค้นข้อมูล/)
  // key ว่าง: ไม่ยิงออก
  process.env.NCAC_API_KEY = ""; calls = []
  eq(((await lookup("sku", "oil", 20).catch((e) => e)) as Error).message, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน"); eq(calls.length, 0)
  process.env.NCAC_API_KEY = "k-test"

  // ---- ผูกบัญชี ----
  handler = () => ({ status: 200, body: { username: "u", email: actor.email, name: "ช่าง" } })
  const savedKey = process.env.STORE_ATMS_CRED_KEY
  delete process.env.STORE_ATMS_CRED_KEY; calls = []
  const nk = await linkAtmsAccount(actor, "u", "pw").catch((e) => e)
  eq(nk.status, 503); eq(nk.message, "ยังไม่ได้ตั้งกุญแจเข้ารหัสบัญชี ATMS — แจ้งแอดมิน"); eq(calls.length, 0)
  process.env.STORE_ATMS_CRED_KEY = savedKey
  eq((await linkAtmsAccount(actor, "u", "pw")).linked, true)
  handler = () => ({ status: 403, body: {} })
  const l403 = await linkAtmsAccount(actor, "u", "pw").catch((e) => e)
  eq(l403.status, 502); eq(l403.message, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน") // ไม่ใช่ 422 "รหัสผิด"
  handler = () => ({ status: 401, body: {} })
  eq((await linkAtmsAccount(actor, "u", "pw").catch((e) => e)).status, 422)

  // ---- สร้างใบ: เพดาน ----
  handler = (p) => (p === "/atms/withdraw/options" ? okOptions() : { status: 404, body: {} })
  await (await atmsCacheCol()).deleteMany({})
  const line = (i: number) => ({ skuId: 100 + i, skuCode: "S" + i, skuName: "n" + i, requestedQty: 1 })
  const base = (p: Json = {}) => ({ kind: "stock", inventoryId: 4, pickToId: 7, plate: "70-1234", lines: [line(1)], ...p })
  const doc = await createRequest(base({ lines: Array.from({ length: MAX_LINES }, (_, i) => line(i)), remark: "x".repeat(MAX_REMARK), plate: "p".repeat(MAX_PLATE) }), actor)
  eq(doc.lines.length, MAX_LINES)
  eq(await status(createRequest(base({ lines: Array.from({ length: MAX_LINES + 1 }, (_, i) => line(i)) }), actor)), 400)
  eq(await status(createRequest(base({ remark: "x".repeat(MAX_REMARK + 1) }), actor)), 400)
  eq(await status(createRequest(base({ plate: "p".repeat(MAX_PLATE + 1) }), actor)), 400)

  // ---- ไม่พบใบ = NotFoundError (404) ----
  eq(await status(requestReturn("SW-0000-999", { lines: [{ lineIndex: 0, qty: 1 }] }, actor)), "NotFoundError")
  eq(await status(transition("SW-0000-999", "claim", actor)), "NotFoundError")
  const col = await swCol()
  assert.ok(await col.findOne({ no: doc.no }))

  // ---- กุญแจ tick แยกจากกุญแจผู้ขอ ----
  process.env.STORE_WITHDRAW_API_KEYS = "req-one,req-two"
  process.env.STORE_WITHDRAW_TICK_KEY = "tick-one"
  eq(apiKeyValid("req-one"), true); eq(tickKeyValid("req-one"), false)
  eq(tickKeyValid("tick-one"), true); eq(apiKeyValid("tick-one"), false)
  process.env.STORE_WITHDRAW_API_KEYS = "req-one,tick-one" // ตั้งซ้ำพลาด: กุญแจ tick ต้องไม่ใช้เป็นกุญแจผู้ขอ
  eq(apiKeyValid("tick-one"), false); eq(apiKeyValid("req-one"), true)
  delete process.env.STORE_WITHDRAW_TICK_KEY
  eq(tickKeyValid("tick-one"), false); eq(tickKeyValid(""), false); eq(tickKeyValid(null), false)

  // ---- รายการ ATMS ที่คีย์ตรง: ดึงสำเร็จแล้วเขียนแคช (ใช้ใน after()) ----
  handler = (p) => (p === "/atms/withdraw/list" ? { status: 200, body: { rows: [{ id: 8123, code: "WD-8123", approved: true }] } } : { status: 404, body: {} })
  await (await atmsCacheCol()).deleteMany({})
  eq((await listAtmsKeyed(4, new Date())).map((r) => r.id), [8123])
  assert.ok(await (await atmsCacheCol()).findOne({ key: /^wd-list:4:/ }))

  await client.db("sw_service_test").dropDatabase()
  await client.close()
  await mongod.stop()
  globalThis.fetch = realFetch
  console.log("check-store-withdraw-service: all passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
