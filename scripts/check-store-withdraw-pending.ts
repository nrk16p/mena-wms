// scripts/check-store-withdraw-pending.ts — Mobile/PM แบบสรุปทีหลัง (ส่งของ → สรุปการใช้ → ตัดสต๊อก WD ต่อทะเบียน)
// รัน: npx tsx scripts/check-store-withdraw-pending.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · api-ncac จำลองด้วย globalThis.fetch · ไม่แตะ ATMS จริง)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_pending_test"
process.env.ATMS_LOOKUP_USERNAME = "svc"
process.env.ATMS_LOOKUP_PASSWORD = "svcpw"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, unknown>
type Call = { path: string; method: string; body: Json | null; headers: Record<string, string> }
let calls: Call[] = []
let handler: (c: Call) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown } = () => ({ status: 404, body: {} })
globalThis.fetch = (async (input: RequestInfo | URL, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
  const c: Call = { path: new URL(String(input)).pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} }
  calls.push(c)
  const r = await handler(c)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch
const issues = () => calls.filter((c) => c.path === "/atms/withdraw/issue")

const req1 = { email: "tech1@menatransport.co.th", name: "ช่างหนึ่ง", via: "web" as const }
const req2 = { email: "tech2@menatransport.co.th", name: "ช่างสอง", via: "web" as const }
const store = { email: "store1@menatransport.co.th", name: "สโตร์", via: "web" as const }
const DAY = 86_400_000

async function rejects(p: Promise<unknown>, name: string, re?: RegExp, status?: number) {
  const e = (await p.then(() => null, (x) => x)) as (Error & { status?: number }) | null
  assert.ok(e, `ต้อง error (${name})`)
  assert.equal(e!.name === "Error" ? e!.constructor.name : e!.name, name)
  if (re) assert.match(e!.message, re)
  if (status != null) eq(e!.status, status)
}

async function main() {
  // ================= ตรรกะล้วน =================
  const { nextStatus, isPendingFlow } = await import("../lib/store-withdraw/core")
  const P = await import("../lib/store-withdraw/pending")
  const due = new Date(Date.now() + DAY)
  const pend = { kind: "stock" as const, workType: "mobile_pm" as const, summaryDueAt: due }
  eq(isPendingFlow(pend), true)
  eq(isPendingFlow({ workType: "mobile_pm" }), false) // ใบ mobile_pm เก่าไม่มีกำหนด = ขั้นตอนเดิม
  eq(isPendingFlow({ workType: "garage_in", summaryDueAt: due }), false)
  eq(nextStatus({ ...pend, status: "READY" }, "issue"), null) // ใบ pending เข้า ISSUING ไม่ได้
  eq(nextStatus({ ...pend, status: "READY" }, "handOut"), "HANDED_OUT")
  eq(nextStatus({ kind: "stock", workType: "garage_in", status: "READY" }, "handOut"), null)
  eq(nextStatus({ kind: "stock", workType: "mobile_pm", status: "READY" }, "issue"), "ISSUING") // ใบเก่า
  eq(nextStatus({ kind: "stock", status: "READY" }, "issue"), "ISSUING") // อู่ใน ไม่เปลี่ยน
  eq(nextStatus({ kind: "cutoff", status: "NEW" }, "issue"), "ISSUING") // อู่นอก ไม่เปลี่ยน
  eq(nextStatus({ ...pend, status: "HANDED_OUT" }, "summarize"), "SUMMARIZED")
  eq(nextStatus({ ...pend, status: "READY" }, "summarize"), null)
  eq(nextStatus({ ...pend, status: "SUMMARIZED" }, "settle"), "SETTLING")
  eq(nextStatus({ ...pend, status: "SETTLE_FAILED" }, "settle"), "SETTLING")
  eq(nextStatus({ ...pend, status: "SETTLING" }, "settle"), null)
  eq(nextStatus({ ...pend, status: "SETTLED" }, "settle"), null)
  eq(nextStatus({ ...pend, status: "SETTLING" }, "settled"), "SETTLED")
  eq(nextStatus({ ...pend, status: "SETTLING" }, "settleFailed"), "SETTLE_FAILED")
  eq(nextStatus({ ...pend, status: "HANDED_OUT" }, "reject"), null) // ของออกไปแล้ว ปฏิเสธไม่ได้
  eq(nextStatus({ ...pend, status: "HANDED_OUT" }, "receive"), null)

  // parseDue
  const now = new Date("2026-11-02T03:00:00Z")
  assert.ok("error" in P.parseDue(undefined, now))
  assert.ok("error" in P.parseDue(12345, now))
  assert.ok("error" in P.parseDue("not a date", now))
  assert.match((P.parseDue("2026-11-02T02:59:00Z", now) as { error: string }).error, /หลังจากตอนนี้/)
  assert.match((P.parseDue(new Date(now.getTime() + 61 * DAY).toISOString(), now) as { error: string }).error, /60 วัน/)
  eq((P.parseDue(new Date(now.getTime() + 60 * DAY).toISOString(), now) as { due: Date }).due.getTime(), now.getTime() + 60 * DAY)

  // parseSummary
  const L = (p: Partial<SwRequest["lines"][number]> = {}) => ({ skuId: 501, skuCode: "OIL-001", skuName: "น้ำมันเครื่อง", requestedQty: 4, issuedQty: null, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...p })
  const lines = [L(), L({ skuId: 502, skuCode: "FLT-002", skuName: "ไส้กรอง", requestedQty: 3, issuedQty: 2, short: true })]
  const U = (p: Json = {}) => ({ lineIndex: 0, plate: "70-1234", mrCode: "MR-1", mrItemId: 11, mrItemLabel: "MR-1 PM-ไฟ : 11", qty: 1, ...p })
  const ok = P.parseSummary(lines, { usages: [U({ qty: 3 }), U({ qty: 1, plate: "71-5678", mrCode: "MR-2", mrItemId: 22, mrItemLabel: "MR-2 PM-เบรค : 22" }), U({ lineIndex: 1, qty: 1.5 })] })
  assert.ok(!("error" in ok))
  eq((ok as P.ParsedSummary).returns, [{ lineIndex: 1, qty: 0.5 }]) // บรรทัด 0 ใช้ครบ 4 · บรรทัด 1 จ่าย 2 ใช้ 1.5
  eq((P.parseSummary(lines, { usages: [] }) as P.ParsedSummary).returns, [{ lineIndex: 0, qty: 4 }, { lineIndex: 1, qty: 2 }]) // คืนหมดก็ได้
  eq((P.parseSummary(lines, {}) as P.ParsedSummary).usages, [])
  assert.match((P.parseSummary(lines, { usages: [U({ qty: 3 }), U({ qty: 2 })] }) as { error: string }).error, /เกินที่เบิก/)
  assert.match((P.parseSummary(lines, { usages: [U({ lineIndex: 1, qty: 3 })] }) as { error: string }).error, /เกินที่เบิกไป 2/) // ใช้ issuedQty ไม่ใช่ requestedQty
  assert.match((P.parseSummary(lines, { usages: [U({ plate: " " })] }) as { error: string }).error, /ทะเบียน/)
  assert.match((P.parseSummary(lines, { usages: [U({ mrCode: "" })] }) as { error: string }).error, /MR/)
  assert.match((P.parseSummary(lines, { usages: [U({ mrItemId: null })] }) as { error: string }).error, /ประเภทการซ่อม/)
  assert.match((P.parseSummary(lines, { usages: [U({ mrItemLabel: "" })] }) as { error: string }).error, /ประเภทการซ่อม/)
  assert.match((P.parseSummary(lines, { usages: [U({ qty: 0 })] }) as { error: string }).error, /มากกว่า 0/)
  assert.match((P.parseSummary(lines, { usages: [U({ qty: -1 })] }) as { error: string }).error, /มากกว่า 0/)
  assert.match((P.parseSummary(lines, { usages: [U({ lineIndex: 9 })] }) as { error: string }).error, /ไม่พบรายการ/)
  assert.ok("error" in P.parseSummary(lines, { usages: "x" }))

  // buildSettleGroups: ต่อทะเบียน (normalize) · เรียงทะเบียน · token · รวมบรรทัดซ้ำ · ใช้ 0 = ไม่มีกลุ่ม
  const ea = () => ({ gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null })
  const gs = P.buildSettleGroups("SW-2611-009", [U({ plate: "71-5678", mrCode: "MR-2" }), U({ plate: "70-1234", qty: 1 }), U({ plate: "70 -1234 ", qty: 2 }), U({ plate: "70-1234", lineIndex: 1, mrItemId: 33, mrCode: "MR-3" })], ea)
  eq(gs.map((g) => [g.n, g.token, g.plate, g.mrCodes]), [[1, "SW-2611-009-1", "70-1234", ["MR-1", "MR-3"]], [2, "SW-2611-009-2", "71-5678", ["MR-2"]]])
  eq(gs[0].lines, [{ lineIndex: 0, mrItemId: 11, qty: 3 }, { lineIndex: 1, mrItemId: 33, qty: 1 }])
  eq(P.buildSettleGroups("X", [], ea), [])
  eq(P.settleRemark({ ref: { type: "pr", code: "LBPR1", id: null }, remark: "งาน PM" }, gs[0]), "MR-1 MR-3 LBPR1 70-1234 งาน PM")

  // เลยกำหนด
  eq(P.lateMinutes({ status: "HANDED_OUT", summaryDueAt: new Date(now.getTime() - 90 * 60_000) }, now), 90)
  eq(P.lateMinutes({ status: "HANDED_OUT", summaryDueAt: new Date(now.getTime() + 60_000) }, now), 0)
  eq(P.lateMinutes({ status: "SUMMARIZED", summaryDueAt: new Date(now.getTime() - DAY) }, now), 0) // สรุปแล้ว ไม่นับว่าเลย
  eq(P.lateMinutes({ status: "HANDED_OUT", summaryDueAt: new Date(now.getTime() - 10_000).toISOString() }, now), 1)
  eq(P.lateMinutes({ status: "HANDED_OUT" }, now), 0)
  eq(P.lateText(45), "45 นาที"); eq(P.lateText(90), "1 ชม. 30 นาที"); eq(P.lateText(120), "2 ชม."); eq(P.lateText(1440 + 180), "1 วัน 3 ชม."); eq(P.lateText(2880), "2 วัน")
  eq(P.handedOutSort([
    { no: "b", summaryDueAt: new Date(now.getTime() + DAY), createdAt: now },
    { no: "a", summaryDueAt: new Date(now.getTime() - DAY), createdAt: now },
    { no: "c", summaryDueAt: null, createdAt: now },
  ]).map((x) => x.no), ["a", "b", "c"])

  // ================= กับ DB =================
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, swLogCol, transition } = await import("../lib/store-withdraw/db")
  setStoreWithdrawClient(client)
  const { saveCreds } = await import("../lib/store-withdraw/creds")
  const { createRequest, requestReturn, buildQueue, listAtmsKeyed } = await import("../lib/store-withdraw/service")
  const { issueRequest, STUCK_MS } = await import("../lib/store-withdraw/issue")
  const S = await import("../lib/store-withdraw/settle")
  const { checkSettleDrift, settleDriftTick } = await import("../lib/store-withdraw/settle-drift")
  const { driftTick, checkDriftDetailed } = await import("../lib/store-withdraw/drift")
  await saveCreds(store.email, "store1", "pw-store", { username: "store1", branch: "ลาดกระบัง" })
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!

  const ncacOptions = (c: Call) => (c.path === "/atms/withdraw/options" ? { status: 200, body: { inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "PM" }] } } : null)
  handler = (c) => ncacOptions(c) ?? { status: 404, body: {} }

  // ---- สร้างใบ ----
  const base = { inventoryId: 4, pickToId: 7, lines: [{ skuId: 501, skuCode: "OIL-001", skuName: "น้ำมันเครื่อง", requestedQty: 4 }, { skuId: 502, skuCode: "FLT-002", skuName: "ไส้กรอง", requestedQty: 3, serialNoId: 77, remark: "ใหม่" }] }
  const dueIso = new Date(Date.now() + 2 * DAY).toISOString()
  await rejects(createRequest({ ...base, workType: "mobile_pm" }, req1), "HttpError", /กำหนดสรุปยอด/, 400)
  await rejects(createRequest({ ...base, workType: "mobile_pm", summaryDueAt: new Date(Date.now() - 60_000).toISOString() }, req1), "HttpError", /หลังจากตอนนี้/, 400)
  await rejects(createRequest({ ...base, workType: "mobile_pm", summaryDueAt: new Date(Date.now() + 61 * DAY).toISOString() }, req1), "HttpError", /60 วัน/, 400)
  await rejects(createRequest({ ...base, workType: "garage_in" }, req1), "HttpError", /ทะเบียน/, 400) // อู่ใน ยังบังคับทะเบียน
  const g0 = await createRequest({ ...base, workType: "garage_in", plate: "70-0001", summaryDueAt: dueIso }, req1)
  eq(g0.summaryDueAt, undefined); eq(isPendingFlow(g0), false) // งานอื่นไม่เก็บกำหนดสรุป
  const m = await createRequest({ ...base, workType: "mobile_pm", ref: { type: "pr", code: "LBPR26110001" }, remark: "PM ประจำสัปดาห์", summaryDueAt: dueIso }, req1)
  eq(m.plate, ""); eq(m.mrCode, null); eq(m.summaryExtensions, 0); eq(m.summary, null)
  eq((await get(m.no)).summaryDueAt!.toISOString(), dueIso)

  // ---- สโตร์จัดของ แล้วส่งของ: ไม่แตะ ATMS ----
  const toReady = async (no: string, issued?: number[]) => {
    await transition(no, "claim", store, { claimedBy: { email: store.email, name: store.name } })
    if (issued) await (await swCol()).updateOne({ no }, { $set: Object.fromEntries(issued.map((q, i) => [`lines.${i}.issuedQty`, q])) })
    await transition(no, "ready", store)
  }
  await toReady(m.no, [4, 2]) // ไส้กรองจ่ายได้แค่ 2
  calls = []
  await rejects(issueRequest(m.no, store), "ConflictError") // ทางเดิมเข้าไม่ได้ กันยิง ATMS ผิดขั้น
  eq(calls.length, 0)
  const ho = await S.handOut(m.no, store)
  eq(ho.status, "HANDED_OUT"); eq(calls.length, 0); eq(ho.atms.gmId, null)
  await rejects(S.handOut(m.no, store), "ConflictError") // กดซ้ำไม่ได้
  const hlog = await (await swLogCol()).find({ no: m.no, action: "handOut" }).toArray()
  eq(hlog.length, 1); eq([hlog[0].from, hlog[0].to], ["READY", "HANDED_OUT"])

  // ---- ขอคืน: ไม่มีสำหรับ Mobile/PM ----
  await rejects(requestReturn(m.no, { reasonCode: "unused", lines: [{ lineIndex: 0, qty: 1 }] }, req1), "ConflictError", /Mobile\/PM/)

  // ---- เลื่อนกำหนด ----
  await rejects(S.extendDue(m.no, { summaryDueAt: new Date(Date.now() + 3 * DAY).toISOString() }, req2), "HttpError", /ไม่ใช่ของคุณ/, 403)
  await rejects(S.extendDue(m.no, { summaryDueAt: new Date(Date.now() - DAY).toISOString() }, req1), "HttpError", /หลังจากตอนนี้/, 400)
  await rejects(S.extendDue(m.no, { summaryDueAt: new Date(Date.now() + 61 * DAY).toISOString() }, req1), "HttpError", /60 วัน/, 400)
  const due2 = new Date(Date.now() + 3 * DAY).toISOString()
  const ex = await S.extendDue(m.no, { summaryDueAt: due2 }, req1)
  eq(ex.summaryDueAt!.toISOString(), due2); eq(ex.summaryExtensions, 1); eq(ex.status, "HANDED_OUT")
  const xlog = await (await swLogCol()).find({ no: m.no, action: "extendDue" }).toArray()
  eq(xlog.length, 1); eq(xlog[0].note, `${dueIso} → ${due2}`)
  await rejects(S.extendDue(g0.no, { summaryDueAt: due2 }, req1), "ConflictError") // งานอื่นไม่มีกำหนด

  // ---- เลยกำหนด + คิว ----
  const late = await createRequest({ ...base, workType: "mobile_pm", plate: "70-9999", summaryDueAt: dueIso }, req2)
  await toReady(late.no); await S.handOut(late.no, store)
  await (await swCol()).updateOne({ no: late.no }, { $set: { summaryDueAt: new Date(Date.now() - 2 * 3600_000) } })
  eq(P.lateMinutes(await get(late.no), new Date()) >= 119, true)
  eq(P.lateMinutes(await get(m.no), new Date()), 0)
  let q = await buildQueue(4)
  eq(q.HANDED_OUT.map((x) => x.no), [late.no, m.no]) // เลยกำหนดขึ้นก่อน
  assert.ok(![...q.NEW, ...q.PREPARING, ...q.READY, ...q.DONE_TODAY].some((x) => x.no === m.no))
  await rejects(S.extendDue(m.no, { summaryDueAt: "x" }, req1), "HttpError", /อ่านไม่ออก/, 400)

  // ---- สรุปการใช้ ----
  await rejects(S.submitSummary(m.no, { usages: [] }, req2), "HttpError", /ไม่ใช่ของคุณ/, 403)
  await rejects(S.submitSummary(g0.no, { usages: [] }, req1), "ConflictError") // ใบอู่ใน
  const mk = (p: Json) => ({ lineIndex: 0, plate: "71-5678", mrCode: "LBMR26110002", mrItemId: 22, mrItemLabel: "LBMR26110002 PM-เบรค : 22", qty: 1, ...p })
  await rejects(S.submitSummary(m.no, { usages: [mk({ lineIndex: 1, qty: 3 })] }, req1), "HttpError", /เกินที่เบิกไป 2/, 400)
  await rejects(S.submitSummary(m.no, { usages: [mk({ mrItemId: 0 })] }, req1), "HttpError", /ประเภทการซ่อม/, 400)
  eq((await get(m.no)).status, "HANDED_OUT")
  const sm = await S.submitSummary(m.no, {
    usages: [
      mk({ qty: 1 }),                                                                                  // 71-5678 น้ำมัน 1
      mk({ plate: "70-1234", mrCode: "LBMR26110001", mrItemId: 11, mrItemLabel: "LBMR26110001 PM-ไฟ : 11", qty: 2 }), // 70-1234 น้ำมัน 2
      mk({ plate: "70-1234", mrCode: "LBMR26110001", mrItemId: 11, mrItemLabel: "LBMR26110001 PM-ไฟ : 11", lineIndex: 1, qty: 1 }), // 70-1234 ไส้กรอง 1
    ],
    note: "ใช้สองคัน",
  }, req1)
  eq(sm.status, "SUMMARIZED")
  eq(sm.summary!.returns, [{ lineIndex: 0, qty: 1 }, { lineIndex: 1, qty: 1 }]) // น้ำมัน 4−3 · ไส้กรอง 2−1
  eq(sm.summary!.by.email, req1.email); eq(sm.summary!.note, "ใช้สองคัน")
  await rejects(S.submitSummary(m.no, { usages: [] }, req1), "ConflictError") // สรุปซ้ำไม่ได้
  await rejects(S.extendDue(m.no, { summaryDueAt: due2 }, req1), "ConflictError") // สรุปแล้วเลื่อนไม่ได้
  // แข่งกันส่งสรุปสองครั้ง: ผ่านครั้งเดียว
  const race = await createRequest({ ...base, workType: "mobile_pm", summaryDueAt: dueIso }, req1)
  await toReady(race.no); await S.handOut(race.no, store)
  const rr = await Promise.allSettled([S.submitSummary(race.no, { usages: [] }, req1), S.submitSummary(race.no, { usages: [] }, req1)])
  eq(rr.filter((r) => r.status === "fulfilled").length, 1)
  q = await buildQueue(4)
  assert.ok(q.NEW.some((x) => x.no === m.no && x.itemType === "request")) // สรุปแล้ว = งานสโตร์
  eq(q.HANDED_OUT.map((x) => x.no), [late.no])

  // ---- ตัดสต๊อก: ต้องยืนยันรับของคืนเมื่อมีของเหลือ ----
  calls = []
  await rejects(S.settleRequest(m.no, undefined, store), "HttpError", /รับของคืนแล้ว/, 400)
  await rejects(S.settleRequest(m.no, false, store), "HttpError", /รับของคืนแล้ว/, 400)
  eq(calls.length, 0); eq((await get(m.no)).status, "SUMMARIZED")

  // ---- หลายทะเบียน + พังกลางทาง (กลุ่มที่ 2) แล้วลองใหม่: กลุ่มที่เสร็จแล้วไม่ถูกสร้างซ้ำ ----
  let gm = 7000
  const seen: Record<string, number> = {}
  let failToken: string | null = `${m.no}-2`
  handler = (c) => {
    if (c.path !== "/atms/withdraw/issue") return { status: 404, body: {} }
    const t = String(c.body!.remark_token)
    seen[t] = (seen[t] ?? 0) + 1
    if (t === failToken) return { status: 409, body: { detail: "ATMS ตัดบรรทัดที่ 1 ไม่ได้: สต๊อกไม่พอ", progress: { gm_id: 8802, done: [], approved: false, code: null } } }
    // ลองใหม่พร้อม progress = ATMS ทำต่อในใบเดิม (gm_id เดิม)
    const id = (c.body!.progress as { gm_id?: number } | undefined)?.gm_id ?? ++gm
    return { status: 200, body: { progress: { gm_id: id, done: [0], approved: true, code: `LBWD-${id}` } } }
  }
  calls = []
  const f1 = await S.settleRequest(m.no, true, store)
  eq(f1.status, "SETTLE_FAILED")
  eq(issues().length, 2)
  eq(f1.settleGroups!.map((g) => [g.n, g.token, g.plate, g.status]), [[1, `${m.no}-1`, "70-1234", "DONE"], [2, `${m.no}-2`, "71-5678", "PENDING"]])
  eq(f1.settleGroups![0].atms.code, "LBWD-7001"); eq(f1.settleGroups![1].atms.gmId, 8802)
  eq(f1.settleGroups![1].atms.error, "ATMS ตัดบรรทัดที่ 1 ไม่ได้: สต๊อกไม่พอ")
  eq(f1.returnConfirmedBy!.email, store.email); assert.ok(f1.returnConfirmedAt instanceof Date)
  // body ของกลุ่ม 1: บัญชีสโตร์ · บรรทัดของทะเบียนนั้น · mr_item_id ทุกบรรทัด · ไม่ส่ง progress ครั้งแรก
  const b1 = issues()[0]
  eq(b1.headers["X-ATMS-Username"], "store1")
  eq(b1.body!.remark_token, `${m.no}-1`)
  eq(b1.body!.remark, "LBMR26110001 LBPR26110001 70-1234 PM ประจำสัปดาห์")
  eq([b1.body!.inventory_id, b1.body!.pick_to_id], [4, 7])
  eq(b1.body!.lines, [
    { sku_id: 501, amount: 2, sku_name: "น้ำมันเครื่อง", mr_item_id: 11 },
    { sku_id: 502, amount: 1, sku_name: "ไส้กรอง", mr_item_id: 11, serial_no_id: 77, remark: "ใหม่" },
  ])
  eq(b1.body!.progress, undefined)
  assert.match(String(b1.body!.date), /^\d{2}\/\d{2}\/\d{4}$/)
  eq(issues()[1].body!.lines, [{ sku_id: 501, amount: 1, sku_name: "น้ำมันเครื่อง", mr_item_id: 22 }])
  // ลองใหม่: ยิงเฉพาะกลุ่ม 2 พร้อม progress เดิม
  failToken = null
  calls = []
  const f2 = await S.settleRequest(m.no, true, store)
  eq(f2.status, "SETTLED")
  eq(issues().length, 1)
  eq(issues()[0].body!.remark_token, `${m.no}-2`)
  eq(issues()[0].body!.progress, { gm_id: 8802, done: [], approved: false, code: null })
  eq(seen[`${m.no}-1`], 1, "กลุ่ม 1 ต้องถูกยิงครั้งเดียวตลอด")
  eq(f2.settleGroups!.map((g) => g.status), ["DONE", "DONE"])
  eq(f2.settleGroups![1].atms.error, null)
  calls = []
  await rejects(S.settleRequest(m.no, true, store), "ConflictError") // ตัดแล้วกดอีกไม่ได้
  eq(calls.length, 0)
  const slog = (await (await swLogCol()).find({ no: m.no }).toArray()).map((l) => l.action)
  for (const a of ["summarize", "settle", "settle-group", "settleFailed", "settled"]) assert.ok(slog.includes(a), `log ต้องมี ${a}`)

  // ---- คืนหมด (ใช้ 0): ไม่ยิง ATMS เลย ----
  calls = []
  const z = await S.settleRequest(race.no, true, store)
  eq(z.status, "SETTLED"); eq(z.settleGroups, []); eq(calls.length, 0)
  // ใช้ครบทุกชิ้น = ไม่มีของเหลือ ไม่ต้องติ๊ก
  const full = await createRequest({ ...base, workType: "mobile_pm", summaryDueAt: dueIso }, req1)
  await toReady(full.no, [1, 1]); await S.handOut(full.no, store)
  await S.submitSummary(full.no, { usages: [mk({ qty: 1 }), mk({ lineIndex: 1, qty: 1 })] }, req1)
  handler = () => ({ status: 200, body: { progress: { gm_id: 9100, done: [0, 1], approved: true, code: "LBWD-9100" } } })
  calls = []
  const fu = await S.settleRequest(full.no, undefined, store)
  eq(fu.status, "SETTLED"); eq(issues().length, 1); eq(fu.returnConfirmedBy ?? null, null)

  // ---- ยังไม่ได้ผูกบัญชี ATMS ----
  const nc = await createRequest({ ...base, workType: "mobile_pm", summaryDueAt: dueIso }, req1)
  await toReady(nc.no); await S.handOut(nc.no, store)
  await S.submitSummary(nc.no, { usages: [mk({ qty: 4 }), mk({ lineIndex: 1, qty: 3 })] }, req1)
  calls = []
  const ncr = await S.settleRequest(nc.no, undefined, req2)
  eq(ncr.status, "SETTLE_FAILED"); eq(ncr.settleGroups![0].atms.needCreds, true); eq(calls.length, 0)

  // ---- ไม่รู้ผล (เครือข่ายหลุด): ค้าง SETTLING · กดซ้ำทันทีไม่ยิง · ค้างเกิน 5 นาทีค่อยทำต่อด้วย progress/วันเดิม ----
  handler = () => { throw new Error("ECONNRESET") }
  calls = []
  const u1 = await S.settleRequest(nc.no, undefined, store)
  eq(u1.status, "SETTLING"); assert.match(String(u1.settleGroups![0].atms.error), /รอ 5 นาที/); eq(issues().length, 1)
  const startedAt = u1.settleGroups![0].atms.startedAt
  assert.ok(startedAt instanceof Date)
  calls = []
  await rejects(S.settleRequest(nc.no, undefined, store), "ConflictError")
  eq(calls.length, 0)
  await (await swCol()).updateOne({ no: nc.no }, { $set: { updatedAt: new Date(Date.now() - STUCK_MS - 1000), "settleGroups.0.atms.startedAt": new Date("2026-10-30T20:00:00Z") } })
  handler = () => ({ status: 200, body: { progress: { gm_id: 9200, done: [0], approved: true, code: "LBWD-9200" } } })
  const u2 = await S.settleRequest(nc.no, undefined, store)
  eq(u2.status, "SETTLED"); eq(issues().length, 1)
  eq(issues()[0].body!.date, "31/10/2026") // ใช้วันเริ่มเดิม
  eq(issues()[0].body!.remark_token, `${nc.no}-1`)
  // แข่งกันกดตัด: ATMS ถูกยิงครั้งเดียว
  const rc = await createRequest({ ...base, workType: "mobile_pm", summaryDueAt: dueIso }, req1)
  await toReady(rc.no); await S.handOut(rc.no, store)
  await S.submitSummary(rc.no, { usages: [mk({ qty: 4 }), mk({ lineIndex: 1, qty: 3 })] }, req1)
  handler = async () => { await new Promise((r) => setTimeout(r, 60)); return { status: 200, body: { progress: { gm_id: 9300, done: [0], approved: true, code: "LBWD-9300" } } } }
  calls = []
  const both = await Promise.allSettled([S.settleRequest(rc.no, undefined, store), S.settleRequest(rc.no, undefined, store)])
  eq(issues().length, 1); eq(both.filter((r) => r.status === "rejected").length, 1)

  // ---- รายการ WD ที่คีย์ตรงใน ATMS: WD ต่อทะเบียนของ WMS ต้องถูกตัดออก ----
  handler = (c) => (c.path === "/atms/withdraw/list" ? { status: 200, body: { rows: [
    { id: 7001, code: "LBWD-7001", pick_to: "PM", user: "store1", remark: "", created_at: "", approved: true },
    { id: 8802, code: "LBWD-8802", pick_to: "PM", user: "store1", remark: "", created_at: "", approved: true },
    { id: 5555, code: "LBWD-5555", pick_to: "PM", user: "คนอื่น", remark: "", created_at: "", approved: true },
  ] } } : { status: 404, body: {} })
  eq((await listAtmsKeyed(4, new Date())).map((r) => r.id), [5555])

  // ---- drift: HANDED_OUT/SUMMARIZED ไม่ถูกตรวจ · SETTLED ตรวจทีละทะเบียน ----
  calls = []
  eq((await checkDriftDetailed(late.no)).state, "skipped")
  eq((await checkSettleDrift(late.no)).state, "skipped")
  eq(calls.length, 0)
  const t0 = await driftTick({ sleep: async () => {} })
  eq(t0.checked, 0); eq(calls.length, 0) // ตัวตรวจเดิมไม่หยิบใบ Mobile/PM เลย
  const wdBody: Record<number, unknown> = {
    7001: { approved: true, items: [{ sku_code: "OIL-001", amount: 2 }, { sku_code: "FLT-002", amount: 1 }] },
    8802: { approved: true, items: [{ sku_code: "OIL-001", amount: 5 }] },
  }
  handler = (c) => {
    const id = Number(c.path.split("/").pop())
    return wdBody[id] ? { status: 200, body: wdBody[id] } : { status: 404, body: {} }
  }
  calls = []
  const d1 = await checkSettleDrift(m.no)
  eq(d1.state, "checked"); eq(calls.map((c) => c.path), ["/atms/withdraw/7001", "/atms/withdraw/8802"])
  eq(calls[0].headers["X-ATMS-Username"], "svc") // อ่านด้วยบัญชีค้นข้อมูล
  eq(d1.request!.settleGroups![0].atms.drift, null)
  assert.match(String(d1.request!.settleGroups![1].atms.drift), /OIL-001 ใน ATMS เป็น 5 แต่ WMS จ่าย 1/)
  assert.match(String(d1.request!.atms.drift), /^71-5678 \(LBWD-8802\)/)
  eq(d1.request!.status, "SETTLED")
  wdBody[8802] = { approved: true, items: [{ sku_code: "OIL-001", amount: 1 }] }
  wdBody[9100] = { approved: true, items: [{ sku_code: "OIL-001", amount: 1 }, { sku_code: "FLT-002", amount: 1 }] }
  wdBody[9200] = wdBody[9300] = { approved: true, items: [{ sku_code: "OIL-001", amount: 4 }, { sku_code: "FLT-002", amount: 3 }] }
  calls = []
  const tk = await settleDriftTick({ sleep: async () => {} })
  eq(tk, { checked: 4, drifted: 0, skipped: 0 })
  eq((await get(m.no)).atms.drift, null)
  eq((await checkSettleDrift(race.no)).state, "skipped") // คืนหมด ไม่มี WD

  // ---- อู่ใน/อู่นอก ยังเหมือนเดิม: ส่งของ = ยิง ATMS ทันที ----
  handler = () => ({ status: 200, body: { progress: { gm_id: 9900, done: [0, 1], approved: true, code: "LBWD-9900" } } })
  await toReady(g0.no)
  calls = []
  await rejects(S.handOut(g0.no, store), "ConflictError")
  const gi = await issueRequest(g0.no, store)
  eq(gi.status, "ISSUED"); eq(issues().length, 1); eq(issues()[0].body!.remark_token, g0.no)

  await client.close(); await mongod.stop()
  console.log("check-store-withdraw-pending: OK")
}
main().catch((e) => { console.error(e); process.exit(1) })
