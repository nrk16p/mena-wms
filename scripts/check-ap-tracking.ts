// scripts/check-ap-tracking.ts
// รัน: npx tsx scripts/check-ap-tracking.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, nextThursday,
  isDocSetComplete, apStatusOf, termDays, AP_DOC_FIELDS, FINANCE_DOC_KEYS, docChecked, thaiDate,
  missingDocLabels, todayICT, ICT_OFFSET_MS, thaiDateTime,
  AP_GO_LIVE, inApScope, monthInApScope, apSinceOf,
  apDocLabel, apItemKeys, apItemsDone, apItemVerification, apFilesByDoc, upcomingThursdays, addDays,
  apStage, apStageMeta, AP_STAGES, apTimeline,
  apUrgency, needsAccountingReview,
  cleanDocNos, readDocNos, compactDocNos, docNosText, AP_NO_FIELDS, AP_NO_MAX, AP_NOS_MAX,
  ictDate, inDateRange, apRangeOf, groupByDate, thaiDow,
  payThursday, payThursdayChoices, payFromCutoff, apPaySchedule, AP_PAY_TYPES, monthFromCode,
  billingCutoff, upcomingPayThursdays, apPayRecalc,
  apFinanceRequestText, apCoverSheetAoa, parsePaymentDdCell,
  AP_REVIEW_STATUSES, apReviewMeta, reviewNeedsNote,
  type ApDocs, type ApFile,
} from "../lib/ap-tracking"
import { isAccounting, ACCOUNTING_EMAILS } from "../lib/roles"

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

// --- upcomingThursdays (ตัวเลือกวันโอน "นอกรอบ" — ต้องเป็นวันพฤหัสล้วน) ---
assert.deepEqual(upcomingThursdays("2026-08-13", 3), ["2026-08-13", "2026-08-20", "2026-08-27"])
assert.deepEqual(upcomingThursdays("2026-08-14", 2), ["2026-08-20", "2026-08-27"], "ศุกร์ → เริ่มพฤหัสหน้า")
assert.deepEqual(upcomingThursdays("2026-08-27", 2), ["2026-08-27", "2026-09-03"], "ข้ามเดือนได้")
assert.deepEqual(upcomingThursdays("", 3), [], "วันที่อ่านไม่ออก = ไม่มีตัวเลือก")
assert.equal(upcomingThursdays("2026-08-13", 4).length, 4)
for (const d of upcomingThursdays("2026-08-11", 6)) {
  assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 4, `${d} ต้องเป็นวันพฤหัส`)
}

// --- โครงช่องเอกสาร (ถอด DD/PO ออก 2026-08-17: ระบบมีข้อมูลใบรับของ+PO อยู่แล้ว ไม่ต้องให้คนติ๊กซ้ำ
//     และใบที่ไม่มี PO ผูกใน ATMS จะติดค้าง "รอประกบ" ตลอดไปจนส่งบัญชีไม่ได้) ---
assert.equal(AP_DOC_FIELDS.length, 5, "ใบวางบิลรวมกับใบแจ้งหนี้แล้ว + ใบรับสภาพหนี้ (19/08/2026)")
assert.deepEqual(AP_DOC_FIELDS.map((f) => f.key), ["bill","invoice","taxInvoice","receipt","debtAck"])
assert.equal(AP_DOC_FIELDS[4].label, "ใบรับสภาพหนี้")
assert.equal(AP_DOC_FIELDS[1].label, "ใบแจ้งหนี้/ใบวางบิล")
// คีย์เก่ายังต้องถูกนับ ไม่งั้นใบที่เคยติ๊กใบวางบิลไว้จะหลุดจากสถานะครบชุดเงียบ ๆ
assert.deepEqual(FINANCE_DOC_KEYS, ["bill","invoice","taxInvoice","receipt","debtAck","billingNote"])
assert.equal(isDocSetComplete({ debtAck: mark }), true, "ใบรับสภาพหนี้ใบเดียวก็นับว่าครบชุด")

// --- docChecked: ช่องรวมต้องขึ้นติ๊กเมื่อใบเก่าติ๊กไว้ที่ billingNote ---
assert.equal(docChecked({ invoice: mark }, "invoice"), true)
assert.equal(docChecked({ billingNote: mark }, "invoice"), true, "ของเก่าที่ติ๊กใบวางบิลต้องยังเห็นว่าติ๊ก")
assert.equal(docChecked({}, "invoice"), false)
assert.equal(docChecked({ billingNote: mark }, "bill"), false, "ไม่ลามไปช่องอื่น")
assert.equal(isDocSetComplete({ billingNote: mark }), true, "ใบเก่าที่มีแค่ใบวางบิลยังครบชุด")

// --- เงื่อนไขครบชุด: มีเอกสารการเงินอย่างน้อย 1 ใน 5 ---
assert.equal(isDocSetComplete({}), false)
assert.equal(isDocSetComplete({ bill: mark }), true, "บิลใบเดียวก็ครบ")
assert.equal(isDocSetComplete({ receipt: mark }), true, "ใบเสร็จอย่างเดียวก็ครบ")
assert.equal(isDocSetComplete({ bill: { ...mark, checked: false } }), false, "checked=false ไม่นับ")
// ค่าที่เคยติ๊ก DD/PO ไว้ยังอยู่ใน DB — ต้องไม่ถูกนับเป็นเอกสารการเงิน
assert.equal(isDocSetComplete({ dd: mark, po: mark } as ApDocs), false, "ของเก่า DD+PO ไม่นับแล้ว")

// --- สถานะ ---
assert.equal(apStatusOf({}, ""), "รอประกบ")
assert.equal(apStatusOf({ bill: mark }, ""), "ครบชุด")
assert.equal(apStatusOf({ bill: mark }, "2026-08-13"), "ส่งบัญชีแล้ว")
assert.equal(apStatusOf({}, "2026-08-13"), "ส่งบัญชีแล้ว", "ลงวันที่ส่งแล้วถือว่าจบ แม้ติ๊กไม่ครบ")

// --- missingDocLabels (ข้อความบอกว่าขาดอะไร ต้องตรงกับ isDocSetComplete เสมอ) ---
assert.deepEqual(missingDocLabels({}), ["เอกสารการเงินอย่างน้อย 1 ใบ"])
assert.deepEqual(missingDocLabels({ receipt: mark }), [], "ครบชุดแล้วต้องไม่ขาดอะไร")
assert.deepEqual(missingDocLabels({ dd: mark } as ApDocs), ["เอกสารการเงินอย่างน้อย 1 ใบ"])
for (const docs of [{}, { bill: mark }, { dd: mark } as ApDocs, { taxInvoice: mark }]) {
  assert.equal(missingDocLabels(docs).length === 0, isDocSetComplete(docs), "สองฟังก์ชันต้องตัดสินตรงกัน")
}

// --- ป้ายชื่อช่องเอกสาร (ประวัติของเก่ายังอ้างถึง dd/po ต้องอ่านออก ไม่ใช่โชว์คีย์ดิบ) ---
assert.equal(apDocLabel("bill"), "บิล/ใบส่งของ")
assert.equal(apDocLabel("dd"), "DD (ใบรับของ)", "ช่องที่ถอดออกแล้วยังต้องมีป้ายไว้อ่านประวัติ")
assert.equal(apDocLabel("po"), "PO (ใบสั่งซื้อ)")
assert.equal(apDocLabel("ไม่รู้จัก"), "ไม่รู้จัก", "คีย์แปลกปลอมคืนค่าเดิม ไม่พัง")
for (const f of AP_NO_FIELDS) {
  assert.equal(apDocLabel(f.key), f.label, `ช่องเลขที่ ${f.key} ต้องมีป้ายไว้อ่าน log`)
}
assert.equal(apDocLabel("taxInvoiceNo"), "เลขที่ใบกำกับภาษี", "ช่องเดี่ยวรุ่นแรกยังต้องอ่านออก")
assert.equal(apDocLabel("vatInvoiceNos"), "เลขที่ใบกำกับภาษี", "ช่องซ้ำที่ถอดออก 25/08/2026 ยังต้องอ่าน log เก่าออก")
assert.equal(apDocLabel("invoiceNo"), "เลขที่ใบแจ้งหนี้/ใบวางบิล", "ช่องที่ถอดออกแล้วยังต้องอ่านออก")

