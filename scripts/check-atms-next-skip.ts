// รัน: npx tsx scripts/check-atms-next-skip.ts — การ์ดเทียบ Mena-Next: ปุ่มแย๊กโม่ / ซ่อมเสร็จ ตัดคันที่ขาดออกจากการนับ 2 วัน
import assert from "node:assert/strict"
import { findActiveSkip, isNextSkipReason, nextSkipUntil, type NextSkip } from "../lib/atms-board"

const skip = (x: Partial<NextSkip>): NextSkip => ({
  id: "x", plate: "สบ.71-7388", trucknum: "ME071", mrCode: "LBMR26090883",
  reason: "แย๊กโม่", by: "Tai", at: "2026-10-02T03:00:00.000Z", until: "2026-10-04", ...x,
})
const me071 = { plate: "สบ.71-7388", trucknum: "ME071", mrCode: "LBMR26090883" }

// กด 02/10 → ตัดถึง 04/10 (รวมวันนั้น) กลับมานับ 05/10 · ข้ามเดือน/ปีได้
assert.equal(nextSkipUntil("2026-10-02"), "2026-10-04")
assert.equal(nextSkipUntil("2026-10-30"), "2026-11-01")
assert.equal(nextSkipUntil("2026-12-31"), "2027-01-02")

// ยังไม่พ้น until → ตัด · พ้นแล้ว → กลับมาขาด
assert.equal(findActiveSkip(me071, [skip({ id: "a" })], "2026-10-02")?.id, "a")
assert.equal(findActiveSkip(me071, [skip({ id: "a" })], "2026-10-04")?.id, "a", "วันสุดท้ายยังตัดอยู่")
assert.equal(findActiveSkip(me071, [skip({})], "2026-10-05"), null, "พ้น 2 วันแล้ว")

// MR เปลี่ยน = รถเข้าซ่อมรอบใหม่ → การตัดเดิมไม่ใช้
assert.equal(findActiveSkip({ ...me071, mrCode: "LBMR26100001" }, [skip({})], "2026-10-02"), null)
// ไม่สนช่องว่าง/จุด/ตัวพิมพ์ — ให้ตรงกับ normKey ที่ใช้จับคู่ทั้งการ์ด
assert.equal(findActiveSkip({ plate: "สบ 71-7388", trucknum: "me071", mrCode: "lbmr26090883" }, [skip({ id: "b" })], "2026-10-02")?.id, "b")
// Mena-Next ไม่มี MR ทั้งตอนกดและตอนนี้ → ยังเป็นรอบเดิม
assert.equal(findActiveSkip({ ...me071, mrCode: "" }, [skip({ id: "c", mrCode: "" })], "2026-10-02")?.id, "c")

// จับคู่ด้วยเบอร์รถได้เมื่อทะเบียนใน Mena-Next เปลี่ยนรูปแบบ · คันอื่นไม่โดน
assert.equal(findActiveSkip({ ...me071, plate: "71-7388" }, [skip({ id: "d" })], "2026-10-02")?.id, "d")
assert.equal(findActiveSkip({ plate: "สบ.71-4435", trucknum: "NL21", mrCode: "LBMR26090883" }, [skip({})], "2026-10-02"), null)
// ช่องว่างทั้งคู่ไม่นับว่าตรงกัน
assert.equal(findActiveSkip({ plate: "", trucknum: "", mrCode: "LBMR26090883" }, [skip({ plate: "", trucknum: "" })], "2026-10-02"), null)

// หลายรายการ → ที่กดล่าสุด
assert.equal(findActiveSkip(me071, [
  skip({ id: "old", reason: "แย๊กโม่", at: "2026-10-02T01:00:00.000Z" }),
  skip({ id: "new", reason: "ซ่อมเสร็จ", at: "2026-10-02T05:00:00.000Z" }),
], "2026-10-02")?.id, "new")

// เหตุผลรับเฉพาะ 2 ปุ่มนี้
assert.ok(isNextSkipReason("แย๊กโม่") && isNextSkipReason("ซ่อมเสร็จ"))
assert.ok(!isNextSkipReason("ยกโม่") && !isNextSkipReason("") && !isNextSkipReason(undefined))

console.log("✓ check-atms-next-skip ผ่านทั้งหมด")
