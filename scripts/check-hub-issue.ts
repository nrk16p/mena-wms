// scripts/check-hub-issue.ts — ส่งของ (อู่ใน) ที่มีบรรทัด Hub: ตัดยอด Hub · WD ปกติ/WD Hub แยกใบ · ลองใหม่ · คืนยอดเมื่อปิดไม่สำเร็จ
// รัน: npx tsx scripts/check-hub-issue.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · stub api-ncac ด้วย globalThis.fetch)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwLine, SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "hub_issue_test"
process.env.CORE_RETURN_DB = "hub_issue_core_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, unknown> & { lines?: { sku_id: number; amount: number }[] }
const store = { email: "store@x.co", name: "คลัง", via: "web" as const }

type Call = { path: string; body: Json | null }
let calls: Call[] = []
let handler: (c: Call) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown } = () => ({ status: 200, body: {} })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init: { body?: string } = {}) => {
  const c: Call = { path: new URL(String(input)).pathname, body: init.body ? JSON.parse(init.body) : null }
  calls.push(c)
  const r = await handler(c)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch
const issues = () => calls.filter((c) => c.path === "/atms/withdraw/issue")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const okWd = (gm: number, code: string) => ({ status: 200, body: { progress: { gm_id: gm, done: [0], approved: true, code } } })
const isHubCall = (c: Call) => c.body?.inventory_id === 44

const line = (o: Partial<SwLine>): SwLine => ({
  skuId: 11, skuCode: "N-11", skuName: "น็อต", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0,
  mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o,
})
const hubLine = (qty: number, o: Partial<SwLine> = {}) => line({ skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", requestedQty: qty, issuedQty: qty, hub: { vendorCode: "V1" }, ...o })

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, swLogCol, transition } = await import("../lib/store-withdraw/db")
  const { saveCreds } = await import("../lib/store-withdraw/creds")
  const { issueRequest, retryHubWd, MSG } = await import("../lib/store-withdraw/issue")
  const { editLines } = await import("../lib/store-withdraw/service")
  const { hubWdDone, hubPrOverdue } = await import("../lib/store-withdraw/hub-core")
  const { buildQueue } = await import("../lib/store-withdraw/service")
  const { bindHubPr } = await import("../lib/store-withdraw/hub-service")
  const { planCoreRows } = await import("../lib/core-return/sw-sync")
  const H = await import("../lib/store-withdraw/hub-db")
  const { baseCol } = await import("../lib/core-return/db")
  setStoreWithdrawClient(client)
  await saveCreds(store.email, "atms.user", "pw", { username: "atms.user", branch: "ลาดกระบัง", name: "X" })

  const c = await H.hubCols()
  await c.sites.insertOne({ inventoryId: 4, atmsHubInventoryId: 44, active: true })
  await c.vendors.insertOne({ code: "V1", name: "อู่หนึ่ง", active: true, createdAt: new Date() })
  await c.items.insertOne({ inventoryId: 4, vendorCode: "V1", skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", unit: "ชิ้น", price: 100, active: true, updatedAt: new Date() })
  const setStock = (qty: number) => c.stock.updateOne({ inventoryId: 4, vendorCode: "V1", skuId: 501 }, { $set: { qty } }, { upsert: true })
  const stock = async () => (await c.stock.findOne({ inventoryId: 4, vendorCode: "V1", skuId: 501 }))!.qty

  const baseAtms = { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
  async function seed(no: string, lines: SwLine[], p: Record<string, unknown> = {}) {
    const now = new Date()
    await (await swCol()).insertOne({
      no, kind: "stock", workType: "garage_in", status: "READY", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM-งานซ่อม",
      plate: "70-1234", mrCode: "MR-1", ref: null, urgent: false, remark: "", lines, requestedBy: store, claimedBy: null,
      rejectReason: null, atms: { ...baseAtms }, returns: [], createdAt: now, updatedAt: now,
      ...(lines.some((l) => l.hub) ? { hubWd: { ...baseAtms }, hubStatus: "WAIT_ISSUE" } : {}), ...p,
    } as unknown as SwRequest)
    return no
  }
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!

  // ---- 1. ใบปน ปกติ 1 + Hub 1 → WD สองใบ แยกคลัง ----
  await setStock(5)
  const n1 = await seed("H-MIX", [line({ issuedQty: 3, requestedQty: 3 }), hubLine(2)])
  calls = []
  handler = (x) => (isHubCall(x) ? okWd(800, "LBWD-H1") : okWd(700, "LBWD-N1"))
  const r1 = await issueRequest(n1, store)
  eq(issues().length, 2)
  eq(issues()[0].body!.inventory_id, 4)
  eq(issues()[0].body!.remark_token, n1)
  eq(issues()[0].body!.lines!.map((l) => l.sku_id), [11])
  eq(issues()[1].body!.inventory_id, 44)
  eq(issues()[1].body!.remark_token, `${n1}-H`)
  eq(issues()[1].body!.lines!.map((l) => [l.sku_id, l.amount]), [[501, 2]])
  assert.match(String(issues()[1].body!.date), /^\d{2}\/\d{2}\/\d{4}$/)
  eq(r1.status, "ISSUED")
  const d1 = await get(n1)
  eq(d1.status, "ISSUED"); eq(d1.atms.code, "LBWD-N1"); eq(d1.hubWd!.code, "LBWD-H1")
  assert.ok(d1.hubIssuedAt instanceof Date)
  eq(await stock(), 3)
  eq(d1.hubStatus, "WAIT_PR")
  // แถวซาก: ปกติใช้ WD ปกติ · Hub ใช้ WD Hub
  const rows1 = await (await baseCol()).find({ swNo: n1 }).sort({ row_key: 1 }).toArray()
  eq(rows1.map((r) => [r.row_key, r.wdCode, r.skuCode]), [[`sw:${n1}:0`, "LBWD-N1", "N-11"], [`sw:${n1}:1`, "LBWD-H1", "S501"]])

  // ---- 1b. ตัดยอด Hub: hubIssuedAt กับ hubStatus เขียนคำสั่งเดียว · ผู้ขอผูก PR แทรกกลางทาง → คิดสถานะจากค่า PR ใหม่ ----
  {
    const { Collection } = await import("mongodb")
    await setStock(5)
    const nS = await seed("H-ONESTEP", [hubLine(1)])
    const realUpd = Collection.prototype.updateOne
    const seen: Record<string, unknown>[] = []
    let raced = false
    Collection.prototype.updateOne = async function (this: InstanceType<typeof Collection>, f: never, u: never, o?: never) {
      const set = (u as { $set?: Record<string, unknown> }).$set
      if (this.collectionName === "store_withdraw_requests" && set && "hubIssuedAt" in set) {
        seen.push(set)
        if (!raced) { raced = true; await realUpd.call(this, { no: nS } as never, { $set: { hubPr: { code: "PR-RACE", id: null, by: store, at: new Date() } } } as never) }
      }
      return realUpd.call(this, f, u, o)
    } as typeof realUpd
    calls = []
    handler = () => ({ status: 500, body: { detail: "พัง" } }) // WD Hub ล้ม → hubStatus หลังตัดยอดต้องเป็น WAIT_WD (มี PR แล้ว)
    try { await issueRequest(nS, store) } finally { Collection.prototype.updateOne = realUpd }
    assert.ok(seen.length >= 1 && seen.every((x) => "hubStatus" in x), "hubIssuedAt ต้องมากับ hubStatus เสมอ")
    eq(seen[seen.length - 1].hubStatus, "WAIT_WD")
    eq((await get(nS)).hubStatus, "WAIT_WD"); eq((await get(nS)).hubPr!.code, "PR-RACE")
  }

  // ---- 2. ใบมีแต่ Hub → ยิงครั้งเดียว (คลัง Hub) · ISSUED ----
  await setStock(5)
  const n2 = await seed("H-ONLY", [hubLine(2)])
  calls = []
  handler = () => okWd(801, "LBWD-H2")
  const r2 = await issueRequest(n2, store)
  eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 44)
  eq(r2.status, "ISSUED"); eq((await get(n2)).status, "ISSUED")
  eq((await get(n2)).atms.code, null) // ไม่มี WD ปกติ
  eq((await get(n2)).hubWd!.code, "LBWD-H2")
  eq(await stock(), 3)

  // ---- 3. WD Hub ตอบ 409 → ใบยัง ISSUED · retryHubWd ok · ไม่ตัดยอดซ้ำ ----
  await setStock(5)
  const n3 = await seed("H-WDFAIL", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? { status: 409, body: { detail: "คลัง Hub ไม่พอ", progress: { gm_id: 802, done: [], approved: false, code: null } } } : okWd(702, "LBWD-N3"))
  await issueRequest(n3, store)
  let d3 = await get(n3)
  eq(d3.status, "ISSUED"); eq(d3.hubWd!.error, "คลัง Hub ไม่พอ"); eq(d3.hubStatus, "WAIT_PR_WD"); eq(d3.hubWd!.gmId, 802)
  eq(await stock(), 3)
  eq((await (await baseCol()).find({ swNo: n3 }).toArray()).map((r) => r.skuCode), ["N-11"]) // Hub ยังไม่มีแถวซาก
  calls = []
  handler = () => okWd(802, "LBWD-H3")
  const r3 = await retryHubWd(n3, store)
  eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 44)
  eq((issues()[0].body as Record<string, unknown>).progress, { gm_id: 802, done: [], approved: false, code: null })
  assert.ok(hubWdDone(r3)); d3 = await get(n3)
  assert.ok(hubWdDone(d3)); eq(d3.hubWd!.code, "LBWD-H3"); eq(d3.hubWd!.error, null); eq(d3.hubStatus, "WAIT_PR"); eq(d3.status, "ISSUED")
  eq(await stock(), 3)
  eq((await (await baseCol()).find({ swNo: n3 }).sort({ row_key: 1 }).toArray()).map((r) => [r.skuCode, r.wdCode]), [["N-11", "LBWD-N3"], ["S501", "LBWD-H3"]])
  // เสร็จแล้วลองใหม่อีก = 409
  await assert.rejects(retryHubWd(n3, store), (e: Error) => e.name === "ConflictError")
  // ใบที่ยังไม่ตัดยอด Hub ลองใหม่ไม่ได้
  const n3b = await seed("H-NOTYET", [hubLine(1)])
  await assert.rejects(retryHubWd(n3b, store), (e: Error) => e.name === "ConflictError")

  // ---- 4. WD ปกติล้ม แต่ WD Hub ok → กดใหม่ยิงแค่ WD ปกติ ----
  await setStock(5)
  const n4 = await seed("H-NFAIL", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? okWd(803, "LBWD-H4") : { status: 409, body: { detail: "ติดบรรทัดแรก", progress: { gm_id: 703, done: [], approved: false, code: null } } })
  await issueRequest(n4, store)
  let d4 = await get(n4)
  eq(d4.status, "ISSUE_FAILED"); eq(d4.hubWd!.code, "LBWD-H4"); eq(await stock(), 3)
  calls = []
  handler = (x) => (isHubCall(x) ? okWd(999, "WRONG") : okWd(703, "LBWD-N4"))
  await issueRequest(n4, store)
  eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4)
  d4 = await get(n4)
  eq(d4.status, "ISSUED"); eq(d4.hubWd!.code, "LBWD-H4"); eq(await stock(), 3)

  // ---- 5. ยอด Hub ไม่พอ → 409 · กลับ READY · ไม่ยิง ATMS ----
  await setStock(5)
  const n5 = await seed("H-SHORT", [line({}), hubLine(9)])
  calls = []
  await assert.rejects(issueRequest(n5, store), (e: Error & { status?: number }) => e.message.includes("ยอด Hub ไม่พอ") && e.message.includes("S501") && e.status === 409)
  eq(MSG.hubShort(["A", "B"]), "ยอด Hub ไม่พอ: A, B แก้จำนวนแล้วกดส่งใหม่")
  eq((await get(n5)).status, "PREPARING"); eq(calls.length, 0); eq(await stock(), 5) // กลับไปจัดของ ให้แก้จำนวนได้
  eq((await get(n5)).hubIssuedAt ?? null, null)
  assert.ok((await (await swLogCol()).find({ no: n5, action: "hubShort" }).toArray()).length === 1)
  // แก้จำนวนแล้วส่งใหม่ได้
  await editLines(n5, [{ index: 1, issuedQty: 4 }], store) // ทางเดียวกับ PATCH /lines
  await transition(n5, "ready", store)
  handler = (x) => (isHubCall(x) ? okWd(804, "LBWD-H5") : okWd(704, "LBWD-N5"))
  eq((await issueRequest(n5, store)).status, "ISSUED"); eq(await stock(), 1)

  // busy (ล็อกตัดยอดของใบนี้ค้างอยู่) → 409 · กลับ READY
  await setStock(5)
  const n5b = await seed("H-BUSY", [hubLine(1)])
  await c.locks.insertOne({ _id: `cut:${n5b}`, at: new Date(), owner: "other" })
  calls = []
  await assert.rejects(issueRequest(n5b, store), (e: Error & { status?: number }) => e.message === "กำลังตัดยอด Hub อยู่ ลองใหม่อีกครั้ง" && e.status === 409)
  eq((await get(n5b)).status, "READY"); eq(calls.length, 0); eq(await stock(), 5)
  await c.locks.deleteOne({ _id: `cut:${n5b}` })

  // ---- 6. บรรทัด Hub จ่าย 0 ----
  await setStock(5)
  const n6 = await seed("H-ZERO", [line({}), hubLine(2, { issuedQty: 0 })])
  calls = []
  handler = () => okWd(705, "LBWD-N6")
  await issueRequest(n6, store)
  eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4); eq(await stock(), 5)
  eq((await get(n6)).status, "ISSUED"); assert.ok(hubWdDone(await get(n6)))
  eq((await get(n6)).hubStatus, "NONE") // ไม่ได้จ่ายของ Hub เลย ไม่ต้องตาม PR
  // Hub บรรทัดเดียวและจ่าย 0 → ไม่ยิงอะไรเลยของ Hub
  const n6b = await seed("H-ZERO2", [line({}), line({ skuId: 12 }), hubLine(3, { issuedQty: 0 })])
  calls = []
  await issueRequest(n6b, store)
  eq(issues().filter(isHubCall).length, 0); assert.ok(hubWdDone(await get(n6b))); eq(await stock(), 5)
  eq((await get(n6b)).hubStatus, "NONE")

  // ---- 7. ไม่มีคลัง Hub active → ตัดยอดแล้ว WD Hub ไม่ยิง error ไทย · ส่วนปกติไปต่อ ----
  await c.sites.updateOne({ inventoryId: 4 }, { $set: { active: false } })
  await setStock(5)
  const n7 = await seed("H-NOSITE", [line({}), hubLine(2)])
  calls = []
  handler = () => okWd(706, "LBWD-N7")
  await issueRequest(n7, store)
  eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4)
  const d7 = await get(n7)
  eq(d7.status, "ISSUED"); eq(d7.hubWd!.error, "คลังนี้ยังไม่ตั้งคลัง Hub ใน ATMS แจ้งผู้ดูแล"); eq(await stock(), 3); eq(d7.hubStatus, "WAIT_PR_WD")
  await c.sites.updateOne({ inventoryId: 4 }, { $set: { active: true } })

  // ---- 8. reject หลัง WD ปกติล้ม (gmId null) + WD Hub ล้ม → คืนยอด ----
  await setStock(5)
  const n8 = await seed("H-REJ", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? { status: 500, body: { detail: "พัง" } } : { status: 500, body: { detail: "พัง" } })
  await issueRequest(n8, store)
  eq((await get(n8)).status, "ISSUE_FAILED"); eq((await get(n8)).atms.gmId, null); eq(await stock(), 3)
  await transition(n8, "reject", store, { rejectReason: "ยกเลิก" })
  const d8 = await get(n8)
  eq(d8.status, "REJECTED"); eq(await stock(), 5); assert.ok(d8.hubRestoredAt instanceof Date); eq(d8.hubStatus, "NONE")
  assert.ok((await (await swLogCol()).find({ no: n8, action: "hubRestore" }).toArray()).length === 1)
  // WD Hub ล้มแบบมี gmId ปกติ → closeManual → คืนยอด
  await setStock(5)
  const n8c = await seed("H-CLOSE", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? { status: 500, body: { detail: "พัง" } } : { status: 409, body: { detail: "ค้าง", progress: { gm_id: 708, done: [], approved: false, code: null } } })
  await issueRequest(n8c, store)
  eq(await stock(), 3)
  await transition(n8c, "closeManual", store, { rejectReason: "ปิดมือ: x" })
  eq(await stock(), 5); assert.ok((await get(n8c)).hubRestoredAt instanceof Date)
  // WD Hub ok แล้ว reject → ไม่คืน
  await setStock(5)
  const n8b = await seed("H-REJOK", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? okWd(805, "LBWD-H8") : { status: 500, body: { detail: "พัง" } })
  await issueRequest(n8b, store)
  eq((await get(n8b)).status, "ISSUE_FAILED"); eq(await stock(), 3)
  await transition(n8b, "reject", store, { rejectReason: "ยกเลิก" })
  eq(await stock(), 3); eq((await get(n8b)).hubRestoredAt ?? null, null)
  // ปิดใบแล้วแต่ WD Hub ตัดไปแล้ว = ยังค้าง PR: WAIT_PR · log · อยู่ในคิว · เกินกำหนดนับต่อ · แถวซาก Hub คงอยู่ · ผูก PR ได้ → DONE
  const closedFollow = async (no: string, wdH: string) => {
    const d = await get(no)
    eq(d.status, "REJECTED"); eq(d.hubStatus, "WAIT_PR")
    eq((await (await swLogCol()).find({ no, action: "hubClosed-wdDone" }).toArray()).length, 1)
    const q = await buildQueue(4)
    const inQ = q.DONE_TODAY.find((x) => x.no === no)
    assert.ok(inQ, `${no} ต้องอยู่ในคิวรอ PR`); eq(inQ!.hubStatus, "WAIT_PR"); eq(inQ!.hubOverdue, false)
    // ส่งของไปนานแล้ว (updatedAt เก่า) ก็ยังอยู่ในคิว + ขึ้นเกินกำหนด
    const old = new Date(Date.now() - 3 * 86400_000)
    await (await swCol()).updateOne({ no }, { $set: { hubIssuedAt: old, updatedAt: old } })
    const q2 = (await buildQueue(4)).DONE_TODAY.find((x) => x.no === no)
    assert.ok(q2); eq(q2!.hubOverdue, true)
    eq(planCoreRows((await get(no))).filter((p) => p.wdCode === wdH).length, 1)
    const b = await bindHubPr(no, { code: "PR-H01", id: null }, store, true)
    eq(b.hubStatus, "DONE"); eq((await get(no)).hubStatus, "DONE")
    eq(hubPrOverdue(await get(no), new Date()), false)
  }
  await closedFollow(n8b, "LBWD-H8")
  // closeManual (WD ปกติมีหัวใบแล้ว) + WD Hub ok → เหมือนกัน
  await setStock(5)
  const n8d = await seed("H-CLOSEOK", [line({}), hubLine(2)])
  handler = (x) => (isHubCall(x) ? okWd(807, "LBWD-H8D") : { status: 409, body: { detail: "ค้าง", progress: { gm_id: 709, done: [], approved: false, code: null } } })
  await issueRequest(n8d, store)
  eq((await get(n8d)).status, "ISSUE_FAILED"); eq(await stock(), 3)
  await transition(n8d, "closeManual", store, { rejectReason: "ปิดมือ: x" })
  eq(await stock(), 3); eq((await get(n8d)).hubRestoredAt ?? null, null)
  await closedFollow(n8d, "LBWD-H8D")
  // ใบปิดที่ WD Hub ยังไม่ตัด (คืนยอดแล้ว) → NONE · ไม่เกินกำหนด · ผูก PR ไม่ได้
  eq(hubPrOverdue({ ...(await get(n8)), hubIssuedAt: new Date(0) }, new Date()), false)
  await assert.rejects(bindHubPr(n8, { code: "PR-H02", id: null }, store, true), (e: Error) => e.name === "ConflictError")
  // A: WD ปกติล้ม (gmId null) + WD Hub ไม่ได้คำตอบ → reject ไม่คืนยอด (WD Hub อาจเกิดใน ATMS) + log ข้าม
  await setStock(5)
  const nA = await seed("H-REJUNK", [line({}), hubLine(2)])
  handler = (x) => { if (isHubCall(x)) throw new Error("ECONNRESET"); return { status: 500, body: { detail: "พัง" } } }
  await issueRequest(nA, store)
  eq((await get(nA)).status, "ISSUE_FAILED"); eq((await get(nA)).hubWd!.error, MSG.unknown); eq(await stock(), 3)
  // ครบ 5 นาทีแล้ว (ล็อกเก่า) ก็ยังไม่คืน เพราะยังไม่รู้ผล
  await (await swCol()).updateOne({ no: nA }, { $set: { hubWdBusyAt: new Date(Date.now() - 10 * 60_000) } })
  await transition(nA, "reject", store, { rejectReason: "x" })
  eq((await get(nA)).status, "REJECTED"); eq(await stock(), 3); eq((await get(nA)).hubRestoredAt ?? null, null)
  const skipA = await (await swLogCol()).find({ no: nA, action: "hubRestore-skipped" }).toArray()
  eq(skipA.length, 1); assert.ok(skipA[0].note!.includes("กำลังตัด WD Hub") || skipA[0].note!.includes("ยังไม่รู้ผล"))
  // ล็อกว่างแต่ error ไม่รู้ผล → ข้ามเหมือนกัน
  await setStock(5)
  const nA2 = await seed("H-REJUNK2", [line({}), hubLine(2)])
  await issueRequest(nA2, store)
  await (await swCol()).updateOne({ no: nA2 }, { $set: { hubWdBusyAt: null } })
  await transition(nA2, "reject", store, { rejectReason: "x" })
  eq(await stock(), 3)
  assert.ok((await (await swLogCol()).findOne({ no: nA2, action: "hubRestore-skipped" }))!.note!.includes("ยังไม่รู้ผล"))

  // B: reject ระหว่าง WD Hub รอ ATMS → ไม่คืนยอด · ไม่มีแถวซาก Hub · แต่บันทึกเลข WD Hub ไว้
  await setStock(5)
  const nB = await seed("H-REJMID", [line({}), hubLine(2)])
  let release: (v: { status: number; body: unknown }) => void = () => {}
  const held = new Promise<{ status: number; body: unknown }>((r) => { release = r })
  handler = (x) => (isHubCall(x) ? held : { status: 500, body: { detail: "พัง" } })
  calls = []
  const pB = issueRequest(nB, store)
  while (!issues().some(isHubCall)) await sleep(10)
  eq((await get(nB)).status, "ISSUE_FAILED")
  await transition(nB, "reject", store, { rejectReason: "x" })
  eq(await stock(), 3); eq((await get(nB)).hubRestoredAt ?? null, null)
  assert.ok((await (await swLogCol()).findOne({ no: nB, action: "hubRestore-skipped" }))!.note!.includes("กำลังตัด WD Hub"))
  release(okWd(810, "LBWD-HB"))
  await pB
  const dB = await get(nB)
  // ได้ WD Hub หลังปิด = ของออกไปจริง ยังค้าง PR + มีแถวซากของบรรทัด Hub
  eq(dB.status, "REJECTED"); eq(dB.hubWd!.code, "LBWD-HB"); eq(dB.hubWdBusyAt ?? null, null); eq(dB.hubStatus, "WAIT_PR")
  eq((await (await baseCol()).find({ swNo: nB }).toArray()).map((r) => r.wdCode), ["LBWD-HB"])
  eq((await (await swLogCol()).find({ no: nB, action: "hubWd-after-close" }).toArray()).length, 1)
  eq(await stock(), 3)

  // ใบไม่มี Hub: reject เหมือนเดิม ไม่มี field hub เพิ่ม
  const n8n = await seed("H-PLAIN", [line({})])
  await transition(n8n, "reject", store, { rejectReason: "x" })
  const d8n = await get(n8n)
  eq(d8n.status, "REJECTED"); eq("hubRestoredAt" in d8n, false); eq("hubStatus" in d8n, false)

  // ---- 9. issueRequest พร้อมกันสองครั้ง → ตัดยอดครั้งเดียว ----
  await setStock(5)
  const n9 = await seed("H-CONC", [line({}), hubLine(2)])
  calls = []
  handler = async (x) => { await sleep(60); return isHubCall(x) ? okWd(806, "LBWD-H9") : okWd(709, "LBWD-N9") }
  const res = await Promise.allSettled([issueRequest(n9, store), issueRequest(n9, store)])
  eq(res.filter((r) => r.status === "rejected").length, 1)
  eq(await stock(), 3); eq(issues().length, 2)
  eq((await c.moves.find({ type: "issue", refNo: n9 }).toArray()).length, 1)

  // ---- 10. WD Hub ไม่ได้คำตอบ → error "ไม่รู้ผล" · ลองใหม่ทันทีไม่ได้ ----
  await setStock(5)
  const n10 = await seed("H-UNK", [hubLine(1)])
  handler = (x) => { if (isHubCall(x)) throw new Error("ECONNRESET"); return okWd(1, "x") }
  await issueRequest(n10, store)
  eq((await get(n10)).status, "ISSUED"); eq((await get(n10)).hubWd!.error, MSG.unknown)
  calls = []
  await assert.rejects(retryHubWd(n10, store), (e: Error) => e.name === "ConflictError")
  eq(calls.length, 0)

  // ---- 11. ใบไม่มี Hub: body เดิมทุกอย่าง ไม่มี field hub ----
  const n11 = await seed("H-NOHUB", [line({}), line({ skuId: 12, issuedQty: 0 })])
  calls = []
  handler = () => okWd(711, "LBWD-N11")
  await issueRequest(n11, store)
  eq(issues().length, 1); eq(issues()[0].body!.lines!.map((l) => l.sku_id), [11])
  const d11 = await get(n11)
  eq(d11.status, "ISSUED"); eq("hubStatus" in d11, false); eq("hubIssuedAt" in d11, false); eq("hubWd" in d11, false)

  // ---- 12. คลังไม่มีคลัง Hub ใน ATMS (เลขว่าง) = บันทึกใน WMS อย่างเดียว ไม่ยิง WD Hub ----
  {
    await c.sites.updateOne({ inventoryId: 4 }, { $set: { atmsHubInventoryId: null } })
    eq(H.hubSiteWmsOnly(await H.getHubSite(4)), true)
    // ใบปน: ยิง WD ปกติใบเดียว (คลัง 4 เฉพาะบรรทัดปกติ) · ยอด Hub ลด · ไม่มี WD Hub · ปิดงานเมื่อผูก PR
    await setStock(5)
    const w1 = await seed("H-WMS-MIX", [line({}), hubLine(2)])
    calls = []
    handler = (x) => (isHubCall(x) ? okWd(999, "SHOULD-NOT") : okWd(720, "LBWD-W1"))
    await issueRequest(w1, store)
    eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4); eq(issues()[0].body!.lines!.map((l) => l.sku_id), [11])
    let dw = await get(w1)
    eq(dw.status, "ISSUED"); eq(dw.hubWmsOnly, true); eq(dw.hubWd!.code, null); eq(hubWdDone(dw), true)
    eq(dw.hubStatus, "WAIT_PR"); eq(await stock(), 3)
    eq((await (await baseCol()).find({ swNo: w1 }).toArray()).map((r) => r.skuCode), ["N-11"]) // Hub ไม่มี WD = ไม่มีแถวซาก
    await assert.rejects(() => retryHubWd(w1, store)) // ไม่มีอะไรให้ลองใหม่
    dw = await bindHubPr(w1, { code: "LBPR-W1", id: 9 }, store, true)
    eq(dw.hubStatus, "DONE")

    // ใบมีแต่ Hub: ไม่ยิง ATMS เลย · ISSUED · ยอดลด
    await setStock(5)
    const w2 = await seed("H-WMS-ONLY", [hubLine(1)])
    calls = []
    handler = () => okWd(999, "SHOULD-NOT")
    await issueRequest(w2, store)
    eq(issues().length, 0); eq((await get(w2)).status, "ISSUED"); eq((await get(w2)).hubStatus, "WAIT_PR"); eq(await stock(), 4)

    // WD ปกติล้ม (ยังไม่มีหัวใบ) → ปฏิเสธใบ → คืนยอด Hub (ไม่มี WD Hub ให้กังวล) · ไม่ค้าง PR
    await setStock(5)
    const w3 = await seed("H-WMS-REJ", [line({}), hubLine(2)])
    handler = () => ({ status: 500, body: { detail: "พัง" } })
    await issueRequest(w3, store)
    eq((await get(w3)).status, "ISSUE_FAILED"); eq(await stock(), 3)
    await transition(w3, "reject", store, { rejectReason: "ทดสอบ" })
    const dr = await get(w3)
    eq(await stock(), 5); assert.ok(dr.hubRestoredAt instanceof Date); eq(dr.hubStatus, "NONE")

    await c.sites.updateOne({ inventoryId: 4 }, { $set: { atmsHubInventoryId: 44 } })
  }

  // ledger Hub ตรงทุกขั้น (setStock เขียนทับยอด จึงเช็กแค่ว่ามี issue 1 แถวต่อบรรทัดต่อใบ)
  const dupe = await c.moves.aggregate([{ $match: { type: "issue" } }, { $group: { _id: { r: "$refNo", l: "$lineIndex" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()
  eq(dupe.length, 0)

  await client.db("hub_issue_test").dropDatabase()
  await client.db("hub_issue_core_test").dropDatabase()
  await client.close()
  await mongod.stop()
  globalThis.fetch = realFetch
  console.log("check-hub-issue: all passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
