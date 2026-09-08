// scripts/ensure-price-compare-indexes.mjs — รันมือครั้งเดียว: node scripts/ensure-price-compare-indexes.mjs
import { MongoClient } from "mongodb"
import fs from "node:fs"

// MONGO_URI / MONGO_DB อยู่ใน .env — โหลด .env ก่อน แล้ว overlay .env.local ถ้ามี (ไฟล์หลังชนะ, ข้ามไฟล์ที่ไม่มี)
const parseEnvFile = (path) =>
  fs.existsSync(path)
    ? Object.fromEntries(
        fs.readFileSync(path, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]
        }),
      )
    : {}
const env = { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") }
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db = client.db(env.MONGO_DB || "master_data")
console.log(await db.collection("price_compare").createIndex({ docNo: 1 }, { unique: true }))
console.log(await db.collection("price_compare").createIndex({ status: 1, updatedAt: -1 }))
console.log(await db.collection("price_compare_log").createIndex({ docId: 1, at: -1 }))
await client.close()
