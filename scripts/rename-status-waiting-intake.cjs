/* Migration: เปลี่ยนชื่อสถานะงานอู่นอก "รอรถเข้า" → "รอประเมินการซ่อม" (2026-08-20)
 * เหตุผล: ให้ตรงกับสถานะฝั่ง Mena-Next (ATMS) ที่ใช้คำว่า "รอประเมินการซ่อม"
 *
 * ใช้:  node scripts/rename-status-waiting-intake.cjs           ← dry-run นับอย่างเดียว ไม่แก้อะไร
 *       node scripts/rename-status-waiting-intake.cjs --apply   ← เขียนจริง
 *
 * แตะ 3 จุด:
 *   1) repair_external.status
 *   2) repair_external_log.statusChange.from / .to   (ประวัติจะได้อ่านเป็นชื่อใหม่ทั้งเส้น)
 *   3) repair_external_log.changes[].from / .to      เฉพาะ element ที่ field = "status"
 */
require("dotenv").config({ path: ".env.local" })
require("dotenv").config({ path: ".env" })
const { MongoClient } = require("mongodb")

const OLD = "รอรถเข้า"
const NEW = "รอประเมินการซ่อม"
const DB = process.env.MONGO_DB || "master_data"
const APPLY = process.argv.includes("--apply")

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI
  if (!uri) throw new Error("ไม่พบ MONGODB_URI ใน .env.local")
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(DB)
  const repair = db.collection("repair_external")
  const log = db.collection("repair_external_log")

  const q1 = { status: OLD }
  const q2 = { $or: [{ "statusChange.from": OLD }, { "statusChange.to": OLD }] }
  const q3 = { changes: { $elemMatch: { field: "status", $or: [{ from: OLD }, { to: OLD }] } } }

  const [n1, n2, n3, total] = await Promise.all([
    repair.countDocuments(q1),
    log.countDocuments(q2),
    log.countDocuments(q3),
    repair.estimatedDocumentCount(),
  ])

  console.log(`ฐานข้อมูล ${DB}`)
  console.log(`  repair_external          ทั้งหมด ${total} · status = "${OLD}"  → ${n1} รายการ`)
  console.log(`  repair_external_log      statusChange มี "${OLD}" → ${n2} รายการ`)
  console.log(`  repair_external_log      changes[] (field=status) มี "${OLD}" → ${n3} รายการ`)

  if (!APPLY) {
    console.log("\n[dry-run] ยังไม่เขียนอะไร — ใส่ --apply เพื่อรันจริง")
    return client.close()
  }

  console.log("\n[apply] กำลังเขียน...")
  const r1 = await repair.updateMany(q1, { $set: { status: NEW } })
  const r2a = await log.updateMany({ "statusChange.from": OLD }, { $set: { "statusChange.from": NEW } })
  const r2b = await log.updateMany({ "statusChange.to": OLD }, { $set: { "statusChange.to": NEW } })
  // changes[] เป็น array — ใช้ arrayFilters แก้เฉพาะ element ที่เป็นการเปลี่ยนสถานะ
  const r3a = await log.updateMany(q3, { $set: { "changes.$[e].from": NEW } },
    { arrayFilters: [{ "e.field": "status", "e.from": OLD }] })
  const r3b = await log.updateMany(q3, { $set: { "changes.$[e].to": NEW } },
    { arrayFilters: [{ "e.field": "status", "e.to": OLD }] })

  console.log(`  repair_external.status               แก้ ${r1.modifiedCount}`)
  console.log(`  log.statusChange.from                แก้ ${r2a.modifiedCount}`)
  console.log(`  log.statusChange.to                  แก้ ${r2b.modifiedCount}`)
  console.log(`  log.changes[].from (field=status)    แก้ ${r3a.modifiedCount}`)
  console.log(`  log.changes[].to   (field=status)    แก้ ${r3b.modifiedCount}`)

  const left = await repair.countDocuments(q1)
  console.log(`\nตรวจซ้ำ: repair_external ที่ยังเป็น "${OLD}" เหลือ ${left} รายการ`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
