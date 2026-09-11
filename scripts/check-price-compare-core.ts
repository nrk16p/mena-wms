// scripts/check-price-compare-core.ts
// รัน: npx tsx scripts/check-price-compare-core.ts   (repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts)
import assert from "node:assert/strict"
import {
  newDoc, emptySupplier, supplierTotals, lowestNet, isComplete, canTransition,
  normalizeDoc, validateDoc, docNoFor, counterKeyFor, fmtMoney, lineTotal, round2,
  completeSupplierCount, isQuoteExpired, isDocNo, MIN_QUOTES,
  effectiveLineSupplier, allLinesAwarded, mixedTotals, mixedNet, pickLowestPerLine, bestMixNet, mixedGap, renumberAfterRemoval,
  groupsOf, countedRows, hasGrades, newGroupId,
  type PriceCompare, type PcSupplier,
} from "../lib/price-compare"
import { diffPriceCompare } from "../lib/price-compare-log"

// --- ใบต้นแบบ PC-2609-002 (Pump + Motor UH03) 3 supplier 5 รายการ ---
function uh03(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-002"; d.createdAt = "2026-09-07T09:00:00.000+07:00"; d.updatedAt = d.createdAt
  d.title = "Pump + Motor UH03"; d.requestDept = "ยานยนต์"
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" },
    { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" },
    { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, prices: number[]): PcSupplier => ({ ...emptySupplier(5), name, prices })
  d.suppliers = [
    s("ช่างหมู", [21000, 18900, 110.56, 180, 7000]),
    s("คุณณัฐ", [30000, 18000, 100, 100, 5500]),
    s("ศศ&ณ",  [30000, 25000, 107.14, 107.14, 5000]),
  ]
  d.lineSupplier = d.items.map(() => null)
  return d
}

// --- round2 / lineTotal ---
assert.equal(round2(3548.299), 3548.3)
assert.equal(lineTotal({ name: "x", qty: 18, unit: "ลิตร" }, 110.56), 1990.08)
assert.equal(lineTotal({ name: "x", qty: 18, unit: "ลิตร" }, null), null)

// --- supplierTotals ตรงกับต้นแบบ (ต้นแบบปัดยอดรายแถวก่อนรวม: 18×110.56 = 1,990.08 → ในฟอร์มเขียน 1,990.00 แต่เราใช้ค่าจริง) ---
const d = uh03()
const t0 = supplierTotals(d, 0)
assert.equal(t0.subtotal, 50690.08)
assert.equal(t0.vat, 3548.31)
assert.equal(t0.net, 54238.39)
const t1 = supplierTotals(d, 1)
assert.deepEqual(t1, { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 3941, net: 60241 })
const t2 = supplierTotals(d, 2)
assert.equal(t2.subtotal, 62999.92)   // 107.14×18 = 1,928.52 + 107.14×10 = 1,071.40 (ฟอร์มกระดาษปัดเป็น 63,000)
assert.equal(t2.net, 67409.91)

// ส่วนลดหักก่อนคิด VAT
d.suppliers[1].discount = 300
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 300, afterDiscount: 56000, vat: 3920, net: 59920 })
d.suppliers[1].discount = 0

// --- vatMode: incl → สุทธิ = หลังส่วนลด, VAT แยกออกมาให้เห็น; none → VAT 0 ---
d.suppliers[1].vatMode = "incl"
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 3683.18, net: 56300 })
d.suppliers[1].vatMode = "none"
assert.deepEqual(supplierTotals(d, 1), { subtotal: 56300, discount: 0, afterDiscount: 56300, vat: 0, net: 56300 })
d.suppliers[1].vatMode = "excl"

// รายการที่ null ไม่ถูกนับ และ supplier ที่ไม่มีราคาเลย → 0
d.suppliers[2].prices[0] = null
assert.equal(supplierTotals(d, 2).subtotal, 32999.92)
d.suppliers[2].prices[0] = 30000
assert.equal(supplierTotals(d, 3).subtotal, 0, "index เกิน → totals ศูนย์ ไม่ throw")

// --- lowestNet ---
assert.equal(lowestNet(d), 0)
d.suppliers[0].prices = [null, null, null, null, null]
assert.equal(lowestNet(d), 1, "supplier ที่ไม่มีราคาเลย ไม่ถือว่าถูกสุด")
assert.equal(lowestNet({ items: d.items, suppliers: [] }), null)

// --- renumberAfterRemoval: ลบคอลัมน์ supplier แล้วเลขที่อ้างถึงเจ้าอื่นต้องเลื่อนตาม ---
assert.equal(renumberAfterRemoval(1, 0), null, "เจ้าที่ถูกลบ → ไม่มีการมอบหมายอีก")
assert.equal(renumberAfterRemoval(2, 0), 1, "เจ้าหลังจุดที่ลบเลื่อนขึ้น 1")
assert.equal(renumberAfterRemoval(3, 0), 2)
assert.equal(renumberAfterRemoval(null, 0), null)
assert.equal(renumberAfterRemoval(1, 1), 1, "เจ้าก่อนจุดที่ลบไม่ขยับ")
assert.equal(renumberAfterRemoval(3, 1), 2)

// --- effectiveLineSupplier / allLinesAwarded (พื้นฐานโหมดผสม) ---
{
  const m = uh03()
  assert.equal(effectiveLineSupplier(m, 0), null, "ยังไม่กำหนดทั้งคู่ → null")
  m.selectedSupplier = 2
  assert.equal(effectiveLineSupplier(m, 0), 2, "ไม่ระบุ lineSupplier ต่อแถว → fallback ไป selectedSupplier ทั้งใบ")
  m.lineSupplier[0] = 1
  assert.equal(effectiveLineSupplier(m, 0), 1, "ระบุ lineSupplier ต่อแถวแล้ว ใช้ค่านั้นแทน")
  assert.equal(effectiveLineSupplier(m, 1), 2, "แถวอื่นที่ยังไม่ระบุ ยัง fallback ปกติ")

  assert.equal(allLinesAwarded(uh03()), false, "ยังไม่ระบุสักแถว")
  assert.equal(allLinesAwarded({ items: d.items, lineSupplier: [1] }), false, "ความยาวไม่ตรง items")
  const mixDoc = uh03(); mixDoc.lineSupplier = [1, 2, 2, 2, 1]
  assert.equal(allLinesAwarded(mixDoc), true)
}

