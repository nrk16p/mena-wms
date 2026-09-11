// scripts/check-rfq-core.ts — รัน: npx tsx scripts/check-rfq-core.ts
import assert from "node:assert/strict"
import {
  sheetsForVendor, newToken, effectiveStatus, canVendorWrite, canTransition, progress, partKey,
  applySameAsL, validateAnswer, validatePartAnswer, validateContact, addDays, addMonths, SHEET_ORDER, jobsForInvite, partsForInvite,
  parseLatLng, validateProfile, validateCustomJobs, isCustomJob,
  type RfqInvite, type RfqJob, type RfqPart,
} from "../lib/rfq-core"

// จับคู่ช่องที่ติ๊ก → ชีต
assert.deepEqual(sheetsForVendor([]), ["SVC"], "ทุกอู่ได้ SVC เสมอ")
assert.deepEqual(sheetsForVendor(["S45"]), ["S45", "SVC"])
assert.deepEqual(sheetsForVendor(["S49"]), ["S37", "SVC"], "เกียร์อู่นอก → ชีตรวมเบรก-ครัช-เกียร์")
assert.deepEqual(sheetsForVendor(["S37", "S49"]), ["S37", "SVC"], "ไม่ซ้ำ")
assert.deepEqual(sheetsForVendor(["S67"]), ["S65", "SVC"], "PM ตัวไหนก็ได้ชีต PM")
assert.deepEqual(sheetsForVendor(["S75"]), ["SVC"], "ยาง (S75 อู่นอก-T-ปะยาง) ไม่มีชีต")
assert.deepEqual(sheetsForVendor(["S41"]), ["SVC"], "หาง (S41 อู่นอก-CM) ไม่มีชีต")
assert.deepEqual(sheetsForVendor(["S44"]), ["SVC"], "อู่ใน ไม่มีชีต")
assert.deepEqual(sheetsForVendor(["S85", "S45", "S33"]), ["S45", "S33", "S85", "SVC"], "เรียงตาม SHEET_ORDER")
assert.equal(SHEET_ORDER.length, 13)

// token
const t = newToken()
assert.match(t, /^[A-Za-z0-9_-]{24}$/)
assert.notEqual(t, newToken())

// สถานะที่มีผล + สิทธิ์เขียนของอู่
const base = { status: "กำลังกรอก" as const, deadline: "2026-09-20" }
assert.equal(effectiveStatus(base, "2026-09-20"), "กำลังกรอก", "วันปิดรับยังกรอกได้")
assert.equal(effectiveStatus(base, "2026-09-21"), "หมดอายุ")
assert.equal(effectiveStatus({ status: "ส่งแล้ว", deadline: "2026-09-01" }, "2026-09-21"), "ส่งแล้ว", "ส่งแล้วไม่หมดอายุ")
assert.equal(effectiveStatus({ status: "ยืนยันแล้ว", deadline: "2026-09-01" }, "2026-09-21"), "ยืนยันแล้ว")
assert.equal(canVendorWrite(base, "2026-09-20"), true)
assert.equal(canVendorWrite(base, "2026-09-21"), false)
assert.equal(canVendorWrite({ status: "ส่งกลับแก้", deadline: "2026-09-30" }, "2026-09-21"), true)
assert.equal(canVendorWrite({ status: "ส่งแล้ว", deadline: "2026-09-30" }, "2026-09-21"), false)
assert.equal(canVendorWrite({ status: "ยกเลิก", deadline: "2026-09-30" }, "2026-09-21"), false)

// ตารางเปลี่ยนสถานะ
assert.equal(canTransition("กำลังกรอก", "submit"), true)
assert.equal(canTransition("ส่งกลับแก้", "submit"), true)
assert.equal(canTransition("สร้างแล้ว", "submit"), false, "ยังไม่มี contact")
assert.equal(canTransition("ส่งแล้ว", "confirm"), true)
assert.equal(canTransition("กำลังกรอก", "confirm"), false)
assert.equal(canTransition("ส่งแล้ว", "return"), true)
assert.equal(canTransition("ยืนยันแล้ว", "cancel"), false)
assert.equal(canTransition("กำลังกรอก", "cancel"), true)
assert.equal(canTransition("ยืนยันแล้ว", "extend"), false)
assert.equal(canTransition("กำลังกรอก", "extend"), true)

// ความคืบหน้า นับเฉพาะชีตที่ให้
const J = (sheet: string, jobCode: string): RfqJob => ({ sheet, sheetTitle: "", seq: 1, jobCode, name: "", scope: "", tierCriteria: "", refHoursL: 1, refHoursS: 1, version: 1, active: true })
const P = (sheet: string, sku: string): RfqPart => ({ sheet, sheetTitle: "", seq: 1, sku, name: "", useWith: "L+S", unit: "ชิ้น", version: 1, active: true })
const jobs = [J("S45", "A"), J("S45", "B"), J("S37", "C"), J("SVC", "D")]
const parts = [P("S45", "X"), P("S37", "Y")]
const inv = { sheets: ["S45", "SVC"], sections: ["labour", "parts"] as const,
  items: { A: { mode: "skip", L: {}, S: {}, sameAsL: false, note: "", at: "" }, C: { mode: "skip", L: {}, S: {}, sameAsL: false, note: "", at: "" } },
  parts: { [partKey("S45", "X")]: { skip: true, sameAsL: false, brand: "", note: "", at: "" } } } as unknown as Pick<RfqInvite, "items" | "parts" | "sheets" | "sections">
