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
      const user = String(req.headers["x-atms-username"] ?? "")
      if (u.pathname === "/atms/withdraw/whoami") {
        if (user === "badstore") return json(res, 401, { detail: "login failed" })
        return json(res, 200, { username: user, email: user === "store1" ? "store1@menatransport.co.th" : "someone.else@menatransport.co.th", name: "สโตร์ 1", branch: "ลาดกระบัง" })
      }
      if (u.pathname === "/atms/withdraw/options") return json(res, 200, { inventories: [{ id: 4, name: "ลาดกระบัง" }], pick_tos: [{ id: 7, name: "ซ่อมรถ" }] })
      if (u.pathname.startsWith("/atms/withdraw/lookup/")) {
        const kind = u.pathname.split("/").pop()
        if (kind === "sku") return json(res, 200, { results: [{ id: 501, code: "OIL-001", name: "น้ำมันเครื่อง" }, { id: 599, code: "NOSTOCK", name: "ไม่มีสต๊อก" }] })
        return json(res, 200, { results: [{ id: 1, label: `${kind}:${u.searchParams.get("q")}` }] })
      }
      if (u.pathname === "/atms/withdraw/issue") {
        return json(res, 200, { progress: { gm_id: 9001, done: [0], approved: true, code: "LBWD-9001" } })
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
