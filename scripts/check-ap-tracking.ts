// scripts/check-ap-tracking.ts
// รัน: npx tsx scripts/check-ap-tracking.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, nextThursday,
  isDocSetComplete, apStatusOf, termDays, AP_DOC_FIELDS, FINANCE_DOC_KEYS, thaiDate,
  missingDocLabels, todayICT, ICT_OFFSET_MS, thaiDateTime,
  AP_GO_LIVE, inApScope, monthInApScope, apSinceOf,
  apDocLabel, apItemKeys, apItemsDone, apFilesByDoc, upcomingThursdays, addDays,
  apUrgency, needsAccountingReview,
  cleanTaxInvoiceNos, AP_TAX_NO_MAX, AP_TAX_NOS_MAX,
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
assert.equal(AP_DOC_FIELDS.length, 5)
assert.deepEqual(AP_DOC_FIELDS.map((f) => f.key), ["bill","invoice","taxInvoice","receipt","billingNote"])
assert.deepEqual(FINANCE_DOC_KEYS, ["bill","invoice","taxInvoice","receipt","billingNote"])

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
assert.equal(apDocLabel("taxInvoiceNos"), "เลขที่ใบกำกับ", "ช่องเลขที่เอกสารก็ต้องมีป้ายไว้อ่าน log")
assert.equal(apDocLabel("taxInvoiceNo"), "เลขที่ใบกำกับ", "ช่องเดี่ยวรุ่นแรกยังต้องอ่านออก")
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

// --- เลขที่ใบกำกับ (หลายเลขต่อใบ) ---
assert.deepEqual(cleanTaxInvoiceNos([" A1 ", "A2"]), ["A1", "A2"], "ตัดช่องว่างหัวท้าย")
assert.deepEqual(cleanTaxInvoiceNos(["A1", "", "  ", "A1"]), ["A1"], "ทิ้งค่าว่างและตัวซ้ำ")
assert.deepEqual(cleanTaxInvoiceNos("A1"), [], "ไม่ใช่ array = ไม่มีเลข")
assert.deepEqual(cleanTaxInvoiceNos(undefined), [])
assert.equal(cleanTaxInvoiceNos(Array.from({ length: 50 }, (_, i) => `N${i}`)).length, AP_TAX_NOS_MAX, "คุมเพดานจำนวน")
assert.equal(cleanTaxInvoiceNos(["x".repeat(200)])[0].length, AP_TAX_NO_MAX, "คุมความยาวต่อเลข")

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

// --- go-live cutoff (ใบก่อนวันเริ่มใช้ระบบเป็นของ Excel เดิม ไม่ใช่ยอดค้างของระบบนี้) ---
assert.equal(AP_GO_LIVE, "2026-08-01")
assert.equal(inApScope("2026-07-31"), false, "ก่อน cutoff = นอกสโคป")
assert.equal(inApScope("2026-08-01"), true, "ตรงวัน cutoff = อยู่ในสโคป (>= ไม่ใช่ >)")
assert.equal(inApScope("2026-08-13"), true, "หลัง cutoff = อยู่ในสโคป")
assert.equal(inApScope("2026-02-15"), false, "ย้อนไปไกล ๆ ก็ยังนอกสโคป")
assert.equal(inApScope(""), false, "ไม่มีวันรับของที่อ่านได้ = วางบนเส้นเวลาไม่ได้ = นอกสโคป")
// override ด้วย since — ใช้เส้นใหม่แทน AP_GO_LIVE ทั้งหมด
assert.equal(inApScope("2026-07-31", "2026-07-01"), true, "ขยับเส้นแล้วใบเดือน ก.ค. ต้องเข้า")
assert.equal(inApScope("2026-06-30", "2026-07-01"), false)
assert.equal(inApScope("2026-08-14", "2026-08-15"), false, "cutoff กลางเดือนต้องตัดรายวันได้")
assert.equal(inApScope("2026-08-15", "2026-08-15"), true)

// เดือนที่จบก่อน cutoff ทั้งเดือน = ไม่ต้องยิงคิวรีหาเลย
assert.equal(monthInApScope("2026-07"), false, "ก.ค. จบก่อน 01/08 ทั้งเดือน")
assert.equal(monthInApScope("2026-08"), true, "เดือนที่มี cutoff อยู่ ต้องดึงมากรองรายแถวต่อ")
assert.equal(monthInApScope("2026-09"), true)
assert.equal(monthInApScope("2026-02"), false)
assert.equal(monthInApScope("2026-07", "2026-07-15"), true, "เดือนที่คร่อม cutoff ต้องไม่ถูกตัดทั้งเดือน")

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