const pg = progress(inv, jobs, parts)
assert.deepEqual(pg.labour, { done: 1, total: 3 }, "C อยู่ชีตที่ไม่ได้ให้ ไม่นับ")
assert.deepEqual(pg.parts, { done: 1, total: 1 })
assert.deepEqual(progress({ ...inv, sections: ["labour"] }, jobs, parts).parts, { done: 0, total: 0 }, "ไม่ให้ส่วนอะไหล่ = 0/0")
// เลือกข้อย่อย: jobCodes จำกัดงานในชีต · ว่าง = ทุกงาน · อะไหล่ไม่เกี่ยว
assert.deepEqual(jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour", "parts"] }, jobs).map((j) => j.jobCode), ["A", "B", "D"])
assert.deepEqual(jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour"], jobCodes: ["B", "C"] }, jobs).map((j) => j.jobCode), ["B"], "C อยู่ชีตที่ไม่ได้ให้ ไม่โผล่")
assert.deepEqual(jobsForInvite({ sheets: ["S45"], sections: ["labour"], jobCodes: [] }, jobs).map((j) => j.jobCode), ["A", "B"], "ว่าง = ทุกงาน")
assert.deepEqual(jobsForInvite({ sheets: ["S45"], sections: ["parts"] }, jobs), [], "ไม่เปิดส่วนค่าแรง")
assert.deepEqual(partsForInvite({ sheets: ["S45"], sections: ["labour", "parts"] }, parts).map((p) => p.sku), ["X"])
assert.deepEqual(progress({ ...inv, jobCodes: ["A"] }, jobs, parts).labour, { done: 1, total: 1 }, "นับเฉพาะข้อย่อยที่เลือก")
// หัวข้อเพิ่มเอง
const cj = validateCustomJobs([{ sheet: "S45", name: " ล้างดรัมด้านใน " }, { sheet: "S45", name: "เชื่อมใบกวน", scope: "x" }, { sheet: "SVC", name: "เดินทางนอกพื้นที่" }], ["S45", "SVC"], 2)
assert.notEqual(typeof cj, "string")
if (typeof cj !== "string") {
  assert.deepEqual(cj.map((j) => j.jobCode), ["X-S45-1", "X-S45-2", "X-SVC-1"])
  assert.equal(cj[0].name, "ล้างดรัมด้านใน"); assert.equal(cj[0].seq, 901); assert.ok(isCustomJob(cj[0].jobCode))
  const merged = jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour"], jobCodes: ["A"], customJobs: cj }, jobs)
  assert.deepEqual(merged.map((j) => j.jobCode), ["A", "X-S45-1", "X-S45-2", "X-SVC-1"], "หัวข้อเพิ่มต่อท้ายชีตตัวเอง ไม่ถูกตัดโดยการเลือกข้อย่อย (D ถูกตัดเพราะไม่ได้เลือก)")
}
assert.equal(typeof validateCustomJobs([{ sheet: "S37", name: "x" }], ["S45"], 2), "string", "ชีตที่ไม่ได้ให้")
assert.equal(typeof validateCustomJobs([{ sheet: "S45", name: "" }], ["S45"], 2), "string", "ไม่มีชื่อ")
assert.deepEqual(validateCustomJobs(undefined, ["S45"], 2), [])

// sameAsL
const a = applySameAsL({ mode: "lump", L: { light: 1000, mid: 2000, heavy: 3000 }, S: { light: 5 }, sameAsL: true, note: "", at: "" })
assert.deepEqual(a.S, { light: 1000, mid: 2000, heavy: 3000 })
const b = applySameAsL({ mode: "lump", L: { light: 1000 }, S: { light: 5 }, sameAsL: false, note: "", at: "" })
assert.deepEqual(b.S, { light: 5 })

// validateAnswer
assert.equal(typeof validateAnswer({ mode: "bogus" }), "string")
assert.equal(typeof validateAnswer({ mode: "hourly", L: { rate: -1 } }), "string", "ติดลบไม่รับ")
assert.equal(typeof validateAnswer({ mode: "hourly", L: { rate: 10_000_000 } }), "string", "เกินเพดาน")
const ok = validateAnswer({ mode: "hourly", L: { rate: "450", hours: 2 }, S: {}, sameAsL: true, warrantyMonths: "3", note: " x ".repeat(300) })
assert.notEqual(typeof ok, "string")
if (typeof ok !== "string") {
  assert.equal(ok.L.rate, 450, "string ตัวเลข → number")
  assert.equal(ok.S.rate, 450, "sameAsL ถูก apply ตอน validate")
  assert.equal(ok.warrantyMonths, 3)
  assert.ok(ok.note.length <= 500)
  assert.ok(ok.at)
}
// validatePartAnswer
assert.equal(typeof validatePartAnswer({ priceL: -5 }), "string")
const pk = validatePartAnswer({ skip: false, priceL: 120.5, sameAsL: true, brand: "NOK", leadDays: "7" })
assert.notEqual(typeof pk, "string")
if (typeof pk !== "string") { assert.equal(pk.priceS, 120.5); assert.equal(pk.leadDays, 7) }
const pkSkip = validatePartAnswer({ skip: true, sameAsL: true })
assert.notEqual(typeof pkSkip, "string")
if (typeof pkSkip !== "string") assert.ok(!("priceS" in pkSkip), "sameAsL โดยไม่มี priceL ต้องไม่สร้าง priceS (กัน null ใน Mongo)")
// validateContact
assert.equal(typeof validateContact({ name: "ก", phone: "", email: "" }), "string", "ต้องมีเบอร์หรืออีเมล")
assert.equal(typeof validateContact({ name: "", phone: "081", email: "" }), "string")
assert.equal(typeof validateContact({ name: "ก", phone: "081", email: "", confirmedVendor: false }), "string", "ต้องติ๊กยืนยันชื่ออู่")
assert.notEqual(typeof validateContact({ name: "ก", phone: "0812345678", email: "", confirmedVendor: true }), "string")

// วันที่
assert.equal(addDays("2026-09-10", 14), "2026-09-24")
assert.equal(addDays("2026-12-25", 10), "2027-01-04")
assert.equal(addMonths("2026-09-10", 12), "2027-09-10")
assert.equal(addMonths("2026-01-31", 1), "2026-02-28", "ปลายเดือนไม่ล้น")

// พิกัดจากลิงก์แผนที่
assert.deepEqual(parseLatLng("https://www.google.com/maps/place/xx/@13.7563309,100.5017651,17z/data=!3m1"), { lat: 13.7563309, lng: 100.5017651 })
assert.deepEqual(parseLatLng("https://maps.google.com/?q=13.75,100.50"), { lat: 13.75, lng: 100.5 })
assert.deepEqual(parseLatLng("https://www.google.com/maps/search/?api=1&query=13.7,100.5"), { lat: 13.7, lng: 100.5 })
assert.deepEqual(parseLatLng("…/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d13.75!4d100.51"), { lat: 13.75, lng: 100.51 })
assert.deepEqual(parseLatLng("13.7563, 100.5018"), { lat: 13.7563, lng: 100.5018 })
assert.equal(parseLatLng("https://maps.app.goo.gl/AbCdEf"), null, "ลิงก์ย่อไม่มีพิกัด")
assert.equal(parseLatLng("999,999"), null)
// validateProfile — กำลังการซ่อม + พิกัด
const prof = validateProfile({ capacity: { heavy: "2", mid: 3, light: 1 }, mapUrl: "https://maps.google.com/?q=13.75,100.50", address: " ถ.สุขุมวิท " })
assert.notEqual(typeof prof, "string")
if (typeof prof !== "string") {
  assert.deepEqual(prof.capacity, { bays: 6, heavy: 2, mid: 3, light: 1 }, "ไม่ใส่รวม = ผลบวก")
  assert.equal(prof.lat, 13.75); assert.equal(prof.lng, 100.5); assert.equal(prof.address, "ถ.สุขุมวิท")
}
const prof2 = validateProfile({ capacity: { bays: 8, heavy: 2, mid: 3, light: 1 } })
if (typeof prof2 !== "string") assert.equal(prof2.capacity.bays, 8, "ใส่รวมเองมากกว่าผลบวกได้ (ช่องอเนกประสงค์)")
assert.equal(typeof validateProfile({ capacity: { bays: 3, heavy: 2, mid: 3 } }), "string", "รวมน้อยกว่าผลบวกไม่รับ")
assert.equal(typeof validateProfile({ capacity: { heavy: -1 } }), "string")
assert.equal(typeof validateProfile({ capacity: { heavy: 1.5 } }), "string")
assert.equal(typeof validateProfile({ lat: 13.7 }), "string", "lat เดี่ยว ๆ ไม่รับ")
assert.equal(typeof validateProfile({ lat: "x", lng: "y" }), "string")
const p2 = validateProfile({ lat: "13.7", lng: "100.5", mapUrl: "" })
if (typeof p2 !== "string") { assert.equal(p2.lng, 100.5, "lat/lng ที่พิมพ์เองชนะลิงก์"); assert.deepEqual(p2.capacity, { bays: 0, heavy: 0, mid: 0, light: 0 }) }

console.log("✅ rfq-core: ผ่านทั้งหมด")
