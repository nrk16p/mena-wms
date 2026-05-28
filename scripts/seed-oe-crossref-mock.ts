/**
 * Seed mock OE cross-reference data into example battery SKUs
 * to demonstrate the OE Search cross-reference logic.
 *
 * Run: MONGO_URI=... MONGO_DB=... npx tsx scripts/seed-oe-crossref-mock.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

// เบอร์อะไหล่ = own part no
// เบอร์แท้อ้างอิง = OEM part no (e.g. Panasonic, Yuasa factory code)
// เบอร์เทียบอ้างอิง = compatible part nos from other brands
//
// Scenario: battery 115D31L exists under 3 different SKUs —
//   one PRT SKU with the part no directly,
//   one PM SKU cross-referencing the same OEM no,
//   plus compat refs spanning both.

const UPDATES = [
  // Battery 115D31L — Panasonic (PRT)
  {
    SKU: "XX-PRT-ELC-BAT-BAT-0001",
    partNo:   "115D31L",
    oemRef:   "N-115D31L/A3",          // Panasonic model code
    compatRefs: ["GS-115D31L", "DIN100", "B00115D31L"],
  },
  // Battery 95D31L — Yuasa (PRT)
  {
    SKU: "XX-PRT-ELC-BAT-BAT-0002",
    partNo:   "95D31L",
    oemRef:   "YBX5110",               // Yuasa Silver
    compatRefs: ["GS-95D31L", "115D31L"],  // ← same as 0001's เบอร์อะไหล่
  },
  // Alternator — Bosch (PRT)
  {
    SKU: "XX-PRT-ELC-ALT-ALT-0001",
    partNo:   "0-124-625-030",         // Bosch
    oemRef:   "23100-E0331",           // Hino OEM
    compatRefs: ["A3TA5991", "ME049116"],
  },
  // Alternator — Hitachi reman (PRT)
  {
    SKU: "XX-PRT-ELC-ALT-ALT-0002",
    partNo:   "LR190-741",             // Hitachi
    oemRef:   "23100-E0331",           // same Hino OEM ← cross-ref hit
    compatRefs: ["0-124-625-030", "A3TA5991"],  // same as 0001's เบอร์อะไหล่ / compat
  },
  // Starter motor — Denso
  {
    SKU: "XX-PRT-ELC-ALT-ALT-0003",
    partNo:   "028000-9760",
    oemRef:   "28100-E0350",
    compatRefs: ["M008T60971", "M008T60972"],
  },
]

async function main() {
  const client = await MongoClient.connect(URI)
  const col    = client.db(DB).collection("master_sku")

  for (const u of UPDATES) {
    const res = await col.updateOne(
      { SKU: u.SKU } as never,
      {
        $set: {
          "เบอร์อะไหล่":        u.partNo,
          "เบอร์แท้อ้างอิง":   u.oemRef,
          "เบอร์เทียบอ้างอิง": u.compatRefs,
          updatedAt: new Date(),
        },
      }
    )
    if (res.matchedCount === 0) {
      console.log(`  ⚠ SKU not found: ${u.SKU}`)
    } else {
      console.log(`  ✓ ${u.SKU}  partNo="${u.partNo}"  compat=[${u.compatRefs.join(", ")}]`)
    }
  }

  await client.close()
  console.log("Done — search for '115D31L', '23100-E0331', or 'GS-95D31L' to test cross-ref")
}

main().catch((e) => { console.error(e); process.exit(1) })
