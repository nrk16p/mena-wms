/* ตรวจข้อความ "รอราคา แยกจัดซื้อ → ฟลีท" ในแผงส่งไลน์ (ไม่แตะ DB)
 *   npx tsx scripts/check-repair-quote-wait.ts
 */
import assert from "node:assert"
import {
  BUYERS, BUYER_NES, BUYER_TAI, QUOTE_WAIT_STATUSES, buildQuoteWaitText, groupQuoteWait,
  reportStatusLines, shortSymptom, type DailySummary,
} from "../lib/repair-external"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

const today = "2026-10-02"
const rows = [
  { status: "รถเข้าซ่อมอู่นอก", fleet: "Asia",    fleetNo: "ME071", stageEta: "2026-10-05", symptom: "แอร์ไม่เย็น" },
  // ปี พ.ศ. ในช่องวันที่ (ข้อมูลเก่า) → แปลงเป็น ค.ศ. ก่อนเทียบ · เลยคาดมา 4 วัน
  { status: "จัดทำใบเสนอราคา",  fleet: "Asia",    fleetNo: "ME042", stageEta: "2569-09-28", symptom: "เบรกหน้าไม่อยู่\nเปลี่ยนผ้าเบรก" },
  // ชื่อสถานะเดิมก่อนเปลี่ยนชื่อ (alias) ต้องนับด้วย — รายงานประจำวันนับแบบ normalize
  { status: "รถเข้าอู่ซ่อม",      fleet: "UMO",     fleetNo: "UM15",  stageEta: "",           symptom: "" },
  { status: "รถเข้าซ่อมอู่นอก", fleet: "Cpac ML", fleetNo: "TH1380", stageEta: "2026-10-02", symptom: "ช่วงล่างมีเสียง" },
  { status: "จัดทำใบเสนอราคา",  fleet: "Cpac ML", fleetNo: "TH413",  stageEta: "2026-10-02", symptom: "เกียร์เข้ายาก" },
  { status: "จัดทำใบเสนอราคา",  fleet: "Scco ML", fleetNo: "", plate: "สบ.70-1111", stageEta: "2026-10-03", symptom: "ไฟเตือนเครื่องยนต์" },
  // ไม่รู้ฟลีท → ต่าย · ไปไว้ท้ายสุดของคน
  { status: "รถเข้าซ่อมอู่นอก", fleet: "",        fleetNo: "RX08",   stageEta: "2026-10-04", symptom: "ยางแตก" },
  // สถานะอื่น → ไม่นับ
  { status: "รอ PR",            fleet: "Asia",    fleetNo: "ME001",  stageEta: "2026-10-01", symptom: "x" },
  { status: "แจ้งซ่อมอู่นอก",     fleet: "Cpac ML", fleetNo: "TH999",  stageEta: "2026-10-01", symptom: "x" },
]
const groups = groupQuoteWait(rows)
const nes = groups.find((g) => g.buyer === BUYER_NES)!
const tai = groups.find((g) => g.buyer === BUYER_TAI)!

