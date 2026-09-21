/* ตรวจข้อความ "รายงานสรุปประจำวัน" + การแยกผู้รับผิดชอบตามฟลีท (ไม่แตะ DB)
 *   npx tsx scripts/check-repair-daily.ts
 */
import assert from "node:assert"
import {
  OWNER_NO_FLEET, buildDailySummaryText, buildNoPrByOwner, fleetsOfOwner,
  ownerLabel, ownerOfFleet, thaiDateShort, type DailySummary,
} from "../lib/repair-external"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

console.log("ผู้รับผิดชอบตามฟลีท")
check("ฟลีทของแต่ละคนตรงตามที่ตกลงไว้", () => {
  assert.strictEqual(ownerOfFleet("Asia"), "เบญ")
  assert.strictEqual(ownerOfFleet("Asia MS"), "เบญ")
  assert.strictEqual(ownerOfFleet("ที.เอ็น.ซีเมนต์บล็อค"), "เบญ")
  assert.strictEqual(ownerOfFleet("Cpac ML"), "กุ้ง")
  assert.strictEqual(ownerOfFleet("Kpac ML"), "กุ้ง")
  assert.strictEqual(ownerOfFleet("UMO"), "กุ้ง")
  assert.strictEqual(ownerOfFleet("Scco ML"), "ติ๊ก")
  assert.strictEqual(ownerOfFleet("Fast"), "ติ๊ก")
  assert.strictEqual(ownerOfFleet("Acon"), "ติ๊ก")
})
check("ฟลีทนอกรายการ/ว่าง → ไม่ระบุผู้รับผิดชอบ", () => {
  for (const f of ["RP", "รถสำนักงาน", "", undefined]) assert.strictEqual(ownerOfFleet(f), OWNER_NO_FLEET)
})
check("เทียบชื่อฟลีทไม่สนตัวพิมพ์/ช่องว่างหัวท้าย", () => {
  assert.strictEqual(ownerOfFleet(" scco ml "), "ติ๊ก")
})
check("ชื่อที่ใช้เรียกในข้อความ", () => {
  assert.strictEqual(ownerLabel("เบญ"), "คุณเบญ")
  assert.strictEqual(ownerLabel(OWNER_NO_FLEET), OWNER_NO_FLEET)
  assert.deepStrictEqual(fleetsOfOwner("กุ้ง"), ["Cpac ML", "Cpac MS", "Kpac ML", "UMO"])
})

console.log("วันที่แบบไทย")
check("21/9/2569", () => {
  assert.strictEqual(thaiDateShort("2026-09-21"), "21/9/2569")
})

console.log("ไม่มี PR แยกตามผู้รับผิดชอบ")
const today = "2026-09-21"
const noPrRows = [
  { _id: "1", fleetNo: "ME004", plate: "สบ.1", fleet: "Asia",    status: "รถเข้าอู่ซ่อม", prCode: "", createdAt: "2026-09-18T01:00:00.000Z" },
  { _id: "2", fleetNo: "ME884", plate: "สบ.2", fleet: "Asia MS", status: "รอ PR",        prCode: "", createdAt: "2026-09-20T01:00:00.000Z" },
  { _id: "3", fleetNo: "TH413", plate: "สบ.3", fleet: "Scco ML", status: "รอ PR",        prCode: "", createdAt: "2026-09-19T01:00:00.000Z" },
  { _id: "4", fleetNo: "RX08",  plate: "สบ.4", fleet: "RP",      status: "รอ PR",        prCode: "", createdAt: "2026-09-19T01:00:00.000Z" },
  { _id: "5", fleetNo: "ME999", plate: "สบ.5", fleet: "Asia",    status: "รถเสร็จ",       prCode: "", createdAt: "2026-09-19T01:00:00.000Z" },
]
check("จัดกลุ่มตามผู้รับผิดชอบ · กลุ่มไม่ระบุอยู่ท้ายสุด · ใบที่ปิดแล้วไม่นับ", () => {
  const g = buildNoPrByOwner(noPrRows, { today, origin: "https://x" })
  assert.deepStrictEqual(g.map((x) => x.creator), ["เบญ", "ติ๊ก", OWNER_NO_FLEET])
  assert.deepStrictEqual(g.map((x) => x.count), [2, 1, 1])
})
check("ข้อความมีชื่อ 'คุณ…' + ฟลีทกำกับรายคัน + ลิงก์ใบงาน", () => {
  const ben = buildNoPrByOwner(noPrRows, { today, origin: "https://x" })[0]
  assert.match(ben.text, /คุณเบญ 2 คัน/)
  assert.match(ben.text, /ME004 · สบ\.1 · Asia/)
  assert.match(ben.text, /https:\/\/x\/repair-external\?id=1/)
})

