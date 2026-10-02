// scripts/check-ap-import-files.ts — รัน: npx tsx scripts/check-ap-import-files.ts
// ตัวอ่านไฟล์ของปุ่ม นำเข้าการตั้งเบิก (lib/ap-voucher-import) + นำเข้าการจ่าย (lib/ap-payment-report-import)
// + เดือนจากเลข DD (lib/ap-dd-month) — ข้อมูลสังเคราะห์ตามโครงไฟล์จริงของบัญชี (ส่งมา 01/10/2026)
import assert from "node:assert/strict"
import { parseApVoucherSheet } from "../lib/ap-voucher-import"
import { isApPaymentReport, parseApPaymentReport } from "../lib/ap-payment-report-import"
import { ddMonth, ddMonthLabel, sortDdMonths } from "../lib/ap-dd-month"

// ── รายงานตั้งเจ้าหนี้อื่นๆ ──────────────────────────────────────────────────────
const VH = ["DocuDate", "DocuNo", "InvNo", "GoodRemark", "empname"]
const v = parseApVoucherSheet([
  VH,
  [46023, "LAPO26010745", "x", "ศลบ/ค่าแรง/71-1955/LBDD26010075/ค่าบริการ2900", "อาทิติยา มะยัง"],
  // ชื่อจริงในไฟล์มีช่องว่างคู่ — ต้องยังจับได้
  ["15/02/2026", "LAPO26020237", "x", "สสบ/ค่าล้างรถ/SBDD26020173 และ KKDD26020007", "วราพร  ชูชาวนา"],
  // DD เดียวตั้งหนี้ 2 ใบ → เก็บ Voucher ทั้งคู่ · วันตั้งหนี้ = ล่าสุด
  ["2026-03-01", "LAPO26030001", "x", "LBDD26010075", "อาทิติยา มะยัง"],
  // เลขเพี้ยน (7/9 หลัก, DDD, KDD) → ไม่เดาแก้ ไปกอง "อ่านไม่ได้"
  ["2026-01-19", "LAPO26010838", "x", "ศลบ/LBDD2010581/PM", "อาทิติยา มะยัง"],
  ["2026-05-01", "LAPO26050001", "x", "LBDDD26050033 / KDD26050009 / LBDD260403533", "วราพร ชูชาวนา"],
  // คนอื่นตั้งหนี้ → ไม่เอา
  ["2026-01-02", "LAPO26010002", "x", "LBDD26019999", "ธนพร สิตวงษ์"],
  // ไม่มีเลข DD เลย (ค่ายาง/อุปกรณ์สำนักงาน)
  ["2026-01-03", "LAPO26010003", "x", "สสบ./อุปกรณ์สำนักงาน/01/2026", "อาทิติยา มะยัง"],
])
assert.deepEqual(v.errors, [])
assert.equal(v.stats.rows, 7)
assert.equal(v.stats.kept, 6, "กรองเฉพาะ อาทิติยา/วราพร")
assert.equal(v.stats.noDd, 1)
assert.deepEqual(v.dds.map((d) => d.depositCode).sort(), ["KKDD26020007", "LBDD26010075", "SBDD26020173"])
const d75 = v.dds.find((d) => d.depositCode === "LBDD26010075")!
assert.deepEqual(d75.vouchers, ["LAPO26010745", "LAPO26030001"])
assert.equal(d75.docDate, "2026-03-01")
assert.equal(v.dds.find((d) => d.depositCode === "SBDD26020173")!.docDate, "2026-02-15", "วันที่ DD/MM/YYYY")
assert.deepEqual(v.unreadable.map((u) => u.token).sort(), ["KDD26050009", "LBDD2010581", "LBDD260403533", "LBDDD26050033"])
assert.equal(v.stats.dateFrom, "2026-01-01")
// ไฟล์ผิด → ปฏิเสธพร้อมเหตุผล ไม่เดา
assert.match(parseApVoucherSheet([["a", "b"], [1, 2]]).errors[0], /ไม่ใช่ไฟล์รายงานตั้งเจ้าหนี้/)
assert.match(parseApVoucherSheet([VH, ["2026-01-01", "LAPO1", "x", "LBDD26010075", "คนอื่น"]]).errors[0], /ไม่พบแถวของ/)