console.log("จัดกลุ่มรอราคา")
check("ชุดสถานะ = บรรทัด รอราคา ของรายงานประจำวัน", () => {
  assert.deepStrictEqual(QUOTE_WAIT_STATUSES, ["รถเข้าซ่อมอู่นอก", "จัดทำใบเสนอราคา"])
  const line = reportStatusLines(QUOTE_WAIT_STATUSES.map((status) => ({ status, count: 1 })))
  assert.strictEqual(line.length, 1)
  assert.strictEqual(line[0].label, "รอราคา")
})
check("ครบทุกคนตามลำดับ BUYERS แม้ 0 คัน", () => {
  assert.deepStrictEqual(groups.map((g) => g.buyer), BUYERS)
  assert.deepStrictEqual(groupQuoteWait([]).map((g) => g.count), [0, 0])
})
check("เนส = Asia/UMO · ต่าย = ที่เหลือ + ไม่รู้ฟลีท · ยอดรวม 7 (alias นับ, สถานะอื่นไม่นับ)", () => {
  assert.strictEqual(nes.count, 3)
  assert.strictEqual(tai.count, 4)
  assert.deepStrictEqual(nes.fleets.map((f) => f.fleet), ["Asia", "UMO"])
})
check("ฟลีทมากไปน้อย · ไม่ระบุฟลีทท้ายสุด · ไม่มีเบอร์รถใช้ทะเบียน", () => {
  assert.deepStrictEqual(tai.fleets.map((f) => [f.fleet, f.cars.map((c) => c.unit)]), [
    ["Cpac ML", ["TH413", "TH1380"]],
    ["Scco ML", ["สบ.70-1111"]],
    ["", ["RX08"]],
  ])
})
check("รถในฟลีทเรียงวันคาดใกล้สุดก่อน · ปี พ.ศ. แปลงแล้ว · วันเท่ากันเรียงเบอร์แบบตัวเลข", () => {
  assert.deepStrictEqual(nes.fleets[0].cars.map((c) => [c.unit, c.stageEta]), [["ME042", "2026-09-28"], ["ME071", "2026-10-05"]])
  assert.deepStrictEqual(tai.fleets[0].cars.map((c) => c.unit), ["TH413", "TH1380"])
})
check("ไม่ระบุวันคาดไว้ท้ายฟลีท", () => {
  const g = groupQuoteWait([
    { status: "รถเข้าซ่อมอู่นอก", fleet: "Asia", fleetNo: "A1", stageEta: "" },
    { status: "รถเข้าซ่อมอู่นอก", fleet: "Asia", fleetNo: "A2", stageEta: "2026-12-01" },
  ])
  assert.deepStrictEqual(g[0].fleets[0].cars.map((c) => c.unit), ["A2", "A1"])
})

console.log("อาการย่อ")
check("เอาบรรทัดแรก · ยุบช่องว่าง", () => {
  assert.strictEqual(shortSymptom("  เบรกหน้าไม่อยู่   ซ้าย \nเปลี่ยนผ้าเบรก"), "เบรกหน้าไม่อยู่ ซ้าย")
  assert.strictEqual(shortSymptom("\n\n  แอร์ไม่เย็น"), "แอร์ไม่เย็น")
  assert.strictEqual(shortSymptom(undefined), "")
})
check("ยาวเกินตัดด้วย … และไม่ทิ้งสระ/วรรณยุกต์ไว้ครึ่งตัว", () => {
  assert.strictEqual(shortSymptom("abcdefghij", 5), "abcde…")
  // ตัดที่ 4 ตกตรงไม้หันอากาศของ "มั" → ต้องเก็บไม้หันอากาศไว้กับ ม ไม่ให้หลุด
  assert.strictEqual(shortSymptom("น้ำมันรั่ว", 4), "น้ำมั…")
  assert.strictEqual(shortSymptom("x".repeat(40)), "x".repeat(40))
  assert.strictEqual(shortSymptom("x".repeat(41)), `${"x".repeat(40)}…`)
})
check("ตัดหัวที่ไม่ใช่อาการ (- / อู่นอก-CM-) — ข้อมูลจริง UH04 / TH1124", () => {
  assert.strictEqual(shortSymptom("- โม่ทรุด"), "โม่ทรุด")
  assert.strictEqual(shortSymptom("อู่นอก-CM-ระบบไฟ : แอร์ไม่เย็น"), "ระบบไฟ : แอร์ไม่เย็น")
})
check("มีช่องว่างช่วงท้าย → ตัดที่ช่องว่าง ไม่ตัดกลางคำ (ข้อมูลจริง UF95 / NL67)", () => {
  assert.strictEqual(shortSymptom("อาการเกินจากลูกปืนเฟืองท้ายหลังแตก เช็คอาการเพิ่มเติม"), "อาการเกินจากลูกปืนเฟืองท้ายหลังแตก…")
  assert.strictEqual(shortSymptom("หาอู่เข้าซ่อมอาการเบรคแตก เบรคไม่แตก รถเสียงดัง"), "หาอู่เข้าซ่อมอาการเบรคแตก เบรคไม่แตก…")
  // ช่องว่างอยู่ต้น ๆ (ก่อน 60%) → ตัดตรงตัวอักษรตามเดิม ไม่ให้เหลือสั้นเกิน
  assert.strictEqual(shortSymptom("ab cdefghij", 10), "ab cdefghi…")
})

const sum = { date: today, quoteWait: groups } as unknown as DailySummary

