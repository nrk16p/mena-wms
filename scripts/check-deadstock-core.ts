// scripts/check-deadstock-core.ts
// รัน: npx tsx scripts/check-deadstock-core.ts   (repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-ap-tracking.ts)
import assert from "node:assert/strict"
import {
  plateFromNote, daysBetween, bucketOf, consumeFifo, buildPayload,
  matchesAgeFilter, rollupItems, ITEM_AGE_FILTERS, START_YM,
  STALE_DAYS, type Layer, type LayerDoc, type IssueDoc, type PendingRow,
} from "../lib/deadstock-core"

// --- plateFromNote: ทะเบียนถูกฝังใน หมายเหตุ เพราะแถว DD ไม่มีคอลัมน์ ทะเบียน เลย ---
assert.equal(plateFromNote("LBPR26050758/71-5742/153/โม่ใหญ่"), "71-5742")
assert.equal(plateFromNote("LBPR26050516/กธ2607 รถ สนง. ฝ่าย HR"), "กธ2607")
assert.equal(plateFromNote("LBPR26050729/71-0432/UH04/โม่ใหญ่"), "71-0432")
assert.equal(plateFromNote("LBPR26050699/STOCK"), null, "เข้าสต็อกกลาง ต้องไม่จับเป็นทะเบียน")
assert.equal(plateFromNote("LBPR25120644/เข้าสต๊อกเพื่อการซ่อมบำรุง"), null)
assert.equal(plateFromNote(""), null)
assert.equal(plateFromNote(null), null)

// --- daysBetween / bucketOf ---
assert.equal(daysBetween("2026-08-01T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z")), 13)
assert.equal(daysBetween("2026-08-14T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z")), 0)
assert.equal(bucketOf(0), "0-7")
assert.equal(bucketOf(7), "0-7")
assert.equal(bucketOf(8), "8-15")
assert.equal(bucketOf(30), "16-30")
assert.equal(bucketOf(61), "60+")
assert.equal(STALE_DAYS, 7)

// --- consumeFifo ---
const L = (dd: string, date: string, qty: number, plate: string | null = "71-0001"): Layer => ({
  dd, date, qty, cost: 10, itemCode: "X", itemName: "x", itemGroup: "g",
  note: plate ? `PR/${plate}/A/B` : "PR/STOCK", plate,
})

// ตัดข้ามหลายชั้น: เบิก 7 กินชั้นแรก 5 หมด และกินชั้นสองไป 2
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5), L("D2", "2026-02-05", 4)], 7)
  assert.equal(unmatched, 0)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "D2")
  assert.equal(remaining[0].remaining, 2)
}
// ตัดพอดีหมดทุกชั้น
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5), L("D2", "2026-02-05", 4)], 9)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 0)
}
// ไม่มีการเบิกเลย — ค้างทั้งหมด
{
  const { remaining } = consumeFifo([L("D1", "2026-01-05", 5)], 0)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].remaining, 5)
}
// เบิกเกินของที่มี — ส่วนเกินต้องรายงานเป็น unmatched ไม่ใช่ค้างติดลบ
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-05", 5)], 8)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 3)
}
// เรียงตามวันที่จริง ไม่ใช่ลำดับที่ส่งเข้ามา
{
  const { remaining } = consumeFifo([L("NEW", "2026-05-01", 3), L("OLD", "2026-01-01", 3)], 3)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "NEW", "ต้องตัดชั้นเก่า (OLD) ก่อน")
}
// วันที่เดียวกัน — ตัดสินด้วยเลขที่ DD เพื่อให้ผลคงที่
{
  const { remaining } = consumeFifo([L("D9", "2026-03-01", 2), L("D1", "2026-03-01", 2)], 2)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].dd, "D9")
}
// ทศนิยม — ยอดเบิกจริงมีทศนิยม (เช่น น้ำมัน) ห้ามเหลือเศษลอย
{
  const { remaining, unmatched } = consumeFifo([L("D1", "2026-01-01", 18.2)], 18.2)
  assert.equal(remaining.length, 0)
  assert.equal(unmatched, 0)
}

