// scripts/check-safety-stock-core.ts
// รัน: npx tsx scripts/check-safety-stock-core.ts
// repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts
import assert from "node:assert/strict"
import {
  median, stdev, aduFrom, sdDailyFrom, safetyStockOf, reorderPointOf,
  daysOfSupplyOf, statusOf, minVerdictOf, suggestQtyOf, derive, mergeWarehouseResults,
  prCodeFromNote, leadTimeDaysBetween, isPartsPolicyRow,
  openPrQtyBySku, ageDaysFromDmy, ON_ORDER_MAX_AGE_DAYS,
  DAYS_PER_MONTH, DEFAULT_Z, DEFAULT_WINDOW, LEAD_TIME_DAYS, EXCLUDED_PRODUCT_GROUP, WAREHOUSES,
  type SnapshotRow,
} from "../lib/safety-stock-core"
import { parseStockLocationRows, stockHistoryUrl, ictDdmmyyyy } from "../lib/atms-parse"

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
// การ์ด "warehouse" ยังต้องอยู่ครบ — /tire/* ยังเรียก derive() แบบไม่ส่ง override เข้ามา ใช้ leadTimeSource
// ที่วัดได้จริงตรงๆ เหมือนเดิม ค่ากลางทั้งคลังยังเชื่อไม่ได้พอจะตัดสิน min เหมือนก่อนหน้านี้ทุกประการ
assert.equal(minVerdictOf(5, 10, "warehouse"), "unknown", "lead time เป็นค่ากลางทั้งคลัง ห้ามตัดสิน min")
assert.equal(minVerdictOf(0, 10, "sku"), "unknown", "ไม่ได้ตั้ง min ก็ไม่มีอะไรให้ตัดสิน")
assert.equal(minVerdictOf(5, 0, "sku"), "unknown", "ROP = 0 (ไม่มีการใช้) ตัดสินไม่ได้")
assert.equal(minVerdictOf(5, 10, "sku"), "too_low")
assert.equal(minVerdictOf(25, 10, "sku"), "too_high")
assert.equal(minVerdictOf(20, 10, "sku"), "ok", "เท่ากับ 2 เท่าพอดี ยังถือว่าโอเค")
assert.equal(minVerdictOf(10, 10, "group"), "ok")
// "policy" (เวลารอของนโยบายคงที่ที่ derive() ส่งเข้ามาเมื่อมี ltOverride) ต้องตัดสินได้ตามปกติเหมือน sku/group
// ไม่ใช่ unknown เหมือน "warehouse" — เพราะเป็นค่าคงที่ที่ตั้งใจใช้ ไม่ใช่การเดาจากค่ากลางทั้งคลัง
assert.equal(minVerdictOf(5, 10, "policy"), "too_low", "policy ต้องตัดสินได้ปกติ ไม่ใช่ unknown แบบ warehouse")
assert.equal(minVerdictOf(25, 10, "policy"), "too_high")
assert.equal(minVerdictOf(10, 10, "policy"), "ok")
assert.equal(minVerdictOf(0, 10, "policy"), "unknown", "ไม่ได้ตั้ง min ก็ยังตัดสินไม่ได้ไม่ว่า source ไหน")

// --- suggestQtyOf: เติมให้ถึง max ถ้ามี ไม่มีก็เติมถึง ROP + ของที่ใช้ระหว่างรอ ---
// เคสเดิม (usage12 ไม่ส่ง → default 1 > 0) ต้องได้ผลเหมือนก่อนแก้ทุกประการ
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20), 7)
assert.equal(suggestQtyOf(12, 10, 5, 0.2, 20), 0, "เกิน max แล้ว ต้องไม่แนะนำให้สั่งเพิ่ม")
assert.equal(suggestQtyOf(2, 0, 5, 0.2, 20), 7, "ไม่มี max → ROP(5) + ADU×LT(4) − onHand(2) = 7")
assert.equal(suggestQtyOf(3, 10, 5, 0.2, 20) % 1, 0, "ต้องปัดขึ้นเป็นจำนวนเต็ม สั่งของเศษไม่ได้")

