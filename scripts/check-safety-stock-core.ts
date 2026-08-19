// scripts/check-safety-stock-core.ts
// รัน: npx tsx scripts/check-safety-stock-core.ts
// repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts
import assert from "node:assert/strict"
import {
  median, stdev, aduFrom, sdDailyFrom, safetyStockOf, reorderPointOf,
  daysOfSupplyOf, statusOf, minVerdictOf, suggestQtyOf, derive, mergeWarehouseResults,
  prCodeFromNote, leadTimeDaysBetween,
  DAYS_PER_MONTH, DEFAULT_Z, DEFAULT_WINDOW,
  type SnapshotRow,
} from "../lib/safety-stock-core"

// --- median: ทนค่าผิดปกติ จึงเลือกใช้แทน mean สำหรับ lead time ---
assert.equal(median([]), 0)
assert.equal(median([5]), 5)
assert.equal(median([1, 2, 3]), 2)
assert.equal(median([1, 2, 3, 4]), 2.5)
assert.equal(median([3, 1, 2]), 2, "ต้องเรียงก่อนหาค่ากลาง")
assert.equal(median([2, 2, 2, 900]), 2, "ค่าผิดปกติตัวเดียวต้องไม่ลากค่ากลาง")

// --- stdev: sample SD (หาร n-1) ---
assert.equal(stdev([]), 0)
assert.equal(stdev([5]), 0, "ตัวอย่างเดียว วัดความผันผวนไม่ได้ ต้องเป็น 0 ไม่ใช่ NaN")
assert.equal(stdev([4, 4, 4, 4]), 0)
assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.13809) < 0.0001)

// --- aduFrom: ยอดเบิกรวม ÷ จำนวนวันในหน้าต่าง ---
assert.equal(aduFrom(0, 6), 0)
assert.ok(Math.abs(aduFrom(60, 6) - 60 / (6 * DAYS_PER_MONTH)) < 1e-9)
assert.equal(aduFrom(10, 0), 0, "หน้าต่าง 0 เดือน ต้องไม่หารด้วยศูนย์")

// --- sdDailyFrom: SD รายเดือน แปลงเป็นรายวัน ---
// ใช้รายเดือนเพราะอะไหล่เบิกเป็นครั้งคราว ถ้าใช้รายวันวันที่ไม่เบิกจะเป็น 0 ทำให้ SD บวม
assert.equal(sdDailyFrom([]), 0)
assert.equal(sdDailyFrom([5, 5, 5]), 0, "เบิกเท่ากันทุกเดือน = ไม่ผันผวน")
{
  const sd = sdDailyFrom([0, 10, 5, 5, 0, 10])
  assert.ok(Math.abs(sd - stdev([0, 10, 5, 5, 0, 10]) / Math.sqrt(DAYS_PER_MONTH)) < 1e-9)
}

// --- safetyStockOf = z × SD × √LT ---
assert.equal(safetyStockOf(0, 30, 1.65), 0, "ไม่ผันผวน = ไม่ต้องมี safety stock")
assert.equal(safetyStockOf(2, 0, 1.65), 0, "lead time 0 = ของมาทันที ไม่ต้องกัน")
assert.ok(Math.abs(safetyStockOf(2, 25, 1.65) - 1.65 * 2 * 5) < 1e-9)
assert.equal(safetyStockOf(2, -5, 1.65), 0, "lead time ติดลบต้องไม่ทำให้ √ เป็น NaN")

// --- reorderPointOf = ADU × LT + SS ---
assert.equal(reorderPointOf(0, 30, 0), 0)
assert.equal(reorderPointOf(2, 10, 5), 25)

// --- daysOfSupplyOf ---
assert.equal(daysOfSupplyOf(100, 0), null, "ไม่มีการใช้ ต้องเป็น null ไม่ใช่ Infinity")
assert.equal(daysOfSupplyOf(0, 2), 0)
assert.equal(daysOfSupplyOf(50, 2), 25)

