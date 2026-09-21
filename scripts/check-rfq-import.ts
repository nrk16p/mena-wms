// scripts/check-rfq-import.ts — รัน: npx tsx scripts/check-rfq-import.ts
// สร้างเทมเพลต → อ่านกลับ → แปลง ต้องได้ค่าเดิม + เคสที่อู่กรอกมือ (ไม่แตะ DB)
import assert from "node:assert/strict"
import { buildRfqTemplate } from "../lib/rfq-template-xlsx"
import { sheetsFromBuffer } from "../lib/rfq-xlsx-read"
import { parseTemplate, checkMeta, JOB_COLS, PART_COLS, SEC_LABOUR, SEC_PARTS, RATE_LABEL, RATE_ONSITE_LABEL, META_SHEET } from "../lib/rfq-import"
import { validateAnswer, validatePartAnswer, validateRate, partKey, type RfqInvite, type RfqJob, type RfqPart } from "../lib/rfq-core"

const TOKEN = "TESTtoken0123456789abcd"
const J = (sheet: string, jobCode: string, seq: number, name: string): RfqJob =>
  ({ sheet, sheetTitle: "ระบบโม่ผสม (Mixer)", seq, jobCode, name, scope: "ขอบเขต…", tierCriteria: "", refHoursL: 2, refHoursS: 1.5, version: 2, active: true })
const P = (sheet: string, sku: string, seq: number): RfqPart =>
  ({ sheet, sheetTitle: "ระบบโม่ผสม (Mixer)", seq, sku, name: `อะไหล่ ${sku}`, useWith: "L+S", unit: "ชิ้น", version: 2, active: true })
const jobs = [J("S45", "MXS-A", 1, "งาน A"), J("S45", "MXS-B", 2, "งาน B"), J("S45", "MXS-C", 3, "งาน C")]
const parts = [P("S45", "LB01", 1), P("S45", "LB02", 2)]
const now = new Date().toISOString()
const invite = (over: Partial<RfqInvite> = {}): RfqInvite => ({
  _id: "x", token: TOKEN, vendor: "อู่ทดสอบ", sheets: ["S45"], sections: ["labour", "parts"], catalogVersion: 2,
  title: "รอบทดสอบ", deadline: "2026-12-31", status: "กำลังกรอก",
  contact: { name: "ช่างเอ", phone: "081", email: "", confirmedVendor: true, at: now }, openedAt: now, profile: null,
  items: {}, parts: {}, rates: {}, submittedAt: null, submitNote: "", confirm: null, returnNote: "",
  createdBy: { name: "จัดซื้อ", email: "" }, createdAt: now, updatedAt: now, ...over,
})

