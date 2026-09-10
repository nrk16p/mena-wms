// scripts/check-rfq-core.ts — รัน: npx tsx scripts/check-rfq-core.ts
import assert from "node:assert/strict"
import {
  sheetsForVendor, newToken, effectiveStatus, canVendorWrite, canTransition, progress, partKey,
  applySameAsL, validateAnswer, validatePartAnswer, validateContact, addDays, addMonths, SHEET_ORDER,
  type RfqInvite, type RfqJob, type RfqPart,
} from "../lib/rfq-core"

// จับคู่ช่องที่ติ๊ก → ชีต
assert.deepEqual(sheetsForVendor([]), ["SVC"], "ทุกอู่ได้ SVC เสมอ")
assert.deepEqual(sheetsForVendor(["S45"]), ["S45", "SVC"])
assert.deepEqual(sheetsForVendor(["S49"]), ["S37", "SVC"], "เกียร์อู่นอก → ชีตรวมเบรก-ครัช-เกียร์")
assert.deepEqual(sheetsForVendor(["S37", "S49"]), ["S37", "SVC"], "ไม่ซ้ำ")
assert.deepEqual(sheetsForVendor(["S67"]), ["S65", "SVC"], "PM ตัวไหนก็ได้ชีต PM")
assert.deepEqual(sheetsForVendor(["S41"]), ["SVC"], "ยาง (S41 อู่นอก-T-ปะยาง) ไม่มีชีต")
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

console.log("✅ rfq-core: ผ่านทั้งหมด")
