// scripts/check-vendor-log.ts
// รัน: npx tsx scripts/check-vendor-log.ts   (repo ไม่มี test framework — assert ตามแพตเทิร์น check-vendor-core.ts)
import assert from "node:assert/strict"
import {
  describeVendorLog, codeLabel, fmtLogAt, latestByCode, AP_STATUS_TH,
  type VendorLogRow,
} from "../lib/vendor-log"

// --- codeLabel: รหัสที่ยังอยู่ในทะเบียนต้องอ่านออกเป็นชื่อเต็ม ---
assert.equal(codeLabel("S45"), "S45 · อู่นอก-CM-ระบบโม่")
// รหัสที่ถูกถอดออกจากทะเบียนภายหลัง ประวัติเก่ายังต้องอ่านออก ห้ามกลายเป็นช่องว่าง
assert.equal(codeLabel("S999"), "S999")
assert.equal(codeLabel(undefined), "—")

// --- describeVendorLog: ข้อความ 1 บรรทัดของแต่ละเหตุการณ์ ---
assert.equal(describeVendorLog({ action: "tick", code: "S45" }), "ติ๊ก S45 · อู่นอก-CM-ระบบโม่")
assert.equal(describeVendorLog({ action: "untick", code: "S45" }), "เอาติ๊กออก S45 · อู่นอก-CM-ระบบโม่")
assert.equal(
  describeVendorLog({ action: "status", from: "pending", to: "approved" }),
  `เปลี่ยนสถานะอนุมัติ: ${AP_STATUS_TH.pending} → ${AP_STATUS_TH.approved}`
)
assert.equal(describeVendorLog({ action: "note", to: "รอเอกสาร" }), "แก้หมายเหตุ: รอเอกสาร")
assert.equal(describeVendorLog({ action: "note", to: "" }), "ลบหมายเหตุ")
assert.equal(describeVendorLog({ action: "codes", from: "", to: "S31 S45 S49" }), "ตั้งรายการติ๊กใหม่ทั้งชุด (3 ประเภท)")
// ล้างทั้งชุดต้องไม่กลายเป็น 1 ประเภทเพราะ "".split(" ") คืน [""]
assert.equal(describeVendorLog({ action: "codes", from: "S31", to: "" }), "ตั้งรายการติ๊กใหม่ทั้งชุด (0 ประเภท)")

// --- fmtLogAt: Vercel รัน TZ=UTC ต้องบังคับเวลาไทยเสมอ ไม่งั้นตอนดึกจะโชว์วันก่อนหน้า ---
// 02/09/2026 07:32 UTC = 14:32 เวลาไทย · ปี พ.ศ. 2569 → "69"
const s = fmtLogAt("2026-09-02T07:32:10.000Z")
assert.ok(s.includes("14:32"), `ต้องเป็นเวลาไทย 14:32 แต่ได้ ${s}`)
assert.ok(s.includes("ก.ย."), `ต้องเป็นเดือนไทย แต่ได้ ${s}`)
assert.ok(s.includes("69"), `ต้องเป็นปี พ.ศ. 2 หลัก แต่ได้ ${s}`)
// เที่ยงคืนครึ่งเวลาไทย = 17:30 UTC ของ "เมื่อวาน" — ต้องยังอ่านเป็นวันที่ 3
const midnight = fmtLogAt("2026-09-02T17:30:00.000Z")
assert.ok(midnight.startsWith("3 ก.ย."), `ข้ามวันตามเวลาไทย แต่ได้ ${midnight}`)
assert.equal(fmtLogAt(""), "—")
assert.equal(fmtLogAt("ไม่ใช่วันที่"), "—")

// --- latestByCode: เอาเฉพาะรายการล่าสุดของแต่ละช่อง (รับมาเรียงใหม่→เก่า) ---
const rows: VendorLogRow[] = [
  { vendor: "อู่ ก", action: "untick", code: "S45", by: "บี",  byEmail: "b@x", at: "2026-09-02T03:00:00.000Z" },
  { vendor: "อู่ ก", action: "status", from: "pending", to: "approved", by: "ซี", byEmail: "c@x", at: "2026-09-01T03:00:00.000Z" },
  { vendor: "อู่ ก", action: "tick",   code: "S45", by: "เอ",  byEmail: "a@x", at: "2026-09-01T02:00:00.000Z" },
  { vendor: "อู่ ก", action: "tick",   code: "S31", by: "เอ",  byEmail: "a@x", at: "2026-09-01T01:00:00.000Z" },
]
const latest = latestByCode(rows)
assert.equal(latest.size, 2, "นับเฉพาะช่องที่ติ๊ก ไม่รวมการเปลี่ยนสถานะ")
assert.equal(latest.get("S45")?.by, "บี", "ต้องได้คนล่าสุด ไม่ใช่คนแรกที่ติ๊ก")
assert.equal(latest.get("S45")?.action, "untick")
assert.equal(latest.get("S31")?.by, "เอ")
assert.equal(latest.get("S49"), undefined)

console.log("✓ check-vendor-log ผ่านทั้งหมด")
