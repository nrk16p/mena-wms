// scripts/sync-ap-suppliers-from-atms.mjs
// sync เครดิตเทอมจาก master ซัพพลายเออร์ของ ATMS (แทน seed-ap-suppliers.mjs ที่อ่าน Excel)
//   1) mirror ดิบทั้งชุด → atms.supplier_master (key = atmsId)
//   2) เติมเทอมให้เจ้าหนี้ที่ "มีใบ DD จริง" → master_data.ap_supplier (key = name)
// เทอมที่คนตั้งเองไว้ (updatedBy ไม่ใช่ seed/atms-sync) ไม่ถูกทับ — ย้ายไปเก็บใน override แทน
// รัน: node scripts/sync-ap-suppliers-from-atms.mjs <suppliers.json> [--dry]
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

const DRY  = process.argv.includes("--dry")
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"))
if (!FILE) { console.error("ต้องระบุ path ของ suppliers.json"); process.exit(1) }

const uri = process.env.MONGO_URI ?? (() => {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8")
  return env.split("\n").find((l) => l.startsWith("MONGO_URI="))?.slice(10).trim().replace(/^["']|["']$/g, "")
})()
if (!uri?.startsWith("mongodb")) { console.error("หา MONGO_URI ไม่เจอ"); process.exit(1) }

const s = (v) => (v == null ? "" : String(v)).trim()
const atmsSup = JSON.parse(readFileSync(FILE, "utf8"))
const now = new Date().toISOString()

const client = new MongoClient(uri)
await client.connect()
const atms = client.db("atms")
const md   = client.db("master_data")

// ── 1) mirror ดิบ ──────────────────────────────────────────────────────────
console.log(`\n[1] mirror → atms.supplier_master (${atmsSup.length} ราย)`)
if (!DRY) {
  await atms.collection("supplier_master").createIndex({ atmsId: 1 }, { unique: true })
  await atms.collection("supplier_master").createIndex({ name: 1 })
  const res = await atms.collection("supplier_master").bulkWrite(
    atmsSup.map((r) => ({ updateOne: {
      filter: { atmsId: r.atmsId },
      update: { $set: { ...r, syncedAt: now } },
      upsert: true,
    } })), { ordered: false })
  console.log(`    เพิ่มใหม่ ${res.upsertedCount} · แก้ ${res.modifiedCount}`)
} else console.log("    (--dry ข้าม)")

// ── 2) เจ้าหนี้ที่มีใบ DD จริง ─────────────────────────────────────────────
// received_at เป็น string "DD/MM/YYYY HH:mm" — เรียงตรง ๆ ไม่ได้ ต้องแปลงเป็น date ก่อนหา $max
const ddNames = await atms.collection("deposit_header").aggregate([
  { $match: { supplier: { $nin: ["", null] } } },
  { $addFields: { _d: { $dateFromString: { dateString: "$received_at", format: "%d/%m/%Y %H:%M", onError: null, onNull: null } } } },
  { $group: { _id: "$supplier", n: { $sum: 1 }, last: { $max: "$_d" } } },
]).toArray()
const ddCount = new Map(ddNames.map((g) => [s(g._id), { n: g.n, last: g.last ? g.last.toISOString().slice(0, 10) : "" }]))
console.log(`\n[2] เจ้าหนี้ที่มีใบ DD: ${ddCount.size} ราย`)

// ชื่อซ้ำใน ATMS → เลือกรายที่มี ap term ก่อน
const byName = new Map()
for (const r of atmsSup) {
  const k = s(r.name); if (!k) continue
  const prev = byName.get(k)
  if (!prev || (!prev.apTerm && r.apTerm)) byName.set(k, r)
}

const existing = new Map(
  (await md.collection("ap_supplier").find({}).toArray()).map((x) => [s(x.name), x]))

const ops = [], added = [], filled = [], kept = [], noAtms = [], noTerm = []
for (const [name, dd] of ddCount) {
  const n = dd.n
  const hit = byName.get(name)
  const cur = existing.get(name)
  if (!hit) { noAtms.push({ name, n }); continue }
  const atmsTerm = s(hit.apTerm)
  // เทอมที่มนุษย์ตั้งเอง (ไม่ใช่ seed จาก Excel และไม่ใช่ตัว sync เอง) ถือเป็น override
  const bySys    = ["", "seed", "atms-sync"].includes(s(cur?.updatedBy))
  const humanSet = cur?.creditTerm && !bySys
  const override = humanSet && s(cur.creditTerm) !== atmsTerm ? s(cur.creditTerm) : s(cur?.override)
  // ไม่ลดเทอมที่รู้อยู่แล้วให้กลายเป็นว่าง เมื่อ ATMS เว้นว่าง
  const creditTerm = override || atmsTerm || s(cur?.creditTerm)

  if (!cur) added.push({ name, n, creditTerm })
  else if (!s(cur.creditTerm) && creditTerm) filled.push({ name, n, creditTerm })
  else if (override && override !== atmsTerm) kept.push({ name, override, atmsTerm })
  if (!creditTerm) noTerm.push({ name, n, code: hit.code })

  ops.push({ updateOne: {
    filter: { name },
    update: { $set: {
      name, creditTerm,
      ...(override ? { override } : { override: "" }),
      atmsTerm, atmsId: hit.atmsId, atmsCode: s(hit.code),
      atmsType: s(hit.type), atmsBranch: s(hit.branch),
      // เก็บไว้กับแถวเลย — หน้า suppliers จะได้ไม่ต้อง aggregate deposit_header ทุกครั้งที่เปิด
      ddCount: n, lastDdAt: dd.last,
      syncedAt: now,
      ...(cur ? {} : { updatedBy: "atms-sync", updatedAt: now }),
    } },
    upsert: true,
  } })
}

const f = (n) => n.toLocaleString("th-TH")
console.log(`    เพิ่มใหม่เข้า ap_supplier : ${f(added.length)} ราย`)
console.log(`    เติมเทอมให้แถวที่ว่าง     : ${f(filled.length)} ราย`)
console.log(`    คง override ของคนไว้      : ${f(kept.length)} ราย`)
console.log(`    ไม่มีใน master ของ ATMS   : ${f(noAtms.length)} ราย`)
console.log(`    ยังไม่มีเทอมหลัง sync     : ${f(noTerm.length)} ราย`)
if (kept.length) { console.log("\n    override ที่ต่างจาก ATMS:"); kept.forEach((x) => console.log(`      ${x.name}  คน=${x.override}  ATMS=${x.atmsTerm}`)) }
if (noAtms.length) { console.log("\n    ไม่มีใน ATMS master:"); noAtms.sort((a,b)=>b.n-a.n).forEach((x) => console.log(`      ${String(x.n).padStart(4)} ใบ  ${x.name}`)) }
if (noTerm.length) { console.log("\n    ATMS เว้น ap term ว่าง:"); noTerm.sort((a,b)=>b.n-a.n).forEach((x) => console.log(`      ${String(x.n).padStart(4)} ใบ  [${x.code}] ${x.name}`)) }
console.log(`\n    ตัวอย่างที่จะเพิ่มใหม่ (15):`)
added.sort((a,b)=>b.n-a.n).slice(0,15).forEach((x) => console.log(`      ${String(x.n).padStart(4)} ใบ  ${x.creditTerm.padEnd(10)} ${x.name}`))

if (DRY) { console.log("\n(--dry ไม่เขียน ap_supplier)"); await client.close(); process.exit(0) }
await md.collection("ap_supplier").createIndex({ name: 1 }, { unique: true })
const res = await md.collection("ap_supplier").bulkWrite(ops, { ordered: false })
console.log(`\n✅ ap_supplier: เพิ่มใหม่ ${res.upsertedCount} · แก้ ${res.modifiedCount} · รวมทั้งหมด ${await md.collection("ap_supplier").countDocuments()} ราย`)
await client.close()
