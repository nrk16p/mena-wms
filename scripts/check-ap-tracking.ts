// scripts/check-ap-tracking.ts
// รัน: npx tsx scripts/check-ap-tracking.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, nextThursday,
  isDocSetComplete, apStatusOf, termDays, AP_DOC_FIELDS, FINANCE_DOC_KEYS, thaiDate,
} from "../lib/ap-tracking"

const mark = { checked: true, by: "test", at: "2026-08-13T00:00:00.000Z" }

// --- parseDmy ---
assert.equal(parseDmy("13/08/2026"), "2026-08-13")
assert.equal(parseDmy("01/07/2026 14:30"), "2026-07-01", "ต้องตัดเวลาท้ายออกได้")
assert.equal(parseDmy(""), "")
assert.equal(parseDmy(null), "")
assert.equal(parseDmy("ไม่ใช่วันที่"), "")

// --- parseAmount ---
assert.equal(parseAmount("1,234.56"), 1234.56)
assert.equal(parseAmount("800"), 800)
assert.equal(parseAmount(2467.5), 2467.5)
assert.equal(parseAmount(""), 0)
assert.equal(parseAmount(null), 0)

// --- termDays / dueDateOf ---
assert.equal(termDays("30D"), 30)
assert.equal(termDays("Immediate"), 0)
assert.equal(termDays("ไม่รู้จัก"), null)
assert.equal(dueDateOf("2026-07-01", "30D"), "2026-07-31")
assert.equal(dueDateOf("2026-07-01", "Immediate"), "2026-07-01")
assert.equal(dueDateOf("2026-07-31", "60D"), "2026-09-29", "ต้องข้ามเดือนถูก")
assert.equal(dueDateOf("2026-12-10", "60D"), "2027-02-08", "ต้องข้ามปีถูก")
assert.equal(dueDateOf("", "30D"), "", "ไม่มีวันรับของ = ไม่มี due")
assert.equal(dueDateOf("2026-07-01", ""), "", "ไม่มีเครดิตเทอม = ไม่มี due")

// --- overdueDays ---
assert.equal(overdueDays("2026-08-01", "2026-08-13"), 12)
assert.equal(overdueDays("2026-08-13", "2026-08-13"), 0, "ครบกำหนดวันนี้ ยังไม่เกิน")
assert.equal(overdueDays("2026-09-01", "2026-08-13"), 0)
assert.equal(overdueDays("", "2026-08-13"), 0)

// --- nextThursday (บัญชีโอนทุกวันพฤหัส) ---
assert.equal(nextThursday("2026-08-13"), "2026-08-13", "วันพฤหัสอยู่แล้ว = วันนี้")
assert.equal(nextThursday("2026-08-14"), "2026-08-20", "ศุกร์ → พฤหัสหน้า")
assert.equal(nextThursday("2026-08-10"), "2026-08-13", "จันทร์ → พฤหัสสัปดาห์นี้")

// --- โครงช่องเอกสาร ---
assert.equal(AP_DOC_FIELDS.length, 7)
assert.deepEqual(AP_DOC_FIELDS.map((f) => f.key), ["dd","po","bill","invoice","taxInvoice","receipt","billingNote"])
assert.deepEqual(FINANCE_DOC_KEYS, ["bill","invoice","taxInvoice","receipt","billingNote"])

// --- เงื่อนไขครบชุด: DD + PO + อย่างน้อย 1 ใน 5 ---
assert.equal(isDocSetComplete({}), false)
assert.equal(isDocSetComplete({ dd: mark, po: mark }), false, "มีแค่ DD+PO ยังไม่ครบ")
assert.equal(isDocSetComplete({ dd: mark, bill: mark }), false, "ขาด PO")
assert.equal(isDocSetComplete({ po: mark, bill: mark }), false, "ขาด DD")
assert.equal(isDocSetComplete({ dd: mark, po: mark, bill: mark }), true)
assert.equal(isDocSetComplete({ dd: mark, po: mark, receipt: mark }), true, "ใบเสร็จอย่างเดียวก็ครบ")
assert.equal(
  isDocSetComplete({ dd: mark, po: mark, bill: { ...mark, checked: false } }),
  false,
  "checked=false ไม่นับ",
)

// --- สถานะ ---
assert.equal(apStatusOf({}, ""), "รอประกบ")
assert.equal(apStatusOf({ dd: mark, po: mark, bill: mark }, ""), "ครบชุด")
assert.equal(apStatusOf({ dd: mark, po: mark, bill: mark }, "2026-08-13"), "ส่งบัญชีแล้ว")
assert.equal(apStatusOf({}, "2026-08-13"), "ส่งบัญชีแล้ว", "ลงวันที่ส่งแล้วถือว่าจบ แม้ติ๊กไม่ครบ")

// --- thaiDate ---
assert.equal(thaiDate("2026-08-13"), "13 ส.ค. 69")
assert.equal(thaiDate(""), "—")
assert.equal(thaiDate("ไม่ใช่วันที่"), "—")

console.log("✅ ap-tracking logic ผ่านทั้งหมด")
