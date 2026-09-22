// รัน: npx tsx scripts/check-atms-closed-match.ts — การ์ดเทียบ Mena-Next: รถที่ปิดงานใน WMS แล้วต้องไม่ขึ้นว่า "ขาดในระบบ"
import assert from "node:assert/strict"
import { findClosedMatch, type ClosedWmsJob } from "../lib/atms-board"
import { fixBeYear } from "../lib/repair-external"

const job = (x: Partial<ClosedWmsJob>): ClosedWmsJob =>
  ({ id: "x", mrNo: "", status: "รถเสร็จ", closedAt: "2026-09-22", closedBy: "Tai", ...x })

// เคส NL22: จัดซื้อปิด "รถเสร็จ" แล้ว MR ตรงกับ Mena-Next — จอดตั้งแต่ 21/09
const nl22 = job({ id: "nl22", mrNo: "KKMR26090005" })
assert.equal(findClosedMatch("KKMR26090005", "2026-09-21", [nl22])?.id, "nl22")

// MR ตรง = รอบเดียวกัน แม้ปิดก่อนวันเริ่มจอด (Mena-Next อัปเดตวันจอดทีหลัง)
assert.equal(findClosedMatch("KKMR26090005", "2026-09-25", [nl22])?.id, "nl22")

// ไม่สนช่องว่าง/ตัวพิมพ์ และ MR หลายค่าคั่นด้วย , หรือ /
assert.equal(findClosedMatch("kkmr26090005", "", [job({ id: "a", mrNo: " KKMR26080001, KKMR 26090005 " })])?.id, "a")
assert.equal(findClosedMatch("KKMR26090005", "", [job({ id: "a2", mrNo: "KKMR26080001 KKMR26090005" })])?.id, "a2")
assert.equal(findClosedMatch("KKMR26090005", "", [job({ id: "b", mrNo: "KKMR26080001/KKMR26090005" })])?.id, "b")

// MR ไม่ตรง = คนละรอบซ่อม → ยังขาด (ต้องสร้างใบใหม่)
assert.equal(findClosedMatch("LBMR26090700", "2026-09-07", [job({ mrNo: "LBMR26080100", closedAt: "2026-09-10" })]), null)

// ใบไม่มี MR: นับเฉพาะที่ปิดตั้งแต่วันเริ่มจอดรอบนี้
assert.equal(findClosedMatch("LBMR26090700", "2026-09-07", [job({ id: "c", closedAt: "2026-09-07" })])?.id, "c")
assert.equal(findClosedMatch("LBMR26090700", "2026-09-07", [job({ closedAt: "2026-09-06" })]), null, "ปิดก่อนจอดรอบนี้ = รอบเก่า")
assert.equal(findClosedMatch("LBMR26090700", "", [job({ closedAt: "2026-09-22" })]), null, "ไม่รู้วันเริ่มจอด → ไม่เดา")
assert.equal(findClosedMatch("LBMR26090700", "2026-09-07", [job({ closedAt: "" })]), null)

// หลายใบเข้าเงื่อนไข → ใบที่ปิดล่าสุด · MR ตรงมาก่อนใบไม่มี MR เสมอ
assert.equal(findClosedMatch("M1", "2026-09-01", [
  job({ id: "old", mrNo: "M1", closedAt: "2026-09-02" }),
  job({ id: "new", mrNo: "M1", closedAt: "2026-09-20" }),
  job({ id: "nomr", closedAt: "2026-09-21" }),
])?.id, "new")

// Mena-Next ไม่มี MR → ใช้กติกาใบไม่มี MR เท่านั้น
assert.equal(findClosedMatch("", "2026-09-01", [job({ id: "d", mrNo: "M1" })]), null)
assert.equal(findClosedMatch("", "2026-09-01", [job({ id: "e", closedAt: "2026-09-02" })])?.id, "e")
assert.equal(findClosedMatch("M1", "2026-09-01", []), null)

// ── ปี พ.ศ. ในช่องวันที่ → ค.ศ.
assert.equal(fixBeYear("2569-09-17"), "2026-09-17", "เคส NL22 วันที่ซ่อมเสร็จ")
assert.equal(fixBeYear(" 2569-01-05 "), "2026-01-05")
assert.equal(fixBeYear("2026-09-17"), "2026-09-17")
assert.equal(fixBeYear(""), "")
assert.equal(fixBeYear("2400-01-01"), "1857-01-01")
assert.equal(fixBeYear("2701-01-01"), "2701-01-01", "นอกช่วง พ.ศ. ที่เป็นไปได้ → คืนเดิม")
assert.equal(fixBeYear("17/09/2569"), "17/09/2569", "รูปแบบอื่นไม่แตะ")
assert.equal(fixBeYear("2569-09-17T10:00:00+07:00"), "2026-09-17T10:00:00+07:00")

console.log("check-atms-closed-match: ผ่านทั้งหมด")