console.log("ข้อความรายงานสรุปประจำวัน")
const sum: DailySummary = {
  date: today,
  startOfDay: 69, openedToday: 2, closedToday: 2, deferredToday: 1, endOfDay: 68, doneNoPr: 17,
  byStatus: [
    { status: "รอประเมินการซ่อม", count: 0 },
    { status: "รถเข้าอู่ซ่อม", count: 20 },
    { status: "รอ PR", count: 9 },
  ],
  noPr: [
    { owner: "ติ๊ก", count: 3, fleets: [{ fleet: "Scco ML", units: ["TH413", "TH239"] }, { fleet: "Fast", units: ["112"] }] },
    { owner: OWNER_NO_FLEET, count: 1, fleets: [{ fleet: "", units: ["RX08"] }] },
  ],
  urgent: { units: ["ME232", "TH1729"] },
}
const text = buildDailySummaryText(sum, { origin: "https://x" })
check("หัวรายงาน + วันที่แบบไทย", () => {
  assert.match(text, /^📌 รายงานสรุปงานซ่อมอู่นอก ประจำวันที่ 21\/9\/2569/)
})
check("ยอดภาพรวมครบ 5 บรรทัด", () => {
  for (const re of [/🚗 คงค้างต้นวัน : 69 คัน/, /📥 รับแจ้งซ่อมอู่นอกใหม่วันนี้ : 2 คัน/,
                    /✅ ซ่อมเสร็จส่งมอบวันนี้ : 2 คัน/,
                    /📌 คงค้างสิ้นวัน : 68 คัน/, /🏁 ในนี้เสร็จแล้วรอเปิด PR : 17 คัน/]) assert.match(text, re)
})
check("Backlog ลดเมื่อต้นวันมากกว่าสิ้นวัน", () => {
  assert.match(text, /📊 Backlog ลด : 1 คัน/)
})
check("Backlog เพิ่มเมื่องานค้างมากขึ้น", () => {
  const up = buildDailySummaryText({ ...sum, startOfDay: 60, endOfDay: 68 }, { origin: "" })
  assert.match(up, /📊 Backlog เพิ่ม : 8 คัน/)
})
check("ไม่พิมพ์บรรทัดชะลองานซ่อม แม้วันนี้จะมีชะลอ (ผู้ใช้ไม่เอา)", () => {
  assert.ok(!text.includes("ชะลองานซ่อมวันนี้"))
  assert.ok(!buildDailySummaryText({ ...sum, deferredToday: 5 }, { origin: "" }).includes("ชะลองานซ่อม"))
})
check("พิมพ์ครบทุกขั้น รวมขั้นที่ยังเป็น 0 คัน", () => {
  assert.match(text, /\* ⏳ รอประเมินการซ่อม : 0 คัน/)
  assert.match(text, /\* 🔧 รถเข้าอู่ซ่อม : 20 คัน/)
  assert.match(text, /\* ⏰ รอ PR : 9 คัน/)
})
check("ไม่มี PR แยกผู้รับผิดชอบ → ฟลีท พร้อมเลขทะเบียน", () => {
  assert.match(text, /📋 ไม่มี PR 4 คัน — แยกตามผู้รับผิดชอบและฟลีท/)
  assert.match(text, /\* คุณติ๊ก : 3 คัน/)
  assert.match(text, /- Scco ML \(2\) : TH413 \/ TH239/)
  assert.match(text, /- ไม่ระบุฟลีท \(1\) : RX08/)
})
check("แผนติดตามวันถัดไป = เฉพาะงานที่เลยกำหนดเสร็จ", () => {
  assert.match(text, /🎯 แผนติดตามวันถัดไป/)
  assert.match(text, /\* งานที่เลยกำหนดเสร็จแล้ว : 2 คัน/)
  assert.match(text, /ME232 \/ TH1729/)
})
check("ปิดท้ายด้วยลิงก์หน้างาน", () => {
  assert.match(text, /🔗 https:\/\/x\/repair-external$/)
})

console.log(`\n${pass} ผ่าน${process.exitCode ? " · มีข้อที่ไม่ผ่าน" : " · ครบทุกข้อ"}`)
