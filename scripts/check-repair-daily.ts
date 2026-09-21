/* ตรวจข้อความ "รายงานสรุปประจำวัน" + การแยกผู้รับผิดชอบตามฟลีท (ไม่แตะ DB)
 *   npx tsx scripts/check-repair-daily.ts
 */
import assert from "node:assert"
import {
  BUYER_NES, BUYER_TAI, OWNER_NO_FLEET, buildDailySummaryText, buildNoPrByOwner, buildNoPrOverviewText,
  buyerOfFleet, fleetsOfOwner,
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

console.log("ผู้รับผิดชอบฝั่งจัดซื้อ")
check("ฟลีทของเนสตามรายการที่ตกลง (รับทั้งชื่อย่อและชื่อจริงในฐานข้อมูล)", () => {
  for (const f of ["Asia", "Asia ML", "Asia MS", "TN", "ที.เอ็น.ซีเมนต์บล็อค", "UMO", "Fast", "Acon", "Kpac", "Kpac ML", "จิรโชติ"])
    assert.strictEqual(buyerOfFleet(f), BUYER_NES, f)
})
check("ฟลีทที่เหลือทั้งหมดเป็นของต่าย รวมที่ไม่ระบุฟลีท", () => {
  for (const f of ["Cpac ML", "Cpac MS", "Scco ML", "Scco MS", "RP", "รถสำนักงาน", "", undefined])
    assert.strictEqual(buyerOfFleet(f), BUYER_TAI, String(f))
})
check("เทียบไม่สนตัวพิมพ์/ช่องว่าง", () => {
  assert.strictEqual(buyerOfFleet(" kpac ml "), BUYER_NES)
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
  startOfDay: 69, openedToday: 2, closedToday: 2, deferredToday: 1, endOfDay: 68,
  closedUnits: ["PU09 (สบ.71-3560)", "ME037 (สบ.71-0001)"],
  deferredUnits: ["TH1979 (สบ.71-2875)"],
  byStatus: [
    { status: "แจ้งซ่อมอู่นอก", count: 2 },
    { status: "รถเข้าซ่อมอู่นอก", count: 20 },
    { status: "จัดทำใบเสนอราคา", count: 21 },
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
check("ยอดภาพรวมครบ 5 บรรทัด และบวกลบลงตัว", () => {
  for (const re of [/🚗 คงค้างต้นวัน : 69 คัน/, /📥 รับแจ้งซ่อมอู่นอกใหม่วันนี้ : 2 คัน/,
                    /✅ ซ่อมเสร็จส่งมอบวันนี้ : 2 คัน/, /⏸️ ชะลองานซ่อมวันนี้ : 1 คัน/,
                    /📌 คงค้างสิ้นวัน : 68 คัน/]) assert.match(text, re)
  assert.ok(!text.includes("รอเปิด PR"))
  assert.strictEqual(sum.startOfDay + sum.openedToday - sum.closedToday - sum.deferredToday, sum.endOfDay)
})
check("รถที่ปิดวันนี้ลิสต์เบอร์รถ (ทะเบียน)", () => {
  assert.match(text, /✅ ซ่อมเสร็จส่งมอบวันนี้ : 2 คัน\n {3}PU09 \(สบ\.71-3560\) \/ ME037 \(สบ\.71-0001\)/)
})
check("รถที่ชะลอวันนี้ลิสต์ทั้งเบอร์รถและทะเบียน", () => {
  assert.match(text, /⏸️ ชะลองานซ่อมวันนี้ : 1 คัน\n {3}TH1979 \(สบ\.71-2875\)/)
})
check("วันที่ไม่มีรถปิด/ชะลอ ไม่ต้องมีบรรทัดรายชื่อ", () => {
  const none = buildDailySummaryText({ ...sum, closedToday: 0, closedUnits: [], deferredToday: 0, deferredUnits: [] }, { origin: "" })
  assert.match(none, /✅ ซ่อมเสร็จส่งมอบวันนี้ : 0 คัน\n⏸️ ชะลองานซ่อมวันนี้ : 0 คัน\n📌/)
})
check("Backlog ลดเมื่อต้นวันมากกว่าสิ้นวัน", () => {
  assert.match(text, /📊 Backlog ลด : 1 คัน/)
})
check("Backlog เพิ่มเมื่องานค้างมากขึ้น", () => {
  const up = buildDailySummaryText({ ...sum, startOfDay: 60, endOfDay: 68 }, { origin: "" })
  assert.match(up, /📊 Backlog เพิ่ม : 8 คัน/)
})
check("วันที่ไม่มีชะลอ ก็ยังพิมพ์บรรทัด 0 คัน (ยอดจะได้ลงตัวทุกวัน)", () => {
  assert.match(buildDailySummaryText({ ...sum, deferredToday: 0 }, { origin: "" }), /⏸️ ชะลองานซ่อมวันนี้ : 0 คัน/)
})
check("ใช้ชื่อเฉพาะของรายงาน และยุบขั้นที่ชื่อเดียวกันเป็นบรรทัดเดียว", () => {
  assert.match(text, /\* ⏳ รอส่ง JR ประเมินงานซ่อม : 2 คัน/)
  assert.match(text, /\* 🔧 รอราคา : 41 คัน/)   // รถเข้าซ่อมอู่นอก 20 + จัดทำใบเสนอราคา 21
  assert.match(text, /\* ⏰ รอ PR : 9 คัน/)
  assert.ok(!text.includes("รถเข้าซ่อมอู่นอก"))
  assert.ok(!text.includes("จัดทำใบเสนอราคา"))
})
check("พิมพ์ทุกขั้นแม้เป็น 0 คัน", () => {
  const zero = buildDailySummaryText({ ...sum, byStatus: [{ status: "แจ้งซ่อมอู่นอก", count: 0 }] }, { origin: "" })
  assert.match(zero, /\* ⏳ รอส่ง JR ประเมินงานซ่อม : 0 คัน/)
})
check("รายงานสรุปไม่มีบล็อกรายชื่อรถที่ไม่มี PR (แยกไปอีกข้อความ)", () => {
  assert.ok(!text.includes("แยกตามผู้รับผิดชอบและฟลีท"))
  assert.ok(!text.includes("TH413"))
})

console.log("ข้อความ 'ไม่มี PR' (แยกส่งต่างหาก)")
const noPrText = buildNoPrOverviewText(sum, { origin: "https://x" })
check("หัวข้อ + จำนวนรวม + วันที่", () => {
  assert.match(noPrText, /^📋 ไม่มี PR 4 คัน — แยกตามผู้รับผิดชอบและฟลีท · 21\/9\/2569/)
})
check("แยกผู้รับผิดชอบ → ฟลีท พร้อมเบอร์รถ", () => {
  assert.match(noPrText, /\* คุณติ๊ก : 3 คัน/)
  assert.match(noPrText, /- Scco ML \(2\) : TH413 \/ TH239/)
  assert.match(noPrText, /- ไม่ระบุฟลีท \(1\) : RX08/)
  assert.match(noPrText, /🔗 https:\/\/x\/repair-external$/)
})
check("ไม่มีงานค้าง PR → ข้อความดี ๆ ไม่ใช่หัวข้อว่าง", () => {
  assert.match(buildNoPrOverviewText({ ...sum, noPr: [] }, { origin: "" }), /🎉 งานอู่นอกมี PR ครบทุกใบแล้ว/)
})
check("แผนติดตามวันถัดไป = รถที่ซ่อมเสร็จแล้วแต่เกินกำหนด", () => {
  assert.match(text, /🎯 แผนติดตามวันถัดไป/)
  assert.match(text, /\* รถเสร็จเกินกำหนด : 2 คัน/)
  assert.match(text, /ME232 \/ TH1729/)
})
check("ปิดท้ายด้วยลิงก์หน้างาน", () => {
  assert.match(text, /🔗 https:\/\/x\/repair-external$/)
})

console.log(`\n${pass} ผ่าน${process.exitCode ? " · มีข้อที่ไม่ผ่าน" : " · ครบทุกข้อ"}`)
