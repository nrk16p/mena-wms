// scripts/backfill-ap-resend-marked.ts
// รัน (ดูเฉย ๆ):  npx tsx scripts/backfill-ap-resend-marked.ts [--code KKDD26090005]
// รัน (เขียนจริง): npx tsx scripts/backfill-ap-resend-marked.ts --write [--code KKDD26090005]
//
// ใบที่เคยส่งบัญชีแล้วถูกกดส่งอีกรอบ เดิม API ไม่อัปเดต sentMarkedAt (เก็บเฉพาะครั้งแรก)
// → กรอง "วันที่กดส่งบัญชี" วันที่กดจริงไม่เจอ (เคส KKDD26090005 กดส่ง 27/10/2026 13:56)
// สคริปต์นี้ตั้ง sentMarkedAt/By = การกดส่งครั้งล่าสุดใน log ของใบ (กติกา apSentMarkedRefresh)
// แตะเฉพาะใบที่ยังส่งอยู่ ยังไม่ผ่าน ยังไม่จ่าย · รันซ้ำได้ ไม่ทำอะไรเพิ่ม
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import { apSentMarkedRefresh, ictDate } from "../lib/ap-tracking"

async function main() {
  const write = process.argv.includes("--write")
  const ci = process.argv.indexOf("--code")
  const code = ci > 0 ? String(process.argv[ci + 1] ?? "").trim() : ""

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const dbName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (dbName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐานนั้นเป็น read-only ของ scraper")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  const col = client.db(dbName).collection("ap_tracking")

  const filter: Record<string, unknown> = { sentDate: { $nin: ["", null] }, "review.status": { $ne: "ผ่าน" } }
  if (code) filter.depositCode = code
  const docs = await col.find(filter, {
    projection: { _id: 0, depositCode: 1, sentDate: 1, sentType: 1, sentMarkedAt: 1, sentMarkedBy: 1, review: 1, paid: 1, log: 1 },
    maxTimeMS: 30_000,
  }).toArray()

  const todo = docs.flatMap((d) => {
    const press = apSentMarkedRefresh(d as Parameters<typeof apSentMarkedRefresh>[0])
    return press ? [{ d, press }] : []
  })
  console.log(`ตรวจ ${docs.length} ใบ · ต้องแก้เวลากดส่ง ${todo.length} ใบ${write ? "" : "  (ดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)"}`)

  let written = 0, skipped = 0
  for (const { d, press } of todo) {
    const old = String(d.sentMarkedAt ?? "")
    const rv = String((d.review as { status?: string } | undefined)?.status ?? "") || "รอตรวจ"
    console.log(`  ${d.depositCode}: กดส่ง ${old ? ictDate(old) : "—"} → ${ictDate(press.at)} โดย ${press.by || "(ไม่ทราบ)"} · ${d.sentType} ${d.sentDate} · ${rv}`)
    if (!write) continue
    // เขียนเฉพาะเมื่อค่ายังเป็นค่าที่อ่านมา — มีคนกดส่งระหว่างรันก็ไม่ทับ
    const r = await col.updateOne(
      { depositCode: d.depositCode, sentMarkedAt: d.sentMarkedAt ?? null },
      { $set: { sentMarkedAt: press.at, sentMarkedBy: press.by } },
    )
    if (r.modifiedCount) written++; else skipped++
  }

  console.log(`\nสรุป: ${write ? `เขียนแล้ว ${written} ใบ · ข้าม ${skipped} ใบ (ค่าเปลี่ยนระหว่างรัน)` : `ยังไม่ได้เขียน ${todo.length} ใบ`}`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