// --- statusOf: ลำดับสำคัญ no_usage ต้องมาก่อนเสมอ ---
// ถ้าไม่คัด no_usage ออกก่อน ของที่ควร "เลิกตั้ง min/max" จะไปปนกับของที่ "ต้องสั่งเพิ่ม"
assert.equal(statusOf({ usage12: 0, onHand: 0, rop: 0, minQty: 5, maxQty: 10 }), "no_usage")
assert.equal(statusOf({ usage12: 0, onHand: 99, rop: 0, minQty: 5, maxQty: 10 }), "no_usage")
assert.equal(statusOf({ usage12: 20, onHand: 0, rop: 5, minQty: 5, maxQty: 10 }), "out")
assert.equal(statusOf({ usage12: 20, onHand: -3, rop: 5, minQty: 5, maxQty: 10 }), "out", "ยอดติดลบก็คือหมด")
assert.equal(statusOf({ usage12: 20, onHand: 3, rop: 5, minQty: 2, maxQty: 10 }), "below_rop")
assert.equal(statusOf({ usage12: 20, onHand: 4, rop: 3, minQty: 5, maxQty: 10 }), "below_min")
assert.equal(statusOf({ usage12: 20, onHand: 12, rop: 3, minQty: 5, maxQty: 10 }), "over_max")
assert.equal(statusOf({ usage12: 20, onHand: 7, rop: 3, minQty: 5, maxQty: 10 }), "ok")
assert.equal(statusOf({ usage12: 20, onHand: 99, rop: 3, minQty: 5, maxQty: 0 }), "ok", "ไม่ได้ตั้ง max ต้องไม่ฟ้อง over_max")

// --- minVerdictOf ---
assert.equal(minVerdictOf(5, 10, "warehouse"), "unknown", "lead time เป็นค่ากลางทั้งคลัง ห้ามตัดสิน min")
assert.equal(minVerdictOf(0, 10, "sku"), "unknown", "ไม่ได้ตั้ง min ก็ไม่มีอะไรให้ตัดสิน")
assert.equal(minVerdictOf(5, 0, "sku"), "unknown", "ROP = 0 (ไม่มีการใช้) ตัดสินไม่ได้")
assert.equal(minVerdictOf(5, 10, "sku"), "too_low")
assert.equal(minVerdictOf(25, 10, "sku"), "too_high")
assert.equal(minVerdictOf(20, 10, "sku"), "ok", "เท่ากับ 2 เท่าพอดี ยังถือว่าโอเค")
assert.equal(minVerdictOf(10, 10, "group"), "ok")

// --- suggestQtyOf: เติมให้ถึง max ถ้ามี ไม่มีก็เติมถึง ROP + ของที่ใช้ระหว่างรอ ---
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20), 7)
assert.equal(suggestQtyOf(12, 10, 5, 0.2, 20), 0, "เกิน max แล้ว ต้องไม่แนะนำให้สั่งเพิ่ม")
assert.equal(suggestQtyOf(2, 0, 5, 0.2, 20), 7, "ไม่มี max → ROP(5) + ADU×LT(4) − onHand(2) = 7")
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20) % 1, 0, "ต้องปัดขึ้นเป็นจำนวนเต็ม สั่งของเศษไม่ได้")

// --- prCodeFromNote: เลข PR ฝังใน หมายเหตุ ของแถวรับ ---
assert.equal(prCodeFromNote("LBPR26050758/71-5742/153/โม่ใหญ่"), "LBPR26050758")
assert.equal(prCodeFromNote("LBPR26050699/STOCK"), "LBPR26050699")
assert.equal(prCodeFromNote("LBPR25120644"), "LBPR25120644", "ไม่มี / ต่อท้ายก็ต้องจับได้")
assert.equal(prCodeFromNote("  LBPR26050758/x  "), "LBPR26050758", "ต้องตัดช่องว่างหัวท้าย")
assert.equal(prCodeFromNote("LBMR26050889/71-5742"), null, "MR ไม่ใช่ PR")
assert.equal(prCodeFromNote("เข้าสต๊อกเพื่อการซ่อมบำรุง"), null)
assert.equal(prCodeFromNote(""), null)
assert.equal(prCodeFromNote(null), null)

