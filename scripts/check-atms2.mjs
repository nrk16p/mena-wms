import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()

const smCol = client.db("atms").collection("stockmovement_v5")

// 1. Sample raw docs to see real field names
const sample = await smCol.find({}).limit(3).toArray()
console.log("=== Field names ===")
console.log(Object.keys(sample[0] || {}))
console.log("\n=== Sample doc ===")
console.log(JSON.stringify(sample[0], null, 2))

await client.close()
