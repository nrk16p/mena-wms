// scripts/check-store-withdraw-issue.ts
// รัน: npx tsx scripts/check-store-withdraw-issue.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · stub api-ncac ด้วย globalThis.fetch)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, unknown> & { date?: string; progress?: unknown; lines?: unknown }
const store = { email: "store@x.co", name: "คลัง", via: "web" as const }
const noCreds = { email: "nocreds@x.co", name: "ไม่มีบัญชี", via: "web" as const }

// ---- fetch stub ----
type Call = { url: string; path: string; method: string; body: Json | null; headers: Record<string, string> }
let calls: Call[] = []
let handler: (c: Call) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown } = () => ({ status: 200, body: {} })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
  const url = String(input)
  const c: Call = { url, path: new URL(url).pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} }
  calls.push(c)
  const r = await handler(c)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch
const callsTo = (p: string) => calls.filter((c) => c.path === p)
const lastBody = (p: string) => callsTo(p).at(-1)!.body!
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, swLogCol, credCol, nextNo, ConflictError, transition } = await import("../lib/store-withdraw/db")
  const { saveCreds, getCreds, credStatus, deleteCreds } = await import("../lib/store-withdraw/creds")
  const { issueRequest, acceptReturn } = await import("../lib/store-withdraw/issue")
  setStoreWithdrawClient(client)

  const baseAtms = { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
  const mkLines = () => [
    { skuId: 11, skuCode: "A-1", skuName: "น็อต", requestedQty: 5, issuedQty: 4, short: true, returnedQty: 0, mrItemId: 900, mrItemLabel: null, serialNoId: null, remark: "" },
    { skuId: 12, skuCode: "B-2", skuName: "สลัก", requestedQty: 2, issuedQty: 0, short: true, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "" },
    { skuId: 13, skuCode: "C-3", skuName: "ซีล", requestedQty: 1, issuedQty: null, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: 77, remark: "ใหม่" },
  ]
  async function seed(no: string, p: Json = {}) {
    const now = new Date()
    await (await swCol()).insertOne({
      no, kind: "stock", status: "READY", inventoryId: 5, inventoryName: "สระบุรี", pickToId: 9, pickToName: "ช่าง",
      plate: "70-1234", mrCode: "MR-1", urgent: false, remark: "ด่วน", lines: mkLines(), requestedBy: store, claimedBy: null,
      rejectReason: null, atms: { ...baseAtms }, returns: [], createdAt: now, updatedAt: now, ...p,
    } as unknown as SwRequest)
    return no
  }
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!

  await saveCreds(store.email, "atms.user", "p@ss-ลับ", { username: "atms.user", branch: "สระบุรี", name: "X" })

  // ---- creds ----
  const raw = await (await credCol()).findOne({ email: store.email })
  assert.ok(raw && !JSON.stringify(raw).includes("p@ss-ลับ"), "รหัสผ่านต้องไม่เก็บเป็นข้อความธรรมดา")
  assert.ok(raw!.passwordEnc.startsWith("v1:"))
  eq(await getCreds(store.email), { username: "atms.user", password: "p@ss-ลับ" })
  eq(await getCreds("STORE@x.co"), { username: "atms.user", password: "p@ss-ลับ" })
  eq(await credStatus(store.email), { linked: true, atmsUsername: "atms.user", branch: "สระบุรี" })
  assert.ok(!JSON.stringify(await credStatus(store.email)).includes("ss"))
  eq(await credStatus("nobody@x.co"), { linked: false })
  await saveCreds("tmp@x.co", "t", "pw", null); await deleteCreds("tmp@x.co"); eq(await getCreds("tmp@x.co"), null)

  // ---- nextNo ----
  eq(await nextNo(new Date("2026-10-31")), "SW-2610-001")
  eq(await nextNo(new Date("2026-10-31")), "SW-2610-002")
  eq(await nextNo(new Date("2026-11-02")), "SW-2611-001")

  // ---- concurrent → one ATMS call ----
  const n1 = await seed("T-CONC", { atms: { ...baseAtms, drift: "ธงเก่า" } })
  handler = async () => { await sleep(80); return { status: 200, body: { progress: { gm_id: 1, done: [0, 1], approved: true, code: "WD-1" } } } }
  calls = []
  const res = await Promise.allSettled([issueRequest(n1, store), issueRequest(n1, store)])
  eq(callsTo("/atms/withdraw/issue").length, 1)
  eq(res.filter((r) => r.status === "rejected").length, 1)
  eq((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.name, "ConflictError")
  const d1 = await get(n1)
  eq(d1.status, "ISSUED"); eq(d1.atms.gmId, 1); eq(d1.atms.code, "WD-1"); eq(d1.atms.approved, true); eq(d1.atms.needCreds, false); eq(d1.atms.drift, null) // ส่งสำเร็จล้างธง drift เก่า
  const sent = lastBody("/atms/withdraw/issue")
  eq(sent.remark_token, n1)
  eq(sent.remark, "MR-1 70-1234 ด่วน")
  eq(sent.inventory_id, 5); eq(sent.pick_to_id, 9)
  eq(sent.lines, [
    { sku_id: 11, amount: 4, sku_name: "น็อต", mr_item_id: 900 },
    { sku_id: 13, amount: 1, sku_name: "ซีล", serial_no_id: 77, remark: "ใหม่" },
  ]) // บรรทัดจ่าย 0 ไม่ถูกส่ง
  assert.match(sent.date, /^\d{2}\/\d{2}\/\d{4}$/)
  eq(sent.progress, undefined)
  eq(callsTo("/atms/withdraw/issue")[0].headers["X-ATMS-Username"], "atms.user")
  eq(callsTo("/atms/withdraw/issue")[0].headers["X-ATMS-Password"], "p@ss-ลับ")
  eq(callsTo("/atms/withdraw/issue")[0].headers["x-api-key"], "k-test")
  const logs = await (await swLogCol()).find({ no: n1 }).toArray()
  assert.ok(logs.length >= 2 && !JSON.stringify(logs).includes("p@ss"))

  // ---- retry passes saved progress, same date ----
  const n2 = await seed("T-RETRY")
  handler = () => ({ status: 409, body: { detail: "ติดที่บรรทัดสอง", progress: { gm_id: 560800, done: [0], approved: false, code: null } } })
  await issueRequest(n2, store)
  const f = await get(n2)
  eq(f.status, "ISSUE_FAILED"); eq(f.atms.gmId, 560800); eq(f.atms.done, [0]); eq(f.atms.error, "ติดที่บรรทัดสอง")
  assert.ok(f.atms.startedAt instanceof Date)
  // เลื่อน startedAt ไปเมื่อวานเพื่อพิสูจน์ว่า retry ใช้วันเดิม ไม่ใช่วันนี้
  const old = new Date("2026-10-30T20:00:00Z") // = 31/10/2026 03:00 เวลาไทย
  await (await swCol()).updateOne({ no: n2 }, { $set: { "atms.startedAt": old } })
  eq((await get(n2)).atms.error, "ติดที่บรรทัดสอง") // ก่อนลองใหม่ยังเป็น error เก่า
  let midErr: unknown = "unset"
  handler = async () => { const d = await get(n2); midErr = d.status === "ISSUING" ? d.atms.error : "not-issuing"; return { status: 200, body: { progress: { gm_id: 560800, done: [0, 1], approved: true, code: "WD-9" } } } }
  await issueRequest(n2, store)
  eq(midErr, null) // ระหว่างยิง ATMS รอบลองใหม่ ต้องล้าง error เก่าแล้ว (การ์ดโชว์ "กำลังตัดใน ATMS")
  eq(lastBody("/atms/withdraw/issue").progress, { gm_id: 560800, done: [0], approved: false, code: null })
  eq(lastBody("/atms/withdraw/issue").date, "31/10/2026")
  eq((await get(n2)).status, "ISSUED"); eq((await get(n2)).atms.code, "WD-9")
  eq((await get(n2)).atms.startedAt, old)

  // ---- auth error / no creds / network / other ----
  const n3 = await seed("T-401")
  handler = () => ({ status: 401, body: { detail: "bad" } })
  await issueRequest(n3, store)
  eq((await get(n3)).status, "ISSUE_FAILED"); eq((await get(n3)).atms.needCreds, true)
  assert.ok((await get(n3)).atms.error)

  const n4 = await seed("T-NOCRED"); calls = []
  await issueRequest(n4, noCreds)
  eq((await get(n4)).status, "ISSUE_FAILED"); eq((await get(n4)).atms.needCreds, true); eq(calls.length, 0)

  // I1: timeout/เครือข่าย = ไม่รู้ผล → ค้าง ISSUING (ไม่ใช่ ISSUE_FAILED) ห้ามยิงซ้ำจนครบ 5 นาที
  const n5 = await seed("T-NET")
  handler = () => { throw new Error("ECONNRESET") }
  const n5r = await issueRequest(n5, store)
  eq(n5r.status, "ISSUING"); eq((await get(n5)).status, "ISSUING"); eq((await get(n5)).atms.needCreds, false)
  eq((await get(n5)).atms.error, "ยังไม่รู้ผลจาก ATMS รอ 5 นาทีแล้วกดลองใหม่")
  assert.ok(!(await get(n5)).atms.error!.includes("ECONNRESET"))
  assert.ok((await get(n5)).atms.startedAt instanceof Date)
  calls = []
  eq(await issueRequest(n5, store).catch((e) => e.name), "ConflictError"); eq(calls.length, 0) // ยังไม่ครบ 5 นาที = ไม่ยิงซ้ำ
  assert.ok((await (await swLogCol()).find({ no: n5, action: "issue-unknown" }).toArray()).length === 1)
  // ครบ 5 นาที → ยึดทำต่อ ใช้วันเดิม + progress เดิม
  const n5start = (await get(n5)).atms.startedAt
  await (await swCol()).updateOne({ no: n5 }, { $set: { updatedAt: new Date(Date.now() - 6 * 60_000) } })
  handler = () => ({ status: 200, body: { progress: { gm_id: 5, done: [0, 1], approved: true, code: "WD-NET" } } })
  eq((await issueRequest(n5, store)).status, "ISSUED"); eq((await get(n5)).atms.code, "WD-NET"); eq((await get(n5)).atms.error, null); eq((await get(n5)).atms.startedAt, n5start)

  const n6 = await seed("T-422")
  handler = () => ({ status: 422, body: { detail: "SKU ไม่พอ" } })
  await issueRequest(n6, store)
  eq((await get(n6)).atms.error, "SKU ไม่พอ")

  // detail แบบโครงสร้าง (422 ของ FastAPI) ห้ามโชว์ดิบ
  const n6b = await seed("T-422J")
  handler = () => ({ status: 422, body: { detail: [{ loc: ["body", "lines", 0, "sku_name"], msg: "field required", type: "value_error.missing" }] } })
  await issueRequest(n6b, store)
  eq((await get(n6b)).status, "ISSUE_FAILED"); eq((await get(n6b)).atms.error, "ข้อมูลที่ส่งไป ATMS ไม่ครบ แจ้งแอดมิน")
  assert.ok(!/loc|field required|body/.test((await get(n6b)).atms.error!))

  // I3: 403 = api-ncac ไม่รับ key ของ WMS → ข้อความตั้งค่า ไม่ขอผูกบัญชีใหม่
  const n403 = await seed("T-403")
  handler = () => ({ status: 403, body: { detail: "forbidden" } })
  await issueRequest(n403, store)
  eq((await get(n403)).status, "ISSUE_FAILED"); eq((await get(n403)).atms.needCreds, false)
  eq((await get(n403)).atms.error, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน")
  // NCAC_API_KEY / NCAC_BASE ว่าง = ล้มก่อนยิง (ไม่มีการเรียกออก)
  for (const k of ["NCAC_API_KEY", "NCAC_BASE"] as const) {
    const saved = process.env[k]; process.env[k] = ""
    const nc = await seed("T-NOCFG-" + k); calls = []
    await issueRequest(nc, store)
    eq((await get(nc)).status, "ISSUE_FAILED"); eq((await get(nc)).atms.needCreds, false); eq(calls.length, 0)
    eq((await get(nc)).atms.error, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน")
    process.env[k] = saved
  }

  const n7 = await seed("T-EMPTY", { lines: mkLines().map((l) => ({ ...l, issuedQty: 0 })) }); calls = []
  await issueRequest(n7, store)
  eq((await get(n7)).status, "ISSUE_FAILED"); eq(calls.length, 0)

  // ---- state guards ----
  const nNew = await seed("T-NEW", { status: "NEW" })
  eq(await issueRequest(nNew, store).catch((e) => e.name), "ConflictError")
  const nCut = await seed("T-CUT", { status: "NEW", kind: "cutoff" })
  handler = () => ({ status: 200, body: { progress: { gm_id: 2, done: [0, 1], approved: true, code: "WD-2" } } })
  eq((await issueRequest(nCut, store)).status, "ISSUED")
  eq(await issueRequest("T-NONE", store).catch((e) => e.name), "NotFoundError")
  assert.ok(new ConflictError() instanceof Error)

  // ---- stuck ISSUING ----
  const fresh = await seed("T-FRESH", { status: "ISSUING" }); calls = []
  eq(await issueRequest(fresh, store).catch((e) => e.name), "ConflictError"); eq(calls.length, 0)
  const stuck = await seed("T-STUCK", { status: "ISSUING", updatedAt: new Date(Date.now() - 6 * 60_000), atms: { ...baseAtms, gmId: 55, done: [0], startedAt: old } })
  handler = () => ({ status: 200, body: { progress: { gm_id: 55, done: [0, 1], approved: true, code: "WD-5" } } })
  calls = []
  const rs = await Promise.allSettled([issueRequest(stuck, store), issueRequest(stuck, store)])
  eq(callsTo("/atms/withdraw/issue").length, 1)
  eq(rs.filter((r) => r.status === "fulfilled").length, 1)
  eq(lastBody("/atms/withdraw/issue").progress, { gm_id: 55, done: [0], approved: false, code: null })
  eq((await get(stuck)).status, "ISSUED")

  // ---- transition conflict ----
  const nt = await seed("T-TR", { status: "NEW" })
  await transition(nt, "claim", store)
  eq(await transition(nt, "claim", store).catch((e) => e.name), "ConflictError")

  // ---- acceptReturn ----
  const issuedLines = () => mkLines().map((l, i) => i === 1 ? l : { ...l, issuedQty: l.issuedQty ?? l.requestedQty })
  const mkRet = (rid: string, qs: [number, number][], status = "RETURN_REQUESTED") => ({ rid, status, lines: qs.map(([lineIndex, qty]) => ({ lineIndex, qty })), requestedBy: "mech@x.co", acceptedBy: null, atms: { ...baseAtms }, createdAt: new Date() })
  const wd = { id: 777, code: "WD-77", approved: true, items: [{ sku_code: "A-1", sku_name: "น็อต", amount: 4, unit_price: 12.5, mr_item_id: 900 }, { sku_code: "C-3", sku_name: "ซีล", amount: 1, unit_price: 100, mr_item_id: null }] }
  const rA = await seed("T-RET", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true, done: [0, 1] }, returns: [mkRet("r1", [[0, 3]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: wd } : { status: 200, body: { progress: { gm_id: 777, done: [0], approved: true, code: "WD-77" } } }
  calls = []
  const ra = await acceptReturn(rA, "r1", store)
  const rb = lastBody("/atms/withdraw/return")
  eq(rb.remark_token, "T-RET-r1"); eq(rb.withdraw_id, 777); eq(rb.withdraw_code, "WD-77"); eq(rb.inventory_id, 5)
  eq(rb.lines, [{ sku_id: 11, amount: 3, unit_price: 12.5, sku_name: "น็อต" }])
  eq(rb.mark_complete, false)
  eq(ra.returns[0].status, "RETURNED"); eq(ra.returns[0].acceptedBy, store.email); eq(ra.lines[0].returnedQty, 3)
  eq(callsTo("/atms/withdraw/777")[0].method, "GET")
  // คืนที่เหลือ → ครบทุกบรรทัด → mark_complete
  await (await swCol()).updateOne({ no: rA }, { $push: { returns: mkRet("r2", [[0, 1], [2, 1]]) } as never })
  await acceptReturn(rA, "r2", store)
  eq(lastBody("/atms/withdraw/return").mark_complete, true)
  eq((await get(rA)).lines.map((l) => l.returnedQty), [4, 0, 1])
  eq(await acceptReturn(rA, "r2", store).catch((e) => e.name), "ConflictError") // รับซ้ำไม่ได้
  eq(callsTo("/atms/withdraw/return").length, 2)

  // ราคาไม่พบ → RETURN_FAILED ไม่ POST
  const rB = await seed("T-RET2", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: { ...wd, items: [wd.items[1]] } } : { status: 200, body: {} }
  calls = []
  const rbd = await acceptReturn(rB, "r1", store)
  eq(rbd.returns[0].status, "RETURN_FAILED"); assert.ok(rbd.returns[0].atms.error); eq(callsTo("/atms/withdraw/return").length, 0)
  eq((await get(rB)).lines[0].returnedQty, 0)

  // 409 เก็บ progress แล้ว retry ส่ง progress เดิม · ครั้งแรกไม่ส่ง date ผิด
  const rC = await seed("T-RET3", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 2], [2, 1]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: wd } : { status: 409, body: { detail: "ครึ่งทาง", progress: { gm_id: 777, done: [0], approved: false, code: null } } }
  const rc1 = await acceptReturn(rC, "r1", store)
  eq(rc1.returns[0].status, "RETURN_FAILED"); eq(rc1.returns[0].atms.done, [0]); eq(rc1.lines[0].returnedQty, 0)
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: wd } : { status: 200, body: { progress: { gm_id: 777, done: [0, 1], approved: true, code: "WD-77" } } }
  const rc2 = await acceptReturn(rC, "r1", store)
  eq(lastBody("/atms/withdraw/return").progress, { gm_id: 777, done: [0], approved: false, code: null })
  eq(rc2.returns[0].status, "RETURNED"); eq(rc2.lines.map((l) => l.returnedQty), [2, 0, 1])

  // 401 ตอนคืน
  const rD = await seed("T-RET4", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77" }, returns: [mkRet("r1", [[0, 1]])] })
  handler = () => ({ status: 401, body: { detail: "x" } })
  const rd = await acceptReturn(rD, "r1", store)
  eq(rd.returns[0].status, "RETURN_FAILED"); eq(rd.returns[0].atms.needCreds, true)

  // คืนของใบที่ยังไม่ ISSUED ไม่ได้
  const rE = await seed("T-RET5", { status: "READY", returns: [mkRet("r1", [[0, 1]])] })
  eq(await acceptReturn(rE, "r1", store).catch((e) => e.name), "ConflictError")


  // ---- fix round 1 ----
  // (6) log.from = สถานะเดิมจริง
  const accLogs = (await (await swLogCol()).find({ no: "T-RET3", action: "acceptReturn" }).sort({ at: 1 }).toArray()).map((l) => l.from)
  eq(accLogs, ["RETURN_REQUESTED", "RETURN_FAILED"])

  // (1) startedAt ของใบคืนถูกบันทึกก่อนยิง ATMS · ค้าง RETURNING แล้วรีไทรใช้วันเดิม
  const rF = await seed("T-RSTART", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  let startedAtDuringPost: Date | null = null
  handler = async (c) => {
    if (c.path === "/atms/withdraw/777") return { status: 200, body: wd }
    startedAtDuringPost = (await get(rF)).returns[0].atms.startedAt
    throw new Error("crash after ncac")
  }
  await acceptReturn(rF, "r1", store)
  assert.ok(startedAtDuringPost instanceof Date, "startedAt ต้องถูกเก็บก่อน POST")
  const stuckAt = (await get(rF)).returns[0].atms.startedAt!
  eq(stuckAt, startedAtDuringPost)
  const rG = await seed("T-RSTALE", { status: "ISSUED", updatedAt: new Date(Date.now() - 6 * 60_000), lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [{ ...mkRet("r1", [[0, 1]], "RETURNING"), atms: { ...baseAtms, startedAt: old } }] })
  const dates: string[] = []
  handler = (c) => {
    if (c.path === "/atms/withdraw/777") return { status: 200, body: wd }
    dates.push(c.body!.date)
    if (dates.length === 1) throw new Error("crash after ncac")
    return { status: 200, body: { progress: { gm_id: 777, done: [0], approved: true, code: "WD-77" } } }
  }
  await acceptReturn(rG, "r1", store)
  eq((await get(rG)).returns[0].status, "RETURNING") // ไม่รู้ผล = ค้าง RETURNING ไม่เปิดให้ยิงซ้ำทันที
  eq((await get(rG)).returns[0].atms.error, "ยังไม่รู้ผลจาก ATMS รอ 5 นาทีแล้วกดลองใหม่")
  eq(await acceptReturn(rG, "r1", store).catch((e) => e.name), "ConflictError")
  eq(dates.length, 1)
  await (await swCol()).updateOne({ no: rG }, { $set: { updatedAt: new Date(Date.now() - 6 * 60_000) } })
  await acceptReturn(rG, "r1", store)
  eq(dates, ["31/10/2026", "31/10/2026"])
  eq((await get(rG)).returns[0].status, "RETURNED")

  // (3) exception หลัง claim → failed state ภาษาไทย ไม่ค้าง ไม่หลุดความลับ
  const goodKey = process.env.STORE_ATMS_CRED_KEY
  delete process.env.STORE_ATMS_CRED_KEY
  const nK = await seed("T-NOKEY")
  await issueRequest(nK, store)
  eq((await get(nK)).status, "ISSUE_FAILED")
  assert.ok(!/STORE_ATMS|key/i.test((await get(nK)).atms.error ?? "") && (await get(nK)).atms.error)
  const rK = await seed("T-NOKEY2", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  await acceptReturn(rK, "r1", store)
  eq((await get(rK)).returns[0].status, "RETURN_FAILED")
  assert.ok(!/STORE_ATMS|key/i.test((await get(rK)).returns[0].atms.error ?? ""))
  process.env.STORE_ATMS_CRED_KEY = goodKey

  // (4) คืนรวมเกินที่เบิก (รวมใบที่กำลัง RETURNING) → ไม่ POST
  const rH = await seed("T-OVER", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 3]], "RETURNING"), mkRet("r2", [[0, 3]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: wd } : { status: 200, body: { progress: { gm_id: 777, done: [0], approved: true, code: "WD-77" } } }
  calls = []
  const oh = await acceptReturn(rH, "r2", store)
  eq(oh.returns[1].status, "RETURN_FAILED"); eq(oh.returns[1].atms.error, "คืนเกินจำนวนที่เบิก"); eq(callsTo("/atms/withdraw/return").length, 0)
  eq(oh.lines[0].returnedQty, 0)

  // (5) 200 แต่ไม่มีเลขใบ / ไม่ approved → ไม่ใช่ ISSUED/RETURNED
  const nC = await seed("T-NOCODE")
  handler = () => ({ status: 200, body: { progress: { gm_id: 31, done: [0, 1], approved: true, code: null } } })
  await issueRequest(nC, store)
  eq((await get(nC)).status, "ISSUE_FAILED"); eq((await get(nC)).atms.error, "ATMS ไม่ส่งเลขใบกลับมา กดลองใหม่"); eq((await get(nC)).atms.gmId, 31); eq((await get(nC)).atms.done, [0, 1])
  const nA = await seed("T-NOAPPR")
  handler = () => ({ status: 200, body: { progress: { gm_id: 32, done: [0, 1], approved: false, code: "WD-32" } } })
  await issueRequest(nA, store)
  eq((await get(nA)).status, "ISSUE_FAILED")
  const rI = await seed("T-RNOAPPR", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 200, body: wd } : { status: 200, body: { progress: { gm_id: 777, done: [0], approved: false, code: "WD-77" } } }
  const ri = await acceptReturn(rI, "r1", store)
  eq(ri.returns[0].status, "RETURN_FAILED"); eq(ri.lines[0].returnedQty, 0); eq(ri.returns[0].atms.done, [0])


  // ---- I2: reject จาก ISSUE_FAILED / ปิดมือ ----
  const nR1 = await seed("T-REJ1", { status: "ISSUE_FAILED", atms: { ...baseAtms, error: "x" } })
  eq((await transition(nR1, "reject", store, { rejectReason: "ของหมด" })).status, "REJECTED")
  const nR2 = await seed("T-REJ2", { status: "ISSUE_FAILED", atms: { ...baseAtms, gmId: 77, done: [0], error: "x" } })
  eq(await transition(nR2, "reject", store, { rejectReason: "ของหมด" }).catch((e) => e.name), "ConflictError") // มี WD แล้ว ปฏิเสธตรง ๆ ไม่ได้
  const closed = await transition(nR2, "closeManual", store, { rejectReason: "ปิดมือ: แก้ใน ATMS แล้ว" })
  eq(closed.status, "REJECTED"); eq(closed.rejectReason, "ปิดมือ: แก้ใน ATMS แล้ว"); eq(closed.atms.gmId, 77)
  eq((await (await swLogCol()).find({ no: nR2, action: "closeManual" }).toArray()).length, 1)
  eq(await transition(nR1, "closeManual", store).catch((e) => e.name), "ConflictError")
  eq(await transition("T-GONE", "reject", store).catch((e) => e.name), "NotFoundError")

  // ---- I4: crash หลัง claim ห้ามเขียนทับ startedAt/gmId/done ----
  const goodKey2 = process.env.STORE_ATMS_CRED_KEY
  delete process.env.STORE_ATMS_CRED_KEY // getCreds ถอดรหัสไม่ได้ → throw หลังบันทึก startedAt
  const nCr = await seed("T-CRASH", { atms: { ...baseAtms, gmId: 55, done: [0], approved: false } })
  await issueRequest(nCr, store)
  const cr = await get(nCr)
  eq(cr.status, "ISSUE_FAILED"); eq(cr.atms.gmId, 55); eq(cr.atms.done, [0])
  assert.ok(cr.atms.startedAt instanceof Date, "startedAt ต้องไม่หาย")
  eq(cr.atms.needCreds, false); assert.ok(cr.atms.error && !/STORE_ATMS|key/i.test(cr.atms.error))
  // ใบคืน: crash ก่อนยิง ต้องรักษา startedAt ที่ claimReturn บันทึกไว้
  const rCr = await seed("T-RCRASH", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  await acceptReturn(rCr, "r1", store)
  const rcr = (await get(rCr)).returns[0]
  eq(rcr.status, "RETURN_FAILED"); assert.ok(rcr.atms.startedAt instanceof Date)
  // ลองรับคืนใหม่: ระหว่าง RETURNING ต้องไม่เหลือ error เก่า
  eq(rcr.atms.error !== null, true)
  process.env.STORE_ATMS_CRED_KEY = goodKey2
  let midRetErr: unknown = "unset"
  handler = async () => { const rr = (await get(rCr)).returns[0]; midRetErr = rr.status === "RETURNING" ? rr.atms.error : "not-returning"; return { status: 500, body: { detail: "x" } } }
  await acceptReturn(rCr, "r1", store)
  eq(midRetErr, null)
  delete process.env.STORE_ATMS_CRED_KEY
  process.env.STORE_ATMS_CRED_KEY = goodKey2

  // ---- 403 ตอนคืน ----
  const r403 = await seed("T-R403", { status: "ISSUED", lines: issuedLines(), atms: { ...baseAtms, gmId: 777, code: "WD-77", approved: true }, returns: [mkRet("r1", [[0, 1]])] })
  handler = (c) => c.path === "/atms/withdraw/777" ? { status: 403, body: { detail: "forbidden" } } : { status: 200, body: {} }
  const r403r = await acceptReturn(r403, "r1", store)
  eq(r403r.returns[0].status, "RETURN_FAILED"); eq(r403r.returns[0].atms.needCreds, false); eq(r403r.returns[0].atms.error, "WMS ต่อ api-ncac ไม่ได้ (key ไม่ตรง) — แจ้งแอดมิน")
  eq(await acceptReturn("T-NONE", "r1", store).catch((e) => e.name), "NotFoundError")

  // ---- ล้างทิ้ง ----
  await client.db("sw_test").dropDatabase()
  await client.close()
  await mongod.stop()
  globalThis.fetch = realFetch
  console.log("check-store-withdraw-issue: all passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
