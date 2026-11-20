// scripts/check-hub-api.ts — API หน้า Hub สโตร์ (ตรรกะใน hub-api.ts) + สิทธิ์ store-hub
// รัน: npx tsx scripts/check-hub-api.ts  (Mongo ในเครื่องผ่าน mongodb-memory-server)
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import type { NextResponse } from "next/server"

process.env.STORE_WITHDRAW_DB = "hub_api_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const actor = { email: "store@x.co", name: "คลัง", via: "web" as const }
const q = (s: string) => new URLSearchParams(s)
const run = async (f: () => Promise<NextResponse>) => {
  try { const r = await f(); return { status: r.status, body: await r.json() } }
  catch (e) { return { status: (e as { status?: number }).status ?? (e instanceof Error && e.name === "ConflictError" ? 409 : 500), body: { error: (e as Error).message } } }
}

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const { setStoreWithdrawClient } = await import("../lib/store-withdraw/db")
  setStoreWithdrawClient(client)
  const a = await import("../lib/store-withdraw/hub-api")
  const h = await import("../lib/store-withdraw/hub-db")
  const cols = await h.hubCols()

  // ตั้งค่า: site/vendor ผ่าน master API
  eq((await run(() => a.hubMasterWrite("PUT", q("type=sites"), { inventoryId: 4, atmsHubInventoryId: 99 }, actor))).status, 200)
  eq((await run(() => a.hubMasterWrite("PUT", q("type=sites"), { inventoryId: -1, atmsHubInventoryId: 99 }, actor))).status, 400)
  eq((await run(() => a.hubMasterWrite("PUT", q("type=sites"), { inventoryId: 4.5, atmsHubInventoryId: 99 }, actor))).status, 400)
  eq((await run(() => a.hubMasterWrite("POST", q("type=vendors"), { code: "V1", name: "อู่หนึ่ง" }, actor))).status, 200)
  eq((await run(() => a.hubMasterWrite("POST", q("type=vendors"), { code: "V2", name: "อู่สอง" }, actor))).status, 200)
  eq((await run(() => a.hubMasterWrite("POST", q("type=vendors"), { code: "", name: "x" }, actor))).status, 400)
  eq((await run(() => a.hubMasterWrite("PATCH", q("type=vendors"), { code: "V2", active: false }, actor))).status, 200)
  eq((await run(() => a.hubMasterWrite("PATCH", q("type=vendors"), { code: "ZZ", active: false }, actor))).status, 404)
  eq((await run(() => a.hubMasterGet(q("type=vendors")))).body.rows.map((v: { code: string; active: boolean }) => [v.code, v.active]), [["V1", true], ["V2", false]])
  eq((await run(() => a.hubMasterGet(q("type=sites")))).body.rows, [{ inventoryId: 4, atmsHubInventoryId: 99, active: true }])
  eq((await run(() => a.hubMasterGet(q("")))).status, 400)
  // ประวัติแก้ master (6.9): ทุกการแก้ที่สำเร็จลง hub_master_log ค่าก่อน/หลัง + ผู้แก้ · ที่ล้มไม่ลง
  const mlog = async (type: string, key: string) => (await cols.masterLog.find({ type, key }, { projection: { _id: 0 } }).sort({ at: 1 }).toArray())
  const sl = await mlog("sites", "4")
  eq(sl.length, 1); eq(sl[0].before, null); eq(sl[0].after, { inventoryId: 4, atmsHubInventoryId: 99, active: true }); eq(sl[0].by, { email: actor.email, name: actor.name }); assert.ok(sl[0].at instanceof Date)
  const vl = await mlog("vendors", "V2")
  eq(vl.length, 2); eq(vl[0].before, null); eq((vl[0].after as { name: string }).name, "อู่สอง")
  eq([(vl[1].before as { active: boolean }).active, (vl[1].after as { active: boolean }).active], [true, false])
  eq((await mlog("vendors", "ZZ")).length, 0)
  eq(await cols.masterLog.countDocuments({ type: "sites" }), 1) // PUT ที่ 400 ไม่ลง

  const line = { skuId: 501, skuCode: "S501", skuName: "น้ำมันเครื่อง", unit: "ลิตร", price: 120, qty: 10 }
  const rcv = (b: Record<string, unknown>) => run(() => a.hubReceiveHandler(b, actor))
  const base = { inventoryId: 4, vendorCode: "V1", refNo: "DO-1", lines: [line] }

  // receive แล้ว stock เพิ่ม
  let r = await rcv(base)
  eq(r.status, 200); eq(r.body.moves.length, 1)
  eq((await run(() => a.hubStockHandler(q("inventoryId=4&vendorCode=V1")))).body.rows.map((x: { skuId: number; qty: number }) => [x.skuId, x.qty]), [[501, 10]])
  // เลขเอกสารซ้ำ → 409 ยอดไม่เพิ่ม · Sub อื่นใช้เลขเดียวกันได้ (ถ้า active)
  r = await rcv(base); eq(r.status, 409); assert.match(r.body.error, /รับเข้าแล้ว/)
  eq((await cols.stock.findOne({ skuId: 501 }))?.qty, 10)
  // กดสองที พร้อมกัน → สำเร็จครั้งเดียว ยอดนับครั้งเดียว
  const par = { ...base, refNo: "DO-PAR", lines: [{ ...line, skuId: 601, skuCode: "P601", skuName: "ผ้าเบรก", qty: 3 }] }
  const pr = await Promise.all([rcv(par), rcv(par), rcv(par)])
  eq(pr.map((x) => x.status).sort(), [200, 409, 409])
  eq((await cols.stock.findOne({ skuId: 601 }))?.qty, 3)
  // พังกลางทาง (บรรทัด 2) → ลองใหม่ → ยอดเท่ารับครบหนึ่งครั้ง
  const two = { ...base, refNo: "DO-FAIL", lines: [{ ...line, skuId: 701, skuCode: "F701", skuName: "ไส้กรอง", qty: 4 }, { ...line, skuId: 702, skuCode: "F702", skuName: "สายพาน", qty: 6 }] }
  const { Collection } = await import("mongodb")
  const orig = Collection.prototype.updateOne
  let boom = true
  Collection.prototype.updateOne = function (this: InstanceType<typeof Collection>, f: never, ...rest: never[]) {
    if (boom && this.collectionName === "hub_stock" && (f as { skuId?: number }).skuId === 702) { boom = false; return Promise.reject(new Error("db down")) }
    return (orig as (...a: unknown[]) => Promise<never>).call(this, f, ...rest)
  } as never
  const bad = await rcv(two)
  Collection.prototype.updateOne = orig
  eq(bad.status, 500)
  const again = await rcv(two)
  eq(again.status, 200)
  eq([(await cols.stock.findOne({ skuId: 701 }))?.qty, (await cols.stock.findOne({ skuId: 702 }))?.qty], [4, 6])
  eq((await rcv(two)).status, 409)
  eq(await cols.moves.countDocuments({ refNo: "DO-FAIL", type: "receive" }), 2)
  // validation
  eq((await rcv({ ...base, vendorCode: "V2", refNo: "DO-2" })).status, 400) // vendor ไม่ active
  eq((await rcv({ ...base, vendorCode: "ZZ", refNo: "DO-2" })).status, 400)
  eq((await rcv({ ...base, inventoryId: 9, refNo: "DO-3" })).status, 400) // คลังไม่มี site
  eq((await rcv({ ...base, refNo: "" })).status, 400)
  eq((await rcv({ ...base, refNo: "x".repeat(41) })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-4", lines: [] })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-4", lines: [{ ...line, qty: 0 }] })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-4", lines: [{ ...line, qty: -2 }] })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-4", lines: [{ ...line, qty: "5" }] })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-4", lines: [line, line] })).status, 400) // sku ซ้ำ
  eq((await rcv({ ...base, refNo: "DO-4", lines: Array.from({ length: 101 }, (_, i) => ({ ...line, skuId: 1000 + i, skuCode: `B${i}`, skuName: `ของ${i}` })) })).status, 400)
  eq((await rcv({ ...base, refNo: "DO-5", lines: Array.from({ length: 100 }, (_, i) => ({ ...line, skuId: 1000 + i, skuCode: `B${i}`, skuName: `ของ${i}` })) })).status, 200)
  eq((await cols.stock.findOne({ skuId: 501 }))?.qty, 10) // ที่ผิดไม่แตะยอด

  // items: ค้นเจอ / ไม่มี site → enabled false / ไม่ใส่คำค้น
  let it = await run(() => a.hubItemsHandler(q("inventoryId=4&q=น้ำมัน")))
  eq(it.body.enabled, true)
  eq(it.body.results, [{ skuId: 501, skuCode: "S501", skuName: "น้ำมันเครื่อง", unit: "ลิตร", vendorCode: "V1", vendorName: "อู่หนึ่ง", qty: 10 }])
  it = await run(() => a.hubItemsHandler(q("inventoryId=9&q=น้ำมัน")))
  eq(it.body, { results: [], enabled: false })
  eq((await run(() => a.hubItemsHandler(q("q=x")))).status, 400)
  eq((await run(() => a.hubItemsHandler(q("inventoryId=4&q=ไม่มีของนี้")))).body.results, [])
  // regex ในคำค้นไม่พัง
  eq((await run(() => a.hubItemsHandler(q("inventoryId=4&q=(")))).status, 200)

  // master items PATCH
  const pt = (b: Record<string, unknown>) => run(() => a.hubMasterWrite("PATCH", q("type=items"), b, actor))
  eq((await pt({ inventoryId: 4, vendorCode: "V1", skuId: 501, price: 99, unit: "แกลลอน", active: false })).status, 200)
  const it2 = await cols.items.findOne({ skuId: 501 })
  eq([it2?.price, it2?.unit, it2?.active], [99, "แกลลอน", false])
  const il = await mlog("items", "4|V1|501")
  eq(il.length, 1); eq([(il[0].after as { price: number }).price, (il[0].after as { unit: string }).unit], [99, "แกลลอน"])
  assert.notEqual((il[0].before as { price: number }).price, 99)
  eq((await pt({ inventoryId: 4, vendorCode: "V1", skuId: 777 })).status, 404)
  eq((await pt({ inventoryId: 4, vendorCode: "V1", skuId: 501, price: -1 })).status, 400)
  eq((await run(() => a.hubItemsHandler(q("inventoryId=4&q=น้ำมัน")))).body.results, []) // ปิดแล้วไม่ขึ้นในฟอร์ม
  eq((await run(() => a.hubMasterGet(q("type=items&inventoryId=4&vendorCode=V1")))).body.rows.length, 104) // master เห็นทั้งหมด

  // moves + xlsx
  const mv = await a.hubMovesRows(q("vendorCode=V1&skuId=501"))
  eq(mv.length, 1); eq([mv[0].skuCode, mv[0].vendorName], ["S501", "อู่หนึ่ง"])
  const buf = await a.hubMovesXlsx(mv)
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never)
  const ws = wb.worksheets[0]
  eq((ws.getRow(1).values as unknown[]).slice(1), ["วันที่", "ประเภท", "Sub", "รหัส", "จำนวน", "เลขอ้างอิง", "โดย"])
  eq([ws.getRow(2).getCell(2).value, ws.getRow(2).getCell(5).value, ws.getRow(2).getCell(6).value], ["รับเข้า", 10, "DO-1"])
  eq(Object.values(a.MOVE_LABEL), ["รับเข้า", "จ่ายออก", "คืนเข้า", "ปรับยอด"])
  await assert.rejects(a.hubMovesRows(q("from=ไม่ใช่วัน")))

  // ── สิทธิ์ ──
  const { checkRequest, sectionForApi, sectionForPage, SECTIONS, SECTION_LABELS, accessFor } = await import("../lib/access-policy")
  assert.ok((SECTIONS as readonly string[]).includes("store-hub"))
  eq(SECTION_LABELS["store-hub"], "อะไหล่ Hub (สโตร์)")
  eq([sectionForApi("/api/store-withdraw/hub/receive"), sectionForApi("/api/store-withdraw/hub/stock"), sectionForApi("/api/store-withdraw/hub/master"), sectionForApi("/api/store-withdraw/hub/moves"), sectionForApi("/api/store-withdraw/hub/items"), sectionForPage("/store-withdraw/hub")],
    ["store-hub", "store-hub", "store-hub", "store-hub", "store-withdraw", "store-hub"])
  for (const dept of ["ยานยนต์", "Procurement", "Accounting", "Chief-Level", "Information Technology", null]) {
    const acc = accessFor({ department: dept, email: "someone@menatransport.co.th" })
    if (dept !== "Information Technology") eq(acc["store-hub"], "none", String(dept))
  }
  const chk = (access: ReturnType<typeof accessFor>, pathname: string, method: string) => checkRequest({ pathname, method, access, isSuperAdmin: false }).ok
  const plain = accessFor({ department: "ยานยนต์", email: "a@menatransport.co.th" }) // store-withdraw edit, store-hub none
  const store = accessFor({ department: "ยานยนต์", email: "a@menatransport.co.th", overrides: { "store-queue": "edit" } })
  const hubView = accessFor({ department: "ยานยนต์", email: "a@menatransport.co.th", overrides: { "store-hub": "view" } })
  const hubEdit = accessFor({ department: "ยานยนต์", email: "a@menatransport.co.th", overrides: { "store-hub": "edit" } })
  eq(chk(plain, "/api/store-withdraw/hub/receive", "POST"), false)
  eq(chk(plain, "/api/store-withdraw/hub/stock", "GET"), false)
  eq(chk(plain, "/store-withdraw/hub", "GET"), false)
  eq(chk(plain, "/api/store-withdraw/hub/items", "GET"), true) // คนยื่นค้นในฟอร์มได้
  eq(chk(store, "/api/store-withdraw/hub/stock", "GET"), false) // คิวสโตร์อย่างเดียวไม่ผ่านทางลัดอ่าน
  eq(chk(store, "/api/store-withdraw/hub/master", "GET"), false)
  eq(chk(store, "/api/store-withdraw/hub/items", "GET"), true)
  eq(chk(hubView, "/api/store-withdraw/hub/stock", "GET"), true)
  eq(chk(hubView, "/api/store-withdraw/hub/moves", "GET"), true)
  eq(chk(hubView, "/api/store-withdraw/hub/receive", "POST"), false)
  eq(chk(hubView, "/api/store-withdraw/hub/master", "PUT"), false)
  eq(chk(hubEdit, "/api/store-withdraw/hub/receive", "POST"), true)
  eq(chk(hubEdit, "/api/store-withdraw/hub/master", "PATCH"), true)
  eq(chk(hubEdit, "/store-withdraw/hub", "GET"), true)
  // ไม่มี store-withdraw แต่มี store-hub: items ยังไม่ผ่าน (ต้องมีสิทธิ์ยื่น)
  const hubOnly = accessFor({ department: "Accounting", email: "a@menatransport.co.th", overrides: { "store-hub": "edit", "store-withdraw": "none" } })
  eq(chk(hubOnly, "/api/store-withdraw/hub/items", "GET"), false)

  await client.close(); await mongod.stop()
  console.log("check-hub-api: ok")
}
main().catch((e) => { console.error(e); process.exit(1) })
