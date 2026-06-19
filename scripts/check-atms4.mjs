import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("atms").collection("stockmovement_v5")

// Get all distinct items from ระบบโม่ group
const mixerItems = await col.aggregate([
  { $match: { กลุ่มสินค้า: "ระบบโม่" } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า" } } },
  { $sort: { "_id.code": 1 } },
]).toArray()

console.log(`=== ระบบโม่ items (${mixerItems.length}) ===`)
mixerItems.forEach(r => console.log(`  ${r._id.code?.padEnd(20)}  ${r._id.name}`))

// Get all distinct items from ระบบไฟฟ้า group
const elecItems = await col.aggregate([
  { $match: { กลุ่มสินค้า: "ระบบไฟฟ้า" } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า" } } },
  { $sort: { "_id.code": 1 } },
]).toArray()

console.log(`\n=== ระบบไฟฟ้า items (${elecItems.length}) ===`)
elecItems.forEach(r => console.log(`  ${r._id.code?.padEnd(20)}  ${r._id.name}`))

// PM (maintenance) items for filters
const pmItems = await col.aggregate([
  { $match: { กลุ่มสินค้า: "ระบบบำรุงรักษา", ชื่อสินค้า: { $regex: "ไส้กรอง|กรองน้ำมัน|กรองอากาศ", $options: "i" } } },
  { $group: { _id: { code: "$รหัสสินค้า", name: "$ชื่อสินค้า" } } },
  { $sort: { "_id.code": 1 } },
]).toArray()

console.log(`\n=== PM filter items (${pmItems.length}) ===`)
pmItems.forEach(r => console.log(`  ${r._id.code?.padEnd(30)}  ${r._id.name}`))

await client.close()
