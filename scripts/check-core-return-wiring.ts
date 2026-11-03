// scripts/check-core-return-wiring.ts — รัน: npx tsx scripts/check-core-return-wiring.ts  (Mongo ในเครื่อง · stub api-ncac ด้วย globalThis.fetch)
// ครอบ: ส่งของ (ISSUED) / ตัดสต๊อก Mobile-PM (SETTLED) → แถวรอคืนซากครั้งเดียว · ลองใหม่/ทำต่อไม่สร้างซ้ำ · สร้างแถวพังไม่กระทบใบเบิก
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { SwRequest } from "../lib/store-withdraw/types"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_wire_test"
process.env.CORE_RETURN_DB = "core_wire_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
let issueCalls = 0
let reply: () => { status: number; body: unknown } = () => ({ status: 200, body: { progress: { gm_id: 9001, done: [0, 1], approved: true, code: "LBWD26110077" } } })
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const path = new URL(String(input)).pathname
  if (path !== "/atms/withdraw/issue") return new Response("{}", { status: 404 })
  issueCalls++
  const r = reply()
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch

const store = { email: "store1@menatransport.co.th", name: "สโตร์", via: "web" as const }
const tech = { email: "tech1@menatransport.co.th", name: "ช่างหนึ่ง", via: "web" as const }
const baseAtms = { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
const line = (o: Record<string, unknown>) => ({ skuId: 1, skuCode: "A", skuName: "a", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o })

void (async () => {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const origErr = console.error
  const logged: string[] = []
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")) }
  try {
    const { setStoreWithdrawClient, swCol } = await import("../lib/store-withdraw/db")
    const { saveCreds } = await import("../lib/store-withdraw/creds")
    const { issueRequest } = await import("../lib/store-withdraw/issue")
    const S = await import("../lib/store-withdraw/settle")
    const { buildSettleGroups } = await import("../lib/store-withdraw/pending")
    const { baseCol, logCol } = await import("../lib/core-return/db")
    setStoreWithdrawClient(client) // core-return ใช้ client ทดสอบตัวเดียวกันอัตโนมัติ
    await saveCreds(store.email, "store1", "pw", { username: "store1", branch: "ลาดกระบัง", name: "สโตร์" })
    const seed = async (no: string, p: Record<string, unknown> = {}) => {
      const now = new Date()
      await (await swCol()).insertOne({
        no, kind: "stock", workType: "garage_in", status: "READY", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM-งานซ่อม",
        plate: "70-1234", mrCode: "LBMR26110001", ref: null, urgent: false, remark: "", requestedBy: tech, claimedBy: null, rejectReason: null,
        atms: { ...baseAtms }, returns: [], createdAt: now, updatedAt: now,
        lines: [line({ skuId: 501, skuCode: "ALT-1", skuName: "ไดชาร์จ", requestedQty: 1, issuedQty: 1, mrItemLabel: "อู่ใน-CM-ระบบไฟ" }), line({ skuId: 502, skuCode: "STR-1", skuName: "ไดสตาร์ท", requestedQty: 2, issuedQty: 2 }), line({ skuId: 503, skuCode: "N/A", issuedQty: 0 })],
        ...p,
      } as unknown as SwRequest)
    }
    const rows = async (no: string) => (await (await baseCol()).find({ swNo: no }).sort({ row_key: 1 }).toArray())

    // ── 1. ISSUED → แถวต่อบรรทัดที่จ่ายจริง ─────────────────────────────
    await seed("SW-2611-101")
    const r1 = await issueRequest("SW-2611-101", store)
    eq(r1.status, "ISSUED")
    const got = await rows("SW-2611-101")
    eq(got.map((r) => [r.row_key, r.wdCode, r.skuCode, r.qtyIssued, r.coreStatus, r.requester?.email, r.plate, r.mrCode, r.warehouse]), [
      ["sw:SW-2611-101:0", "LBWD26110077", "ALT-1", 1, "pending", tech.email, "70-1234", "LBMR26110001", "ลาดกระบัง"],
      ["sw:SW-2611-101:1", "LBWD26110077", "STR-1", 2, "pending", tech.email, "70-1234", "LBMR26110001", "ลาดกระบัง"],
    ])
    eq(got[0].mrItemLabel, "อู่ใน-CM-ระบบไฟ")
    // ลองส่งซ้ำ (ใบ ISSUED แล้ว) = 409 ไม่เพิ่มแถว
    await assert.rejects(issueRequest("SW-2611-101", store))
    eq((await rows("SW-2611-101")).length, 2)

    // ── 2. ส่งพลาดก่อน แล้วลองใหม่สำเร็จ → แถวครั้งเดียว ────────────────────
    await seed("SW-2611-102")
    reply = () => ({ status: 409, body: { detail: "สต๊อกไม่พอ", progress: { gm_id: 9002, done: [0], approved: false, code: null } } })
    eq((await issueRequest("SW-2611-102", store)).status, "ISSUE_FAILED")
    eq((await rows("SW-2611-102")).length, 0, "ยังไม่ได้ WD = ไม่มีแถว")
    reply = () => ({ status: 200, body: { progress: { gm_id: 9002, done: [0, 1], approved: true, code: "LBWD26110078" } } })
    eq((await issueRequest("SW-2611-102", store)).status, "ISSUED")
    eq((await rows("SW-2611-102")).map((r) => r.wdCode), ["LBWD26110078", "LBWD26110078"])
    eq(await (await logCol()).countDocuments({ row_key: /^sw:SW-2611-102:/, action: "create" }), 2)

    // ── 3. ทำต่อใบที่ค้าง ISSUING (โปรเซสตาย) → ไม่ซ้ำ ─────────────────────
    await seed("SW-2611-103", { status: "ISSUING", updatedAt: new Date(Date.now() - 10 * 60_000), atms: { ...baseAtms, gmId: 9003, startedAt: new Date() } })
    reply = () => ({ status: 200, body: { progress: { gm_id: 9003, done: [0, 1], approved: true, code: "LBWD26110079" } } })
    eq((await issueRequest("SW-2611-103", store)).status, "ISSUED")
    const { syncCoreRowsForRequest } = await import("../lib/core-return/sw-sync")
    eq((await syncCoreRowsForRequest((await (await swCol()).findOne({ no: "SW-2611-103" }))!, store)).created, 0, "เก็บตกซ้ำไม่สร้างเพิ่ม")
    eq((await rows("SW-2611-103")).length, 2)

    // ── 4. สร้างแถวซากพัง → ใบเบิกยัง ISSUED ปกติ · log ไว้ · เก็บตกทีหลังได้ ────
    await seed("SW-2611-104")
    reply = () => ({ status: 200, body: { progress: { gm_id: 9004, done: [0, 1], approved: true, code: "LBWD26110080" } } })
    const { setCoreReturnClient } = await import("../lib/core-return/db")
    const broken = new MongoClient("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300")
    setCoreReturnClient(broken)
    const calls0 = issueCalls
    const r4 = await issueRequest("SW-2611-104", store)
    eq(r4.status, "ISSUED")
    eq(r4.atms.code, "LBWD26110080")
    eq(issueCalls - calls0, 1, "ATMS ถูกเรียกครั้งเดียว")
    assert.ok(logged.some((l) => l.includes("[core-return]") && l.includes("SW-2611-104")), "ต้อง log ไว้ให้เก็บตก")
    setCoreReturnClient(null)
    eq((await rows("SW-2611-104")).length, 0)
    eq((await syncCoreRowsForRequest((await (await swCol()).findOne({ no: "SW-2611-104" }))!, store)).created, 2, "เก็บตกได้")
    await broken.close().catch(() => {})

    // ── 5. Mobile/PM: SETTLED → แถวต่อแถวสรุปการใช้ (ทะเบียน/MR ของแถวนั้น) ──
    const usages = [
      { lineIndex: 0, plate: "70-1234", mrCode: "LBMR26110001", mrItemId: 11, mrItemLabel: "PM-ไฟ : 11", qty: 1 },
      { lineIndex: 1, plate: "71-5678", mrCode: "LBMR26110002", mrItemId: 22, mrItemLabel: "PM-เบรค : 22", qty: 2 },
    ]
    const summary = { usages, returns: [], note: "", by: tech, at: new Date() }
    await seed("SW-2611-105", { workType: "mobile_pm", status: "SUMMARIZED", summaryDueAt: new Date(), summary })
    let gm = 7000
    let failPlate: string | null = "71-5678"
    reply = () => ({ status: 200, body: { progress: { gm_id: ++gm, done: [0], approved: true, code: `LBWD-${gm}` } } })
    const realReply = reply
    let n = 0
    reply = () => (++n === 2 && failPlate ? { status: 409, body: { detail: "สต๊อกไม่พอ", progress: { gm_id: 8802, done: [], approved: false, code: null } } } : realReply())
    const f1 = await S.settleRequest("SW-2611-105", true, store)
    eq(f1.status, "SETTLE_FAILED")
    eq((await rows("SW-2611-105")).length, 0, "ตัดไม่ครบทุกคัน = ยังไม่สร้าง")
    failPlate = null
    const f2 = await S.settleRequest("SW-2611-105", true, store)
    eq(f2.status, "SETTLED")
    const pm = await rows("SW-2611-105")
    const groups = buildSettleGroups("SW-2611-105", usages as never, (() => ({ ...baseAtms })) as never)
    eq(groups.length, 2)
    eq(pm.map((r) => [r.row_key, r.plate, r.mrCode, r.mrItemLabel, r.qtyIssued, r.skuCode, r.swUsageIndex]), [
      ["sw:SW-2611-105:0:0", "70-1234", "LBMR26110001", "PM-ไฟ : 11", 1, "ALT-1", 0],
      ["sw:SW-2611-105:1:1", "71-5678", "LBMR26110002", "PM-เบรค : 22", 2, "STR-1", 1],
    ])
    const wds = new Map(f2.settleGroups!.map((g) => [g.plate, g.atms.code]))
    eq(pm.map((r) => r.wdCode), [wds.get("70-1234"), wds.get("71-5678")], "WD ของทะเบียนนั้น")
    eq((await syncCoreRowsForRequest(f2, store)).created, 0)
    // ใบที่จุดประสงค์ไม่มีซาก (ยาง) = ไม่สร้าง
    await seed("SW-2611-106", { pickToName: "T-ยาง" })
    reply = () => ({ status: 200, body: { progress: { gm_id: 9006, done: [0, 1], approved: true, code: "LBWD26110090" } } })
    eq((await issueRequest("SW-2611-106", store)).status, "ISSUED")
    eq((await rows("SW-2611-106")).length, 0)

    console.error = origErr
    console.log("check-core-return-wiring: OK")
  } finally {
    console.error = origErr
    await client.close()
    await mongod.stop()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