// --- leadTimeDaysBetween: PR เป็น DD/MM/YYYY ส่วนวันที่รับเป็น Date ---
assert.equal(leadTimeDaysBetween("01/06/2026", new Date("2026-06-16T00:00:00.000Z")), 15)
assert.equal(leadTimeDaysBetween("01/06/2026", new Date("2026-06-01T00:00:00.000Z")), 0)
assert.equal(leadTimeDaysBetween("16/06/2026", new Date("2026-06-01T00:00:00.000Z")), null, "รับก่อนขอซื้อ = ข้อมูลเพี้ยน ต้องทิ้ง")
assert.equal(leadTimeDaysBetween("01/01/2024", new Date("2026-06-01T00:00:00.000Z")), null, "เกิน 365 วัน ต้องทิ้ง")
assert.equal(leadTimeDaysBetween("ไม่ใช่วันที่", new Date()), null)
assert.equal(leadTimeDaysBetween("", new Date()), null)

// --- derive: ตัวรวมที่ทั้ง job และเบราว์เซอร์เรียกใช้ ---
const ROW: SnapshotRow = {
  code: "LB02MS00149", name: "สายพาน12.5x1250", group: "ระบบเครื่องยนต์", unit: "เส้น",
  brand: "", oracleCode: "", inventoryId: "4",
  minQty: 5, maxQty: 15, stockQty: 10,
  fifoRemaining: 10, oldestAgeDays: 40,
  usage:       { m3: 9, m6: 15, m12: 24 },
  issueCounts: { m3: 9, m6: 15, m12: 24 },
  adu:         { m3: aduFrom(9, 3), m6: aduFrom(15, 6), m12: aduFrom(24, 12) },
  sdDaily:     { m3: sdDailyFrom([2, 2, 2]), m6: sdDailyFrom([2, 2, 2, 2, 2, 2]), m12: 0 },
  leadTimeDays: 20, leadTimeSource: "sku", leadTimeSamples: 5,
  cost: 250, value: 2500,
}

{
  const d = derive(ROW, DEFAULT_WINDOW, DEFAULT_Z)
  assert.ok(Math.abs(d.adu - aduFrom(15, 6)) < 1e-9)
  assert.equal(d.safetyStock, 0, "เบิกเท่ากันทุกเดือน SD = 0 จึงไม่ต้องมี safety stock")
  assert.ok(Math.abs(d.reorderPoint - aduFrom(15, 6) * 20) < 1e-2)
  assert.equal(d.status, "ok")
  assert.ok(d.daysOfSupply !== null && d.daysOfSupply > 0)
}
// สลับหน้าต่างต้องได้ ADU คนละค่า — นี่คือเหตุผลที่เก็บวัตถุดิบทั้งสามชุดไว้ในแถว
{
  const a = derive(ROW, "m3", DEFAULT_Z).adu
  const b = derive(ROW, "m12", DEFAULT_Z).adu
  assert.ok(Math.abs(a - b) > 1e-9, "m3 กับ m12 ต้องให้ ADU ต่างกัน")
}
// เพิ่ม service level ต้องได้ safety stock มากขึ้น (เมื่อมีความผันผวนจริง)
{
  const volatile: SnapshotRow = { ...ROW, sdDaily: { m3: 0.5, m6: 0.5, m12: 0.5 } }
  const lo = derive(volatile, DEFAULT_WINDOW, 1.28).safetyStock
  const hi = derive(volatile, DEFAULT_WINDOW, 2.33).safetyStock
  assert.ok(hi > lo, "service level สูงขึ้น safety stock ต้องสูงขึ้น")
}
// เคสขอบ: ไม่มีการใช้เลย
{
  const dead: SnapshotRow = {
    ...ROW, stockQty: 0,
    usage: { m3: 0, m6: 0, m12: 0 }, issueCounts: { m3: 0, m6: 0, m12: 0 },
    adu: { m3: 0, m6: 0, m12: 0 }, sdDaily: { m3: 0, m6: 0, m12: 0 },
    leadTimeDays: 30, leadTimeSource: "warehouse", leadTimeSamples: 0,
  }
  const d = derive(dead, DEFAULT_WINDOW, DEFAULT_Z)
  assert.equal(d.status, "no_usage")
  assert.equal(d.daysOfSupply, null)
  assert.equal(d.minVerdict, "unknown")
}
// เคสขอบ: min = max = 0 ต้องไม่ระเบิด (ถึงจะถูกกรองออกตั้งแต่ตอน build ก็ตาม)
{
  const d = derive({ ...ROW, minQty: 0, maxQty: 0 }, DEFAULT_WINDOW, DEFAULT_Z)
  assert.equal(d.minVerdict, "unknown")
  assert.ok(d.suggestQty >= 0)
}

