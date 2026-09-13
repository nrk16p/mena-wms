// scripts/check-ap-round-import.ts
// รัน: npx tsx scripts/check-ap-round-import.ts — ตัวอ่านไฟล์ "รอบโอน" ของการเงิน (ปุ่มนำเข้าการจ่าย)
// fixture ล้อโครงไฟล์จริง "เครดิต 7 วัน รอบโอนวันที่ 3.9.2026(1).xlsx" (ใบปะหน้า สกท. ที่ระบบ export เอง):
// หัวฟอร์ม 10 แถว (มี "รอบโอน d/m/yyyy") → หัวตารางแถวที่ 11 → รายชิ้นสินค้า → แถวลงนามท้ายชีต
import assert from "node:assert/strict"
import { parseApRoundSheet } from "../lib/ap-round-import"

const blank = (n = 9) => Array(n).fill("")
const HEAD = ["วันที่", "DD", "ซัพพลายเออร์", "ชื่อสินค้า", "ยอดเงิน", "Voucher No. เลขตั้งหนี้", "ใบวางบิลเลขที่", "หมายเหตุ", "วันที่ส่งเอกสารให้ฝ่ายการเงิน"]
const form = () => {
  const rows: unknown[][] = [blank(), blank(), blank(), blank(), blank(), blank()]
  rows.push(["ถึง....พี่พีช", "", "", "", "", "", "", "", "รอบโอน  3/9/2026"])
  rows.push(blank(), blank(), blank())
  rows.push([...HEAD])
  return rows
}
const line = (code: string, amount: unknown, voucher: string, extra: Partial<{ date: string; supplier: string; item: string; billing: string }> = {}) =>
  [extra.date ?? "20/08/2026", code, extra.supplier ?? "นายพัสราวุธ นิมาลา (อู่สง่าการช่าง)", extra.item ?? "LB08GP00017 : กาวทาประเกน",
    amount, voucher, extra.billing ?? "", "เครดิต 7 วัน", ""]

// --- ไฟล์ปกติ: หลายบรรทัดต่อใบ → ยุบเป็นรายใบ ---
const rows = form()
rows.push(line("LBDD26080729", 240, "LAPO26080724"))
rows.push(line("LBDD26080729", 260, "LAPO26080724"))
rows.push(line("LBDD26080729", 480, "LAPO26080724", { billing: "IVB-690800010" }))
rows.push(line("SBDD26080281", 700, "LAPO26080943", { date: "11/08/2026", supplier: "นายวิโรจน์ รัตนทอง(We WASH STATION)" }))
// แถวลงนามท้ายชีต — ไม่มีเลข DD ต้องถูกข้าม ไม่ใช่ error
rows.push(["วราพร   27/08/2026", "สุขพัฒน์ 31/08/2026", "31.08.2026", "", "", "", "", "", ""])
rows.push(["บัญชี  ศลบ", "บัญชี AP สกท.", "วันที่ส่งเอกสารเข้า สกท.", "", "", "", "", "", ""])
rows.push(["ผู้จัดทำ", "ผู้รับเอกสาร", "", "", "", "", "", "", ""])

const r = parseApRoundSheet(rows)
assert.deepEqual(r.errors, [], "ไฟล์ปกติต้องไม่มี error")
assert.equal(r.roundDate, "2026-09-03", "อ่านวันรอบโอนจากหัวฟอร์ม (3/9/2026)")
assert.equal(r.lineCount, 4, "นับเฉพาะบรรทัดที่มีเลข DD")
assert.equal(r.dds.length, 2, "ยุบเป็นรายใบ")
assert.equal(r.total, 1680)
const [a, b] = r.dds
assert.equal(a.depositCode, "LBDD26080729")
assert.equal(a.amount, 980, "รวมยอดทุกบรรทัดของใบเดียวกัน")
assert.equal(a.lines, 3)
assert.deepEqual(a.vouchers, ["LAPO26080724"], "เลขตั้งหนี้ซ้ำเหลือตัวเดียว")
assert.deepEqual(a.billingNos, ["IVB-690800010"], "เก็บเลขใบวางบิลที่มีจริง")
assert.equal(a.receivedAt, "2026-08-20", "วันที่ในตาราง DD/MM/YYYY → ISO")
assert.equal(a.supplier, "นายพัสราวุธ นิมาลา (อู่สง่าการช่าง)")
assert.equal(b.depositCode, "SBDD26080281", "คงลำดับที่เจอในไฟล์")
assert.deepEqual(b.billingNos, [], "ไม่มีเลขใบวางบิล = ชุดว่าง")