// --- mixedTotals: แยกยอดต่อเจ้า คิด VAT ทีเดียวต่อเจ้า ไม่ปันส่วนส่วนลด ---
{
  const m = uh03(); m.lineSupplier = [1, 2, 2, 2, 3]
  const mt = mixedTotals(m)
  assert.ok(mt, "ทุกแถวมีเจ้าที่เสนอราคา → คำนวณได้")
  assert.deepEqual(mt!.perSupplier[0], { subtotal: 21000, vat: 1470, net: 22470, lines: 1 }, "ช่างหมู: Pump 21,000")
  assert.deepEqual(mt!.perSupplier[1], { subtotal: 20800, vat: 1456, net: 22256, lines: 3 }, "คุณณัฐ: 18,000 + 100×18 + 100×10")
  assert.deepEqual(mt!.perSupplier[2], { subtotal: 5000, vat: 350, net: 5350, lines: 1 }, "ศศ&ณ: ค่าแรง 5,000")
  assert.equal(mt!.grand, 50076)
  assert.equal(mt!.suppliersUsed, 3)
  assert.equal(mixedNet(m), 50076, "mixedNet = grand ของ mixedTotals")

  // ส่วนลดท้ายใบไม่ถูกนำมาคิดในโหมดผสม
  const disc = uh03(); disc.lineSupplier = [1, 2, 2, 2, 3]; disc.suppliers[1].discount = 5000
  assert.equal(mixedNet(disc), 50076, "ส่วนลดท้ายใบไม่ถูกปันส่วนเข้าโหมดผสม")

  // vatMode ต่อเจ้าในโหมดผสม: incl = สุทธิเท่า subtotal (ถอด VAT ออกมาแสดง), none = ไม่มี VAT
  const vi = uh03(); vi.lineSupplier = [1, 2, 2, 2, 3]; vi.suppliers[1].vatMode = "incl"
  const mi = mixedTotals(vi)!
  assert.deepEqual(mi.perSupplier[1], { subtotal: 20800, vat: 1360.75, net: 20800, lines: 3 }, "incl: 20,800 − 20,800/1.07 = 1,360.75")
  assert.equal(mi.grand, round2(22470 + 20800 + 5350))
  const vn = uh03(); vn.lineSupplier = [1, 2, 2, 2, 3]; vn.suppliers[1].vatMode = "none"
  const mn = mixedTotals(vn)!
  assert.deepEqual(mn.perSupplier[1], { subtotal: 20800, vat: 0, net: 20800, lines: 3 })
  assert.equal(mn.grand, round2(22470 + 20800 + 5350))

  // เจ้าที่ไม่ได้รับแถวไหนเลยยังอยู่ในผลลัพธ์ (เรียงตรงกับ doc.suppliers) แต่ lines = 0
  const one = uh03(); one.lineSupplier = [1, 1, 1, 1, 1]
  const mo = mixedTotals(one)!
  assert.equal(mo.suppliersUsed, 1)
  assert.deepEqual(mo.perSupplier.map((x) => x.lines), [5, 0, 0])
  assert.equal(mo.grand, supplierTotals(one, 0).net, "มอบให้เจ้าเดียวทุกแถว = สุทธิของเจ้านั้น (ไม่มีส่วนลด)")

  // แถวที่ยังไม่มีเจ้า / ชี้ไปเจ้าที่ไม่ได้เสนอราคา → null
  assert.equal(mixedTotals(uh03()), null, "ยังไม่กำหนด supplier ให้บางแถว และไม่มี selectedSupplier → null")
  assert.equal(mixedNet(uh03()), null)
  const gap = uh03(); gap.lineSupplier = [1, 2, 2, 2, 3]; gap.suppliers[2].prices[4] = null
  assert.equal(mixedTotals(gap), null, "เจ้าที่ถูกเลือกไม่ได้เสนอราคาแถวนั้น → null")
  const fb = uh03(); fb.selectedSupplier = 1; fb.lineSupplier = [null, 2, 2, 2, 3]
  assert.equal(mixedNet(fb), 50076, "แถวที่ไม่ระบุ fallback ไป selectedSupplier ทั้งใบ")
}

// --- pickLowestPerLine / bestMixNet: เทียบ "หลัง VAT" ต่อแถว ---
{
  const m = uh03()
  assert.deepEqual(pickLowestPerLine(m), [1, 2, 2, 2, 3], "1-based; ทุกเจ้า excl → เทียบหลัง VAT ให้ผลเดียวกับเทียบราคาป้าย")
  assert.equal(bestMixNet(m), 50076, "= grand ของ mixedTotals ตาม pickLowestPerLine")
  const mixDoc = uh03(); mixDoc.lineSupplier = [1, 2, 2, 2, 1]
  assert.equal(mixedNet(mixDoc), 52216, "เลือกช่างหมูทำค่าแรงแทน → แพงกว่า best 2,140")
  assert.equal(bestMixNet(mixDoc), 50076, "best ไม่ขึ้นกับว่าเลือกจริงเป็นใคร")

  // --- mixedGap: ส่วนต่างจากทางเลือกที่ถูกที่สุด (UI การ์ดโหมดผสมแสดง "(+Z บาท)") ---
  const gapBest = uh03(); gapBest.lineSupplier = [1, 2, 2, 2, 3]
  assert.equal(mixedGap(gapBest), 0, "เลือกถูกสุดทุกแถว → ส่วนต่าง 0")
  const gapOff = uh03(); gapOff.lineSupplier = [2, 2, 2, 2, 3]   // แถว 1 ใช้คุณณัฐ 30,000 แทนช่างหมู 21,000
  assert.equal(mixedGap(gapOff), round2(30000 * 1.07 - 21000 * 1.07), "ต่างกันแค่แถวแรก = ส่วนต่างหลัง VAT ของแถวนั้น")
  assert.equal(mixedGap(gapOff), 9630)
  assert.equal(mixedGap(gapOff), round2(mixedTotals(gapOff)!.grand - 50076), "= grand ที่เลือกจริง − bestMixNet")
  assert.equal(mixedGap(mixDoc), 2140, "เลือกช่างหมูทำค่าแรง (7,000) แทนศศ&ณ (5,000) → 2,000 × 1.07")
  assert.equal(mixedGap(uh03()), null, "ยังไม่เลือกแถวไหนเลยและไม่มีผู้ได้รับเลือกทั้งใบ → null")

  // เจ้าที่เสนอ "รวม VAT แล้ว" อาจถูกกว่าทั้งที่ราคาป้ายสูงกว่า — ต้องเทียบหลัง VAT ไม่ใช่ก่อน VAT
  const v = uh03()
  v.suppliers[1].vatMode = "incl"; v.suppliers[1].prices[0] = 22000   // 22,000 รวม VAT แล้ว < 21,000 × 1.07 = 22,470
  assert.ok(v.suppliers[0].prices[0]! < v.suppliers[1].prices[0]!, "ราคาป้ายก่อน VAT: ช่างหมู 21,000 ดูถูกกว่า")
  assert.equal(pickLowestPerLine(v)[0], 2, "เทียบหลัง VAT: คุณณัฐ 22,000 (incl) ถูกกว่า 22,470")
  assert.equal(bestMixNet(v), round2(22000 + 18000 + 1800 + 1000 + 5350), "best ใช้ราคาหลัง VAT ของเจ้าที่ชนะแต่ละแถว")

  assert.deepEqual(pickLowestPerLine({ items: d.items, suppliers: [] }), [null, null, null, null, null])
  assert.equal(bestMixNet({ items: d.items, suppliers: [] }), null, "ไม่มีเจ้าไหนเสนอราคาเลย → null")
  const gap = uh03(); gap.suppliers.forEach((sp) => { sp.prices[3] = null })
  assert.equal(pickLowestPerLine(gap)[3], null)
  assert.equal(bestMixNet(gap), null, "มีแถวที่ไม่มีใครเสนอราคา → null")
}

