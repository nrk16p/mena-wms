// ตั้ง "ระยะกำหนด" ของยางสาขาลาดกระบัง ตามเกณฑ์ที่ฝ่ายซ่อมบำรุงใช้จริง
//
// ที่มา: ~/Documents/project/[2026]ข้อมูลยางลาดกระบัง.xlsx คอลัมน์ "ระยะกำหนด"
// อ่านจาก 1,236 แถวของปี 2026 จับคู่ด้วย "ชนิดยางเก่า" (ชื่อสินค้าแบบเดียวกับ ATMS) × ตำแหน่งล้อ
// แล้วเอาค่าที่พบบ่อยที่สุดของแต่ละคู่ (เช่น ดอกบั้ง 1000-20 ล้อหลัง = 40,000 ตรงกัน 606/626 แถว)
//
// ระยะกำหนดขึ้นกับ "ตำแหน่งล้อ" ด้วย ไม่ใช่แค่รุ่นยาง — ล้อหน้าเป็นล้อบังคับเลี้ยว สึกเร็วกว่าเท่าตัว
// และเป็นเกณฑ์ของ "ลาดกระบัง" เท่านั้น สาขาอื่นยังใช้สเปคกลางเดิมจนกว่าจะได้ตัวเลขของตัวเอง
//
//   node scripts/seed-tire-spec-latkrabang.mjs          → แสดงผลอย่างเดียว
//   node scripts/seed-tire-spec-latkrabang.mjs --apply  → เขียนลง DB

import { MongoClient } from "mongodb"
import fs from "fs"

const BRANCH = "latkrabang"

// [ชื่อสินค้าตาม ATMS, ล้อหน้า, ล้อหลัง] — 0 = ไม่มีข้อมูลด้านนั้น (ระบบจะใช้ค่าอีกด้านแทน)
const SPEC = [
  ["ยางผ้าใบดอกบั้ง 1000-20",            0,  40_000],
  ["ยางผ้าใบดอกสร้อย 1000-20",      20_000,       0],
  ["ยางผ้าใบดอกสร้อย 1000-20 A1",        0,  20_000],
  ["ยางผ้าใบดอกบั้ง 1100-20",            0,  40_000],
  ["ยางผ้าใบดอกสร้อย 1100-20",      20_000,       0],
  ["ยางผ้าใบดอกสร้อย 1100-20 A1",   15_000,       0],
  ["ยางผ้าใบ 700-16 FRดอกสร้อย",    25_000,  25_000],
  ["ยางผ้าใบ Bridstone 750-16",     25_000,  25_000],
  ["ยางเรเดียล 11R22.5",           150_000, 150_000],
  ["ยางเรเดียล 11R22.5 A1",              0, 150_000],
  ["ยางเรเดียล 295/80 22.5 (ดอกบั้ง)",   0,  40_000],
  ["ยางเรเดียล 295/80 22.5 (ดอกสร้อย)", 40_000,     0],
  ["ยางเรเดียลแบบใช้ยางใน 1000 R20", 20_000,       0],
  ["ยาง R215/70R15 รถยนต์",        100_000, 100_000],
]

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
)

const apply  = process.argv.includes("--apply")
const client = new MongoClient(env.MONGO_URI)
await client.connect()
const db  = client.db(env.MONGO_DB ?? "master_data")
const col = db.collection("tire_spec_master")

// นับยางที่ใช้อยู่จริงของลาดกระบัง เพื่อให้เห็นว่าแต่ละแถวกระทบกี่เส้น
const used = await db.collection("tire_distance").aggregate([
  { $match: { branch: BRANCH } },
  { $group: { _id: "$product", n: { $sum: 1 } } },
]).toArray()
const norm  = (s) => String(s ?? "").toLowerCase().replace(/[\s.\-/_]/g, "").trim()
const count = new Map(used.map((u) => [norm(u._id), u.n]))

