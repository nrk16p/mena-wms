// scripts/check-ap-pay-manual.ts — รัน: npx tsx scripts/check-ap-pay-manual.ts
// บัญชีเลือกวันจ่ายเองในกล่องยืนยันผ่าน (ปฏิทิน) — แยกจาก check-ap-tracking.ts ซึ่งหยุดที่ข้อคาดผลสูตรเก่า (บรรทัด 268)
import assert from "node:assert/strict"
import { apPaySchedule, apPayRecalc, apManualPayDateError, applyManualPayDate, isWeekendISO } from "../lib/ap-tracking"

// ตามรอบ 30D กดผ่าน 22/09/2026 → ตัดรอบ 25/09 → ระบบคิดจ่าย 05/11
const sys = apPaySchedule("2026-09-22", "ตามรอบ", "30D")!
assert.deepEqual(sys, { type: "ตามรอบ", dueDate: "", cutoff: "2026-09-25", payDate: "2026-11-05" })

// ไม่ได้เลือก / เลือกตรงกับที่ระบบคิด → ค่าระบบเดิม ไม่ติด manual
assert.deepEqual(applyManualPayDate(sys), sys)
assert.deepEqual(applyManualPayDate(sys, ""), sys)
assert.deepEqual(applyManualPayDate(sys, "2026-11-05"), sys)
// เลือกวันอื่น → payDate = ที่เลือก, เก็บวันที่ระบบคิดไว้, cutoff/type เดิม
assert.deepEqual(applyManualPayDate(sys, "2026-11-12"),
  { type: "ตามรอบ", dueDate: "", cutoff: "2026-09-25", payDate: "2026-11-12", manual: true, systemPayDate: "2026-11-05" })
// ใช้ได้ทุกแบบ: นอกรอบ / เครดิตสั้น
const off = apPaySchedule("2026-09-22", "นอกรอบ", "")!
assert.equal(applyManualPayDate(off, "2026-09-24").payDate, "2026-09-24")
assert.equal(applyManualPayDate(off, "2026-09-24").systemPayDate, off.payDate)
const short = apPaySchedule("2026-09-22", "ตามรอบ", "7D", undefined, "2026-09-21")!
assert.equal(short.payDate, "2026-10-01", "7D ส่ง จ. 21/09 ทันเส้นตายอังคาร → พฤหัสสัปดาห์ถัดไป")
assert.equal(applyManualPayDate(short, "2026-10-01").manual, undefined, "เลือกตรงกับที่ระบบคิด = ไม่ใช่เลือกเอง")
assert.equal(applyManualPayDate(short, "2026-10-08").manual, true)

// ตรวจวันที่: ต้องเป็นวันที่จริง และไม่ย้อนหลังกว่าวันกดผ่าน (วันเดียวกันได้)
assert.equal(apManualPayDateError("2026-11-12", "2026-09-22"), "")
assert.equal(apManualPayDateError("2026-09-22", "2026-09-22"), "", "จ่ายวันกดผ่านเลยได้")
assert.match(apManualPayDateError("2026-09-21", "2026-09-22"), /ย้อนหลัง/)
assert.match(apManualPayDateError("2026-02-31", "2026-01-01"), /ไม่ใช่วันที่/)
assert.match(apManualPayDateError("12/11/2026", "2026-01-01"), /ไม่ใช่วันที่/)
assert.match(apManualPayDateError("", "2026-01-01"), /ไม่ใช่วันที่/)

// เสาร์-อาทิตย์ (เตือนเฉย ๆ)
assert.equal(isWeekendISO("2026-11-07"), true, "ส. 7 พ.ย. 2026")
assert.equal(isWeekendISO("2026-11-08"), true, "อา. 8 พ.ย. 2026")
assert.equal(isWeekendISO("2026-11-05"), false, "พฤ. 5 พ.ย. 2026")
assert.equal(isWeekendISO("bad"), false)

// apPayRecalc: ใบที่บัญชีเลือกวันเอง ไม่ติดธง "คิดด้วยกติกาเดิม" แม้ payDate ต่างจากกติกา
const storedManual = { ...applyManualPayDate(sys, "2026-11-12"), basis: { passedDate: "2026-09-22", creditTerm: "30D" }, at: "2026-09-22T03:00:00.000Z" }
assert.equal(apPayRecalc(storedManual, ""), null)
// ค่าเดียวกันแต่ไม่ได้ติด manual (เช่นข้อมูลเก่า) → ยังติดธงตามเดิม
const { manual: _m, systemPayDate: _s, ...notManual } = storedManual
void _m; void _s
assert.equal(apPayRecalc(notManual, "")?.payDate, "2026-11-05")

console.log("check-ap-pay-manual: OK")
