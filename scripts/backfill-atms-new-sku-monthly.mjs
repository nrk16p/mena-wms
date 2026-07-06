// One-time backfill of atms_new_sku_monthly from the verified ATMS activity-log
// extraction (Dec 2015 → Jul 2026, sum 21,418 = log's own total of sku "add" events).
// Ongoing months are refreshed daily by /api/cron/atms-sku-report.
// Usage: node scripts/backfill-atms-new-sku-monthly.mjs
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

const URI = "mongodb+srv://adminbew:K879w5XpBm3QL046@mn-mongodb-ops-2c8032e6.mongo.ondigitalocean.com/terminus?authSource=admin"
const client = new MongoClient(URI)
await client.connect()

const csv = readFileSync(new URL("./data/atms_new_sku_per_month.csv", import.meta.url), "utf-8")
const rows = csv.replace(/^﻿/, "").trim().split("\n").slice(1)
  .map((line) => {
    const [month, count] = line.trim().split(",")
    return { month, count: Number(count) }
  })

const col = client.db("master_data").collection("atms_new_sku_monthly")
const updatedAt = new Date()
const r = await col.bulkWrite(rows.map(({ month, count }) => ({
  updateOne: {
    filter: { month },
    update: { $set: { month, count, updatedAt } },
    upsert: true,
  },
})))
await col.createIndex({ month: 1 }, { unique: true })
await client.db("master_data").collection("atms_sku_add_events").createIndex({ skuPk: 1 }, { unique: true })
await client.db("master_data").collection("atms_sku_add_events").createIndex({ addedAt: -1 })

console.log(`months: ${rows.length}, upserted: ${r.upsertedCount}, modified: ${r.modifiedCount}`)
console.log(`sum check: ${rows.reduce((s, x) => s + x.count, 0)} (expect 21418)`)
await client.close()
