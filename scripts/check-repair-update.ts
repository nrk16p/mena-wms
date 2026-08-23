/* ตรวจกติกา "อัพเดทงาน" ของหน้าอู่นอก — validateJobUpdate() ล้วน ๆ ไม่แตะ DB
 *   npx tsx scripts/check-repair-update.ts
 * ทุกความเคลื่อนไหวต้องมีครบ 3 อย่าง: สถานะ + วันคาดพ้นขั้น + ข้อความ
 */
import assert from "node:assert"
import {
  JOB_TYPE_GARAGE, JOB_TYPE_PARTS, UPDATE_NOTE_MIN, validateJobUpdate,
} from "../lib/repair-external"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

const garage = { status: "รถเข้าอู่ซ่อม", jobType: JOB_TYPE_GARAGE, garageInDate: "2026-08-01" }
const note   = "อู่แจ้งว่ารออะไหล่จากศูนย์"
const eta    = "2026-08-30"

console.log("ข้อความอัพเดท")
check("ว่าง → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note: "", current: garage })!.error, /ข้อความ/)
})
check(`สั้นกว่า ${UPDATE_NOTE_MIN} ตัวอักษร → ไม่ผ่าน`, () => {
  assert.ok(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note: "ok", current: garage }))
})
check("มีแต่ช่องว่าง → ไม่ผ่าน", () => {
  assert.ok(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note: "     ", current: garage }))
})

console.log("สถานะ")
check("ไม่เลือกสถานะ → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "", stageEta: eta, note, current: garage })!.error, /เลือกสถานะ/)
})
check("เลือกสถานะเดิม + ข้อความ + วันคาด → ผ่าน (ยังค้างขั้นเดิม)", () => {
  assert.strictEqual(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note, current: garage }), null)
})
check("สถานะข้ามประเภทงาน (อะไหล่ลงคันใช้สถานะอู่นอก) → ไม่ผ่าน", () => {
  const parts = { status: "รอดำเนินการ", jobType: JOB_TYPE_PARTS }
  assert.match(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note, current: parts })!.error, /ไม่อยู่ในขั้นตอน/)
})
check("ปิดงานแล้วย้อนสถานะกลับ → ไม่ผ่าน", () => {
  const done = { status: "รถเสร็จ", jobType: JOB_TYPE_GARAGE }
  assert.match(validateJobUpdate({ status: "รถเข้าอู่ซ่อม", stageEta: eta, note, current: done })!.error, /ย้อนสถานะ/)
})

console.log("วันคาดพ้นขั้น")
check("สถานะกลางไม่มีวันคาด → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "รอ PR", stageEta: "", note, current: garage })!.error, /คาดว่าจะพ้นสถานะ/)
})
check("สถานะปิดงานไม่ต้องมีวันคาด → ไม่ติดเรื่องวันคาด", () => {
  const ready = {
    status: "ซ่อมมีกำหนดเสร็จ", jobType: JOB_TYPE_GARAGE,
    garageInDate: "2026-08-01", poCode: "PO-1", dueDate: "2026-08-20",
    completedDate: "2026-08-19", prCode: "PR-1",
  }
  assert.strictEqual(validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: ready }), null)
})

console.log("ปิดงาน — ฟิลด์บังคับ")
check("ปิดงานทั้งที่ข้อมูลไม่ครบ → ไม่ผ่าน + บอกฟิลด์ที่ขาด", () => {
  const r = validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: garage })!
  assert.ok(r.missing && r.missing.length > 0, "ต้องคืนรายการฟิลด์ที่ขาด")
  assert.ok(r.missing!.some((m) => m.field === "prCode"), "ต้องมี prCode ในรายการที่ขาด")
})
check("อะไหล่ลงคัน: ปิดงานครบฟิลด์ → ผ่าน", () => {
  const parts = {
    status: "ของถึง-รอลงคัน", jobType: JOB_TYPE_PARTS,
    poCode: "PO-9", dueDate: "2026-08-10", completedDate: "2026-08-12",
  }
  assert.strictEqual(validateJobUpdate({ status: "ลงคันเสร็จ", stageEta: "", note, current: parts }), null)
})

console.log(`\n${pass} ผ่าน${process.exitCode ? " · มีข้อที่ไม่ผ่าน" : " · ครบทุกข้อ"}`)
