// scripts/check-hub-queue.ts — field Hub ในคิว/ใบของฉัน (hubStatus, hubOverdue, hubCount, hubRetry)
// รัน: npx tsx scripts/check-hub-queue.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server)
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwLine, SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.STORE_WITHDRAW_DB = "hub_queue_test"
process.env.CORE_RETURN_DB = "hub_queue_core_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const owner = { email: "req@x.co", name: "ผู้ขอ", via: "web" as const }
const line = (o: Partial<SwLine> = {}): SwLine => ({
  skuId: 11, skuCode: "N-11", skuName: "น็อต", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0,
  mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o,
})
const hubLine = (o: Partial<SwLine> = {}) => line({ skuId: 501, skuCode: "S501", skuName: "ผ้าเบรก Hub", hub: { vendorCode: "V1" }, ...o })
const H = 3600_000

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol } = await import("../lib/store-withdraw/db")
  const { buildQueue, searchInventory } = await import("../lib/store-withdraw/service")
  const { hubWire } = await import("../lib/store-withdraw/hub-core")
  setStoreWithdrawClient(client)

  const base = { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
  const now = new Date("2026-11-20T12:00:00Z")
  async function seed(no: string, lines: SwLine[], p: Record<string, unknown> = {}) {
    await (await swCol()).insertOne({
      no, kind: "stock", workType: "garage_in", status: "ISSUED", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM",
      plate: "70-1234", mrCode: null, ref: null, urgent: false, remark: "", lines, requestedBy: owner, claimedBy: null,
      rejectReason: null, atms: { ...base }, returns: [], createdAt: new Date(now.getTime() - 30 * H), updatedAt: new Date(now.getTime() - H), ...p,
    } as unknown as SwRequest)
  }
  const wdOk = { ...base, code: "WD-H", approved: true }

  await seed("Q-OLD", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 25 * H), hubWd: wdOk })
  await seed("Q-NEW", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 2 * H), hubWd: wdOk })
  await seed("Q-NOHUB", [line()])
  await seed("Q-BOUND", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 40 * H), hubWd: wdOk, hubPr: { code: "PR1", id: 1, by: { email: "a", name: "a" }, at: now } })
  await seed("Q-WDFAIL", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 2 * H), hubWd: { ...base, error: "ATMS ล่ม" }, hubStatus: "DONE" /* ค่าเก่าในฐานต้องไม่ถูกใช้ */ })

  const day = 24 * H
  const upd = (ms: number) => ({ updatedAt: new Date(now.getTime() - ms) })
  await seed("Q-3D", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 3 * day), hubWd: wdOk, hubStatus: "WAIT_PR", ...upd(3 * day) })
  await seed("Q-1D", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 30 * H), hubWd: wdOk, hubStatus: "WAIT_PR", ...upd(day) })
  await seed("Q-NH-1D", [line()], upd(day))
  await seed("Q-DONE-3D", [line(), hubLine()], { hubIssuedAt: new Date(now.getTime() - 3 * day), hubWd: wdOk, hubPr: { code: "PR9", id: 9, by: { email: "a", name: "a" }, at: now }, hubStatus: "DONE", ...upd(3 * day) })

  const q = await buildQueue(4, now)
  const all = Object.values(q).flat()
  const by = (no: string) => all.find((i) => i.no === no)!
  assert.equal(by("Q-OLD").hubOverdue, true)
  assert.equal(by("Q-OLD").hubStatus, "WAIT_PR")
  assert.equal(by("Q-OLD").hubCount, 1)
  assert.equal(by("Q-NEW").hubOverdue, false)
  assert.equal(by("Q-NEW").hubStatus, "WAIT_PR")
  eq([by("Q-NOHUB").hubCount, by("Q-NOHUB").hubStatus, by("Q-NOHUB").hubOverdue, by("Q-NOHUB").hubRetry], [0, "NONE", false, false])
  eq([by("Q-BOUND").hubStatus, by("Q-BOUND").hubOverdue], ["DONE", false])
  // คำนวณสด ไม่เชื่อค่า hubStatus ที่เก็บไว้
  eq([by("Q-WDFAIL").hubStatus, by("Q-WDFAIL").hubRetry], ["WAIT_PR_WD", true])
  assert.equal(by("Q-NEW").hubRetry, false)
  // งาน Hub ที่ค้างอยู่ต้องไม่หลุดคิวตามอายุ · ใบไม่มี Hub / Hub ครบแล้วที่เก่า = หายเหมือนเดิม
  assert.ok(by("Q-3D")); eq([by("Q-3D").hubOverdue, by("Q-3D").hubStatus], [true, "WAIT_PR"])
  assert.ok(q.DONE_TODAY.some((i) => i.no === "Q-3D"))
  assert.ok(by("Q-1D"))
  assert.equal(all.some((i) => i.no === "Q-NH-1D"), false)
  assert.equal(all.some((i) => i.no === "Q-DONE-3D"), false)

  const s = await searchInventory(4, "Q-OLD", 90, now)
  assert.equal(s[0].hubOverdue, true)

  // Mobile/PM: SETTLED แต่ WD Hub ยังไม่เสร็จ → ลองใหม่ได้ · ยังไม่สรุป → ไม่ได้
  const sum = { usages: [{ lineIndex: 1, plate: "x", mrCode: "m", mrItemId: 1, mrItemLabel: "", qty: 1 }], returns: [], note: "", by: owner, at: now }
  const mp = (p: Partial<SwRequest>) => ({ no: "M", kind: "stock", workType: "mobile_pm", status: "SETTLED", lines: [line(), hubLine()], hubIssuedAt: now, summaryDueAt: now, summary: sum, settleGroups: [], ...p } as unknown as SwRequest)
  assert.equal(hubWire(mp({}), now).hubRetry, true)
  assert.equal(hubWire(mp({ status: "SETTLING" }), now).hubRetry, false)
  const grp = { n: 1, plate: "x", token: "M-H1", mrCodes: [], lines: [], status: "DONE", atms: wdOk, hub: true }
  assert.equal(hubWire(mp({ settleGroups: [grp] as never }), now).hubRetry, false)

  // ข้อความวันที่ส่ง: เทียบวันตามเวลาไทย (17:30Z = 00:30 วันถัดไปของไทย)
  const { hubSentText } = await import("../lib/store-withdraw/hub-core")
  assert.equal(hubSentText(new Date("2026-11-20T01:00:00Z"), new Date("2026-11-20T12:00:00Z")), "ส่งแล้ววันนี้")
  assert.equal(hubSentText(new Date("2026-11-19T17:30:00Z"), new Date("2026-11-20T12:00:00Z")), "ส่งแล้ววันนี้")
  assert.equal(hubSentText(new Date("2026-11-19T10:00:00Z"), new Date("2026-11-20T12:00:00Z")), "ส่งแล้ว 19/11")

  await client.close()
  await mongod.stop()
  console.log("check-hub-queue OK")
}
main().catch((e) => { console.error(e); process.exit(1) })