// --- buildPayload: สต็อกกลางต้องร่วมตัด FIFO แต่ไม่ถูกแสดง ---
{
  // ชั้นสต็อกกลาง 1 ม.ค. (5 ชิ้น) มาก่อน ชั้นผูกรถ 2 ม.ค. (5 ชิ้น) — เบิก 5 ต้องกินชั้นสต็อกกลางหมด
  // เหลือชั้นผูกรถเต็ม 5 ถ้าใครไปกรองสต็อกกลางทิ้งก่อน FIFO จะเหลือ 0 ซึ่งผิด
  const layers: LayerDoc[] = [
    { _id: { i: "A", d: "DD-STOCK", t: "2026-01-01T00:00:00.000Z" }, q: 5, c: 100, n: "ของ A", g: "กลุ่ม1", note: "LBPR1/STOCK" },
    { _id: { i: "A", d: "DD-TRUCK", t: "2026-01-02T00:00:00.000Z" }, q: 5, c: 100, n: "ของ A", g: "กลุ่ม1", note: "LBPR2/71-1111/T1/โม่" },
  ]
  const issues: IssueDoc[] = [{ _id: { i: "A", m: "2026-01" }, q: 5 }]
  const p = buildPayload(layers, issues, new Date("2026-02-10T00:00:00.000Z"))
  assert.equal(p.pending.length, 1, "ต้องเหลือเฉพาะชั้นที่ผูกทะเบียนรถ")
  assert.equal(p.pending[0].dd, "DD-TRUCK")
  assert.equal(p.pending[0].remaining, 5, "ยอดเบิกต้องไปกินชั้นสต็อกกลางก่อน")
  assert.equal(p.pending[0].value, 500)
  assert.equal(p.pending[0].plate, "71-1111")
  assert.equal(p.summary.pendingCount, 1)
  assert.equal(p.summary.pendingValue, 500)
  assert.equal(p.summary.staleCount, 1, "รับ 2 ม.ค. วัดวันที่ 10 ก.พ. = 39 วัน > 7")
  assert.equal(p.dataQuality.stockLayersRemaining, 0)
  // ภาพรายเดือน: เริ่มที่ START_YM เสมอ และจบที่เดือนของ asOf
  assert.equal(p.monthly[0].ym, START_YM, "เดือนแรกต้องเป็น START_YM")
  assert.equal(p.monthly.at(-1)!.ym, "2026-02", "เดือนสุดท้ายต้องเป็นเดือนของ asOf")
  const jan = p.monthly.find((m) => m.ym === "2026-01")!
  assert.equal(jan.count, 1, "สิ้น ม.ค. 2026 ก็ค้างแล้ว 1 รายการ")
  assert.equal(jan.staleCount, 1, "รับ 2 ม.ค. วัดสิ้น ม.ค. = 29 วัน > 7")
  assert.equal(jan.value, 500)
  // เดือนก่อนที่ของจะถูกรับเข้ามา ต้องยังไม่มีอะไรค้าง
  if (START_YM < "2026-01") assert.equal(p.monthly[0].count, 0, "เดือนก่อนรับของ ต้องค้าง 0")
}

// --- buildPayload: unmatched ---
{
  const layers: LayerDoc[] = [
    { _id: { i: "B", d: "DD1", t: "2026-03-01T00:00:00.000Z" }, q: 2, c: 50, n: "ของ B", g: "กลุ่ม2", note: "LBPR3/71-2222/T2/โม่" },
  ]
  const issues: IssueDoc[] = [{ _id: { i: "B", m: "2026-03" }, q: 5 }]
  const p = buildPayload(layers, issues, new Date("2026-03-20T00:00:00.000Z"))
  assert.equal(p.pending.length, 0)
  assert.equal(p.dataQuality.unmatchedIssueQty, 3)
}

// --- buildPayload: รวมรายรหัสสินค้า ---
{
  const layers: LayerDoc[] = [
    { _id: { i: "C", d: "DD1", t: "2026-01-10T00:00:00.000Z" }, q: 3, c: 20, n: "ของ C", g: "กลุ่ม3", note: "LBPR4/71-3333/T3/โม่" },
    { _id: { i: "C", d: "DD2", t: "2026-02-10T00:00:00.000Z" }, q: 2, c: 20, n: "ของ C", g: "กลุ่ม3", note: "LBPR5/71-4444/T4/โม่" },
  ]
  const p = buildPayload(layers, [], new Date("2026-03-01T00:00:00.000Z"))
  assert.equal(p.items.length, 1)
  assert.equal(p.items[0].itemCode, "C")
  assert.equal(p.items[0].layers, 2)
  assert.equal(p.items[0].remaining, 5)
  assert.equal(p.items[0].value, 100)
  assert.equal(p.items[0].oldestAgeDays, 50, "ชั้นเก่าสุด 10 ม.ค. ถึง 1 มี.ค. = 50 วัน")
}

