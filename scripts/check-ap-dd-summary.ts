// scripts/check-ap-dd-summary.ts
// รัน: npx tsx scripts/check-ap-dd-summary.ts — แท็บ "สรุป DD" (ดึงเลข DD จากข้อความที่วาง + ข้อความไลน์)
// แยกจาก check-ap-tracking.ts เพราะไฟล์นั้นยังพังค้างที่บรรทัด 268 (คาดผลสูตรเก่าก่อน 2527491)
// ถ้าวางไว้ท้ายไฟล์นั้น assert ข้างบนจะหยุดสคริปต์ก่อนถึงเทสต์ชุดนี้ = ไม่เคยได้รันจริง
import assert from "node:assert/strict"
import { AP_DD_SUMMARY_MAX, apDdSummaryText, parseDdList, type ApDdSummaryItem } from "../lib/ap-tracking"

// --- parseDdList: วางมาแบบไหนก็ได้ คงลำดับที่วาง ตัดเลขซ้ำ ---
assert.deepEqual(parseDdList("LBDD26081175\nLBDD26081169\r\nLBDD26081223"),
  ["LBDD26081175", "LBDD26081169", "LBDD26081223"], "บรรทัดละใบ (รวม CRLF จาก Excel)")
assert.deepEqual(parseDdList(" LBDD26081175 , lbdd26081169\tSBDD26080298 "),
  ["LBDD26081175", "LBDD26081169", "SBDD26080298"], "คอมมา/แท็บ/ตัวพิมพ์เล็ก")
assert.deepEqual(parseDdList("LBDD26081175\nLBDD26081175\nLBDD26080265"),
  ["LBDD26081175", "LBDD26080265"], "เลขซ้ำเหลือตัวแรก")
assert.deepEqual(parseDdList("1. LBDD26081175 (ยาง)\n2. PO LBPO26080001"), ["LBDD26081175"], "ไม่จับเลข PO/เลขลำดับ")
assert.deepEqual(parseDdList(""), [])
assert.equal(AP_DD_SUMMARY_MAX, 200)

// --- apDdSummaryText: ตรงกับตัวอย่างที่ผู้ใช้เลือก (บล็อกละใบ · 11/09/2026) ---
const a: ApDdSummaryItem = {
  depositCode: "LBDD26081175", receivedAt: "2026-08-20", supplier: "หจก.ตัวอย่างการช่าง",
  vehicle: "71-5742", fleetNo: "153", amount: 12345, creditTerm: "30D", payDate: "2026-11-05",
}
const b: ApDdSummaryItem = {
  depositCode: "LBDD26080265", receivedAt: "2026-08-05", supplier: "หจก.ตัวอย่างการช่าง",
  amount: 3100, creditTerm: "7D", paidDate: "2026-08-27",
}
assert.equal(apDdSummaryText([a, b], "2026-09-11"), [
  "📋 สรุปใบรับของ (DD) · 11 ก.ย. 69",
  "🏢 หจก.ตัวอย่างการช่าง",
  "",
  "📦 LBDD26081175 · รับ 20 ส.ค. 69",
  "🚚 71-5742 · เบอร์ 153",
  "💰 12,345.00 บาท · เครดิต 30D",
  "📅 กำหนดจ่าย 5 พ.ย. 69",
  "",
  "📦 LBDD26080265 · รับ 5 ส.ค. 69",
  "💰 3,100.00 บาท · เครดิต 7D",
  "✅ จ่ายแล้ว 27 ส.ค. 69",
  "",
  "🧾 รวม 2 ใบ · 15,445.00 บาท",
].join("\n"), "ตัวอย่างที่ผู้ใช้เลือก — ใบที่ไม่มีทะเบียน/กำหนดจ่าย บรรทัดนั้นหายไป")

// ข้อมูลไม่ครบ → ตัดเฉพาะส่วนที่ไม่มี ไม่ใส่ "—"
const bare: ApDdSummaryItem = { depositCode: "KKDD26080009", receivedAt: "", supplier: "ร้านเอ", amount: 50, creditTerm: "" }
const bareText = apDdSummaryText([bare], "2026-09-11")
assert.ok(bareText.includes("\n📦 KKDD26080009\n"), "ไม่มีวันรับ = ไม่มี · รับ")
assert.ok(bareText.includes("\n💰 50.00 บาท\n"), "ไม่มีเครดิตเทอม = ไม่มี · เครดิต")
assert.ok(!bareText.includes("🚚") && !bareText.includes("📅") && !bareText.includes("✅"), "ไม่มีรถ/กำหนดจ่าย/จ่ายจริง")
assert.ok(!bareText.includes("—"), "ห้ามมีขีดแทนค่าว่างในข้อความไลน์")

// รถ: มีแค่ทะเบียน / มีแค่เบอร์
assert.ok(apDdSummaryText([{ ...bare, vehicle: "71-5742" }], "2026-09-11").includes("\n🚚 71-5742\n"))
assert.ok(apDdSummaryText([{ ...bare, fleetNo: "153" }], "2026-09-11").includes("\n🚚 เบอร์ 153\n"))

// มีทั้งกำหนดจ่ายและจ่ายแล้ว — โชว์ทั้งคู่ (กำหนดก่อน จ่ายจริงตามหลัง)
const both = apDdSummaryText([{ ...bare, payDate: "2026-09-03", paidDate: "2026-09-03" }], "2026-09-11")
assert.ok(both.includes("\n📅 กำหนดจ่าย 3 ก.ย. 69\n✅ จ่ายแล้ว 3 ก.ย. 69\n"))

// หลายเจ้า — จัดกลุ่มตามเจ้า เรียงตามเจ้าที่โผล่ก่อนในรายการที่วาง · ในกลุ่มคงลำดับเดิม
const x1 = { ...bare, depositCode: "LBDD00000001", supplier: "เจ้า A" }
const x2 = { ...bare, depositCode: "LBDD00000002", supplier: "เจ้า B" }
const x3 = { ...bare, depositCode: "LBDD00000003", supplier: "เจ้า A" }
const multi = apDdSummaryText([x1, x2, x3], "2026-09-11").split("\n")
const at = (s: string) => multi.indexOf(s)
assert.ok(at("🏢 เจ้า A") < at("📦 LBDD00000001") && at("📦 LBDD00000001") < at("📦 LBDD00000003"))
assert.ok(at("📦 LBDD00000003") < at("🏢 เจ้า B") && at("🏢 เจ้า B") < at("📦 LBDD00000002"))
assert.equal(multi.filter((l) => l.startsWith("🏢")).length, 2, "หัวเจ้าละครั้งเดียว")
assert.equal(multi[multi.length - 1], "🧾 รวม 3 ใบ · 150.00 บาท")

// ไม่มีชื่อเจ้า / ไม่มีรายการ
assert.ok(apDdSummaryText([{ ...bare, supplier: "" }], "2026-09-11").includes("🏢 (ไม่ระบุเจ้าหนี้)"))
assert.equal(apDdSummaryText([], "2026-09-11"), "", "ไม่มีใบ = ไม่มีอะไรให้คัดลอก")

console.log("✅ สรุป DD ผ่านทั้งหมด")
