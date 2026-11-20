// scripts/check-hub-core.ts — รัน: npx tsx scripts/check-hub-core.ts
import assert from "node:assert/strict"
import { returnMaxOf, normalIssueLines, hubIssueLines, hubStatusOf, hubPrOverdue, hubWdDone, hubCutPlan, isHubLine, HUB_PR_DUE_MS } from "../lib/store-withdraw/hub-core"
import type { SwLine, SwRequest, AtmsProgress } from "../lib/store-withdraw/types"

const eq = assert.deepEqual
const line = (p: Partial<SwLine> = {}): SwLine => ({ skuId: 1, skuCode: "A", skuName: "น็อต", requestedQty: 2, issuedQty: null, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...p })
const hubL = (p: Partial<SwLine> = {}) => line({ skuId: 2, requestedQty: 1, hub: { vendorCode: "V1" }, ...p })
const prog = (p: Partial<AtmsProgress> = {}): AtmsProgress => ({ gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null, ...p })
const req = (p: Partial<SwRequest> = {}): SwRequest => ({ no: "SW-1", kind: "stock", status: "ISSUED", inventoryId: 4, inventoryName: "", pickToId: 1, pickToName: "", plate: "", mrCode: null, urgent: false, remark: "", lines: [line(), hubL()], requestedBy: { email: "", name: "", via: "web" }, claimedBy: null, rejectReason: null, atms: prog(), returns: [], createdAt: new Date(), updatedAt: new Date(), ...p })
const mixed = [line(), hubL(), line({ skuId: 3, issuedQty: 0 })]

eq(normalIssueLines(mixed).map(x => x.index), [0])
eq(hubIssueLines(mixed).map(x => x.index), [1])
eq(hubIssueLines([hubL({ issuedQty: 0 })]), [])
assert.equal(isHubLine(line()), false)

const at = new Date("2026-11-20T10:00:00Z")
const pr = { code: "PR1", id: 1, by: { email: "a", name: "a" }, at }
const wdOk = prog({ code: "WD1", approved: true })
assert.equal(hubStatusOf(req({ lines: [line()] })), "NONE")
assert.equal(hubStatusOf(req()), "WAIT_ISSUE")
assert.equal(hubStatusOf(req({ hubIssuedAt: at })), "WAIT_PR_WD")
assert.equal(hubStatusOf(req({ hubIssuedAt: at, hubPr: pr })), "WAIT_WD")
assert.equal(hubStatusOf(req({ hubIssuedAt: at, hubWd: wdOk })), "WAIT_PR")
assert.equal(hubStatusOf(req({ hubIssuedAt: at, hubWd: wdOk, hubPr: pr })), "DONE")
assert.equal(hubStatusOf(req({ status: "REJECTED" })), "NONE")
assert.equal(hubStatusOf(req({ status: "CANCELLED", hubIssuedAt: at })), "NONE")
// ปิดใบแล้วแต่ WD Hub ตัดไปแล้ว = ยังค้าง PR (ผูกแล้ว = DONE) · เกินกำหนดนับต่อ · WD Hub ยังไม่ตัด = NONE ไม่เตือน
assert.equal(hubStatusOf(req({ status: "REJECTED", hubIssuedAt: at, hubWd: wdOk })), "WAIT_PR")
assert.equal(hubStatusOf(req({ status: "REJECTED", hubIssuedAt: at, hubWd: wdOk, hubPr: pr })), "DONE")
assert.equal(hubStatusOf(req({ status: "REJECTED", hubIssuedAt: at, hubWd: prog({ code: "WD1" }) })), "NONE")
assert.equal(hubStatusOf(req({ status: "REJECTED", hubIssuedAt: at, lines: [line(), hubL({ issuedQty: 0 })], hubWd: wdOk })), "NONE")
assert.equal(hubPrOverdue(req({ status: "REJECTED", hubIssuedAt: at, hubWd: wdOk }), new Date(at.getTime() + 48 * 3600_000)), true)
assert.equal(hubPrOverdue(req({ status: "REJECTED", hubIssuedAt: at, hubWd: prog() }), new Date(at.getTime() + 48 * 3600_000)), false)

