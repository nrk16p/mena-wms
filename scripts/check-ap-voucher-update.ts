// npx tsx scripts/check-ap-voucher-update.ts — กติกา "อัปเดต Voucher" ของนำเข้าการตั้งเบิก (ฟังก์ชันล้วน ไม่ต่อฐาน)
import assert from "node:assert/strict"
import { sameDocNoSet, voucherNeedsUpdate } from "../lib/ap-voucher-import"

// เลขต่าง = อัปเดต
assert.equal(voucherNeedsUpdate(["LAPO26100262"], ["LAPO26100300"]), true)
// ระบบยังไม่มีเลข (ผ่านในเว็บ) แต่ไฟล์มี = อัปเดต
assert.equal(voucherNeedsUpdate([], ["LAPO26100300"]), true)
// เลขในไฟล์เป็นชุดย่อย/ชุดใหญ่กว่า = ไม่ตรง = อัปเดต (บันทึกทับด้วยเลขในไฟล์)
assert.equal(voucherNeedsUpdate(["LAPO1", "LAPO2"], ["LAPO1"]), true)
assert.equal(voucherNeedsUpdate(["LAPO1"], ["LAPO1", "LAPO2"]), true)
// ชุดเดียวกัน ต่างแค่ลำดับ/ตัวพิมพ์/ช่องว่าง/ตัวซ้ำ = ไม่อัปเดต
assert.equal(voucherNeedsUpdate(["LAPO2", "LAPO1"], ["lapo1 ", "LAPO2", "LAPO2"]), false)
// ไฟล์ไม่มีเลข = ไม่อัปเดต (ห้ามล้างเลขในระบบ)
assert.equal(voucherNeedsUpdate(["LAPO1"], []), false)
assert.equal(voucherNeedsUpdate(["LAPO1"], ["", "  "]), false)
assert.equal(voucherNeedsUpdate([], []), false)

assert.equal(sameDocNoSet([], []), true)
assert.equal(sameDocNoSet(["A"], []), false)
assert.equal(sameDocNoSet([], ["A"]), false)
assert.equal(sameDocNoSet(["B", "a"], ["A", "b"]), true)

console.log("check-ap-voucher-update: ok")
