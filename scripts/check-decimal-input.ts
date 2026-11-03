// รัน: npx tsx scripts/check-decimal-input.ts
import assert from "node:assert/strict"
import { formatQty, isTypable, parseDecimal } from "../lib/decimal-input"

assert.equal(parseDecimal("2.30"), 2.3)
assert.equal(parseDecimal("2."), 2)          // กำลังพิมพ์ค้าง ต้องไม่หายจุด (ฝั่งช่องเก็บข้อความเอง)
assert.equal(parseDecimal(".5"), 0.5)
assert.equal(parseDecimal("1,100.50"), 1100.5)
assert.equal(parseDecimal(""), null)
assert.equal(parseDecimal("."), null)
assert.equal(parseDecimal("abc"), null)
assert.equal(parseDecimal("2.3.4"), null)
for (const ok of ["", "2", "2.", "2.30", ".5", "1,100.5"]) assert.ok(isTypable(ok), ok)
for (const bad of ["a", "2.3.4", "2-", "1e3", "-1"]) assert.ok(!isTypable(bad), bad)
assert.equal(formatQty(2), "2")
assert.equal(formatQty(2.3), "2.30")
assert.equal(formatQty(2.305), "2.305")
assert.equal(formatQty(2.30567), "2.3057")
assert.equal(formatQty(0), "0")
assert.equal(formatQty(null), "")
console.log("check-decimal-input: ok")