// --- ยอดเงินที่มาเป็นข้อความมีคอมมา (บางไฟล์ export มาแบบนี้) ---
const comma = form(); comma.push(line("LBDD26080001", "1,234.50", "LAPO26080001"))
assert.equal(parseApRoundSheet(comma).dds[0].amount, 1234.5)

// --- ปี พ.ศ. ในคอลัมน์วันที่ → แปลงเป็น ค.ศ. ---
const be = form(); be.push(line("LBDD26080002", 100, "LAPO26080002", { date: "20/08/2569" }))
assert.equal(parseApRoundSheet(be).dds[0].receivedAt, "2026-08-20", "พ.ศ. 2569 = ค.ศ. 2026")

// --- วันที่เป็น serial ของ Excel ---
// serial นับจาก 1899-12-30: 2026-01-01 = 46023 · 01/08 = +212 = 46235 · 20/08 = +19 = 46254
const serial = form(); serial.push(line("LBDD26080003", 100, "LAPO26080003", { date: 46254 as unknown as string }))
assert.equal(parseApRoundSheet(serial).dds[0].receivedAt, "2026-08-20", "serial 46254 = 20/08/2026")

// --- ไม่มีหัวตาราง = ไฟล์ผิดแบบ ต้องปฏิเสธ ไม่ใช่เดา ---
const noHead = parseApRoundSheet([blank(), ["อะไรก็ไม่รู้", "", ""], blank()])
assert.equal(noHead.dds.length, 0)
assert.ok(noHead.errors.some((e) => e.includes("หัวตาราง")), `ต้องบอกว่าไม่พบหัวตาราง — ได้ ${JSON.stringify(noHead.errors)}`)

// --- หัวตารางมีแต่ไม่มีบรรทัดข้อมูล ---
const empty = parseApRoundSheet(form())
assert.equal(empty.dds.length, 0)
assert.ok(empty.errors.some((e) => e.includes("ไม่พบรายการ")), `ต้องบอกว่าไม่มีรายการ — ได้ ${JSON.stringify(empty.errors)}`)

// --- ไม่มี "รอบโอน" ในหัวฟอร์ม → roundDate ว่าง (หน้าเว็บให้คนกรอกเอง) แต่ยังอ่านรายการได้ ---
const noRound = form(); noRound[6] = ["ถึง....พี่พีช", "", "", "", "", "", "", "", ""]
noRound.push(line("LBDD26080004", 100, "LAPO26080004"))
const nr = parseApRoundSheet(noRound)
assert.equal(nr.roundDate, "")
assert.equal(nr.dds.length, 1, "ไม่มีวันรอบโอนก็ยังอ่านรายการได้")
assert.deepEqual(nr.errors, [], "วันรอบโอนว่างไม่ใช่ error ของไฟล์")

// --- บรรทัดที่มีเลข DD แต่ยอดเงินอ่านไม่ได้ = ต้องฟ้อง ไม่ใช่คิดเป็น 0 เงียบ ๆ ---
const badAmt = form(); badAmt.push(line("LBDD26080005", "-", "LAPO26080005"))
const ba = parseApRoundSheet(badAmt)
assert.ok(ba.errors.some((e) => e.includes("LBDD26080005")), `ต้องฟ้องบรรทัดยอดเงินเสีย — ได้ ${JSON.stringify(ba.errors)}`)

// --- คอลัมน์สลับที่ (ไฟล์รุ่นอื่น) — ต้องอ่านจากชื่อหัวคอลัมน์ ไม่ใช่ตำแหน่งตายตัว ---
const swapped: unknown[][] = [["รอบโอน 3/9/2026"], ["DD", "วันที่", "ยอดเงิน", "ซัพพลายเออร์", "Voucher No. เลขตั้งหนี้"]]
swapped.push(["LBDD26080006", "20/08/2026", 500, "ร้านทดสอบ", "LAPO26080006"])
const sw = parseApRoundSheet(swapped)
assert.equal(sw.dds.length, 1)
assert.equal(sw.dds[0].amount, 500)
assert.equal(sw.dds[0].supplier, "ร้านทดสอบ")
assert.deepEqual(sw.dds[0].vouchers, ["LAPO26080006"])

console.log("✅ ตัวอ่านไฟล์รอบโอน ผ่านทั้งหมด")
