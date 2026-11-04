// scripts/check-core-return.ts — รัน: npx tsx scripts/check-core-return.ts  (Mongo ในเครื่องเท่านั้น · ไม่แตะ cluster จริง)
// ครอบ: สถานะ + ตัวกัน (409/400) · legacy = pending · แข่งกันคืน · โซ่แฮช · ตัวกรอง/ค้นหา/สรุป/กลุ่ม · ตามงาน · รอบขายซาก · Excel · ตะขอใบเบิก WMS
import assert from "node:assert/strict"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.CORE_RETURN_DB = "core_return_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง

const eq = assert.deepEqual
const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number; message?: string }) => e.status ?? -1)
const veh = { email: "mech@menatransport.co.th", name: "ช่างยานยนต์", via: "web" as const }
const store = { email: "store@menatransport.co.th", name: "สโตร์", via: "web" as const }
const proc = { email: "buyer@menatransport.co.th", name: "จัดซื้อ", via: "web" as const }

// แถวรูปเดียวกับ load_base.py
const base = (row_key: string, o: Record<string, unknown> = {}) => ({
  row_key, issuedDate: "2026-10-01", yearMonth: "2026-10", warehouse: "คลังลาดกระบัง", wdCode: "LBWD26100001", mrCode: "LBMR26090001",
  purpose: "ซ่อม", skuCode: "LB04BS00094", skuName: "จานกดคลัช 17 นิ้ว(ฮีโน่500)", productGroup: "ระบบเบรคคลัทช์", vehicleNo: "TH1354",
  plate: "สบ.71-4018", driver: "สุภาพ", serialNo: null, qtyIssued: 2, unitCost: 4600, amount: 9200, remark: null, source: "atms.stockmovement_v5",
  legacySheet: null, legacyRound: null, legacyNote: null, coreStatus: "pending", coreQtyReturned: 0, createdAt: new Date(), loadedAt: new Date(), ...o,
})

