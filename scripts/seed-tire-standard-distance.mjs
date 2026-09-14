// เติม "ระยะทางที่กำหนด" ต่อรุ่นยางเข้า tire_spec_master ให้ครบทุกชื่อสินค้าที่ใช้อยู่จริง
//
// ที่มา: ATMS ตั้งชื่อยางเป็นชื่อกลางๆ ("ยางผ้าใบดอกบั้ง 1000-20") ไม่มียี่ห้อ
// สเปคเดิมที่จับคู่ด้วย ยี่ห้อ+ขนาด+รุ่น เลยแมตช์ได้แค่ 2 จาก 67 รุ่น → แท็บ "ยางถึงกำหนดเปลี่ยน" ว่างเปล่า
// สคริปต์นี้สร้างสเปคที่จับคู่ด้วย "ชื่อสินค้า" ตรงๆ พร้อมค่าเริ่มต้นตามชนิดยาง ติดธง needsReview
// ให้ฝ่ายซ่อมบำรุงเข้าไปยืนยัน/แก้ตัวเลขจริงที่หน้า /tire/master
//
//   node scripts/seed-tire-standard-distance.mjs          → แสดงผลอย่างเดียว
//   node scripts/seed-tire-standard-distance.mjs --apply  → เขียนลง DB

import { MongoClient } from "mongodb"
import fs from "fs"

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
)

// ค่าเริ่มต้นตามชนิดยาง — อิงจากสเปคที่มีอยู่แล้วในระบบ
// (Champion 1000-20 = 100,000 · Bridgestone 295/80R22.5 = 130,000 · Michelin/Otani 11R22.5 = 150,000)
// เรียงจากเฉพาะเจาะจงไปกว้าง — ยางอัดดอก/หล่อ ต้องชนะกฎขนาดยาง
const RULES = [
  { re: /หล่อ/,                          km:  50_000, note: "ยางหล่อ" },
  { re: /อัดดอก/,                        km:  50_000, note: "ยางอัดดอก" },
  { re: /รถยนต์|\d{3}\/\d{2}R1[3-6]|R\d{3}\/\d{2}R\/?1[3-6]|195R14/, km: 50_000, note: "ยางรถยนต์" },
  { re: /9\.5R17\.5/,                    km:  80_000, note: "เรเดียล 9.5R17.5" },
  { re: /295\/80|295\/22\.5/,            km: 130_000, note: "เรเดียล 295/80R22.5" },
  { re: /11R22\.5/,                      km: 130_000, note: "เรเดียล 11R22.5" },
  { re: /1000R-?20/,                     km: 120_000, note: "เรเดียล 1000R-20" },
  { re: /1000[-.]20|1100-20|P\.?1000[-.]?20/, km: 100_000, note: "ผ้าใบ 1000-20 / 1100-20" },
  { re: /700-1[56]|750-1[56]|825-16/,    km:  60_000, note: "ผ้าใบรถเล็ก" },
]

// ไม่ใช่ยางเส้น — ATMS บันทึกปนมาในช่องเดียวกัน ข้ามไป
const NOT_A_TIRE = /ยางรองคอ|ถอดแกะยาง/

const BRANDS = ["Bridgestone", "Bridstone", "Michelin", "Yokohama", "Otani", "Deestone", "ดีสโตน",
                "Dayton", "Hankook", "GOODRICH", "WEST LAKE", "Kapsen", "DOUBLE COIN", "Good ride", "Champion"]

const SIZE_RE = /(\d{3}\/\d{2}R?\d{2}\.?\d?|\d{3,4}R-?\d{2}|\d{2}R\d{2}\.\d|\d{3,4}[-.]\d{2}|\d{3}\/\d{2}R\/?\d{2}|9\.5R17\.5)/

function classify(name) {
  const flat = name.replace(/\s+/g, "")
  for (const r of RULES) if (r.re.test(flat)) return r
  return { km: 0, note: "ต้องกรอกเอง" }
}

function parse(name) {
  const brand = BRANDS.find((b) => name.toLowerCase().includes(b.toLowerCase())) ?? "ไม่ระบุ"
  // "295/80 22.5" ที่ ATMS เขียนตกตัว R — เติมกลับก่อน ไม่งั้นจับได้เป็น "295/8022.5"
  const flat  = name.replace(/\s+/g, "").replace(/(\d{3}\/\d{2})(\d{2}\.\d)/, "$1R$2")
  const size  = flat.match(SIZE_RE)?.[0] ?? "-"
  const model = name.match(/ดอกบั้ง|ดอกสร้อย|อัดดอก|หล่อ|ดอกหน้า/)?.[0]
             ?? name.match(/ลาย ?\d+|SV\d+|A[12]\b/)?.[0] ?? "-"
  return { brand, tireSize: size, tireModel: model }
}

const apply  = process.argv.includes("--apply")
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db = client.db(env.MONGO_DB ?? "master_data")

const products = await db.collection("tire_change").aggregate([
  { $match: { isLatest: true } },
  { $group: { _id: "$product", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray()

const existing = await db.collection("tire_spec_master").find({}).toArray()
const normKey  = (s) => String(s ?? "").toLowerCase().replace(/[\s.\-/_]/g, "").trim()
// แถวที่คนยืนยันตัวเลขไปแล้ว (needsReview !== true) ห้ามเขียนทับ — รันสคริปต์ซ้ำต้องไม่ลบงานที่คนทำไว้
const haveName = new Set(existing.filter((s) => s.needsReview !== true).map((s) => normKey(s.productName)))

const rows = []
for (const p of products) {
  const name = String(p._id ?? "").trim()
  if (!name || NOT_A_TIRE.test(name)) continue
  if (haveName.has(normKey(name))) continue
  const { km, note } = classify(name)
  rows.push({ ...parse(name), productName: name, productCode: "", distance: km, tires: p.n, note })
}

console.log(`รุ่นยางที่ใช้อยู่ ${products.length} · ข้าม ${products.length - rows.length} (ไม่ใช่ยาง/มีสเปคแล้ว) · จะเพิ่ม ${rows.length}\n`)
console.log("  เส้น | ระยะ(กม.) | ชนิด                  | ชื่อสินค้า")
for (const r of rows) {
  console.log(
    String(r.tires).padStart(6), "|",
    (r.distance ? r.distance.toLocaleString() : "รอกรอก").padStart(9), "|",
    r.note.padEnd(22), "|", r.productName,
  )
}
const needInput = rows.filter((r) => !r.distance)
console.log(`\nรวมยาง ${rows.reduce((a, r) => a + r.tires, 0)} เส้น · ต้องกรอกเอง ${needInput.length} รุ่น (${needInput.reduce((a, r) => a + r.tires, 0)} เส้น)`)

if (!apply) {
  console.log("\n(dry-run — ใส่ --apply เพื่อเขียนลง DB)")
} else {
  const now = new Date()
  const ops = rows.map((r) => ({
    updateOne: {
      filter: { productName: r.productName },
      update: {
        $set: { brand: r.brand, tireSize: r.tireSize, tireModel: r.tireModel, productName: r.productName,
                productCode: "", distance: r.distance, needsReview: true, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      upsert: true,
    },
  }))
  if (ops.length) {
    const res = await db.collection("tire_spec_master").bulkWrite(ops, { ordered: false })
    console.log(`\n✅ เพิ่ม ${res.upsertedCount} · อัปเดต ${res.modifiedCount}`)
  }
}
await client.close()
