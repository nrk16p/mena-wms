// scripts/seed-price-compare-uh03.mjs — ใบตัวอย่างจากต้นแบบ PC-2609-002 เพื่อเทียบ PDF กับกระดาษ
// รัน: node scripts/seed-price-compare-uh03.mjs [--clear] [--mixed] [--grades]
//   (ไม่มี flag)  ใส่ PC-2609-002 (ใบต้นแบบ UH03)
//   --mixed   ใส่ PC-2609-002 + ใบที่สอง PC-2609-999 (รายการ/suppliers เดียวกัน) เลือก supplier รายบรรทัด [1,2,2,2,3] เพื่อทดสอบโหมดผสม
//   --grades  ใส่ PC-2609-998 (ใบเทียบเกรด: Pump Rexroth 3 เกรด) — ใส่ flag นี้อย่างเดียวจะไม่แตะ 002/999 เลย
//             (--grades --mixed = ทั้งสามใบ)
//   --clear   ลบใบ seed ทั้งหมด (002 / 999 / 998 รวมรุ่นต่อท้าย -SEED) แล้วจบโดยไม่ใส่ใหม่
// ก่อนใส่ ลบเฉพาะใบที่รอบนี้จะใส่ใหม่ (ต่อ flag) — ใบ seed อื่นที่อาจถูกแก้ผ่าน UI ไว้ทดสอบจะไม่หายไปด้วย
import { MongoClient } from "mongodb"
import fs from "node:fs"

// MONGO_URI / MONGO_DB อยู่ใน .env — โหลด .env ก่อน แล้ว overlay .env.local ถ้ามี (ไฟล์หลังชนะ, ข้ามไฟล์ที่ไม่มี)
const parseEnvFile = (path) =>
  fs.existsSync(path)
    ? Object.fromEntries(
        fs.readFileSync(path, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]
        }),
      )
    : {}
