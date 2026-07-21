/* รวม/แก้คำผิดชื่ออู่ใน garage_master + cascade อัปเดต repair_external.garage
 * ใช้: node scripts/merge-garages.cjs --dry   (พรีวิว + ตรวจว่าจับคำผิดครบ)
 *      node scripts/merge-garages.cjs          (เขียนจริง)
 */
require("dotenv").config({ path: ".env.local" })
require("dotenv").config({ path: ".env" })
const { MongoClient } = require("mongodb")

const DRY = process.argv.includes("--dry")
const DB  = process.env.MONGO_DB || "master_data"

// พิมพ์ผิดแบบตัวอักษรต่างกัน (จับด้วยชื่อตรงๆ ได้)
const MERGE = {
  "ช่างกี้ี้": "ช่างกี้",
  "ชางอู้ด": "ช่างอู๊ด",
  "ช่่างอู้ด": "ช่างอู๊ด",
  "ศุภนัฐ": "ศุภณัฐ",
  "ทรานสมิธ": "ทรานสมิท",
  "พรีวิลเวอร์": "พรีซิลเวอร์",
  "เอควิd": "เอควิก",
  "ทีทีแอน": "ทีทีแอนด์บี",
  "ทีที&บี": "ทีทีแอนด์บี",
  "ช่างเมฆ": "อู่เมฆ",
  "เจริญทรัพย์แบต": "เจริญทรัพย์แบตเตอรี่",
  "CK": "ซีเค",
  "ช่างเนย์": "ช่างเนย",
}

// พิมพ์ผิดแบบสระ/วรรณยุกต์ซ้ำ (byte เพี้ยน) → หา variant จาก DB ด้วย regex แล้วรวมเข้า canonical
const GROUP = [
  { canonical: "อู่เมจิก",   find: "เมจิก" },
  { canonical: "อู่เทพ",     find: "เทพ$" },
  { canonical: "ช่างตี๋",    find: "ช่างตี๋" },
  { canonical: "รุ่งทรัพย์", find: "งทรัพย์$" },
]
const DELETE = ["Test"]

async function main() {
  console.log(`\n🔧 Merge garages  (${DRY ? "DRY-RUN" : "WRITE"})`)
  const client = await new MongoClient(process.env.MONGO_URI).connect()
  const db = client.db(DB)
  const gm = db.collection("garage_master")
  const re = db.collection("repair_external")

  const names = new Set((await gm.find({}).project({ name: 1, _id: 0 }).toArray()).map((g) => g.name))

  // สร้าง map รวมทั้ง exact + group(regex)
  const map = { ...MERGE }  // variant → canonical
  for (const g of GROUP) {
    const hits = (await gm.find({ name: { $regex: g.find } }).project({ name: 1, _id: 0 }).toArray())
      .map((x) => x.name).filter((n) => n !== g.canonical)
    for (const v of hits) map[v] = g.canonical
  }

  console.log("\n— รายการที่จะรวม —")
  let missing = 0
  for (const [v, c] of Object.entries(map)) {
    const ok = names.has(v)
    if (!ok) missing++
    console.log(`  ${ok ? "✓" : "✗"}  "${v}" → "${c}"`)
  }
  for (const d of DELETE) console.log(`  ${names.has(d) ? "✓" : "✗"}  ลบ "${d}"`)
  if (missing) console.log(`\n⚠️  ไม่พบ ${missing} ตัว`)

  let totalRec = 0
  for (const [v, c] of Object.entries(map)) {
    const n = await re.countDocuments({ garage: v })
    totalRec += n
    if (n) console.log(`  cascade "${v}" → "${c}": ${n} รายการ`)
  }
  console.log(`\nสรุป: รวม ${Object.keys(map).length} คำผิด · cascade ${totalRec} รายการ · ลบ ${DELETE.length}`)

  if (DRY) { console.log("\n💡 DRY-RUN: ไม่เขียน DB\n"); await client.close(); return }
  if (missing) { console.log("\n❌ หยุด: variant ไม่ครบ\n"); await client.close(); process.exit(1) }

  let recMoved = 0, added = 0, removed = 0
  for (const [v, c] of Object.entries(map)) {
    const r = await re.updateMany({ garage: v }, { $set: { garage: c } })
    recMoved += r.modifiedCount
    if (!(await gm.findOne({ name: c }))) { await gm.insertOne({ name: c, createdAt: new Date() }); added++ }
    removed += (await gm.deleteOne({ name: v })).deletedCount
  }
  for (const del of DELETE) removed += (await gm.deleteOne({ name: del })).deletedCount

  console.log(`\n✅ cascade records: ${recMoved} · เพิ่ม canonical: ${added} · ลบชื่อผิด/Test: ${removed}`)
  console.log(`garage_master ตอนนี้: ${await gm.countDocuments()} อู่\n`)
  await client.close()
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
