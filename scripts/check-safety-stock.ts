// scripts/check-safety-stock.ts
// รัน: npx tsx scripts/check-safety-stock.ts
// อ่านอย่างเดียว ไม่เขียนอะไรลง DB — ใช้ตรวจว่าตัวเลขที่ได้สมเหตุสมผลก่อนเปิดใช้จริง
import assert from "node:assert/strict"
import { buildSnapshotRows } from "../lib/safety-stock-build"
import { derive, INVENTORY_ID, DEFAULT_WINDOW, DEFAULT_Z, STATUS_META, WAREHOUSES } from "../lib/safety-stock-core"

// tsx คอมไพล์เป็น CommonJS — top-level await ใช้ไม่ได้ ต้องห่อใน main()
async function main() {

const asOf = new Date()
const t0 = Date.now()
const { rows, latestMovementDate, stats } = await buildSnapshotRows(INVENTORY_ID, asOf)
console.log(`⏱  ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`)

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
  const t1 = Date.now()
  const { rows: whRows, stats: whStats } = await buildSnapshotRows(wh.id, asOf)
  const sec = ((Date.now() - t1) / 1000).toFixed(1)
  const sampleCodes = whRows.slice(0, 3).map((r) => r.code).join(", ")
  console.log(
    `  inv${wh.id} (${wh.name.padEnd(14)}) แถว: ${String(whRows.length).padStart(5)} ` +
    `(min/max ทั้งคลัง ${whStats.withMinMax}) ⏱ ${sec}s  ตัวอย่างรหัส: ${sampleCodes || "-"}`
  )
  assert.ok(whRows.every((r) => r.inventoryId === wh.id), `ทุกแถวของ inv${wh.id} ต้องมี inventoryId ตรงกัน`)
}

console.log("\n✅ smoke check หลายคลัง ผ่านทั้งหมด")
process.exit(0)

}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
