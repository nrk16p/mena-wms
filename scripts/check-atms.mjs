import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()

// 1. Check existing approved SKUs with ATMS codes
const skuCol = client.db("master_data").collection("master_sku")
const withAtms = await skuCol.find(
  { status: "approved", รหัสATMS: { $exists: true, $not: { $size: 0 } } },
  { projection: { SKU:1, ชื่ออะไหล่_TH:1, รหัสATMS:1, ระบบ_L1:1, _id:0 } }
).limit(30).toArray()

console.log("=== Existing SKUs with ATMS codes ===")
withAtms.forEach(s => console.log(`  ${s.SKU?.padEnd(32)} L1:${s.ระบบ_L1?.padEnd(5)} ATMS:${JSON.stringify(s.รหัสATMS)}  ${s.ชื่ออะไหล่_TH}`))

// 2. Check stockmovement_v5 for item codes that relate to our parts
const smCol = client.db("atms").collection("stockmovement_v5")
const keywords = ["filter", "seal", "battery", "hydraulic", "pump", "mixer", "แบตเตอรี่", "ซีล", "ปั๊ม", "กรอง"]
const smSamples = await smCol.find(
  { $or: keywords.map(k => ({ item_description: { $regex: k, $options: "i" } })) },
  { projection: { item_code:1, item_description:1, _id:0 } }
).limit(40).toArray()

console.log("\n=== Stockmovement item codes (relevant parts) ===")
const seen = new Set()
smSamples.forEach(s => {
  if (!seen.has(s.item_code)) {
    seen.add(s.item_code)
    console.log(`  ${String(s.item_code).padEnd(20)} ${s.item_description}`)
  }
})

await client.close()