// --- completeSupplierCount / isQuoteExpired ---
assert.equal(MIN_QUOTES, 3)
assert.equal(completeSupplierCount(uh03()), 3)
{ const x = uh03(); x.suppliers[2].prices[4] = null; assert.equal(completeSupplierCount(x), 2, "ราคาไม่ครบทุกแถว ไม่นับ") }
{ const x = uh03(); x.suppliers[2].name = ""; assert.equal(completeSupplierCount(x), 2, "ไม่มีชื่อ ไม่นับ") }
assert.equal(isQuoteExpired({ validUntil: "2026-09-01" }, "2026-09-08"), true)
assert.equal(isQuoteExpired({ validUntil: "2026-09-08" }, "2026-09-08"), false, "วันสุดท้ายยังใช้ได้")
assert.equal(isQuoteExpired({ validUntil: "" }, "2026-09-08"), false, "ไม่ระบุ = ไม่เตือน")

// --- isComplete ---
const c = uh03()
let r = isComplete(c)
assert.equal(r.ok, false)
assert.ok(r.missing.includes("ผู้ได้รับเลือก"))
assert.ok(r.missing.includes("ชื่อกรรมการ"))
c.selectedSupplier = 1
c.committee = c.committee.map((m) => ({ ...m, name: "กรรมการ" }))
assert.equal(isComplete(c).ok, true)
c.committee[3].name = ""
assert.equal(isComplete(c).ok, false)
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
// กฎ 3 ราย: เหลือ 2 ราย → ต้องมีเหตุผล
c.suppliers = [c.suppliers[0], c.suppliers[1]]
r = isComplete(c, { requireCommitteeNames: false })
assert.equal(r.ok, false)
assert.ok(r.missing.some((m) => m.includes("3 ราย")))
c.fewerQuotesReason = "อู่ที่รับงาน Rexroth มีแค่ 2 ราย"
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
// กฎเลือกรายที่ไม่ใช่ถูกสุด: supplier 2 แพงกว่า → ต้องมี selectionReason
c.selectedSupplier = 2
r = isComplete(c, { requireCommitteeNames: false })
assert.equal(r.ok, false)
assert.ok(r.missing.some((m) => m.includes("เหตุผลที่ไม่เลือก")))
c.selectionReason = "ของใหม่ มือ 1 รับประกัน 1 ปี"
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true)
c.suppliers = [c.suppliers[0]]; c.selectedSupplier = 1
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, true, "รายเดียว + มีเหตุผล = ผ่าน (sole source)")
c.fewerQuotesReason = ""
assert.equal(isComplete(c, { requireCommitteeNames: false }).ok, false)

// --- isComplete: โหมด mix เต็มรูปแบบ (ทุกแถวกำหนด supplier เอง, selectedSupplier เป็น null) ---
{
  const mc = uh03(); mc.committee = mc.committee.map((m) => ({ ...m, name: "กรรมการ" }))
  mc.lineSupplier = [1, 2, 2, 2, 3]   // ตรงกับ pickLowestPerLine ทุกแถว (ถูกสุดพอดี) → ไม่ต้องมีเหตุผล
  assert.equal(isComplete(mc, { requireCommitteeNames: false }).ok, true, "mix ที่ถูกสุดทุกแถวอยู่แล้ว ไม่ต้องมีเหตุผล")
  mc.lineSupplier = [1, 1, 1, 1, 1]   // ไม่ตรง pickLowestPerLine ที่แถว 2-4 (ควรเป็น supplier 2)
  const rm = isComplete(mc, { requireCommitteeNames: false })
  assert.equal(rm.ok, false)
  assert.ok(rm.missing.some((m) => m.includes("เหตุผลที่ไม่เลือก")))
  mc.selectionReason = "เลือกช่างหมูทั้งหมดเพื่อความสะดวกส่งอู่เดียว"
  assert.equal(isComplete(mc, { requireCommitteeNames: false }).ok, true)

  // "ถูกสุด" ในโหมด mix วัดหลัง VAT: คุณณัฐเสนอแบบรวม VAT 22,000 < ช่างหมู 21,000+7% = 22,470
  const vc = uh03(); vc.committee = vc.committee.map((m) => ({ ...m, name: "กรรมการ" }))
  vc.suppliers[1].vatMode = "incl"; vc.suppliers[1].prices[0] = 22000
  vc.lineSupplier = [1, 2, 2, 2, 3]
  const rv = isComplete(vc, { requireCommitteeNames: false })
  assert.equal(rv.ok, false, "แถว 1 เลือกช่างหมูซึ่งแพงกว่าหลัง VAT → ต้องมีเหตุผล")
  assert.ok(rv.missing.some((m) => m.includes("เหตุผลที่ไม่เลือก")))
  vc.lineSupplier = [2, 2, 2, 2, 3]
  assert.equal(isComplete(vc, { requireCommitteeNames: false }).ok, true, "เลือกถูกสุดหลัง VAT ทุกแถว = ไม่ต้องมีเหตุผล")
}

// --- canTransition ---
const tr = uh03()
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, false, "ยังไม่เลือกผู้ได้รับเลือก")
tr.selectedSupplier = 3
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, false, "เลือกรายแพงสุดโดยไม่มีเหตุผล → บล็อก")
tr.selectedSupplier = 1
assert.equal(canTransition("ร่าง", "รอลงนาม", tr).ok, true, "ชื่อกรรมการกรอกทีหลังได้")
assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tr).ok, false, "วันที่ลงนามยังไม่ครบ")
tr.committee = tr.committee.map((m) => ({ ...m, name: "ก", signedDate: "2026-09-07" }))
assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tr).ok, true)
assert.equal(canTransition("เสร็จสิ้น", "รอลงนาม", tr).ok, true, "เปิดแก้ไขได้")
assert.equal(canTransition("ร่าง", "เสร็จสิ้น", tr).ok, false, "ข้ามขั้นไม่ได้")
assert.equal(canTransition("รอลงนาม", "ร่าง", tr).ok, true, "ถอยกลับร่างได้")
assert.equal(canTransition("ร่าง", "ร่าง", tr).ok, true)

