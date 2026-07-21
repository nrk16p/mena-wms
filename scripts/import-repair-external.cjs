/* นำเข้าข้อมูลจากชีต "รถจอดซ่อม ศลบ. ศขก." (PR 2026.xlsx) → collection repair_external
 * ใช้: node scripts/import-repair-external.cjs --dry   (พรีวิว ไม่เขียน)
 *      node scripts/import-repair-external.cjs          (เขียนจริง)
 * idempotent: ลบเฉพาะเอกสารที่ source="pr2026-sheet" ก่อน แล้วนำเข้าใหม่ (ไม่แตะรายการที่คีย์มือ)
 */
require("dotenv").config({ path: ".env.local" })
require("dotenv").config({ path: ".env" })
const path = require("path")
const XLSX = require("xlsx")
const { MongoClient } = require("mongodb")

const DRY   = process.argv.includes("--dry")
const XLSX_PATH = "/Users/menatransport_02/Documents/project/Procument_System/PR 2026.xlsx"
const SHEET = "รถจอดซ่อม ศลบ. ศขก. "
const SOURCE = "pr2026-sheet"
const DB   = process.env.MONGO_DB || "master_data"

// ── ตัวช่วย normalize ──
const s = (v) => String(v == null ? "" : v).trim()

// วันที่ "6/7/69" (D/M/พ.ศ.2หลัก) → "2026-07-06"
function normDate(v) {
  const t = s(v)
  if (!t) return ""
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return ""
  let [, d, mo, y] = m
  d = +d; mo = +mo; y = +y
  if (y < 100) y += 2500            // 69 → 2569 (พ.ศ.)
  if (y > 2400) y -= 543            // พ.ศ. → ค.ศ.
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

const CANON_STATUS = ["รอรถเข้า","ซ่อม","นอกสถานที่","อยู่ระหว่างเช็คราคา","ใบเทียบราคา","รอใบเสนอราคา","รออนุมัติ","ซ่อมมีกำหนดเสร็จ","รถเสร็จ"]
function normStatus(v) {
  // ตัด emoji/สัญลักษณ์ + ช่องว่างซ้ำ (รวม ⏰ ⏳ ✅ 🔧 🔍 📝)
  const t = s(v).replace(/[←-⇿⌀-➿⬀-⯿\u{1F000}-\u{1FAFF}️‍]/gu, "").replace(/\s+/g, " ").trim()
  return CANON_STATUS.includes(t) ? t : t  // ถ้าไม่ตรง เก็บค่าที่ตัด emoji แล้ว
}

// "รับประกัน 1 เดือน" → "1 เดือน" · "ไม่รับประกัน" → คงไว้ · "7 วัน" → "7 วัน"
function normWarranty(v) {
  const t = s(v)
  if (!t) return ""
  if (/ไม่รับประกัน/.test(t)) return "ไม่รับประกัน"
  const m = t.match(/(\d+)\s*(วัน|เดือน|ปี)/)
  if (m) return `${m[1]} ${m[2]}`
  return t  // ค่าอิสระที่แมปไม่ได้ (เช่น "รับประกัน" เดี่ยว) — เก็บดิบไว้
}

// "20,908" → 20908
function normPrice(v) {
  const n = parseFloat(s(v).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? 0 : n
}

async function main() {
  console.log(`\n📥 Import repair_external  (${DRY ? "DRY-RUN — ไม่เขียน" : "WRITE"})`)
  const wb   = XLSX.readFile(XLSX_PATH, { cellDates: true })
  const ws   = wb.Sheets[SHEET]
  if (!ws) throw new Error(`ไม่พบชีต "${SHEET}"`)
  const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(2)
  // record จริง = มีอาการ(C=2) หรือ เบอร์รถ(D=3)
  const records = raw.filter((r) => s(r[2]) || s(r[3]))

  const client = await new MongoClient(process.env.MONGO_URI).connect()
  const db = client.db(DB)

  // ── plate จาก vehicle_master ตามเบอร์รถ ──
  const fleets = [...new Set(records.map((r) => s(r[3])).filter(Boolean))]
  const vm = await db.collection("vehicle_master")
    .find({ fleetNo: { $in: fleets } }).project({ fleetNo: 1, plate: 1, _id: 0 }).toArray()
  const plateByFleet = new Map(vm.map((v) => [String(v.fleetNo), v.plate]))

  // ── สร้างเอกสาร ──
  const now = new Date()
  const docs = records.map((r) => {
    const fleetNo = s(r[3])
    return {
      receivedDate:  normDate(r[0]),
      completedDate: "",
      mrNo:          "",
      symptom:       s(r[2]),
      plate:         plateByFleet.get(fleetNo) || "",
      fleetNo,
      garage:        s(r[4]),
      status:        normStatus(r[5]),
      prCode:        s(r[1]),
      poCode:        s(r[7]),
      note:          s(r[6]),
      repairPrice:   normPrice(r[8]),
      warranty:      normWarranty(r[9]),
      source:        SOURCE,
      createdAt:     now,
      updatedAt:     now,
    }
  })

  const garages = [...new Set(docs.map((d) => d.garage).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "th"))

  // ── สรุป/พรีวิว ──
  const withPlate = docs.filter((d) => d.plate).length
  const statusCount = {}
  docs.forEach((d) => { statusCount[d.status] = (statusCount[d.status] || 0) + 1 })
  console.log(`\nรวม ${docs.length} รายการ · มีทะเบียน ${withPlate} · ไม่มีทะเบียน ${docs.length - withPlate}`)
  console.log(`อู่ (distinct): ${garages.length}`)
  console.log("สถานะ:", JSON.stringify(statusCount, null, 0))
  console.log("\nตัวอย่าง 3 รายการที่แมปแล้ว:")
  docs.slice(0, 3).forEach((d, i) => console.log(` [${i}]`, JSON.stringify({
    receivedDate: d.receivedDate, plate: d.plate, fleetNo: d.fleetNo, garage: d.garage,
    status: d.status, prCode: d.prCode, poCode: d.poCode, repairPrice: d.repairPrice, warranty: d.warranty, symptom: d.symptom.slice(0, 30),
  })))

  if (DRY) {
    console.log("\n💡 DRY-RUN: ไม่มีการเขียน DB — รันซ้ำโดยไม่ใส่ --dry เพื่อบันทึกจริง\n")
    await client.close(); return
  }

  // ── เขียนจริง ──
  const repair = db.collection("repair_external")
  const del = await repair.deleteMany({ source: SOURCE })
  const ins = await repair.insertMany(docs)
  console.log(`\n🗑  ลบ import เก่า: ${del.deletedCount} · ✅ เพิ่มใหม่: ${ins.insertedCount}`)

  // seed garage_master (กันซ้ำ case-insensitive)
  const gcol = db.collection("garage_master")
  let added = 0
  for (const name of garages) {
    const exists = await gcol.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } })
    if (!exists) { await gcol.insertOne({ name, createdAt: now }); added++ }
  }
  console.log(`🏭 garage_master: เพิ่มอู่ใหม่ ${added} / ${garages.length}`)

  await client.close()
  console.log("\n✅ เสร็จสิ้น\n")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
