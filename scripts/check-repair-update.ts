/* ตรวจกติกา "อัพเดทงาน" ของหน้าอู่นอก — validateJobUpdate() ล้วน ๆ ไม่แตะ DB
 *   npx tsx scripts/check-repair-update.ts
 * ทุกความเคลื่อนไหวต้องมีครบ 3 อย่าง: สถานะ + วันคาดพ้นขั้น + ข้อความ
 */
import assert from "node:assert"
import {
  JOB_TYPE_GARAGE, JOB_TYPE_PARTS, REPAIR_CLAIM_DONE_STATUS, REPAIR_DEFER_STATUS, REPAIR_STATUSES,
  normalizeStatus, openJobConflictFilter, requiredFieldsFor, statusQueryValues,
  UPDATE_NOTE_MIN, validateJobUpdate,
} from "../lib/repair-external"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

const garage = { status: "รถเข้าซ่อมอู่นอก", jobType: JOB_TYPE_GARAGE, garageInDate: "2026-08-01" }
const note   = "อู่แจ้งว่ารออะไหล่จากศูนย์"
const eta    = "2026-08-30"

console.log("ข้อความอัพเดท")
check("ว่าง → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "", current: garage })!.error, /ข้อความ/)
})
check(`สั้นกว่า ${UPDATE_NOTE_MIN} ตัวอักษร → ไม่ผ่าน`, () => {
  assert.ok(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "ok", current: garage }))
})
check("มีแต่ช่องว่าง → ไม่ผ่าน", () => {
  assert.ok(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "     ", current: garage }))
})

console.log("สถานะ")
check("ไม่เลือกสถานะ → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "", stageEta: eta, note, current: garage })!.error, /เลือกสถานะ/)
})
check("เลือกสถานะเดิม + ข้อความ + วันคาด → ผ่าน (ยังค้างขั้นเดิม)", () => {
  assert.strictEqual(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note, current: garage }), null)
})
check("สถานะข้ามประเภทงาน (อะไหล่ลงคันใช้สถานะอู่นอก) → ไม่ผ่าน", () => {
  const parts = { status: "รอดำเนินการ", jobType: JOB_TYPE_PARTS }
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note, current: parts })!.error, /ไม่อยู่ในขั้นตอน/)
})
check("ปิดงานแล้วย้อนสถานะกลับ → ไม่ผ่าน", () => {
  const done = { status: "รถเสร็จ", jobType: JOB_TYPE_GARAGE }
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note, current: done })!.error, /ย้อนสถานะ/)
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

