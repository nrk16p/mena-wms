// scripts/dev-core-return-local.ts — เดโมในเครื่อง: หน้า "ติดตามซากอะไหล่" บน Mongo ในหน่วยความจำ (ไม่แตะ DB/ATMS จริง)
//
//   npx tsx scripts/dev-core-return-local.ts [port=3107] [ไฟล์ฐาน JSON]
//
// ทำอะไร: เปิด mongodb-memory-server → ใส่ฐานซากจาก core_return_base_local.json (รูปเดียวกับ load_base.py)
//   → สุ่มให้ราว 30 แถวต่อสถานะ (S1 รอขาย/ขายแล้ว/Rebuild/Rebuild เสร็จ/ไม่มีซาก) + การตาม + รอบขาย 2 รอบ
//   → ใบเบิก WMS ตัวอย่างของผู้ใช้เดโม (มีชิปซากในหน้า /store-withdraw) → เปิด next dev พอร์ตที่กำหนด
//   → ปั๊ม session cookie ของผู้ใช้เดโม + ตัวช่วยล็อกอินที่ http://localhost:<port+1>/ (ตั้ง cookie แล้วพาไปหน้าแอป)
// cookie ไม่แยกตามพอร์ต: ตัวช่วยบนพอร์ต +1 ตั้ง cookie ให้ localhost แล้วแอปบนพอร์ตหลักอ่านได้ — ไม่ต้องแก้โค้ดแอป ไม่มี route ล็อกอินพิเศษ
// หยุด: kill <PID ที่พิมพ์ไว้> (ปิด next dev + Mongo ในหน่วยความจำให้เอง)
// ใช้ next dev --webpack: worktree ที่ node_modules เป็น symlink ออกนอกโปรเจกต์ Turbopack ไม่ยอม
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import { encode } from "next-auth/jwt"

delete process.env.MONGO_URI // ห้ามแตะ cluster จริง ไม่ว่ากรณีใด
const PORT = Number(process.argv[2] || 3107)
const HELPER = PORT + 1
const SRC = process.argv[3] || path.join(os.homedir(), "Documents/cluade_workspace/core-return-base/out/core_return_base_local.json")
const SECRET = "local-core-return-demo-secret-0123456789"
const STATE = path.join(os.tmpdir(), "core-return-local")
fs.mkdirSync(STATE, { recursive: true })
const ROOT = path.resolve(__dirname, "..")

const DEMO = { email: "demo.admin@menatransport.co.th", name: "ผู้ดูแลเดโม (IT)" }
const PERSONAS: Record<string, { email: string; name: string; employee: Record<string, unknown>; accessOverrides?: Record<string, string> }> = {
  admin: { ...DEMO, employee: { username: "demo.admin", department: "Information Technology", department_id: 21, position: "IT" } },
  vehicle: { email: "demo.mech@menatransport.co.th", name: "ช่างเดโม (ยานยนต์)", employee: { username: "demo.mech", department: "ยานยนต์", department_id: 3, position: "ช่าง" } },
  store: { email: "demo.store@menatransport.co.th", name: "สโตร์เดโม", employee: { username: "demo.store", department: "Store", department_id: 31, position: "สโตร์" }, accessOverrides: { "store-queue": "edit" } },
  procurement: { email: "demo.buyer@menatransport.co.th", name: "จัดซื้อเดโม", employee: { username: "demo.buyer", department: "Procurement", department_id: 5, position: "จัดซื้อ" } },
  accounting: { email: "demo.acc@menatransport.co.th", name: "บัญชีเดโม", employee: { username: "demo.acc", department: "Accounting", department_id: 6, position: "บัญชี" } },
}

// สุ่มแบบคงที่ (รันซ้ำได้ภาพเดิม)
let seed = 20261103
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10)
const minYmd = (a: string, b: string) => (a < b ? a : b)

const num = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n }
function toDoc(r: Record<string, unknown>, now: Date) {
  return {
    row_key: r.row_key, issuedDate: String(r["วันที่"] ?? "").slice(0, 10), yearMonth: r.year_month, warehouse: r["คลังสินค้า"], wdCode: r.WD, mrCode: r.MR,
    purpose: r["จุดประสงค์ในการเบิก"], skuCode: r["รหัสสินค้า"], skuName: r["ชื่อสินค้า"], productGroup: r["กลุ่มสินค้า"], vehicleNo: r["เลขรถ"], plate: r["ทะเบียน"],
    driver: r["พจส."], serialNo: r["เลขที่เฉพาะ"], qtyIssued: num(r["จ่าย"]), unitCost: num(r["ราคาทุน"]), amount: num(r["ยอดเงิน"]), remark: r["หมายเหตุ"],
    source: r.legacy_only ? "legacy-xlsx" : "atms.stockmovement_v5", legacySheet: r.legacy_sheet ?? null, legacyRound: r.legacy_round || null, legacyNote: r.legacy_note || null,
    garageType: r.garage_type ?? null, garage: r.garage ?? null, garageSource: r.garage_source ?? null,
    loadedAt: now, coreStatus: r.legacy_sheet ? "legacy" : "pending", coreQtyReturned: 0, createdAt: now,
  }
}

