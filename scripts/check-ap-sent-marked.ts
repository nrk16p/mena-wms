// scripts/check-ap-sent-marked.ts — รัน: npx tsx scripts/check-ap-sent-marked.ts
// วันที่กดส่งบัญชี (sentMarkedAt) = เวลาที่กดส่งครั้งล่าสุด (ผู้ใช้สั่ง 27/10/2026)
// เคส KKDD26090005: เคยส่งแล้ว พี่กุ้งกดส่งอีกรอบ 27/10 13:56 แต่ระบบเก็บเวลากดเดิม → กรองวันนี้ไม่เจอ
import assert from "node:assert/strict"
import { apSentMarkPatch, apLatestSendPress, apSentMarkedRefresh } from "../lib/ap-tracking"

const AT = "2026-10-27T06:56:00.000Z"   // 13:56 เวลาไทย
const BY = "Phatcharaphan Bunngan (Kung)"

// ── ตอนกดบันทึกส่งบัญชี ──
assert.deepEqual(apSentMarkPatch("2026-10-10", false, AT, BY), { sentMarkedAt: AT, sentMarkedBy: BY }, "ส่งครั้งแรก")
assert.deepEqual(apSentMarkPatch("2026-10-10", true, AT, BY), { sentMarkedAt: AT, sentMarkedBy: BY },
  "เคยส่งแล้วกดส่งอีก = นับเป็นวันกดส่งใหม่")
assert.deepEqual(apSentMarkPatch("", true, AT, BY), { sentMarkedAt: "", sentMarkedBy: "" }, "ยกเลิกส่ง = ล้างเวลากด")
assert.deepEqual(apSentMarkPatch("", false, AT, BY), {}, "ล้างใบที่ยังไม่เคยส่ง = ไม่แตะ")

// ── อ่านเวลากดส่งล่าสุดจาก log ──
const log = [
  { action: "ส่งบัญชี (นอกรอบ)", field: "sent", detail: "2026-09-18", by: "A", at: "2026-09-15T03:00:00.000Z" },
  { action: "บัญชีตรวจเอกสาร: ไม่ผ่าน", field: "review", by: "บัญชี", at: "2026-09-16T03:00:00.000Z" },
  { action: "แก้หมายเหตุ", field: "note", by: BY, at: "2026-10-27T06:43:00.000Z" },
  { action: "ส่งบัญชี (ตามรอบ)", field: "sent", detail: "2026-10-10", by: BY, at: AT },
  { action: "แก้หมายเหตุ", field: "note", by: BY, at: "2026-10-27T07:02:00.000Z" },
]
assert.deepEqual(apLatestSendPress(log), { at: AT, by: BY })
assert.equal(apLatestSendPress([]), null)
assert.equal(apLatestSendPress(undefined), null)
assert.equal(apLatestSendPress([{ action: "ยกเลิกส่งบัญชี", field: "sent", at: AT, by: BY }]), null, "ยกเลิกไม่ใช่การกดส่ง")
// ส่งตรวจใหม่หลังตีกลับ ก็ตั้งเวลากดส่งเหมือนกัน (API ทำแบบนี้อยู่แล้ว)
const resub = [...log, { action: "จัดซื้อแก้ไขแล้ว ส่งตรวจใหม่", field: "review", by: "B", at: "2026-10-28T02:00:00.000Z" }]
assert.deepEqual(apLatestSendPress(resub), { at: "2026-10-28T02:00:00.000Z", by: "B" })
// ไม่เชื่อลำดับใน array — เอาเวลาที่ใหม่สุด
assert.deepEqual(apLatestSendPress([log[3], log[0]]), { at: AT, by: BY })

// ── ใบเดิมที่ต้องเติมเวลากดส่งให้ใหม่ (สคริปต์ backfill) ──
const base = { sentDate: "2026-10-10", sentMarkedAt: "2026-09-15T03:00:00.000Z", review: { status: "ไม่ผ่าน" }, paid: null, log }
assert.deepEqual(apSentMarkedRefresh(base), { at: AT, by: BY }, "KKDD26090005: เวลากดค้างของเดิม → ใช้ครั้งล่าสุด")
assert.deepEqual(apSentMarkedRefresh({ ...base, review: { status: "" } }), { at: AT, by: BY }, "รอตรวจ ก็เติม")
assert.equal(apSentMarkedRefresh({ ...base, sentMarkedAt: AT }), null, "ตรงแล้ว ไม่ต้องทำ")
assert.equal(apSentMarkedRefresh({ ...base, sentMarkedAt: "2026-10-29T00:00:00.000Z" }), null, "ฟิลด์ใหม่กว่า log ไม่ถอยหลัง")
assert.deepEqual(apSentMarkedRefresh({ ...base, sentMarkedAt: "" }), { at: AT, by: BY }, "ไม่มีเวลากดเลย ก็เติม")
assert.equal(apSentMarkedRefresh({ ...base, sentDate: "" }), null, "ยกเลิกส่งอยู่ ไม่แตะ")
assert.equal(apSentMarkedRefresh({ ...base, review: { status: "ผ่าน" } }), null, "ผ่านแล้ว ไม่แตะ (กำหนดจ่ายคิดไปแล้ว)")
assert.equal(apSentMarkedRefresh({ ...base, paid: { paymentNos: ["PV1"] } }), null, "จ่ายแล้ว ไม่แตะ")
assert.equal(apSentMarkedRefresh({ ...base, log: [] }), null, "ไม่มี log ให้อ่าน ไม่เดา")

console.log("check-ap-sent-marked: ผ่านทุกข้อ")
