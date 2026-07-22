/* Mock data สำหรับ UAT — repair_external (workflow 7 สถานะ)
 * ใช้: node scripts/mock-repair-external.cjs         ล้างข้อมูล repair ทั้งหมด + seed ชุดใหม่
 *      node scripts/mock-repair-external.cjs --clear  ล้างอย่างเดียว
 * เก็บ garage_master ไว้ · ดึงรถ (ทะเบียน/เบอร์/ฟลีท/แพล้นท์) จาก atms.vehicle_daily
 */
require("dotenv").config({ path: ".env.local" })
require("dotenv").config({ path: ".env" })
const { MongoClient } = require("mongodb")

const CLEAR = process.argv.includes("--clear")
const DB = process.env.MONGO_DB || "master_data"
const SOURCE = "mock"

const SYMPTOMS = [
  "เบรกไม่อยู่ ผ้าเบรกหมด", "แอร์ไม่เย็น คอมเพรสเซอร์ดัง", "เครื่องสั่น รอบเดินเบาไม่นิ่ง",
  "แหนบหลังหัก", "ยางแตก ขอบล้อบิด", "ไฟโชว์เครื่องยนต์ ความร้อนขึ้น",
  "คลัตช์ลื่น เข้าเกียร์ยาก", "โช้คอัพรั่ว เสียงดังตอนตกหลุม", "หม้อน้ำรั่ว น้ำแห้ง",
  "ปั๊มลมไม่ทำงาน ลมไม่ขึ้น", "สายพานขาด", "เพลาปั่นโม่แตก",
  "ไฟหน้าไม่ติด สายไฟชอร์ต", "น้ำมันเครื่องรั่วซึม", "ระบบไฮดรอลิกอ่อน ยกกระบะไม่ขึ้น",
  "เกียร์ออโต้กระตุก", "เทอร์โบเสียงหวีด", "ล้อหน้าสั่นตอนความเร็วสูง",
]

const COMMENTS = [
  "ติดต่ออู่แล้ว รอตอบกลับราคา", "อะไหล่สั่งแล้ว มาถึงพรุ่งนี้", "ราคาสูงกว่าประเมิน ขออนุมัติเพิ่ม",
  "ลูกค้าเร่งงาน ขอให้เสร็จในสัปดาห์นี้", "เช็คแล้วเคลมประกันได้", "นัดรับรถศุกร์นี้",
  "รอ PO อนุมัติจากจัดซื้อ", "อู่แจ้งงานเพิ่ม เปลี่ยนลูกปืนล้อ",
]
const REPLIES = ["รับทราบครับ", "โอเค ดำเนินการต่อ", "ขอบคุณครับ อัปเดตให้ด้วย", "จัดให้เลย"]

// จำนวนต่อสถานะ (UAT ~37 คัน ครอบคลุมทุกขั้น)
const PLAN = [
  { status: "รอรถเข้า",         n: 6 },
  { status: "รถเข้าอู่ซ่อม",     n: 6 },
  { status: "รอใบเสนอราคา",     n: 4 },
  { status: "รออนุมัติ",        n: 5 },
  { status: "ซ่อมไม่มีกำหนด",    n: 3 },
  { status: "ซ่อมมีกำหนดเสร็จ",  n: 5 },
  { status: "รถเสร็จ",          n: 8 },
]

const WARRANTIES = ["ไม่รับประกัน", "7 วัน", "15 วัน", "1 เดือน", "3 เดือน", "6 เดือน"]
const USERS = ["สมชาย ใจดี", "ปิยะ ช่างเก่ง", "อรทัย บัญชี", "วิชัย จัดซื้อ", "นิภา ธุรการ"]
const SLA_STATUSES = ["รอรถเข้า", "รถเข้าอู่ซ่อม", "รอใบเสนอราคา", "รออนุมัติ", "ซ่อมมีกำหนดเสร็จ"]
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const rnd = (n) => Math.floor(Math.random() * n)
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (base, days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d }