console.log("อัพเดทงานจากหน้ารายละเอียด — แก้ช่องข้อมูลพร้อมกัน (2026-09-17)")
const withEta = { ...garage, stageEta: eta }
check("แก้แค่ช่องข้อมูล (สถานะ/วันคาดเดิม) ไม่มีข้อความ → ผ่าน", () => {
  assert.strictEqual(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "", current: withEta, fields: { driverPhone: "081" }, fieldsChanged: true }), null)
})
check("แก้แค่ช่องข้อมูล ใบเก่าที่ยังไม่มีวันคาด → ผ่าน (ไม่บังคับวันคาด)", () => {
  assert.strictEqual(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: "", note: "", current: garage, fields: { prCode: "PR-1" }, fieldsChanged: true }), null)
})
check("ใบเก่าไม่มีวันคาด + พิมพ์อัพเดทความคืบหน้า → ต้องตอบวันคาด", () => {
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: "", note, current: garage, fields: { prCode: "PR-1" }, fieldsChanged: true })!.error, /คาดว่าจะพ้นสถานะ/)
})
check("แก้ช่องข้อมูล + เปลี่ยนสถานะ ไม่มีข้อความ → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "ซ่อมมีกำหนดเสร็จ", stageEta: eta, note: "", current: withEta, fields: { dueDate: "2026-09-01" }, fieldsChanged: true })!.error, /ข้อความ/)
})
check("แก้ช่องข้อมูล + เปลี่ยนวันคาด (สถานะเดิม) ไม่มีข้อความ → ไม่ผ่าน", () => {
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: "2026-09-05", note: "", current: withEta, fields: { driverPhone: "081" }, fieldsChanged: true })!.error, /ข้อความ/)
})
check("ไม่ได้แก้อะไรเลย ไม่มีข้อความ → ไม่ผ่าน (กติกาเดิมของหน้าต่างอัพเดทงาน)", () => {
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "", current: withEta, fieldsChanged: false })!.error, /ข้อความ/)
})
check("แก้แค่ช่องข้อมูล แต่พิมพ์ข้อความสั้นเกิน → ไม่ผ่าน", () => {
  assert.ok(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note: "ok", current: withEta, fields: { driverPhone: "081" }, fieldsChanged: true }))
})
check("ปิดงานคลิกเดียว: ช่องบังคับกรอกมาพร้อมกันใน fields → ผ่าน", () => {
  const fields = { garageInDate: "2026-08-01", poCode: "PO-1", dueDate: "2026-08-20", completedDate: "2026-08-19", prCode: "PR-1" }
  assert.strictEqual(validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: withEta, fields, fieldsChanged: true }), null)
})
check("ปิดงานคลิกเดียว: fields ยังขาดวันเสร็จ → ไม่ผ่าน + บอกว่าขาดวันเสร็จ", () => {
  const fields = { garageInDate: "2026-08-01", poCode: "PO-1", dueDate: "2026-08-20", completedDate: "", prCode: "PR-1" }
  const r = validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: withEta, fields, fieldsChanged: true })!
  assert.deepStrictEqual(r.missing!.map((m) => m.field), ["completedDate"])
})
check("fields ลบค่าที่ใบงานมีอยู่ (PR ว่าง) ตอนปิดงาน → ไม่ผ่าน", () => {
  const ready = { ...withEta, poCode: "PO-1", dueDate: "2026-08-20", completedDate: "2026-08-19", prCode: "PR-1" }
  const r = validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: ready, fields: { ...ready, prCode: "" }, fieldsChanged: true })!
  assert.ok(r.missing!.some((m) => m.field === "prCode"))
})

console.log("เปลี่ยนชื่อสถานะ (21/09/2569) — ใบเก่าต้องไม่หาย")
check("ชื่อเดิมแปลงเป็นชื่อปัจจุบันอัตโนมัติ", () => {
  assert.strictEqual(normalizeStatus("รอประเมินการซ่อม"), "แจ้งซ่อมอู่นอก")
  assert.strictEqual(normalizeStatus("รอรถเข้า"), "แจ้งซ่อมอู่นอก")
  assert.strictEqual(normalizeStatus("รถเข้าอู่ซ่อม"), "รถเข้าซ่อมอู่นอก")
})
check("กรองด้วยชื่อใหม่ ต้องค้นชื่อเก่าใน DB ด้วย", () => {
  assert.deepStrictEqual(statusQueryValues("แจ้งซ่อมอู่นอก").sort(),
    ["รอประเมินการซ่อม", "รอรถเข้า", "แจ้งซ่อมอู่นอก"].sort())
  assert.deepStrictEqual(statusQueryValues("รถเข้าซ่อมอู่นอก").sort(),
    ["รถเข้าซ่อมอู่นอก", "รถเข้าอู่ซ่อม"].sort())
  assert.deepStrictEqual(statusQueryValues("รอ PR"), ["รอ PR"])
})
check("ใบที่ยังใช้ชื่อเก่า ขยับสถานะได้ปกติ", () => {
  const old = { status: "รถเข้าอู่ซ่อม", jobType: JOB_TYPE_GARAGE, garageInDate: "2026-08-01" }
  assert.strictEqual(validateJobUpdate({ status: "จัดทำใบเสนอราคา", stageEta: eta, note, current: old }), null)
})

