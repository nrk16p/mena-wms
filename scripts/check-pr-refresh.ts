// scripts/check-pr-refresh.ts — รัน: npx tsx scripts/check-pr-refresh.ts
// ปุ่ม "ดึงข้อมูล ATMS" (lib/pr-refresh.ts): รอ 30 นาที นับเฉพาะรอบดึงเต็ม ไม่นับรอบ PR รายชั่วโมง
import assert from "node:assert/strict"
import { refreshWaitMin, parseRunTime, REFRESH_COOLDOWN_MIN, REFRESH_COUNTED_PIPELINES } from "../lib/pr-refresh"

assert.equal(REFRESH_COOLDOWN_MIN, 30)
assert.ok(REFRESH_COUNTED_PIPELINES.includes("atms_procurement_light"))
assert.ok(REFRESH_COUNTED_PIPELINES.includes("atms_procurement"))
assert.ok(!REFRESH_COUNTED_PIPELINES.includes("atms_pr_quick"), "รอบ PR รายชั่วโมงไม่นับ")

// เวลาใน procurement_runs เป็น string ไม่มี timezone (UTC) — ต้องอ่านเป็น UTC ไม่ใช่เวลาเครื่อง
assert.equal(parseRunTime("2026-10-07T03:09:49.689000"), Date.parse("2026-10-07T03:09:49.689Z"))
assert.equal(parseRunTime("2026-10-07T03:09:49+00:00"), Date.parse("2026-10-07T03:09:49Z"))
assert.equal(parseRunTime(new Date("2026-10-07T03:09:49Z")), Date.parse("2026-10-07T03:09:49Z"))
assert.equal(parseRunTime(null), null)
assert.equal(parseRunTime("ไม่ใช่วันที่"), null)

const last = "2026-10-07T03:00:00"
const at = (min: number) => Date.parse("2026-10-07T03:00:00Z") + min * 60_000
assert.equal(refreshWaitMin(last, at(0)), 30)
assert.equal(refreshWaitMin(last, at(10)), 20)
assert.equal(refreshWaitMin(last, at(29.5)), 1, "เหลือไม่ถึงนาที ปัดเป็น 1")
assert.equal(refreshWaitMin(last, at(30)), 0, "ครบ 30 นาที กดได้")
assert.equal(refreshWaitMin(last, at(66)), 0)
assert.equal(refreshWaitMin(null, at(0)), 0, "ไม่เคยดึง กดได้เลย")

console.log("check-pr-refresh: ok")
