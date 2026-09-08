// scripts/seed-price-compare-uh03.mjs — ใบตัวอย่างจากต้นแบบ PC-2609-002 เพื่อเทียบ PDF กับกระดาษ
// รัน: node scripts/seed-price-compare-uh03.mjs [--clear]   (ลบเฉพาะใบ seed ตามเลขที่ ก่อนใส่ใหม่)
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
// (ลบตาม source แล้วจะเก็บใบ seed ที่เคยถูกแก้ไม่ได้)
const SEED_FILTER = { docNo: { $in: ["PC-2609-002", "PC-2609-002-SEED"] }, createdBy: "seed" }
await col.deleteMany(SEED_FILTER)
if (process.argv.includes("--clear")) { console.log("cleared"); await client.close(); process.exit(0) }

const cond = (o = {}) => ({ payment: "", leadTime: "", warranty: "", remark: "", bays: "", menaTrucksIn: "", statusA: "", statusB: "", ...o })
const sup = (name, note, prices, extra = {}, q = {}) => ({ name, note, prices, discount: 0, vatMode: "excl", quoteDate: "", validUntil: "", ...q, conditions: cond(extra), quotationFiles: [] })
const now = new Date("2026-09-07T15:30:00+07:00").toISOString().replace("Z", "+07:00")
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
  committee: [
    { role: "หัวหน้าฝ่ายยานยนต์", name: "คุณเสถียรพงษ์ ชะเอมจันทร์", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
    { role: "ผจก.ฝ่ายยานยนต์", name: "บุญภัก พรหมมา", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
    { role: "ผจก.ฝ่ายจัดซื้อ", name: "", email: "", pickedSupplier: null, reason: "", signedDate: "" },
    { role: "ผู้อำนวยการสายงานธุรกิจ", name: "คุณนัชภัค ขจรวุฒิเดช", email: "", pickedSupplier: 1, reason: "", signedDate: "2026-09-07" },
  ],
  selectedSupplier: 1, selectionReason: "", fewerQuotesReason: "", links: { fleetNo: "UH03" }, evidenceFiles: [],
  createdBy: "seed", editedBy: "seed",
}
// ถ้าเลขที่ชนกับใบจริง (unique index) ให้ต่อท้าย -SEED
try { const r = await col.insertOne(doc); console.log("inserted", doc.docNo, r.insertedId) }
catch { const r = await col.insertOne({ ...doc, docNo: "PC-2609-002-SEED" }); console.log("inserted (docNo suffixed)", "PC-2609-002-SEED", r.insertedId) }
// ดันตัวนับเดือน 2609 ให้อย่างน้อย 2 — ใบใหม่จาก API จะได้ไม่ออกเลข PC-2609-002 ซ้ำกับใบ seed นี้
await db.collection("counters").updateOne({ _id: "price_compare:2609" }, { $max: { seq: 2 } }, { upsert: true })
await client.close()