console.log("ลำดับขั้น workflow อู่นอก")
const flow = REPAIR_STATUSES.map((s) => s.value)
check("จัดทำใบเสนอราคา อยู่ถัดจาก รถเข้าซ่อมอู่นอก", () => {
  assert.strictEqual(flow[flow.indexOf("รถเข้าซ่อมอู่นอก") + 1], "จัดทำใบเสนอราคา")
})
check("รอ PR อนุมัติ อยู่ถัดจาก รอ PR", () => {
  assert.strictEqual(flow[flow.indexOf("รอ PR") + 1], "รอ PR อนุมัติ")
})
check("จัดทำใบเสนอราคา ไม่มีฟิลด์บังคับของตัวเอง → ขยับเข้าออกได้อิสระ", () => {
  assert.strictEqual(validateJobUpdate({ status: "จัดทำใบเสนอราคา", stageEta: eta, note, current: garage }), null)
})
check("รอ PR อนุมัติ: ยังไม่มี PR ก็ขยับสถานะได้ (บังคับเฉพาะตอนปิดงาน)", () => {
  assert.strictEqual(validateJobUpdate({ status: "รอ PR อนุมัติ", stageEta: eta, note, current: garage }), null)
})
check("ฟิลด์บังคับสะสมตอนปิดเป็น รถเสร็จ — ไม่มีรายการซ้ำ และเรียงตามขั้น", () => {
  assert.deepStrictEqual(requiredFieldsFor("รถเสร็จ", JOB_TYPE_GARAGE).map((f) => f.field),
    ["garageInDate", "poCode", "prCode", "dueDate", "completedDate"])
})

console.log("ปิดงานแบบเคลมอู่ — อู่รับผิดชอบค่าซ่อม ไม่มี PR/PO")
check("ชื่อสถานะตรงกับที่ผู้ใช้เห็นบนหน้าเว็บ", () => {
  assert.strictEqual(REPAIR_CLAIM_DONE_STATUS, "รถเสร็จ(เคลมอู่)")
})
check("เคลมอู่: ใส่แค่วันที่ซ่อมเสร็จ → ผ่าน (ไม่บังคับ PR/PO/วันกำหนดเสร็จ/วันรถเข้าอู่)", () => {
  const fresh = { status: "แจ้งซ่อมอู่นอก", jobType: JOB_TYPE_GARAGE }
  assert.strictEqual(validateJobUpdate({ status: REPAIR_CLAIM_DONE_STATUS, stageEta: "", note, current: fresh, fields: { completedDate: "2026-09-20" }, fieldsChanged: true }), null)
})
check("เคลมอู่: ไม่มีวันที่ซ่อมเสร็จ → ไม่ผ่าน + ขาดแค่วันที่ซ่อมเสร็จ", () => {
  const r = validateJobUpdate({ status: REPAIR_CLAIM_DONE_STATUS, stageEta: "", note, current: garage })!
  assert.deepStrictEqual(r.missing!.map((m) => m.field), ["completedDate"])
})
check("ปิดเคลมอู่แล้วย้อนสถานะกลับ → ไม่ผ่าน (ล็อกเหมือนรถเสร็จ)", () => {
  const done = { status: REPAIR_CLAIM_DONE_STATUS, jobType: JOB_TYPE_GARAGE, completedDate: "2026-09-20" }
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note, current: done })!.error, /ย้อนสถานะ/)
})
check("เคลมอู่ไม่ใช่สถานะของงานอะไหล่ลงคัน → ไม่ผ่าน", () => {
  const parts = { status: "รอดำเนินการ", jobType: JOB_TYPE_PARTS }
  assert.match(validateJobUpdate({ status: REPAIR_CLAIM_DONE_STATUS, stageEta: eta, note, current: parts })!.error, /ไม่อยู่ในขั้นตอน/)
})
check("ของเดิมไม่เปลี่ยน: ปิดเป็น \u201Cรถเสร็จ\u201D ยังบังคับรหัส PR", () => {
  const almost = { ...garage, poCode: "PO-1", dueDate: "2026-08-20", completedDate: "2026-08-19" }
  const r = validateJobUpdate({ status: "รถเสร็จ", stageEta: "", note, current: almost })!
  assert.deepStrictEqual(r.missing!.map((m) => m.field), ["prCode"])
})

