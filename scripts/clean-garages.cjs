/* รวมชื่ออู่ที่ซ้ำ/พิมพ์ผิดใน repair_external + garage_master
 * ใช้: node scripts/clean-garages.cjs --dry   (พรีวิว)
 *      node scripts/clean-garages.cjs          (เขียนจริง)
 * จัดกลุ่มด้วย normalize (ตัด "อู่" นำหน้า, ตัดช่องว่าง, ยุบตัวอักษรซ้ำติดกัน)
 * canonical = ตัวที่พบบ่อยสุดในกลุ่ม ยกเว้นที่บังคับใน FORCE
 */
require("dotenv").config({ path: ".env.local" })
require("dotenv").config({ path: ".env" })
const { MongoClient } = require("mongodb")

const DRY = process.argv.includes("--dry")
const DB  = process.env.MONGO_DB || "master_data"

const norm = (s) =>
  String(s).replace(/^อู่\s*/, "").replace(/\s+/g, "").replace(/(.)\1+/g, "$1").toLowerCase()

// canonical ที่อยากใช้แม้ไม่ใช่ตัวที่พบบ่อยสุด
const FORCE = ["ปทุม 2", "สิริโรจน์"]
const forceByKey = {}
FORCE.forEach((c) => { forceByKey[norm(c)] = c })

async function main() {
  console.log(`\n🧹 Clean garage names  (${DRY ? "DRY-RUN" : "WRITE"})`)
  const client = await new MongoClient(process.env.MONGO_URI).connect()
  const db = client.db(DB)
  const repair = db.collection("repair_external")
  const gcol   = db.collection("garage_master")

  const agg = await repair.aggregate([
    { $match: { garage: { $ne: "" } } },
    { $group: { _id: "$garage", n: { $sum: 1 } } },
  ]).toArray()

  // จัดกลุ่มตาม normalize
  const groups = {}
  agg.forEach((g) => { (groups[norm(g._id)] = groups[norm(g._id)] || []).push({ name: g._id, n: g.n }) })

  const plan = []  // { canonical, variants: [names], moved }
  for (const [key, arr] of Object.entries(groups)) {
    if (arr.length < 2) continue
    arr.sort((a, b) => b.n - a.n)
    const canonical = forceByKey[key] || arr[0].name
    const variants  = arr.map((x) => x.name).filter((nm) => nm !== canonical)
    const moved     = arr.filter((x) => x.name !== canonical).reduce((s, x) => s + x.n, 0)
    plan.push({ canonical, variants, moved })
  }
  plan.sort((a, b) => b.moved - a.moved)

  console.log(`\nกลุ่มที่จะรวม: ${plan.length}  (ย้าย ${plan.reduce((s, p) => s + p.moved, 0)} records)\n`)
  plan.forEach((p) => console.log(`  "${p.canonical}"  ⟵  ${p.variants.map((v) => `"${v}"`).join(", ")}`))

  const distinctBefore = agg.length
  const distinctAfter  = distinctBefore - plan.reduce((s, p) => s + p.variants.length, 0)
  console.log(`\nอู่ distinct: ${distinctBefore} → ${distinctAfter}`)

  if (DRY) { console.log("\n💡 DRY-RUN: ไม่เขียน DB\n"); await client.close(); return }

  let recMoved = 0, gRemoved = 0, gEnsured = 0
  for (const p of plan) {
    const r = await repair.updateMany({ garage: { $in: p.variants } }, { $set: { garage: p.canonical } })
    recMoved += r.modifiedCount
    const d = await gcol.deleteMany({ name: { $in: p.variants } })
    gRemoved += d.deletedCount
    const ex = await gcol.findOne({ name: p.canonical })
    if (!ex) { await gcol.insertOne({ name: p.canonical, createdAt: new Date() }); gEnsured++ }
  }
  console.log(`\n✅ อัปเดต records: ${recMoved}  · ลบชื่ออู่ซ้ำใน garage_master: ${gRemoved}  · เพิ่ม canonical: ${gEnsured}`)
  console.log(`garage_master ตอนนี้: ${await gcol.countDocuments()} อู่\n`)
  await client.close()
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
