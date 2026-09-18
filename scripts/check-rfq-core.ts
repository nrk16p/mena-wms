// scripts/check-rfq-core.ts — รัน: npx tsx scripts/check-rfq-core.ts
import assert from "node:assert/strict"
import {
  sheetsForVendor, newToken, effectiveStatus, canVendorWrite, canTransition, progress, partKey,
  applySameAsL, validateAnswer, validatePartAnswer, validateContact, addDays, addMonths, SHEET_ORDER, jobsForInvite, partsForInvite,
  parseLatLng, validateProfile, validateCustomJobs, isCustomJob, validateRate, isAnswered, jobCost, labourSheets, RETIRED_JOB_CODES, MAX_HOURS,
  type RfqInvite, type RfqJob, type RfqPart,
} from "../lib/rfq-core"
import { suggestAddress, checkThaiAddress, composeThaiAddress, type ProvinceNode } from "../lib/thai-address"
import fs from "node:fs"

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
assert.deepEqual(pg.rates, { done: 0, total: 2 }, "ชีตที่มีงานค่าแรง S45 + SVC ยังไม่กรอกอัตรา")
assert.deepEqual(labourSheets(inv, jobs), ["S45", "SVC"])
const withRates = { ...inv, rates: { S45: { normal: 450, at: "" }, SVC: { onsite: 600, at: "" }, S37: { normal: 1, at: "" } } }
assert.deepEqual(progress(withRates, jobs, parts).rates, { done: 1, total: 2 }, "นับเมื่อกรอกค่าแรงปกติ · S37 ไม่ได้ให้ ไม่นับ · SVC มีแค่นอกสถานที่ ยังไม่นับ")
assert.deepEqual(progress({ ...inv, sections: ["parts"] }, jobs, parts).rates, { done: 0, total: 0 }, "ไม่ให้ส่วนค่าแรง = ไม่มีอัตรา")
assert.deepEqual(progress({ ...inv, sections: ["labour"] }, jobs, parts).parts, { done: 0, total: 0 }, "ไม่ให้ส่วนอะไหล่ = 0/0")
// เลือกข้อย่อย: jobCodes จำกัดงานในชีต · ว่าง = ทุกงาน · อะไหล่ไม่เกี่ยว
assert.deepEqual(jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour", "parts"] }, jobs).map((j) => j.jobCode), ["A", "B", "D"])
assert.deepEqual(jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour"], jobCodes: ["B", "C"] }, jobs).map((j) => j.jobCode), ["B"], "C อยู่ชีตที่ไม่ได้ให้ ไม่โผล่")
assert.deepEqual(jobsForInvite({ sheets: ["S45"], sections: ["labour"], jobCodes: [] }, jobs).map((j) => j.jobCode), ["A", "B"], "ว่าง = ทุกงาน")
assert.deepEqual(jobsForInvite({ sheets: ["S45"], sections: ["parts"] }, jobs), [], "ไม่เปิดส่วนค่าแรง")
assert.deepEqual(partsForInvite({ sheets: ["S45"], sections: ["labour", "parts"] }, parts).map((p) => p.sku), ["X"])
assert.deepEqual(progress({ ...inv, jobCodes: ["A"] }, jobs, parts).labour, { done: 1, total: 1 }, "นับเฉพาะข้อย่อยที่เลือก")
// งานต่อครั้งใน SVC ถูกถอด (2026-09-18) — ไม่โผล่ในใบไหนเลย
assert.ok(RETIRED_JOB_CODES.has("SVC-OUT-CAL") && RETIRED_JOB_CODES.has("SVC-TOW-CAL"))
assert.deepEqual(jobsForInvite({ sheets: ["SVC"], sections: ["labour"] }, [...jobs, J("SVC", "SVC-OUT-CAL"), J("SVC", "SVC-TOW-CAL")]).map((j) => j.jobCode), ["D"])
assert.deepEqual(jobsForInvite({ sheets: ["SVC"], sections: ["labour"], jobCodes: ["SVC-OUT-CAL", "D"] }, [...jobs, J("SVC", "SVC-OUT-CAL")]).map((j) => j.jobCode), ["D"], "เลือกไว้ตอนสร้างก็ไม่โผล่")
// หัวข้อเพิ่มเอง
const cj = validateCustomJobs([{ sheet: "S45", name: " ล้างดรัมด้านใน " }, { sheet: "S45", name: "เชื่อมใบกวน", scope: "x" }, { sheet: "SVC", name: "เดินทางนอกพื้นที่" }], ["S45", "SVC"], 2)
assert.notEqual(typeof cj, "string")
if (typeof cj !== "string") {
  assert.deepEqual(cj.map((j) => j.jobCode), ["X-S45-1", "X-S45-2", "X-SVC-1"])
  assert.equal(cj[0].name, "ล้างดรัมด้านใน"); assert.equal(cj[0].seq, 901); assert.ok(isCustomJob(cj[0].jobCode))
  const merged = jobsForInvite({ sheets: ["S45", "SVC"], sections: ["labour"], jobCodes: ["A"], customJobs: cj }, jobs)
  assert.deepEqual(merged.map((j) => j.jobCode), ["A", "X-S45-1", "X-S45-2", "X-SVC-1"], "หัวข้อเพิ่มต่อท้ายชีตตัวเอง ไม่ถูกตัดโดยการเลือกข้อย่อย (D ถูกตัดเพราะไม่ได้เลือก)")
  const inv2 = { sheets: ["S45", "SVC"], sections: ["labour"] as ("labour" | "parts")[], customJobs: cj }
  const once = jobsForInvite(inv2, jobs)
  assert.deepEqual(jobsForInvite(inv2, once).map((j) => j.jobCode), once.map((j) => j.jobCode), "ส่งผลลัพธ์กลับเข้ามาซ้ำ หัวข้อเพิ่มไม่ซ้ำ (hub/หน้าตรวจเรียก progress ด้วยงานที่กรองแล้ว)")
  assert.equal(progress({ ...inv2, items: {}, parts: {} }, once, []).labour.total, 6, "A B D + หัวข้อเพิ่ม 3")
}
assert.equal(typeof validateCustomJobs([{ sheet: "S37", name: "x" }], ["S45"], 2), "string", "ชีตที่ไม่ได้ให้")
assert.equal(typeof validateCustomJobs([{ sheet: "S45", name: "" }], ["S45"], 2), "string", "ไม่มีชื่อ")
assert.deepEqual(validateCustomJobs(undefined, ["S45"], 2), [])

// sameAsL (ชั่วโมง)
const a = applySameAsL({ mode: "hours", L: { hours: 3 }, S: { hours: 9 }, sameAsL: true, note: "", at: "" })
assert.deepEqual(a.S, { hours: 3 })
const b = applySameAsL({ mode: "hours", L: { hours: 3 }, S: { hours: 2 }, sameAsL: false, note: "", at: "" })
assert.deepEqual(b.S, { hours: 2 })

// validateAnswer — ตัดเหมาออก (2026-09-18) เหลือ ชั่วโมง/ไม่รับงาน
assert.equal(typeof validateAnswer({ mode: "bogus" }), "string")
assert.equal(typeof validateAnswer({ mode: "lump", L: { light: 1000 } }), "string", "เหมาไม่รับแล้ว")
assert.equal(typeof validateAnswer({ mode: "hourly", L: { rate: 450, hours: 2 } }), "string", "รายชั่วโมงแบบเดิม (มี rate ต่องาน) ไม่รับแล้ว")
assert.equal(typeof validateAnswer({ mode: "hours", L: { hours: -1 } }), "string", "ติดลบไม่รับ")
assert.equal(typeof validateAnswer({ mode: "hours", L: { hours: MAX_HOURS + 1 } }), "string", "ชั่วโมงเกินเพดาน (กันพิมพ์ราคาลงช่องชั่วโมง)")
const ok = validateAnswer({ mode: "hours", L: { hours: "2.5", rate: 999, light: 5 }, S: {}, sameAsL: true, warrantyMonths: "3", note: " x ".repeat(300) })
assert.notEqual(typeof ok, "string")
if (typeof ok !== "string") {
  assert.deepEqual(ok.L, { hours: 2.5 }, "string ตัวเลข → number · ฟิลด์เดิม rate/light ถูกทิ้ง")
  assert.deepEqual(ok.S, { hours: 2.5 }, "sameAsL ถูก apply ตอน validate")
  assert.equal(ok.warrantyMonths, 3)
  assert.ok(ok.note.length <= 500)
  assert.ok(ok.at)
}
const sk = validateAnswer({ mode: "skip", L: { hours: 4 }, S: {}, sameAsL: false })
if (typeof sk !== "string") assert.equal(sk.mode, "skip")

// กรอกแล้วหรือยัง — ใบเก่าที่เป็นเหมา/รายชั่วโมงเดิม = ยังไม่กรอก · ชั่วโมงว่าง = ยังไม่กรอก
assert.equal(isAnswered(undefined), false)
assert.equal(isAnswered({ mode: "skip", L: {}, S: {}, sameAsL: true, note: "", at: "" }), true)
assert.equal(isAnswered({ mode: "hours", L: { hours: 2 }, S: {}, sameAsL: true, note: "", at: "" }), true)
assert.equal(isAnswered({ mode: "hours", L: {}, S: {}, sameAsL: true, note: "", at: "" }), false, "เลือกชั่วโมงแต่ยังไม่พิมพ์")
assert.equal(isAnswered({ mode: "lump", L: { light: 1 }, S: {}, sameAsL: true, note: "", at: "" } as never), false, "ข้อมูลเหมาเดิม")
assert.equal(isAnswered({ mode: "hourly", L: { rate: 1, hours: 2 }, S: {}, sameAsL: true, note: "", at: "" } as never), false, "ข้อมูลรายชั่วโมงเดิม")

// อัตราค่าแรงต่อประเภทการซ่อม (ชีต)
const r1 = validateRate({ normal: "450", onsite: 600 })
assert.notEqual(typeof r1, "string")
if (typeof r1 !== "string") { assert.equal(r1.normal, 450); assert.equal(r1.onsite, 600); assert.ok(r1.at) }
const r2 = validateRate({ normal: 450, onsite: "" })
if (typeof r2 !== "string") assert.ok(!("onsite" in r2), "เว้นว่าง = ไม่รับงานนอกสถานที่ (ไม่มี key กัน null ใน Mongo)")
assert.equal(typeof validateRate({ normal: -1 }), "string")
assert.equal(typeof validateRate({ onsite: "abc" }), "string")

// ค่าแรงต่องาน = ชั่วโมง × อัตรา
const cost = jobCost({ mode: "hours", L: { hours: 2 }, S: { hours: 1.5 }, sameAsL: false, note: "", at: "" }, { normal: 450, onsite: 600, at: "" })
assert.deepEqual(cost, { L: { normal: 900, onsite: 1200 }, S: { normal: 675, onsite: 900 } })
assert.deepEqual(jobCost({ mode: "hours", L: { hours: 2 }, S: { hours: 2 }, sameAsL: true, note: "", at: "" }, { normal: 450, at: "" }),
  { L: { normal: 900, onsite: null }, S: { normal: 900, onsite: null } }, "ไม่รับนอกสถานที่ → null")
assert.equal(jobCost({ mode: "skip", L: {}, S: {}, sameAsL: true, note: "", at: "" }, { normal: 450, at: "" }), null)
assert.equal(jobCost(undefined, { normal: 450, at: "" }), null)
assert.deepEqual(jobCost({ mode: "hours", L: { hours: 2 }, S: { hours: 2 }, sameAsL: true, note: "", at: "" }, undefined),
  { L: { normal: null, onsite: null }, S: { normal: null, onsite: null } }, "ยังไม่กรอกอัตรา")

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

// ที่อยู่แบบแยกช่อง (2026-09-17) — ตรวจกับชุดข้อมูลจริง data/thai-address.json
const TH = JSON.parse(fs.readFileSync(new URL("../data/thai-address.json", import.meta.url), "utf8")) as ProvinceNode[]
const addr = validateProfile({ addressDetail: "99/1 หมู่ 2", province: "ชลบุรี", district: "บางละมุง", subdistrict: "หนองปรือ", landmark: "ตรงข้ามปั๊ม ปตท." }, TH)
assert.notEqual(typeof addr, "string", String(addr))
if (typeof addr !== "string") {
  assert.equal(addr.postalCode, "20150", "เว้นรหัสไปรษณีย์ = เติมจากตำบล")
  assert.equal(addr.address, "99/1 หมู่ 2 ต.หนองปรือ อ.บางละมุง จ.ชลบุรี 20150 (จุดสังเกต: ตรงข้ามปั๊ม ปตท.)")
  assert.equal(addr.landmark, "ตรงข้ามปั๊ม ปตท.")
}
assert.equal(validateProfile({ province: "ชลบุรี", district: "บางละมุง", subdistrict: "หนองปรือ", postalCode: "10110" }, TH), "รหัสไปรษณีย์ของตำบลหนองปรือ คือ 20150", "รหัสไม่ตรงตำบล ไม่รับ")
assert.match(String(validateProfile({ province: "ชลบุรี", district: "บางนา", subdistrict: "บางนาเหนือ" }, TH)), /ไม่อยู่ในจังหวัดชลบุรี/, "อำเภอข้ามจังหวัด ไม่รับ")
assert.match(String(validateProfile({ province: "ชลบุรี", district: "บางละมุง", subdistrict: "บางนาเหนือ" }, TH)), /ไม่อยู่ในอำเภอบางละมุง/, "ตำบลข้ามอำเภอ ไม่รับ")
assert.equal(validateProfile({ province: "ชลบุรี" }, TH), "กรุณาเลือกอำเภอ", "เลือกจังหวัดแล้วต้องเลือกให้ครบ")
assert.equal(validateProfile({ province: "ไม่มีจริง", district: "x", subdistrict: "y" }, TH), "ไม่พบจังหวัดที่เลือก")
const bkk = validateProfile({ province: "กรุงเทพมหานคร", district: "บางนา", subdistrict: "บางนา" }, TH)
assert.notEqual(typeof bkk, "string", String(bkk))
if (typeof bkk !== "string") assert.equal(bkk.address, "แขวงบางนา เขตบางนา กรุงเทพมหานคร 10260", "กทม. ใช้ แขวง/เขต")
const legacy = validateProfile({ address: " ถ.สุขุมวิท กม.30 " }, TH)
assert.notEqual(typeof legacy, "string")
if (typeof legacy !== "string") { assert.equal(legacy.address, "ถ.สุขุมวิท กม.30", "ใบเก่าส่งแค่ address ได้"); assert.equal(legacy.province, undefined) }
const onlyLandmark = validateProfile({ landmark: "หลังตลาดสด" }, TH)
assert.notEqual(typeof onlyLandmark, "string")
if (typeof onlyLandmark !== "string") assert.equal(onlyLandmark.address, "หลังตลาดสด")
// ตำบลที่ต้นทางไม่มีรหัส (เกาะ) — พิมพ์รหัสเองได้ แต่ต้อง 5 หลัก
const island = TH.flatMap((p) => p.a.flatMap((a) => a.t.filter((t) => t.z === "null").map((t) => ({ province: p.p, district: a.n, subdistrict: t.n }))))[0]
assert.deepEqual(checkThaiAddress(TH, { ...island, postalCode: "" }), { postalCode: "" })
assert.deepEqual(checkThaiAddress(TH, { ...island, postalCode: "81150" }), { postalCode: "81150" })
assert.equal(typeof checkThaiAddress(TH, { ...island, postalCode: "81" }), "string")
// autocomplete รายช่อง (2026-09-18) — พิมพ์ช่องไหนก็ได้ เลือกแล้วเติมช่องที่เกี่ยวข้องให้ครบ
const ks = suggestAddress(TH, "subdistrict", "คลองสาน", {})
assert.deepEqual(ks[0], { province: "กรุงเทพมหานคร", district: "คลองสาน", subdistrict: "คลองสาน", postalCode: "10600" }, "แขวงตรงเป๊ะมาก่อน · เติมครบ 4 ช่อง")
assert.deepEqual(suggestAddress(TH, "subdistrict", "แขวงคลองสาน", {})[0], ks[0], "ตัดคำนำหน้า แขวง")
const ks2 = suggestAddress(TH, "subdistrict", "คลองสา", {})
assert.equal(ks2[0].subdistrict, "คลองสาน", "พิมพ์ยังไม่จบคำ")
assert.ok(ks2.length > 1 && ks2.every((h) => h.subdistrict!.startsWith("คลองสา")), "แขวง/ตำบลอื่นที่ขึ้นต้นเหมือนกันตามมา (คลองสาม, คลองสามประเวศ)")
const kz = suggestAddress(TH, "postalCode", "10600", {})
assert.ok(kz.length > 1 && kz.every((h) => h.postalCode === "10600"), "รหัสไปรษณีย์ → ทุกแขวงในรหัสนั้น")
assert.ok(kz.some((h) => h.subdistrict === "คลองสาน"))
assert.ok(suggestAddress(TH, "postalCode", "106", {}).every((h) => h.postalCode.startsWith("106")), "พิมพ์ 3 หลักก็แนะนำ")
const kd = suggestAddress(TH, "district", "เขตคลองสาน", {})
assert.deepEqual(kd[0], { province: "กรุงเทพมหานคร", district: "คลองสาน" }, "ช่องเขต → เขต + จังหวัด (ไม่เดาแขวง)")
const kp = suggestAddress(TH, "province", "จ.กรุง", {})
assert.deepEqual(kp[0], { province: "กรุงเทพมหานคร" }, "ช่องจังหวัด → จังหวัดอย่างเดียว · ตัด จ.")
assert.ok(suggestAddress(TH, "province", "บุรี", {}).length > 1, "มีคำค้นอยู่ข้างในก็เจอ")
// ช่องที่กรอกแล้วช่วยเรียง: ตำบลชื่อซ้ำหลายจังหวัด → ของจังหวัดที่เลือกไว้มาก่อน (ไม่ตัดทิ้ง — เผื่อกำลังจะเปลี่ยนจังหวัด)
const np = suggestAddress(TH, "subdistrict", "ต.หนองปรือ", {})
assert.ok(np.length > 1 && np[0].subdistrict === "หนองปรือ", "ตัด ต. · ชื่อตรงมาก่อน")
const npCtx = suggestAddress(TH, "subdistrict", "หนองปรือ", { province: "ชลบุรี" })
assert.equal(npCtx[0].province, "ชลบุรี"); assert.equal(npCtx[0].postalCode, "20150")
assert.ok(npCtx.some((h) => h.province !== "ชลบุรี"), "จังหวัดอื่นยังอยู่ท้ายรายการ")
assert.equal(suggestAddress(TH, "district", "เมือง", { province: "ชลบุรี" })[0].province, "ชลบุรี", "อ.เมือง มีทุกจังหวัด → จังหวัดที่เลือกมาก่อน")
assert.deepEqual(suggestAddress(TH, "subdistrict", "ห", {}), [], "สั้นเกินไม่ค้น")
assert.deepEqual(suggestAddress(TH, "postalCode", "10", {}), [], "รหัสสั้นเกินไม่ค้น")
assert.ok(suggestAddress(TH, "subdistrict", "คลอง", {}).length <= 8, "จำกัด 8 รายการ")
assert.equal(composeThaiAddress({}), "")

console.log("✅ rfq-core: ผ่านทั้งหมด")