// --- บัญชีตรวจเอกสาร ---
assert.deepEqual(AP_REVIEW_STATUSES, ["ผ่าน", "ไม่ผ่าน"])
assert.equal(apReviewMeta("ผ่าน").emoji, "✅")
assert.equal(apReviewMeta("ไม่ผ่าน").emoji, "❌")
assert.equal(apReviewMeta("").label, "ยังไม่ตรวจ")
assert.equal(apReviewMeta("อะไรไม่รู้").label, "ยังไม่ตรวจ", "ค่าแปลกปลอมต้องไม่พัง")
assert.equal(reviewNeedsNote("ไม่ผ่าน", ""), true, "ตีกลับต้องบอกเหตุผล")
assert.equal(reviewNeedsNote("ไม่ผ่าน", "   "), true, "ช่องว่างล้วนไม่นับว่าให้เหตุผล")
assert.equal(reviewNeedsNote("ไม่ผ่าน", "ใบกำกับไม่ตรงยอด"), false)
assert.equal(reviewNeedsNote("ผ่าน", ""), false, "ผ่านไม่ต้องบังคับเหตุผล")
assert.equal(reviewNeedsNote("", ""), false)

// --- เลขที่เอกสาร (หลายเลขต่อช่องต่อใบ) ---
assert.deepEqual(cleanDocNos([" A1 ", "A2"]), ["A1", "A2"], "ตัดช่องว่างหัวท้าย")
assert.deepEqual(cleanDocNos(["A1", "", "  ", "A1"]), ["A1"], "ทิ้งค่าว่างและตัวซ้ำ")
assert.deepEqual(cleanDocNos("A1"), [], "ไม่ใช่ array = ไม่มีเลข")
assert.deepEqual(cleanDocNos(undefined), [])
assert.equal(cleanDocNos(Array.from({ length: 50 }, (_, i) => `N${i}`)).length, AP_NOS_MAX, "คุมเพดานจำนวน")
assert.equal(cleanDocNos(["x".repeat(200)])[0].length, AP_NO_MAX, "คุมความยาวต่อเลข")

// โครงช่องเลขที่ — คีย์เดิม taxInvoiceNos ต้องอยู่ที่เดิมเสมอ
// (ถ้าคีย์เดิมถูกเปลี่ยนชื่อ เลขที่คนกรอกไว้แล้วทุกใบจะหายไปเงียบ ๆ)
// 25/08/2026 ถอด vatInvoiceNos ออก — เป็นชื่อซ้ำของใบเดียวกัน · taxInvoiceNos ใช้ป้าย "เลขที่ใบกำกับภาษี" แทน
assert.deepEqual(AP_NO_FIELDS.map((f) => f.key),
  ["taxInvoiceNos", "billingNoteNos", "cashBillNos", "ncAcNos", "voucherNos"])
assert.deepEqual(AP_NO_FIELDS.map((f) => f.label),
  ["เลขที่ใบกำกับภาษี", "เลขที่ใบวางบิล", "เลขที่บิลเงินสด", "เลขที่ NC/AC", "เลขที่ Voucher/ตั้งหนี้"])
assert.equal(new Set(AP_NO_FIELDS.map((f) => f.key)).size, AP_NO_FIELDS.length, "คีย์ห้ามซ้ำ")
// ป้ายซ้ำ = บั๊กที่เพิ่งแก้ไป (ใบกำกับ/ใบกำกับภาษี) — คนกรอกจะไม่รู้ว่าต้องลงช่องไหน
assert.equal(new Set(AP_NO_FIELDS.map((f) => f.label)).size, AP_NO_FIELDS.length, "ป้ายช่องห้ามซ้ำ")
assert.equal(new Set(AP_NO_FIELDS.map((f) => f.short)).size, AP_NO_FIELDS.length, "ป้ายสั้น (ปุ่ม + เพิ่ม…) ห้ามซ้ำ")

// readDocNos ต้องคืนครบทุกคีย์เสมอ — ฝั่งเรียกใช้จะได้ไม่ต้องเช็ค undefined ทีละช่อง
assert.deepEqual(readDocNos({ taxInvoiceNos: ["IV1"], cashBillNos: ["CB1", "CB1"] }),
  { taxInvoiceNos: ["IV1"], billingNoteNos: [], cashBillNos: ["CB1"], ncAcNos: [], voucherNos: [] })
assert.deepEqual(readDocNos(null),
  { taxInvoiceNos: [], billingNoteNos: [], cashBillNos: [], ncAcNos: [], voucherNos: [] }, "ใบที่ยังไม่เคยกรอกเลยต้องไม่พัง")
assert.equal("vatInvoiceNos" in readDocNos({ vatInvoiceNos: ["TX1"] }), false, "ช่องที่ถอดออกแล้วต้องไม่งอกกลับมา")
assert.deepEqual(readDocNos({ taxInvoiceNos: "IV1" }), readDocNos(null), "ค่าเสียรูปใน DB = ถือว่าไม่มีเลข")

// compactDocNos — payload ของตารางส่งเฉพาะช่องที่มีเลขจริง (หมื่นแถว × คีย์เปล่า 4 ตัว = เปลืองเปล่า)
assert.deepEqual(compactDocNos({ taxInvoiceNos: ["IV1"], cashBillNos: [] }), { taxInvoiceNos: ["IV1"] })
assert.deepEqual(compactDocNos(null), {}, "ใบที่ไม่มีเลขเลย = object ว่าง")
assert.deepEqual(Object.keys(compactDocNos({ billingNoteNos: ["BN1"] })), ["billingNoteNos"], "ไม่งอกคีย์ที่ว่าง")

// สายค้นหา — ต้องรวมทุกช่อง ไม่งั้นค้นด้วยเลขใบวางบิลแล้วเหมือนไม่เจอ
const nosDoc = { taxInvoiceNos: ["IV6808-0231"], billingNoteNos: ["BN-2569/0814"], cashBillNos: ["CB-9001"], ncAcNos: ["SBAD26080007"] }
for (const needle of ["IV6808-0231", "BN-2569/0814", "CB-9001", "SBAD26080007"]) {
  assert.ok(docNosText(nosDoc).includes(needle), `ค้นหาต้องเจอ ${needle}`)
}
assert.equal(docNosText(null), "", "ใบที่ไม่มีเลขเลย = สายว่าง ไม่ใช่ undefined")
// ตารางส่ง docNos แบบตัดคีย์ว่าง — ค้นหาต้องยังทำงานกับรูปนั้นเหมือนกับรูปเต็ม
assert.equal(docNosText(compactDocNos(nosDoc)), docNosText(readDocNos(nosDoc)),
  "ค้นหาต้องให้ผลเท่ากันทั้งรูปเต็มและรูปตัดคีย์ว่าง")

// --- วันที่กดส่งบัญชี: ICT (บั๊กเดิมของทั้งระบบคือลืมบวก +7 ก่อนตัดวัน) ---
assert.equal(ictDate("2026-08-14T09:41:00.000Z"), "2026-08-14")
assert.equal(ictDate("2026-08-13T18:30:00.000Z"), "2026-08-14", "18:30 UTC = 01:30 ของวันถัดไปตามเวลาไทย")
assert.equal(ictDate("2026-08-14T16:59:00.000Z"), "2026-08-14", "23:59 ไทย ยังเป็นวันเดิม")
assert.equal(ictDate("2026-08-14T17:00:00.000Z"), "2026-08-15", "00:00 ไทย = ขึ้นวันใหม่")
assert.equal(ictDate(""), "", "ไม่มี timestamp = ไม่มีวัน")
assert.equal(ictDate("ไม่ใช่เวลา"), "")

// --- ช่วงวันที่ของตัวกรอง ---
assert.equal(inDateRange("2026-08-14", "", ""), true, "ไม่ตั้งช่วง = ผ่านหมด")
assert.equal(inDateRange("", "", ""), true, "ไม่ตั้งช่วง แถวที่ยังไม่มีวันก็ยังอยู่")
assert.equal(inDateRange(undefined, "", ""), true, "แถวที่ไม่มีคีย์วันที่มาเลย (API ตัดทิ้ง) ต้องไม่พัง")
assert.equal(inDateRange(undefined, "2026-08-11", ""), false, "ตั้งช่วงแล้ว แถวที่ไม่มีคีย์ต้องตก")
assert.equal(inDateRange("", "2026-08-11", ""), false, "ตั้งช่วงแล้ว แถวที่ไม่มีวันต้องตก")
assert.equal(inDateRange("2026-08-11", "2026-08-11", "2026-08-18"), true, "ขอบล่างนับรวม")
assert.equal(inDateRange("2026-08-18", "2026-08-11", "2026-08-18"), true, "ขอบบนนับรวม")
assert.equal(inDateRange("2026-08-10", "2026-08-11", "2026-08-18"), false)
assert.equal(inDateRange("2026-08-19", "2026-08-11", "2026-08-18"), false)
assert.equal(inDateRange("2026-08-19", "2026-08-11", ""), true, "เปิดปลายบน")
assert.equal(inDateRange("2026-08-01", "", "2026-08-18"), true, "เปิดปลายล่าง")