// --- canTransition: โหมด mix เต็มรูปแบบ ผ่านได้โดยไม่ต้องมี selectedSupplier ของทั้งใบเลย ---
{
  const tm = uh03(); tm.lineSupplier = [1, 2, 2, 2, 3]   // ตรง pickLowestPerLine ทุกแถว
  assert.equal(canTransition("ร่าง", "รอลงนาม", tm).ok, true, "mix ถูกสุดทุกแถว ไม่ต้องมี selectedSupplier")
  assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tm).ok, false, "ชื่อ/วันที่ลงนามกรรมการยังไม่ครบ")
  tm.committee = tm.committee.map((mm) => ({ ...mm, name: "ก", signedDate: "2026-09-07" }))
  assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", tm).ok, true)
}

// --- normalizeDoc: เติม default, แปลงเลขจาก string, ตัด supplier เกิน 4, prices ยาวเท่า items ---
const n = normalizeDoc({
  title: " งาน ", items: [{ name: "a", qty: "2", unit: "" }, { name: "b", qty: 1 }],
  suppliers: [{ name: "x", prices: ["10"], vatMode: "incl", quoteDate: "2026-09-03", validUntil: "2026-10-03T00:00:00Z" }, { vatMode: "weird" }, {}, {}, { name: "เกิน" }],
  committee: [{ name: "ก" }],
  selectedSupplier: "2",
  selectionReason: "  ของใหม่  ",
})
assert.equal(n.suppliers[0].vatMode, "incl")
assert.equal(n.suppliers[0].validUntil, "2026-10-03", "ตัดเหลือ YYYY-MM-DD")
assert.equal(n.suppliers[1].vatMode, "excl", "ค่าแปลก → default excl")
assert.equal(n.selectionReason, "ของใหม่")
assert.equal(n.fewerQuotesReason, "")
assert.equal(n.title, "งาน")
assert.equal(n.items[0].qty, 2)
assert.equal(n.suppliers.length, 4)
assert.deepEqual(n.suppliers[0].prices, [10, null])
assert.equal(n.suppliers[1].discount, 0)
assert.equal(n.suppliers[1].conditions.payment, "")
assert.equal(n.committee.length, 4, "กรรมการเติมให้ครบ 4 ช่องเสมอ")
assert.equal(n.committee[0].name, "ก")
assert.equal(n.committee[1].role.length > 0, true, "ช่องที่เติมมี role ตามฟอร์ม")
assert.equal(n.selectedSupplier, 2)
assert.equal(n.status, "ร่าง")
assert.deepEqual(n.evidenceFiles, [])

// --- normalizeDoc: sku (รหัสสินค้า ATMS จาก SkuPicker) — เก็บแบบตัดช่องว่าง, ว่าง/ไม่มี → undefined ---
{
  const ns = normalizeDoc({ items: [{ name: "a", qty: 1, sku: "  S9WR001  " }, { name: "b", qty: 1, sku: "" }, { name: "c", qty: 1 }] })
  assert.equal(ns.items[0].sku, "S9WR001", "ตัดช่องว่างหน้า-หลัง")
  assert.equal(ns.items[1].sku, undefined, "sku ว่าง → undefined ไม่ใช่ \"\"")
  assert.equal(ns.items[2].sku, undefined, "ไม่ส่ง sku มา → undefined")
}

// --- normalizeDoc: intInRange ต้อง null ค่านอกช่วง/ไม่ใช่จำนวนเต็ม ไม่ใช่ปล่อยผ่าน ---
assert.equal(normalizeDoc({ selectedSupplier: 999 }).selectedSupplier, null)
assert.equal(normalizeDoc({ selectedSupplier: 0 }).selectedSupplier, null)
assert.equal(normalizeDoc({ selectedSupplier: 2.5 }).selectedSupplier, null)
assert.equal(normalizeDoc({ committee: [{ pickedSupplier: 7 }] }).committee[0].pickedSupplier, null)

// --- normalizeDoc: ทิ้ง extraOptions ของเอกสารเก่า (ร่าง multi-grade ที่ถูกตัดทิ้ง) + lineSupplier (mix ต่อรายการ) ---
{
  const n2 = normalizeDoc({
    items: [{ name: "a", qty: 1 }, { name: "b", qty: 1 }],
    suppliers: [{ name: "x", prices: [10, 20], extraOptions: [[{ label: "เทียบ", price: "5" }], "not-array"] }],
    lineSupplier: ["1", 99, null],
  })
  assert.equal("extraOptions" in n2.suppliers[0], false, "extraOptions ที่ค้างในเอกสารเก่าถูกทิ้ง ไม่ throw")
  assert.deepEqual(n2.suppliers[0].prices, [10, 20], "ราคายังปกติ")
  assert.deepEqual(n2.lineSupplier, [1, null], "ยาวเท่า items เสมอ; ค่านอกช่วง (99) → null")
  assert.deepEqual(normalizeDoc({}).lineSupplier, [], "ไม่มี items เลย → lineSupplier ว่างเปล่าตาม")
}

// --- normalizeDoc: เลือกครบทุกแถวแล้ว selectedSupplier ของทั้งใบต้องถูกล้าง (ห้ามมีสถานะ "ตั้งไว้ทั้งคู่") ---
{
  const both = normalizeDoc({
    items: [{ name: "a", qty: 1 }, { name: "b", qty: 1 }],
    suppliers: [{ name: "x", prices: [10, 20] }, { name: "y", prices: [30, 5] }],
    selectedSupplier: 2,
    lineSupplier: [1, 1],
  })
  assert.equal(both.selectedSupplier, null, "เลือกรายบรรทัดครบทุกแถว → ล้าง selectedSupplier ของทั้งใบ")
  assert.deepEqual(both.lineSupplier, [1, 1], "การเลือกรายบรรทัดยังอยู่ครบ")
  // แถว 2: เลือกเจ้า 1 (20) ทั้งที่เจ้า 2 ถูกกว่า (5) → ต้องขอเหตุผลตามเกณฑ์โหมดผสม ไม่ใช่เกณฑ์เลือกทั้งใบ
  const rBoth = isComplete({ ...both, committee: both.committee.map((m) => ({ ...m, name: "ก" })), fewerQuotesReason: "ทดสอบ" })
  assert.ok(rBoth.missing.includes("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด"), `ต้องขอเหตุผลโหมดผสม (ได้ ${JSON.stringify(rBoth.missing)})`)
  assert.ok(!rBoth.missing.includes("ผู้ได้รับเลือก"), "โหมดผสมเต็มใบไม่ต้องมีผู้ได้รับเลือกทั้งใบ")
  // ยังไม่ครบทุกแถว → selectedSupplier ยังต้องอยู่ (โหมดผสมบางส่วน fallback ไปที่ผู้ได้รับเลือกทั้งใบ)
  assert.equal(normalizeDoc({
    items: [{ name: "a", qty: 1 }, { name: "b", qty: 1 }],
    suppliers: [{ name: "x", prices: [10, 20] }],
    selectedSupplier: 1, lineSupplier: [1, null],
  }).selectedSupplier, 1, "เลือกไม่ครบทุกแถว → selectedSupplier ยังมีความหมาย")
}