const h = (ms: number) => new Date(at.getTime() + ms)
assert.equal(HUB_PR_DUE_MS, 24 * 3600_000)
assert.equal(hubPrOverdue({ hubIssuedAt: at, hubPr: null }, h(24 * 3600_000 - 60_000)), false)
assert.equal(hubPrOverdue({ hubIssuedAt: at, hubPr: null }, h(24 * 3600_000 + 60_000)), true)
assert.equal(hubPrOverdue({ hubIssuedAt: at, hubPr: pr }, h(48 * 3600_000)), false)
assert.equal(hubPrOverdue({ hubIssuedAt: null, hubPr: null }, h(48 * 3600_000)), false)
// ทุกบรรทัด Hub จ่าย 0 แล้วส่งของแล้ว = ไม่มีอะไรต้องตาม
const zeroHub = [line(), hubL({ issuedQty: 0 })]
assert.equal(hubStatusOf(req({ lines: zeroHub, hubIssuedAt: at })), "NONE")
assert.equal(hubStatusOf(req({ lines: zeroHub })), "WAIT_ISSUE")
assert.equal(hubPrOverdue({ hubIssuedAt: at, hubPr: null, lines: zeroHub }, h(48 * 3600_000)), false)
assert.equal(hubPrOverdue({ hubIssuedAt: at, hubPr: null, lines: [line(), hubL()] }, h(48 * 3600_000)), true)

// pending (Mobile/PM)
const sum = { usages: [{ lineIndex: 1, plate: "x", mrCode: "m", mrItemId: 1, mrItemLabel: "", qty: 1 }], returns: [], note: "", by: { email: "", name: "" }, at }
const grp = (status: "PENDING" | "DONE", hub = true) => ({ n: 1, plate: "x", token: "t", mrCodes: [], lines: [], status, atms: prog(), hub })
const pend = (p: Partial<SwRequest>) => ({ lines: [line(), hubL()], workType: "mobile_pm" as const, summaryDueAt: at, ...p })
assert.equal(hubWdDone(pend({})), false)
assert.equal(hubWdDone(pend({ summary: sum, settleGroups: [grp("PENDING")] })), false)
assert.equal(hubWdDone(pend({ summary: sum, settleGroups: [grp("DONE")] })), true)
assert.equal(hubWdDone(pend({ summary: sum, settleGroups: [grp("DONE", false)] })), false)
assert.equal(hubWdDone(pend({ summary: { ...sum, usages: [] }, settleGroups: [] })), true)
assert.equal(hubWdDone({ lines: [line()], hubWd: null }), true)
assert.equal(hubWdDone({ lines: [line(), hubL()], workType: "garage_in", settleGroups: [], hubWd: wdOk }), true)

eq(hubCutPlan(mixed, 4), [{ lineIndex: 1, vendorCode: "V1", skuId: 2, qty: 1 }])
// ขอคืน: บรรทัด Hub คืนไม่ได้ (0) · บรรทัดปกติหักที่ขอค้าง · ไม่มีบรรทัดปกติคืนได้ = ไม่มีปุ่ม
eq(returnMaxOf({ lines: [line({ issuedQty: 3 }), hubL({ issuedQty: 2 })], returns: [] }), [3, 0])
eq(returnMaxOf({ lines: [line({ issuedQty: 3 }), hubL()], returns: [{ status: "RETURN_REQUESTED", lines: [{ lineIndex: 0, qty: 1 }] }, { status: "RETURNED", lines: [{ lineIndex: 0, qty: 2 }] }] }), [2, 0])
assert.equal(returnMaxOf({ lines: [hubL({ issuedQty: 2 })], returns: [] }).some((m) => m > 0), false)
assert.equal(returnMaxOf({ lines: [line({ issuedQty: 1, returnedQty: 1 }), hubL()], returns: [] }).some((m) => m > 0), false)
console.log("check-hub-core OK")