// --- newerCount: ซื้อซ้ำทั้งที่ของเก่ายังค้าง ---
{
  const mk = (dd: string, day: string, note: string): LayerDoc =>
    ({ _id: { i: "Z", d: dd, t: `2026-01-${day}T00:00:00.000Z` }, q: 1, c: 10, n: "ของ Z", g: "กลุ่ม", note })
  const TRUCK1 = "LBPR1/71-1111/T1/โม่"
  const TRUCK2 = "LBPR2/71-2222/T2/โม่"
  const TRUCK3 = "LBPR3/71-3333/T3/โม่"
  const p = buildPayload(
    [mk("DD1", "05", TRUCK1), mk("DD2", "10", TRUCK2), mk("DD3", "20", TRUCK3)],
    [],
    new Date("2026-02-01T00:00:00.000Z")
  )
  const byDd = Object.fromEntries(p.pending.map((r) => [r.dd, r.newerCount]))
  assert.equal(byDd["DD1"], 2, "ใบเก่าสุดต้องมีใบใหม่กว่า 2 ใบ")
  assert.equal(byDd["DD2"], 1)
  assert.equal(byDd["DD3"], 0, "ใบใหม่สุดต้องไม่มีใบใหม่กว่า")
  assert.equal(p.items[0].newerMax, 2)

  // ของเข้าสต็อกกลางที่ใหม่กว่า ต้องไม่ถูกนับ (ผู้ใช้เลือกนับเฉพาะใบที่ผูกทะเบียนรถ)
  const p2 = buildPayload(
    [mk("DD1", "05", TRUCK1), mk("DD-STOCK", "10", "LBPR9/STOCK"), mk("DD3", "20", TRUCK3)],
    [],
    new Date("2026-02-01T00:00:00.000Z")
  )
  assert.equal(p2.pending.find((r) => r.dd === "DD1")!.newerCount, 1, "นับเฉพาะ DD3 ไม่นับใบสต็อกกลาง")
  assert.equal(p2.dataQuality.stockLayersRemaining, 1)

  // ใบเก่าถูกเบิกหมดแล้ว ต้องหลุดจากรายการค้าง และไม่ถูกนับเป็นใบใหม่กว่าของใคร
  const p3 = buildPayload([mk("DD1", "05", TRUCK1), mk("DD2", "10", TRUCK2)], [{ _id: { i: "Z", m: "2026-01" }, q: 1 }], new Date("2026-02-01T00:00:00.000Z"))
  assert.equal(p3.pending.length, 1)
  assert.equal(p3.pending[0].dd, "DD2")
  assert.equal(p3.pending[0].newerCount, 0)
}

// --- matchesAgeFilter: ขอบเขตแบ่งที่ < 7 กับ >= 7 (ไม่ใช่ > 7 แบบ STALE_DAYS) ---
assert.equal(ITEM_AGE_FILTERS.length, 4)
assert.equal(matchesAgeFilter("", 999), true, "ค่าว่าง = ไม่กรอง")
assert.equal(matchesAgeFilter("lt7", 6), true)
assert.equal(matchesAgeFilter("lt7", 7), false, "7 วันพอดี ต้องไม่อยู่ใน 'ต่ำกว่า 7'")
assert.equal(matchesAgeFilter("gte7", 7), true, "7 วันพอดี ต้องอยู่ใน '7 วันขึ้นไป'")
assert.equal(matchesAgeFilter("gte7", 6), false)
assert.equal(matchesAgeFilter("gte7", 400), true, "'7 วันขึ้นไป' ครอบของเก่ามากด้วย")
assert.equal(matchesAgeFilter("gt30", 30), false, "30 วันพอดี ต้องไม่อยู่ใน 'เกิน 30'")
assert.equal(matchesAgeFilter("gt30", 31), true)

// --- rollupItems: กรองระดับใบ DD แล้วยอดต้องคำนวณใหม่ ไม่ใช่ยอดเดิมทั้งรหัส ---
{
  const row = (dd: string, ageDays: number, remaining: number, value: number): PendingRow => ({
    dd, date: "2026-01-01T00:00:00.000Z", plate: "71-0001",
    itemCode: "A", itemName: "ของ A", itemGroup: "กลุ่ม1",
    remaining, cost: value / remaining, value, ageDays, bucket: bucketOf(ageDays), newerCount: 0,
  })
  const rows = [row("DD-NEW", 3, 2, 200), row("DD-OLD", 45, 1, 100)]

  const all = rollupItems(rows)
  assert.equal(all.length, 1)
  assert.equal(all[0].layers, 2)
  assert.equal(all[0].value, 300)
  assert.equal(all[0].oldestAgeDays, 45)

  const old = rollupItems(rows.filter((r) => matchesAgeFilter("gt30", r.ageDays)))
  assert.equal(old.length, 1, "รหัสยังอยู่ เพราะมีใบที่เข้าช่วง")
  assert.equal(old[0].layers, 1, "เหลือใบเดียว")
  assert.equal(old[0].value, 100, "มูลค่าต้องนับเฉพาะใบที่เข้าช่วง ไม่ใช่ 300")
  assert.equal(old[0].oldestAgeDays, 45)

  const fresh = rollupItems(rows.filter((r) => matchesAgeFilter("lt7", r.ageDays)))
  assert.equal(fresh[0].layers, 1)
  assert.equal(fresh[0].value, 200)
  assert.equal(fresh[0].oldestAgeDays, 3, "ค้างนานสุดต้องคิดใหม่จากใบที่เหลือ")

  // ไม่มีใบไหนเข้าช่วง = รหัสสินค้าต้องหายไปเลย
  assert.deepEqual(rollupItems(rows.filter((r) => matchesAgeFilter("gt30", r.ageDays) && r.dd === "DD-NEW")), [])
}

console.log("✅ deadstock-core: ผ่านทั้งหมด")
