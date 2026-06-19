import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()

const col = client.db("master_data").collection("vehicle_master")

const types = await col.distinct("vehicleType")
console.log("=== distinct vehicleType ===")
console.log(JSON.stringify(types, null, 2))

const sample = await col.find({}, { projection: { plate:1, vehicleType:1, _id:0 } }).limit(30).toArray()
console.log("\n=== sample vehicles ===")
sample.forEach(v => console.log(`  ${v.plate?.padEnd(12)} | ${v.vehicleType}`))

await client.close()
