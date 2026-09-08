// scripts/check-price-compare-core.ts
// รัน: npx tsx scripts/check-price-compare-core.ts   (repo ไม่มี test framework — ใช้ assert ตามแพตเทิร์น check-deadstock-core.ts)
import assert from "node:assert/strict"
import {
  newDoc, emptySupplier, supplierTotals, lowestPerLine, lowestNet, isComplete, canTransition,
  normalizeDoc, validateDoc, docNoFor, counterKeyFor, fmtMoney, lineTotal, round2,
  completeSupplierCount, isQuoteExpired, MIN_QUOTES,
  type PriceCompare, type PcSupplier,
} from "../lib/price-compare"

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

// --- lowestPerLine / lowestNet ---
assert.deepEqual(lowestPerLine(d), [0, 1, 1, 1, 2])
assert.equal(lowestNet(d), 0)
d.suppliers[0].prices = [null, null, null, null, null]
assert.equal(lowestNet(d), 1, "supplier ที่ไม่มีราคาเลย ไม่ถือว่าถูกสุด")
assert.deepEqual(lowestPerLine({ items: d.items, suppliers: [] }), [null, null, null, null, null])
assert.equal(lowestNet({ items: d.items, suppliers: [] }), null)

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

// --- docNo / counter key (ปี พ.ศ. 2 หลักท้าย + เดือน) ---
assert.equal(docNoFor("2026-09-07", 2), "PC-2609-002")
assert.equal(docNoFor("2026-12-31", 123), "PC-2612-123")
assert.equal(docNoFor("2027-01-01", 1), "PC-2701-001")
assert.equal(counterKeyFor("2026-09-07"), "price_compare:2609")

// --- fmtMoney ---
assert.equal(fmtMoney(50690), "50,690.00")
assert.equal(fmtMoney(3548.3), "3,548.30")
assert.equal(fmtMoney(null), "")

console.log("check-price-compare-core: OK")
