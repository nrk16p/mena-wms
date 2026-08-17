// scripts/fix-tire-request-stuck.mjs
// รัน: node scripts/fix-tire-request-stuck.mjs           (ดูแผนอย่างเดียว ไม่เขียนอะไร)
//      node scripts/fix-tire-request-stuck.mjs --apply   (ลงมือแก้จริง)
//
// แก้ข้อมูลย้อนหลังของบั๊ก "ปิดงานทับยางที่ยังไม่ถูกตัดสิน" (ดู check-tire-request-stuck.mjs)
// ตัวบั๊กเองถูกปิดที่ API แล้ว สคริปต์นี้แก้เฉพาะของที่ค้างมาก่อนหน้านั้น ทำ 2 อย่าง:
//
//   A) ทางตัน — ยางที่ยังไม่ถูกตัดสินแต่ค้างในใบที่นัด/ปิดไปแล้ว (อนุมัติไม่ได้ตลอดกาล)
//      → ย้ายออกไปตั้งเป็นคำขอใบใหม่ใบเดียว สถานะ "รออนุมัติ" คงวันที่คนขับยื่นเดิมไว้
//      ตรรกะเดียวกับ action "split" ที่ items/[itemId] เป๊ะ ๆ
//
//   B) สถานะใบไม่ตรงกับยางในใบ (เช่น ใบว่า approved แต่ยังมีเส้นรออนุมัติ)
//      → คำนวณสถานะใบใหม่จากยางที่อยู่ในใบ
//
// ไม่มีการลบข้อมูล: ยางถูกย้ายทั้งก้อนพร้อม _id เดิม และใบใหม่พก splitFromRequestId ไว้
// ตามรอยกลับได้ · ใบเดิมที่ปิดงานไปแล้วยังคงสถานะปิดอยู่ (งานนั้นเสร็จจริง)
import { readFileSync } from "node:fs"
import { MongoClient, ObjectId } from "mongodb"

const APPLY = process.argv.includes("--apply")

const readEnv = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]
        })
    )
  } catch { return {} }
}
const env = { ...readEnv(".env"), ...readEnv(".env.local") }

/** ต้องตรงกับ CARRY_FIELDS ใน app/api/tire-change-request/[id]/items/[itemId]/route.ts */
const CARRY_FIELDS = [
  "branch", "driverName", "plate", "truckNumber", "currentOdometer", "odometerPhoto",
  "fleet", "plant", "vehicleType", "requestedBy", "requestedByEmail", "source",
]

/** ลงชื่อผู้แก้ให้ตรงความจริง — นี่คือการแก้ข้อมูลย้อนหลัง ไม่ใช่การตัดสินใจของคน */
const BY = "ระบบ · แก้ข้อมูลย้อนหลัง (บั๊กปิดงานทับยางที่ยังไม่ตัดสิน)"

const st = (it) => it.status ?? "pending"
const day = (d) => d?.toISOString?.().slice(0, 10) ?? "?"
const code = (it) => it.positionCode || it.serialNo || "—"

/** กติกาเดียวกับฝั่ง API — ใบที่นัด/ปิดไปแล้วคงสถานะนั้นไว้ ถ้ายางที่เหลืออนุมัติครบ */
function statusFrom(items, current) {
  if (items.some((it) => st(it) === "pending")) return "pending"
  if (items.some((it) => st(it) === "approved")) {
    return current === "appointment" || current === "done" ? current : "approved"
  }
  return "rejected"
}

const client = new MongoClient(env.MONGO_URI)
await client.connect()
const col = client.db(env.MONGO_DB ?? "master_data").collection("tire_change_request")

console.log(APPLY ? "โหมด: ลงมือแก้จริง (--apply)\n" : "โหมด: ดูแผนอย่างเดียว — ใส่ --apply เพื่อลงมือแก้\n")
const now = new Date()
let splits = 0, statusFixes = 0