// ── รายงานจ่ายชำระเจ้าหนี้ ──────────────────────────────────────────────────────
// หัวคอลัมน์ซ้ำเหมือนไฟล์จริง: DocuDate ตัวแรก = วันจ่าย (PV) ตัวหลัง = วันของงาน
const PH = ["DocuNo_inv", "InvNo", "PayAmnt", "DocuNo", "DocuDate", "Remark", "DocuDate", "Remark"]
const p = parseApPaymentReport([
  PH,
  ["LAPO26010208", "IV1", 300, "PV426010282", "2026-01-20", "", "2020-01-01", ""],
  // LAPO เดียวกันจ่าย 2 งวด → รวมยอด เก็บ PV ทั้งคู่ วันจ่าย = ล่าสุด
  ["LAPO26010208", "IV1", 200, "PV426030030", "2026-03-05", "", "2020-01-01", ""],
  // ร้านคีย์เลข DD ไว้ใน InvNo
  ["LAPO26080739", "LBDD26080143", 2500, "PV426090128", "2026-09-03", "", "", ""],
  // ไม่มีเลขตั้งหนี้แต่มี DD ใน InvNo → แยกคีย์ต่อ PV
  ["", "KKDD26070008", 100, "PV426070001", "2026-07-10", "", "", ""],
  // ไม่มีเลขตั้งหนี้และไม่มี DD → ข้าม · ไม่มี PV → ข้าม
  ["", "IV9", 50, "PV426070002", "2026-07-11", "", "", ""],
  ["LAPO26099999", "IV8", 10, "", "2026-07-12", "", "", ""],
])
assert.ok(isApPaymentReport([PH]))
assert.ok(!isApPaymentReport([VH]), "ไฟล์ตั้งเจ้าหนี้ไม่ใช่รายงานจ่ายชำระ")
assert.ok(!isApPaymentReport([["รอบโอน 03/09/2026"], ["วันที่", "DD", "ซัพพลายเออร์"]]), "ใบปะหน้ารอบโอนแบบเดิม")
assert.deepEqual(p.errors, [])
assert.equal(p.stats.rows, 6)
assert.equal(p.stats.pvs, 4)
assert.equal(p.stats.invDdRows, 2)
const lp = p.items.find((i) => i.lapo === "LAPO26010208")!
assert.deepEqual(lp.pvs, ["PV426010282", "PV426030030"])
assert.equal(lp.date, "2026-03-05", "ใช้ DocuDate ตัวแรก (วันจ่าย) ไม่ใช่วันของงาน · หลายงวด = ล่าสุด")
assert.equal(lp.amount, 500)
assert.deepEqual(p.items.find((i) => i.lapo === "LAPO26080739")!.dds, ["LBDD26080143"])
const noLapo = p.items.find((i) => !i.lapo)!
assert.deepEqual(noLapo.dds, ["KKDD26070008"])
assert.equal(p.items.length, 3)
assert.match(parseApPaymentReport([["x"]]).errors[0], /ไม่ใช่ไฟล์รายงานจ่ายชำระเจ้าหนี้/)

// ── เดือนจากเลข DD ───────────────────────────────────────────────────────────
assert.equal(ddMonth("LBDD26010075"), "2601")
assert.equal(ddMonth("SBDD25120977"), "2512")
assert.equal(ddMonth("LBDD2010581"), "2010", "เลขเพี้ยนก็ยังได้ 4 หลักแรก")
assert.equal(ddMonth("KDD26050009"), "")
assert.equal(ddMonthLabel("2601"), "ม.ค. 69")
assert.equal(ddMonthLabel("2512"), "ธ.ค. 68")
assert.equal(ddMonthLabel("2600"), "เดือน 00/69")
assert.equal(ddMonthLabel(""), "ไม่ทราบเดือน")
assert.deepEqual(sortDdMonths(["2603", "", "2512", "2601", "2603"]), ["2512", "2601", "2603", ""])

console.log("✓ check-ap-import-files: ผ่านทั้งหมด")
