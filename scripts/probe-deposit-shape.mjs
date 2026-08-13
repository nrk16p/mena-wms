// ดูรูปแบบข้อมูลจริงของ deposit_header / deposit_items — READ ONLY, จำกัด 5 เอกสาร
// ใช้ยืนยันสมมติฐานของ lib/ap-tracking.ts: วันที่เป็น "DD/MM/YYYY" และ amount เป็น string มี comma
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

let uri = process.env.MONGO_URI
if (!uri) {
  const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
  const m = src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)
  if (!m) {
    console.error("หา MONGO_URI ไม่เจอ — ตั้ง env MONGO_URI ก่อนรันสคริปต์นี้")
    process.exit(1)
  }
  uri = m[0]
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
await client.connect()
const atms = client.db("atms")

const headers = await atms.collection("deposit_header").find({}).limit(5).toArray()
console.log("=== deposit_header (5) ===")
for (const h of headers) console.log(JSON.stringify(h))

const items = await atms.collection("deposit_items").find({}).limit(3).toArray()
console.log("\n=== deposit_items (3) ===")
for (const i of items) console.log(JSON.stringify(i))

console.log("\n=== ขนาด/index ===")
console.log("deposit_header count:", await atms.collection("deposit_header").estimatedDocumentCount())
console.log("deposit_items  count:", await atms.collection("deposit_items").estimatedDocumentCount())
console.log("indexes:", (await atms.collection("deposit_header").indexes()).map((i) => i.name).join(", "))

await client.close()
