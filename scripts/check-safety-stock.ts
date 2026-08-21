// scripts/check-safety-stock.ts
// รัน: npx tsx scripts/check-safety-stock.ts
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB — ใช้ตรวจว่าตัวเลขที่ได้สมเหตุสมผลก่อนเปิดใช้จริง
import assert from "node:assert/strict"
import { buildSnapshotRows, type BuildStats } from "../lib/safety-stock-build"
import {
  derive, isPartsPolicyRow, INVENTORY_ID, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS,
  EXCLUDED_PRODUCT_GROUP, STATUS_META, WAREHOUSES,
  type SnapshotRow,
} from "../lib/safety-stock-core"

// tsx คอมไพล์เป็น CommonJS — top-level await ใช้ไม่ได้ ต้องห่อใน main()
async function main() {

const asOf = new Date()

// build ทุกคลังใน WAREHOUSES ครั้งเดียว เก็บผลไว้ใช้ต่อทั้งส่วนตรวจละเอียด (คลังหลัก), smoke check
// (คลังที่เหลือ) และส่วนใหม่ (มุมมอง /safety-stock read layer) — กันยิง buildSnapshotRows ซ้ำคลังเดิม 2 รอบ
const builtByWarehouse = new Map<string, { rows: SnapshotRow[]; latestMovementDate: string | null; stats: BuildStats; sec: string }>()
for (const wh of WAREHOUSES) {
  const t = Date.now()
  const built = await buildSnapshotRows(wh.id, asOf)
  builtByWarehouse.set(wh.id, { ...built, sec: ((Date.now() - t) / 1000).toFixed(1) })
}

const { rows, latestMovementDate, stats, sec: mainSec } = builtByWarehouse.get(INVENTORY_ID)!
console.log(`⏱  ${mainSec} วินาที`)

console.log("\n=== ขอบเขต ===")
console.log("SKU ทั้งคลัง:", stats.skuTotal)
console.log("มี min หรือ max (เข้าหน้านี้):", stats.withMinMax)
console.log("เคลื่อนไหวล่าสุดใน v5:", latestMovementDate)

assert.ok(rows.length > 0, "ต้องมีอย่างน้อยหนึ่งแถว — ถ้าเป็น 0 แปลว่า sync ยังไม่ได้รัน")
assert.equal(rows.length, stats.withMinMax)
assert.ok(rows.every((r) => r.minQty > 0 || r.maxQty > 0), "ทุกแถวต้องมี min หรือ max")
assert.ok(rows.every((r) => !r.group.startsWith("ค่าแรง")), "ต้องไม่มีกลุ่มค่าแรงหลุดเข้ามา")

console.log("\n=== ที่มาของ lead time ===")
console.log("รายรหัส:", stats.ltFromSku, "· รายกลุ่ม:", stats.ltFromGroup, "· ค่ากลางทั้งคลัง:", stats.ltFromWarehouse)
console.log("จับคู่ PR ได้:", stats.prMatched, "· จับคู่ไม่ได้:", stats.prMissed)

const derived = rows.map((r) => ({ r, d: derive(r, DEFAULT_WINDOW, DEFAULT_Z) }))

console.log("\n=== การกระจายของสถานะ ===")
for (const s of STATUS_META) {
  const n = derived.filter((x) => x.d.status === s.key).length
  console.log(`  ${s.th.padEnd(18)} ${String(n).padStart(5)}  (${((n / derived.length) * 100).toFixed(1)}%)`)
}

console.log("\n=== ตรวจ min ที่ตั้งไว้ ===")
for (const v of ["too_low", "too_high", "ok", "unknown"] as const) {
  console.log(`  ${v.padEnd(10)} ${derived.filter((x) => x.d.minVerdict === v).length}`)
}

console.log("\n=== 10 อันดับแรกที่ต้องสั่ง (เรียงตามมูลค่าคงเหลือ) ===")
derived
  .filter((x) => x.d.status === "out" || x.d.status === "below_rop")
  .sort((a, b) => b.r.value - a.r.value)
  .slice(0, 10)
  .forEach(({ r, d }) =>
    console.log(
      `  ${r.code.padEnd(16)} คงเหลือ ${String(r.stockQty).padStart(6)} ROP ${String(d.reorderPoint).padStart(7)} ` +
      `LT ${String(r.leadTimeDays).padStart(5)}(${r.leadTimeSource}) สั่ง ${String(d.suggestQty).padStart(5)} ${r.name.slice(0, 24)}`
    )
  )

assert.ok(derived.every((x) => x.d.suggestQty >= 0), "จำนวนที่แนะนำให้สั่งต้องไม่ติดลบ")
assert.ok(derived.every((x) => Number.isFinite(x.d.reorderPoint)), "ROP ต้องเป็นตัวเลขเสมอ")
assert.ok(
  derived.filter((x) => x.d.minVerdict !== "unknown").every((x) => x.r.leadTimeSource !== "warehouse"),
  "ห้ามตัดสิน min เมื่อ lead time เป็นค่ากลางทั้งคลัง"
)

console.log("\n✅ check-safety-stock (คลังลาดกระบัง) ผ่านทั้งหมด")

// === smoke check หลายคลัง — อ่านอย่างเดียว ยืนยันว่า buildSnapshotRows ใช้ได้ทุกคลัง ===
console.log("\n=== smoke check หลายคลัง ===")
for (const wh of WAREHOUSES) {
  if (wh.id === INVENTORY_ID) continue // ตรวจละเอียดไปแล้วข้างบน
  const built = builtByWarehouse.get(wh.id)!
  const sampleCodes = built.rows.slice(0, 3).map((r) => r.code).join(", ")
  console.log(
    `  inv${wh.id} (${wh.name.padEnd(14)}) แถว: ${String(built.rows.length).padStart(5)} ` +
    `(min/max ทั้งคลัง ${built.stats.withMinMax}) ⏱ ${built.sec}s  ตัวอย่างรหัส: ${sampleCodes || "-"}`
  )
  assert.ok(built.rows.every((r) => r.inventoryId === wh.id), `ทุกแถวของ inv${wh.id} ต้องมี inventoryId ตรงกัน`)
}

console.log("\n✅ smoke check หลายคลัง ผ่านทั้งหมด")

// === มุมมอง /safety-stock (read layer, lib/safety-stock.ts scope="parts") — build ด้านบนคือข้อมูลดิบทั้งก้อน
// (เหมือน /tire/* เห็น) ยังไม่กรองอะไรเลย ส่วนนี้จำลองการกรองที่ getSafetyStock ทำจริงก่อนส่งออก API:
// ตัดกลุ่ม EXCLUDED_PRODUCT_GROUP ("ยาง" เป๊ะๆ) + ต้องมีทั้ง min และ max พร้อมกัน แล้วคำนวณด้วยเวลารอของนโยบาย
// คงที่ (LEAD_TIME_DAYS) แทนค่าที่วัดได้จริง — นี่คือ "การกระจายของสถานะ" ตัวจริงที่ผู้ใช้เห็นบนหน้าเว็บ ===
console.log("\n=== มุมมอง /safety-stock (read layer): ตัดกลุ่ม \"" + EXCLUDED_PRODUCT_GROUP + "\" + ต้องมีทั้ง min และ max, LT นโยบายคงที่ " + LEAD_TIME_DAYS + " วัน ===")
let combinedTotal = 0
const combinedStatusCount = new Map<string, number>()
const combinedVerdictCount = new Map<string, number>()
for (const wh of WAREHOUSES) {
  const built = builtByWarehouse.get(wh.id)!
  const partsRows = built.rows.filter(isPartsPolicyRow)
  assert.ok(partsRows.every((r) => r.minQty > 0 && r.maxQty > 0), `inv${wh.id}: ทุกแถวต้องมีทั้ง min และ max`)
  assert.ok(partsRows.every((r) => r.group !== EXCLUDED_PRODUCT_GROUP), `inv${wh.id}: ห้ามมีกลุ่ม "${EXCLUDED_PRODUCT_GROUP}" หลุดเข้ามา`)
  const partsDerived = partsRows.map((r) => ({ r, d: derive(r, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS) }))
  console.log(`  inv${wh.id} (${wh.name}) แถว: ${partsRows.length} (จาก ${built.rows.length} แถวที่มี min หรือ max อย่างใดอย่างหนึ่ง)`)
  combinedTotal += partsRows.length
  for (const s of STATUS_META) combinedStatusCount.set(s.key, (combinedStatusCount.get(s.key) ?? 0) + partsDerived.filter((x) => x.d.status === s.key).length)
  for (const v of ["too_low", "too_high", "ok", "unknown"]) combinedVerdictCount.set(v, (combinedVerdictCount.get(v) ?? 0) + partsDerived.filter((x) => x.d.minVerdict === v).length)
  // ตรวจว่าการ์ด "warehouse" ของ minVerdictOf ไม่ทำให้ unknown อีกต่อไปเมื่อมี min และมีการเบิกจริง (ROP>0) —
  // ต้องได้ verdict จริงเสมอแล้ว เพราะตอนนี้ตัดสินด้วย LT นโยบายคงที่ ("policy") ไม่ใช่ค่าที่วัดได้จริงที่อาจเป็นค่ากลางทั้งคลัง
  assert.ok(
    partsDerived.every((x) => !(x.d.minVerdict === "unknown" && x.r.minQty > 0 && x.d.reorderPoint > 0)),
    `inv${wh.id}: มี min และ ROP>0 แล้วต้องได้ verdict จริงเสมอเมื่อใช้ LT นโยบาย ไม่ใช่ unknown`
  )
}
console.log(`\nรวมทั้ง ${WAREHOUSES.length} คลัง: ${combinedTotal} แถว (คาด ~1,248 จากการตรวจ live data ไว้ก่อนแล้ว — ถ้าห่างมากให้หยุดและรายงาน ไม่ต้องปรับ)`)
console.log("--- การกระจายของสถานะ (รวม, เทียบกับตัวเลขเดิมก่อนปรับสโคป 4 คลัง: no_usage 58.1% · out 30.8% · ok 7.4% · over_max 2.2% · below_rop 1.4% · below_min 0.2%) ---")
for (const s of STATUS_META) {
  const n = combinedStatusCount.get(s.key) ?? 0
  console.log(`  ${s.th.padEnd(18)} ${String(n).padStart(5)}  (${combinedTotal ? ((n / combinedTotal) * 100).toFixed(1) : "0.0"}%)`)
}
console.log("--- ตรวจ min (รวม, LT นโยบายคงที่) ---")
for (const v of ["too_low", "too_high", "ok", "unknown"] as const) {
  console.log(`  ${v.padEnd(10)} ${combinedVerdictCount.get(v) ?? 0}`)
}

console.log("\n✅ มุมมอง /safety-stock (read layer) ผ่านทั้งหมด")
process.exit(0)

}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