// ── A) ทางตัน → แยกเป็นคำขอใบใหม่ ──────────────────────────────────────────
console.log("=== A) ยางที่ติดทางตัน → แยกเป็นคำขอใบใหม่ ===")
const stuck = await col.find({
  status: { $in: ["appointment", "done"] },
  items: { $elemMatch: { $or: [{ status: { $exists: false } }, { status: "pending" }] } },
}).toArray()

if (!stuck.length) console.log("  (ไม่มี)")

for (const doc of stuck) {
  const items     = doc.items ?? []
  const moving    = items.filter((it) => st(it) === "pending")
  const movingIds = new Set(moving.map((it) => String(it._id)))
  const remaining = items.filter((it) => !movingIds.has(String(it._id)))

  if (!remaining.length) {
    console.log(`  ข้าม ${doc.plate}: ทุกเส้นยังไม่ถูกตัดสิน (แยกไปก็เหมือนเดิม)`)
    continue
  }

  const createdAt = moving
    .map((it) => it.createdAt)
    .filter((d) => d instanceof Date)
    .sort((a, b) => a - b)[0] ?? now
  const newStatus = statusFrom(remaining, doc.status ?? "pending")

  console.log(`\n  ${doc.plate} (${doc.branch}) _id=${doc._id}`)
  console.log(`    ย้ายออก ${moving.length} เส้น [${moving.map(code).join(", ")}] → ใบใหม่ status=pending createdAt=${day(createdAt)}`)
  console.log(`    ใบเดิมเหลือ [${remaining.map((it) => `${code(it)}:${st(it)}`).join(", ")}] status: ${doc.status} → ${newStatus}`)

  if (!APPLY) continue

  const carried = Object.fromEntries(CARRY_FIELDS.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]))
  const inserted = await col.insertOne({
    ...carried,
    status: "pending",
    createdAt,
    splitFromRequestId: doc._id,
    splitBy: BY,
    splitAt: now,
    items: moving,
  })
  const res = await col.updateOne(
    { _id: doc._id },
    {
      $pull: { items: { _id: { $in: moving.map((it) => new ObjectId(String(it._id))) } } },
      $set: { status: newStatus, updatedAt: now },
    }
  )
  if (res.modifiedCount !== 1) {
    console.log(`    ⚠ $pull ไม่เข้า (modified=${res.modifiedCount}) — ใบใหม่ ${inserted.insertedId} ถูกสร้างแล้ว ต้องเช็คด้วยมือ`)
    continue
  }
  console.log(`    ✓ ใบใหม่ _id=${inserted.insertedId}`)
  splits++
}

// ── B) สถานะใบไม่ตรงกับยางในใบ → คำนวณใหม่ ────────────────────────────────
console.log("\n\n=== B) สถานะใบไม่ตรงกับยางในใบ → คำนวณใหม่ ===")
const all = await col.find({ "items.0": { $exists: true } }).toArray()
let found = 0

for (const doc of all) {
  const items   = doc.items ?? []
  const current = doc.status ?? "pending"
  const want    = statusFrom(items, current)
  // ใบที่นัด/ปิดไปแล้วและยางครบถ้วนดีอยู่ statusFrom จะคืนค่าเดิม → ไม่แตะ
  if (want === current) continue

  found++
  console.log(`\n  ${doc.plate} (${doc.branch}) _id=${doc._id}`)
  console.log(`    ยาง [${items.map((it) => `${code(it)}:${st(it)}`).join(", ")}]`)
  console.log(`    status: ${current} → ${want}`)

  if (!APPLY) continue
  await col.updateOne({ _id: doc._id }, { $set: { status: want, updatedAt: now, statusFixedBy: BY, statusFixedAt: now } })
  console.log("    ✓ แก้แล้ว")
  statusFixes++
}
if (!found) console.log("  (ไม่มี)")

console.log(
  APPLY
    ? `\n\nสรุป: แยกใบใหม่ ${splits} ใบ · แก้สถานะ ${statusFixes} ใบ`
    : `\n\nสรุปแผน: จะแยกใบใหม่ ${stuck.length} ใบ · จะแก้สถานะ ${found} ใบ — ยังไม่มีอะไรถูกเขียน`
)

await client.close()
