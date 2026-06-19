import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const col = client.db("master_data").collection("tire_change")

// Distinct sellRepairStatus values
const statuses = await col.distinct("sellRepairStatus", { branch: "latkrabang" })
console.log("=== distinct sellRepairStatus ===")
console.log(statuses)

// Sample records where sellRepairStatus = อื่นๆ
const others = await col.find(
  { branch: "latkrabang", sellRepairStatus: { $regex: "อื่น", $options: "i" } },
  { projection: { vehicle:1, tirePosition:1, serialNo:1, mileageStart:1, changeIn:1, changeOut:1, sellRepairStatus:1, isLatest:1, _id:0 } }
).limit(10).toArray()

console.log("\n=== sample อื่นๆ records ===")
others.forEach(r => console.log(JSON.stringify(r)))

// Count per status
const counts = await col.aggregate([
  { $match: { branch: "latkrabang" } },
  { $group: { _id: "$sellRepairStatus", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray()
console.log("\n=== counts by status ===")
counts.forEach(r => console.log(`  "${r._id}" → ${r.count}`))

await client.close()
