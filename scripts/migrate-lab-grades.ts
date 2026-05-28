/**
 * Migrate labor grade codes:
 *   - Remove INH (ช่างภายในบริษัท)
 *   - Add T1 / T2 / T3 (อู่นอก Tier 1–3)
 *   - Keep CTR unchanged
 *
 * Run: MONGO_URI=... MONGO_DB=... npx tsx scripts/migrate-lab-grades.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

const NEW_LAB_GRADES = [
  { code: "T1", th: "อู่นอก Tier 1", en: "External Workshop Tier 1", note: "อู่นอกคุณภาพสูง มาตรฐาน", order: 212 },
  { code: "T2", th: "อู่นอก Tier 2", en: "External Workshop Tier 2", note: "อู่นอกทั่วไป",              order: 213 },
  { code: "T3", th: "อู่นอก Tier 3", en: "External Workshop Tier 3", note: "อู่นอกฉุกเฉิน/ราคาถูก",   order: 214 },
]

async function main() {
  const client = await MongoClient.connect(URI)
  const col    = client.db(DB).collection("master_codes")

  // Remove INH
  const del = await col.deleteMany({ dict: "GRADE", code: "INH" })
  console.log(`Deleted ${del.deletedCount} INH grade code(s)`)

  // Upsert T1 / T2 / T3 with LAB expense type tag
  for (const g of NEW_LAB_GRADES) {
    await col.updateOne(
      { _id: `GRADE:${g.code}` } as never,
      {
        $set: {
          dict:   "GRADE",
          code:   g.code,
          th:     g.th,
          en:     g.en,
          parent: null,
          order:  g.order,
          meta:   { expenseType: "LAB", note: g.note },
        },
      },
      { upsert: true }
    )
    console.log(`  ✓ ${g.code}: ${g.th}`)
  }

  await client.close()
  console.log("Done")
}

main().catch((e) => { console.error(e); process.exit(1) })
