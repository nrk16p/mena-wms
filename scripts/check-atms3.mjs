import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("atms").collection("stockmovement_v5")

// Get distinct item codes + names — search relevant categories
const groups = ["ระบบโม่", "ระบบไฟฟ้า", "แบตเตอรี่", "ระบบเครื่องยนต์", "ระบบความเย็น", "ระบบไฮดรอลิก", "PTO"]
const pipeline = [
  { $match: { กลุ่มสินค้า: { $in: groups } } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า", group: "$กลุ่มสินค้า" } } },
  { $sort: { "_id.group": 1, "_id.code": 1 } },
]
const results = await col.aggregate(pipeline).toArray()
console.log(`Found ${results.length} distinct items\n`)
results.forEach(r => {
  console.log(`  [${r._id.group?.padEnd(18)}]  ${r._id.code?.padEnd(16)}  ${r._id.name}`)
})

// Also search by name keywords for battery/filter/pump/seal
const keywords = ["แบตเตอรี่", "ซีลโม่", "ลูกกลิ้ง", "ปั๊มไฮดรอลิก", "ไส้กรอง", "ปั๊มน้ำ", "คลัทช์", "เกียร์โม่", "สายไฮดรอลิก"]
const pipeline2 = [
  { $match: { ชื่อสินค้า: { $in: keywords.map(k => ({ $regex: k, $options: "i" })) } } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า", group: "$กลุ่มสินค้า" } } },
  { $sort: { "_id.group": 1 } },
]

// run keyword search
const col2 = client.db("atms").collection("stockmovement_v5")
const results2 = await col2.aggregate([
  { $match: { $or: keywords.map(k => ({ ชื่อสินค้า: { $regex: k, $options: "i" } })) } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า", group: "$กลุ่มสินค้า" } } },
  { $sort: { "_id.group": 1 } },
]).toArray()

if (results2.length > 0) {
  console.log(`\n=== Keyword matches ===`)
  results2.forEach(r => console.log(`  [${r._id.group?.padEnd(18)}]  ${r._id.code?.padEnd(16)}  ${r._id.name}`))
}

await client.close()
