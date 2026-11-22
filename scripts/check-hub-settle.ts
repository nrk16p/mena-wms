// scripts/check-hub-settle.ts — Mobile/PM ที่มีบรรทัด Hub: ตัดยอดตอนส่งของ · WD Hub ต่อทะเบียนตอนตัดสต๊อก · ของเหลือคืนยอด Hub
// รัน: npx tsx scripts/check-hub-settle.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · stub api-ncac ด้วย globalThis.fetch)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwLine, SwRequest, SwUsage } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "hub_settle_test"
process.env.CORE_RETURN_DB = "hub_settle_core_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, unknown> & { lines?: { sku_id: number; amount: number; mr_item_id?: number }[] }
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
const okWd = (gm: number, code: string) => ({ status: 200, body: { progress: { gm_id: gm, done: [0], approved: true, code } } })
const isHubCall = (c: Call) => c.body?.inventory_id === 44

const line = (o: Partial<SwLine>): SwLine => ({
  skuId: 11, skuCode: "N-11", skuName: "น็อต", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0,
  mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o,
})
const hubLine = (qty: number, o: Partial<SwLine> = {}) => line({ skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", requestedQty: qty, issuedQty: qty, hub: { vendorCode: "V1" }, ...o })
const mkUse = (lineIndex: number, qty: number, plate = "71-1234", o: Partial<SwUsage> = {}): SwUsage =>
  ({ lineIndex, plate, mrCode: "MR-1", mrItemId: 11, mrItemLabel: "MR-1 PM-เบรค : 11", qty, attachmentIds: ["a1"], ...o })

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol } = await import("../lib/store-withdraw/db")
  const { saveCreds } = await import("../lib/store-withdraw/creds")
  const { retryHubWd, MSG } = await import("../lib/store-withdraw/issue")
  const S = await import("../lib/store-withdraw/settle")
  const P = await import("../lib/store-withdraw/pending")
  const { hubWdDone } = await import("../lib/store-withdraw/hub-core")
  const H = await import("../lib/store-withdraw/hub-db")
  const { baseCol } = await import("../lib/core-return/db")
  setStoreWithdrawClient(client)
  await saveCreds(store.email, "atms.user", "pw", { username: "atms.user", branch: "ลาดกระบัง", name: "X" })

  // ---- 0. buildSettleGroups (ตรรกะล้วน) ----
  const atms0 = () => ({ gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null })
  const us = [mkUse(0, 1, "72-0002"), mkUse(1, 2, "72-0002"), mkUse(1, 1, "71-0001"), mkUse(0, 1, "71-0001"), mkUse(2, 1, "72-0002")]
  const plain = [line({}), hubLine(3), line({ skuId: 12 })]
  const old = P.buildSettleGroups("SW-X", us, atms0)
  // ไม่ส่ง lines = ผลเดิมทุกอย่าง (บรรทัด Hub ปนในกลุ่มทะเบียนเดียวกัน)
  eq(old.map((g) => [g.n, g.plate, g.token, g.lines.map((l) => l.lineIndex), "hub" in g]), [[1, "71-0001", "SW-X-1", [1, 0], false], [2, "72-0002", "SW-X-2", [0, 1, 2], false]])
  // ส่ง lines แต่ไม่มีบรรทัด Hub = เท่าเดิม
  eq(P.buildSettleGroups("SW-X", us, atms0, [line({}), line({ skuId: 13 }), line({ skuId: 12 })]), old)
  // มี Hub: แยกกลุ่มต่อ (ทะเบียน, Hub) · ปกติ token เดิม · Hub token -H<k> นับแยก · n ไม่ซ้ำกันทั้งใบ
  const hg = P.buildSettleGroups("SW-X", us, atms0, plain)
  eq(hg.map((g) => [g.n, g.plate, g.token, g.lines.map((l) => [l.lineIndex, l.qty]), !!g.hub]), [
    [1, "71-0001", "SW-X-1", [[0, 1]], false],
    [2, "72-0002", "SW-X-2", [[0, 1], [2, 1]], false],
    [3, "71-0001", "SW-X-H1", [[1, 1]], true],
    [4, "72-0002", "SW-X-H2", [[1, 2]], true],
  ])
  eq(hg.filter((g) => !g.hub).every((g) => !("hub" in g)), true) // กลุ่มปกติไม่มี field hub (หน้าตาเดิม)

  // ---- ตั้งค่า Hub ----
  const c = await H.hubCols()
  await c.sites.insertOne({ inventoryId: 4, atmsHubInventoryId: 44, active: true })
  await c.vendors.insertOne({ code: "V1", name: "อู่หนึ่ง", active: true, createdAt: new Date() })
  await c.items.insertOne({ inventoryId: 4, vendorCode: "V1", skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", unit: "ชิ้น", price: 100, active: true, updatedAt: new Date() })
  const setStock = (qty: number) => c.stock.updateOne({ inventoryId: 4, vendorCode: "V1", skuId: 501 }, { $set: { qty } }, { upsert: true })
  const stock = async () => (await c.stock.findOne({ inventoryId: 4, vendorCode: "V1", skuId: 501 }))!.qty

  const baseAtms = atms0()
  async function seed(no: string, lines: SwLine[], p: Record<string, unknown> = {}) {
    const now = new Date()
    await (await swCol()).insertOne({
      no, kind: "stock", workType: "mobile_pm", status: "READY", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM-งานซ่อม",
      plate: "", mrCode: null, ref: null, urgent: false, remark: "", lines, requestedBy: store, claimedBy: null,
      rejectReason: null, atms: { ...baseAtms }, returns: [], summaryDueAt: new Date(Date.now() + 86_400_000), createdAt: now, updatedAt: now,
      ...(lines.some((l) => l.hub) ? { hubWd: null, hubStatus: "WAIT_ISSUE" } : {}), ...p,
    } as unknown as SwRequest)
    return no
  }
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!
  /** ช่างสรุป (ตรงไปที่ DB — submitSummary มีเทสต์ของมันเองแล้ว) */
  async function summarize(no: string, usages: SwUsage[]) {
    const cur = await get(no)
    const p = P.parseSummary(cur.lines, { usages })
    if ("error" in p) throw new Error(p.error)
    await (await swCol()).updateOne({ no, status: "HANDED_OUT" }, { $set: { status: "SUMMARIZED", summary: { ...p, by: store, at: new Date() } } })
  }
  const coreRows = async (no: string) => (await (await baseCol()).find({ swNo: no }).sort({ row_key: 1 }).toArray()).map((r) => [r.row_key, r.wdCode, r.skuCode])

  // ---- 1. ส่งของ: ตัดยอด Hub · ไม่ยิง ATMS ----
  await setStock(5)
  const n1 = await seed("P-MIX", [line({}), hubLine(3)])
  calls = []
  const ho = await S.handOut(n1, store)
  eq(ho.status, "HANDED_OUT"); eq(calls.length, 0)
  eq(await stock(), 2)
  let d1 = await get(n1)
  assert.ok(d1.hubIssuedAt instanceof Date)
  eq(d1.hubStatus, "WAIT_PR_WD")
  eq((await c.moves.find({ type: "issue", refNo: n1 }).toArray()).map((m) => [m.lineIndex, m.qty]), [[1, -3]])

  // ---- 2. สรุป: Hub ใช้ 2 เหลือ 1 · ปกติใช้ 1 → ตัดสต๊อก = WD ปกติ + WD Hub แยกใบ · คืนของเหลือเข้ายอด Hub ----
  await summarize(n1, [mkUse(0, 1), mkUse(1, 2)])
  await assert.rejects(S.settleRequest(n1, false, store), /รับของคืนแล้ว/) // มีของเหลือ ต้องติ๊กรับคืน
  eq(await stock(), 2)
  calls = []
  handler = (x) => (isHubCall(x) ? okWd(900, "LBWD-H1") : okWd(800, "LBWD-N1"))
  const r1 = await S.settleRequest(n1, true, store)
  eq(issues().length, 2)
  eq([issues()[0].body!.remark_token, issues()[0].body!.inventory_id, issues()[0].body!.lines!.map((l) => [l.sku_id, l.amount])], [`${n1}-1`, 4, [[11, 1]]])
  eq([issues()[1].body!.remark_token, issues()[1].body!.inventory_id, issues()[1].body!.lines!.map((l) => [l.sku_id, l.amount, l.mr_item_id])], [`${n1}-H1`, 44, [[501, 2, 11]]])
  eq(issues()[1].body!.pick_to_id, 7)
  assert.match(String(issues()[1].body!.date), /^\d{2}\/\d{2}\/\d{4}$/)
  assert.match(String(issues()[1].body!.remark), /71-1234/)
  eq(r1.status, "SETTLED")
  d1 = await get(n1)
  eq(d1.status, "SETTLED")
  eq(d1.settleGroups!.map((g) => [g.token, g.status, g.atms.code, !!g.hub]), [[`${n1}-1`, "DONE", "LBWD-N1", false], [`${n1}-H1`, "DONE", "LBWD-H1", true]])
  eq(await stock(), 3) // คืน 1
  eq((await c.moves.find({ type: "return", refNo: n1 }).toArray()).map((m) => [m.lineIndex, m.qty]), [[1, 1]])
  assert.ok(hubWdDone(d1)); eq(d1.hubStatus, "WAIT_PR"); eq(d1.hubWdBusyAt ?? null, null)
  eq(await coreRows(n1), [[`sw:${n1}:0:0`, "LBWD-N1", "N-11"], [`sw:${n1}:1:1`, "LBWD-H1", "S501"]])
  await assert.rejects(S.settleRequest(n1, true, store), (e: Error) => e.name === "ConflictError") // ตัดซ้ำไม่ได้
  await assert.rejects(retryHubWd(n1, store), (e: Error) => e.name === "ConflictError") // เสร็จแล้ว
  eq(await stock(), 3)

  // ---- 3. WD Hub ตอบ 409 → ใบยัง SETTLED · retryHubWd ยิงเฉพาะกลุ่ม Hub ที่ค้าง ----
  await setStock(5)
  const n3 = await seed("P-HFAIL", [line({}), hubLine(3)])
  await S.handOut(n3, store); eq(await stock(), 2)
  await summarize(n3, [mkUse(0, 1), mkUse(1, 2)])
  handler = (x) => (isHubCall(x) ? { status: 409, body: { detail: "คลัง Hub ไม่พอ", progress: { gm_id: 903, done: [], approved: false, code: null } } } : okWd(803, "LBWD-N3"))
  const r3 = await S.settleRequest(n3, true, store)
  eq(r3.status, "SETTLED")
  let d3 = await get(n3)
  eq(d3.status, "SETTLED"); eq(d3.hubStatus, "WAIT_PR_WD"); eq(d3.hubWdBusyAt ?? null, null)
  const hub3 = d3.settleGroups!.find((g) => g.hub)!
  eq([hub3.status, hub3.atms.error, hub3.atms.gmId], ["PENDING", "คลัง Hub ไม่พอ", 903])
  eq(await stock(), 3)
  eq(await coreRows(n3), [[`sw:${n3}:0:0`, "LBWD-N3", "N-11"]]) // Hub ยังไม่มีแถวซาก
  calls = []
  handler = () => okWd(903, "LBWD-H3")
  const rr3 = await retryHubWd(n3, store)
  eq(issues().length, 1)
  eq([issues()[0].body!.remark_token, issues()[0].body!.inventory_id], [`${n3}-H1`, 44])
  eq((issues()[0].body as Record<string, unknown>).progress, { gm_id: 903, done: [], approved: false, code: null })
  assert.ok(hubWdDone(rr3)); eq(rr3.hubStatus, "WAIT_PR")
  d3 = await get(n3)
  eq(d3.status, "SETTLED"); eq(d3.hubStatus, "WAIT_PR")
  eq(d3.settleGroups!.map((g) => [g.status, g.atms.code, g.atms.error]), [["DONE", "LBWD-N3", null], ["DONE", "LBWD-H3", null]])
  eq(await coreRows(n3), [[`sw:${n3}:0:0`, "LBWD-N3", "N-11"], [`sw:${n3}:1:1`, "LBWD-H3", "S501"]])
  await assert.rejects(retryHubWd(n3, store), (e: Error) => e.name === "ConflictError")
  eq(await stock(), 3)

  // ---- 4. WD ปกติล้ม → SETTLE_FAILED (ยังไม่ยิง Hub) · กดใหม่ = claim ใหม่ ไม่คืนของเหลือซ้ำ ----
  await setStock(5)
  const n4 = await seed("P-NFAIL", [line({}), hubLine(3)])
  await S.handOut(n4, store)
  await summarize(n4, [mkUse(0, 1), mkUse(1, 2)])
  calls = []
  handler = (x) => (isHubCall(x) ? okWd(904, "LBWD-H4") : { status: 409, body: { detail: "ติดบรรทัดแรก", progress: { gm_id: 804, done: [], approved: false, code: null } } })
  const r4 = await S.settleRequest(n4, true, store)
  eq(r4.status, "SETTLE_FAILED"); eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4)
  eq(await stock(), 3) // คืนของเหลือแล้วตอนยืนยันรับคืน
  calls = []
  handler = (x) => (isHubCall(x) ? okWd(904, "LBWD-H4") : okWd(804, "LBWD-N4"))
  const rr4 = await S.settleRequest(n4, true, store)
  eq(rr4.status, "SETTLED"); eq(issues().length, 2)
  eq(await stock(), 3) // ไม่คืนซ้ำ
  eq((await c.moves.find({ type: "return", refNo: n4 }).toArray()).length, 1)
  eq((await get(n4)).hubStatus, "WAIT_PR")

  // ---- 5. ใบมีแต่ Hub (2 ทะเบียน) → SETTLED แล้วยิง WD Hub ต่อทะเบียน ใช้หมด ไม่มีของเหลือ ----
  await setStock(5)
  const n5 = await seed("P-ONLY", [hubLine(3)])
  await S.handOut(n5, store); eq(await stock(), 2)
  await summarize(n5, [mkUse(0, 2, "71-1234"), mkUse(0, 1, "70-0001")])
  calls = []
  handler = (x) => okWd(950, `LBWD-${x.body!.remark_token}`)
  const r5 = await S.settleRequest(n5, undefined, store)
  eq(r5.status, "SETTLED")
  eq(issues().map((x) => [x.body!.remark_token, x.body!.inventory_id, x.body!.lines!.map((l) => l.amount)]), [[`${n5}-H1`, 44, [1]], [`${n5}-H2`, 44, [2]]])
  eq(await stock(), 2) // ไม่มีของเหลือ
  eq((await get(n5)).hubStatus, "WAIT_PR")

  // ---- 6. WD Hub ไม่ได้คำตอบ → ล็อกค้าง ลองใหม่ทันทีไม่ได้ ----
  await setStock(5)
  const n6 = await seed("P-UNK", [hubLine(1)])
  await S.handOut(n6, store)
  await summarize(n6, [mkUse(0, 1)])
  handler = () => { throw new Error("ECONNRESET") }
  const r6 = await S.settleRequest(n6, undefined, store)
  eq(r6.status, "SETTLED")
  const d6 = await get(n6)
  eq(d6.settleGroups![0].atms.error, MSG.unknown); assert.ok(d6.hubWdBusyAt instanceof Date)
  calls = []
  await assert.rejects(retryHubWd(n6, store), (e: Error) => e.name === "ConflictError")
  eq(calls.length, 0)

  // ---- 7. ส่งของ ยอด Hub ไม่พอ → 409 ไม่ตัดสักบรรทัด กลับไปจัดของ (แก้จำนวนได้) · ชนกัน → 409 สถานะเดิม ----
  await setStock(1)
  const n7 = await seed("P-SHORT", [line({}), hubLine(3)])
  calls = []
  await assert.rejects(S.handOut(n7, store), (e: Error & { status?: number }) => e.status === 409 && /ยอด Hub ไม่พอ: S501/.test(e.message))
  let d7 = await get(n7)
  eq(d7.status, "PREPARING"); eq(d7.hubIssuedAt ?? null, null); eq(await stock(), 1); eq(calls.length, 0)
  eq((await c.moves.find({ refNo: n7 }).toArray()).length, 0)
  await (await swCol()).updateOne({ no: n7 }, { $set: { status: "READY" } })
  await c.locks.insertOne({ _id: `cut:${n7}`, at: new Date(), owner: "other" })
  await assert.rejects(S.handOut(n7, store), (e: Error & { status?: number }) => e.status === 409 && e.message === MSG.hubBusy)
  d7 = await get(n7)
  eq(d7.status, "READY"); eq(d7.hubIssuedAt ?? null, null)
  await c.locks.deleteOne({ _id: `cut:${n7}` })
  await setStock(5)
  eq((await S.handOut(n7, store)).status, "HANDED_OUT"); eq(await stock(), 2)
  await assert.rejects(S.handOut(n7, store), (e: Error) => e.name === "ConflictError") // กดซ้ำ
  eq(await stock(), 2)

  // ---- 8. ใบ pending ไม่มี Hub: ส่งของ/ตัดสต๊อกแบบเดิม ไม่มี field hub ----
  const n8 = await seed("P-NOHUB", [line({}), line({ skuId: 12 })])
  await S.handOut(n8, store)
  let d8 = await get(n8)
  eq(d8.status, "HANDED_OUT"); eq("hubIssuedAt" in d8, false); eq("hubStatus" in d8, false)
  await summarize(n8, [mkUse(0, 1), mkUse(1, 1, "70-0001")])
  calls = []
  handler = (x) => okWd(880, `LBWD-${x.body!.remark_token}`)
  await S.settleRequest(n8, undefined, store)
  d8 = await get(n8)
  eq(d8.status, "SETTLED"); eq(issues().map((x) => x.body!.remark_token), [`${n8}-1`, `${n8}-2`])
  eq(d8.settleGroups!.some((g) => "hub" in g), false); eq("hubStatus" in d8, false); eq("hubWdBusyAt" in d8, false)

  // ledger: ยอด = ผลรวมสมุด ต่อใบ (issue + return) ไม่มีแถวซ้ำ
  const dupe = await c.moves.aggregate([{ $match: { lineIndex: { $type: "number" } } }, { $group: { _id: { t: "$type", r: "$refNo", l: "$lineIndex" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()
  eq(dupe.length, 0)
  eq((await c.moves.find({ type: "adjust" }).toArray()).length, 0) // ใบ pending ไม่เคยคืนยอดแบบ restore

  // ---- 9. ส่งของชนกับการปฏิเสธ: ตัดยอด Hub แล้ว แต่ reject ชนะก่อนสลับ HANDED_OUT → คืนยอดทันที (ยังไม่มี WD Hub) ----
  {
    const { Collection } = await import("mongodb")
    await setStock(5)
    const n9 = await seed("P-RACE", [line({}), hubLine(2)])
    const realInsert = Collection.prototype.insertOne
    // แทรก reject หลังเขียนแถวตัดยอด (ระหว่าง cut กับ transition) — จำลองสโตร์อีกคนกดปฏิเสธพร้อมกัน
    Collection.prototype.insertOne = async function (this: InstanceType<typeof Collection>, doc: never, opts?: never) {
      const r = await realInsert.call(this, doc, opts)
      const d = doc as { type?: string; refNo?: string }
      if (this.collectionName === "hub_moves" && d.type === "issue" && d.refNo === n9) {
        await (await swCol()).updateOne({ no: n9, status: "READY" }, { $set: { status: "REJECTED", rejectReason: "ชน" } })
      }
      return r
    } as typeof realInsert
    try {
      await assert.rejects(S.handOut(n9, store), (e: Error) => e.name === "ConflictError")
    } finally {
      Collection.prototype.insertOne = realInsert
    }
    const d9 = await get(n9)
    eq(d9.status, "REJECTED"); eq(await stock(), 5); assert.ok(d9.hubRestoredAt instanceof Date); eq(d9.hubIssuedAt ?? null, null)
    const { swLogCol } = await import("../lib/store-withdraw/db")
    eq((await (await swLogCol()).find({ no: n9, action: "hubRestore" }).toArray()).length, 1)
    eq((await (await swLogCol()).find({ no: n9, action: "hubCut-orphan" }).toArray()).length, 0)
    // ยอด = ผลรวมสมุดของใบนี้ (ตัด −2 คืน +2)
    eq((await c.moves.find({ $or: [{ refNo: n9 }, { refNo: `${n9}:restore` }] }).toArray()).reduce((n, m) => n + m.qty, 0), 0)
  }

  // ---- 10. WMS อย่างเดียว (ไม่มีคลัง Hub ใน ATMS): จ่ายของตัดยอด · สรุปแล้ว WD เฉพาะของปกติ · ของ Hub ไม่หลุดเข้า WD · ของเหลือคืนยอด ----
  {
    await c.sites.updateOne({ inventoryId: 4 }, { $set: { atmsHubInventoryId: null } })
    await setStock(5)
    const w = await seed("P-WMS", [line({}), hubLine(3)])
    calls = []
    await S.handOut(w, store)
    let dw = await get(w)
    eq(dw.hubWmsOnly, true); eq(dw.hubStatus, "WAIT_PR"); eq(await stock(), 2); eq(calls.length, 0)
    await summarize(w, [mkUse(0, 1), mkUse(1, 2)])
    calls = []
    handler = (x) => okWd(960, `LBWD-${x.body!.remark_token}`)
    const after = await S.settleRequest(w, true, store)
    eq(after.status, "SETTLED")
    eq(issues().length, 1); eq(issues()[0].body!.inventory_id, 4)
    eq(issues()[0].body!.lines!.map((l) => l.sku_id), [11]) // บรรทัด Hub ไม่อยู่ใน WD ปกติ
    dw = await get(w)
    eq((dw.settleGroups ?? []).some((g) => g.hub), false)
    eq(hubWdDone(dw), true); eq(dw.hubStatus, "WAIT_PR")
    eq(await stock(), 3) // คืนของเหลือ 1
    eq((await coreRows(w)).map((r) => r[2]), ["N-11"]) // Hub ไม่มี WD = ไม่มีแถวซาก
    await c.sites.updateOne({ inventoryId: 4 }, { $set: { atmsHubInventoryId: 44 } })
  }

  await client.db("hub_settle_test").dropDatabase()
  await client.db("hub_settle_core_test").dropDatabase()
  await client.close()
  await mongod.stop()
  globalThis.fetch = realFetch
  console.log("check-hub-settle: all passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