// เคสใหม่ 4 แบบตามรีวิว — no_usage ต้องเป็น 0, max<rop ต้องไปถึง rop, onHand ติดลบต้อง clamp, max≥rop ต้องเหมือนเดิม
assert.equal(suggestQtyOf(2, 10, 5, 0.2, 20, 0), 0, "usage12<=0 (no_usage) ห้ามแนะนำให้ซื้อเพิ่มเด็ดขาด ไม่ว่า ROP/ADU จะเท่าไหร่")
assert.equal(suggestQtyOf(2, 10, 5, 0.2, 20, -3), 0, "usage12 ติดลบก็ต้องนับเป็น no_usage เหมือนกัน")
assert.equal(
  suggestQtyOf(3, 10, 15, 0.5, 20, 1), 12,
  "max(10) ต่ำกว่า ROP(15) — ต้องเติมถึง ROP ไม่ใช่แค่ max ไม่งั้นพรุ่งนี้ก็ยัง below_rop เหมือนเดิม: 15−3=12"
)
assert.equal(
  suggestQtyOf(-50, 10, 5, 0.2, 20, 1), 10,
  "onHand ติดลบ (book balance ผิดปกติ) ต้อง clamp เป็น 0 ก่อนคำนวณ ไม่ใช่เอาไปลบตรงๆ (ไม่งั้นได้ 60 ไม่ใช่ 10)"
)
assert.equal(
  suggestQtyOf(2, 20, 5, 0.2, 20, 1), 18,
  "max(20) ≥ ROP(5) แล้ว พฤติกรรมต้องเหมือนเดิมทุกประการ — เติมให้ถึง max: 20−2=18"
)

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
  assert.equal(d.suggestQty, 0, "no_usage ต้องไม่แนะนำให้ซื้อเพิ่มเลย แม้ maxQty ที่สืบทอดมาจาก ROW จะเป็น 15 ก็ตาม")
}
// เคสขอบ: min = max = 0 ต้องไม่ระเบิด (ถึงจะถูกกรองออกตั้งแต่ตอน build ก็ตาม)
{
  const d = derive({ ...ROW, minQty: 0, maxQty: 0 }, DEFAULT_WINDOW, DEFAULT_Z)
  assert.equal(d.minVerdict, "unknown")
  assert.ok(d.suggestQty >= 0)
}

