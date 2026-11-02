// scripts/check-store-withdraw-audit.ts
// รัน: NEXTAUTH_SECRET=x npx tsx scripts/check-store-withdraw-audit.ts  (Mongo ในเครื่อง + ที่เก็บไฟล์ปลอม — ไม่เรียก DO Spaces จริง)
// ครอบ: ไฟล์แนบ (presign/confirm/ชนิด/ขนาด/จำนวน/เจ้าของ) · ส่งเคลมต้องแนบ+ผูกไฟล์ · เพิ่มได้อย่างเดียว · โซ่แฮช log · audit (ช่วงวันที่/สิทธิ์/Excel)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

process.env.STORE_WITHDRAW_DB = "sw_audit_test"
delete process.env.MONGO_URI // ห้ามแตะ cluster จริง
delete process.env.DO_SPACES_KEY // ถ้าโค้ดหลุดไปเรียก Spaces จริงจะ error ทันที

const eq = assert.deepEqual
const code = async (p: Promise<unknown>) => p.then(() => 0, (e: { status?: number; name?: string }) => e.status ?? e.name ?? -1)
const req1 = { email: "req1@menatransport.co.th", name: "ผู้ขอ 1", via: "web" as const }
const req2 = { email: "req2@menatransport.co.th", name: "ผู้ขอ 2", via: "web" as const }
const store = { email: "store1@menatransport.co.th", name: "สโตร์ 1", via: "web" as const }
const asReq = (actor: typeof req1) => ({ actor, isStore: false, storeView: false })
const asStore = { actor: store, isStore: true, storeView: true }

const objects = new Map<string, { size: number; contentType: string }>()
const fake = {
  presigned: [] as string[],
  async presignPut(key: string) { fake.presigned.push(key); return `https://fake.test/put/${key}` },
  async headObject(key: string) { return objects.get(key) ?? null },
  async presignGet(key: string, filename: string) { return `https://fake.test/get/${key}?n=${encodeURIComponent(filename)}` },
}
const upload = (key: string, size: number, contentType = "image/jpeg") => objects.set(key, { size, contentType })

