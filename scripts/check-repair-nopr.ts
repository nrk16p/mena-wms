// รัน: npx tsx scripts/check-repair-nopr.ts — ข้อความส่งไลน์ "งานที่ยังไม่มี PR แยกตามคนสร้าง"
import assert from "node:assert/strict"
import { buildNoPrByCreator, creatorShortName } from "../lib/repair-external"

const ORIGIN = "https://mena-wms.vercel.app"
const TODAY  = "2026-09-17"
const rows = [
  // Ben 2 คัน — createdAt เป็นเวลา UTC: 2026-08-13T20:00Z = 14 ส.ค. เวลาไทย → รอ 34 วัน
  { _id: "a1", createdBy: "Ben", createdAt: "2026-08-13T20:00:00.000Z", fleetNo: "ME104", plate: "สบ.71-8639", status: "รถเข้าอู่ซ่อม", prCode: "" },
  { _id: "a2", createdBy: "Ben", createdAt: "2026-09-10T03:00:00.000Z", fleetNo: "",      plate: "สบ.70-6305", status: "รอประเมินการซ่อม" },
  // เคยมี PR แล้วถูกลบวันนี้ 20:48 เวลาไทย (noPrSince จาก log) → ไม่มี PR 0 วัน แต่เปิดงานมา 35 วัน (กรณี TH1141)
  { _id: "a3", createdBy: "Ben", createdAt: "2026-08-13T07:49:11.943Z", noPrSince: "2026-09-17T13:48:50.366Z", fleetNo: "TH1141", plate: "สบ.71-4431", status: "รอ PR", prCode: "" },
  // Blue 1 คัน
  { _id: "b1", createdBy: "Blue", createdAt: "2026-09-16T01:00:00.000Z", fleetNo: "UH24", plate: "", status: "รถเสร็จ(ไม่มี PR)", prCode: "  " },
  // ไม่นับ: มี PR แล้ว / ปิดงานแล้ว
  { _id: "x1", createdBy: "Ben", createdAt: "2026-08-01T01:00:00.000Z", fleetNo: "ME001", status: "รถเข้าอู่ซ่อม", prCode: "PR-1" },
  { _id: "x2", createdBy: "Blue", createdAt: "2026-08-01T01:00:00.000Z", fleetNo: "ME002", status: "รถเสร็จ", prCode: "" },
  // ไม่มีคนสร้าง + ไม่มี createdAt (ใบเก่า) → ใช้วันเริ่มงานแทน
  { _id: "c1", fleetNo: "ME300", status: "รอ PR", receivedDate: "2026-09-07", garageInDate: "2026-09-05" },
]

const groups = buildNoPrByCreator(rows, { today: TODAY, origin: ORIGIN })

// เรียงคนที่ค้างมากสุดก่อน · ชื่อเท่ากันจำนวนเท่ากันเรียงตามชื่อ
assert.deepEqual(groups.map((g) => [g.creator, g.count]), [["Ben", 3], ["Blue", 1], ["ไม่ระบุคนสร้าง", 1]])

const ben = groups[0]
assert.equal(ben.maxDays, 34)
assert.equal(ben.avgDays, 14, "(34 + 7 + 0) / 3 = 13.7 → ปัดเป็น 14 — นับวันไม่มี PR ไม่ใช่อายุงาน")
assert.equal(ben.text, [
  "📋 งานที่ยังไม่มี PR — Ben 3 คัน",
  "⏱️ ไม่มี PR เฉลี่ย 14 วัน · นานสุด 34 วัน",
  "━━━━━━━━━━━━━━",
  "1. ME104 · สบ.71-8639 — ไม่มี PR 34 วัน (🔧 รถเข้าอู่ซ่อม)",
  `${ORIGIN}/repair-external?id=a1`,
  "2. สบ.70-6305 — ไม่มี PR 7 วัน (⏳ รอประเมินการซ่อม)",
  `${ORIGIN}/repair-external?id=a2`,
  "3. TH1141 · สบ.71-4431 — ไม่มี PR 0 วัน · เปิดงาน 35 วัน (⏰ รอ PR)",
  `${ORIGIN}/repair-external?id=a3`,
  "",
  "📌 กดลิงก์ → ใส่รหัส PR → กด “อัพเดทงาน”",
].join("\n"))

// PR ที่มีแต่ช่องว่าง = ยังไม่มี PR · ต้องไม่นับติดลบเมื่อสร้างวันนี้/อนาคต
assert.equal(groups[1].maxDays, 1)
assert.match(groups[1].text, /1\. UH24 — ไม่มี PR 1 วัน \(/)

// ใบเก่าไม่มี createdAt → วันเริ่มงาน = min(receivedDate, garageInDate) = 5 ก.ย. → 12 วัน
assert.equal(groups[2].maxDays, 12)

assert.deepEqual(buildNoPrByCreator([], { today: TODAY, origin: ORIGIN }), [])

// ชื่อสั้นบนปุ่ม — ใช้ชื่อเล่นในวงเล็บท้ายชื่อ ไม่มีวงเล็บใช้คำแรก
assert.equal(creatorShortName("Jeeraporn Ployprasert (Ben)"), "Ben")
assert.equal(creatorShortName("Sathianpong Cha-amjan (Bew) "), "Bew")
assert.equal(creatorShortName("สมชาย ใจดี"), "สมชาย")
assert.equal(creatorShortName("ไม่ระบุคนสร้าง"), "ไม่ระบุคนสร้าง")
assert.equal(creatorShortName(""), "")

console.log("✅ ไม่มี PR แยกตามคนสร้าง ผ่านทั้งหมด")
