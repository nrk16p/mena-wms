/* ตรวจกติกางานแปลงรหัส ATMS (lib/sku-convert-core.ts) — ไม่แตะ DB
 *   npx tsx scripts/check-sku-convert-core.ts
 */
import assert from "node:assert"
import {
  buildCodeBook, emptyEntry, entryFromSuggest, entryMissing, entryWrong, isLockLive, L1_FILTER, LOCK_MS,
  qtyCheck, rowStatus, sanitizeEntries, skuPreview, splitFrom,
} from "../lib/sku-convert-core"
import type { Entry, MasterCodeRow } from "../lib/sku-convert-types"

let pass = 0
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); process.exitCode = 1 }
}

const rows: MasterCodeRow[] = [
  { dict: "WAREHOUSE", code: "LK", th: "ลาดกระบัง" }, { dict: "WAREHOUSE", code: "SR", th: "สระบุรี" },
  { dict: "EXPENSE_TYPE", code: "PRT", th: "อะไหล่" }, { dict: "EXPENSE_TYPE", code: "LAB", th: "ค่าแรง" },
  { dict: "EXPENSE_TYPE", code: "SVC", th: "ค่าบริการ" },
  { dict: "SYSTEM_L1", code: "ENG", th: "ระบบเครื่องยนต์", order: 2 },
  { dict: "SYSTEM_L1", code: "BRK", th: "ระบบเบรก", order: 1 },
  { dict: "SYSTEM_L1", code: "SVC", th: "บริการภายนอก", order: 3 },
  { dict: "SUB_ASSEMBLY_L2", code: "OIL", th: "ระบบน้ำมันเครื่อง", parent: "ENG", meta: {} },
  { dict: "SUB_ASSEMBLY_L2", code: "TOP", th: "ฝาสูบและวาล์ว", parent: "ENG", meta: {} },
  { dict: "SUB_ASSEMBLY_L2", code: "ENGL", th: "ค่าแรงเครื่องยนต์", parent: "ENG", meta: { expenseType: "LAB" } },
  { dict: "SUB_ASSEMBLY_L2", code: "GEN", th: "บริการทั่วไป", parent: "SVC", meta: {} },
  { dict: "COMPONENT_L3", code: "OFT", th: "กรองน้ำมันเครื่อง", parent: "ENG:OIL", meta: {} },
  { dict: "COMPONENT_L3", code: "OVH", th: "ยกเครื่อง", parent: "ENG:ENGL", meta: { expenseType: "LAB" } },
  { dict: "UNIT", code: "PC", th: "ชิ้น" }, { dict: "UNIT", code: "DAY", th: "วัน" }, { dict: "UNIT", code: "HR", th: "ชั่วโมง" },
  { dict: "GRADE", code: "G1", th: "แท้ศูนย์นำเข้า", meta: {} }, { dict: "GRADE", code: "T1", th: "อู่ Tier 1", meta: { expenseType: "LAB" } },
  { dict: "POSITION", code: "GN", th: "ทั่วไป" }, { dict: "VEHICLE_TYPE", code: "ISZ_ALL", th: "Isuzu (ทุกรุ่น)" },
  { dict: "BRAND", code: "NOK", th: "เอ็นโอเค" },
]
const book = buildCodeBook(rows)

const good = (over: Partial<Entry> = {}): Entry => ({
  ...emptyEntry(), wh: "LK", type: "PRT", l1: "ENG", l2: "OIL", l3: "OFT", nameTh: "กรองน้ำมันเครื่อง",
  unit: "PC", atmsCodes: ["LB10PM00093"], ...over,
})

console.log("code book")
check("L1 sorted by order, L2/L3 split LAB vs non-LAB", () => {
  assert.deepStrictEqual(book.l1.map((o) => o.code), ["BRK", "ENG", "SVC"])
  assert.deepStrictEqual(book.l2.ENG.map((o) => o.code), ["OIL", "TOP"])
  assert.deepStrictEqual(book.l2Lab.ENG.map((o) => o.code), ["ENGL"])
  assert.deepStrictEqual(book.l3["ENG:OIL"].map((o) => o.code), ["OFT"])
  assert.deepStrictEqual(book.l3Lab["ENG:ENGL"].map((o) => o.code), ["OVH"])
  assert.deepStrictEqual(book.gradeLab.map((o) => o.code), ["T1"])
  assert.deepStrictEqual(book.grade.map((o) => o.code), ["G1"])
  assert.deepStrictEqual(book.unitLab, ["DAY", "HR"])
  assert.ok(book.l1ByType.PRT.includes("ENG") && !book.l1ByType.PRT.includes("SVC"))
})

