// scripts/check-tire-due-cache.ts — รัน: npx tsx scripts/check-tire-due-cache.ts
// key แคชของ GET /api/tire-due (รายการฝั่งแอดมิน) + ช่วงเวลาพักแจ้งเตือน (epoch)
import assert from "node:assert/strict"
import { tireDueKey, nextSnoozeEnd, type TireDueParams } from "../lib/tire-due-cache"

const p: TireDueParams = { branch: "latkrabang", unit: "", q: "", group: "alert", includeSnoozed: false, countsOnly: false }

// 1. ขึ้นต้นด้วยชื่อ route · ค่าเดิม → key เดิม
assert.ok(tireDueKey(p, null).startsWith("tire-due:"))
assert.equal(tireDueKey({ ...p }, 123), tireDueKey({ ...p }, 123))

// 2. ทุก param ที่เปลี่ยนผล → key ต่างกัน
const variants: TireDueParams[] = [
  { ...p, branch: "saraburi" },
  { ...p, branch: "" },
  { ...p, unit: "head" },
  { ...p, unit: "trailer" },
  { ...p, q: "สบ.71" },
  { ...p, group: "over" },
  { ...p, group: "snoozed" },
  { ...p, group: "spare" },
  { ...p, includeSnoozed: true },
  { ...p, countsOnly: true },
]
const keys = new Set([tireDueKey(p, null), ...variants.map((v) => tireDueKey(v, null))])
assert.equal(keys.size, variants.length + 1, "param ต่างกันต้องได้ key ต่างกัน")

// 3. epoch (เวลาพักที่จะหมดถัดไป) ต่างกัน → key ต่างกัน
assert.notEqual(tireDueKey(p, null), tireDueKey(p, 1000))
assert.notEqual(tireDueKey(p, 1000), tireDueKey(p, 2000))

// 4. ตัวคั่นในค่าไม่ทำให้ key ชนกัน
assert.notEqual(
  tireDueKey({ ...p, branch: "a", q: "b|c" }, null),
  tireDueKey({ ...p, branch: "a|b", q: "c" }, null),
)
assert.notEqual(
  tireDueKey({ ...p, branch: "a\",\"b", q: "" }, null),
  tireDueKey({ ...p, branch: "a", unit: "b" }, null),
)

// 5. nextSnoozeEnd = เวลาพักที่มากกว่า now ตัวที่น้อยที่สุด (ถึงเวลาพอดี = หมดพักแล้ว เหมือน $lte now)
assert.equal(nextSnoozeEnd([], 50), null)
assert.equal(nextSnoozeEnd([300, 100, 200], 50), 100)
assert.equal(nextSnoozeEnd([300, 100, 200], 100), 200)
assert.equal(nextSnoozeEnd([300, 100, 200], 150), 200)
assert.equal(nextSnoozeEnd([300, 100, 200], 299), 300)
assert.equal(nextSnoozeEnd([300, 100, 200], 300), null)
assert.equal(nextSnoozeEnd([100, 100], 99), 100)

console.log("check-tire-due-cache: ok")
