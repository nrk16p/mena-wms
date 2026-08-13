// scripts/check-ap-tracking.ts
// รัน: npx tsx scripts/check-ap-tracking.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, nextThursday,
  isDocSetComplete, apStatusOf, termDays, AP_DOC_FIELDS, FINANCE_DOC_KEYS, thaiDate,
  missingDocLabels, todayICT, ICT_OFFSET_MS,
  AP_GO_LIVE, inApScope, monthInApScope, apSinceOf,
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

// --- missingDocLabels (ข้อความบอกว่าขาดอะไร ต้องตรงกับ isDocSetComplete เสมอ) ---
assert.deepEqual(missingDocLabels({}), ["DD (ใบรับของ)", "PO (ใบสั่งซื้อ)", "เอกสารการเงินอย่างน้อย 1 ใบ"])
assert.deepEqual(missingDocLabels({ dd: mark, po: mark }), ["เอกสารการเงินอย่างน้อย 1 ใบ"])
assert.deepEqual(missingDocLabels({ dd: mark, po: mark, receipt: mark }), [], "ครบชุดแล้วต้องไม่ขาดอะไร")
assert.deepEqual(missingDocLabels({ po: mark, bill: mark }), ["DD (ใบรับของ)"])
for (const docs of [{}, { dd: mark }, { dd: mark, po: mark }, { dd: mark, po: mark, bill: mark }]) {
  assert.equal(missingDocLabels(docs).length === 0, isDocSetComplete(docs), "สองฟังก์ชันต้องตัดสินตรงกัน")
}

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

// --- thaiDate ---
assert.equal(thaiDate("2026-08-13"), "13 ส.ค. 69")
assert.equal(thaiDate(""), "—")
assert.equal(thaiDate("ไม่ใช่วันที่"), "—")

console.log("✅ ap-tracking logic ผ่านทั้งหมด")
