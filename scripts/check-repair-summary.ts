// รัน: npx tsx scripts/check-repair-summary.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import { buildRepairSummary } from "../lib/repair-external"

// เคสเต็มตามตัวอย่างจริงที่ผู้ใช้ให้มา — ต้องได้ตรงทุกอักขระ
const full = buildRepairSummary({
  fleetNo: "UH24",
  brand: "ISUZU",
  model: "FXZ77NXFZQ/360",
  driverName: "ปภังกร กาบคำ",
  driverPhone: "088-266-9653",
  symptom: "แอร์ไม่เย็น",
  note: "เคยเข้าล้างแอร์อู่ช่างหล้า 17/7/26",
  plant: "เชียงราย",
  cementStatus: "ไม่มีปูน",
  drivableStatus: "วิ่งได้",
})
assert.equal(full, [
  "(car) เบอร์รถ UH24 /ISUZU FXZ77NXFZQ/360",
  "(earth) ชื่อ ปภังกร กาบคำ",
  "(sun) เบอร์ 088-266-9653",
  "(ambulance) แอร์ไม่เย็น",
  "เคยเข้าล้างแอร์อู่ช่างหล้า 17/7/26",
  "(tool) แพล้นเชียงราย",
  "(money) ไม่มีปูน / รถวิ่งเข้าอู่ได้",
].join("\n"))

// ไม่มีข้อมูลเลย → ข้อความว่าง (ผู้เรียกต้องเตือนแทนที่จะคัดลอกค่าว่าง)
assert.equal(buildRepairSummary({}), "")

// รถไม่อยู่ใน vehicle_master → เหลือแค่เบอร์รถ ไม่มี " /" ค้าง
assert.equal(buildRepairSummary({ fleetNo: "UH24" }), "(car) เบอร์รถ UH24")

// มียี่ห้อแต่ไม่มีรุ่น (และกลับกัน) — ต้องไม่มีช่องว่างเกิน
assert.equal(buildRepairSummary({ fleetNo: "UH24", brand: "ISUZU" }), "(car) เบอร์รถ UH24 /ISUZU")
assert.equal(buildRepairSummary({ fleetNo: "UH24", model: "FXZ77NXFZQ/360" }), "(car) เบอร์รถ UH24 /FXZ77NXFZQ/360")

// ช่องว่างล้วนถือว่าว่าง — ห้ามได้ "(sun) เบอร์ " ลอย ๆ เข้ากลุ่มไลน์
assert.equal(buildRepairSummary({ driverPhone: "   ", symptom: "แอร์ไม่เย็น" }), "(ambulance) แอร์ไม่เย็น")

// ไม่มีเบอร์รถ แต่มีอย่างอื่น → ยังสรุปได้ ไม่ใช่ค่าว่าง
assert.equal(buildRepairSummary({ driverName: "สมชาย" }), "(earth) ชื่อ สมชาย")

// บรรทัดท้าย: มีปูนอย่างเดียว / วิ่งไม่ได้อย่างเดียว / ทั้งคู่
assert.equal(buildRepairSummary({ cementStatus: "มีปูน" }), "(money) มีปูน")
assert.equal(buildRepairSummary({ drivableStatus: "วิ่งไม่ได้" }), "(money) รถวิ่งเข้าอู่ไม่ได้")
assert.equal(buildRepairSummary({ cementStatus: "มีปูน", drivableStatus: "วิ่งไม่ได้" }), "(money) มีปูน / รถวิ่งเข้าอู่ไม่ได้")

// ค่า drivableStatus ที่ไม่รู้จักต้องถูกทิ้ง ไม่ใช่พิมพ์ดิบลงไลน์
assert.equal(buildRepairSummary({ drivableStatus: "ค่าแปลก" }), "")
assert.equal(buildRepairSummary({ cementStatus: "ไม่มีปูน", drivableStatus: "ค่าแปลก" }), "(money) ไม่มีปูน")

// หมายเหตุหลายบรรทัดต้องคงรูป (คนพิมพ์เอง)
assert.equal(
  buildRepairSummary({ symptom: "แอร์ไม่เย็น", note: "เคยล้างแอร์ 17/7/26\nอู่ช่างหล้า" }),
  "(ambulance) แอร์ไม่เย็น\nเคยล้างแอร์ 17/7/26\nอู่ช่างหล้า",
)

console.log("✅ สรุปแจ้งซ่อม ผ่านทั้งหมด")
