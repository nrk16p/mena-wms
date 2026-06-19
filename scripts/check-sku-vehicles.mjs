import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()

const col = client.db("master_data").collection("master_sku")

// Check how existing approved SKUs store ทะเบียนหรือรุ่นรถ
const samples = await col.find(
  { status: "approved", "ทะเบียนหรือรุ่นรถ": { $exists: true, $not: { $size: 0 } } },
  { projection: { SKU:1, "ทะเบียนหรือรุ่นรถ":1, _id:0 } }
).limit(20).toArray()

console.log("=== existing SKU vehicle field samples ===")
samples.forEach(s => console.log(`  ${s.SKU?.padEnd(30)} | ${JSON.stringify(s["ทะเบียนหรือรุ่นรถ"])}`))

// Also check our newly seeded records
const seeded = await col.find(
  { createdBy: "seed-script" },
  { projection: { SKU:1, "ทะเบียนหรือรุ่นรถ":1, _id:1 } }
).toArray()

console.log("\n=== seeded records ===")
seeded.forEach(s => console.log(`  ${s.SKU?.padEnd(30)} | ${JSON.stringify(s["ทะเบียนหรือรุ่นรถ"])}  _id:${s._id}`))

await client.close()