function baseDoc(no: string, over: Record<string, unknown> = {}) {
  const atms = { gmId: 11, done: [], approved: true, code: "LBWD26110001", error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null }
  return {
    no, kind: "stock", workType: "garage_in", status: "ISSUED", inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "ซ่อมรถ",
    plate: "71-1234", mrCode: "LBMR26100001", ref: null, urgent: false, remark: "",
    lines: [{ skuId: 501, skuCode: "OIL-001", skuName: "น้ำมันเครื่อง", requestedQty: 8, issuedQty: 8, short: false, returnedQty: 0, mrItemId: 77, mrItemLabel: "LBMR26100001 อู่ใน-CM-ระบบไฟ : 77", serialNoId: null, remark: "" }],
    requestedBy: { email: req1.email, name: req1.name, via: "web" }, claimedBy: null, rejectReason: null, atms, returns: [],
    createdAt: new Date(), updatedAt: new Date(), ...over,
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  const dbm = await import("../lib/store-withdraw/db")
  const { setStoreWithdrawClient, swCol, swLogCol, writeLog } = dbm
  setStoreWithdrawClient(client)
  const { setAttachStorage } = await import("../lib/store-withdraw/storage")
  setAttachStorage(fake)
  const A = await import("../lib/store-withdraw/attachments")
  const { requestReturn } = await import("../lib/store-withdraw/service")
  const { verifyChain, parseRange, listAudit, auditDetail, buildAuditWorkbook, AUDIT_MAX_ROWS } = await import("../lib/store-withdraw/audit")
  const col = await swCol()
  const logs = await swLogCol()

  const NO = "SW-2611-001"
  await col.insertOne(baseDoc(NO) as never)
  await col.insertOne(baseDoc("SW-2611-002", { requestedBy: { email: req2.email, name: req2.name, via: "web" } }) as never)

  // ---- presign: ตรวจชนิด/ขนาด/context/สิทธิ์ ----
  const ok = { context: "return", filename: "ลูกหมาก.jpg", contentType: "image/jpeg", size: 1000 }
  eq(await code(A.presignAttachment(NO, { ...ok, contentType: "application/zip" }, asReq(req1))), 400)
  eq(await code(A.presignAttachment(NO, { ...ok, contentType: "image/gif" }, asReq(req1))), 400)
  eq(await code(A.presignAttachment(NO, { ...ok, size: 10 * 1024 * 1024 + 1 }, asReq(req1))), 400)
  eq(await code(A.presignAttachment(NO, { ...ok, size: 0 }, asReq(req1))), 400)
  eq(await code(A.presignAttachment(NO, { ...ok, context: "zzz" }, asReq(req1))), 400)
  eq(await code(A.presignAttachment(NO, { ...ok, sha256: "abc" }, asReq(req1))), 400)
  eq(await code(A.presignAttachment("SW-0000-404", ok, asReq(req1))), "NotFoundError")
  eq(await code(A.presignAttachment(NO, ok, asReq(req2))), 403) // ไม่ใช่เจ้าของใบ
  for (const t of ["image/png", "image/webp", "image/heic", "application/pdf"]) assert.ok((await A.presignAttachment(NO, { ...ok, context: "other", contentType: t }, asReq(req1))).id)
  assert.ok((await A.presignAttachment(NO, { ...ok, context: "reject" }, asStore)).uploadUrl.startsWith("https://fake.test/put/")) // สโตร์แนบได้
  const p1 = await A.presignAttachment(NO, { ...ok, filename: "../../etc/passwd.jpg", sha256: "a".repeat(64) }, asReq(req1))
  assert.ok(p1.key.startsWith(`store-withdraw/${NO}/`) && !p1.key.includes(".."), p1.key)
  eq(fake.presigned.includes(p1.key), true)

  // ---- confirm ----
  eq(await code(A.confirmAttachment(NO, p1.id, asReq(req1))), 409) // ยังไม่อัปโหลด
  upload(p1.key, 999)
  eq(await code(A.confirmAttachment(NO, p1.id, asReq(req1))), 409) // ขนาดไม่ตรง
  upload(p1.key, 1000)
  eq(await code(A.confirmAttachment(NO, p1.id, asReq(req2))), 403) // ไม่ใช่เจ้าของใบ
  eq(await code(A.confirmAttachment(NO, p1.id, asStore)), 403) // สโตร์ก็ยืนยันไฟล์ที่คนอื่นอัปโหลดไม่ได้
  eq(await code(A.confirmAttachment(NO, "nope", asReq(req1))), "NotFoundError")
  eq(await code(A.confirmAttachment("SW-2611-002", p1.id, asReq(req2))), "NotFoundError") // id ของใบอื่น
  const c1 = await A.confirmAttachment(NO, p1.id, asReq(req1))
  assert.ok(c1.confirmedAt)
  await A.confirmAttachment(NO, p1.id, asReq(req1)) // ซ้ำ = ผ่าน ไม่เขียน log ซ้ำ
  const attachLogs = await logs.find({ no: NO, action: "attach" }).toArray()
  eq(attachLogs.length, 1)
  assert.ok(String(attachLogs[0].note).includes(p1.id) && String(attachLogs[0].note).includes("a".repeat(64)))

  // ---- รายการ: เฉพาะที่ยืนยันแล้ว + ลิงก์อายุสั้น ----
  const lst = (await A.listAttachments([NO])).get(NO) ?? []
  eq(lst.length, 1)
  assert.ok(lst[0].url.startsWith("https://fake.test/get/") && lst[0].filename === "passwd.jpg")
  eq((await A.countAttachments([NO])).get(NO), 1)
  eq(await code(A.assertCanView(NO, asReq(req2))), 403)
  eq(await code(A.assertCanView(NO, { actor: store, isStore: false, storeView: true })), 0)

  // ---- จำกัด 8 ไฟล์ต่อหัวข้อ ----
  const LIM = "SW-2611-003"
  await col.insertOne(baseDoc(LIM) as never)
  for (let i = 0; i < 8; i++) await A.presignAttachment(LIM, { ...ok, filename: `f${i}.jpg` }, asReq(req1))
  eq(await code(A.presignAttachment(LIM, ok, asReq(req1))), 400)
  assert.ok((await A.presignAttachment(LIM, { ...ok, context: "other" }, asReq(req1))).id) // หัวข้ออื่นนับแยก

  // ---- ส่งเคลมต้องแนบ + ผูกไฟล์ ----
  const mk = async (no: string, who: Parameters<typeof A.presignAttachment>[2], context: string, confirm = true) => {
    const p = await A.presignAttachment(no, { ...ok, context }, who)
    if (confirm) { upload(p.key, 1000); await A.confirmAttachment(no, p.id, who) }
    return p.id
  }
  const claimBody = (extra: Record<string, unknown> = {}) => ({ reasonCode: "claim", lines: [{ lineIndex: 0, qty: 1 }], ...extra })
  eq(await code(requestReturn(NO, claimBody(), req1)), 400) // ไม่แนบ
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [] }), req1)), 400)
  const other = await mk(NO, asReq(req1), "return")
  const idOfReq2 = await mk("SW-2611-002", asReq(req2), "return")
  const wrongCtx = await mk(NO, asReq(req1), "other")
  const unconfirmed = await mk(NO, asReq(req1), "return", false)
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [idOfReq2] }), req1)), 400) // ไฟล์ของอีกใบ/อีกคน
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [wrongCtx] }), req1)), 400) // context ไม่ใช่ return
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [unconfirmed] }), req1)), 400) // ยังไม่ยืนยัน
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: ["ไม่มีจริง"] }), req1)), 400)
  eq((await col.findOne({ no: NO }))?.returns.length, 0) // ที่ล้มเหลวไม่ทิ้งใบคืนไว้
  // ไฟล์ของคนอื่นที่ยืนยันแล้วในใบเดียวกัน (สโตร์อัปโหลด context return) ผูกกับใบคืนของผู้ขอไม่ได้
  const byStore = await mk(NO, asStore, "return")
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [byStore] }), req1)), 400)
  const { rid } = await requestReturn(NO, claimBody({ attachmentIds: [other] }), req1)
  eq((await A.attachCol().then((c) => c.findOne({ _id: other })))?.linkedTo, { type: "return", rid })
  eq(await code(requestReturn(NO, claimBody({ attachmentIds: [other] }), req1)), 400) // ผูกแล้วใช้ซ้ำไม่ได้
  const sec = await mk(NO, asReq(req1), "return")
  await requestReturn(NO, { reasonCode: "unused", lines: [{ lineIndex: 0, qty: 1 }] }, req1) // เหตุผลอื่นไม่ต้องแนบ
  await requestReturn(NO, { reasonCode: "sell", lines: [{ lineIndex: 0, qty: 1 }], attachmentIds: [sec] }, req1) // แนบเพิ่มได้
  eq((await A.attachCol().then((c) => c.findOne({ _id: sec })))?.linkedTo?.type, "return")
  assert.ok((await logs.findOne({ no: NO, action: "returnRequest", note: { $regex: "แนบ 1 ไฟล์" } })))

  // ---- ปฏิเสธ / สรุป: ตรวจก่อน แล้วผูก ----
  const rj = await mk(NO, asStore, "reject")
  eq(await A.resolveLinkable(NO, [rj], "reject", store), [rj])
  eq(await code(A.resolveLinkable(NO, [rj], "reject", req1)), 400) // คนอื่นใช้ไม่ได้
  eq(await code(A.resolveLinkable(NO, [rj], "summary", store)), 400)
  await A.linkAttachments(NO, [rj], { type: "reject" })
  eq(await code(A.resolveLinkable(NO, [rj], "reject", store)), 400)
  eq(await A.resolveLinkable(NO, undefined, "reject", store), [])

  // ---- เพิ่มได้อย่างเดียว: ไม่มีทางลบ/แก้ ----
  const root = path.resolve(__dirname, "..")
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  const attachFiles = [
    ...walk(path.join(root, "app/api/store-withdraw/[no]/attachments")),
    ...walk(path.join(root, "app/api/store-withdraw/audit")),
    path.join(root, "lib/store-withdraw/attachments.ts"), path.join(root, "lib/store-withdraw/storage.ts"),
    path.join(root, "lib/store-withdraw/audit.ts"), path.join(root, "lib/store-withdraw/chain.ts"),
  ]
  for (const f of attachFiles) {
    const src = fs.readFileSync(f, "utf8")
    assert.ok(!/\b(deleteOne|deleteMany|findOneAndDelete|replaceOne|bulkWrite|drop\(|DeleteObject|deleteDoc|\.remove\()/.test(src), `${f} มีคำสั่งลบ/แทนที่`)
    if (f.endsWith("route.ts")) assert.ok(!/export (async )?(function|const) (PUT|PATCH|DELETE)\b/.test(src), `${f} มี PUT/PATCH/DELETE`)
  }
  const attachSrc = fs.readFileSync(path.join(root, "lib/store-withdraw/attachments.ts"), "utf8")
  const sets = [...attachSrc.matchAll(/\$set:\s*\{\s*(\w+)/g)].map((m) => m[1]).sort()
  eq(sets, ["confirmedAt", "linkedTo"]) // เปลี่ยนค่าได้แค่สองช่องนี้ (ครั้งเดียว)
  eq(Object.keys(fake).filter((k) => /delete|remove/i.test(k)), [])

  // ---- โซ่แฮช ----
  const CH = "SW-2611-010"
  await col.insertOne(baseDoc(CH) as never)
  // รายการเก่าก่อนมีฟีเจอร์ (ไม่มี seq/hash) = ส่วนหน้าของโซ่ที่ไม่ตรวจ
  await logs.insertMany([
    { no: CH, action: "create", from: null, to: "NEW", actor: { email: req1.email, name: req1.name, via: "web" }, at: new Date(Date.now() - 5000) },
    { no: CH, action: "claim", from: "NEW", to: "PREPARING", actor: { email: store.email, name: store.name, via: "web" }, at: new Date(Date.now() - 4000) },
  ] as never)
  eq(await verifyChain(CH), { ok: true, checked: 0 })
  for (const a of ["ready", "issue", "issued"]) await writeLog({ no: CH, action: a, from: "x", to: "y", actor: { email: store.email, name: store.name, via: "web" }, note: a === "issued" ? "WD" : undefined })
  eq(await verifyChain(CH), { ok: true, checked: 3 })
  const hashed = await logs.find({ no: CH, seq: { $gt: 0 } }).sort({ seq: 1 }).toArray()
  eq(hashed.map((h) => h.seq), [1, 2, 3])
  assert.ok(hashed.every((h) => /^[0-9a-f]{64}$/.test(h.hash ?? "")))
  assert.ok(!("note" in hashed[0]), "note ที่ไม่มีต้องไม่ถูกเก็บเป็น null")
  // แก้รายการกลาง → จับได้ที่ลำดับนั้น
  await logs.updateOne({ no: CH, seq: 2 }, { $set: { note: "แก้ย้อนหลัง" } })
  eq(await verifyChain(CH), { ok: false, checked: 1, brokenAt: 2 })
  await logs.updateOne({ no: CH, seq: 2 }, { $unset: { note: "" } })
  eq((await verifyChain(CH)).ok, true)
  // ลบรายการกลาง → ลำดับขาด
  await logs.deleteOne({ no: CH, seq: 2 })
  eq(await verifyChain(CH), { ok: false, checked: 1, brokenAt: 2 })
  // แก้เวลา/ผู้ทำ/ผล hash ก็จับได้
  const CH2 = "SW-2611-011"
  await col.insertOne(baseDoc(CH2) as never)
  for (let i = 0; i < 4; i++) await writeLog({ no: CH2, action: "a" + i, from: "x", to: "y", actor: { email: store.email, name: store.name, via: "web" } })
  await logs.updateOne({ no: CH2, seq: 4 }, { $set: { "actor.email": "evil@menatransport.co.th" } })
  eq(await verifyChain(CH2), { ok: false, checked: 3, brokenAt: 4 })
  // เขียนพร้อมกันหลายตัว → seq ต่อเนื่อง ไม่ซ้ำ โซ่ถูกต้อง
  const CC = "SW-2611-012"
  await col.insertOne(baseDoc(CC) as never)
  await Promise.all(Array.from({ length: 16 }, (_, i) => writeLog({ no: CC, action: "c" + i, from: "x", to: "y", actor: { email: store.email, name: store.name, via: "web" } })))
  eq((await logs.find({ no: CC }).sort({ seq: 1 }).toArray()).map((x) => x.seq), Array.from({ length: 16 }, (_, i) => i + 1))
  eq(await verifyChain(CC), { ok: true, checked: 16 })
  // ใบต่างกันไม่ชนกัน
  await Promise.all(["SW-2611-020", "SW-2611-021"].flatMap((n) => [0, 1, 2].map((i) => writeLog({ no: n, action: "z" + i, from: null, to: null, actor: { email: store.email, name: store.name, via: "web" } }))))
  eq((await verifyChain("SW-2611-020")).ok && (await verifyChain("SW-2611-021")).ok, true)
  // transition ก็ต่อโซ่ (ใช้เส้นทางจริง)
  const idx = (await (await dbm.getDb()).collection("store_withdraw_log").indexes()).find((i) => JSON.stringify(i.key) === '{"no":1,"seq":1}')
  assert.ok(idx?.unique, "ต้องมี unique index {no, seq}")

  // ---- audit: ช่วงวันที่ ----
  for (const [f, t] of [[undefined, undefined], ["2026-11-01", undefined], ["x", "2026-11-02"], ["2026-11-05", "2026-11-01"], ["2026-01-01", "2026-04-05"], ["2026-13-01", "2026-13-02"]] as const) {
    eq(await code(Promise.resolve().then(() => parseRange(f, t))), 400, `${f} ${t}`)
  }
  eq(parseRange("2026-01-01", "2026-04-03").end.getTime() - parseRange("2026-01-01", "2026-04-03").start.getTime(), 93 * 86_400_000) // 93 วันพอดี ผ่าน
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })
  const rg = [day, day] as const
  const lr = await listAudit(...rg, {})
  assert.ok(lr.rows.length >= 4 && !lr.truncated)
  const row = lr.rows.find((r) => r.no === NO)!
  eq([row.workType, row.status, row.plate, row.mr, row.wd, row.chainOk], ["garage_in", "ISSUED", "71-1234", "LBMR26100001", ["LBWD26110001"], true])
  assert.ok(row.lines.includes("OIL-001") && row.events >= 4 && row.attachments >= 3)
  eq((await listAudit(...rg, { q: "LBWD26110001" })).rows.length >= 1, true)
  eq((await listAudit(...rg, { q: "sw-2611-002" })).rows.map((r) => r.no), ["SW-2611-002"])
  eq((await listAudit(...rg, { q: "req2@" })).rows.map((r) => r.no), ["SW-2611-002"])
  eq((await listAudit(...rg, { status: "NEW" })).rows.length, 0)
  eq((await listAudit(...rg, { workType: "mobile_pm" })).rows.length, 0)
  assert.ok((await listAudit(...rg, { workType: "garage_in" })).rows.length >= 4)
  eq(await code(listAudit(...rg, { workType: "bogus" })), 400)
  eq((await listAudit("2020-01-01", "2020-01-02", {})).rows.length, 0)
  assert.ok((await listAudit(...rg, {})).rows.find((r) => r.no === CH)!.chainOk === false) // CH ถูกลบรายการกลาง
  // เกิน 400 ใบ = ตัดที่ 400 + บอก truncated
  const bulk = Array.from({ length: AUDIT_MAX_ROWS + 5 }, (_, i) => baseDoc(`SW-2612-${String(i).padStart(3, "0")}`, { createdAt: new Date(Date.now() - 86_400_000 * 3) }))
  await col.insertMany(bulk as never)
  const d3 = new Date(Date.now() - 86_400_000 * 3).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })
  const big = await listAudit(d3, d3, {})
  eq([big.rows.length, big.truncated], [AUDIT_MAX_ROWS, true])
  // ใช้ index (ไม่สแกนทั้ง collection)
  const { start, end } = parseRange(d3, d3)
  const plan = JSON.stringify(await col.find({ createdAt: { $gte: start, $lt: end } }).explain("queryPlanner"))
  assert.ok(plan.includes("IXSCAN") && !plan.includes("COLLSCAN"), "audit ต้องอ่านผ่าน index createdAt")

  // ---- audit: รายละเอียดรายใบ ----
  const det = await auditDetail(NO)
  eq(det.chain.ok, true)
  assert.ok(det.timeline.length >= 4 && det.timeline.some((t) => t.action === "attach") && det.timeline.some((t) => t.action === "returnRequest"))
  eq(det.atms[0], { type: "WD", code: "LBWD26110001", label: "ใบเบิก", url: "https://www.mena-atms.com/inv/withdraw/view/id/11" })
  eq(det.lines[0].mrItemLabel, "LBMR26100001 อู่ใน-CM-ระบบไฟ : 77")
  assert.ok(det.attachments.length >= 3 && det.attachments.every((a) => a.url.startsWith("https://fake.test/get/")))
  assert.ok(det.returns.some((r) => r.reason?.startsWith("ส่งเคลม")))
  eq(await code(auditDetail("SW-9999-999")), "NotFoundError")
  eq((await auditDetail(CH)).chain, { ok: false, checked: 1, brokenAt: 2 })

  // ---- audit: Excel ----
  const wbOut = await buildAuditWorkbook(...rg, { q: "SW-2611-001" })
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(wbOut.buffer as never)
  eq(wb.worksheets.map((w) => w.name), ["ใบเบิก", "เหตุการณ์", "หลักฐานแนบ"])
  eq(wb.getWorksheet("ใบเบิก")!.rowCount, 2)
  assert.ok(wb.getWorksheet("เหตุการณ์")!.rowCount > 4 && wb.getWorksheet("หลักฐานแนบ")!.rowCount >= 4)
  eq(String(wb.getWorksheet("ใบเบิก")!.getRow(2).getCell(1).value), NO)
  eq(await code(buildAuditWorkbook(undefined, undefined)), 400)
  eq(await code(buildAuditWorkbook("2026-01-01", "2026-12-31")), 400)

  // ---- สิทธิ์ (access-policy) ----
  const { accessFor, checkRequest, sectionForApi, sectionForPage, SECTIONS } = await import("../lib/access-policy")
  assert.ok((SECTIONS as readonly string[]).includes("store-audit"))
  eq([sectionForApi("/api/store-withdraw/audit"), sectionForApi("/api/store-withdraw/audit/SW-2611-001"), sectionForApi("/api/store-withdraw/audit/export"), sectionForPage("/store-withdraw/audit")], ["store-audit", "store-audit", "store-audit", "store-audit"])
  eq(sectionForApi("/api/store-withdraw/SW-2611-001/attachments/presign"), "store-withdraw")
  for (const dept of ["ยานยนต์", "Procurement", "Store", "Accounting", "Finance", "Chief-level", "Information Technology", null]) {
    const a = accessFor({ department: dept, email: "someone@menatransport.co.th" })
    if (dept !== "Information Technology") eq(a["store-audit"], "none", String(dept)) // ค่าเริ่มต้น = ไม่มีใครเห็น
  }
  const viewer = accessFor({ department: "Accounting", email: "acc@menatransport.co.th", overrides: { "store-audit": "view" } })
  const none = accessFor({ department: "Accounting", email: "acc@menatransport.co.th" })
  const storeEdit = accessFor({ department: "Store", email: "s@menatransport.co.th", overrides: { "store-queue": "edit" } })
  const decide = (p: string, m: string, access: ReturnType<typeof accessFor>) => checkRequest({ pathname: p, method: m, access, isSuperAdmin: false }).ok
  eq(decide("/api/store-withdraw/audit", "GET", viewer), true)
  eq(decide("/api/store-withdraw/audit/export", "GET", viewer), true)
  eq(decide("/store-withdraw/audit", "GET", viewer), true)
  eq(decide("/api/store-withdraw/audit", "GET", none), false)
  eq(decide("/store-withdraw/audit", "GET", none), false)
  eq(decide("/api/store-withdraw/audit/SW-2611-001", "GET", storeEdit), false) // คิวสโตร์ไม่ได้สิทธิ์ audit ติดมาด้วย
  eq(decide("/api/store-withdraw/audit", "GET", accessFor({ department: "Store", email: "s@menatransport.co.th", overrides: { "store-queue": "view" } })), false)
  // แนบไฟล์: ผู้ขอ (store-withdraw แก้ได้) หรือสโตร์ (store-queue แก้ได้)
  const vehicle = accessFor({ department: "ยานยนต์", email: "v@menatransport.co.th" })
  const storeOnly = accessFor({ department: "Accounting", email: "s@menatransport.co.th", overrides: { "store-queue": "edit" } })
  const storeViewOnly = accessFor({ department: "Accounting", email: "s@menatransport.co.th", overrides: { "store-queue": "view" } })
  for (const sub of ["presign", "confirm"]) {
    eq(decide(`/api/store-withdraw/SW-2611-001/attachments/${sub}`, "POST", vehicle), true)
    eq(decide(`/api/store-withdraw/SW-2611-001/attachments/${sub}`, "POST", storeOnly), true)
    eq(decide(`/api/store-withdraw/SW-2611-001/attachments/${sub}`, "POST", storeViewOnly), false)
    eq(decide(`/api/store-withdraw/SW-2611-001/attachments/${sub}`, "POST", none), false)
  }
  eq(decide("/api/store-withdraw/SW-2611-001/attachments", "GET", storeViewOnly), true)
  eq(decide("/api/store-withdraw/SW-2611-001/attachments", "GET", vehicle), true)
  // นี่ไม่ใช่เส้นทางฝั่งสโตร์ที่ API key เรียกไม่ได้ — audit ต้องเป็น session เท่านั้น
  const mw = fs.readFileSync(path.join(root, "middleware.ts"), "utf8")
  assert.ok(mw.includes("audit(\\/.*)?$/"), "audit ต้องอยู่ในรายการ session-only ของ middleware")
  assert.ok(!/attachments/.test(mw.slice(mw.indexOf("STORE_WITHDRAW_SESSION_ONLY"), mw.indexOf("function sameSecret"))), "ไฟล์แนบฝั่งผู้ขอรับ API key ได้")

  setAttachStorage(null)
  setStoreWithdrawClient(null)
  await client.close()
  await mongod.stop()
  console.log("check-store-withdraw-audit: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
