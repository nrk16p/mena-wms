// scripts/backfill-ap-sent-marked.ts
// รัน (ดูเฉย ๆ):  npx tsx scripts/backfill-ap-sent-marked.ts
// รัน (เขียนจริง): npx tsx scripts/backfill-ap-sent-marked.ts --write
//
// เติมฟิลด์ sentMarkedAt = "เวลาที่จัดซื้อกดส่งบัญชี" ให้ใบที่ส่งไปก่อนระบบเก็บฟิลด์นี้ (18/08/2026)
// แหล่งข้อมูล: log ของใบเอง — entry ล่าสุดที่ field="sent" และ action ขึ้นต้นด้วย "ส่งบัญชี"
// (กติกาเดียวกับที่ apTimeline ใช้อ่านเส้นทางสถานะ จึงได้เวลาตรงกับที่โมดัลแสดงอยู่แล้ว)
//
// ไม่มี log ให้อ่าน = ปล่อยว่างไว้ ไม่เดา — คอลัมน์ "กดส่งเมื่อ" จะขึ้น "—" ซึ่งตรงความจริงกว่าการยัดวันมั่ว
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"

type LogEntry = { action?: string; field?: string; at?: string }

async function main() {
  const write = process.argv.includes("--write")

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const dbName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (dbName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐานนั้นเป็น read-only ของ scraper")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  const col = client.db(dbName).collection("ap_tracking")

  // เฉพาะใบที่ "ส่งบัญชีแล้วแต่ยังไม่มี sentMarkedAt" — bounded และรันซ้ำได้ไม่ทำอะไรเพิ่ม
  const docs = await col.find(
    { sentDate: { $nin: ["", null] }, $or: [{ sentMarkedAt: { $exists: false } }, { sentMarkedAt: "" }] },
    { projection: { _id: 0, depositCode: 1, sentDate: 1, log: 1 } },
  ).toArray()

  console.log(`ใบที่ต้องเติม sentMarkedAt: ${docs.length}${write ? "" : "  (โหมดดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)"}`)

  let filled = 0, noLog = 0
  for (const d of docs) {
    const log = Array.isArray(d.log) ? (d.log as LogEntry[]) : []
    const hit = [...log].reverse().find((e) => e.field === "sent" && String(e.action ?? "").startsWith("ส่งบัญชี"))
    const at  = String(hit?.at ?? "")
    if (!at) { noLog++; console.log(`  – ${d.depositCode}: ไม่มี log การกดส่ง ปล่อยว่างไว้`); continue }
    console.log(`  ✓ ${d.depositCode}: กดส่ง ${at} (วันโอน ${d.sentDate})`)
    if (write) await col.updateOne({ depositCode: d.depositCode }, { $set: { sentMarkedAt: at } })
    filled++
  }

  console.log(`\nสรุป: เติมได้ ${filled} ใบ · ไม่มี log ${noLog} ใบ${write ? " · เขียนลงฐานแล้ว" : " · ยังไม่ได้เขียน"}`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