console.log("required fields (same as /sku/new, no image)")
check("complete PRT entry has nothing missing", () => assert.deepStrictEqual(entryMissing(good()), []))
check("empty entry lists every required field", () =>
  assert.deepStrictEqual(entryMissing(emptyEntry()), ["คลัง", "ประเภท", "L1", "L2", "L3", "ชื่อ TH", "หน่วย", "รหัส ATMS"]))
check("L3 not required for LAB/SVC/CLN/TRP", () => {
  assert.deepStrictEqual(entryMissing(good({ type: "LAB", l3: "" })), [])
  assert.deepStrictEqual(entryMissing(good({ type: "SVC", l3: "" })), [])
  assert.deepStrictEqual(entryMissing(good({ type: "PRT", l3: "" })), ["L3"])
})
check("whitespace-only name counts as missing", () => assert.deepStrictEqual(entryMissing(good({ nameTh: "   " })), ["ชื่อ TH"]))

console.log("values must exist under their parent")
check("valid PRT entry has no wrong values", () => assert.deepStrictEqual(entryWrong(good(), book), []))
check("L2 not under L1 / L3 not under L2", () => {
  assert.deepStrictEqual(entryWrong(good({ l2: "TOP" }), book), ["L3 ไม่อยู่ใต้ L2"])
  assert.deepStrictEqual(entryWrong(good({ l1: "BRK" }), book), ["L2 ไม่อยู่ใต้ L1", "L3 ไม่อยู่ใต้ L2"])
})
check("L1 not allowed for the type", () =>
  assert.deepStrictEqual(entryWrong(good({ type: "SVC", l1: "ENG", l2: "OIL", l3: "" }), book), ["L1 ไม่ตรงประเภท"]))
check("LAB uses LAB lists, DAY/HR units and LAB grades", () => {
  const lab = good({ type: "LAB", l2: "ENGL", l3: "OVH", unit: "DAY", grade: "T1" })
  assert.deepStrictEqual(entryWrong(lab, book), [])
  assert.deepStrictEqual(entryWrong({ ...lab, l2: "OIL", l3: "" }, book), ["L2 ไม่อยู่ใต้ L1"])
  assert.deepStrictEqual(entryWrong({ ...lab, unit: "PC" }, book), ["หน่วยไม่ตรงประเภท"])
  assert.deepStrictEqual(entryWrong({ ...lab, grade: "G1" }, book), ["Grade ไม่ตรงประเภท"])
})
check("unknown unit / grade for parts", () => {
  assert.deepStrictEqual(entryWrong(good({ unit: "XYZ" }), book), ["หน่วยไม่ตรงประเภท"])
  assert.deepStrictEqual(entryWrong(good({ grade: "T1" }), book), ["Grade ไม่ตรงประเภท"])
})
check("blank optional values are not wrong", () => assert.deepStrictEqual(entryWrong(good({ grade: "" }), book), []))

console.log("qty allocation")
check("split 6 + 4 of 10 = ok", () =>
  assert.deepStrictEqual(qtyCheck(10, [good({ qty: 6 }), good({ qty: 4 })]), { state: "ok", total: 10, diff: 0 }))
check("short / over", () => {
  assert.deepStrictEqual(qtyCheck(10, [good({ qty: 6 })]), { state: "short", total: 6, diff: 4 })
  assert.deepStrictEqual(qtyCheck(10, [good({ qty: 6 }), good({ qty: 5 })]), { state: "over", total: 11, diff: 1 })
})
check("no stock and no qty = none; no stock but qty = over", () => {
  assert.deepStrictEqual(qtyCheck(0, [good({ qty: null })]), { state: "none", total: 0, diff: 0 })
  assert.strictEqual(qtyCheck(0, [good({ qty: 2 })]).state, "over")
})
check("float noise is ignored (0.1 + 0.2 of 0.3)", () =>
  assert.strictEqual(qtyCheck(0.3, [good({ qty: 0.1 }), good({ qty: 0.2 })]).state, "ok"))

console.log("row status")
check("no entries = todo", () => assert.strictEqual(rowStatus("parts", 10, [], book), "todo"))
check("complete + qty tied = done", () =>
  assert.strictEqual(rowStatus("parts", 10, [good({ qty: 6 }), good({ qty: 4, nameTh: "กรองเทียบ" })], book), "done"))