// --- derive: ltOverride (เวลารอของนโยบายคงที่ที่หน้า /safety-stock ส่งเข้ามา) ---
// ไม่ใส่ override เลย: พฤติกรรมเดิมทุกประการ (ตามที่ /tire/* เรียกอยู่ต่อไป) — ใช้ r.leadTimeDays/r.leadTimeSource ตรงๆ
{
  const withoutOverride = derive(ROW, DEFAULT_WINDOW, DEFAULT_Z)
  const withOverride = derive(ROW, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS)
  assert.notEqual(withOverride.reorderPoint, withoutOverride.reorderPoint, "ltOverride ต้องเปลี่ยน ROP (คนละ LT กับ r.leadTimeDays=20)")
  assert.ok(Math.abs(withOverride.reorderPoint - aduFrom(15, 6) * LEAD_TIME_DAYS) < 1e-2, `ROP ต้องคำนวณจาก ltOverride (${LEAD_TIME_DAYS}) ไม่ใช่ r.leadTimeDays (20)`)
}
// แถวที่ leadTimeSource เป็น "warehouse" — ปกติ minVerdictOf คืน unknown เสมอ (การ์ดค่ากลางทั้งคลัง) เมื่อไม่มี
// override (พฤติกรรมเดิมของ /tire/* ต้องไม่เปลี่ยน) แต่เมื่อ derive() ได้รับ ltOverride ต้องตัดสินได้จริง เพราะตอนนี้
// เป็นการตัดสินด้วยนโยบายคงที่ ("policy") ไม่ใช่การเดาจากค่ากลางทั้งคลังอีกต่อไป
{
  const warehouseSourced: SnapshotRow = { ...ROW, leadTimeSource: "warehouse", leadTimeDays: 45 }
  const noOverride = derive(warehouseSourced, DEFAULT_WINDOW, DEFAULT_Z)
  const withOverride = derive(warehouseSourced, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS)
  assert.equal(noOverride.minVerdict, "unknown", "ไม่มี override — ยังต้อง unknown เหมือนเดิมทุกประการ (พฤติกรรมเดิมของ /tire/*)")
  assert.equal(withOverride.minVerdict, "too_high", "มี ltOverride — ต้องตัดสินได้จริง ไม่ใช่ unknown แบบ warehouse อีกต่อไป")
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

// --- WAREHOUSES: ขอบเขตที่อนุมัติ 2569-08 — เหลือ 2 คลัง ขอนแก่น (11) และ DIST (24) ต้องไม่อยู่ในนี้อีก ---
assert.equal(WAREHOUSES.length, 2, "ต้องเหลือแค่ 2 คลัง (ลาดกระบัง, สระบุรี)")
assert.deepEqual(WAREHOUSES.map((w) => w.id).sort(), ["3", "4"], "ต้องเป็นลาดกระบัง(4)+สระบุรี(3) เท่านั้น")
assert.ok(!WAREHOUSES.some((w) => w.id === "11" || w.id === "24"), "ขอนแก่น(11)/DIST(24) ต้องไม่อยู่ในขอบเขตอีกต่อไป")

// --- isPartsPolicyRow: เกณฑ์ "นโยบายอะไหล่" ที่ layer อ่าน (lib/safety-stock.ts) ใช้กรอง — ต้องมีทั้ง min และ max
// พร้อมกัน และไม่ใช่กลุ่ม "ยาง" เป๊ะๆ (เก็บ "เครื่องมือยาง" ไว้) ---
assert.equal(isPartsPolicyRow({ group: "ระบบเครื่องยนต์", minQty: 5, maxQty: 15 }), true)
assert.equal(isPartsPolicyRow({ group: "ระบบเครื่องยนต์", minQty: 5, maxQty: 0 }), false, "มีแค่ min อย่างเดียวไม่พอแล้ว (เดิม min หรือ max ก็พอ)")
assert.equal(isPartsPolicyRow({ group: "ระบบเครื่องยนต์", minQty: 0, maxQty: 15 }), false, "มีแค่ max อย่างเดียวไม่พอแล้ว")
assert.equal(isPartsPolicyRow({ group: EXCLUDED_PRODUCT_GROUP, minQty: 5, maxQty: 15 }), false, "กลุ่มยางเป๊ะๆ ต้องถูกตัดออกแม้มีทั้ง min และ max")
assert.equal(isPartsPolicyRow({ group: "เครื่องมือยาง", minQty: 5, maxQty: 15 }), true, "เครื่องมือยาง (คนละกลุ่มกับ ยาง เป๊ะๆ) ต้องยังนับรวม")

// --- สถานที่จัดเก็บ: ตำแหน่งคอลัมน์ในตารางประวัติสต๊อกของ ATMS + การแบ่งหน้าที่นิ่ง ---
// ATMS มีค่านี้ที่ /inv/stock.history/index ที่เดียว (ตาราง SKU index ไม่มี) — สองอย่างนี้พังเงียบทั้งคู่:
// คอลัมน์สลับ = เขียนหน่วยสินค้าทับสถานที่ทั้งคลัง · order_by ผิด = ได้ข้อมูลไม่ครบแต่ไม่มี error
{
  // ตัดมาจากหน้าจริง 25/08/2026 — 11 คอลัมน์: วันที่ คลังสินค้า รหัสสินค้า สินค้า กลุ่มสินค้า ยี่ห้อ
  // สินค้าคงเหลือ หน่วยสินค้า stock value สถานที่จัดเก็บ (แล้วปิดท้ายด้วยคอลัมน์ปุ่ม)
  const row = (code: string, unit: string, loc: string) =>
    `<tr><td>23/08/2026</td><td>คลังลาดกระบัง</td><td>${code}</td><td>กรองน้ำมันเครื่อง</td><td>กรอง</td>` +
    `<td>ไม่ระบุ</td><td>21.00</td><td>${unit}</td><td>1,234.00</td><td>${loc}</td><td><a href="#">แสดง</a></td></tr>`
  const html = `<table><thead><tr><th>วันที่</th></tr></thead><tbody>
    ${row("LB10PM00057", "ชิ้น", "B1-1")}
    ${row("S13OP00008", "อัน", "Shelf 4/C")}
    ${row("LB10PM00003", "ชิ้น", "")}
    <tr><td>รวม</td><td>2</td></tr>
  </tbody></table>`
  assert.deepEqual(parseStockLocationRows(html), [
    { code: "LB10PM00057", location: "B1-1" },
    { code: "S13OP00008",  location: "Shelf 4/C" },
    { code: "LB10PM00003", location: "" },        // ยังไม่ได้กรอกใน ATMS — ต้องเป็นค่าว่าง ไม่ใช่หน่วยสินค้า
  ], "คอลัมน์ที่ 3 = รหัสสินค้า, คอลัมน์ที่ 10 = สถานที่จัดเก็บ")
  assert.deepEqual(parseStockLocationRows("<html>ไม่มีตาราง</html>"), [], "หน้าที่ไม่มีตารางต้องไม่พัง")

  const url = stockHistoryUrl("4", 3, "23/08/2026")
  // ห้ามเปลี่ยนกลับเป็น sh.t_date desc (ค่าเริ่มต้นของหน้าเว็บ ATMS) — เรากรองวันเดียวทุกแถวจึงมี t_date เท่ากันหมด
  // การแบ่งหน้าเลยคืนแถวซ้ำข้ามหน้า วัดจริง 25/08/2026: สระบุรีได้ 3,000 จาก 5,000 รหัสแล้วตัน โดยไม่มี error
  assert.ok(url.includes("order_by=s.code+asc"), `ต้องเรียงด้วยรหัสสินค้าเท่านั้น: ${url}`)
  assert.ok(url.includes("from_t_date=23%2F08%2F2026") && url.includes("to_t_date=23%2F08%2F2026"), "ต้องกรองวันเดียว")
  assert.ok(url.includes("inventory_id=4") && url.includes("page=3"))

  const d = ictDdmmyyyy(0)
  assert.match(d, /^\d{2}\/\d{2}\/\d{4}$/, `รูปแบบวันที่ที่ ATMS รับคือ dd/mm/yyyy: ${d}`)
  assert.notEqual(ictDdmmyyyy(0), ictDdmmyyyy(1), "ย้อนหลัง 1 วันต้องได้คนละวัน")
}

// --- กำลังสั่งซื้อ: PR ที่ยังไม่มี DD (openPrQtyBySku) ---
// ทุกเคสในนี้เคยทำให้ตัวเลข "กำลังมา" ผิดได้จริง และผิดแบบเงียบ — หน้าจอจะบอกว่าไม่ต้องสั่งทั้งที่ต้องสั่ง
{
  const asOf = new Date(Date.UTC(2026, 7, 25))    // 25/08/2026
  const WH = "คลังลาดกระบัง"
  const base = {
    prHeads: [
      { code: "LBPR001", date: "20/08/2026", warehouse: WH },   // เปิดอยู่ ยังไม่มี PO
      { code: "LBPR002", date: "10/08/2026", warehouse: WH },   // มี PO + DD ครบ → ปิดแล้ว
      { code: "LBPR003", date: "01/08/2026", warehouse: WH },   // มี PO แต่ DD ไม่ครบ → ยังเปิด
      { code: "LBPR004", date: "01/01/2026", warehouse: WH },   // เก่าเกิน 90 วัน
      { code: "SBPR005", date: "20/08/2026", warehouse: "คลังสระบุรี" }, // คนละคลัง
      { code: "LBPR006", date: "18/08/2026", warehouse: WH },   // มีแต่ PO ที่ยกเลิก → ยังเปิด
    ],
    poHeads: [
      { code: "LBPO002", prCode: "LBPR002", receiveStatus: "รับสินค้าแล้วทั้งหมด" },
      { code: "LBPO003a", prCode: "LBPR003", receiveStatus: "รับสินค้าแล้วทั้งหมด" },
      { code: "LBPO003b", prCode: "LBPR003", receiveStatus: "ยังไม่ได้รับสินค้า" },
      { code: "LBPO006", prCode: "LBPR006", receiveStatus: "ยกเลิก" },
    ],
    ddPoCodes: ["LBPO002", "LBPO003a"],
    prItems: [
      { prCode: "LBPR001", sku: "A1", amount: 10, warehouse: WH, group: "ระบบเบรก" },
      { prCode: "LBPR001", sku: "LAB", amount: 3, warehouse: WH, group: "ค่าแรง-ระบบยาง" },  // ค่าแรงไม่นับ
      { prCode: "LBPR002", sku: "A1", amount: 99, warehouse: WH, group: "ระบบเบรก" },        // ปิดแล้วไม่นับ
      { prCode: "LBPR003", sku: "A1", amount: 8, warehouse: WH, group: "ระบบเบรก" },         // รับไปแล้ว 5 → เหลือ 3
      { prCode: "LBPR004", sku: "A1", amount: 50, warehouse: WH, group: "ระบบเบรก" },        // เก่าเกินไม่นับ
      { prCode: "SBPR005", sku: "A1", amount: 70, warehouse: "คลังสระบุรี", group: "ระบบเบรก" },
      { prCode: "LBPR006", sku: "B2", amount: 4, warehouse: WH, group: "ระบบไฟฟ้า" },
    ],
    poItems: [
      { poCode: "LBPO003a", sku: "A1", received: 5 },
      { poCode: "LBPO006", sku: "B2", received: 4 },   // PO ยกเลิก — ห้ามเอามาหักยอด
    ],
    warehouse: WH,
    asOf,
  }
  const m = openPrQtyBySku(base)

  assert.equal(m.get("A1")?.qty, 13, "10 (PR ไม่มี PO) + max(0, 8−5) = 13")
  assert.equal(m.get("A1")?.prCount, 2, "นับเฉพาะใบที่ยังเปิดและมีของเหลือจริง")
  assert.deepEqual(m.get("A1")?.prCodes, ["LBPR001", "LBPR003"], "ใบใหม่กว่ามาก่อน")
  assert.equal(m.get("A1")?.oldestDays, 24, "LBPR003 ลงวันที่ 01/08/2026 = 24 วันก่อน 25/08/2026")
  assert.equal(m.get("LAB"), undefined, "บรรทัดกลุ่มค่าแรงไม่ใช่ของเข้าสต๊อก ห้ามนับ")
  assert.equal(m.get("B2")?.qty, 4, "PO ที่ยกเลิกไม่ปิดใบ PR และยอดที่ 'รับ' บน PO ยกเลิกห้ามเอามาหัก")

  // คลังอื่นต้องไม่ปนกัน — เรียกด้วยชื่อคลังไหนได้ของคลังนั้น
  const sb = openPrQtyBySku({ ...base, warehouse: "คลังสระบุรี" })
  assert.equal(sb.get("A1")?.qty, 70, "เรียกคลังสระบุรีต้องได้ยอดของสระบุรี")
  assert.equal(m.get("A1")?.qty, 13, "และต้องไม่ไปปนกับยอดลาดกระบัง")

  // รับครบพอดี = ไม่เหลืออะไรกำลังมา (ไม่ใช่ 0 ที่ยังโผล่เป็นแถว)
  const exact = openPrQtyBySku({ ...base, poItems: [{ poCode: "LBPO003a", sku: "A1", received: 8 }],
    prItems: base.prItems.filter((i) => i.prCode === "LBPR003") })
  assert.equal(exact.get("A1"), undefined, "รับครบยอดแล้วต้องไม่เหลือรายการค้าง")

  // รับเกินยอดของใบตัวเอง ห้ามไปกินโควตาของใบอื่นในกองเดียวกัน
  const over = openPrQtyBySku({ ...base, poItems: [{ poCode: "LBPO003a", sku: "A1", received: 999 }] })
  assert.equal(over.get("A1")?.qty, 10, "หักได้มากสุดแค่ยอดของใบนั้น เหลือ 10 จาก LBPR001 ครบ")

  assert.equal(openPrQtyBySku({ ...base, prHeads: [], prItems: [] }).size, 0, "ไม่มีข้อมูลต้องไม่พัง")
  assert.equal(ageDaysFromDmy("25/08/2026", asOf), 0)
  assert.equal(ageDaysFromDmy("20/08/2026", asOf), 5)
  assert.equal(ageDaysFromDmy("ไม่ใช่วันที่", asOf), null, "อ่านไม่ออกต้องคืน null ไม่ใช่ 0")
  assert.equal(ON_ORDER_MAX_AGE_DAYS, 90)
}

// --- derive() กับของที่กำลังมา ---
// พารามิเตอร์ที่ 5 ต้อง default 0 เสมอ — /tire/{branch}/stock-tire เรียก derive(r, win, z) แบบไม่ส่งเข้ามา
// ถ้าเผลอไปอ่าน row.onOrder ตรงๆ ใน derive ตัวเลขของหน้ายางจะเปลี่ยนตามไปด้วยโดยไม่มีใครสั่ง
{
  const low: SnapshotRow = { ...ROW, stockQty: 1, onOrder: { qty: 20, prCount: 1, prCodes: ["LBPR001"], oldestDays: 3 } }
  const plain = derive(low, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS)
  const withOrder = derive(low, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, low.onOrder!.qty)

  assert.equal(plain.coveredByOrder, false, "ไม่ส่ง onOrderQty = พฤติกรรมเดิมทุกประการ (/tire/*)")
  assert.deepEqual({ ...plain, coveredByOrder: withOrder.coveredByOrder, suggestQty: withOrder.suggestQty }, withOrder,
    "ของที่กำลังมาต้องเปลี่ยนแค่ suggestQty กับ coveredByOrder เท่านั้น")
  assert.equal(withOrder.status, plain.status, "สถานะต้องคิดจากของที่มีอยู่จริง ของยังไม่มาเบิกไม่ได้")
  assert.equal(withOrder.daysOfSupply, plain.daysOfSupply, "พอใช้อีกกี่วันต้องคิดจากของที่มีอยู่จริงเช่นกัน")
  assert.ok(withOrder.suggestQty < plain.suggestQty, "แนะนำสั่งต้องหักของที่กำลังมาออก")
  assert.equal(withOrder.coveredByOrder, true, "คงเหลือ 1 + กำลังมา 20 พ้น ROP แล้ว = สั่งแล้ว รอของ")

  // ของกำลังมาน้อยเกินกว่าจะพ้น ROP — ยังต้องสั่งเพิ่มอยู่ ห้ามขึ้นชิป
  const tiny = derive(low, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, 1)
  assert.equal(tiny.coveredByOrder, false, "ของที่กำลังมาไม่พอ ยังต้องสั่งเพิ่ม")
  assert.ok(tiny.suggestQty > 0)

  // แถวที่ไม่ได้ขาดอยู่แล้ว ไม่ใช่ "สั่งแล้ว รอของ" ต่อให้มีของกำลังมา
  const healthy = derive({ ...ROW, stockQty: 12 }, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, 5)
  assert.equal(healthy.coveredByOrder, false, "ของพอตั้งแต่แรก ไม่ต้องขึ้นป้ายกันสั่งซ้ำ")

  assert.equal(derive(ROW, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, -5).suggestQty,
    derive(ROW, DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS, 0).suggestQty, "ค่าติดลบต้องถือเป็น 0 ไม่ใช่บวกกลับ")
}

console.log("✅ check-safety-stock-core ผ่านทั้งหมด")