console.log("ชะลองานซ่อม — พักงานไว้ ไปอยู่แท็บเดียวกับงานที่ปิดแล้ว")
check("ชะลองานซ่อม: ไม่ต้องกรอกอะไรเพิ่ม → ผ่าน", () => {
  assert.strictEqual(validateJobUpdate({ status: REPAIR_DEFER_STATUS, stageEta: "", note, current: garage }), null)
})
check("ชะลองานซ่อม: ไม่บังคับวันคาดพ้นขั้น (เป็นสถานะจบ)", () => {
  assert.strictEqual(requiredFieldsFor(REPAIR_DEFER_STATUS, JOB_TYPE_GARAGE).length, 0)
})
check("ชะลอแล้วย้อนสถานะกลับ → ไม่ผ่าน (ล็อกเหมือนสถานะจบอื่น)", () => {
  const paused = { status: REPAIR_DEFER_STATUS, jobType: JOB_TYPE_GARAGE }
  assert.match(validateJobUpdate({ status: "รถเข้าซ่อมอู่นอก", stageEta: eta, note, current: paused })!.error, /ย้อนสถานะ/)
})

console.log("กันซ้ำ 1 คัน 1 ใบ — เฉพาะงานอู่นอก")
const car = { plate: "สบ.71-1111", fleetNo: "ME001" }
check("อู่นอก: ได้เงื่อนไขค้นหาใบที่ชน (เฉพาะใบอู่นอกที่ยังไม่ปิด)", () => {
  const f = openJobConflictFilter({ ...car, jobType: JOB_TYPE_GARAGE })!
  assert.ok(f, "ต้องมีเงื่อนไข")
  assert.deepStrictEqual(f.jobType, { $ne: JOB_TYPE_PARTS })
  assert.deepStrictEqual(f.$or, [{ plate: car.plate }, { fleetNo: car.fleetNo }])
})
check("อู่นอก: ใบที่ปิดแล้วไม่นับเป็นใบชน (รวมเคลมอู่ + ชะลองานซ่อม)", () => {
  const f = openJobConflictFilter({ ...car, jobType: JOB_TYPE_GARAGE })!
  const nin = (f.status as { $nin: string[] }).$nin
  for (const s of ["รถเสร็จ", REPAIR_CLAIM_DONE_STATUS, REPAIR_DEFER_STATUS, "ลงคันเสร็จ"]) assert.ok(nin.includes(s), s)
})
check("อะไหล่ลงคัน: ไม่เช็คซ้ำเลย — คันเดียวเปิดได้หลายใบ และซ้ำกับใบอู่นอกได้", () => {
  assert.strictEqual(openJobConflictFilter({ ...car, jobType: JOB_TYPE_PARTS }), null)
})
check("ไม่มีทั้งทะเบียนและเบอร์รถ → ไม่มีอะไรให้ชน", () => {
  assert.strictEqual(openJobConflictFilter({ jobType: JOB_TYPE_GARAGE, plate: " ", fleetNo: "" }), null)
})
check("ใบเก่าที่ไม่มี jobType ถือเป็นอู่นอก → ยังเช็คซ้ำ", () => {
  assert.ok(openJobConflictFilter({ ...car }))
})

console.log(`\n${pass} ผ่าน${process.exitCode ? " · มีข้อที่ไม่ผ่าน" : " · ครบทุกข้อ"}`)
