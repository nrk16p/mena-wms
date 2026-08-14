// scripts/check-deadstock.ts
// รัน: npx tsx scripts/check-deadstock.ts
// ตรวจ FIFO กับข้อมูลจริงในคลังลาดกระบัง + ยืนยันว่า query ยังใช้ index อยู่
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import {
  DB_NAME, COLL_NAME, INVENTORY_ID, LAYER_PIPELINE, ISSUE_PIPELINE, buildPayload,
  type LayerDoc, type IssueDoc,
} from "../lib/deadstock-core"

// tsx คอมไพล์เป็น CommonJS — top-level await ใช้ไม่ได้ ต้องห่อใน main()
async function main() {

const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
await client.connect()
const col = client.db(DB_NAME).collection(COLL_NAME)

// 1) query ต้องใช้ index ไม่ใช่ collscan — กติกาข้อสำคัญที่สุดของงานนี้
const plan = await col.find({ inventory_id: INVENTORY_ID, year_month: { $gte: "2026-01" } }).explain("queryPlanner")
const planJson = JSON.stringify(plan.queryPlanner?.winningPlan ?? plan)
assert.ok(planJson.includes("IXSCAN"), "query ต้องวิ่งผ่าน index")
assert.ok(!planJson.includes("COLLSCAN"), "ห้าม collscan เด็ดขาด")
console.log("✅ query plan: IXSCAN")

// 2) ดึงจริงและจับเวลา
const t0 = Date.now()
const [layers, issues] = await Promise.all([
  col.aggregate<LayerDoc>(LAYER_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
  col.aggregate<IssueDoc>(ISSUE_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
])
const dbMs = Date.now() - t0
console.log(`✅ ดึงข้อมูล: ชั้นรับ ${layers.length} · ยอดเบิก ${issues.length} · ${dbMs} ms`)
assert.ok(dbMs < 30_000, `ดึงข้อมูลช้าผิดปกติ (${dbMs} ms) — ตรวจว่ายังยุบฝั่ง Mongo อยู่ไหม`)

// 3) FIFO
const t1 = Date.now()
const p = buildPayload(layers, issues, new Date())
console.log(`✅ FIFO: ${Date.now() - t1} ms`)

console.log("\n── สรุป ──")
console.log(`ค้างทั้งหมด        ${p.summary.pendingCount} รายการ`)
console.log(`มูลค่า             ฿${p.summary.pendingValue.toLocaleString()}`)
console.log(`ค้างเกิน ${p.staleDays} วัน      ${p.summary.staleCount} รายการ · ฿${p.summary.staleValue.toLocaleString()}`)
console.log("ช่วงอายุ:", p.summary.buckets.map((b) => `${b.label}=${b.count}`).join(" · "))
console.log(`เบิกที่หา DD ไม่เจอ ${p.dataQuality.unmatchedIssueQty}`)
console.log(`ชั้นสต็อกกลางค้าง   ${p.dataQuality.stockLayersRemaining}`)
console.log("\nรายเดือน:")
for (const m of p.monthly) {
  console.log(`  ${m.ym}  ค้าง ${String(m.count).padStart(4)} · เกิน 7 วัน ${String(m.staleCount).padStart(4)} · ฿${Math.round(m.value).toLocaleString()}`)
}

// 4) ความสมเหตุสมผล (ช่วงกว้าง — ข้อมูลเดินทุกวัน)
assert.ok(p.summary.pendingCount > 0, "ต้องมีของค้างบ้าง")
assert.equal(p.summary.buckets.reduce((s, b) => s + b.count, 0), p.summary.pendingCount, "ผลรวมช่วงอายุต้องเท่ายอดรวม")
assert.equal(p.items.reduce((s, i) => s + i.layers, 0), p.summary.pendingCount, "ผลรวมรายรหัสต้องเท่ายอดรวม")
assert.ok(p.pending.every((r) => r.plate), "ทุกแถวที่แสดงต้องมีทะเบียนรถ")
assert.ok(p.pending.every((r) => r.remaining > 0), "ห้ามมีแถวคงเหลือ 0 หรือติดลบ")
assert.ok(p.monthly.length >= 1 && p.monthly[0].ym === "2026-01")

console.log("\n✅ check-deadstock: ผ่านทั้งหมด")
await client.close()

}

main().catch((e) => { console.error(e); process.exit(1) })