// --- validateDoc ---
assert.deepEqual(validateDoc(uh03()), [])
const bad = uh03()
bad.items = []
assert.ok(validateDoc(bad).some((m) => m.includes("รายการ")))
const bad2 = uh03(); bad2.suppliers = []
assert.ok(validateDoc(bad2).some((m) => m.includes("supplier")))
const bad3 = uh03(); bad3.items[0].qty = 0
assert.ok(validateDoc(bad3).some((m) => m.includes("จำนวน")))
const bad4 = uh03(); bad4.suppliers[0].discount = -1
assert.ok(validateDoc(bad4).some((m) => m.includes("ส่วนลด")))
const bad5 = uh03(); bad5.selectedSupplier = 4
assert.ok(validateDoc(bad5).some((m) => m.includes("ผู้ได้รับเลือก")))
const bad6 = uh03(); bad6.committee[0].pickedSupplier = 9
assert.ok(validateDoc(bad6).some((m) => m.includes("กรรมการ")))
const bad7 = uh03(); bad7.suppliers[0].prices = [1]
assert.ok(validateDoc(bad7).some((m) => m.includes("ราคา")))
const bad10 = uh03(); bad10.lineSupplier = [1]
assert.ok(validateDoc(bad10).some((m) => m.includes("เลือก supplier ต่อรายการ")), "lineSupplier ยาวไม่เท่า items")
const bad11 = uh03(); bad11.lineSupplier = [9, null, null, null, null]
assert.ok(validateDoc(bad11).some((m) => m.includes("ซึ่งไม่มี")), "lineSupplier ชี้ไป supplier ที่ไม่มีจริง")
const bad12 = uh03(); bad12.suppliers[1].prices[2] = null; bad12.lineSupplier = [1, 2, 2, 2, 3]
assert.ok(validateDoc(bad12).some((m) => m === "แถว 3: เจ้าที่เลือกไม่ได้เสนอราคา"), "เลือกเจ้าที่ไม่ได้เสนอราคาแถวนั้น")
{ const ok12 = uh03(); ok12.lineSupplier = [1, 2, 2, 2, 3]; assert.deepEqual(validateDoc(ok12), [], "เลือกครบและทุกเจ้าเสนอราคาจริง = ผ่าน") }
// เอกสารที่ประกอบมือ (ไม่ผ่าน normalizeDoc) ตั้งทั้งใบ + ครบทุกแถวพร้อมกัน → ต้องถูกปฏิเสธ
const bad13 = uh03(); bad13.selectedSupplier = 1; bad13.lineSupplier = [1, 2, 2, 2, 3]
assert.ok(validateDoc(bad13).includes("เลือกทั้งใบและเลือกรายบรรทัดครบทุกแถวพร้อมกันไม่ได้"))
{ const ok13 = uh03(); ok13.selectedSupplier = 1; ok13.lineSupplier = [1, 2, 2, 2, null]; assert.deepEqual(validateDoc(ok13), [], "เลือกทั้งใบ + รายบรรทัดบางส่วน = ผ่าน (แถวที่เหลือ fallback)") }

// --- docNo / counter key (ปี ค.ศ. 2 หลักท้าย + เดือน — ตามฟอร์มต้นแบบ PC-2609-002 ลงวันที่ 7/9/2569) ---
assert.equal(docNoFor("2026-09-07", 2), "PC-2609-002")
assert.equal(docNoFor("2026-12-31", 123), "PC-2612-123")
assert.equal(docNoFor("2027-01-01", 1), "PC-2701-001")
assert.equal(counterKeyFor("2026-09-07"), "price_compare:2609")

// --- isDocNo: แยก docNo (PC-YYMM-NNN) จาก ObjectId/ค่าอื่นๆ สำหรับเส้นทาง [id] ---
assert.equal(isDocNo("PC-2609-008"), true)
assert.equal(isDocNo("pc-2609-008"), false, "ต้องเป็นตัวพิมพ์ใหญ่")
assert.equal(isDocNo("PC-2609-8"), false, "ลำดับต้อง 3 หลัก")
assert.equal(isDocNo("6a9fc6e4c66edda96557faac"), false, "24-hex ไม่ใช่ docNo")

// --- fmtMoney ---
assert.equal(fmtMoney(50690), "50,690.00")
assert.equal(fmtMoney(3548.3), "3,548.30")
assert.equal(fmtMoney(null), "")

// --- diffPriceCompare (lib/price-compare-log.ts — pure ส่วน diff) ---
{
  const a = uh03(), b = uh03()
  b.title = "Pump UH03"; b.status = "รอลงนาม"; b.selectedSupplier = 1
  b.items.push({ name: "เพิ่ม", qty: 1, unit: "ชิ้น" }); b.suppliers.forEach((s) => s.prices.push(null))
  b.suppliers.pop(); b.links.prCode = "LBPR26090001"; b.links.repairExternalId = "abc123"
  const ch = diffPriceCompare(a, b)
  const f = (name: string) => ch.find((c) => c.field === name)
  assert.deepEqual(f("title"), { field: "title", label: "ชื่อสินค้า/งานซ่อม", from: "Pump + Motor UH03", to: "Pump UH03" })
  assert.equal(f("status")?.to, "รอลงนาม")
  assert.deepEqual(f("selectedSupplier"), { field: "selectedSupplier", label: "ผู้ได้รับเลือก", from: "", to: "Supplier 1 (ช่างหมู)" })
  assert.deepEqual(f("items"), { field: "items", label: "รายการ", from: "5 แถว", to: "6 แถว" })
  assert.deepEqual(f("suppliers"), { field: "suppliers", label: "Supplier", from: "3 ราย", to: "2 ราย" })
  assert.deepEqual(f("links.prCode"), { field: "links.prCode", label: "PR", from: "", to: "LBPR26090001" })
  assert.deepEqual(f("links.repairExternalId"), { field: "links.repairExternalId", label: "งานซ่อมอู่นอก", from: "", to: "abc123" })
  // b เพิ่มรายการอีก 1 แถว แต่ยังไม่เลือกสักแถวทั้งคู่ → ไม่ต้องมีบรรทัด "เลือกรายบรรทัด" (บรรทัด "รายการ" บอกอยู่แล้ว)
  assert.equal(f("lineSupplier"), undefined, "ไม่มีการมอบหมายรายแถวทั้งก่อนและหลัง → ไม่ขึ้น log")
  assert.equal(ch.length, 7, "เพิ่ม links.repairExternalId; แก้ราคารายช่องต้องไม่ขึ้นใน log (selectionReason/fewerQuotesReason ไม่เปลี่ยน)")
  assert.deepEqual(diffPriceCompare(a, a), [])
}