void (async () => {
  // ── 1) ไป-กลับ: ใบที่กรอกในเว็บแล้ว → เทมเพลตพรีฟิล → อ่านกลับได้ค่าเดิม ───────────
  const filled = invite({
    rates: { S45: { normal: 450, onsite: 600, at: now } },
    items: {
      "MXS-A": { mode: "hours", L: { hours: 2 }, S: { hours: 2 }, sameAsL: true, warrantyMonths: 3, note: "ทดสอบ", at: now },
      "MXS-B": { mode: "hours", L: { hours: 4 }, S: { hours: 2.5 }, sameAsL: false, note: "", at: now },
      "MXS-C": { mode: "skip", L: {}, S: {}, sameAsL: true, note: "ไม่มีเครื่องมือ", at: now },
    },
    parts: { [partKey("S45", "LB01")]: { skip: false, priceL: 1200, priceS: 900, sameAsL: false, brand: "OEM", warrantyMonths: 6, leadDays: 7, note: "", at: now } },
  })
  const buf = await buildRfqTemplate(filled, jobs, parts)
  const sheets = sheetsFromBuffer(buf)
  assert.ok(sheets[META_SHEET], "มีชีต _meta ติดมาด้วย")
  const back = parseTemplate(sheets, TOKEN, ["S45"], jobs, parts)
  assert.notEqual(typeof back, "string", String(back))
  if (typeof back !== "string") {
    assert.deepEqual(back.rates.S45, { normal: 450, onsite: 600 }, "อัตราไป-กลับตรง")
    const a = validateAnswer(back.items["MXS-A"])
    assert.notEqual(typeof a, "string", String(a))
    if (typeof a !== "string") { assert.equal(a.L.hours, 2); assert.equal(a.S.hours, 2); assert.equal(a.sameAsL, true); assert.equal(a.warrantyMonths, 3); assert.equal(a.note, "ทดสอบ") }
    const b = validateAnswer(back.items["MXS-B"])
    if (typeof b !== "string") { assert.equal(b.L.hours, 4); assert.equal(b.S.hours, 2.5); assert.equal(b.sameAsL, false, "S ต่างจาก L → ไม่ใช่ราคาเดียวกัน") }
    const c = validateAnswer(back.items["MXS-C"])
    if (typeof c !== "string") assert.equal(c.mode, "skip", "ติ๊ก x = ไม่รับงาน")
    assert.equal((back.parts[partKey("S45", "LB01")] as { priceL: unknown }).priceL, 1200)
    assert.equal(back.counts.items, 3); assert.equal(back.counts.parts, 1); assert.equal(back.counts.rates, 1)
    assert.deepEqual(back.problems, [])
  }

  // ── 2) ใบเปล่า: เทมเพลตไม่มีค่าอะไรเลย → ต้องบอกว่าไม่พบข้อมูลที่กรอก ─────────────
  const blank = sheetsFromBuffer(await buildRfqTemplate(invite(), jobs, parts))
  assert.match(String(parseTemplate(blank, TOKEN, ["S45"], jobs, parts)), /ไม่พบข้อมูลที่กรอก/)

  // ── 3) อู่กรอกมือ: สลับคอลัมน์ · เว้นว่าง · รหัสมั่ว · ชั่วโมงเกิน · ตัวเลขผิด ──────────
  const H = [...JOB_COLS], PH = [...PART_COLS]
  const rowOf = (head: string[], vals: Record<string, unknown>) => head.map((h) => vals[h] ?? "")
  const manual: Record<string, unknown[][]> = {
    [META_SHEET]: [["token", TOKEN], ["catalogVersion", 2]],
    "S45 ระบบโม่ผสม (Mixer)": [
      ["ใบขอราคา — S45"], [SEC_LABOUR], [RATE_LABEL, "500", RATE_ONSITE_LABEL, ""],
      H,
      rowOf(H, { "รหัสงาน": "MXS-A", "ชม. Mixer L": "3" }),                                  // S ว่าง = เท่ากับ L
      rowOf(H, { "รหัสงาน": "MXS-B" }),                                                        // ว่างทั้งแถว = ไม่แตะของเดิม
      rowOf(H, { "รหัสงาน": "MXS-C", "ชม. Mixer L": "9999" }),                                 // เกินเพดาน
      rowOf(H, { "รหัสงาน": "ไม่มีรหัสนี้", "ชม. Mixer L": "1" }),
      [], [SEC_PARTS], PH,
      rowOf(PH, { "รหัสอะไหล่": "LB01", "฿ Mixer L": "1,250", "ยี่ห้อ/สเปกที่เสนอ": "NOK" }),   // มีลูกน้ำ
      rowOf(PH, { "รหัสอะไหล่": "LB02", "ไม่มีจำหน่าย (x)": "x" }),
      rowOf(PH, { "รหัสอะไหล่": "LB02x", "฿ Mixer L": "abc" }),
    ],
    "S99 ชีตที่ไม่ได้ให้": [[SEC_LABOUR], H, rowOf(H, { "รหัสงาน": "ZZZ", "ชม. Mixer L": "5" })],
  }
  const m = parseTemplate(manual, TOKEN, ["S45"], jobs, parts)
  assert.notEqual(typeof m, "string", String(m))
  if (typeof m !== "string") {
    assert.deepEqual(validateRate(m.rates.S45).valueOf() && { normal: (validateRate(m.rates.S45) as { normal?: number }).normal, onsite: (validateRate(m.rates.S45) as { onsite?: number }).onsite }, { normal: 500, onsite: undefined }, "นอกสถานที่ว่าง = ไม่รับงานนอกสถานที่")
    const a = validateAnswer(m.items["MXS-A"])
    if (typeof a !== "string") { assert.equal(a.L.hours, 3); assert.equal(a.S.hours, 3); assert.equal(a.sameAsL, true, "S ว่าง = เท่ากับ L") }
    assert.equal("MXS-B" in m.items, false, "แถวที่เว้นว่าง ไม่ถูกส่งไปเขียนทับ")
    assert.equal(m.counts.skipped, 1)
    assert.equal(typeof validateAnswer(m.items["MXS-C"]), "string", "9999 ชม. ต้องไม่ผ่าน validator")
    assert.ok(m.problems.some((p) => p.includes("เกิน 500")), `เตือนชั่วโมงเกิน: ${m.problems.join(" | ")}`)
    assert.ok(m.problems.some((p) => p.includes("ไม่มีรหัสงาน ไม่มีรหัสนี้")))
    assert.ok(m.problems.some((p) => p.includes("ไม่มีรหัสอะไหล่ LB02x")))
    assert.ok(m.problems.some((p) => p.includes("S99")), "ชีตนอกใบถูกข้าม + เตือน")
    const p1 = m.parts[partKey("S45", "LB01")] as Record<string, unknown>
    assert.equal(p1.brand, "NOK")
    const vp = validatePartAnswer(p1)
    assert.notEqual(typeof vp, "string", String(vp))
    if (typeof vp !== "string") { assert.equal(vp.priceL, 1250, "ตัวเลขมีลูกน้ำอ่านได้"); assert.equal(vp.priceS, 1250, "฿ S ว่าง = เท่ากับ L") }
    assert.equal((m.parts[partKey("S45", "LB02")] as { skip: boolean }).skip, true)
  }

  // ── 4) ไฟล์ผิดใบ / ไม่ใช่เทมเพลต ────────────────────────────────────────────────
  assert.match(String(parseTemplate({ ...manual, [META_SHEET]: [["token", "OTHERtoken0123456789abc"]] }, TOKEN, ["S45"], jobs, parts)), /ใบขอราคาใบอื่น/)
  assert.match(String(parseTemplate({ "S45 x": [] }, TOKEN, ["S45"], jobs, parts)), /ไม่ใช่เทมเพลตของระบบ/)
  assert.equal(checkMeta([["token", TOKEN]], TOKEN), null)

  console.log("✅ rfq-import: ผ่านทั้งหมด")
})()
