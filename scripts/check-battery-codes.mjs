import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("atms").collection("stockmovement_v5")

// Search by name keywords for battery items
const results = await col.aggregate([
  { $match: { ชื่อสินค้า: { $regex: "แบตเตอรี่|battery|ขั้วแบต|สายแบต|Battery|ตัดกระแส|Isolator", $options: "i" } } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า", group: "$กลุ่มสินค้า" } } },
  { $sort: { "_id.group": 1, "_id.code": 1 } },
]).toArray()

console.log(`Battery-related items (${results.length}):`)
results.forEach(r => console.log(`  [${String(r._id.group ?? "").padEnd(18)}]  ${String(r._id.code ?? "").padEnd(20)}  ${r._id.name}`))

// Also look at ELC group
const elec = await col.aggregate([
  { $match: { กลุ่มสินค้า: { $regex: "ไฟฟ้า|ELC|Electric|battery", $options: "i" } } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า", group: "$กลุ่มสินค้า" } } },
  { $sort: { "_id.group": 1, "_id.code": 1 } },
  { $limit: 50 },
]).toArray()

console.log(`\nElectrical group items (${elec.length}):`)
elec.forEach(r => console.log(`  [${String(r._id.group ?? "").padEnd(18)}]  ${String(r._id.code ?? "").padEnd(20)}  ${r._id.name}`))

await client.close()