// --- diff: เลือก supplier รายบรรทัดเพิ่ม/ลด ต้องขึ้น log แม้จำนวนรายการเท่าเดิม ---
{
  const a = uh03(), b = uh03()
  b.lineSupplier = [1, 2, 2, 2, 3]
  const ch = diffPriceCompare(a, b)
  assert.deepEqual(ch, [{ field: "lineSupplier", label: "เลือกรายบรรทัด", from: "0/5 แถว (-,-,-,-,-)", to: "5/5 แถว (1,2,2,2,3)" }])
  // สลับเจ้าในแถวเดิมโดยจำนวนแถวที่เลือกเท่าเดิม — ใครได้งานเปลี่ยนไปจริง จึงต้องขึ้น log ผ่านเวกเตอร์
  const c = uh03(); c.lineSupplier = [3, 2, 2, 2, 1]
  assert.deepEqual(diffPriceCompare(b, c), [{ field: "lineSupplier", label: "เลือกรายบรรทัด", from: "5/5 แถว (1,2,2,2,3)", to: "5/5 แถว (3,2,2,2,1)" }])
  assert.deepEqual(diffPriceCompare(c, c), [], "ไม่เปลี่ยนอะไรเลย = ไม่มี diff")
  // เพิ่มรายการในใบที่ยังไม่เลือกสักแถว: addItem ต่อ null ท้าย lineSupplier ด้วย → เวกเตอร์ยาวไม่เท่ากัน
  // แต่ยังไม่มีใครได้งานสักแถว จึงต้องไม่ขึ้นบรรทัดนี้ (บรรทัด "รายการ" บอกไปแล้ว)
  const n0 = uh03()
  const n1 = uh03(); n1.items.push({ name: "เพิ่ม", qty: 1, unit: "ชิ้น" }); n1.suppliers.forEach((sp) => sp.prices.push(null)); n1.lineSupplier.push(null)
  assert.equal(diffPriceCompare(n0, n1).find((x) => x.field === "lineSupplier"), undefined,
    "ยังไม่เลือกสักแถวทั้งสองฝั่ง → เวกเตอร์ที่ยาวไม่เท่ากันต้องไม่ทำให้ขึ้น log")
  assert.ok(diffPriceCompare(n0, n1).some((x) => x.field === "items"), "แต่ต้องยังมีบรรทัดรายการ")
  // ใบเดียวกันแต่มีการเลือกอยู่แล้ว 1 แถว → เวกเตอร์ยาวขึ้นต้องขึ้น log (ตัวหารเปลี่ยนจริง)
  const k0 = uh03(); k0.lineSupplier = [1, null, null, null, null]
  const k1 = uh03(); k1.items.push({ name: "เพิ่ม", qty: 1, unit: "ชิ้น" }); k1.suppliers.forEach((sp) => sp.prices.push(null)); k1.lineSupplier = [1, null, null, null, null, null]
  assert.deepEqual(diffPriceCompare(k0, k1).find((x) => x.field === "lineSupplier"),
    { field: "lineSupplier", label: "เลือกรายบรรทัด", from: "1/5 แถว (1,-,-,-,-)", to: "1/6 แถว (1,-,-,-,-,-)" })

  // เพิ่มรายการในใบที่ "มี" การเลือกอยู่แล้ว → ตัวหารเปลี่ยน ต้องขึ้น log
  const e = uh03(); e.lineSupplier = [1, 2, 2, 2, 3]
  const g = uh03(); g.lineSupplier = [1, 2, 2, 2, 3]; g.items.push({ name: "เพิ่ม", qty: 1, unit: "ชิ้น" }); g.suppliers.forEach((sp) => sp.prices.push(null))
  assert.deepEqual(diffPriceCompare(e, g).find((x) => x.field === "lineSupplier"),
    { field: "lineSupplier", label: "เลือกรายบรรทัด", from: "5/5 แถว (1,2,2,2,3)", to: "5/6 แถว (1,2,2,2,3)" })
}

