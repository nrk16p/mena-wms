// วันจ่ายของใบที่ผ่านจาก "นำเข้าการตั้งเบิก" — นับจากวันกดส่งบัญชีล่าสุด (ผู้ใช้สั่ง 17/11/2026)
// รัน: npx tsx scripts/check-ap-import-pay.ts
import assert from "node:assert/strict"
import { apImportPaySchedule, apImportPayText, apLatestSentAt, apPayRecalc, ictDate } from "../lib/ap-tracking"

// เคสที่ผู้ใช้ยก: ส่งบัญชี พฤ 12/11/2026 10:22 · 7D → ปิดรอบ อ 17/11 → จ่าย พฤ 26/11
const r1 = apImportPaySchedule({ passedISO: "2026-11-17", sentType: "ตามรอบ", creditTerm: "7D", sentDocISO: "2026-11-12" })
assert.ok(r1.ok)
assert.equal(r1.schedule.payDate, "2026-11-26")
assert.equal(r1.payFrom, "sent")
// นำเข้าวันพุธ 18/11 (เลยเส้นตายอังคารไปแล้ว) ก็ยังยึดรอบของวันส่ง
const r1b = apImportPaySchedule({ passedISO: "2026-11-18", sentType: "ตามรอบ", creditTerm: "7D", sentDocISO: "2026-11-12" })
assert.ok(r1b.ok); assert.equal(r1b.schedule.payDate, "2026-11-26")
// นำเข้าหลังวันจ่ายของรอบนั้นไปแล้ว → นับจากวันนำเข้า ไม่ออกวันย้อนหลัง
const r1c = apImportPaySchedule({ passedISO: "2026-11-27", sentType: "ตามรอบ", creditTerm: "7D", sentDocISO: "2026-11-12" })
assert.ok(r1c.ok); assert.equal(r1c.schedule.payDate, "2026-12-10"); assert.equal(r1c.payFrom, "passed")

// sentType ว่าง = ตามรอบ
const r2 = apImportPaySchedule({ passedISO: "2026-11-17", sentType: "", creditTerm: "15D", sentDocISO: "2026-11-12" })
assert.ok(r2.ok); assert.equal(r2.schedule.type, "ตามรอบ"); assert.equal(r2.schedule.payDate, "2026-11-26")

// 30D: ส่ง 24/10 นำเข้า 17/11 → ตัดรอบ 25/10 จ่าย 5/12
const r3 = apImportPaySchedule({ passedISO: "2026-11-17", sentType: "ตามรอบ", creditTerm: "30D", sentDocISO: "2026-10-24" })
assert.ok(r3.ok); assert.equal(r3.schedule.cutoff, "2026-10-25"); assert.equal(r3.schedule.payDate, "2026-12-05"); assert.equal(r3.payFrom, "sent")

// นอกรอบ: นับพฤหัสจากวันส่ง
const r4 = apImportPaySchedule({ passedISO: "2026-11-18", sentType: "นอกรอบ", creditTerm: "", sentDocISO: "2026-11-12" })
assert.ok(r4.ok); assert.equal(r4.schedule.type, "นอกรอบ"); assert.equal(r4.schedule.payDate, "2026-11-26")

// ไม่มีเครดิตเทอม → ผ่านได้แต่ไม่มีวันจ่าย
const r5 = apImportPaySchedule({ passedISO: "2026-11-17", sentType: "ตามรอบ", creditTerm: "", sentDocISO: "2026-11-12" })
assert.equal(r5.ok, false)
assert.match(apImportPayText(r5, "2026-11-12"), /ยังไม่กำหนดวันจ่าย/)
assert.match(apImportPayText(r1, "2026-11-12"), /จ่ายรอบพฤหัส 26 พ\.ย\. 69 \(นับจากวันส่งบัญชี 12 พ\.ย\. 69\)/)

// วันส่งล่าสุด: ตีกลับแล้วส่งใหม่ → ใช้เวลาส่งใหม่ แม้ sentMarkedAt ค้างครั้งแรก
const log = [
  { field: "sent", action: "ส่งบัญชี (ตามรอบ)", at: "2026-11-05T03:00:00.000Z" },
  { field: "review", action: "บัญชีตรวจเอกสาร: ไม่ผ่าน", at: "2026-11-06T03:00:00.000Z" },
  { field: "review", action: "จัดซื้อแก้ไขแล้ว ส่งตรวจใหม่", at: "2026-11-12T03:22:00.000Z" },
]
assert.equal(ictDate(apLatestSentAt("2026-11-05T03:00:00.000Z", log)), "2026-11-12")
assert.equal(ictDate(apLatestSentAt("2026-11-12T03:22:00.000Z", log)), "2026-11-12")
assert.equal(apLatestSentAt("", []), "")
assert.equal(apLatestSentAt("2026-11-12T03:22:00.000Z", null), "2026-11-12T03:22:00.000Z")

// ธงเตือน ⚠️ (apPayRecalc) ต้องไม่ขึ้นกับใบที่นำเข้า
assert.equal(apPayRecalc({ ...r1.schedule, basis: { passedDate: "2026-11-17", creditTerm: "7D", source: "voucher-import", sentDate: "2026-11-12" } }, "2026-11-12"), null)
assert.equal(apPayRecalc({ ...r4.schedule, basis: { passedDate: "2026-11-18", source: "voucher-import", sentDate: "2026-11-12" } }, "2026-11-12"), null, "นอกรอบจากนำเข้า")
assert.equal(apPayRecalc({ ...r3.schedule, basis: { passedDate: "2026-11-17", creditTerm: "30D", cutoffFrom: "sent", source: "voucher-import", sentDate: "2026-10-24" } }, "2026-10-24"), null)

console.log("check-ap-import-pay: ok")
