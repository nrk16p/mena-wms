// รัน: npx tsx scripts/check-repair-dates.ts — ปีผิดในช่องวันที่ของใบงานอู่นอก (เคส F014 "645384 วัน" 22/09/2569)
import assert from "node:assert/strict"
import { badDateError, dateYearHint, isPlausibleDate, jobStartDate } from "../lib/repair-external"

// ── ปีที่เป็นไปได้ = ค.ศ. 2000–2100
assert.equal(isPlausibleDate("2026-09-22"), true)
assert.equal(isPlausibleDate("2000-01-01"), true)
assert.equal(isPlausibleDate("2100-12-31"), true)
for (const bad of ["0259-09-22", "0026-08-26", "0001-01-01", "2569-09-17", "1999-12-31", "", "22/09/2026", undefined, null])
  assert.equal(isPlausibleDate(bad), false, String(bad))

// ── วันเริ่มนับอายุงาน: ตัดปีผิดทิ้ง ใช้อีกช่องแทน
assert.equal(jobStartDate({ receivedDate: "2026-09-22", garageInDate: "0259-09-22" }), "2026-09-22", "F014")
assert.equal(jobStartDate({ receivedDate: "0026-08-12", garageInDate: "2026-08-12" }), "2026-08-12")
assert.equal(jobStartDate({ receivedDate: "0001-01-01", garageInDate: "" }), "")
// เดิมยังเหมือนเดิม: คีย์ย้อนหลัง → วันรถเข้าอู่ที่เก่ากว่า
assert.equal(jobStartDate({ receivedDate: "2026-08-07", garageInDate: "2026-05-13" }), "2026-05-13")
assert.equal(jobStartDate({ receivedDate: "2026-08-07" }), "2026-08-07")

// ── คำเตือนใต้ช่อง
assert.equal(dateYearHint(""), null)
assert.equal(dateYearHint("2026-09-22"), null)
assert.deepEqual(dateYearHint("2569-09-17")?.tone, "be")
assert.match(dateYearHint("2569-09-17")!.text, /2569 เป็น พ\.ศ\..*2026/)
assert.equal(dateYearHint("0259-09-22")?.tone, "bad")
assert.match(dateYearHint("0259-09-22")!.text, /ปี 0259 ไม่ถูกต้อง/)
assert.equal(dateYearHint("0001-01-01")?.tone, "bad")

// ── บล็อกตอนบันทึก: เฉพาะค่าที่เพิ่งกรอก/แก้
assert.equal(badDateError({ receivedDate: "2026-09-22", garageInDate: "2026-09-22" }), null)
assert.equal(badDateError({ completedDate: "2569-09-17" }), null, "พ.ศ. ผ่าน — ระบบแปลงให้")
assert.match(badDateError({ garageInDate: "0259-09-22" })!, /วันที่รถเข้าอู่ซ่อม \(ปี 0259\)/)
assert.match(badDateError({ garageInDate: "0259-09-22", stageEta: "0026-10-01" })!, /วันที่รถเข้าอู่ซ่อม \(ปี 0259\) · วันคาดว่าจะพ้นสถานะ \(ปี 0026\)/)
// ใบเก่าที่ผิดอยู่แล้ว (TH1084) — แก้ช่องอื่นได้ ไม่โดนบล็อก
const th1084 = { completedDate: "0001-01-01", note: "" }
assert.equal(badDateError({ completedDate: "0001-01-01", note: "เติมหมายเหตุ" }, th1084), null)
// แต่ถ้าแก้ช่องนั้นเป็นปีผิดค่าใหม่ → บล็อก
assert.match(badDateError({ completedDate: "0026-09-18" }, th1084)!, /วันที่ซ่อมเสร็จ \(ปี 0026\)/)
assert.equal(badDateError({ completedDate: "2026-09-18" }, th1084), null)

console.log("check-repair-dates: ผ่านทั้งหมด")
