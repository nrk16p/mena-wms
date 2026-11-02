// scripts/store-withdraw-test-infra.ts — โครงทดสอบ API เบิกอะไหล่ (เรียกจาก check-store-withdraw-api.sh)
// เปิด Mongo ในเครื่อง (mongodb-memory-server) + api-ncac จำลอง (http ธรรมดา) แล้วเขียน {mongoUri, ncacBase} ลงไฟล์ที่รับมา
// ไม่แตะ cluster จริง · รันค้างไว้จนถูก kill
import fs from "node:fs"
import http from "node:http"
import { MongoClient } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"

const out = process.argv[2]
if (!out) throw new Error("usage: store-withdraw-test-infra.ts <out.json> <calls.log>")
const callsLog = process.argv[3]
// argv[4] (ไม่บังคับ) = ไฟล์ JSON คุมพฤติกรรมจำลองระหว่างรัน เช่น {"issue":"409","issueDelayMs":1500}
const ctlFile = process.argv[4]
// สัญญา api-ncac: x-api-key ไม่ตรง/ไม่มี = 403 (401 = ATMS ไม่รับบัญชีผู้ใช้เท่านั้น) · key ที่ถูกอ่านจาก env NCAC_EXPECT_KEY (ไม่ตั้ง = "k-test")
const EXPECT_KEY = process.env.NCAC_EXPECT_KEY || "k-test"
// issue: "409" = ทำไม่ครบ · "drop" = ตัดการเชื่อมต่อกลางคัน (ไม่รู้ผล) · forbid=true = ตอบ 403 ทุกเส้นทาง
const ctl = (): { issue?: string; issueDelayMs?: number; list?: string; forbid?: boolean } => {
  try { return ctlFile ? JSON.parse(fs.readFileSync(ctlFile, "utf8")) : {} } catch { return {} }
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

void (async () => {
  const mongod = await MongoMemoryServer.create()
  const client = new MongoClient(mongod.getUri())
  await client.connect()
  // สต๊อกจำลองสำหรับ lookup/sku
  await client.db("master_data").collection("atms_sku_master").insertMany([
    { skuPk: 501, code: "OIL-001", name: "น้ำมันเครื่อง", stockQty: 12, inventoryId: 4 },
    { skuPk: 502, code: "FLT-002", name: "ไส้กรอง", stockQty: 3, inventoryId: 4 },
  ])
  await client.close()

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x")
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      if (callsLog) fs.appendFileSync(callsLog, `${req.method} ${u.pathname} user=${req.headers["x-atms-username"] ?? ""}\n`)
      if (callsLog && u.pathname === "/atms/withdraw/issue") {
        try { const b = JSON.parse(raw); fs.appendFileSync(callsLog, `ISSUE-BODY remark_token=${b.remark_token} remark=${b.remark}\n`) } catch { /* ไม่ใช่ JSON */ }
      }
      const user = String(req.headers["x-atms-username"] ?? "")
      if (req.headers["x-api-key"] !== EXPECT_KEY || ctl().forbid) return json(res, 403, { detail: "forbidden: bad x-api-key" })
      if (u.pathname === "/atms/withdraw/whoami") {
        if (user === "badstore") return json(res, 401, { detail: "login failed" })
        return json(res, 200, { username: user, email: user === "store1" ? "store1@menatransport.co.th" : "someone.else@menatransport.co.th", name: "สโตร์ 1", branch: "ลาดกระบัง" })
      }
      if (u.pathname === "/atms/withdraw/options") return json(res, 200, { inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "ซ่อมรถ" }] })
      if (u.pathname === "/atms/withdraw/mr/search") {
        const q = u.searchParams.get("q")
        return json(res, 200, { results: [{ id: 9001, code: "LBMR26100001", date: "25/10/2026", plate: q, vehicle_no: "1234", step: "รออะไหล่", branch: "ลาดกระบัง", project: "CM", driver: "สมชาย", mechanic: "ช่างเอ", remark: "อู่ใน-CM-ระบบเครื่องยนต์: ปัญหา ความร้อนขึ้น · อู่ใน-PM-ระบบไฟ: ไฟท้ายซ้ายไม่ติด", limit: u.searchParams.get("limit") }] })
      }
      if (u.pathname.startsWith("/atms/withdraw/lookup/")) {
        const kind = u.pathname.split("/").pop()
        if (kind === "sku") return json(res, 200, { results: [{ id: 501, code: "OIL-001", name: "น้ำมันเครื่อง" }, { id: 599, code: "NOSTOCK", name: "ไม่มีสต๊อก" }] })
        return json(res, 200, { results: [{ id: 1, label: `${kind}:${u.searchParams.get("q")}` }] })
      }
      // อ้างอิง PO / DD (สัญญา api-ncac: docs/superpowers/specs/2026-11-01-store-withdraw-doc-ref-design.md)
      if (u.pathname === "/atms/withdraw/doc/search") {
        const kind = u.searchParams.get("kind")
        return json(res, 200, { results: [{ id: 157902, code: kind === "dd" ? "LBDD26100001" : kind === "pr" ? "LBPR26100561" : "LBPO26100704", kind, date: "25/10/2026", supplier: kind === "pr" ? "" : "บ.ทดสอบ", status: kind === "dd" ? null : kind === "pr" ? "อนุมัติ" : "ยังไม่ได้รับสินค้า", total: 1100, ref: "LBPR26100561", remark: kind === "pr" ? `${u.searchParams.get("q")} เปลี่ยนผ้าเบรค` : undefined, limit: u.searchParams.get("limit"), q: u.searchParams.get("q"), inv: u.searchParams.get("inventory_id") }] })
      }
      if (u.pathname.startsWith("/atms/withdraw/doc/")) {
        const [, , , , kind, id] = u.pathname.split("/")
        if (id === "404404") return json(res, 404, { detail: "ไม่พบใบ" })
        const line = (o: Record<string, unknown>) => ({ group: "ทั่วไป", amount: 1, received: 1, remaining: 0, unit_price: 100, total: 100, remark: "", is_labour: false, ...o })
        return json(res, 200, { id: Number(id), code: kind === "dd" ? "LBDD26100001" : kind === "pr" ? "LBPR26100561" : "LBPO26100704", kind, date: "25/10/2026", supplier: "บ.ทดสอบ", inventory: "ลาดกระบัง", pr: "LBPR26100561", po: null, withdraw: null, remark: "",
          lines: [
            line({ sku_code: "OIL-001", sku_name: "OIL-001 : น้ำมันเครื่อง", amount: 4, received: 2, remaining: 2 }),
            line({ sku_code: "OIL-001", sku_name: "OIL-001 : น้ำมันเครื่อง", amount: 1, received: 1 }),
            line({ sku_code: "FLT-002", sku_name: "FLT-002 : ไส้กรอง", amount: 2, received: 0, remaining: 2 }),
            line({ sku_code: "LB00269", sku_name: "LB00269 : ค่าแรงซ่อมเกียร์", group: "ค่าแรง-ระบบเบรค ครัช เกียร์", is_labour: true }),
          ] })
      }
      if (u.pathname === "/atms/withdraw/issue") {
        const c = ctl()
        if (c.issue === "drop") return void req.socket.destroy()
        const reply = () => c.issue === "409"
          ? json(res, 409, { detail: "ATMS ตัดสต๊อกบรรทัดที่ 2 ไม่สำเร็จ: สต๊อกไม่พอ", progress: { gm_id: 9001, done: [0], approved: false, code: "LBWD-9001" } })
          : json(res, 200, { progress: { gm_id: 9001, done: [0], approved: true, code: "LBWD-9001" } })
        return c.issueDelayMs ? void setTimeout(reply, c.issueDelayMs) : reply()
      }
      if (u.pathname === "/atms/withdraw/list") {
        const mode = ctl().list
        if (mode === "fail") return json(res, 500, { detail: "mock: ATMS down" })
        if (mode === "slow") return void setTimeout(() => json(res, 200, { rows: [] }), 15000)
        // แถว id 9001 = ใบที่ WMS ตัดเอง (ต้องถูกตัดออก) · 8123 = คีย์ตรงใน ATMS
        return json(res, 200, { rows: [
          { id: 9001, code: "LBWD-9001", pick_to: "ซ่อมรถ", user: "store1", remark: "SW", created_at: "2026-10-31 09:10", approved: true },
          { id: 8123, code: "LBWD-8123", pick_to: "ซ่อมรถ", user: "คนคีย์ตรง", remark: "70-9999 ยางหน้า", created_at: "2026-10-31 10:05", approved: true },
        ] })
      }
      if (u.pathname === "/atms/sku/lookup") {
        return json(res, 200, { rows: [{ found: true, code: "OIL-001", name: "น้ำมันเครื่อง", stock_qty: 7, sku_pk: 501 }, { found: true, code: "FLT-002", name: "ไส้กรอง", stock_qty: 99, sku_pk: 9999 }] })
      }
      if (u.pathname === "/atms/withdraw/9001") {
        return json(res, 200, { id: 9001, code: "LBWD-9001", items: [{ sku_code: "OIL-001", unit_price: 100 }] })
      }
      if (u.pathname === "/atms/withdraw/return") {
        return json(res, 200, { progress: { gm_id: 7001, done: [0], approved: true, code: "LBDD-7001" } })
      }
      json(res, 404, { detail: "mock: not found " + u.pathname })
    })
  })
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port
    fs.writeFileSync(out, JSON.stringify({ mongoUri: mongod.getUri(), ncacBase: `http://127.0.0.1:${port}` }))
    console.log("infra ready")
  })
  const stop = async () => { server.close(); await mongod.stop(); process.exit(0) }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
})()