const env = { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") }
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db = client.db(env.MONGO_DB || "master_data")
const col = db.collection("price_compare")
// ลบด้วย docNo ไม่ใช่ source — PUT ครั้งแรกจาก UI จะเขียนทับทั้งเอกสารและทำให้ field source หายไป
// (ลบตาม source แล้วจะเก็บใบ seed ที่เคยถูกแก้ไม่ได้) + createdBy "seed" กันลบใบจริงที่บังเอิญได้เลขเดียวกัน
const MIXED = process.argv.includes("--mixed")
const GRADES = process.argv.includes("--grades")
const BASE = !GRADES || MIXED   // --grades อย่างเดียว = ไม่ยุ่งใบ UH03 เดิม; --mixed ต้องมีใบต้นแบบเสมอ (สร้างต่อจากมัน)
const seedFilter = (docNos) => ({ docNo: { $in: docNos.flatMap((n) => [n, `${n}-SEED`]) }, createdBy: "seed" })
if (process.argv.includes("--clear")) {
  const r = await col.deleteMany(seedFilter(["PC-2609-002", "PC-2609-999", "PC-2609-998"]))
  console.log("cleared", r.deletedCount); await client.close(); process.exit(0)
}
const targets = [...(BASE ? ["PC-2609-002"] : []), ...(MIXED ? ["PC-2609-999"] : []), ...(GRADES ? ["PC-2609-998"] : [])]
const del = await col.deleteMany(seedFilter(targets))
console.log("replacing", targets.join(", "), "— deleted", del.deletedCount)

const cond = (o = {}) => ({ payment: "", leadTime: "", warranty: "", remark: "", bays: "", menaTrucksIn: "", statusA: "", statusB: "", ...o })
const sup = (name, note, prices, extra = {}, q = {}) => ({ name, note, prices, discount: 0, vatMode: "excl", quoteDate: "", validUntil: "", ...q, conditions: cond(extra), quotationFiles: [] })
const now = new Date("2026-09-07T15:30:00+07:00").toISOString().replace("Z", "+07:00")
const COMMITTEE = [
  { role: "หัวหน้าฝ่ายยานยนต์", name: "คุณเสถียรพงษ์ ชะเอมจันทร์", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
  { role: "ผจก.ฝ่ายยานยนต์", name: "บุญภัก พรหมมา", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
  { role: "ผจก.ฝ่ายจัดซื้อ", name: "", email: "", pickedSupplier: null, reason: "", signedDate: "" },
  { role: "ผู้อำนวยการสายงานธุรกิจ", name: "คุณนัชภัค ขจรวุฒิเดช", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
]
const doc = {
  source: "seed-uh03",
  docNo: "PC-2609-002", title: "Pump + Motor UH03", requestDept: "ยานยนต์",
  preparedBy: { name: "นพรัตน์ อายยืน", email: "" }, revision: 0, createdAt: now, updatedAt: now, status: "รอลงนาม",
  items: [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" }, { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ],
  suppliers: [
    sup("ช่างหมู", "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิมติดรถ", [21000, 18900, 110.56, 180, 7000]),
    sup("คุณณัฐ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 1", [30000, 18000, 100, 100, 5500], {}, { quoteDate: "2026-09-03", validUntil: "2026-10-03" }),
    sup("ศศ&ณ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 2", [30000, 25000, 107.14, 107.14, 5000]),
  ],
  committee: COMMITTEE,
  selectedSupplier: 1, selectionReason: "", fewerQuotesReason: "", links: { fleetNo: "UH03" }, evidenceFiles: [],
  createdBy: "seed", editedBy: "seed",
}
// ถ้าเลขที่ชนกับใบจริง (unique index) ให้ต่อท้าย -SEED
// insertOne แอบใส่ _id เข้าไปใน object ที่ส่งไป (mutates in place) — ส่งสำเนาไป เพื่อให้ doc ยังใช้ spread ต่อได้
const insert = async (d) => {
  try { const r = await col.insertOne({ ...d }); console.log("inserted", d.docNo, r.insertedId) }
  catch { const r = await col.insertOne({ ...d, docNo: `${d.docNo}-SEED` }); console.log("inserted (docNo suffixed)", `${d.docNo}-SEED`, r.insertedId) }
}
if (BASE) await insert(doc)

if (process.argv.includes("--mixed")) {
  // ใบตัวอย่างโหมดผสม: รายการ/suppliers เดียวกับ UH03 แต่เลือก supplier รายบรรทัด [1,2,2,2,3]
  // สุทธิรวมผสมที่คำนวณได้ = 50,076 บาท (sup1: 21000+7%=22470, sup2: 18000+1800+1000=20800+7%=22256, sup3: 5000+7%=5350 → 50076)
  const mixedDoc = {
    ...doc,
    docNo: "PC-2609-999",
    lineSupplier: [1, 2, 2, 2, 3],
    selectedSupplier: null,
    selectionReason: "",
    // ใบนี้ไม่ได้เลือก supplier รายเดียวทั้งใบ — ช่อง "เลือก supplier ลำดับที่" ของกรรมการจึงต้องว่าง ไม่ใช่ค้าง 1 จากใบต้นแบบ
    committee: COMMITTEE.map((m) => ({ ...m, pickedSupplier: null, reason: "" })),
    status: "รอลงนาม",
    createdBy: "seed", editedBy: "seed",
  }
  await insert(mixedDoc)
}

if (GRADES) {
  // ใบเทียบเกรด (spec 2026-09-11-price-compare-grades-design.md): Pump Rexroth 1 ตัว 3 เกรดเป็นแถวย่อย (group เดียวกัน ติดกัน)
  //   มือ 1 [—, 30,000, 30,000] · มือ 2 [—, —, 25,000] · ซ่อมเดิม [21,000, —, —] + HYD/เกียร์/ค่าแรงเดิม — ทุกเจ้า excl
  // เลือกถูกสุดต่อรายการ (= pickLowestPerLine) [null,null,1,2,2,3] → S1 22,470 · S2 2,996 · S3 5,350 → รวมผสม 30,816
  // มีรายการหลายเกรด = โหมดเลือกรายบรรทัดทั้งใบ → selectedSupplier null และกรรมการไม่ติ๊ก supplier รายเดียว
  const pump = (grade) => ({ name: "Pump Rexroth", qty: 1, unit: "ตัว", group: "g-pump01", grade })
  const at = "2026-09-11T09:00:00.000+07:00"
  const gradesDoc = {
    source: "seed-grades",
    docNo: "PC-2609-998", title: "Pump UH03 (เทียบเกรด)", requestDept: "ยานยนต์",
    preparedBy: { name: "นพรัตน์ อายยืน", email: "" }, revision: 0, createdAt: at, updatedAt: at, status: "รอลงนาม",
    items: [
      pump("มือ 1"), pump("มือ 2"), pump("ซ่อมเดิม"),
      { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
      { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
    ],
    suppliers: [
      sup("ช่างหมู", "ราคาซ่อม Pump ของเดิมติดรถ", [null, null, 21000, 110.56, 180, 7000]),
      sup("คุณณัฐ", "ราคาเปลี่ยน Pump ใหม่ มือ 1", [30000, null, null, 100, 100, 5500], {}, { quoteDate: "2026-09-03", validUntil: "2026-10-03" }),
      sup("ศศ&ณ", "ราคาเปลี่ยน Pump ใหม่ มือ 1 / มือ 2", [30000, 25000, null, 107.14, 107.14, 5000]),
    ],
    committee: COMMITTEE.map((m) => ({ ...m, pickedSupplier: null, reason: "" })),
    selectedSupplier: null, lineSupplier: [null, null, 1, 2, 2, 3],
    selectionReason: "", fewerQuotesReason: "", links: { fleetNo: "UH03" }, evidenceFiles: [],
    createdBy: "seed", editedBy: "seed",
  }
  await insert(gradesDoc)
}

// ดันตัวนับเดือน 2609 ให้อย่างน้อย 2 — ใบใหม่จาก API จะได้ไม่ออกเลข PC-2609-002 ซ้ำกับใบ seed นี้
await db.collection("counters").updateOne({ _id: "price_compare:2609" }, { $max: { seq: 2 } }, { upsert: true })
await client.close()
