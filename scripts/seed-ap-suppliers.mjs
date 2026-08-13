// scripts/seed-ap-suppliers.mjs
// seed เครดิตเทอมจากไฟล์ Excel เจ้าหนี้ (คอลัมน์ E=ซัพพลายเออร์, F=เครดิต) — idempotent
// รัน: node scripts/seed-ap-suppliers.mjs [path/to/file.xlsx] [--dry]
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import XLSX from "xlsx"

const DRY = process.argv.includes("--dry")
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"))
const FILE = fileArg || path.join(homedir(), "Documents/project/debt/เจ้าหนี้เดือน กค. 2026.xlsx")
const VALID = new Set(["Immediate", "7D", "15D", "30D", "60D"])

const wb = XLSX.readFile(FILE)
const counts = new Map()   // supplier -> Map(term -> n)
for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" })
  for (const r of rows.slice(1)) {
    const name = String(r[4] ?? "").trim()          // E = ซัพพลายเออร์
    const term = String(r[5] ?? "").trim()          // F = เครดิต
    if (!name || !VALID.has(term)) continue
    if (!counts.has(name)) counts.set(name, new Map())
    const m = counts.get(name)
    m.set(term, (m.get(term) ?? 0) + 1)
  }
}

const docs = []
const conflicts = []
for (const [name, terms] of counts) {
  const sorted = [...terms.entries()].sort((a, b) => b[1] - a[1])
  docs.push({ name, creditTerm: sorted[0][0] })
  if (sorted.length > 1) conflicts.push({ name, terms: Object.fromEntries(sorted) })
}

console.log(`ซัพพลายเออร์ที่พบ: ${docs.length} ราย`)
if (conflicts.length) {
  console.log(`⚠️ มีเครดิตเทอมไม่ตรงกัน ${conflicts.length} ราย (ใช้ค่าที่พบบ่อยสุด):`)
  for (const c of conflicts.slice(0, 20)) console.log("  ", c.name, JSON.stringify(c.terms))
}
if (DRY) { console.log("(--dry ไม่เขียน DB)"); process.exit(0) }

// Resolve MONGO_URI: prefer env var, fall back to extracting from check-sku-vehicles.mjs
let uri = process.env.MONGO_URI
if (!uri) {
  let src
  try {
    src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
  } catch {
    console.error("หา MONGO_URI ไม่เจอ — ตั้ง env MONGO_URI ก่อนรันสคริปต์นี้")
    process.exit(1)
  }
  const match = src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)
  if (!match) {
    console.error("หา MONGO_URI ไม่เจอ — ตั้ง env MONGO_URI ก่อนรันสคริปต์นี้")
    process.exit(1)
  }
  uri = match[0]
}

// Sanity-check URI format before connecting
if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
  console.error("หา MONGO_URI ไม่เจอ — ตั้ง env MONGO_URI ก่อนรันสคริปต์นี้")
  process.exit(1)
}
const client = new MongoClient(uri)
await client.connect()
const col = client.db("master_data").collection("ap_supplier")
await col.createIndex({ name: 1 }, { unique: true })
const res = await col.bulkWrite(
  docs.map((d) => ({
    updateOne: {
      filter: { name: d.name },
      update: { $set: { ...d, updatedBy: "seed", updatedAt: new Date().toISOString() } },
      upsert: true,
    },
  })),
  { ordered: false },
)
console.log(`upsert แล้ว: เพิ่มใหม่ ${res.upsertedCount} · แก้ ${res.modifiedCount}`)
await client.close()