async function main() {
  const client = await new MongoClient(process.env.MONGO_URI).connect()
  const db = client.db(DB)
  const repair  = db.collection("repair_external")
  const logCol  = db.collection("repair_external_log")
  const cmtCol  = db.collection("repair_external_comment")

  // ล้างข้อมูล repair ทั้งหมด (เก็บ garage_master)
  const d1 = await repair.deleteMany({})
  const d2 = await logCol.deleteMany({})
  const d3 = await cmtCol.deleteMany({})
  console.log(`🗑  ล้าง: repair ${d1.deletedCount} · log ${d2.deletedCount} · comment ${d3.deletedCount} (เก็บ garage_master)`)
  if (CLEAR) { console.log("done (clear only)"); await client.close(); return }

  const vehicles = (await client.db("atms").collection("vehicle_daily")
    .find({ "ทะเบียน": { $ne: "" }, "เบอร์รถ": { $ne: "" } })
    .project({ "ทะเบียน": 1, "เบอร์รถ": 1, "ฟลีท": 1, "แพล้นท์": 1, _id: 0 }).limit(500).toArray())
    .map((v) => ({ plate: v["ทะเบียน"], fleetNo: v["เบอร์รถ"], fleet: v["ฟลีท"] || "", plant: v["แพล้นท์"] || "" }))
  const garages = (await db.collection("garage_master").find({}).project({ name: 1, _id: 0 }).toArray()).map((g) => g.name)

  const TODAY = new Date("2026-07-21T00:00:00Z")
  const now = new Date()
  const docs = []
  let vi = 0

  for (const { status, n } of PLAN) {
    for (let i = 0; i < n; i++) {
      const v = vehicles[(vi++) % vehicles.length]
      const received = addDays(TODAY, -(2 + rnd(24)))            // รับแจ้ง 2–25 วันก่อน
      const needGarageIn = status !== "รอรถเข้า"
      const needPR = ["รอใบเสนอราคา", "รออนุมัติ", "ซ่อมมีกำหนดเสร็จ", "รถเสร็จ"].includes(status)
      const needPO = ["รออนุมัติ", "ซ่อมมีกำหนดเสร็จ", "รถเสร็จ"].includes(status)
      const garageIn = needGarageIn ? addDays(received, 1 + rnd(2)) : null

      // SLA: สลับให้ครึ่งหนึ่งค้างเกิน (3–6 วัน) ครึ่งหนึ่งปกติ (0–2 วัน) ให้ UAT เห็นทั้งสองแบบ
      const breach = SLA_STATUSES.includes(status) && i % 2 === 0
      const since  = addDays(TODAY, -(breach ? 3 + rnd(4) : rnd(3)))
      // ซ่อมมีกำหนดเสร็จ: dueDate ครึ่งอดีต (เกินกำหนด) ครึ่งอนาคต (ยังไม่ถึง)
      const dueDate = status === "ซ่อมมีกำหนดเสร็จ"
        ? iso(breach ? addDays(TODAY, -(1 + rnd(4))) : addDays(TODAY, 2 + rnd(5)))
        : ""

      docs.push({
        receivedDate:  iso(received),
        statusSince:   iso(since),
        garageInDate:  garageIn ? iso(garageIn) : "",
        dueDate,
        completedDate: status === "รถเสร็จ" ? iso(addDays(garageIn, 2 + rnd(6))) : "",
        mrNo:          Math.random() < 0.6 ? `MR68-${String(1000 + rnd(8999))}` : "",
        symptom:       pick(SYMPTOMS),
        plate:         v.plate,
        fleetNo:       String(v.fleetNo),
        fleet:         v.fleet,
        plant:         v.plant,
        garage:        pick(garages),
        status,
        prCode:        (needPR && (status !== "รอใบเสนอราคา" || i % 2 === 0)) ? `LBPR2607${String(100 + rnd(899))}` : "",
        poCode:        needPO ? `LBPO2607${String(100 + rnd(899))}` : "",
        note:          Math.random() < 0.35 ? pick(["รออะไหล่", "มีนาจัดอะไหล่", "เคลมประกัน", "งานเพิ่ม"]) : "",
        repairPrice:   ["ซ่อมมีกำหนดเสร็จ", "รถเสร็จ", "รออนุมัติ"].includes(status) ? (1000 + rnd(40) * 500) : 0,
        warranty:      status === "รถเสร็จ" ? pick(WARRANTIES) : "",
        createdBy:     pick(USERS),
        editedBy:      pick(USERS),
        source:        SOURCE,
        createdAt:     now,
        updatedAt:     now,
      })
    }
  }

  const r = await repair.insertMany(docs)

  // log (ให้ dropdown สร้างโดย/แก้ไขโดย มีรายชื่อ)
  const logs = []
  docs.forEach((d, i) => {
    const repairId = r.insertedIds[i].toString()
    logs.push({ repairId, plate: d.plate, fleetNo: d.fleetNo, action: "create", by: d.createdBy, byEmail: "", at: now, statusChange: { from: "", to: d.status }, source: SOURCE })
    logs.push({ repairId, plate: d.plate, fleetNo: d.fleetNo, action: "update", by: d.editedBy, byEmail: "", at: now, changes: [], source: SOURCE })
  })
  await logCol.insertMany(logs)

  // comment (ราว 45% ของรายการมี 1 คอมเมนต์ + บางส่วนมี reply)
  const comments = []
  docs.forEach((d, i) => {
    if (Math.random() < 0.45) {
      const repairId = r.insertedIds[i].toString()
      const c = { repairId, parentId: null, text: pick(COMMENTS), by: pick(USERS), byEmail: "", at: addDays(now, -rnd(3)) }
      comments.push(c)
    }
  })
  const cins = comments.length ? await cmtCol.insertMany(comments) : { insertedIds: {} }
  const replies = []
  Object.values(cins.insertedIds).forEach((pid, k) => {
    if (Math.random() < 0.4) {
      const parent = comments[k]
      replies.push({ repairId: parent.repairId, parentId: pid.toString(), text: pick(REPLIES), by: pick(USERS), byEmail: "", at: now })
    }
  })
  if (replies.length) await cmtCol.insertMany(replies)

  const byStatus = {}
  docs.forEach((d) => { byStatus[d.status] = (byStatus[d.status] || 0) + 1 })
  console.log(`✅ seed: ${r.insertedCount} รายการ · log ${logs.length} · comment ${comments.length + replies.length}`)
  console.log("แยกตามสถานะ:", JSON.stringify(byStatus))
  await client.close()
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