void (async () => {
  const mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  const client = new MongoClient(uri)
  await client.connect()
  const now = new Date()
  const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)

  // ── ฐานซาก ──
  const rows = JSON.parse(fs.readFileSync(SRC, "utf8")) as Record<string, unknown>[]
  const col = client.db("master_data").collection("core_return_base")
  for (let i = 0; i < rows.length; i += 2000) await col.insertMany(rows.slice(i, i + 2000).map((r) => toDoc(r, now)))
  const { setCoreReturnClient } = await import("../lib/core-return/db")
  const { setStoreWithdrawClient } = await import("../lib/store-withdraw/db")
  setCoreReturnClient(client)
  setStoreWithdrawClient(client)
  const svc = await import("../lib/core-return/service")
  const rounds = await import("../lib/core-return/rounds")
  const sync = await import("../lib/core-return/sw-sync")
  const mech = { email: PERSONAS.vehicle.email, name: PERSONAS.vehicle.name, via: "web" as const }
  const store = { email: PERSONAS.store.email, name: PERSONAS.store.name, via: "web" as const }
  const buyer = { email: PERSONAS.procurement.email, name: PERSONAS.procurement.name, via: "web" as const }
  const acc = { email: PERSONAS.accounting.email, name: PERSONAS.accounting.name, via: "web" as const }

  // ── สถานะตัวอย่าง (ผ่าน service จริง = ประวัติ + โซ่แฮชครบ) ──
  const pool = (await col.find({ coreStatus: { $in: ["pending", "legacy"] }, issuedDate: { $lte: addDays(today, -25) } }, { projection: { row_key: 1, issuedDate: 1, qtyIssued: 1, garageType: 1 } }).toArray())
    .sort(() => rnd() - 0.5)
  let k = 0
  const take = (n: number) => pool.slice(k, (k += n))
  const scrapIn = (d: string) => minYmd(addDays(d, 1 + Math.floor(rnd() * 10)), today)
  // S1 ต้องผ่านบัญชีรับเข้าคลังซาก (อู่นอก: จัดซื้อรับกลับ + ยานยนต์ยืนยันก่อน) — เดินครบทุกขั้นผ่าน service จริง
  const intoScrap = async (r: { row_key: string; garageType?: string | null }, si: string, body: Record<string, unknown> = {}) => {
    const after = await svc.returnCore(r.row_key, { choice: "sell", ...body }, mech, now)
    if (after?.coreStatus === "await_pickup") { await svc.markPickedUp(r.row_key, { pickupDate: si }, buyer, now); await svc.confirmHandover(r.row_key, {}, mech, now) }
    await svc.receiveIntoScrap(r.row_key, { receivedDate: si, qty: body.qty }, acc, now)
  }
  for (const r of take(35)) await intoScrap(r, scrapIn(r.issuedDate), { note: "นำส่งบัญชี" })
  // ขั้นส่งต่อ: รอบัญชีรับเข้า / รอจัดซื้อรับซากอู่นอก / รอยานยนต์ยืนยัน
  for (const r of take(12)) await svc.returnCore(r.row_key, { choice: "sell", note: "นำส่งบัญชีแล้ว" }, mech, now)
  // ไฟล์ฐานบางชุดไม่มีชนิดอู่ — ตั้งเป็นอู่นอกให้แถวเดโมกลุ่มนี้
  for (const [i, row] of take(14).entries()) {
    if (row.garageType !== "อู่นอก") await col.updateOne({ row_key: row.row_key }, { $set: { garageType: "อู่นอก", garage: "อู่ช่างเอกการช่าง (เดโม)" } })
    await svc.returnCore(row.row_key, { choice: "sell" }, mech, now)
    if (i % 2 === 0) await svc.markPickedUp(row.row_key, { pickupDate: today, note: "รถกระบะไปรับ" }, buyer, now)
  }
  for (const r of take(30)) {
    const si = scrapIn(r.issuedDate)
    await intoScrap(r, si)
    await svc.markSold(r.row_key, { soldDate: minYmd(addDays(si, 5 + Math.floor(rnd() * 30)), today), price: Math.round(50 + rnd() * 900), buyer: "ร้านรับซื้อของเก่า ส.เจริญ" }, store, now)
  }
  for (const r of take(30)) await svc.returnCore(r.row_key, { choice: "rebuild", rebuildSentDate: scrapIn(r.issuedDate), rebuildVendor: rnd() > 0.5 ? "อู่ศรีสมบูรณ์ไดนาโม" : "ร้านปั๊มหัวฉีดบางนา" }, mech, now)
  for (const r of take(30)) {
    const sent = scrapIn(r.issuedDate)
    await svc.returnCore(r.row_key, { choice: "rebuild", rebuildSentDate: sent, rebuildVendor: "อู่ศรีสมบูรณ์ไดนาโม" }, mech, now)
    await svc.markRebuilt(r.row_key, { rebuiltDate: minYmd(addDays(sent, 7 + Math.floor(rnd() * 20)), today), note: "ใช้ต่อได้ เข้าสต๊อกแล้ว" }, store, now)
  }
  const reasons = ["ของสิ้นเปลือง", "ซากเสียหายทิ้ง", "อื่นๆ"]
  for (const r of take(30)) { const reason = reasons[Math.floor(rnd() * 3)]; await svc.returnCore(r.row_key, { choice: "no_core", noCoreReason: reason, note: reason === "อื่นๆ" ? "อู่นอกไม่คืนซาก" : "" }, mech, now) }
  // คืนไม่ครบ 3 แถว
  for (const r of take(3)) if ((r.qtyIssued ?? 1) > 1) await intoScrap(r, scrapIn(r.issuedDate), { qty: 1, shortReason: "อีกชิ้นแตก ทิ้งที่อู่" })
  // การตาม: บางแถวถึงกำหนดวันนี้
  for (const [i, r] of take(25).entries()) {
    await svc.followUp(r.row_key, { note: i % 2 ? "โทรตามหัวหน้าช่าง บอกจะส่งพรุ่งนี้" : "ไลน์กลุ่มอู่นอกแล้ว รอคำตอบ", nextDate: i % 3 === 0 ? today : addDays(today, 3) }, buyer, now)
    if (i % 4 === 0) await svc.followUp(r.row_key, { note: "ตามซ้ำ ยังไม่ได้ส่ง", nextDate: today }, buyer, now)
  }
  // รอบขาย: ขายแล้ว 1 รอบ · เปิดอยู่ 1 รอบ
  const whs = ["คลังลาดกระบัง", "คลังสระบุรี"]
  const pv = await rounds.previewRound({ warehouses: whs, cutoffDate: today })
  if (pv.items.length >= 6) {
    const r1 = await rounds.createRound({ warehouses: whs, cutoffDate: today, keys: pv.items.slice(0, 6).map((x) => x.row_key), note: "รอบต้นเดือน" }, buyer, now)
    await rounds.sellRound(r1.roundNo, { soldDate: today, buyer: "หจก.รีไซเคิลเหล็กไทย", totalPrice: 4200 }, store, now)
    await rounds.createRound({ warehouses: whs, cutoffDate: today, keys: pv.items.slice(6, 14).map((x) => x.row_key), note: "รอผู้ซื้อเสนอราคา" }, buyer, now)
  }

  // ── ใบเบิก WMS ของผู้ใช้เดโม (ISSUED มี WD) → แถวซากผ่าน sw-sync จริง ──
  const sw = client.db("master_data").collection("store_withdraw_requests")
  const atms = (code: string) => ({ gmId: 1, done: [0, 1], approved: true, code, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: now })
  const ln = (o: Record<string, unknown>) => ({ skuId: 1, skuCode: "X", skuName: "x", requestedQty: 1, issuedQty: 1, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...o })
  const reqs = [
    { no: "SW-2611-001", status: "ISSUED", workType: "garage_in", plate: "สบ.71-4018", mrCode: "LBMR26110012", wd: "LBWD26110031", lines: [ln({ skuId: 501, skuCode: "LB04BS00094", skuName: "จานกดคลัช 17 นิ้ว(ฮีโน่500)", issuedQty: 1, mrItemLabel: "อู่ใน-CM-ระบบเบรคคลัทช์" }), ln({ skuId: 502, skuCode: "LB03EL00211", skuName: "ไดชาร์จ 24V 60A", issuedQty: 1, mrItemLabel: "อู่ใน-CM-ระบบไฟ" })] },
    { no: "SW-2611-002", status: "RECEIVED", workType: "garage_out", plate: "สบ.73-0135", mrCode: "LBMR26110020", wd: "LBWD26110044", ref: { type: "po", code: "LBPO26110107", id: 1 }, lines: [ln({ skuId: 503, skuCode: "LB01CS00470", skuName: "แม่ปั๊มเบรค HINO FM1AK", requestedQty: 2, issuedQty: 2 })] },
  ]
  for (const r of reqs) {
    const doc = { no: r.no, kind: "stock", workType: r.workType, status: r.status, inventoryId: 4, inventoryName: "ลาดกระบัง", pickToId: 7, pickToName: "CM-งานซ่อม", plate: r.plate, mrCode: r.mrCode, ref: r.ref ?? null, urgent: false, remark: "",
      lines: r.lines, requestedBy: { email: DEMO.email, name: DEMO.name, via: "web" }, claimedBy: { email: store.email, name: store.name }, rejectReason: null, atms: atms(r.wd), returns: [], createdAt: new Date(now.getTime() - 3 * 86_400_000), updatedAt: now }
    await sw.insertOne(doc)
    await sync.syncCoreRowsForRequest(doc as never, store, now)
  }
  // สิทธิ์รายคน (จำลอง /admin/users) — jwt callback อ่านซ้ำทุก 5 นาที ต้องมีใน DB ไม่งั้นสโตร์เดโมหลุดสิทธิ์คิวสโตร์
  await client.db("master_data").collection("wms_access_overrides").insertOne({ email: PERSONAS.store.email, overrides: { "store-queue": "edit" } })
  console.log("seed:", JSON.stringify(await svc.summary({}, now)))

  // ── next dev ──
  const env = {
    ...process.env, MONGO_URI: uri, MONGO_DB: "master_data", STORE_WITHDRAW_DB: "master_data", CORE_RETURN_DB: "master_data",
    NEXTAUTH_URL: `http://localhost:${PORT}`, NEXTAUTH_SECRET: SECRET,
    // ปิดทางออกไปข้างนอก: api-ncac/ATMS/Spaces ชี้ที่อยู่ที่ไม่มีจริง
    NCAC_BASE: "http://127.0.0.1:9", NCAC_API_KEY: "local-only", DO_SPACES_ENDPOINT: "https://spaces.invalid", DO_SPACES_KEY: "x", DO_SPACES_SECRET: "x", DO_SPACES_BUCKET: "x",
    CORE_RETURN_DEV_LOCAL_STORAGE: "1", // รูปแนบเก็บบนดิสก์ในเครื่อง (dev-only · ปิดอัตโนมัติใน production build)
    GOOGLE_CLIENT_ID: "local-only", GOOGLE_CLIENT_SECRET: "local-only", NEXT_TELEMETRY_DISABLED: "1",
  }
  const next = spawn(path.join(ROOT, "node_modules/.bin/next"), ["dev", "--webpack", "-p", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
  const devLog = fs.createWriteStream(path.join(STATE, "next-dev.log"))
  next.stdout.pipe(devLog); next.stderr.pipe(devLog)

  // ── session cookie + ตัวช่วยล็อกอิน ──
  const tokens: Record<string, string> = {}
  for (const [k2, p] of Object.entries(PERSONAS)) {
    tokens[k2] = await encode({ secret: SECRET, maxAge: 7 * 86_400, token: { name: p.name, email: p.email, sub: p.email, role: k2 === "admin" ? "admin" : "user", employee: p.employee, accessOverrides: p.accessOverrides ?? {}, accessAt: Date.now() } })
  }
  const helper = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${HELPER}`)
    const who = u.searchParams.get("as") ?? "admin"
    const go = u.searchParams.get("go") ?? "/store-withdraw/core-return"
    if (!tokens[who] || !go.startsWith("/")) { res.writeHead(400); return res.end("bad request") }
    if (u.pathname === "/") {
      res.writeHead(302, { "Set-Cookie": `next-auth.session-token=${tokens[who]}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`, Location: `http://localhost:${PORT}${go}` })
      return res.end()
    }
    res.writeHead(404); res.end()
  })
  helper.listen(HELPER, "127.0.0.1")

  const info = { url: `http://localhost:${PORT}/store-withdraw/core-return`, login: `http://localhost:${HELPER}/?as=admin`, personas: Object.keys(PERSONAS), pid: process.pid, nextPid: next.pid, mongoUri: uri, tokens }
  fs.writeFileSync(path.join(STATE, "info.json"), JSON.stringify(info, null, 2))
  console.log(`\nเดโมพร้อม (รอ next dev คอมไพล์ครั้งแรกสักครู่)\n  ล็อกอิน: http://localhost:${HELPER}/?as=admin  (as=vehicle|store|procurement ได้)\n  หน้าแอป: ${info.url}\n  PID: ${process.pid}  · หยุด: kill ${process.pid}\n  log next dev: ${path.join(STATE, "next-dev.log")}\n  info: ${path.join(STATE, "info.json")}`)

  const stop = async () => { try { next.kill("SIGTERM") } catch { /* ปิดไปแล้ว */ } helper.close(); await client.close().catch(() => {}); await mongod.stop().catch(() => {}); process.exit(0) }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  next.on("exit", (c) => { console.log("next dev ปิดแล้ว", c); void stop() })
})().catch((e) => { console.error(e); process.exit(1) })
