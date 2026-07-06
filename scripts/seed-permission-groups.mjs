// Seed starter permission groups + indexes for user management.
// Usage: node scripts/seed-permission-groups.mjs
import { MongoClient } from "mongodb"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()
const db = client.db("master_data")

await db.collection("app_users").createIndex({ email: 1 }, { unique: true })
await db.collection("permission_groups").createIndex({ name: 1 }, { unique: true })

const now = new Date()
const starters = [
  { name: "ทีมจัดซื้อและยานยนต์", access: ["sku", "tire", "procurement"] },
  { name: "ทีมรายงาน",            access: ["sku", "tire", "procurement", "report"] },
]
for (const g of starters) {
  const r = await db.collection("permission_groups").updateOne(
    { name: g.name },
    { $setOnInsert: { ...g, created_at: now, updated_at: now } },
    { upsert: true }
  )
  console.log(`${g.name}: ${r.upsertedCount ? "created" : "already exists"}`)
}

console.log("groups:", (await db.collection("permission_groups").find().toArray()).map((g) => `${g.name} [${g.access.join(",")}]`))
await client.close()
