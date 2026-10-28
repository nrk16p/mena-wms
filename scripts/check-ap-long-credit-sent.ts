// เครดิตยาว 30D/60D ตัดรอบ 25 จาก "วันที่จัดซื้อกดส่งบัญชี" แทนวันกดผ่าน (ผู้ใช้สั่ง 28/10/2026)
// รัน: npx tsx scripts/check-ap-long-credit-sent.ts
import assert from "node:assert/strict"
import { apPaySchedule, apPayRecalc, isLongCredit, isShortCredit, longCreditCutoffBase } from "../lib/ap-tracking"

// นิยาม: สั้น 7+15 · ยาว 30+60
assert.deepEqual(["7D", "15D", "30D", "60D", "90D", "Immediate"].map(isLongCredit), [false, false, true, true, false, false])
assert.deepEqual(["7D", "15D", "30D", "60D"].map(isShortCredit), [true, true, false, false])

// ส่งบัญชีก่อนวันที่ 25 · บัญชีกดผ่านหลังวันที่ 25 → ยังทันรอบของวันส่ง
assert.deepEqual(apPaySchedule("2026-10-28", "ตามรอบ", "30D", undefined, "2026-10-24"),
  { type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05" },
  "30D: ส่ง 24/10 ผ่าน 28/10 → ตัดรอบ 25/10 (เดิมได้ 25/11 · จ่าย 5/01)")
assert.deepEqual(apPaySchedule("2026-10-28", "ตามรอบ", "60D", undefined, "2026-10-24"),
  { type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05" }, "60D ใช้กติกาเดียวกัน")
// เคสที่ผู้ใช้ยก (LAPO26100868): ส่งบัญชี 28/10 → ตัดรอบ 25/11 → จ่าย 5/01/2027 ไม่ว่าผ่านวันไหนของ พ.ย.
for (const passed of ["2026-10-30", "2026-11-20", "2026-11-26", "2026-12-15"]) {
  assert.deepEqual(apPaySchedule(passed, "ตามรอบ", "30D", undefined, "2026-10-28")?.payDate, "2027-01-05", `ผ่าน ${passed}`)
}
assert.deepEqual(longCreditCutoffBase("2026-11-26", "30D", "2026-10-28"), { base: "2026-10-28", from: "sent" })

// ถอยไปใช้วันกดผ่าน
assert.deepEqual(longCreditCutoffBase("2026-10-28", "30D", ""), { base: "2026-10-28", from: "passed" }, "ไม่มีวันส่ง")
assert.deepEqual(longCreditCutoffBase("2026-10-28", "30D", undefined), { base: "2026-10-28", from: "passed" })
assert.deepEqual(longCreditCutoffBase("2026-10-28", "90D", "2026-10-24"), { base: "2026-10-28", from: "passed" }, "90D ไม่อยู่ในนิยามยาว")
assert.deepEqual(longCreditCutoffBase("2026-10-28", "Immediate", "2026-10-24"), { base: "2026-10-28", from: "passed" })
assert.equal(apPaySchedule("2026-10-28", "ตามรอบ", "90D", undefined, "2026-10-24")?.cutoff, "2026-11-25", "90D คิดแบบเดิม")
// รอบของวันส่งจ่ายไปแล้วก่อนบัญชีกดผ่าน → นับจากวันกดผ่าน (ไม่ออกวันจ่ายย้อนหลังเอง แบบเดียวกับเครดิตสั้น)
assert.deepEqual(longCreditCutoffBase("2026-10-10", "30D", "2026-08-20"), { base: "2026-10-10", from: "passed" })
assert.deepEqual(apPaySchedule("2026-10-10", "ตามรอบ", "30D", undefined, "2026-08-20"),
  { type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05" })
// กดผ่านตรงวันจ่ายพอดี = ยังใช้รอบของวันส่ง (จ่ายวันนั้น)
assert.deepEqual(longCreditCutoffBase("2026-10-05", "30D", "2026-08-20"), { base: "2026-08-20", from: "sent" })

// เครดิตสั้น/นอกรอบ ไม่เปลี่ยน
assert.deepEqual(apPaySchedule("2026-08-19", "ตามรอบ", "15D", undefined, "2026-08-17"),
  { type: "ตามรอบ", dueDate: "2026-09-01", cutoff: "", payDate: "2026-08-27" })
assert.deepEqual(apPaySchedule("2026-08-18", "นอกรอบ", "", undefined, "2026-08-10"),
  { type: "นอกรอบ", dueDate: "", cutoff: "", payDate: "2026-08-27" })

// ธง ⚠️ (apPayRecalc): ใบที่ผ่านก่อนกติกานี้ (ไม่มี basis.cutoffFrom) ห้ามขึ้นธงเพราะกติกาใหม่
assert.equal(apPayRecalc({ type: "ตามรอบ", dueDate: "", cutoff: "2026-11-25", payDate: "2027-01-05",
  basis: { passedDate: "2026-10-28", creditTerm: "30D" } }, "2026-10-24"), null, "ใบเก่าไม่ขึ้นธง")
// ใบใหม่ที่คิดตามกติกานี้ = ตรงแล้ว
assert.equal(apPayRecalc({ type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05",
  basis: { passedDate: "2026-10-28", creditTerm: "30D", cutoffFrom: "sent", sentDate: "2026-10-24" } }, "2026-10-24"), null)
// ใช้วันส่งที่เก็บไว้ตอนกดผ่าน ไม่ขยับตาม sentMarkedAt ที่ถูกกดซ้ำทีหลัง
assert.equal(apPayRecalc({ type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05",
  basis: { passedDate: "2026-10-28", creditTerm: "30D", cutoffFrom: "sent", sentDate: "2026-10-24" } }, "2026-11-02"), null)
// ใบใหม่ที่ไม่มีวันส่งตอนผ่าน (cutoffFrom passed, sentDate "") = เทียบด้วยวันกดผ่าน
assert.equal(apPayRecalc({ type: "ตามรอบ", dueDate: "", cutoff: "2026-11-25", payDate: "2027-01-05",
  basis: { passedDate: "2026-10-28", creditTerm: "30D", cutoffFrom: "passed", sentDate: "" } }, "2026-10-24"), null)
// ใบใหม่ที่เลขไม่ตรงกติกา = ขึ้นธงพร้อมค่าที่ถูก
assert.deepEqual(apPayRecalc({ type: "ตามรอบ", dueDate: "", cutoff: "2026-11-25", payDate: "2027-01-05",
  basis: { passedDate: "2026-10-28", creditTerm: "30D", cutoffFrom: "sent", sentDate: "2026-10-24" } }, "2026-10-24"),
  { type: "ตามรอบ", dueDate: "", cutoff: "2026-10-25", payDate: "2026-12-05" })

console.log("check-ap-long-credit-sent: ok")
