// scripts/check-hub-service.ts — ผูก PR Hub · กันคืนบรรทัด Hub · สิทธิ์ route (access-policy)
// รัน: npx tsx scripts/check-hub-service.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwLine, SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.STORE_WITHDRAW_DB = "hub_service_test"
process.env.CORE_RETURN_DB = "hub_service_core_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const owner = { email: "req@x.co", name: "ผู้ขอ", via: "web" as const }
const other = { email: "other@x.co", name: "คนอื่น", via: "web" as const }
const store = { email: "store@x.co", name: "คลัง", via: "web" as const }
const line = (o: Partial<SwLine>): SwLine => ({
  skuId: 11, skuCode: "N-11", skuName: "น็อต", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0,
  mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o,
})
const hubLine = (o: Partial<SwLine> = {}) => line({ skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", hub: { vendorCode: "V1" }, ...o })

async function rejects(p: Promise<unknown>, status: number, re: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    const x = e as { status?: number; message: string }
    const st = x.status ?? (x.constructor.name === "ConflictError" ? 409 : 0)
    assert.equal(st, status, x.message)
    assert.match(x.message, re)
    return true
  })
}

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, swLogCol } = await import("../lib/store-withdraw/db")
  const { bindHubPr } = await import("../lib/store-withdraw/hub-service")
  const { requestReturn } = await import("../lib/store-withdraw/service")
  const { sectionForApi, checkRequest, SECTIONS } = await import("../lib/access-policy")
  setStoreWithdrawClient(client)

  const baseAtms = { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
  async function seed(no: string, lines: SwLine[], p: Record<string, unknown> = {}) {
    const now = new Date()
    await (await swCol()).insertOne({
      no, kind: "stock", workType: "garage_in", status: "ISSUED", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM",
      plate: "70-1234", mrCode: "MR-1", ref: null, urgent: false, remark: "", lines, requestedBy: owner, claimedBy: null,
      rejectReason: null, atms: { ...baseAtms, code: "WD-N" }, hubWd: { ...baseAtms, code: "WD-H", approved: true }, returns: [],
      hubIssuedAt: now, hubStatus: "WAIT_PR", createdAt: now, updatedAt: now, ...p,
    } as unknown as SwRequest)
    return no
  }
  const get = async (no: string) => (await (await swCol()).findOne({ no }))!

  // 1. ผู้ขอผูก PR → hubStatus เปลี่ยน + log 1 แถว
  await seed("P-1", [line({}), hubLine()])
  const r = await bindHubPr("P-1", { code: " PR-0001 ", id: 9 }, owner, false)
  eq(r.hubPr!.code, "PR-0001"); eq(r.hubPr!.id, 9); eq(r.hubStatus, "DONE")
  eq((await get("P-1")).hubStatus, "DONE")
  const logs = await (await swLogCol()).find({ no: "P-1", action: "hubPr" }).toArray()
  eq(logs.length, 1); eq(logs[0].note, "- → PR-0001")

  // 2. เปลี่ยน PR ซ้ำได้ (สโตร์ก็ทำได้) log old → new
  await bindHubPr("P-1", { code: "PR-0002", id: null }, store, true)
  eq((await get("P-1")).hubPr!.code, "PR-0002")
  eq((await (await swLogCol()).find({ no: "P-1", action: "hubPr" }).sort({ seq: 1 }).toArray())[1].note, "PR-0001 → PR-0002")

  // 3. คนอื่นไม่ใช่สโตร์ → 403
  await rejects(bindHubPr("P-1", { code: "PR-0003", id: null }, other, false), 403, /ไม่ใช่ของคุณ/)
  eq((await get("P-1")).hubPr!.code, "PR-0002")

  // 4. ไม่มี Hub → 409 · ปิดแล้ว → 409
  await seed("P-2", [line({})], { hubStatus: "NONE" })
  await rejects(bindHubPr("P-2", { code: "PR-0001", id: null }, owner, false), 409, /ไม่มีอะไหล่ Hub/)
  await seed("P-3", [hubLine()], { status: "CANCELLED", hubWd: { ...baseAtms } })
  await rejects(bindHubPr("P-3", { code: "PR-0001", id: null }, owner, false), 409, /ปิดไปแล้ว/)
  // ปิดแล้วแต่ WD Hub ตัดไปแล้ว (ของออกไปจริง) → ยังผูก PR ได้ → DONE
  await seed("P-3b", [line({}), hubLine()], { status: "REJECTED" })
  const r3b = await bindHubPr("P-3b", { code: "PR-0009", id: null }, store, true)
  eq(r3b.hubStatus, "DONE"); eq((await get("P-3b")).hubStatus, "DONE")

  // 5. code สั้นเกิน → 400
  await seed("P-4", [hubLine()])
  await rejects(bindHubPr("P-4", { code: "P", id: null }, owner, false), 400, /ตัวอักษร/)
  await rejects(bindHubPr("P-4", { code: "PR-0001", id: "x" }, owner, false), 400, /id/)

  // 6. คืนบรรทัด Hub → 400 · บรรทัดปกติผ่านด่านนี้
  await seed("P-5", [line({}), hubLine()])
  await rejects(requestReturn("P-5", { reasonCode: "unused", lines: [{ lineIndex: 1, qty: 1 }] } as never, owner), 400, /อะไหล่ Hub คืนผ่านใบนี้ไม่ได้/)
  await rejects(requestReturn("P-5", { reasonCode: "unused", lines: [{ lineIndex: 0, qty: 1 }, { lineIndex: 1, qty: 1 }] } as never, owner), 400, /อะไหล่ Hub/)

  // 7. สิทธิ์ route
  eq(sectionForApi("/api/store-withdraw/SW-1/hub-wd-retry"), "store-queue")
  eq(sectionForApi("/api/store-withdraw/SW-1/hub-pr"), "store-withdraw")
  const acc = (o: Record<string, string>) => ({ ...Object.fromEntries(SECTIONS.map((s) => [s, "none"])), ...o }) as never
  const edit = acc({ "store-withdraw": "edit" })
  eq(checkRequest({ pathname: "/api/store-withdraw/SW-1/hub-pr", method: "POST", access: edit, isSuperAdmin: false }).ok, true)
  eq(checkRequest({ pathname: "/api/store-withdraw/SW-1/hub-wd-retry", method: "POST", access: edit, isSuperAdmin: false }).ok, false)
  eq(checkRequest({ pathname: "/api/store-withdraw/SW-1/hub-wd-retry", method: "POST", access: acc({ "store-queue": "edit" }), isSuperAdmin: false }).ok, true)

  console.log("check-hub-service: OK")
  await client.close(); await mongod.stop()
}
main().catch((e) => { console.error(e); process.exit(1) })