// ======================================================================
// --- เกรดเป็นแถวย่อยของรายการ (spec 2026-09-11-price-compare-grades-design.md) ---
// Pump Rexroth 1 ตัว มี 3 เกรด (กลุ่มเดียวกัน แถวติดกัน): มือ 1 [—, 30,000, 30,000] · มือ 2 [—, —, 25,000] · ซ่อมเดิม [21,000, —, —]
// + HYD/เกียร์/ค่าแรงเดิมจาก uh03 — ทุกเจ้า excl
const PUMP = "g-pump01"
function gradesDoc(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-998"; d.createdAt = "2026-09-11T09:00:00.000+07:00"; d.updatedAt = d.createdAt
  d.title = "Pump UH03 (เทียบเกรด)"; d.requestDept = "ยานยนต์"
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว", group: PUMP, grade: "มือ 1" },
    { name: "Pump Rexroth", qty: 1, unit: "ตัว", group: PUMP, grade: "มือ 2" },
    { name: "Pump Rexroth", qty: 1, unit: "ตัว", group: PUMP, grade: "ซ่อมเดิม" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" },
    { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, prices: (number | null)[]): PcSupplier => ({ ...emptySupplier(6), name, prices })
  d.suppliers = [
    s("ช่างหมู", [null, null, 21000, 110.56, 180, 7000]),
    s("คุณณัฐ", [30000, null, null, 100, 100, 5500]),
    s("ศศ&ณ",  [30000, 25000, null, 107.14, 107.14, 5000]),
  ]
  d.lineSupplier = d.items.map(() => null)
  return d
}
const BEST = [null, null, 1, 2, 2, 3]          // ซ่อมเดิม·S1, HYD·S2, เกียร์·S2, ค่าแรง·S3
const ALT = [null, 3, null, 2, 2, 3]           // เลือก มือ 2·S3 แทน
const OPEN = [null, null, null, 2, 2, 3]       // กลุ่ม Pump ยังไม่เลือกเกรด
const named = (x: PriceCompare) => { x.committee = x.committee.map((m) => ({ ...m, name: "กรรมการ" })); return x }

// --- groupsOf / countedRows / hasGrades / newGroupId ---
{
  const g = gradesDoc()
  const gs = groupsOf(g)
  assert.deepEqual(gs.map((x) => x.rows), [[0, 1, 2], [3], [4], [5]], "เรียงตามลำดับ; รายการธรรมดา = กลุ่มขนาด 1")
  assert.equal(gs[0].key, PUMP)
  assert.equal(new Set(gs.map((x) => x.key)).size, 4, "key ของรายการธรรมดาไม่ชนกัน/ไม่ชนกับ group จริง")
  assert.deepEqual(groupsOf(uh03()).map((x) => x.rows), [[0], [1], [2], [3], [4]], "เอกสารเดิมทุกแถวเป็นกลุ่มขนาด 1")

  assert.deepEqual(countedRows(g), [false, false, false, true, true, true], "กลุ่มค้าง → ไม่นับทุกแถวของกลุ่ม")
  g.lineSupplier = [...BEST]
  assert.deepEqual(countedRows(g), [false, false, true, true, true, true], "กลุ่มหลายเกรด → นับเฉพาะแถวที่เลือก")
  assert.deepEqual(countedRows(uh03()), [true, true, true, true, true], "เอกสารเดิมนับทุกแถวแม้ยังไม่เลือก")

  assert.equal(hasGrades(gradesDoc()), true)
  assert.equal(hasGrades(uh03()), false)
  const lone = uh03(); lone.items[0] = { ...lone.items[0], group: "g-lone", grade: "มือ 1" }
  assert.equal(hasGrades(lone), false, "group ที่เหลือแถวเดียว = รายการธรรมดา")

  const id1 = newGroupId(), id2 = newGroupId()
  assert.match(id1, /^g-[a-z0-9]{6}$/)
  assert.notEqual(id1, id2)
}

// --- pickLowestPerLine / mixedTotals / bestMixNet / mixedGap (group-aware) ---
{
  const g = gradesDoc()
  assert.deepEqual(pickLowestPerLine(g), BEST, "ต่อกลุ่มเลือกคู่ (เกรด, เจ้า) ที่สุทธิหลัง VAT ต่ำสุด; แถวอื่นในกลุ่ม = null")
  g.lineSupplier = [...BEST]
  const mt = mixedTotals(g)!
  assert.ok(mt)
  assert.deepEqual(mt.perSupplier[0], { subtotal: 21000, vat: 1470, net: 22470, lines: 1 }, "S1: ซ่อมเดิม 21,000")
  assert.deepEqual(mt.perSupplier[1], { subtotal: 2800, vat: 196, net: 2996, lines: 2 }, "S2: 100×18 + 100×10")
  assert.deepEqual(mt.perSupplier[2], { subtotal: 5000, vat: 350, net: 5350, lines: 1 }, "S3: ค่าแรง 5,000")
  assert.equal(mt.grand, 30816)
  assert.equal(mt.suppliersUsed, 3)
  assert.equal(mixedNet(g), 30816)
  assert.equal(bestMixNet(g), 30816)
  assert.equal(mixedGap(g), 0)
  assert.equal(allLinesAwarded(g), true, "ทุกกลุ่มเลือกครบ 1 แถว")

  const alt = gradesDoc(); alt.lineSupplier = [...ALT]
  assert.equal(mixedNet(alt), 35096, "มือ 2·S3 25,000 + ค่าแรง 5,000 → S3 32,100")
  assert.equal(mixedGap(alt), 4280)
  assert.equal(allLinesAwarded(alt), true)

  const open = gradesDoc(); open.lineSupplier = [...OPEN]
  assert.equal(mixedTotals(open), null, "กลุ่มค้าง → null")
  assert.equal(mixedGap(open), null)
  assert.equal(allLinesAwarded(open), false)

  const two = gradesDoc(); two.lineSupplier = [2, null, 1, 2, 2, 3]
  assert.equal(mixedTotals(two), null, "เลือก 2 เกรดในกลุ่มเดียว = กำกวม → null (validateDoc ปฏิเสธ)")
  assert.equal(allLinesAwarded(two), false)

  // รายการธรรมดายัง fallback ไป selectedSupplier ทั้งใบได้ตามเดิม (เอกสารที่ไม่ผ่าน normalize)
  const fb = gradesDoc(); fb.selectedSupplier = 2; fb.lineSupplier = [null, null, 1, null, null, 3]
  assert.equal(mixedNet(fb), 30816, "HYD/เกียร์ fallback ไป S2")
  // แต่กลุ่มหลายเกรดไม่ fallback — ต้องเลือกเกรดเอง
  const fb2 = gradesDoc(); fb2.selectedSupplier = 3; fb2.lineSupplier = [null, null, null, 2, 2, 3]
  assert.equal(mixedTotals(fb2), null, "กลุ่มหลายเกรดไม่ใช้ selectedSupplier แทนการเลือกเกรด")

  const none = gradesDoc(); none.suppliers.forEach((sp) => { sp.prices[0] = null; sp.prices[1] = null; sp.prices[2] = null })
  assert.deepEqual(pickLowestPerLine(none), [null, null, null, 2, 2, 3], "ไม่มีใครเสนอราคาเกรดไหนเลย → ทั้งกลุ่ม null")
  assert.equal(bestMixNet(none), null)
}

// --- supplierTotals / lowestNet / completeSupplierCount: คิดจากแถวที่นับ ---
{
  const g = gradesDoc()
  assert.equal(supplierTotals(g, 0).subtotal, 10790.08, "กลุ่มค้าง: ไม่นับเกรดไหนเลย (1,990.08 + 1,800 + 7,000)")
  assert.equal(supplierTotals(g, 2).subtotal, 7999.92)
  g.lineSupplier = [...BEST]
  assert.equal(supplierTotals(g, 0).subtotal, 31790.08, "นับเฉพาะเกรดที่เลือก (ซ่อมเดิม 21,000)")
  assert.equal(supplierTotals(g, 2).subtotal, 7999.92, "S3 ไม่ได้เสนอราคาเกรดที่เลือก → ไม่มียอดกลุ่มนี้")
  g.lineSupplier = [...ALT]
  assert.equal(supplierTotals(g, 2).subtotal, 32999.92, "เลือก มือ 2 → S3 นับ 25,000")
  assert.equal(supplierTotals(g, 0).subtotal, 10790.08)
  assert.equal(supplierTotals({ items: g.items, suppliers: g.suppliers }, 1).subtotal, 8300, "ไม่ส่ง lineSupplier = ยังไม่เลือกเกรด")
  const nets = g.suppliers.map((_, i) => supplierTotals(g, i).net)
  assert.equal(lowestNet(g), nets.indexOf(Math.min(...nets)), "lowestNet เทียบยอดจากแถวที่นับ")

  assert.equal(completeSupplierCount(gradesDoc()), 3, "ครบ = เสนออย่างน้อย 1 เกรดของทุกรายการ")
  const x = gradesDoc(); x.suppliers[1].prices[0] = null
  assert.equal(completeSupplierCount(x), 2, "S2 ไม่ได้เสนอเกรดไหนของ Pump เลย → ไม่ครบ")
}

// --- isComplete / canTransition ---
{
  const g = named(gradesDoc()); g.lineSupplier = [...BEST]
  assert.deepEqual(isComplete(g).missing, [], "เลือกถูกสุดทุกกลุ่ม ไม่ต้องมีเหตุผล")
  assert.equal(canTransition("ร่าง", "รอลงนาม", g).ok, true)

  const alt = gradesDoc(); alt.lineSupplier = [...ALT]
  const ra = isComplete(alt, { requireCommitteeNames: false })
  assert.ok(ra.missing.includes("เหตุผลที่ไม่เลือกรายสุทธิต่ำสุด"), `เลือก มือ 2·S3 ไม่ใช่ถูกสุด (ได้ ${JSON.stringify(ra.missing)})`)
  alt.selectionReason = "มือ 2 รับประกัน 6 เดือน ซ่อมเดิมไม่มีประกัน"
  assert.equal(isComplete(alt, { requireCommitteeNames: false }).ok, true)

  const open = gradesDoc(); open.lineSupplier = [...OPEN]
  const ro = isComplete(open, { requireCommitteeNames: false })
  assert.ok(ro.missing.includes("ยังไม่เลือกเกรด: Pump Rexroth"), `กลุ่มค้าง (ได้ ${JSON.stringify(ro.missing)})`)
  assert.ok(!ro.missing.includes("ผู้ได้รับเลือก"), "เลือกรายการธรรมดาครบแล้ว — ขาดแค่เกรด ไม่ต้องขึ้น ผู้ได้รับเลือก ซ้ำ")
  assert.equal(canTransition("ร่าง", "รอลงนาม", open).ok, false)
  assert.equal(canTransition("รอลงนาม", "เสร็จสิ้น", open).ok, false, "กลุ่มค้าง = ยังเลือกไม่ครบ")
}

// --- validateDoc ---
{
  const ok = gradesDoc(); ok.lineSupplier = [...BEST]
  assert.deepEqual(validateDoc(ok), [])
  assert.deepEqual(validateDoc(gradesDoc()), [], "กลุ่มค้างยังบันทึกร่างได้ (isComplete เป็นด่านส่งลงนาม)")

  const two = gradesDoc(); two.lineSupplier = [2, null, 1, 2, 2, 3]
  assert.ok(validateDoc(two).some((m) => m.includes("เลือกได้ไม่เกิน 1 เกรด")), JSON.stringify(validateDoc(two)))

  const gap = gradesDoc(); gap.items[4] = { ...gap.items[4], group: PUMP, grade: "แยก" }
  assert.ok(validateDoc(gap).some((m) => m.includes("ต้องอยู่ติดกัน")), JSON.stringify(validateDoc(gap)))

  const blank = gradesDoc(); blank.items[1] = { ...blank.items[1], grade: "  " }
  assert.ok(validateDoc(blank).some((m) => m.includes("ชื่อเกรด")), JSON.stringify(validateDoc(blank)))
  const noGrade = gradesDoc(); delete noGrade.items[2].grade
  assert.ok(validateDoc(noGrade).some((m) => m.includes("ชื่อเกรด")))

  const whole = gradesDoc(); whole.selectedSupplier = 1; whole.lineSupplier = [null, null, 1, null, null, null]
  assert.ok(validateDoc(whole).some((m) => m.includes("หลายเกรด")), "มีรายการหลายเกรด = เลือกรายบรรทัดทั้งใบ ห้ามเลือกทั้งใบ")
}

// --- normalizeDoc: รับ group/grade, sync ชื่อ/จำนวน/หน่วย/sku ในกลุ่ม, hasGrades → selectedSupplier = null ---
{
  const ng = normalizeDoc({
    items: [
      { name: " Pump Rexroth ", qty: "1", unit: "ตัว", sku: " S9PU001 ", group: " g-pump01 ", grade: " มือ 1 " },
      { name: "ชื่อเพี้ยน", qty: 3, unit: "ชิ้น", group: "g-pump01", grade: "มือ 2" },
      { name: "", qty: 0, unit: "", sku: "OTHER", group: "g-pump01", grade: "ซ่อมเดิม" },
      { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร", group: "", grade: "" },
    ],
    suppliers: [{ name: "x", prices: [null, null, 21000, 110.56] }],
    selectedSupplier: 1, lineSupplier: [null, null, 1, null],
  })
  assert.deepEqual(ng.items[0], { name: "Pump Rexroth", qty: 1, unit: "ตัว", sku: "S9PU001", group: "g-pump01", grade: "มือ 1" })
  assert.deepEqual(ng.items[1], { name: "Pump Rexroth", qty: 1, unit: "ตัว", sku: "S9PU001", group: "g-pump01", grade: "มือ 2" }, "sync จากแถวแรกของกลุ่ม")
  assert.deepEqual(ng.items[2], { name: "Pump Rexroth", qty: 1, unit: "ตัว", sku: "S9PU001", group: "g-pump01", grade: "ซ่อมเดิม" }, "sku ก็ sync")
  assert.equal("group" in ng.items[3], false, "group ว่าง → ไม่มี key (รายการธรรมดา)")
  assert.equal("grade" in ng.items[3], false)
  assert.equal(ng.selectedSupplier, null, "มีรายการหลายเกรด → ล้างการเลือกทั้งใบ")
  assert.deepEqual(ng.lineSupplier, [null, null, 1, null])
  const nsku = normalizeDoc({ items: [{ name: "a", qty: 1, group: "g1", grade: "A" }, { name: "b", qty: 1, sku: "X", group: "g1", grade: "B" }] })
  assert.equal(nsku.items[1].sku, undefined, "แถวแรกไม่มี sku → ทั้งกลุ่มไม่มี sku")
  // เอกสารเดิม: รูปทรง item ไม่เปลี่ยน (ไม่มี key group/grade งอก)
  const plain = normalizeDoc(uh03())
  assert.deepEqual(Object.keys(plain.items[0]).sort(), ["name", "qty", "sku", "unit"])
  assert.deepEqual(normalizeDoc({ ...gradesDoc(), lineSupplier: [...BEST] }).lineSupplier, BEST)
}

// --- diffPriceCompare: สรุปจำนวนแถวเกรด ---
{
  const a = gradesDoc(), b = gradesDoc()
  b.items.splice(3, 0, { name: "Pump Rexroth", qty: 1, unit: "ตัว", group: PUMP, grade: "ของเทียบ" })
  b.suppliers.forEach((sp) => sp.prices.splice(3, 0, null)); b.lineSupplier.splice(3, 0, null)
  const ch = diffPriceCompare(a, b)
  assert.deepEqual(ch.find((x) => x.field === "grades"), { field: "grades", label: "เกรด", from: "3 เกรด", to: "4 เกรด" })
  const p = uh03()
  const q = uh03(); q.items[4] = { ...q.items[4] }
  const fromPlain = gradesDoc()
  assert.deepEqual(diffPriceCompare(p, fromPlain).find((x) => x.field === "grades"), { field: "grades", label: "เกรด", from: "0 เกรด", to: "3 เกรด" })
  assert.equal(diffPriceCompare(p, q).find((x) => x.field === "grades"), undefined, "เอกสารเดิมไม่มีบรรทัดเกรด")
  const s1 = gradesDoc(); s1.lineSupplier = [...BEST]
  const s2 = gradesDoc(); s2.lineSupplier = [...ALT]
  const sw = diffPriceCompare(s1, s2)
  assert.equal(sw.find((x) => x.field === "grades"), undefined, "เปลี่ยนเกรดที่เลือก ไม่เปลี่ยนจำนวนเกรด")
  assert.ok(sw.some((x) => x.field === "lineSupplier"), "การเปลี่ยนเกรดที่เลือกขึ้นผ่านเวกเตอร์ lineSupplier")
}

console.log("check-price-compare-core: OK")
