// scripts/check-store-withdraw-docref.ts — อ้างอิงใบ PO / DD แล้วนำเข้ารายการ (ฝั่ง WMS)
// รัน: npx tsx scripts/check-store-withdraw-docref.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server · stub api-ncac ด้วย globalThis.fetch)
// ครอบ: parseRef · tallyCut/docWarnings · lookup po/dd ส่งต่อ · getDocDetail (จับคู่ SKU 2 ชั้น เพดาน 25 ตรงเป๊ะเท่านั้น · alreadyCut/cutBy · warnings)
//       · createRequest เก็บ ref · remark ของ ATMS มีเลขใบแต่ remark_token ไม่เปลี่ยน · ใบเก่าไม่มี ref → withRef
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_ATMS_CRED_KEY = randomBytes(32).toString("base64")
process.env.NCAC_BASE = "http://ncac.test"
process.env.NCAC_API_KEY = "k-test"
process.env.STORE_WITHDRAW_DB = "sw_docref_test"
process.env.MONGO_DB = "master_data_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const actor = { email: "mech@menatransport.co.th", name: "ช่าง", via: "web" as const }
const store = { email: "store@x.co", name: "สโตร์", via: "web" as const }

type Call = { path: string; query: URLSearchParams; body: Json | null }
let calls: Call[] = []
let handler: (c: Call) => { status: number; body: unknown } = () => ({ status: 200, body: {} })
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown, init: { body?: string } = {}) => {
  const u = new URL(String(input))
  const c: Call = { path: u.pathname, query: u.searchParams, body: init.body ? JSON.parse(init.body) : null }
  calls.push(c)
  const r = handler(c)
  return new Response(JSON.stringify(r.body), { status: r.status })
}) as typeof fetch
const callsTo = (p: string) => calls.filter((c) => c.path === p)
const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number; name?: string }) => e.status ?? e.name ?? -1)

const line = (o: Json) => ({ sku_code: "A-1", sku_name: "A-1 : น็อต", group: "ทั่วไป", amount: 1, received: 1, remaining: 0, unit_price: 10, total: 10, remark: "", is_labour: false, ...o })
const poDoc = (lines: Json[], o: Json = {}) => ({ id: 157902, code: "LBPO26100704", kind: "po", date: "25/10/2026", supplier: "บ.ทดสอบ", inventory: "ลาดกระบัง", pr: "LBPR26100561", po: null, withdraw: null, remark: "", lines, ...o })