void (async () => {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  try {
    const { setCoreReturnClient, logCol, baseCol } = await import("../lib/core-return/db")
    setCoreReturnClient(client)
    const svc = await import("../lib/core-return/service")
    const core = await import("../lib/core-return/core")
    const rounds = await import("../lib/core-return/rounds")
    const excel = await import("../lib/core-return/excel")
    const col = await baseCol()
    // ตัวที่ loader สร้างไว้แล้ว (สเปกเดียวกัน) — ensureIndexes ต้องไม่ชน
    await client.db("core_return_test").collection("core_return_base").createIndex({ row_key: 1 }, { unique: true })
    await col.insertMany([
      base("p1"), base("p2"), base("p3", { qtyIssued: 1, amount: 4600 }),
      base("lg1", { coreStatus: "legacy", legacySheet: "อะไหล่อู่นอก", legacyRound: "อู่นอกรอบ26.02-04.03.25", legacyNote: "เดิม" }),
      base("s1", { warehouse: "คลังสระบุรี", plate: "70-1234", vehicleNo: "ME243", wdCode: "SRWD26100099", mrCode: "SRMR26100001", skuCode: "SR01X", skuName: "ไดชาร์จ", issuedDate: "2026-09-01", amount: 1500 }),
      base("old", { issuedDate: "2026-08-01", amount: 100 }),
    ] as never[])
    const now = new Date("2026-11-03T05:00:00Z")

    // ── 1. คืนซาก: ตัวกัน ───────────────────────────────────────────────
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 2 }, veh, now)), 400, "S1 ไม่มีวันที่เข้าคลังซาก")
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 3, scrapInDate: "2026-10-05" }, veh, now)), 400, "qty > ที่เบิก")
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 0, scrapInDate: "2026-10-05" }, veh, now)), 400, "qty 0")
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 1, scrapInDate: "2026-10-05" }, veh, now)), 400, "คืนไม่ครบต้องมีเหตุผล")
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 2, scrapInDate: "2026-12-01" }, veh, now)), 400, "วันที่ในอนาคต")
    eq(await status(svc.returnCore("p1", { choice: "sell", qty: 2, scrapInDate: "2026-09-01" }, veh, now)), 400, "ก่อนวันที่เบิก")
    eq(await status(svc.returnCore("p1", { choice: "bogus" }, veh, now)), 400)
    eq(await status(svc.returnCore("p1", { choice: "no_core" }, veh, now)), 400, "ไม่มีซากต้องมีเหตุผล")
    eq(await status(svc.returnCore("p1", { choice: "no_core", noCoreReason: "อื่นๆ" }, veh, now)), 400, "อื่นๆ ต้องมีหมายเหตุ")
    eq(await status(svc.returnCore("nope", { choice: "rebuild" }, veh, now)), 404)
    // ไม่มีซากคืน (missing): ต้องมีเหตุผล · ไม่มีจำนวน · เก็บเหตุผลใน noCore เหมือน S2
    {
      const core = await import("../lib/core-return/core")
      const rowP = { qtyIssued: 2, issuedDate: "2026-10-01" }
      assert.throws(() => core.parseReturn({ choice: "missing" }, rowP, now), /ไม่มีซากคืน/)
      assert.throws(() => core.parseReturn({ choice: "missing", noCoreReason: "อื่นๆ" }, rowP, now), /หมายเหตุ/)
      eq(core.parseReturn({ choice: "missing", noCoreReason: "อู่ไม่คืนซาก" }, rowP, now).qty, 0)
      eq(core.CHOICE_TO.missing, "missing")
      eq(core.isStatus("missing"), true)
    }
    // sold/rebuilt จากสถานะผิด
    eq(await status(svc.markSold("p1", { soldDate: "2026-11-01" }, store, now)), 409, "sold ได้จาก sell_waiting เท่านั้น")
    eq(await status(svc.markRebuilt("p1", { rebuiltDate: "2026-11-01" }, store, now)), 409, "rebuilt ได้จาก rebuild เท่านั้น")

    // คืนไม่ครบ + เหตุผล → sell_waiting
    const r1 = await svc.returnCore("p1", { choice: "sell", qty: 1, shortReason: "อีกลูกแตก ทิ้งที่อู่", scrapInDate: "2026-10-05", note: "เข้าคลังซากหลังร้าน" }, veh, now)
    eq([r1?.coreStatus, r1?.coreQtyReturned, r1?.sale?.scrapInDate, r1?.ret?.shortReason], ["sell_waiting", 1, "2026-10-05", "อีกลูกแตก ทิ้งที่อู่"])
    eq(await status(svc.returnCore("p1", { choice: "rebuild" }, veh, now)), 409, "คืนซ้ำ")
    eq(await status(svc.markRebuilt("p1", { rebuiltDate: "2026-11-01" }, store, now)), 409)
    eq(await status(svc.markSold("p1", { soldDate: "2026-10-01" }, store, now)), 400, "ขายก่อนเข้าคลังซาก")
    const sold = await svc.markSold("p1", { soldDate: "2026-11-01", price: "350", buyer: "ร้านรับซื้อของเก่า" }, store, now)
    eq([sold?.coreStatus, sold?.sale?.price, sold?.sale?.buyer, sold?.sale?.scrapInDate], ["sold", 350, "ร้านรับซื้อของเก่า", "2026-10-05"])
    eq(await status(svc.markSold("p1", { soldDate: "2026-11-01" }, store, now)), 409, "ขายซ้ำ")

    // qty ไม่ส่ง = เท่าที่เบิก · Rebuild → Rebuild เสร็จ
    const r2 = await svc.returnCore("p2", { choice: "rebuild", rebuildVendor: "อู่ศรีสมบูรณ์", rebuildSentDate: "2026-10-10" }, veh, now)
    eq([r2?.coreStatus, r2?.coreQtyReturned, r2?.rebuild?.vendor], ["rebuild", 2, "อู่ศรีสมบูรณ์"])
    eq(await status(svc.markRebuilt("p2", { rebuiltDate: "2026-10-09" }, store, now)), 400, "เสร็จก่อนส่ง")
    eq(await status(svc.markRebuilt("p2", {}, store, now)), 400, "ต้องมีวันที่เสร็จ")
    const rb = await svc.markRebuilt("p2", { rebuiltDate: "2026-10-20", note: "ใช้ต่อได้" }, store, now)
    eq([rb?.coreStatus, rb?.rebuild?.doneDate, rb?.rebuild?.vendor], ["rebuilt", "2026-10-20", "อู่ศรีสมบูรณ์"])

    // legacy ทำงานเหมือน pending
    const lg = await svc.returnCore("lg1", { choice: "no_core", noCoreReason: "ของสิ้นเปลือง" }, veh, now)
    eq([lg?.coreStatus, lg?.noCore?.reason, lg?.coreQtyReturned, lg?.legacyRound], ["no_core", "ของสิ้นเปลือง", 0, "อู่นอกรอบ26.02-04.03.25"])

    // ── 2. แข่งกันคืนพร้อมกัน → ชนะตัวเดียว ─────────────────────────────
    const race = await Promise.allSettled([
      svc.returnCore("p3", { choice: "sell", scrapInDate: "2026-10-06" }, veh, now),
      svc.returnCore("p3", { choice: "rebuild" }, store, now),
      svc.returnCore("p3", { choice: "sell", scrapInDate: "2026-10-07" }, store, now),
    ])
    // ผู้ชนะสุ่มได้ — ทุกทางเลือกในชุดนี้ต้องไม่ไปกระทบตัวนับสรุปข้างล่าง (no_core นับในสรุป จึงไม่ใส่ไว้ในการแข่ง)
    eq(race.filter((r) => r.status === "fulfilled").length, 1, "ชนะตัวเดียว")
    for (const r of race) if (r.status === "rejected") eq((r.reason as { status: number }).status, 409)
    eq(await (await logCol()).countDocuments({ row_key: "p3", action: "return" }), 1)

    // ── 3. ตามงาน ───────────────────────────────────────────────────────
    eq(await status(svc.followUp("s1", { note: "" }, proc, now)), 400)
    eq(await status(svc.followUp("s1", { note: "x", nextDate: "2026-10-01" }, proc, now)), 400, "วันตามย้อนหลัง")
    eq(await status(svc.followUp("p1", { note: "ขายไปแล้ว" }, proc, now)), 409, "จบแล้วไม่ต้องตาม")
    await svc.followUp("s1", { note: "โทรหาหัวหน้าช่าง สระบุรี", nextDate: "2026-11-03" }, proc, now)
    const f2 = await svc.followUp("s1", { note: "ตามซ้ำ ยังไม่ได้ส่ง", nextDate: "2026-11-03" }, store, now)
    eq([f2?.followUp?.count, f2?.followUp?.lastNote, f2?.coreStatus], [2, "ตามซ้ำ ยังไม่ได้ส่ง", "pending"])
    eq(core.followUpText(f2?.followUp ?? null), "ตามแล้ว 2 ครั้ง · ล่าสุด 03/11")

    // ── 4. โซ่ประวัติ ────────────────────────────────────────────────────
    const d1 = await svc.getRow("p1")
    eq(d1.history.map((h) => h.action), ["return", "sold"])
    eq([d1.chain.ok, d1.chain.checked], [true, 2])
    const ds = await svc.getRow("s1")
    eq(ds.history.map((h) => [h.action, h.seq]), [["follow_up", 1], ["follow_up", 2]])
    eq(ds.chain.ok, true)
    // แก้ประวัติย้อนหลัง → โซ่ฟ้อง
    await (await logCol()).updateOne({ row_key: "p1", seq: 1 }, { $set: { note: "แก้ทีหลัง" } })
    const tampered = await svc.getRow("p1")
    eq([tampered.chain.ok, tampered.chain.brokenAt], [false, 1])

    // ── 5. ตัวกรอง / ค้นหา / สรุป / กลุ่ม ─────────────────────────────────
    const q = (o: Record<string, string>) => core.parseFilters(new URLSearchParams(o))
    eq((await svc.list(q({ q: "สบ 71 4018" }), 1, now)).total, 5, "ทะเบียนไม่สนขีด/ช่องว่าง")
    eq((await svc.list(q({ q: "70-1234" }), 1, now)).items.map((r) => r.row_key), ["s1"])
    eq((await svc.list(q({ q: "srwd26100099" }), 1, now)).items.map((r) => r.row_key), ["s1"], "WD ไม่สนตัวพิมพ์")
    eq((await svc.list(q({ q: "me 243" }), 1, now)).total, 1, "เบอร์รถ")
    await col.insertOne(base("num1", { vehicleNo: 6616, plate: "สบ.72-8498", coreStatus: "no_core" }) as never)
    eq((await svc.list(q({ q: "6616" }), 1, now)).items.map((r) => r.row_key), ["num1"], "เลขรถที่เป็นตัวเลข")
    eq((await svc.list(q({ plate: "สบ.72-8498", vehicleNo: "6616" }), 1, now)).total, 1, "เปิดกลุ่มรถที่เลขรถเป็นตัวเลข")
    await col.deleteOne({ row_key: "num1" })
    eq((await svc.list(q({ q: "ไดชาร์จ" }), 1, now)).total, 1, "ชื่อสินค้า")
    eq((await svc.list(q({ q: "(.*" }), 1, now)).total, 0, "regex พิเศษไม่พัง")
    eq((await svc.list(q({ status: "pending,legacy" }), 1, now)).items.map((r) => r.row_key), ["old", "s1"], "ค้างนานสุดก่อน")
    eq((await svc.list(q({ warehouse: "คลังสระบุรี" }), 1, now)).total, 1)
    eq((await svc.list(q({ from: "2026-09-15", to: "2026-10-31" }), 1, now)).total, 4)
    eq((await svc.list(q({ followed: "yes" }), 1, now)).items.map((r) => r.row_key), ["s1"])
    eq((await svc.list(q({ followed: "no", status: "pending" }), 1, now)).items.map((r) => r.row_key), ["old"])
    eq((await svc.list(q({ due: "1" }), 1, now)).items.map((r) => r.row_key), ["s1"], "ถึงกำหนดตาม")
    eq((await svc.list(q({ queue: "followup" }), 1, now)).items.map((r) => r.row_key), ["old", "s1"], "คิวจัดซื้อ: ค้างเกิน 14 วันไม่เคยตาม + ถึงกำหนด")
    const sum = await svc.summary(q({}), now)
    eq([sum.pending.count, sum.sold.count, sum.rebuilt.count, sum.no_core.count, sum.legacy.count], [2, 1, 1, 1, 0])
    eq(sum.pending.amount, 1600)
    eq(sum.followQueue.count, 2)
    const sumWh = await svc.summary(q({ warehouse: "คลังสระบุรี", status: "sold" }), now)
    eq(sumWh.pending.count, 1, "การ์ดสรุปไม่ถูกตัวกรองสถานะตัด")
    const gv = await svc.groups(q({}), "vehicle", 1, now)
    eq(gv.items.map((g) => [g.key.plate, g.count, g.oldest]), [["สบ.71-4018", 1, "2026-08-01"], ["70-1234", 1, "2026-09-01"]])
    eq(gv.items[0].days, 94)
    eq((await svc.groups(q({}), "warehouse", 1, now)).items.length, 2)
    eq((await svc.groups(q({}), "mr", 1, now)).items[0].plates, ["สบ.71-4018"])
    eq((await svc.list(q({ plate: "70-1234", vehicleNo: "ME243" }), 1, now)).total, 1, "เปิดกลุ่ม = กรองทะเบียน+เบอร์รถตรง ๆ")
    // หน้า 50 ต่อหน้า
    await col.insertMany(Array.from({ length: 120 }, (_, i) => base(`bulk${String(i).padStart(3, "0")}`, { issuedDate: "2026-10-15", warehouse: "คลัง DIST" })) as never[])
    const pg3 = await svc.list(q({ warehouse: "คลัง DIST" }), 3, now)
    eq([pg3.items.length, pg3.total, pg3.pages, pg3.items[0].row_key], [20, 120, 3, "bulk100"])

    // ── 6. รอบขายซาก ─────────────────────────────────────────────────────
    const W = "คลัง DIST"
    for (const k of ["bulk000", "bulk001", "bulk002", "bulk003"]) await svc.returnCore(k, { choice: "sell", scrapInDate: "2026-10-20" }, veh, now)
    await svc.returnCore("bulk004", { choice: "sell", scrapInDate: "2026-11-02" }, veh, now)
    eq(await status(rounds.createRound({ warehouses: [], cutoffDate: "2026-10-31" }, store, now)), 400)
    eq(await status(rounds.createRound({ warehouses: [W] }, store, now)), 400)
    const pv = await rounds.previewRound({ warehouses: W, cutoffDate: "2026-10-31" })
    eq(pv.items.map((r) => r.row_key), ["bulk000", "bulk001", "bulk002", "bulk003"], "ตัดรอบตามวันเข้าคลังซาก")
    // สองรอบแย่งแถวเดียวกันพร้อมกัน → แต่ละแถวอยู่รอบเดียว
    const [ra, rb2] = await Promise.all([
      rounds.createRound({ warehouses: [W], cutoffDate: "2026-10-31", keys: ["bulk000", "bulk001", "bulk002"] }, store, now),
      rounds.createRound({ warehouses: [W], cutoffDate: "2026-10-31", keys: ["bulk001", "bulk002", "bulk003"] }, proc, now).catch((e) => e),
    ])
    const assigned = await col.find({ row_key: { $in: ["bulk000", "bulk001", "bulk002", "bulk003"] } }).toArray()
    for (const r of assigned) assert.ok(r.saleRoundNo, `${r.row_key} ต้องอยู่รอบใดรอบหนึ่ง`)
    const total = (ra as { count: number }).count + ((rb2 as { count?: number }).count ?? 0)
    eq(total, 4, "ไม่มีแถวซ้ำสองรอบ")
    assert.match((ra as { roundNo: string }).roundNo, /^SR-2611-0[12]$/)
    eq((await rounds.previewRound({ warehouses: W, cutoffDate: "2026-11-03" })).items.map((r) => r.row_key), ["bulk004"], "แถวในรอบเปิดไม่ขึ้นใน preview")
    // แถวที่อยู่ในรอบ บันทึกขายเดี่ยวไม่ได้
    eq(await status(svc.markSold("bulk000", { soldDate: "2026-11-01" }, store, now)), 409)
    // รอบที่แถวถูกคว้าไปหมด → 409
    eq(await status(rounds.createRound({ warehouses: [W], cutoffDate: "2026-10-31", keys: ["bulk000"] }, store, now)), 409)
    // ยกเลิกรอบ → ปล่อยแถวกลับรอขาย
    const roundA = (ra as { roundNo: string }).roundNo
    const aKeys = (await rounds.getRound(roundA)).round.keys
    eq(await status(rounds.cancelRound(roundA, {}, store, now)), 400, "ต้องมีเหตุผล")
    const cx = await rounds.cancelRound(roundA, { reason: "ผู้ซื้อยกเลิก" }, store, now)
    eq(cx.released, aKeys.length)
    eq(await col.countDocuments({ row_key: { $in: aKeys }, coreStatus: "sell_waiting", saleRoundNo: null }), aKeys.length)
    eq(await status(rounds.cancelRound(roundA, { reason: "ซ้ำ" }, store, now)), 409)
    eq(await status(rounds.sellRound(roundA, { soldDate: "2026-11-02" }, store, now)), 409, "ขายรอบที่ยกเลิกไม่ได้")
    eq((await svc.getRow(aKeys[0])).history.map((h) => h.action), ["return", "round_add", "round_cancel"])
    // รอบใหม่ทั้งหมดที่เหลือ แล้วขายทั้งรอบ
    const rc = await rounds.createRound({ warehouses: [W], cutoffDate: "2026-11-03" }, proc, now)
    const rcRound = await rounds.getRound(rc.roundNo)
    eq(rcRound.items.length, rc.count)
    const xRound = await excel.buildRoundWorkbook(rcRound.round, rcRound.items, now)
    eq(await status(rounds.sellRound(rc.roundNo, {}, store, now)), 400, "ต้องมีวันที่ขาย")
    eq(await status(rounds.sellRound(rc.roundNo, { soldDate: "2026-10-25" }, store, now)), 400, "ขายก่อนซากเข้าคลัง")
    const linePrices = { [rcRound.items[0].row_key]: 120, [rcRound.items[1].row_key]: 80 }
    const sr = await rounds.sellRound(rc.roundNo, { soldDate: "2026-11-03", buyer: "ร้านรับซื้อของเก่า", linePrices }, store, now)
    eq(sr.sold, rc.count)
    const afterSold = await rounds.getRound(rc.roundNo)
    eq([afterSold.round.status, afterSold.round.totalPrice, afterSold.round.buyer], ["sold", 200, "ร้านรับซื้อของเก่า"])
    for (const r of afterSold.items) eq([r.coreStatus, r.sale?.soldDate, r.sale?.roundNo, r.saleRoundNo], ["sold", "2026-11-03", rc.roundNo, rc.roundNo])
    eq(afterSold.items.find((r) => r.row_key === rcRound.items[0].row_key)?.sale?.price, 120)
    eq(await status(rounds.cancelRound(rc.roundNo, { reason: "x" }, store, now)), 409, "ขายแล้วยกเลิกไม่ได้")
    // กดขายซ้ำ = ไม่เปลี่ยนอะไรเพิ่ม
    eq((await rounds.sellRound(rc.roundNo, { soldDate: "2026-11-03" }, store, now)).sold, 0)
    eq((await svc.getRow(rcRound.items[0].row_key)).chain.ok, true)
    eq((await rounds.listRounds()).length, (rb2 as { roundNo?: string }).roundNo ? 3 : 2)

    // ── 7. Excel ─────────────────────────────────────────────────────────
    const ExcelJS = (await import("exceljs")).default
    const load = async (b: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as never); return wb }
    type WS = NonNullable<ReturnType<InstanceType<typeof ExcelJS.Workbook>["getWorksheet"]>>
    const cell = (w: WS, row: number, header: string) => {
      const idx = (w.getRow(1).values as unknown[]).indexOf(header)
      assert.ok(idx > 0, `ไม่มีคอลัมน์ ${header}`)
      return w.getRow(row).getCell(idx).value
    }
    const { rows: exp } = await svc.exportRows(q({ status: "pending,legacy" }))
    const wbList = await load(await excel.buildListWorkbook(exp, { now }))
    const ws = wbList.getWorksheet("ติดตามซาก")!
    const hdr = (ws.getRow(1).values as string[]).filter(Boolean)
    for (const h of ["ค้าง (วัน)", "ตามแล้ว (ครั้ง)", "ตามล่าสุด", "โน้ตการตามล่าสุด", "ตามครั้งถัดไป", "WD", "MR"]) assert.ok(hdr.includes(h), h)
    eq(ws.rowCount, 1 + exp.length)
    const s1i = 2 + exp.findIndex((r) => r.row_key === "s1")
    eq(["ค้าง (วัน)", "ตามแล้ว (ครั้ง)", "ตามล่าสุด", "โน้ตการตามล่าสุด"].map((h) => cell(ws, s1i, h)), [63, 2, "2026-11-03", "ตามซ้ำ ยังไม่ได้ส่ง"])
    const wbR = await load(xRound)
    eq(wbR.worksheets.map((w) => w.name), ["สรุปรอบ", "รายการซาก"])
    const items = wbR.getWorksheet("รายการซาก")!
    assert.ok((items.getRow(1).values as string[]).includes("ราคาขาย"))
    eq(items.rowCount, 1 + rcRound.items.length)
    eq(cell(items, 2, "ราคาขาย"), null, "ช่องราคาขายว่างไว้กรอก")
    // ซากรอขาย ณ วันนี้: ใส่ซากเก่าหลายช่วงอายุ
    await col.insertMany([
      base("ag1", { coreStatus: "sell_waiting", sale: { scrapInDate: "2026-10-20" }, amount: 10 }),
      base("ag2", { coreStatus: "sell_waiting", sale: { scrapInDate: "2026-09-20" }, amount: 20 }),
      base("ag3", { coreStatus: "sell_waiting", sale: { scrapInDate: "2026-08-20" }, amount: 30 }),
      base("ag4", { coreStatus: "sell_waiting", sale: { scrapInDate: "2026-01-20" }, amount: 40, productGroup: "ระบบไฟ" }),
    ] as never[])
    const { rows: waiting } = await svc.exportRows({ status: ["sell_waiting"] })
    // ใช้เฉพาะ ag* (แถว p3 จากการแข่งอาจตกเป็นรอขายในลาดกระบังด้วย) แต่ต้องมีครบใน export
    for (const k of ["ag1", "ag2", "ag3", "ag4"]) assert.ok(waiting.some((r) => r.row_key === k), k)
    const wbA = await load(await excel.buildScrapAgingWorkbook(waiting.filter((r) => r.row_key.startsWith("ag")), now))
    eq(wbA.worksheets.map((w) => w.name), ["สรุปตามคลัง-กลุ่ม", "รายการซากรอขาย"])
    const sa = wbA.getWorksheet("สรุปตามคลัง-กลุ่ม")!
    const vals: Record<string, unknown>[] = []
    for (let i = 2; i <= sa.rowCount; i++) vals.push({ wh: cell(sa, i, "คลัง"), pg: cell(sa, i, "กลุ่มสินค้า"), a30: cell(sa, i, "0–30 วัน (รายการ)"), a60: cell(sa, i, "31–60 วัน (รายการ)"), a90: cell(sa, i, "61–90 วัน (รายการ)"), a90p: cell(sa, i, "เกิน 90 วัน (รายการ)"), tn: cell(sa, i, "รวม (รายการ)") })
    eq(vals, [
      { wh: "คลังลาดกระบัง", pg: "ระบบเบรคคลัทช์", a30: 1, a60: 1, a90: 1, a90p: 0, tn: 3 },
      { wh: "คลังลาดกระบัง", pg: "ระบบไฟ", a30: 0, a60: 0, a90: 0, a90p: 1, tn: 1 },
    ])
    eq(excel.ageBucket(30), "a30"); eq(excel.ageBucket(31), "a60"); eq(excel.ageBucket(90), "a90"); eq(excel.ageBucket(91), "a90p")

    // ── 8. แถวจากใบเบิก WMS (sw-sync) ─────────────────────────────────────
    const sync = await import("../lib/core-return/sw-sync")
    const sw = {
      no: "SW-2611-001", status: "ISSUED", kind: "stock", inventoryName: "คลังลาดกระบัง", plate: "71-1234", mrCode: "LBMR26110001", pickToName: "CM-งานซ่อม", remark: "",
      requestedBy: { email: "Mech@MenaTransport.co.th", name: "ช่างยานยนต์", via: "web" }, updatedAt: now,
      atms: { gmId: 1, done: [0], approved: true, code: "LBWD26110005", error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null },
      lines: [
        { skuId: 1, skuCode: "OIL-001", skuName: "น้ำมันเครื่อง", requestedQty: 4, issuedQty: 4, short: false, returnedQty: 0, mrItemId: 5, mrItemLabel: "อู่ใน-CM-ระบบเครื่องยนต์", serialNoId: null, remark: "" },
        { skuId: 2, skuCode: "ALT-1", skuName: "ไดชาร์จ", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "" },
        { skuId: 3, skuCode: "X", skuName: "ไม่ได้ของ", requestedQty: 1, issuedQty: 0, short: true, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "" },
      ],
    } as never
    eq(sync.planCoreRows({ ...(sw as object), status: "ISSUING" } as never), [], "ยังไม่ได้ WD = ไม่มีแถว")
    eq(sync.planCoreRows({ ...(sw as object), pickToName: "T-ยาง" } as never), [], "จุดประสงค์ที่ไม่มีซาก")
    const s1sync = await sync.syncCoreRowsForRequest(sw, store, now)
    eq(s1sync, { created: 2, keys: ["sw:SW-2611-001:0", "sw:SW-2611-001:1"] })
    const hr = await col.findOne({ row_key: "sw:SW-2611-001:0" })
    eq([hr?.coreStatus, hr?.issuedDate, hr?.wdCode, hr?.skuCode, hr?.source, hr?.qtyIssued, hr?.requester?.email, hr?.mrItemLabel, hr?.swNo, hr?.swLineIndex],
      ["pending", "2026-11-03", "LBWD26110005", "OIL-001", "wms.store-withdraw", 4, "mech@menatransport.co.th", "อู่ใน-CM-ระบบเครื่องยนต์", "SW-2611-001", 0])
    await svc.returnCore("sw:SW-2611-001:1", { choice: "rebuild" }, veh, now)
    eq((await sync.syncCoreRowsForRequest(sw, store, now)).created, 0, "รันซ้ำไม่สร้างซ้ำ")
    eq((await col.findOne({ row_key: "sw:SW-2611-001:1" }))?.coreStatus, "rebuild", "รันซ้ำไม่ทับสถานะ")
    eq((await svc.getRow("sw:SW-2611-001:1")).history.map((h) => h.action), ["create", "return"])
    // แข่งกันสร้าง → แถวเดียว log create เดียว
    const sw2 = { ...(sw as object), no: "SW-2611-002" } as never
    await Promise.all([sync.syncCoreRowsForRequest(sw2, store, now), sync.syncCoreRowsForRequest(sw2, store, now)])
    eq(await col.countDocuments({ swNo: "SW-2611-002" }), 2)
    eq(await (await logCol()).countDocuments({ row_key: "sw:SW-2611-002:0", action: "create" }), 1)
    // กันซ้ำกับฐาน ATMS
    eq(await sync.hasWmsRow("LBWD26110005", "OIL-001"), true)
    eq(await sync.hasWmsRow("LBWD26110005", "NOPE"), false)
    // ของฉัน / ชิปต่อใบ
    eq((await svc.list(q({ status: "pending" }) && { ...q({ status: "pending" }), requesterEmail: "mech@menatransport.co.th" }, 1, now)).items.map((r) => r.row_key), ["sw:SW-2611-001:0", "sw:SW-2611-002:0", "sw:SW-2611-002:1"])
    eq((await svc.list({ requesterEmail: "other@menatransport.co.th" }, 1, now)).total, 0)
    eq((await svc.rowsForRequests(["SW-2611-001"])).map((r) => [r.swLineIndex, r.coreStatus]).sort(), [[0, "pending"], [1, "rebuild"]])

    // ── 9. อู่ (garageType / garage จาก load_base.py) ─────────────────────
    await col.insertMany([
      base("g1", { garageType: "อู่นอก", garage: "บริษัท ปทุม 2 เซอร์วิส จำกัด", garageSource: "PO ค่าแรงของ MR", qtyIssued: 3, coreQtyReturned: 0, amount: 3000, plate: "70-1111", mrCode: "MR-G1", warehouse: "คลังขอนแก่น", issuedDate: "2026-09-10" }),
      base("g2", { garageType: "อู่นอก", garage: "บริษัท ปทุม 2 เซอร์วิส จำกัด", garageSource: "PO ค่าแรงของ MR", qtyIssued: 2, amount: 2000, plate: "70-2222", mrCode: "MR-G2", warehouse: "คลังขอนแก่น", issuedDate: "2026-10-10" }),
      base("g3", { garageType: "อู่นอก", garage: "ร้านอะไหล่ยนต์", garageSource: "PO ของ MR (อาจเป็นร้านอะไหล่)", amount: 500, warehouse: "คลังขอนแก่น" }),
      base("g4", { garageType: "อู่ใน", garage: "อู่ใน ลาดกระบัง", garageSource: "ไม่มีค่าแรงใน MR", amount: 100, warehouse: "คลังขอนแก่น" }),
      base("g5", { garageType: "อู่นอก", garage: "บริษัท ปทุม 2 เซอร์วิส จำกัด", coreStatus: "sold", amount: 999, warehouse: "คลังขอนแก่น" }),
    ] as never[])
    const KK = { warehouse: "คลังขอนแก่น" }
    const gg = await svc.groups(core.parseFilters(new URLSearchParams(KK)), "garage", 1, now)
    eq(gg.items.map((g) => [g.key.garageType, g.key.garage, g.count, g.pieces, g.amount, g.vehicles, g.mrs, g.oldest, !!g.uncertain]), [
      ["อู่นอก", "บริษัท ปทุม 2 เซอร์วิส จำกัด", 2, 5, 5000, 2, 2, "2026-09-10", false],
      ["อู่นอก", "ร้านอะไหล่ยนต์", 1, 2, 500, 1, 1, "2026-10-01", true],
      ["อู่ใน", "อู่ใน ลาดกระบัง", 1, 2, 100, 1, 1, "2026-10-01", false],
    ], "ยังไม่คืนซากตามอู่ (ขายแล้วไม่นับ) · เรียงยอดเงิน")
    eq((await svc.list(q({ ...KK, garageType: "อู่ใน" }), 1, now)).items.map((r) => r.row_key), ["g4"])
    eq((await svc.list(q({ ...KK, garage: "บริษัท ปทุม 2 เซอร์วิส จำกัด", status: "pending" }), 1, now)).items.map((r) => r.row_key), ["g1", "g2"])
    eq((await svc.list(q({ ...KK, q: "ปทุม 2" }), 1, now)).total, 3, "ค้นชื่ออู่ได้")
    const gl = await svc.garages()
    assert.ok(gl.some((g) => g.garage === "ร้านอะไหล่ยนต์" && g.garageType === "อู่นอก"))
    const { rows: kk } = await svc.exportRows(q(KK))
    const wbG = await load(await excel.buildListWorkbook(kk, { now, garages: gg.items }))
    eq(wbG.worksheets.map((w) => w.name), ["ติดตามซาก", "ตามอู่"])
    const gs = wbG.getWorksheet("ตามอู่")!
    eq([cell(gs, 2, "อู่"), cell(gs, 2, "ชิ้นที่ยังไม่คืน"), cell(gs, 2, "จำนวนรถ"), cell(gs, 3, "หมายเหตุ")], ["บริษัท ปทุม 2 เซอร์วิส จำกัด", 5, 2, "ชื่อจาก PO อาจเป็นร้านอะไหล่"])
    const det = wbG.getWorksheet("ติดตามซาก")!
    assert.ok((det.getRow(1).values as string[]).includes("อู่"))
    // แถวจากใบเบิก WMS: อู่ตามประเภทงาน
    eq(sync.garageOf({ workType: "garage_in", kind: "stock", inventoryName: "คลังลาดกระบัง", ref: null } as never).garage, "อู่ใน ลาดกระบัง")
    eq(sync.garageOf({ workType: "garage_out", kind: "cutoff", inventoryName: "ลาดกระบัง", ref: { type: "po", code: "LBPO1", id: 1 } } as never), { garageType: "อู่นอก", garage: "ไม่ทราบชื่ออู่", garageSource: "ใบเบิก WMS อู่นอก (อ้าง PO LBPO1)" })
    eq(sync.garageOf({ workType: "mobile_pm", kind: "stock", inventoryName: "สระบุรี", ref: null } as never).garageType, "Mobile/PM")
    eq((await col.findOne({ row_key: "sw:SW-2611-001:0" }))?.garageType, "อู่ใน", "sw-sync ใส่อู่ให้")


    // ── รูปแนบ (ที่เก็บปลอม) ────────────────────────────────────────────
    {
      const att = await import("../lib/core-return/attachments")
      const { setAttachStorage } = await import("../lib/store-withdraw/storage")
      const blobs = new Map<string, { size: number; contentType: string }>()
      setAttachStorage({
        async presignPut(key) { return `https://fake.test/put/${key}` },
        async headObject(key) { return blobs.get(key) ?? null },
        async presignGet(key) { return `https://fake.test/get/${key}?exp=300` },
      })
      await col.insertMany([base("a1"), base("a2"), base("a3"), base("a4")] as never[])
      const up = async (rk: string, who: typeof veh, context: "return" | "other", o: { size?: number; type?: string; put?: boolean } = {}) => {
        const size = o.size ?? 1000
        const p = await att.presignCoreAttachment(rk, { context, filename: "ซาก 1.jpg", contentType: o.type ?? "image/jpeg", size }, who)
        if (o.put !== false) blobs.set(p.key, { size, contentType: o.type ?? "image/jpeg" })
        return p
      }
      // presign: ตรวจชนิด/ขนาด/context
      eq(await status(att.presignCoreAttachment("a1", { context: "return", filename: "x.exe", contentType: "application/x-msdownload", size: 10 }, veh)), 400, "ชนิดไฟล์")
      eq(await status(att.presignCoreAttachment("a1", { context: "return", filename: "x.jpg", contentType: "image/jpeg", size: 10 * 1024 * 1024 + 1 }, veh)), 400, "ใหญ่เกิน 10 MB")
      eq(await status(att.presignCoreAttachment("a1", { context: "return", filename: "x.jpg", contentType: "image/jpeg", size: 0 }, veh)), 400, "ขนาด 0")
      eq(await status(att.presignCoreAttachment("a1", { context: "reject", filename: "x.jpg", contentType: "image/jpeg", size: 5 }, veh)), 400, "context ไม่รู้จัก")
      eq(await status(att.presignCoreAttachment("nope", { context: "return", filename: "x.jpg", contentType: "image/jpeg", size: 5 }, veh)), 404)
      // presign แล้วยังไม่ PUT → confirm ไม่ได้ (409) · PUT ขนาดไม่ตรง → 409
      const pend = await up("a1", veh, "return", { put: false })
      assert.match(pend.key, /^core-return\/a1\/[0-9a-f]{16}-/)
      eq(await status(att.confirmCoreAttachment("a1", pend.id, veh)), 409, "ยังไม่อัปโหลด")
      blobs.set(pend.key, { size: 999, contentType: "image/jpeg" })
      eq(await status(att.confirmCoreAttachment("a1", pend.id, veh)), 409, "ขนาดไม่ตรง")
      eq(await status(att.confirmCoreAttachment("a1", "nope", veh)), 404)
      blobs.set(pend.key, { size: 1000, contentType: "image/jpeg" })
      eq(await status(att.confirmCoreAttachment("a1", pend.id, store)), 403, "คนอื่นยืนยันแทนไม่ได้")
      await att.confirmCoreAttachment("a1", pend.id, veh)
      await att.confirmCoreAttachment("a1", pend.id, veh) // ซ้ำ = ไม่เพิ่มนับ/ประวัติ
      eq((await col.findOne({ row_key: "a1" }))?.attachCount, 1, "นับครั้งเดียว")
      eq((await (await logCol()).find({ row_key: "a1", action: "attach" }).toArray()).length, 1)
      // list: ลิงก์ดู + เฉพาะที่ยืนยันแล้ว
      await up("a1", veh, "return", { put: false }) // ค้างไม่ยืนยัน
      const li = await att.listCoreAttachments("a1")
      eq(li.map((x) => [x.id, x.context, x.linked]), [[pend.id, "return", false]])
      assert.match(li[0].url, /^https:\/\/fake\.test\/get\/core-return\/a1\//)
      // ผูกกับใบคืน: ไฟล์ของคนอื่น / ยังไม่ยืนยัน / แถวอื่น → 400 และสถานะแถวไม่เปลี่ยน
      const mine = await up("a2", veh, "return"); await att.confirmCoreAttachment("a2", mine.id, veh)
      const unconf = await up("a2", veh, "return")
      const foreign = await up("a2", store, "return"); await att.confirmCoreAttachment("a2", foreign.id, store)
      const ret = { choice: "sell", qty: 2, scrapInDate: "2026-10-05" }
      eq(await status(svc.returnCore("a2", { ...ret, attachmentIds: [unconf.id] }, veh, now)), 400, "ยังไม่ยืนยัน")
      eq(await status(svc.returnCore("a2", { ...ret, attachmentIds: [foreign.id] }, veh, now)), 400, "คนอื่นอัปโหลด")
      eq(await status(svc.returnCore("a2", { ...ret, attachmentIds: [pend.id] }, veh, now)), 400, "ของแถวอื่น")
      eq(await status(svc.returnCore("a2", { ...ret, attachmentIds: "x" }, veh, now)), 400, "ไม่ใช่รายการ")
      eq((await col.findOne({ row_key: "a2" }))?.coreStatus, "pending", "ผูกไม่ผ่าน = ไม่เปลี่ยนสถานะ")
      const done = await svc.returnCore("a2", { ...ret, attachmentIds: [mine.id, mine.id] }, veh, now)
      eq(done?.ret?.attachmentIds, [mine.id], "ซ้ำ id นับครั้งเดียว")
      eq((await (await logCol()).findOne({ row_key: "a2", action: "return" }))?.data?.attachmentIds, [mine.id], "บันทึก id ในประวัติ")
      eq((await att.listCoreAttachments("a2")).find((x) => x.id === mine.id)?.linked, true)
      eq((await (await att.coreAttachCol()).findOne({ _id: mine.id }))?.linkedTo, { type: "return" })
      // ผูกซ้ำกับใบอื่นไม่ได้ (ใช้ id เดิมกับแถวเดียวกันที่ผูกแล้ว)
      eq(await status(att.resolveCoreLinkable("a2", [mine.id], veh).then(() => null)), 400, "ผูกแล้วใช้ซ้ำไม่ได้")
      // ไม่แนบ = เหมือนเดิม · คืนไปแล้ว context return ไม่ได้ แต่ other ได้
      eq((await svc.returnCore("a3", ret, veh, now))?.ret?.attachmentIds, undefined)
      eq(await status(att.presignCoreAttachment("a3", { context: "return", filename: "x.jpg", contentType: "image/jpeg", size: 5 }, veh)), 409)
      const later = await up("a3", veh, "other", { type: "application/pdf" }); await att.confirmCoreAttachment("a3", later.id, veh)
      eq((await att.listCoreAttachments("a3")).map((x) => [x.context, x.contentType]), [["other", "application/pdf"]])
      // เพดาน 8 ต่อแถว (นับทุก context รวมที่ค้างยังไม่ยืนยัน)
      for (let i = 0; i < 8; i++) await up("a4", veh, "return", { put: false })
      eq(await status(up("a4", veh, "return", { put: false })), 400, "เกิน 8")
      // ไม่มีเส้นทางลบ/แก้ใน module
      assert.deepEqual(Object.keys(att).filter((k) => /delete|remove|update/i.test(k)), [])
      setAttachStorage(null)

      // ที่เก็บในเครื่อง (เดโม): ปิดเมื่อ production · เปิดเมื่อ dev + แฟลก · แฟลกใน production = ล้ม
      const loc = await import("../lib/store-withdraw/storage-local")
      eq(loc.devLocalStorageEnabled({ NODE_ENV: "production", CORE_RETURN_DEV_LOCAL_STORAGE: "1" }), false, "production ห้ามเปิด")
      eq(loc.devLocalStorageEnabled({ NODE_ENV: "development" }), false, "ไม่มีแฟลก = ปิด")
      eq(loc.devLocalStorageEnabled({ NODE_ENV: "development", CORE_RETURN_DEV_LOCAL_STORAGE: "true" }), false, "ค่าต้องเป็น 1")
      eq(loc.devLocalStorageEnabled({ NODE_ENV: "development", CORE_RETURN_DEV_LOCAL_STORAGE: "1" }), true)
      assert.throws(() => loc.assertDevLocalSafe({ NODE_ENV: "production", CORE_RETURN_DEV_LOCAL_STORAGE: "1" }), /production/)
      const env = process.env as Record<string, string | undefined>
      const was = { n: env.NODE_ENV, f: env.CORE_RETURN_DEV_LOCAL_STORAGE, d: env.CORE_RETURN_DEV_STORAGE_DIR }
      const { attachStorage } = await import("../lib/store-withdraw/storage")
      try {
        env.CORE_RETURN_DEV_LOCAL_STORAGE = "1"
        env.NODE_ENV = "production"
        assert.throws(() => attachStorage(), /production/, "attachStorage ใน production ที่ตั้งแฟลก = ล้ม")
        assert.throws(() => loc.devPutFile("core-return/x/y", "image/png", Buffer.from("x")), /ปิดอยู่/)
        env.NODE_ENV = "development"
        env.CORE_RETURN_DEV_STORAGE_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cr-dev-"))
        const st = attachStorage()
        eq(await st.headObject("core-return/x/y"), null)
        loc.devPutFile("core-return/x/y", "image/png", Buffer.from("abc"))
        eq(await st.headObject("core-return/x/y"), { size: 3, contentType: "image/png" })
        assert.match(await st.presignPut("core-return/x/y", "image/png"), /^\/api\/dev-storage\?key=core-return%2Fx%2Fy$/)
        eq(loc.devReadFile("core-return/x/y")?.body.toString(), "abc")
      } finally {
        for (const [k, v] of [["NODE_ENV", was.n], ["CORE_RETURN_DEV_LOCAL_STORAGE", was.f], ["CORE_RETURN_DEV_STORAGE_DIR", was.d]] as const) { if (v === undefined) delete env[k]; else env[k] = v }
      }
    }

    // ── UX: เรียง · ระดับสีค้าง · ตามหลายแถว ─────────────────────────────────────
    {
      // ระดับสี (ฟังก์ชันล้วน): <=14 เทา · 15–60 เหลือง · >60 แดง
      eq([null, 0, 14, 15, 60, 61, 400].map((d) => core.agingTier(d as number | null)), ["ok", "ok", "ok", "warn", "warn", "late", "late"])
      eq(core.parseSort("amount"), "amount"); eq(core.parseSort("bogus"), "oldest"); eq(core.parseSort(undefined), "oldest")
      eq(core.sortSpec("oldest"), { issuedDate: 1, row_key: 1 })
      await col.insertMany([
        base("so1", { warehouse: "คลังเรียง", issuedDate: "2026-07-01", amount: 500 }),
        base("so2", { warehouse: "คลังเรียง", issuedDate: "2026-09-15", amount: 90000 }),
        base("so3", { warehouse: "คลังเรียง", issuedDate: "2026-08-10", amount: 7000 }),
      ] as never[])
      const keysOf = async (sort: "oldest" | "newest" | "amount") => (await svc.list({ warehouse: "คลังเรียง", status: ["pending"] }, 1, now, sort)).items.map((r) => r.row_key)
      eq(await keysOf("oldest"), ["so1", "so3", "so2"], "เก่าสุดก่อน")
      eq(await keysOf("newest"), ["so2", "so3", "so1"], "ใหม่สุดก่อน")
      eq(await keysOf("amount"), ["so2", "so3", "so1"], "ยอดเงินมากสุด")
      const idx = (await col.indexes()).map((i) => JSON.stringify(i.key))
      assert.ok(idx.includes(JSON.stringify({ coreStatus: 1, amount: -1, row_key: 1 })), "ดัชนีเรียงยอดเงิน")

      // ตามหลายแถว: ข้อความเดียวกัน · แถวที่จบแล้ว/ไม่พบ = ล้มเฉพาะแถวนั้น
      await col.insertMany([base("bf1"), base("bf2"), base("bf3", { coreStatus: "sold" })] as never[])
      eq(await status(svc.followUpMany(["bf1"], { note: "" }, proc, now)), 400, "ไม่มีข้อความ")
      eq(await status(svc.followUpMany([], { note: "x" }, proc, now)), 400, "ไม่ได้เลือก")
      eq(await status(svc.followUpMany(Array.from({ length: core.MAX_KEYS + 1 }, (_, i) => "k" + i), { note: "x" }, proc, now)), 400, "เกินเพดาน")
      eq(await status(svc.followUpMany(["bf1"], { note: "x", nextDate: "2026-10-01" }, proc, now)), 400, "วันตามย้อนหลัง")
      eq(((await col.findOne({ row_key: "bf1" }))?.followUp?.count ?? 0), 0, "ตรวจไม่ผ่านต้องไม่เขียนอะไร")
      const bulk = await svc.followUpMany(["bf1", "bf2", "bf3", "nope", "bf1"], { note: "โทรตามรวด", nextDate: "2026-11-10" }, proc, now)
      eq(bulk.ok, ["bf1", "bf2"], "สำเร็จ 2 (ซ้ำนับครั้งเดียว)")
      eq(bulk.failed.map((x) => x.key).sort(), ["bf3", "nope"])
      eq(bulk.failed.find((x) => x.key === "bf3")?.error, "รายการนี้จบแล้ว ไม่ต้องตามต่อ")
      const [b1, b3] = [await col.findOne({ row_key: "bf1" }), await col.findOne({ row_key: "bf3" })]
      eq([b1?.followUp?.count, b1?.followUp?.lastNote, b1?.followUp?.nextDate, b3?.followUp ?? null], [1, "โทรตามรวด", "2026-11-10", null])
      const lg2 = await (await logCol()).find({ row_key: "bf2" }).toArray()
      eq(lg2.map((l) => l.action), ["follow_up"], "ทุกแถวมี log ของตัวเอง")
      // Export ที่เลือก: keys กรองเฉพาะแถวที่เลือก
      const sp = new URLSearchParams({ keys: "bf1\nbf3" })
      const ex = await svc.exportRows(core.parseFilters(sp))
      eq(ex.rows.map((r) => r.row_key).sort(), ["bf1", "bf3"])
      // สิทธิ์: path ตามหลายแถวต้องเป็น action follow_up (ผู้ยื่นแบบยานยนต์ล้วนโดนปฏิเสธ)
      const pol = await import("../lib/access-policy")
      eq(pol.coreReturnActionForApi("/api/core-return/bulk/follow-up"), "follow_up")
    }

    console.log("check-core-return: OK")
  } finally {
    await client.close()
    await mongod.stop()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
