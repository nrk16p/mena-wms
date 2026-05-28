/**
 * Seed script: loads all code dictionaries into MongoDB master_codes collection
 * Run: npx tsx scripts/seed-codes.ts
 */

import { MongoClient } from "mongodb"
import {
  WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1, SUB_ASSEMBLY_L2,
  POSITION, UNIT, GRADE, VEHICLE_TYPE,
} from "../lib/codes"
import { COMPONENT_L3 } from "../lib/codes-l3"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"

if (!URI) throw new Error("Set MONGO_URI env var")

type CodeDoc = {
  _id:    string
  dict:   string
  code:   string
  th:     string
  en:     string
  parent: string | null
  order:  number
  meta:   Record<string, unknown>
}

async function seed() {
  const client = new MongoClient(URI)
  await client.connect()
  const col = client.db(DB).collection<CodeDoc>("master_codes")

  const ops: CodeDoc[] = []
  let order = 0

  // WAREHOUSE
  for (const [code, th] of Object.entries(WAREHOUSE)) {
    ops.push({ _id: `WAREHOUSE:${code}`, dict: "WAREHOUSE", code, th, en: code, parent: null, order: order++, meta: {} })
  }

  // EXPENSE_TYPE
  for (const [code, v] of Object.entries(EXPENSE_TYPE)) {
    ops.push({ _id: `EXPENSE_TYPE:${code}`, dict: "EXPENSE_TYPE", code, th: v.th, en: v.en, parent: null, order: order++, meta: { color: v.color } })
  }

  // SYSTEM_L1
  for (const [code, v] of Object.entries(SYSTEM_L1)) {
    ops.push({ _id: `SYSTEM_L1:${code}`, dict: "SYSTEM_L1", code, th: v.th, en: v.en, parent: null, order: order++, meta: {} })
  }

  // SUB_ASSEMBLY_L2
  for (const [l1, l2s] of Object.entries(SUB_ASSEMBLY_L2)) {
    order = 0
    for (const [l2, v] of Object.entries(l2s)) {
      ops.push({ _id: `SUB_ASSEMBLY_L2:${l1}:${l2}`, dict: "SUB_ASSEMBLY_L2", code: l2, th: v.th, en: v.en, parent: l1, order: order++, meta: {} })
    }
  }

  // COMPONENT_L3
  for (const [l1, l2s] of Object.entries(COMPONENT_L3)) {
    for (const [l2, l3s] of Object.entries(l2s)) {
      order = 0
      for (const [l3, v] of Object.entries(l3s)) {
        ops.push({ _id: `COMPONENT_L3:${l1}:${l2}:${l3}`, dict: "COMPONENT_L3", code: l3, th: v.th, en: v.en, parent: `${l1}:${l2}`, order: order++, meta: {} })
      }
    }
  }

  // POSITION
  for (const [code, th] of Object.entries(POSITION)) {
    ops.push({ _id: `POSITION:${code}`, dict: "POSITION", code, th, en: code, parent: null, order: order++, meta: {} })
  }

  // UNIT
  for (const [code, th] of Object.entries(UNIT)) {
    ops.push({ _id: `UNIT:${code}`, dict: "UNIT", code, th, en: code, parent: null, order: order++, meta: {} })
  }

  // GRADE
  for (const [code, th] of Object.entries(GRADE)) {
    ops.push({ _id: `GRADE:${code}`, dict: "GRADE", code, th, en: code, parent: null, order: order++, meta: {} })
  }

  // VEHICLE_TYPE
  for (const [code, v] of Object.entries(VEHICLE_TYPE)) {
    ops.push({ _id: `VEHICLE_TYPE:${code}`, dict: "VEHICLE_TYPE", code, th: v.th, en: code, parent: null, order: order++, meta: { brand: v.brand, engine: v.engine } })
  }

  // Upsert all
  const bulkOps = ops.map((doc) => ({
    replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
  }))

  const result = await col.bulkWrite(bulkOps, { ordered: false })
  console.log(`✅ Seeded ${ops.length} codes → upserted: ${result.upsertedCount} | modified: ${result.modifiedCount}`)

  // Create indexes
  await col.createIndex({ dict: 1, parent: 1, order: 1 })
  await col.createIndex({ dict: 1, code: 1 })
  console.log("✅ Indexes created")

  await client.close()
}

seed().catch((e) => { console.error(e); process.exit(1) })