// --- ปุ่มลัดช่วงวันที่ ---
assert.deepEqual(apRangeOf("today", "2026-08-18"), { from: "2026-08-18", to: "2026-08-18" })
assert.deepEqual(apRangeOf("7d", "2026-08-18"), { from: "2026-08-12", to: "2026-08-18" })
assert.deepEqual(apRangeOf("month", "2026-08-18"), { from: "2026-08-01", to: "2026-08-18" })
assert.deepEqual(apRangeOf("7d", "2026-09-03"), { from: "2026-08-28", to: "2026-09-03" }, "ข้ามเดือนได้")
{
  // "7 วันล่าสุด" ต้องได้ 7 วันพอดี รวมวันนี้ — ไม่ใช่ 8
  const r = apRangeOf("7d", "2026-08-18")
  const days = (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000 + 1
  assert.equal(days, 7)
}

// --- กำหนดจ่ายเงิน (คิดตอนบัญชีกดผ่าน — กติกาผู้ใช้ยืนยัน 18/08/2026) ---
assert.deepEqual(AP_PAY_TYPES, ["ตามรอบ", "นอกรอบ"])

// เส้นตายวันอังคาร (แก้จากพุธ 19/08/2026) → จ่ายพฤหัส "สัปดาห์ถัดไป" ของอังคารที่ปิดรอบ
// (แก้ 28/08/2026 — เดิมจ่ายพฤหัสถัดจากอังคารนั้นเลย ทำให้ทุกใบเร็วไป 1 สัปดาห์)
assert.equal(payThursday("2026-08-17"), "2026-08-27", "จันทร์ → ปิดรอบ อ 18 → จ่าย พฤ 27")
assert.equal(payThursday("2026-08-18"), "2026-08-27", "อังคาร (วันสุดท้ายที่ทัน) → ปิดรอบวันนั้น → จ่าย พฤ 27")
assert.equal(payThursday("2026-08-19"), "2026-09-03", "พุธ = ตกรอบ อ 18 → ปิดรอบ อ 25 → จ่าย พฤ 03/09")
assert.equal(payThursday("2026-08-20"), "2026-09-03", "พฤหัสเอง → รอบถัดไป")
assert.equal(payThursday("2026-08-21"), "2026-09-03", "ศุกร์ → รอบถัดไป")
assert.equal(payThursday("2026-08-22"), "2026-09-03", "เสาร์ → รอบถัดไป")
assert.equal(payThursday("2026-08-23"), "2026-09-03", "อาทิตย์ = ขึ้นสัปดาห์ใหม่ → ปิดรอบ อ 25 → จ่าย พฤ 03/09")
assert.equal(payThursday(""), "", "วันที่อ่านไม่ออก = คิดไม่ได้")
// เคสจริงที่ผู้ใช้ทักมา 28/08/2026 — ส่งเอกสารวันศุกร์ ต้องได้ 10 ก.ย. ไม่ใช่ 3 ก.ย.
assert.equal(payThursday("2026-08-28"), "2026-09-10", "ศุกร์ 28/08 → ปิดรอบ อ 01/09 → จ่าย พฤ 10/09")
assert.equal(payThursday("2026-09-01"), "2026-09-10", "อังคาร 01/09 ก็ยังรอบเดียวกัน — ปิดรอบวันนั้นพอดี")
assert.equal(payThursday("2026-09-02"), "2026-09-17", "พุธ 02/09 = ตกรอบแล้ว")
// ทุกวันในช่วง พุธ→อังคาร ต้องตกรอบเดียวกันหมด (หน้าต่างรอบละ 7 วันพอดี ไม่มีวันหลุด)
for (const d of ["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01"]) {
  assert.equal(payThursday(d), "2026-09-10", `${d} ต้องอยู่รอบจ่าย 10/09`)
}

// วันปิดรอบ = อังคารที่ห่างจากวันจ่าย 9 วันเสมอ
assert.equal(billingCutoff("2026-08-28"), "2026-09-01", "ส่งศุกร์ 28/08 → ปิดรอบอังคาร 01/09")
assert.equal(billingCutoff("2026-08-17"), "2026-08-18", "ส่งจันทร์ → ปิดรอบอังคารวันรุ่งขึ้น")
assert.equal(billingCutoff(""), "")
for (const d of ["2026-08-17", "2026-08-19", "2026-08-28", "2026-12-31"]) {
  assert.equal(new Date(`${billingCutoff(d)}T00:00:00Z`).getUTCDay(), 2, `วันปิดรอบของ ${d} ต้องเป็นวันอังคาร`)
}

// ตัวเลือกวันโอน: default = พฤหัสที่ถูกต้องตามรอบ · เลื่อนออกได้อีก 1 สัปดาห์ (เท่ากันทุกวัน)
assert.deepEqual(payThursdayChoices("2026-08-17"), { options: ["2026-08-27", "2026-09-03"], def: "2026-08-27" }, "จันทร์: default = รอบของตัวเอง")
assert.deepEqual(payThursdayChoices("2026-08-18"), { options: ["2026-08-27", "2026-09-03"], def: "2026-08-27" }, "อังคาร: ยังรอบเดียวกับจันทร์")
assert.deepEqual(payThursdayChoices("2026-08-19"), { options: ["2026-09-03", "2026-09-10"], def: "2026-09-03" }, "พุธ: ตกไปรอบถัดไป")
assert.deepEqual(payThursdayChoices("2026-08-20"), { options: ["2026-09-03", "2026-09-10"], def: "2026-09-03" }, "พฤหัสเอง: รอบถัดไป")
assert.deepEqual(payThursdayChoices(""), { options: [], def: "" })
for (const d of ["2026-08-18", "2026-08-20", "2026-12-31"]) {
  assert.equal(new Date(`${payThursday(d)}T00:00:00Z`).getUTCDay(), 4, `ผลของ ${d} ต้องเป็นวันพฤหัสเสมอ`)
}

// ตัวเลือกนอกรอบฝั่งจัดซื้อ — เริ่มจากพฤหัสที่ทันรอบจริง ไม่ใช่พฤหัสถัดไปบนปฏิทิน
assert.deepEqual(upcomingPayThursdays("2026-08-28", 3), ["2026-09-10", "2026-09-17", "2026-09-24"])
assert.deepEqual(upcomingPayThursdays("", 3), [], "วันที่อ่านไม่ออก = ไม่มีตัวเลือก")
for (const d of upcomingPayThursdays("2026-08-11", 6)) {
  assert.equal(new Date(`${d}T00:00:00Z`).getUTCDay(), 4, `${d} ต้องเป็นวันพฤหัส`)
}

// ตามรอบ: ตัดรอบ 25 นับถึงสิ้นวัน → จ่ายวันที่ 5 ของเดือนที่ 2 ถัดไป (แก้ 19/08/2026
// จากเดิมเดือนถัดไป — "not next month but next 2 month") · ไม่เลื่อนแม้ตรงเสาร์-อาทิตย์
assert.deepEqual(payFromCutoff("2026-09-17"), { cutoff: "2026-09-25", payDate: "2026-11-05" })
assert.deepEqual(payFromCutoff("2026-08-25"), { cutoff: "2026-08-25", payDate: "2026-10-05" }, "ครบวันที่ 25 พอดี = ทันรอบ (สิ้นวัน)")
assert.deepEqual(payFromCutoff("2026-08-26"), { cutoff: "2026-09-25", payDate: "2026-11-05" }, "เลย 25 วันเดียว = ตกไปทั้งเดือน")
assert.deepEqual(payFromCutoff("2026-12-26"), { cutoff: "2027-01-25", payDate: "2027-03-05" }, "ข้ามปีที่ตัดรอบ")
assert.deepEqual(payFromCutoff("2026-11-30"), { cutoff: "2026-12-25", payDate: "2027-02-05" }, "ข้ามปีที่วันจ่าย")
assert.deepEqual(payFromCutoff("2026-10-20"), { cutoff: "2026-10-25", payDate: "2026-12-05" }, "ตัด ต.ค. → จ่าย ธ.ค. (ปีเดียวกัน)")
assert.equal(new Date("2026-12-05T00:00:00Z").getUTCDay(), 6, "5 ธ.ค. 69 เป็นวันเสาร์ — ยืนยันว่าเทสต์นี้ครอบเคสไม่เลื่อน")
assert.deepEqual(payFromCutoff(""), { cutoff: "", payDate: "" })

// ทั้งใบ: ตารางตัวอย่างที่ใช้คุยกับผู้ใช้ (กดผ่าน 18/08/2026)
assert.deepEqual(apPaySchedule("2026-08-18", "ตามรอบ", "30D"),
  { type: "ตามรอบ", dueDate: "2026-09-17", cutoff: "2026-09-25", payDate: "2026-11-05" })
// เครดิตสั้น 7D/15D (แก้ 21/08/2026): รอบพฤหัส นับจากวันส่งเอกสารเข้าบัญชี เส้นตายอังคาร
assert.deepEqual(apPaySchedule("2026-08-18", "ตามรอบ", "7D"),
  { type: "ตามรอบ", dueDate: "2026-08-25", cutoff: "", payDate: "2026-08-27" },
  "ไม่มีวันส่ง = นับจากวันกดผ่าน (อังคาร → ปิดรอบวันนั้น → จ่ายพฤหัสสัปดาห์ถัดไป)")
// เครดิต 7D + รอบวางบิลที่ห่างอย่างน้อย 9 วัน = วันจ่ายเลยวันครบกำหนดได้ตามกติกา
// (ยืนยันไว้ให้เห็นชัด ไม่ใช่บั๊ก — รอบวางบิลชนะเครดิตเทอมสำหรับเครดิตสั้น)
assert.ok(apPaySchedule("2026-08-18", "ตามรอบ", "7D")!.payDate > apPaySchedule("2026-08-18", "ตามรอบ", "7D")!.dueDate,
  "7D: วันจ่ายตามรอบเลยวันครบกำหนดได้")
assert.deepEqual(apPaySchedule("2026-08-19", "ตามรอบ", "15D", undefined, "2026-08-17"),
  { type: "ตามรอบ", dueDate: "2026-09-01", cutoff: "", payDate: "2026-08-27" },
  "ส่งเอกสารวันจันทร์ กดผ่านวันพุธ → ยังได้รอบของวันส่ง (นับจากวันส่ง ไม่ใช่วันกดผ่าน)")
assert.deepEqual(apPaySchedule("2026-08-21", "ตามรอบ", "7D", undefined, "2026-08-10")?.payDate,
  "2026-09-03", "รอบของวันส่ง (10 ส.ค. → จ่าย 20 ส.ค.) เลยไปแล้วตอนกดผ่าน — นับใหม่จากวันกดผ่าน")
assert.equal(apPaySchedule("2026-08-18", "ตามรอบ", "15D")?.cutoff, "", "เครดิตสั้นไม่เดินสายตัดรอบ 25")
assert.deepEqual(apPaySchedule("2026-08-18", "ตามรอบ", "60D"),
  { type: "ตามรอบ", dueDate: "2026-10-17", cutoff: "2026-10-25", payDate: "2026-12-05" })
assert.deepEqual(apPaySchedule("2026-08-18", "ตามรอบ", "Immediate"),
  { type: "ตามรอบ", dueDate: "2026-08-18", cutoff: "2026-08-25", payDate: "2026-10-05" })
assert.deepEqual(apPaySchedule("2026-08-18", "นอกรอบ", ""),
  { type: "นอกรอบ", dueDate: "", cutoff: "", payDate: "2026-08-27" }, "นอกรอบ default = พฤหัสของรอบที่ปิดวันนั้น")
assert.deepEqual(apPaySchedule("2026-08-18", "นอกรอบ", "", "2026-09-03"),
  { type: "นอกรอบ", dueDate: "", cutoff: "", payDate: "2026-09-03" }, "เลื่อนออกไปอีก 1 รอบเองได้")
assert.equal(apPaySchedule("2026-08-18", "นอกรอบ", "", "2026-08-20"), null, "ขอพฤหัสที่รอบปิดไปแล้ว = ปฏิเสธ")
assert.equal(apPaySchedule("2026-08-19", "นอกรอบ", "", "2026-08-27"), null, "กดพุธแล้วขอรอบที่ตกไปแล้ว = ปฏิเสธ")
assert.equal(apPaySchedule("2026-08-18", "นอกรอบ", "", "2026-08-21"), null, "วันที่ไม่ใช่ตัวเลือก (ไม่ใช่พฤหัส) = ปฏิเสธ")
assert.equal(apPaySchedule("2026-08-18", "ตามรอบ", ""), null, "ตามรอบแต่ไม่มีเครดิตเทอม = คิดไม่ได้ (ให้ UI บังคับกรอก)")
assert.equal(apPaySchedule("", "นอกรอบ", ""), null)

// --- pay ที่แช่ไว้ vs กติกาปัจจุบัน (apPayRecalc) ---
// ค่าใน pay คิดครั้งเดียวตอนกดผ่าน กติกาที่เปลี่ยนทีหลังไม่ย้อนไปถึง — ตัวนี้คือตัวจับใบที่ค้าง
// เคสจริง LBDD26080664: 15D กดผ่าน 21/08 14:39 (ก่อนกติกาเครดิตสั้น 17:09 วันเดียวกัน)
assert.deepEqual(
  apPayRecalc({ type: "ตามรอบ", dueDate: "2026-09-05", cutoff: "2026-09-25", payDate: "2026-11-05",
                basis: { passedDate: "2026-08-21", creditTerm: "15D" } }, "2026-08-21"),
  { type: "ตามรอบ", dueDate: "2026-09-05", cutoff: "", payDate: "2026-09-03" },
  "15D ที่ค้างสายตัดรอบ 25 ต้องถูกจับได้ และคืนรอบพฤหัสที่ถูกต้อง")
assert.equal(
  apPayRecalc({ type: "ตามรอบ", dueDate: "2026-09-05", cutoff: "", payDate: "2026-09-03",
                basis: { passedDate: "2026-08-21", creditTerm: "15D" } }, "2026-08-21"),
  null, "ใบที่ตรงกติกาวันนี้แล้วต้องไม่ขึ้นธง")
// กติกา 28/08/2026 บวก 1 สัปดาห์ — ใบที่กดผ่านก่อนหน้านั้นค้างวันจ่ายเร็วไป 7 วัน
assert.equal(
  apPayRecalc({ type: "ตามรอบ", dueDate: "2026-09-04", cutoff: "", payDate: "2026-09-03",
                basis: { passedDate: "2026-08-28", creditTerm: "7D" } }, "2026-08-28")?.payDate,
  "2026-09-10", "7D กดผ่าน 28/08 ก่อน deploy — ต้องเลื่อนเป็นพฤหัสสัปดาห์ถัดไป")
// เครดิตยาวไม่ถูกกติกาทั้งสองรอบแตะ — ต้องไม่มี false positive
assert.equal(
  apPayRecalc({ type: "ตามรอบ", dueDate: "2026-09-17", cutoff: "2026-09-25", payDate: "2026-11-05",
                basis: { passedDate: "2026-08-18", creditTerm: "30D" } }, ""),
  null, "30D สายตัดรอบ 25 ไม่เปลี่ยน")
// นอกรอบ: บัญชีเลือกวันเอง — ยังใช้ได้ถ้าอยู่ในตัวเลือกของกติกาวันนี้ (รวมตัวที่เลื่อนออกไป 1 รอบ)
assert.equal(
  apPayRecalc({ type: "นอกรอบ", payDate: "2026-09-03", basis: { passedDate: "2026-08-21" } }, ""),
  null, "นอกรอบที่ตรงตัวเลือกแรก = ไม่ต้องแก้")
assert.equal(
  apPayRecalc({ type: "นอกรอบ", payDate: "2026-09-10", basis: { passedDate: "2026-08-21" } }, ""),
  null, "นอกรอบที่บัญชีเลือกเลื่อนออกไปเอง 1 รอบ = ไม่ใช่ของค้าง ห้ามดึงกลับ")
assert.deepEqual(
  apPayRecalc({ type: "นอกรอบ", payDate: "2026-08-27", basis: { passedDate: "2026-08-21" } }, ""),
  { type: "นอกรอบ", dueDate: "", cutoff: "", payDate: "2026-09-03" },
  "นอกรอบที่คิดด้วยกติกาก่อน 28/08 = เร็วไป 1 สัปดาห์ ต้องถูกจับ")
// ข้อมูลไม่พอ = เงียบไว้ ดีกว่าเดาแล้วขึ้นธงผิด
assert.equal(apPayRecalc(null, ""), null)
assert.equal(apPayRecalc({ type: "ตามรอบ", payDate: "2026-09-03", basis: { passedDate: "2026-08-21" } }, ""),
  null, "ตามรอบแต่ไม่มี creditTerm ใน basis = คิดใหม่ไม่ได้")
assert.equal(apPayRecalc({ type: "ตามรอบ", payDate: "2026-09-03", basis: { creditTerm: "15D" } }, ""),
  null, "ไม่มีวันกดผ่าน = คิดใหม่ไม่ได้")
assert.equal(apPayRecalc({ type: "อะไรก็ไม่รู้", payDate: "2026-09-03" }, ""), null)
// ใบเก่าที่ไม่มี basis แต่มี pay.at — ใช้ at (UTC) แปลงเป็นวันไทยแทนได้
assert.equal(
  apPayRecalc({ type: "นอกรอบ", payDate: "2026-08-27", at: "2026-08-20T18:00:00.000Z" }, "")?.payDate,
  "2026-09-03", "ไม่มี basis ให้ถอยไปใช้ pay.at (18:00Z = 21/08 ตามเวลาไทย)")

// --- เดือนที่ฝังในเลขเอกสาร (ทางลัดค้นข้ามเดือน) ---
assert.equal(monthFromCode("LBDD26020004"), "2026-02")
assert.equal(monthFromCode("SBPO26071234"), "2026-07")
assert.equal(monthFromCode("KKPR25120028"), "2025-12")
assert.equal(monthFromCode("BPKDD26080009"), "2026-08", "prefix 3 ตัวอักษรก็ต้องจับได้")
assert.equal(monthFromCode("lbdd26020004"), "2026-02", "ตัวพิมพ์เล็กต้องจับได้ — คนพิมพ์มือไม่กด shift")
assert.equal(monthFromCode(" LBDD26020004 "), "2026-02", "ช่องว่างหัวท้ายไม่ทำให้พลาด")
assert.equal(monthFromCode("LBDD2602"), "2026-02", "พิมพ์แค่ถึงเดือนก็รู้เดือนแล้ว")
assert.equal(monthFromCode("LBDD26130004"), "", "เดือน 13 ไม่มีจริง")
assert.equal(monthFromCode("LBDD260"), "", "เลขเดือนยังไม่ครบ = ยังบอกไม่ได้")
assert.equal(monthFromCode("ซุปเปอร์พาร์ท"), "", "ชื่อซัพพลายเออร์ไม่ใช่เลขเอกสาร")
assert.equal(monthFromCode("IV6808-0231"), "", "เลขใบกำกับไม่ได้ฝังเดือนตามรูปแบบนี้")
assert.equal(monthFromCode(""), "")

// --- ใบปะหน้าส่งเข้า สกท. (โครงตามไฟล์จริงของบัญชี) ---
{
  const aoa = apCoverSheetAoa([
    { date: "2026-07-26", depositCode: "LBDD26070902", supplier: "โกลไรซอน", item: "ยางผ้าใบ", amount: 4439.25, voucher: "LAPO26080010", billingNo: "", note: "ด่วน" },
    { date: "2026-07-26", depositCode: "LBDD26070902", supplier: "โกลไรซอน", item: "ยางใน", amount: 100, voucher: "LAPO26080010", billingNo: "", note: "" },
  ], "2026-08-20")
  assert.deepEqual(aoa[7].slice(1, 6), ["วันที่", "DD", "ซัพพลายเออร์", "ชื่อสินค้า", "ยอดเงิน"], "หัวตารางตามฟอร์มจริง")
  assert.deepEqual(aoa[8], ["", "26/07/2026", "LBDD26070902", "โกลไรซอน", "ยางผ้าใบ", 4439.25, "LAPO26080010", "", "ด่วน"])
  assert.ok(String(aoa[3][6]).includes("2569"), "วันที่หัวฟอร์มเป็น พ.ศ.")
  const sum = aoa[10]
  assert.equal(sum[5], 4539.25, "แถวรวมบวกถูก")
  assert.ok(String(sum[8]).includes("1 ใบ / 2 รายการ"), "ใบเดียวสองรายการต้องนับแยกให้เห็น")
  assert.ok(aoa.some((r) => r[2] === "บัญชี ศลบ" ) && aoa.some((r) => r[4] === "ผู้รับเอกสาร"), "ท้ายลายเซ็นครบ")
  assert.ok(aoa.some((r) => r[4] === "บัญชี สกท."), "ป้ายผู้รับคือ บัญชี สกท. (แก้จาก บัญชี AP สกท. — ผู้ใช้สั่ง 21/08/2026)")
}

// --- ข้อความแจ้งการเงินขอจ่ายนอกรอบ ---
{
  const { subject, body } = apFinanceRequestText([
    { depositCode: "LBDD26080101", supplier: "มิตซุย บุซซัน", amount: 14810.51, purchaseOrder: "LBPO26080001",
      docNos: { billingNoteNos: ["BL-SVCB2026-0395"], taxInvoiceNos: ["TX-1187"] } },
    { depositCode: "LBDD26080102", supplier: "มิตซุย บุซซัน", amount: 1000 },
    { depositCode: "SBDD26080050", supplier: "หจก.หงส์ดำ", amount: 500 },
  ], "2026-08-20", "เอกสารแก้ไขล่าช้า")
  assert.ok(subject.includes("20 ส.ค. 69") && subject.includes("2 ราย"), subject)
  assert.ok(body.includes("เจ้าหนี้ มิตซุย บุซซัน"), "จัดกลุ่มตามเจ้าหนี้")
  assert.ok(body.includes("1. LBDD26080101 · PO LBPO26080001 · ใบกำกับภาษี TX-1187 · ใบวางบิล BL-SVCB2026-0395 = 14,810.51"),
    "อ้าง DD · PO · เลขที่เอกสารทุกช่องที่กรอก พร้อมป้ายชนิด (ผู้ใช้สั่ง 19/08/2026)")
  assert.ok(body.includes("2. LBDD26080102 = 1,000.00"), "ไม่กรอกเลขเอกสารเลย เหลือเลขใบ DD อย่างเดียว")
  assert.ok(body.includes("รวมทั้งสิ้น 16,310.51 บาท (3 ใบ)"), "ยอดรวมต้องถูก")
  assert.ok(body.includes("สาเหตุ: เอกสารแก้ไขล่าช้า"))
  const blank = apFinanceRequestText([{ depositCode: "X", supplier: "ก", amount: 1 }], "2026-08-20", "  ")
  assert.ok(blank.body.includes("สาเหตุ: ....."), "ไม่กรอกสาเหตุ = เว้นช่องไว้ ไม่เดาแทน")
}

// --- ชื่อวันในสัปดาห์ (หัวกลุ่ม) ---
assert.equal(thaiDow("2026-08-13"), "พฤหัสบดี", "13/08/2026 เป็นวันพฤหัส (วันที่บัญชีโอนนอกรอบ)")
assert.equal(thaiDow("2026-08-16"), "อาทิตย์")
assert.equal(thaiDow(""), "", "ไม่มีวันที่ = ไม่มีชื่อวัน ไม่ใช่พัง")
assert.equal(thaiDow("ไม่ใช่วันที่"), "")

// --- จัดกลุ่มตามวัน (มุมมอง "จัดกลุ่มตามวันที่กดส่ง") ---
{
  const rs = [
    { c: "A", d: "2026-08-14" }, { c: "B", d: "2026-08-15" },
    { c: "C", d: "2026-08-14" }, { c: "D", d: "" },
  ]
  const g = groupByDate(rs, (r) => r.d)
  assert.deepEqual(g.map((x) => x.date), ["2026-08-15", "2026-08-14", ""], "วันใหม่ก่อน · ไม่มีวันไปท้ายสุด")
  assert.deepEqual(g[1].rows.map((r) => r.c), ["A", "C"], "ลำดับในกลุ่มคงเดิมตามที่รับมา")
  assert.equal(g.reduce((n, x) => n + x.rows.length, 0), rs.length, "ห้ามมีแถวหายหรือถูกนับซ้ำ")
  assert.deepEqual(groupByDate([], (r: { d: string }) => r.d), [], "ไม่มีแถว = ไม่มีกลุ่ม")
  // แถวที่ API ตัดคีย์วันที่ทิ้ง (ยังไม่เคยกดส่ง) ต้องไปกองกลุ่มเดียวกับแถวที่วันที่ว่าง
  const gu = groupByDate([{ d: undefined }, { d: "2026-08-14" }], (r: { d?: string }) => r.d)
  assert.deepEqual(gu.map((x) => x.date), ["2026-08-14", ""])
}

// --- คีย์ของรายการสินค้าในใบ (ติ๊กหลักฐานรายรายการ) ---
// deposit_items ถูกลบ-เขียนใหม่ทุกครั้งที่ scrape → _id เปลี่ยนตลอด ใช้เป็นคีย์ไม่ได้
// ต้องได้คีย์เดิมทุกครั้งจากรหัสสินค้าที่ต้นข้อความ และห้ามมี . หรือ $ (เป็นคีย์ sub-document ของ Mongo)
assert.deepEqual(
  apItemKeys([{ item: "S16CSE0021 : พัดลมแผงออยระบายความร้อน" }, { item: "S16CSE0020 : ออยระบายความร้อน" }]),
  ["S16CSE0021", "S16CSE0020"],
)
assert.deepEqual(apItemKeys([{ item: "SKU-1 : ก" }, { item: "SKU-1 : ก" }]), ["SKU-1", "SKU-1__2"],
  "รหัสซ้ำในใบเดียวกันต้องไม่ชนกัน")
assert.deepEqual(apItemKeys([{ item: "" }, {}]), ["row1", "row2"], "ไม่มีชื่อรายการก็ยังต้องมีคีย์")
assert.deepEqual(apItemKeys([{ item: "A.B$C : x" }]), ["A_B_C"], "ตัดอักขระที่ Mongo ห้ามใช้เป็นคีย์")
assert.deepEqual(apItemKeys([{ item: "ยางนอก A1" }]), ["ยางนอก_A1"], "ไม่มี ':' ใช้ทั้งข้อความเป็นคีย์")

// --- นับหลักฐานรายรายการ ---
const items = { "S16CSE0021": mark, "S16CSE0020": { ...mark, checked: false } }
assert.equal(apItemsDone(["S16CSE0021", "S16CSE0020"], items), 1)
assert.equal(apItemsDone(["S16CSE0021"], items), 1)
assert.equal(apItemsDone([], items), 0)
assert.equal(apItemsDone(["ไม่มีในนี้"], items), 0)
assert.equal(apItemsDone(["S16CSE0021"], undefined), 0, "ใบที่ยังไม่เคยติ๊กเลย = 0 ไม่ใช่พัง")

// --- ตรวจรายการสินค้ากับ ATMS (แทนการติ๊กหลักฐานด้วยมือ) ---
{
  const it = (total: string, scraped_at?: string) => ({ total, scraped_at })
  // เคสจริง LBDD26080471 ก่อนแก้: ราคาน้ำกลั่นค้างที่ 8.00 → รายการรวม 3,510 แต่หัวใบ 3,750
  const bad = apItemVerification([it("960.00"), it("1,450.00"), it("1,100.00")], "3,750.00")
  assert.equal(bad.amountOk, false)
  assert.equal(bad.okCount, 0)
  assert.deepEqual(bad.rows.map((r) => r.state), ["mismatch", "mismatch", "mismatch"])
  assert.match(bad.warning, /ไม่ตรงยอดใบ/)
  assert.equal(bad.itemsTotal, 3510)

  // หลัง re-sync: 1,200 + 1,450 + 1,100 = 3,750 ตรงยอดใบ
  const good = apItemVerification(
    [it("1,200.00", "2026-08-24T02:12:00.000Z"), it("1,450.00", "2026-08-24T02:12:00.000Z"), it("1,100.00")],
    "3,750.00")
  assert.equal(good.amountOk, true)
  assert.equal(good.okCount, 3)
  assert.deepEqual(good.rows.map((r) => r.state), ["ok", "ok", "ok"])
  assert.equal(good.warning, "")
  assert.equal(good.checkedAt, "2026-08-24T02:12:00.000Z", "ใช้เวลาตรวจล่าสุดในใบ")

  // ของที่ดึงมาก่อนมีฟิลด์ scraped_at (31,828 แถวในฐาน) — ยอดตรงก็ถือว่าตรง แค่ไม่รู้เวลา
  const noTime = apItemVerification([it("100.00")], "100.00")
  assert.equal(noTime.amountOk, true)
  assert.equal(noTime.checkedAt, "", "ไม่มี scraped_at = ไม่รู้เวลา ไม่ใช่ผิด")

  // ATMS ปัดเศษ "รวม" ทีละบรรทัด — ใบหลายสิบบรรทัดเพี้ยนระดับสตางค์ ห้ามเตือน (วัดจริงสูงสุด 0.03)
  const rounding = apItemVerification(Array.from({ length: 39 }, () => it("1,000.00")), "39,000.03")
  assert.equal(rounding.amountOk, true, "ต่าง 0.03 บาทที่ 39 บรรทัด = การปัดเศษ ไม่ใช่ข้อมูลผิด")
  // แต่ส่วนต่างจริงต้องไม่รอด แม้จะเป็นใบยาว
  assert.equal(apItemVerification(Array.from({ length: 39 }, () => it("1,000.00")), "39,240.00").amountOk, false)

  // ใบคืนสต็อกไม่มียอดหัวใบ (3,057 ใบในฐาน) — เทียบไม่ได้ อย่าขึ้นเตือน
  const noHead = apItemVerification([it("500.00")], "")
  assert.equal(noHead.hasChecksum, false)
  assert.equal(noHead.amountOk, true)
  assert.equal(noHead.warning, "")

  // ใบที่มียอดแต่รายการยังไม่ถูกดึงมาเลย — ต้องบอกว่ายังไม่ได้ดึง ไม่ใช่เงียบ
  const empty = apItemVerification([], "3,750.00")
  assert.equal(empty.total, 0)
  assert.match(empty.warning, /ยังไม่ได้ดึงจาก ATMS/)
  assert.deepEqual(apItemVerification([], "").warning, "", "ไม่มีทั้งยอดและรายการ = ไม่มีอะไรให้เตือน")

  // scraped_at ที่มาจาก Mongo เป็น Date object ไม่ใช่ string
  const asDate = apItemVerification([{ total: "100.00", scraped_at: new Date("2026-08-24T02:12:00.000Z") }], "100.00")
  assert.equal(asDate.checkedAt, "2026-08-24T02:12:00.000Z", "รับ Date จาก Mongo ได้ ไม่ใช่แค่ string")
}

// --- ไฟล์แนบแยกตามประเภทเอกสาร ---
const f = (docType: string): ApFile =>
  ({ mediaId: 1, batchId: "b", filename: "a.pdf", webpUrl: "u", thumbnailUrl: "t", docType } as ApFile)
assert.deepEqual(apFilesByDoc([f("bill"), f("bill"), f("receipt")]), { bill: 2, receipt: 1 })
assert.deepEqual(apFilesByDoc([f("")]), {}, "ไฟล์ที่ยังไม่ระบุประเภทไม่ถูกนับเข้าช่องไหน")
assert.deepEqual(apFilesByDoc(undefined), {})

// --- todayICT (ขึ้นกับนาฬิกาจริง → ตรวจ "รูปแบบ" กับ "ความสัมพันธ์กับ UTC" ไม่ใช่ค่าตายตัว) ---
const ict = todayICT()
assert.match(ict, /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "ต้องเป็น YYYY-MM-DD ที่ valid")
assert.equal(ict.length, 10)
const utcToday = new Date().toISOString().slice(0, 10)
assert.ok(ict >= utcToday, "เวลาไทยนำ UTC เสมอ (UTC+7) — ห้ามได้วันที่ย้อนหลังกว่า UTC")
const dayGap = (Date.parse(`${ict}T00:00:00Z`) - Date.parse(`${utcToday}T00:00:00Z`)) / 86_400_000
assert.ok(dayGap === 0 || dayGap === 1, `ต่างจาก UTC ได้แค่ 0 หรือ 1 วัน (ได้ ${dayGap})`)
assert.equal(ICT_OFFSET_MS, 7 * 60 * 60 * 1000, "ไทยเป็น UTC+7 ตลอดปี ไม่มี DST")
// ช่วง 00:00–07:00 เวลาไทย = UTC ยังไม่ข้ามวัน → ต้องต่างกัน 1 วันพอดี (นี่คือบั๊กที่ helper นี้มาแก้)
const ictHour = Number(new Date(Date.now() + ICT_OFFSET_MS).toISOString().slice(11, 13))
assert.equal(dayGap, ictHour < 7 ? 1 : 0, `ชั่วโมงไทย ${ictHour} → ต้องต่างจาก UTC ${ictHour < 7 ? 1 : 0} วัน`)

// --- go-live cutoff (ย้ายมา 01/01/2026 เมื่อ 18/08/2026 — ดึงทั้ง collection เข้าสโคป) ---
assert.equal(AP_GO_LIVE, "2026-01-01")
assert.equal(inApScope("2025-12-31"), false, "ก่อน cutoff = นอกสโคป")
assert.equal(inApScope("2026-01-01"), true, "ตรงวัน cutoff = อยู่ในสโคป (>= ไม่ใช่ >)")
assert.equal(inApScope("2026-08-13"), true, "หลัง cutoff = อยู่ในสโคป")
assert.equal(inApScope("2026-02-15"), true, "เดือนที่เคยถูกตัด (ก่อนย้ายเส้น) ต้องเข้าสโคปแล้ว")
assert.equal(inApScope("2026-07-31"), true, "ก.ค. เคยอยู่นอกสโคป ตอนนี้ต้องเข้า")
assert.equal(inApScope(""), false, "ไม่มีวันรับของที่อ่านได้ = วางบนเส้นเวลาไม่ได้ = นอกสโคป")
// override ด้วย since — ใช้เส้นใหม่แทน AP_GO_LIVE ทั้งหมด
assert.equal(inApScope("2026-07-31", "2026-07-01"), true, "ขยับเส้นแล้วใบเดือน ก.ค. ต้องเข้า")
assert.equal(inApScope("2026-06-30", "2026-07-01"), false)
assert.equal(inApScope("2026-08-14", "2026-08-15"), false, "cutoff กลางเดือนต้องตัดรายวันได้")
assert.equal(inApScope("2026-08-15", "2026-08-15"), true)

// เดือนที่จบก่อน cutoff ทั้งเดือน = ไม่ต้องยิงคิวรีหาเลย
assert.equal(monthInApScope("2025-12"), false, "ธ.ค. 68 จบก่อน 01/01/2026 ทั้งเดือน")
assert.equal(monthInApScope("2026-01"), true, "เดือนที่มี cutoff อยู่ ต้องดึงมากรองรายแถวต่อ")
assert.equal(monthInApScope("2026-07"), true, "ก.ค. เข้าสโคปแล้วหลังย้ายเส้น")
assert.equal(monthInApScope("2026-09"), true)
assert.equal(monthInApScope("2026-07", "2026-07-15"), true, "เดือนที่คร่อม cutoff ต้องไม่ถูกตัดทั้งเดือน")
assert.equal(monthInApScope("2026-06", "2026-07-15"), false, "เดือนก่อน cutoff ที่ override มา ยังต้องถูกตัด")

// since จาก query — ต้องเป็นวันที่จริงเท่านั้น
assert.equal(apSinceOf(null), AP_GO_LIVE, "ไม่ส่งมา = ใช้ go-live")
assert.equal(apSinceOf(""), AP_GO_LIVE)
assert.equal(apSinceOf("  2026-02-01  "), "2026-02-01", "ตัดช่องว่างแล้วใช้ได้")
assert.equal(apSinceOf("2026-13-01"), AP_GO_LIVE, "เดือน 13 ไม่มีจริง")
assert.equal(apSinceOf("2026-02-30"), AP_GO_LIVE, "30 ก.พ. ไม่มีจริง")
assert.equal(apSinceOf("2026-2-1"), AP_GO_LIVE, "ต้องเติมศูนย์เต็มรูปแบบ")
assert.equal(apSinceOf("ไม่ใช่วันที่"), AP_GO_LIVE)
assert.equal(apSinceOf("2026-02-29"), AP_GO_LIVE, "2026 ไม่ใช่ปีอธิกสุรทิน 29 ก.พ. จึงไม่มีจริง")
assert.equal(apSinceOf("2028-02-29"), "2028-02-29", "2028 เป็นปีอธิกสุรทิน 29 ก.พ. มีจริง")

// --- apUrgency (สีแถบซ้ายในตาราง + ตัวกรอง "ต้องรีบ" ต้องตรงกับ aging ที่ API คิด) ---
assert.equal(apUrgency("2026-08-20", "2026-08-14", "2026-08-17"), "sent", "ส่งบัญชีแล้วไม่ต้องเร่ง")
assert.equal(apUrgency("", "", "2026-08-17"), "noTerm", "ไม่มีเครดิตเทอม = ไม่รู้กำหนด ไม่ใช่ยังไม่ถึง")
assert.equal(apUrgency("2026-08-16", "", "2026-08-17"), "overdue")
assert.equal(apUrgency("2026-08-17", "", "2026-08-17"), "due7", "ครบกำหนดวันนี้ = ต้องรีบ ยังไม่เกิน")
assert.equal(apUrgency("2026-08-24", "", "2026-08-17"), "due7", "ครบใน 7 วัน")
assert.equal(apUrgency("2026-08-25", "", "2026-08-17"), "ok", "เกิน 7 วันไปแล้วยังไม่ต้องรีบ")

// --- addDays ---
assert.equal(addDays("2026-08-17", 7), "2026-08-24")
assert.equal(addDays("2026-12-30", 3), "2027-01-02", "ข้ามปีได้")
assert.equal(addDays("", 7), "", "วันที่อ่านไม่ออก = คืนค่าว่าง")

// --- needsAccountingReview (คิวงานฝ่ายบัญชี) ---
assert.equal(needsAccountingReview("ครบชุด", ""), true)
assert.equal(needsAccountingReview("ส่งบัญชีแล้ว", undefined), true, "ส่งแล้วแต่ยังไม่ตรวจ ก็ยังเป็นคิวบัญชี")
assert.equal(needsAccountingReview("ครบชุด", "ผ่าน"), false)
assert.equal(needsAccountingReview("ครบชุด", "ไม่ผ่าน"), false, "ตีกลับแล้ว = ตรวจแล้ว")
assert.equal(needsAccountingReview("รอประกบ", ""), false, "เอกสารยังไม่ครบ ยังไม่ถึงคิวบัญชี")

// --- สิทธิ์ฝ่ายบัญชี (ใครแก้ "บัญชีตรวจเอกสาร" ได้) ---
assert.equal(isAccounting("someone@menatransport.co.th", "บัญชีและการเงิน"), true, "department มีคำว่าบัญชี = ผ่าน")
assert.equal(isAccounting("someone@menatransport.co.th", "Accounting"), true, "ภาษาอังกฤษก็ต้องจับได้")
assert.equal(isAccounting("someone@menatransport.co.th", "จัดซื้อ"), false)
assert.equal(isAccounting("someone@menatransport.co.th", null), false, "ไม่มี department = ไม่ให้สิทธิ์")
assert.equal(isAccounting(null, null), false)
assert.equal(isAccounting("narongkorn.a@menatransport.co.th", "IT"), true, "แอดมินระบบแก้ได้เสมอ")
for (const e of ACCOUNTING_EMAILS) {
  assert.equal(isAccounting(e, "อะไรก็ได้"), true, `${e} อยู่ในลิสต์ต้องผ่าน`)
}

// --- ขั้นของงาน (แกนหลักของหน้า — 1 ใบอยู่ได้ขั้นเดียว) ---
assert.deepEqual(AP_STAGES.map((s) => s.key), ["wait", "ready", "sent", "passed", "paid", "rejected"])
// จ่ายแล้ว (เพิ่ม 21/08/2026): มีเลข PV = จบวงจร · ตีกลับยังชนะทุกขั้นเหมือนเดิม
assert.equal(apStage({ docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ผ่าน" },
  paid: { paymentNos: ["PV426070266"] } }), "paid")
assert.equal(apStage({ docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ผ่าน" },
  paid: { paymentNos: [] } }), "passed", "paid ว่าง = ยังไม่จ่าย")
assert.equal(apStage({ docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ไม่ผ่าน" },
  paid: { paymentNos: ["PV1"] } }), "rejected", "ตีกลับชนะแม้จ่ายแล้ว — ต้องกลับมาแก้")
assert.equal(apStage({ docs: {}, sentDate: "", paid: { paymentNos: ["PV1"] } }), "paid",
  "จ่ายแล้วแม้ไม่เคยผ่านขั้นอื่นในระบบ (ใบนำเข้า) ก็ต้องขึ้นจ่ายแล้ว")

// --- แตกเซลล์ DD ของไฟล์การเงิน ---
assert.deepEqual(parsePaymentDdCell("SBDD26060672/SBDD26060673"), ["SBDD26060672", "SBDD26060673"], "บิลเดียวครอบสองใบ (/)")
assert.deepEqual(parsePaymentDdCell("SBDD26050313-SBDD26050314"), ["SBDD26050313", "SBDD26050314"], "ขีดกลางความหมายเดียวกัน")
assert.deepEqual(parsePaymentDdCell("SBDD26061019.1"), ["SBDD26061019"], "งวดย่อย .1 ตัดเหลือเลขฐาน")
assert.deepEqual(parsePaymentDdCell("LBDD26080101"), ["LBDD26080101"])
assert.deepEqual(parsePaymentDdCell("ไม่ใช่เลข"), [], "ขยะ = ลิสต์ว่าง ไม่พัง")
// รูปแบบที่เจอเพิ่มในไฟล์จริง (แก้ 21/08/2026 — 20 แถวเคยถูกข้ามเพราะ parser ไม่รู้จัก)
assert.deepEqual(parsePaymentDdCell("LBDD26010852,LBDD26010851"), ["LBDD26010852", "LBDD26010851"], "คั่นจุลภาค")
assert.deepEqual(parsePaymentDdCell("LBDD26010929LBDD26020081"), ["LBDD26010929", "LBDD26020081"], "สองเลขติดกันไม่มีตัวคั่น")
assert.deepEqual(parsePaymentDdCell("SBDD26020055."), ["SBDD26020055"], "จุดลอยท้ายเลข")
assert.deepEqual(parsePaymentDdCell("LBPO26030964,LBDD26040723"), ["LBDD26040723"], "เลข PO ที่ปนมาต้องไม่ถูกจับ")
assert.deepEqual(parsePaymentDdCell("LBDD26010891LBDD26020972LBDD26030214"), ["LBDD26010891", "LBDD26020972", "LBDD26030214"], "สามเลขติดกัน")
assert.deepEqual(parsePaymentDdCell(""), [])
assert.equal(apStage({ docs: {}, sentDate: "" }), "wait")
assert.equal(apStage({ docs: { bill: mark }, sentDate: "" }), "ready", "ครบชุดแล้วแต่ยังไม่ส่ง")
assert.equal(apStage({ docs: { bill: mark }, sentDate: "2026-08-20" }), "sent")
assert.equal(apStage({ docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ผ่าน" } }), "passed")
assert.equal(
  apStage({ docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ไม่ผ่าน" } }),
  "rejected",
  "ตีกลับชนะสถานะส่งแล้ว",
)
assert.equal(
  apStage({ docs: {}, sentDate: "", review: { status: "ไม่ผ่าน" } }),
  "rejected",
  "ตีกลับชนะแม้เอกสารยังไม่ครบ",
)
assert.equal(apStage({ docs: {}, sentDate: "", review: { status: "" } }), "wait", "ยังไม่ตรวจ = ไม่เปลี่ยนขั้น")
assert.equal(apStage({ docs: {}, sentDate: "", review: null }), "wait")
assert.equal(apStageMeta("rejected").label, "ไม่ผ่าน")
assert.equal(apStageMeta("wait").label, "รอประกบ")

// --- เส้นทางสถานะ (timeline) ---
const tlLog = [
  { action: "ติ๊ก", field: "bill", at: "2026-08-17T07:00:00.000Z", by: "A" },
  { action: "ติ๊ก", field: "taxInvoice", at: "2026-08-17T07:20:00.000Z", by: "B" },
  { action: "ส่งบัญชี (นอกรอบ)", field: "sent", at: "2026-08-17T08:00:00.000Z", by: "C" },
  { action: "บัญชีตรวจเอกสาร: ผ่าน", field: "review", at: "2026-08-18T02:00:00.000Z", by: "D" },
]
const tl = apTimeline(tlLog,
  { docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ผ่าน" }, receivedAt: "2026-08-16" })
assert.deepEqual(tl.map((s) => s.key), ["received", "ready", "sent", "review", "paid"])
assert.deepEqual(tl.map((s) => s.state), ["done", "done", "done", "done", "current"],
  "ผ่านแล้วยังไม่จ่าย = ช่วงจ่ายเงินเป็นช่วงปัจจุบัน")
assert.equal(tl[4].label, "รอจ่ายเงิน")

// จ่ายแล้ว — ช่วงสุดท้าย done พร้อมวันที่จากทะเบียนการเงิน + เลข PV ใน tooltip
const tlPaid = apTimeline(tlLog,
  { docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ผ่าน" }, receivedAt: "2026-08-16",
    paid: { paymentNos: ["PV426070266"], date: "2026-07-09" } })
assert.deepEqual(tlPaid.map((s) => s.state), ["done", "done", "done", "done", "done"])
assert.equal(tlPaid[4].label, "จ่ายเงินแล้ว")
assert.equal(tlPaid[4].at, "2026-07-09")
assert.equal(tlPaid[4].by, "PV426070266")
assert.equal(tl[0].label, "รอประกบ")
assert.equal(tl[0].at, "2026-08-16", "ช่วงแรก = วันที่ทำ DD ไม่ใช่เวลาที่เริ่มติ๊ก")
assert.equal(tl[1].at, "2026-08-17T07:20:00.000Z", "ครบชุด = เวลาที่ติ๊กครั้งล่าสุด")
assert.equal(tl[2].by, "C")
assert.equal(tl[3].label, "บัญชีตรวจผ่าน")

// ตีกลับ — ช่วงสุดท้ายเป็น rejected ไม่ใช่ done
const tlRej = apTimeline(
  [...tlLog.slice(0, 3), { action: "บัญชีตรวจเอกสาร: ไม่ผ่าน", field: "review", at: "2026-08-18T03:00:00.000Z", by: "E" }],
  { docs: { bill: mark }, sentDate: "2026-08-20", review: { status: "ไม่ผ่าน" } },
)
assert.equal(tlRej[3].state, "rejected")
assert.equal(tlRej[3].label, "บัญชีตีกลับ")
assert.equal(tlRej[4].state, "todo", "ตีกลับ = วงจรสะดุด ช่วงจ่ายเงินกลับเป็นรอ")

// ใบที่ยังไม่เริ่มทำอะไรเลย — ช่วงแรกเป็น current ที่เหลือรอ
const tlNew = apTimeline([], { docs: {}, sentDate: "", receivedAt: "2026-08-17" })
assert.deepEqual(tlNew.map((s) => s.state), ["current", "todo", "todo", "todo", "todo"])
assert.deepEqual(tlNew.map((s) => s.at), ["2026-08-17", "", "", "", ""], "ใบใหม่ยังไม่มีใครแตะ แต่รู้วันทำ DD")

// เอกสารครบแต่ยังไม่ส่ง — ช่วง "ส่งบัญชี" เป็นช่วงที่ต้องทำต่อ
const tlReady = apTimeline(tlLog.slice(0, 2), { docs: { bill: mark }, sentDate: "", receivedAt: "2026-08-16" })
assert.deepEqual(tlReady.map((s) => s.state), ["done", "done", "current", "todo", "todo"])
assert.equal(tlReady[2].at, "", "ยังไม่ส่ง = ไม่มีเวลา")
assert.equal(apTimeline(undefined, { docs: {}, sentDate: "" }).length, 5, "ไม่มี log ก็ต้องไม่พัง")

// --- thaiDate ---
assert.equal(thaiDate("2026-08-13"), "13 ส.ค. 69")
assert.equal(thaiDate(""), "—")
assert.equal(thaiDate("ไม่ใช่วันที่"), "—")

// --- thaiDateTime (ประวัติต้องโชว์เวลาไทย ไม่ใช่ UTC ที่เก็บไว้) ---
assert.equal(thaiDateTime("2026-08-17T07:32:00.000Z"), "17 ส.ค. 69 14:32", "UTC+7")
assert.equal(thaiDateTime("2026-08-16T18:30:00.000Z"), "17 ส.ค. 69 01:30", "ข้ามวันตอนดึกไทย")
assert.equal(thaiDateTime("2026-08-17T17:05:00.000Z"), "18 ส.ค. 69 00:05", "เที่ยงคืนไทย = วันถัดไป")
assert.equal(thaiDateTime(""), "—")
assert.equal(thaiDateTime("ไม่ใช่เวลา"), "—")

console.log("✅ ap-tracking logic ผ่านทั้งหมด")