// --- mergeWarehouseResults: log doc เป็น singleton ถือ results[] ของ 4 คลังรวมกัน ห้ามทับทั้งก้อน ---
type R = { inventoryId: string; upserted: number; error: string | null; skipped?: boolean }

// คลังที่รอบนี้ไม่แตะเลย (?inventory= จำกัดคลังเดียว) ต้องคงของเดิมไว้เป๊ะๆ ไม่หาย
{
  const existing: R[] = [
    { inventoryId: "4", upserted: 100, error: null },
    { inventoryId: "3", upserted: 50, error: null },
    { inventoryId: "11", upserted: 30, error: null },
    { inventoryId: "24", upserted: 20, error: null },
  ]
  const thisRun: R[] = [{ inventoryId: "24", upserted: 999, error: null }] // ?inventory=24 อย่างเดียว
  const merged = mergeWarehouseResults(existing, thisRun)
  assert.equal(merged.length, 4, "3 คลังที่ไม่ถูกแตะต้องไม่หายไปจาก array")
  assert.deepEqual(merged.find((r) => r.inventoryId === "4"), existing[0], "คลังที่ไม่แตะต้องคงเดิมทุก field")
  assert.deepEqual(merged.find((r) => r.inventoryId === "3"), existing[1])
  assert.deepEqual(merged.find((r) => r.inventoryId === "11"), existing[2])
  assert.equal(merged.find((r) => r.inventoryId === "24")?.upserted, 999, "คลังที่รันจริงรอบนี้ต้องถูกแทนที่")
}

// คลังที่ถูกข้ามเพราะ deadline ต้องคงข้อมูลเนื้อหาของเดิมไว้ (freshness ต้องยังจริง ไม่ใช่ null/0) แล้วปะ error/skipped ทับ
{
  const existing: R[] = [{ inventoryId: "4", upserted: 4100, error: null }]
  const thisRun: R[] = [{ inventoryId: "4", upserted: 0, error: "DEADLINE", skipped: true }]
  const merged = mergeWarehouseResults(existing, thisRun)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].upserted, 4100, "ถูกข้าม — ต้องคงตัวเลขของจริงรอบก่อนไว้ ไม่ใช่ทับเป็น 0")
  assert.equal(merged[0].error, "DEADLINE", "ต้องปะ error ของการข้ามทับ ให้ ok คำนวณเป็น false ได้")
  assert.equal(merged[0].skipped, true)
}

// ถูกข้ามแต่ไม่เคยมีของเดิมมาก่อนเลย (ไม่เคยรันคลังนี้สำเร็จ) — ไม่มีอะไรให้ merge ต้องใช้ค่าที่คำนวณไว้ตรงๆ
{
  const merged = mergeWarehouseResults<R>(undefined, [{ inventoryId: "24", upserted: 0, error: "DEADLINE", skipped: true }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].upserted, 0)
  assert.equal(merged[0].skipped, true)
}

// รันซ้ำหลายครั้งต้องไม่ทำให้ array บวมโต (กันซ้ำด้วย inventoryId) และคลังใหม่ที่ไม่เคยมีมาก่อนต้องต่อท้ายได้
{
  const existing: R[] = [{ inventoryId: "4", upserted: 1, error: null }]
  const thisRun: R[] = [{ inventoryId: "4", upserted: 2, error: null }, { inventoryId: "3", upserted: 5, error: null }]
  const merged = mergeWarehouseResults(existing, thisRun)
  assert.equal(merged.length, 2, "คลังใหม่ (3) ต้องถูกเติมต่อท้าย ไม่ใช่ซ้ำคลังเดิม (4)")
  assert.equal(merged[0].inventoryId, "4", "ลำดับเดิมต้องคงที่ — คลัง 4 ต้องยังอยู่ตำแหน่งแรก")
  assert.equal(merged[0].upserted, 2)
  assert.equal(merged[1].inventoryId, "3")
}

console.log("✅ check-safety-stock-core ผ่านทั้งหมด")