async function main() {
  const core = await import("../lib/store-withdraw/core")

  // ---- parseRef ----
  eq(core.parseRef(undefined), { ref: null })
  eq(core.parseRef(null), { ref: null })
  eq(core.parseRef({ type: "po", code: " LBPO26100704 ", id: 157902 }), { ref: { type: "po", code: "LBPO26100704", id: 157902 } })
  eq(core.parseRef({ type: "dd", code: "LBDD1" }), { ref: { type: "dd", code: "LBDD1", id: null } })
  eq(core.parseRef({ type: "pr", code: "LBPR26100561", id: 9 }), { ref: { type: "pr", code: "LBPR26100561", id: 9 } })
  for (const bad of [{ type: "xx", code: "LBPR123" }, { type: "po", code: "" }, { type: "po", code: "   " }, { type: "po", code: "ab" }, { type: "po", code: "x".repeat(41) }, { type: "po" }, { type: "po", code: "LBPO123", id: -3 }, { type: "po", code: "LBPO123", id: "7" }, "LBPO123", [1]]) {
    assert.ok("error" in core.parseRef(bad), "ต้องปฏิเสธ " + JSON.stringify(bad))
  }

  // ---- tallyCut / docWarnings ----
  const rq = (no: string, st: string, lines: Json[]) => ({ no, status: st, lines }) as never
  const t = core.tallyCut([
    rq("SW-1", "NEW", [{ skuCode: "A-1", requestedQty: 2, issuedQty: null }]),
    rq("SW-2", "ISSUED", [{ skuCode: "A-1", requestedQty: 5, issuedQty: 3 }, { skuCode: "B-2", requestedQty: 1, issuedQty: 0 }]),
    rq("SW-3", "CANCELLED", [{ skuCode: "A-1", requestedQty: 9, issuedQty: null }]),
    rq("SW-4", "REJECTED", [{ skuCode: "A-1", requestedQty: 9, issuedQty: null }]),
  ])
  eq(t.get("A-1"), { qty: 5, by: ["SW-1", "SW-2"] }) // 2 + issuedQty 3 (issuedQty ?? requestedQty) · ยกเลิก/ปฏิเสธไม่นับ
  eq(t.get("B-2"), { qty: 0, by: ["SW-2"] })
  eq(core.docWarnings("po", [{ isLabour: false, receivedQty: 0, alreadyCut: 0 }]), ["ใบนี้ยังไม่ได้รับของ"])
  eq(core.docWarnings("dd", [{ isLabour: true, receivedQty: 0, alreadyCut: 0 }]), ["ใบนี้มีบรรทัดค่าแรง/บริการ"]) // DD ไม่ขึ้น "ยังไม่ได้รับ"
  eq(core.docWarnings("po", [{ isLabour: true, receivedQty: 1, alreadyCut: 2 }]), ["ใบนี้มีบรรทัดค่าแรง/บริการ", "บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว"])

  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient, swCol, getDb, withRef } = await import("../lib/store-withdraw/db")
  const svc = await import("../lib/store-withdraw/service")
  const { saveCreds } = await import("../lib/store-withdraw/creds")
  const { issueRequest } = await import("../lib/store-withdraw/issue")
  setStoreWithdrawClient(client)
  svc.setDocPaceMs(0)
  await client.db("master_data_test").collection("atms_sku_master").insertMany([
    { skuPk: 501, code: "A-1", name: "น็อต", stockQty: 12, inventoryId: 4 },
    { skuPk: 502, code: "B-2", name: "สลัก", stockQty: 3, inventoryId: "4" }, // sync จริงเก็บ inventoryId เป็นสตริง
    { skuPk: 503, code: "C-3", name: "ซีล", stockQty: 8, inventoryId: 5 }, // คลังอื่น → skuId ใช้ได้ แต่ไม่เอาสต๊อก
  ])
  const db = await getDb()
  assert.ok((await db.collection("store_withdraw_requests").indexes()).some((i) => JSON.stringify(i.key) === '{"ref.code":1,"createdAt":-1}'))

  // ---- lookup po / dd: ส่งต่อ doc/search ----
  const hit = { id: 157902, code: "LBPO26100704", kind: "po", date: "25/10/2026", supplier: "x", status: "ยังไม่ได้รับสินค้า", total: 1100, ref: "LBPR26100561" }
  handler = (c) => (c.path === "/atms/withdraw/doc/search" ? { status: 200, body: { results: [hit] } } : { status: 404, body: {} })
  eq(svc.lookupKind("po"), "po"); eq(svc.lookupKind("dd"), "dd"); eq(svc.lookupKind("cutoff"), null)
  eq(await svc.lookup("po", "LBPO", 20, 4), [hit])
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("kind"), "po")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("q"), "LBPO")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("inventory_id"), "4")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("limit"), "20")
  calls = []
  await svc.lookup("dd", "LBDD", 5)
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("kind"), "dd")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.has("inventory_id"), false)

  // ---- getDocDetail: จับคู่ SKU + mapping ----
  const sw = await swCol()
  const mkReq = async (no: string, st: string, ref: Json | null, lines: Json[]) => {
    const now = new Date()
    await sw.insertOne({ no, kind: "stock", status: st, inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "ซ่อมรถ", plate: "70-1", mrCode: null, ref, urgent: false, remark: "",
      lines: lines.map((l) => ({ skuId: 1, skuName: "x", short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", issuedQty: null, ...l })),
      requestedBy: actor, claimedBy: null, rejectReason: null, atms: { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }, returns: [], createdAt: now, updatedAt: now } as never)
  }
  await mkReq("SW-A", "NEW", { type: "po", code: "LBPO26100704", id: 157902 }, [{ skuCode: "A-1", requestedQty: 2 }])
  await mkReq("SW-B", "ISSUED", { type: "po", code: "LBPO26100704", id: null }, [{ skuCode: "A-1", requestedQty: 5, issuedQty: 3 }])
  await mkReq("SW-C", "CANCELLED", { type: "po", code: "LBPO26100704", id: null }, [{ skuCode: "A-1", requestedQty: 7 }])
  await mkReq("SW-D", "REJECTED", { type: "po", code: "LBPO26100704", id: null }, [{ skuCode: "A-1", requestedQty: 7 }])
  await mkReq("SW-E", "NEW", { type: "dd", code: "LBPO26100704", id: null }, [{ skuCode: "A-1", requestedQty: 7 }]) // คนละชนิดใบ ไม่นับ
  await mkReq("SW-F", "NEW", null, [{ skuCode: "A-1", requestedQty: 7 }])

  const sk = (q: string) => ({ results: q === "NEW-1" ? [{ id: 9001, code: "NEW-1-X", name: "ใกล้เคียง" }, { id: 9002, code: "NEW-1", name: "ตรงเป๊ะ" }] : q === "NEW-2" ? [{ id: 9100, code: "NEW-2-LONG", name: "ไม่ตรง" }] : [] })
  handler = (c) => {
    if (c.path === "/atms/withdraw/doc/po/157902") return { status: 200, body: poDoc([
      line({ sku_code: "A-1", sku_name: "A-1 : น็อต", amount: 4, received: 2, remaining: 2, unit_price: 300 }),
      line({ sku_code: "B-2", sku_name: "B-2 : สลัก", amount: 1, received: 0, remaining: 1 }),
      line({ sku_code: "C-3", sku_name: "C-3 : ซีล", amount: 1, received: 1 }),
      line({ sku_code: "LB00269", sku_name: "LB00269 : ค่าแรงซ่อมเกียร์", group: "ค่าแรง-ระบบเบรค", is_labour: true, amount: 1, received: 1 }),
      line({ sku_code: "NEW-1", sku_name: "NEW-1 : ของใหม่", amount: 2, received: 2 }),
      line({ sku_code: "NEW-2", sku_name: "NEW-2 : ไม่มีรหัสตรง", amount: 2, received: 2 }),
    ]) }
    if (c.path === "/atms/withdraw/lookup/sku") return { status: 200, body: sk(c.query.get("q") ?? "") }
    return { status: 404, body: { detail: "nf" } }
  }
  calls = []
  const d = await svc.getDocDetail("po", 157902, 4)
  eq(d.doc, { id: 157902, code: "LBPO26100704", kind: "po", date: "25/10/2026", supplier: "บ.ทดสอบ", pr: "LBPR26100561", po: null })
  const by = Object.fromEntries(d.lines.map((l) => [l.skuCode, l]))
  eq(by["A-1"], { skuCode: "A-1", skuName: "A-1 : น็อต", group: "ทั่วไป", isLabour: false, docQty: 4, receivedQty: 2, qty: 2, unitPrice: 300, skuId: 501, stockQty: 12, alreadyCut: 5, cutBy: ["SW-A", "SW-B"] })
  eq([by["B-2"].skuId, by["B-2"].stockQty, by["B-2"].qty, by["B-2"].docQty], [502, 3, 0, 1]) // inventoryId สตริง "4" ก็ตรงคลัง · PO ยังไม่รับ qty 0
  eq([by["C-3"].skuId, by["C-3"].stockQty], [503, null]) // สำเนาเป็นคลัง 5 → ไม่เอาสต๊อก
  eq(by["LB00269"], undefined) // ค่าแรงถูกตัดทิ้งที่เซิร์ฟเวอร์ (PO/DD/PR เหมือนกัน)
  eq([by["NEW-1"].skuId, by["NEW-2"].skuId], [9002, null]) // ATMS fallback รหัสตรงเป๊ะเท่านั้น (ไม่หยิง NEW-1-X / NEW-2-LONG)
  eq(callsTo("/atms/withdraw/lookup/sku").map((c) => c.query.get("q")).sort(), ["NEW-1", "NEW-2"]) // เจอในสำเนาแล้วไม่ถาม ATMS
  eq(callsTo("/atms/withdraw/lookup/sku")[0].query.get("inventory_id"), "4")
  eq(d.warnings, ["ข้ามบรรทัดค่าแรง 1 รายการ (นำเข้าเฉพาะอะไหล่)", "บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว"])
  eq(d.lines.map((l) => l.skuCode), ["A-1", "B-2", "C-3", "NEW-1", "NEW-2"])

  // ---- PR: lookup (q = ทะเบียน · limit ≤ 5 · remark ส่งต่อ) + getDocDetail นำเข้าเฉพาะอะไหล่ ----
  eq(svc.lookupKind("pr"), "pr")
  const prHit = { id: 777, code: "LBPR26100561", kind: "pr", date: "25/10/2026", supplier: "", status: "อนุมัติ", total: 500, ref: null, remark: "71-1234 เปลี่ยนผ้าเบรค" }
  handler = (c) => (c.path === "/atms/withdraw/doc/search" ? { status: 200, body: { results: [prHit] } } : { status: 404, body: {} })
  calls = []
  eq(await svc.lookup("pr", "71-1234", 20, 4), [prHit]) // remark ถึงปลายทาง
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("kind"), "pr")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("q"), "71-1234")
  eq(callsTo("/atms/withdraw/doc/search")[0].query.get("limit"), "5") // ขอ 20 ก็ยัง 5
  await svc.lookup("pr", "1234", 3)
  eq(callsTo("/atms/withdraw/doc/search")[1].query.get("limit"), "3")
  const mrvHit = { id: 9001, code: "LBMR26100001", date: "25/10/2026", plate: "71-1234", vehicle_no: "1234", step: "รออะไหล่", driver: "สมชาย", mechanic: "ช่างเอ", remark: "อู่ใน-CM-ระบบเครื่องยนต์: ปัญหา ความร้อนขึ้น" }
  handler = (c) => (c.path === "/atms/withdraw/mr/search" ? { status: 200, body: { results: [mrvHit] } } : { status: 404, body: {} })
  calls = []
  eq(await svc.lookup("mrv", "71-1234", 20), [mrvHit])
  eq(callsTo("/atms/withdraw/mr/search")[0].query.get("q"), "71-1234")
  eq(callsTo("/atms/withdraw/mr/search")[0].query.get("limit"), "5") // ขอ 20 ก็ยัง 5
  eq(svc.lookupKind("mrv"), "mrv")
  await mkReq("SW-PR1", "NEW", { type: "pr", code: "LBPR26100561", id: 777 }, [{ skuCode: "A-1", requestedQty: 3 }])
  await mkReq("SW-PR2", "NEW", { type: "po", code: "LBPR26100561", id: null }, [{ skuCode: "A-1", requestedQty: 9 }]) // คนละชนิด ไม่นับ
  handler = (c) => {
    if (c.path === "/atms/withdraw/doc/pr/777") return { status: 200, body: poDoc([
      line({ sku_code: "A-1", sku_name: "A-1 : น็อต", amount: 4, received: 0, remaining: 4 }),
      line({ sku_code: "LB00269", sku_name: "LB00269 : ค่าแรง", group: "ค่าแรง", is_labour: true, amount: 1, received: 0 }),
      line({ sku_code: "LB00270", sku_name: "LB00270 : ค่าแรง 2", group: "ค่าแรง", is_labour: true, amount: 1, received: 0 }),
      line({ sku_code: "B-2", sku_name: "B-2 : สลัก", amount: 2, received: 0 }),
    ], { id: 777, kind: "pr", code: "LBPR26100561", supplier: "" }) }
    return { status: 404, body: { detail: "nf" } }
  }
  calls = []
  const pr = await svc.getDocDetail("pr", 777, 4)
  eq(pr.doc.kind, "pr")
  eq(pr.lines.map((l) => l.skuCode), ["A-1", "B-2"]) // ค่าแรงถูกตัดทิ้งฝั่งเซิร์ฟเวอร์
  eq(pr.lines.map((l) => [l.docQty, l.receivedQty, l.qty, l.isLabour]), [[4, 0, 4, false], [2, 0, 2, false]]) // qty ตั้งต้น = จำนวนที่ขอ
  eq(pr.lines[0].alreadyCut, 3); eq(pr.lines[0].cutBy, ["SW-PR1"]) // alreadyCut นับเฉพาะ ref.type=pr
  eq(pr.warnings, ["ข้ามบรรทัดค่าแรง 2 รายการ (นำเข้าเฉพาะอะไหล่)", "บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว"]) // ไม่มี "ยังไม่ได้รับของ"
  eq(callsTo("/atms/withdraw/lookup/sku").length, 0) // ไม่เสียโควตาค้น SKU ให้บรรทัดค่าแรง
  // PO ยังเก็บค่าแรงไว้เหมือนเดิม (ทดสอบข้างบนแล้ว) · PR ไม่มีค่าแรง = ไม่มีคำเตือนข้าม
  handler = (c) => c.path === "/atms/withdraw/doc/pr/778" ? { status: 200, body: poDoc([line({ sku_code: "A-1", amount: 1, received: 0 })], { id: 778, kind: "pr", code: "LBPR2" }) } : { status: 404, body: {} }
  eq((await svc.getDocDetail("pr", 778, 4)).warnings, [])

  // ---- เพดาน 25 ครั้ง ----
  const many = Array.from({ length: 30 }, (_, i) => line({ sku_code: `Z-${i}`, sku_name: `Z-${i} : ของ ${i}` }))
  handler = (c) => c.path === "/atms/withdraw/doc/po/1" ? { status: 200, body: poDoc(many, { id: 1, code: "LBPO-MANY" }) } : c.path === "/atms/withdraw/lookup/sku" ? { status: 200, body: { results: [{ id: 7000 + Number(c.query.get("q")!.slice(2)), code: c.query.get("q") }] } } : { status: 404, body: {} }
  calls = []
  const m = await svc.getDocDetail("po", 1)
  eq(callsTo("/atms/withdraw/lookup/sku").length, svc.DOC_SKU_LOOKUP_CAP); eq(svc.DOC_SKU_LOOKUP_CAP, 25)
  eq(m.lines.filter((l) => l.skuId != null).length, 25); eq(m.lines[29].skuId, null)
  assert.ok(m.warnings.some((w) => w.includes("ไม่ครบ")))
  // รหัสซ้ำในใบเดียวถามครั้งเดียว
  calls = []
  handler = (c) => c.path === "/atms/withdraw/doc/dd/2" ? { status: 200, body: poDoc([line({ sku_code: "Q-1", amount: 1, received: 1 }), line({ sku_code: "Q-1", amount: 2, received: 2 })], { id: 2, kind: "dd", code: "LBDD1", po: "LBPO26100704" }) } : { status: 200, body: { results: [{ id: 8800, code: "Q-1" }] } }
  const dd = await svc.getDocDetail("dd", 2, 4)
  eq(callsTo("/atms/withdraw/lookup/sku").length, 1)
  eq(dd.lines.map((l) => [l.skuId, l.qty]), [[8800, 1], [8800, 2]])
  eq(dd.doc.po, "LBPO26100704")
  // DD: received ไม่มี → ใช้ amount (จำนวนในใบ)
  handler = (c) => c.path === "/atms/withdraw/doc/dd/3" ? { status: 200, body: poDoc([line({ sku_code: "A-1", amount: 6, received: undefined, remaining: null })], { id: 3, kind: "dd", code: "LBDD3" }) } : { status: 200, body: { results: [] } }
  const dd3 = await svc.getDocDetail("dd", 3, 4)
  eq([dd3.lines[0].docQty, dd3.lines[0].receivedQty, dd3.lines[0].qty], [6, 6, 6]); eq(dd3.warnings, [])
  // PO ที่ยังไม่รับเลยทั้งใบ
  handler = (c) => c.path === "/atms/withdraw/doc/po/4" ? { status: 200, body: poDoc([line({ sku_code: "A-1", amount: 3, received: 0 })], { id: 4 }) } : { status: 404, body: {} }
  assert.ok((await svc.getDocDetail("po", 4, 4)).warnings.includes("ใบนี้ยังไม่ได้รับของ"))
  // ATMS ล่มระหว่างค้น SKU: ไม่ล้มทั้งใบ
  handler = (c) => c.path === "/atms/withdraw/doc/po/5" ? { status: 200, body: poDoc([line({ sku_code: "N-1" }), line({ sku_code: "N-2" })], { id: 5 }) } : { status: 500, body: {} }
  calls = []
  const down = await svc.getDocDetail("po", 5, 4)
  eq(down.lines.map((l) => l.skuId), [null, null]); eq(callsTo("/atms/withdraw/lookup/sku").length, 1) // พลาดครั้งแรกแล้วหยุดถาม
  // 404 / 401 / 403
  handler = () => ({ status: 404, body: { detail: "nf" } })
  eq(await status(svc.getDocDetail("po", 999)), 404)
  handler = () => ({ status: 401, body: {} })
  eq(await status(svc.getDocDetail("po", 999)), 502)

  // ---- createRequest เก็บ ref ----
  handler = (c) => c.path === "/atms/withdraw/options" ? { status: 200, body: { inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "ซ่อมรถ" }] } } : { status: 404, body: {} }
  const body = (ref?: unknown) => ({ kind: "stock", inventoryId: 4, pickToId: 7, plate: "70-1234", mrCode: "MR-1", remark: "ด่วน", ref, lines: [{ skuId: 501, skuCode: "A-1", skuName: "A-1 : น็อต", requestedQty: 1 }] })
  const r1 = await svc.createRequest(body({ type: "po", code: " LBPO26100704 ", id: 157902 }), actor)
  eq(r1.ref, { type: "po", code: "LBPO26100704", id: 157902 })
  eq((await sw.findOne({ no: r1.no }))!.ref, { type: "po", code: "LBPO26100704", id: 157902 })
  eq((await svc.createRequest(body(), actor)).ref, null)
  eq((await sw.findOne({ no: (await svc.createRequest(body(null), actor)).no }))!.ref, null)
  for (const bad of [{ type: "xx", code: "LBPO123" }, { type: "po", code: "" }, { type: "po", code: "  " }, "LBPO123"]) eq(await status(svc.createRequest(body(bad), actor)), 400)
  eq(withRef({ a: 1 } as { a: number; ref?: never }).ref, null)

  // ---- ref ชนิด pr เก็บได้ · workType: อนุมานจาก kind / map ไป kind / ขัดกัน = 400 / withRef ใบเก่า ----
  const rp = await svc.createRequest(body({ type: "pr", code: "LBPR26100561", id: 777 }), actor)
  eq(rp.ref, { type: "pr", code: "LBPR26100561", id: 777 })
  eq((await sw.findOne({ no: rp.no }))!.ref, { type: "pr", code: "LBPR26100561", id: 777 })
  // mobile_pm ต้องมีกำหนดสรุปยอด (งานอื่นไม่สนใจ field นี้)
  const wtBody = (o: Json) => ({ ...body(), kind: undefined, summaryDueAt: new Date(Date.now() + 86_400_000).toISOString(), ...o })
  eq([r1.kind, r1.workType], ["stock", "garage_in"]) // ไม่ส่ง workType: stock → อู่ใน
  eq((await svc.createRequest({ ...body(), kind: "cutoff" }, actor)).workType, "garage_out")
  for (const [w, k] of [["garage_in", "stock"], ["garage_out", "cutoff"], ["mobile_pm", "stock"]] as const) {
    const a = await svc.createRequest(wtBody({ workType: w }), actor) // ส่งแต่ workType
    eq([a.workType, a.kind], [w, k])
    eq((await sw.findOne({ no: a.no }))!.workType, w) // เก็บลง DB
    const b = await svc.createRequest(wtBody({ workType: w, kind: k }), actor) // ส่งคู่ที่ตรงกัน
    eq([b.workType, b.kind], [w, k])
  }
  for (const bad of [{ workType: "garage_in", kind: "cutoff" }, { workType: "garage_out", kind: "stock" }, { workType: "mobile_pm", kind: "cutoff" }, { workType: "xx" }, { workType: 5 }, {}, { kind: "foo" }]) {
    eq(await status(svc.createRequest(wtBody(bad), actor)), 400)
  }
  try { await svc.createRequest(wtBody({ workType: "garage_in", kind: "cutoff" }), actor) } catch (e) { assert.ok(/อู่ใน/.test((e as Error).message), "ข้อความไทยบอกประเภทงาน") }
  // ใบเก่าไม่มี workType → withRef อนุมานให้
  eq(withRef({ kind: "stock" as const }).workType, "garage_in")
  eq(withRef({ kind: "cutoff" as const }).workType, "garage_out")
  eq(withRef({ kind: "cutoff" as const, workType: "mobile_pm" as const }).workType, "mobile_pm")
  await sw.insertOne({ ...(await sw.findOne({ no: r1.no }, { projection: { _id: 0 } }))!, no: "SW-OLD", workType: undefined } as never)
  await sw.updateOne({ no: "SW-OLD" }, { $unset: { workType: "" } })
  assert.ok(!("workType" in (await sw.findOne({ no: "SW-OLD" }))!))
  const q = await svc.buildQueue(4)
  eq(q.NEW.find((x) => x.no === "SW-OLD")!.workType, "garage_in")

  // ---- remark ส่ง ATMS มีเลขใบ · remark_token ไม่เปลี่ยน ----
  await saveCreds(store.email, "atms.user", "pw", { username: "atms.user", branch: "x", name: "x" })
  const send = async (no: string) => {
    await sw.updateOne({ no }, { $set: { status: "READY" } })
    calls = []
    handler = () => ({ status: 200, body: { progress: { gm_id: 1, done: [0], approved: true, code: "WD-1" } } })
    await issueRequest(no, store)
    return callsTo("/atms/withdraw/issue")[0].body!
  }
  const withRefSent = await send(r1.no)
  eq(withRefSent.remark, "MR-1 LBPO26100704 70-1234 ด่วน"); eq(withRefSent.remark_token, r1.no)
  const noRef = await svc.createRequest(body(), actor)
  const noRefSent = await send(noRef.no)
  eq(noRefSent.remark, "MR-1 70-1234 ด่วน"); eq(noRefSent.remark_token, noRef.no)

  await client.db("sw_docref_test").dropDatabase()
  await client.db("master_data_test").dropDatabase()
  await client.close()
  await mongod.stop()
  globalThis.fetch = realFetch
  console.log("check-store-withdraw-docref: all passed")
}
main().catch((e) => { console.error(e); process.exit(1) })