console.log(`ระยะกำหนดสาขาลาดกระบัง (${SPEC.length} รุ่นจากไฟล์)\n`)
console.log("  เส้นที่ใช้อยู่ | ล้อหน้า  | ล้อหลัง  | ชื่อสินค้า")
let covered = 0
for (const [name, f, r] of SPEC) {
  const n = count.get(norm(name)) ?? 0
  covered += n
  console.log(
    String(n).padStart(14), "|",
    (f ? f.toLocaleString() : "—").padStart(8), "|",
    (r ? r.toLocaleString() : "—").padStart(8), "|", name,
  )
}
const total = [...count.values()].reduce((a, b) => a + b, 0)
console.log(`\nครอบคลุม ${covered} จาก ${total} เส้นของลาดกระบัง (${(covered / total * 100).toFixed(0)}%)`)

// รุ่น "… A1" คือยางสำรองรุ่นเดียวกัน — ไฟล์เองก็ให้ค่าเท่ารุ่นหลัก
// (ดอกสร้อย 1000-20 A1 = 20,000 เท่ารุ่นหลัก · เรเดียล 11R22.5 A1 = 150,000 เท่ารุ่นหลัก)
// จึงเติมให้เฉพาะรุ่นที่ไฟล์ไม่ได้ระบุ A1 ไว้เอง — ถ้าไฟล์ระบุไว้ (เช่น 1100-20 A1 = 15,000) ใช้ของไฟล์
const A1 = []
for (const u of used) {
  const name = String(u._id ?? "").trim()
  if (!/\sA1$/.test(name)) continue
  if (SPEC.some(([n]) => norm(n) === norm(name))) continue
  const base = SPEC.find(([n]) => norm(n) === norm(name.replace(/\sA1$/, "")))
  if (base) A1.push([name, base[1], base[2]])
}
if (A1.length) {
  console.log("\nเติมรุ่นสำรอง (A1) ตามรุ่นหลัก:")
  for (const [n, f, r] of A1) {
    const c = count.get(norm(n)) ?? 0
    covered += c
    console.log(`  ${String(c).padStart(5)} เส้น | ${(f ? f.toLocaleString() : "—").padStart(8)} | ${(r ? r.toLocaleString() : "—").padStart(8)} | ${n}`)
  }
  SPEC.push(...A1)
  console.log(`ครอบคลุมรวม ${covered} จาก ${total} เส้น (${(covered / total * 100).toFixed(0)}%)`)
}

const missing = used
  .filter((u) => !SPEC.some(([name]) => norm(name) === norm(u._id)))
  .sort((a, b) => b.n - a.n).slice(0, 8)
if (missing.length) {
  console.log("\nรุ่นที่ยังไม่มีในไฟล์ (ใช้สเปคกลางเดิมไปก่อน):")
  for (const m of missing) console.log(`  ${String(m.n).padStart(5)} เส้น | ${m._id}`)
}

if (!apply) {
  console.log("\n(dry-run — ใส่ --apply เพื่อเขียนลง DB)")
} else {
  const now = new Date()
  const ops = SPEC.map(([name, f, r]) => ({
    updateOne: {
      filter: { branch: BRANCH, productName: name },
      update: {
        $set: {
          branch: BRANCH, productName: name,
          distanceFront: f, distanceRear: r,
          distance: r || f,          // ค่ารวมไว้ให้หน้าเดิมที่ยังอ่าน distance อย่างเดียว
          needsReview: false,        // มาจากเกณฑ์ที่ใช้จริง ไม่ใช่ค่าที่ระบบเดาให้
          source: "ไฟล์ข้อมูลยางลาดกระบัง 2026",
          updatedAt: now,
        },
        $setOnInsert: { brand: "ไม่ระบุ", tireSize: "-", tireModel: "-", productCode: "", createdAt: now },
      },
      upsert: true,
    },
  }))
  const res = await col.bulkWrite(ops, { ordered: false })
  console.log(`\n✅ เพิ่ม ${res.upsertedCount} · อัปเดต ${res.modifiedCount}`)
}
await client.close()