console.log("ข้อความส่งไลน์")
check("ทุกคน: คน → ฟลีท → รถ (เบอร์รถ · วันคาด · อาการย่อ) + ลิงก์", () => {
  const t = buildQuoteWaitText(sum, { origin: "https://x" })
  assert.strictEqual(t, [
    "🔧 รอราคา 7 คัน — แยกจัดซื้อและฟลีท · 2/10/2569",
    "(รถเข้าซ่อมอู่นอก + จัดทำใบเสนอราคา)",
    "",
    "👤 คุณเนส : 3 คัน",
    "   🚚 Asia (2)",
    "   • ME042 — คาดเสนอราคาเสร็จ 28/9/2569 ⚠️ เลย 4 วัน · เบรกหน้าไม่อยู่",
    "   • ME071 — คาดเสนอราคาเสร็จ 5/10/2569 · แอร์ไม่เย็น",
    "   🚚 UMO (1)",
    "   • UM15 — ไม่ระบุวันคาดเสนอราคาเสร็จ",
    "",
    "👤 คุณต่าย : 4 คัน",
    "   🚚 Cpac ML (2)",
    "   • TH413 — คาดเสนอราคาเสร็จ 2/10/2569 · เกียร์เข้ายาก",
    "   • TH1380 — คาดเสนอราคาเสร็จ 2/10/2569 · ช่วงล่างมีเสียง",
    "   🚚 Scco ML (1)",
    "   • สบ.70-1111 — คาดเสนอราคาเสร็จ 3/10/2569 · ไฟเตือนเครื่องยนต์",
    "   🚚 ไม่ระบุฟลีท (1)",
    "   • RX08 — คาดเสนอราคาเสร็จ 4/10/2569 · ยางแตก",
    "",
    "🔗 https://x/repair-external",
  ].join("\n"))
})
check("รายคน: เฉพาะคนนั้น ฟลีทเป็นหัวข้อหลัก", () => {
  const t = buildQuoteWaitText(sum, { origin: "", buyer: BUYER_NES })
  assert.strictEqual(t, [
    "🔧 รอราคา — คุณเนส 3 คัน · 2/10/2569",
    "(รถเข้าซ่อมอู่นอก + จัดทำใบเสนอราคา)",
    "",
    "🚚 Asia (2)",
    "• ME042 — คาดเสนอราคาเสร็จ 28/9/2569 ⚠️ เลย 4 วัน · เบรกหน้าไม่อยู่",
    "• ME071 — คาดเสนอราคาเสร็จ 5/10/2569 · แอร์ไม่เย็น",
    "",
    "🚚 UMO (1)",
    "• UM15 — ไม่ระบุวันคาดเสนอราคาเสร็จ",
  ].join("\n"))
  assert.doesNotMatch(t, /TH413/)
})
check("วันคาด = วันนี้ ยังไม่เตือนเลย · ปีผิด (0026) = ไม่ระบุวันคาดเสนอราคาเสร็จ", () => {
  const t = buildQuoteWaitText(sum, { origin: "", buyer: BUYER_TAI })
  assert.match(t, /TH413 — คาดเสนอราคาเสร็จ 2\/10\/2569 · /)
  const bad = groupQuoteWait([{ status: "รถเข้าซ่อมอู่นอก", fleet: "Asia", fleetNo: "Z1", stageEta: "0026-10-05" }])
  assert.match(buildQuoteWaitText({ date: today, quoteWait: bad } as unknown as DailySummary, { origin: "" }), /Z1 — ไม่ระบุวันคาดเสนอราคาเสร็จ/)
})
check("ไม่มีรถรอราคา → ข้อความดี ๆ ไม่ใช่รายการว่าง", () => {
  const none = { date: today, quoteWait: groupQuoteWait([]) } as unknown as DailySummary
  assert.strictEqual(buildQuoteWaitText(none, { origin: "" }), "🎉 ไม่มีรถรอราคา (2/10/2569)")
  assert.strictEqual(buildQuoteWaitText(none, { origin: "", buyer: BUYER_TAI }), "🎉 ไม่มีรถรอราคา — คุณต่าย (2/10/2569)")
})

console.log(`\n${pass} ผ่าน${process.exitCode ? " · มีข้อที่ไม่ผ่าน" : " · ครบทุกข้อ"}`)