check("qty short = draft", () => assert.strictEqual(rowStatus("parts", 10, [good({ qty: 6 })], book), "draft"))
check("one incomplete card = draft", () =>
  assert.strictEqual(rowStatus("parts", 10, [good({ qty: 10 }), good({ qty: 0, l2: "" })], book), "draft"))
check("svc ignores qty", () =>
  assert.strictEqual(rowStatus("svc", 0, [good({ type: "LAB", l2: "ENGL", l3: "", unit: "DAY", qty: null })], book), "done"))

console.log("L1 filter (shared with /sku/new)")
check("TOL allowed for PRT only, LAB L1 allowed for LAB only", () => {
  assert.ok(L1_FILTER.PRT.includes("TOL") && !L1_FILTER.PM.includes("TOL") && !L1_FILTER.LAB.includes("TOL"))
  assert.ok(L1_FILTER.LAB.includes("LAB") && !L1_FILTER.PRT.includes("LAB"))
})
check("/sku/new imports L1_FILTER instead of keeping its own copy", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/sku/new/page.tsx"), "utf8")
  assert.ok(src.includes('import { L1_FILTER } from "@/lib/sku-convert-core"'))
  assert.ok(!/const L1_FILTER\s*[:=]/.test(src))
})

console.log("helpers")
check("sku preview with and without L3", () => {
  assert.strictEqual(skuPreview(good()), "LK-PRT-ENG-OIL-OFT-####")
  assert.strictEqual(skuPreview(good({ type: "LAB", l2: "ENGL", l3: "" })), "LK-LAB-ENG-ENGL-####")
  assert.strictEqual(skuPreview(good({ l2: "" })), "")
})
check("entryFromSuggest fills card #1 from the loader's suggestions", () => {
  const e = entryFromSuggest({
    wh: "SR", code: "S10PM00040", name: "กรองอากาศลูกนอก", kind: "parts", atmsQty: 10,
    suggest: { type: "PM", l1: "ENG", unit: "PC", vehicle: "ISZ_ALL", partNo: "8-98", price: 1819.5 },
  })
  assert.deepStrictEqual(
    [e.wh, e.type, e.l1, e.l2, e.unit, e.nameTh, e.partNo, e.price, e.qty, e.positions, e.vehicles, e.atmsCodes],
    ["SR", "PM", "ENG", "", "PC", "กรองอากาศลูกนอก", "8-98", "1819.5", 10, ["GN"], ["ISZ_ALL"], ["S10PM00040"]])
  const svc = entryFromSuggest({ wh: "LK", code: "LB00009", name: "ค่าแรง", kind: "svc", atmsQty: 0, suggest: { type: "LAB" } })
  assert.strictEqual(svc.qty, null)
})
check("splitFrom copies card #1 without qty and note", () => {
  const s = splitFrom(good({ qty: 6, note: "แท้" }))
  assert.strictEqual(s.qty, null); assert.strictEqual(s.note, ""); assert.strictEqual(s.l3, "OFT")
})
check("sanitizeEntries trims, dedupes codes, coerces qty, drops junk", () => {
  const [e] = sanitizeEntries([{ ...good(), nameTh: "  กรอง  ", atmsCodes: ["A", "A", " B "], qty: "6", positions: "x" }, 42])
  assert.strictEqual(e.nameTh, "กรอง"); assert.deepStrictEqual(e.atmsCodes, ["A", "B"])
  assert.strictEqual(e.qty, 6); assert.deepStrictEqual(e.positions, [])
  assert.strictEqual(sanitizeEntries("nope").length, 0)
  assert.strictEqual(sanitizeEntries(Array(30).fill(good())).length, 20)
  assert.strictEqual(sanitizeEntries([{ ...good(), qty: -3 }])[0].qty, null)
})
check("lock is live for 30 minutes", () => {
  const now = Date.parse("2026-10-06T10:00:00Z")
  assert.strictEqual(LOCK_MS, 30 * 60 * 1000)
  assert.ok(isLockLive({ email: "a", name: "A", at: "2026-10-06T09:45:00Z" }, now))
  assert.ok(!isLockLive({ email: "a", name: "A", at: "2026-10-06T09:29:00Z" }, now))
  assert.ok(!isLockLive(null, now))
})

console.log(`\n${pass} passed${process.exitCode ? " — FAILURES above" : ""}`)
