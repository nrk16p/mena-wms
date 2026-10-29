// Excel ของแท็บ "รอประกบ" และ "ไม่ผ่าน" ใน /ap-tracking (ผู้ใช้สั่ง 29/10/2026)
// สร้างไฟล์ .xlsx จริงด้วยไลบรารีเดียวกับหน้าเว็บ แล้วอ่านกลับมาเทียบหัวคอลัมน์และค่า
// รัน: npx tsx scripts/check-ap-export-wait-rejected.ts [โฟลเดอร์เก็บไฟล์ตัวอย่าง]
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as XLSX from "xlsx"
import { AP_REJECTED_WIDTHS, AP_WAIT_WIDTHS, apRejectedRow, apWaitRow } from "../components/ap-export"
import type { ApRow } from "../components/ap-types"

const base = {
  depositId: 1, warehouse: "คลังลาดกระบัง", purchaseOrder: "PO26100001", supplier: "บจก.ทดสอบ", supplierRefNo: "",
  amount: 1000, netAmount: 1070, vat: true, createdAt: "", creditTerm: "30D", docs: {}, fileCount: 2,
  sentType: "", sentDate: "", note: "โน้ต", docNos: {}, status: "รอประกบ", carryover: false,
  poTotal: 0, poDue: "", poStatus: "",
} as unknown as ApRow

const today = "2026-10-29"
const wait: ApRow = { ...base, depositCode: "LBDD26100001", receivedAt: "2026-09-20", dueDate: "2026-10-20", overdue: 9,
  vehicle: "70-1234", fleetNo: "M101", prNote: "MR123 เปลี่ยนยาง" }
// ไม่มีเครดิตเทอม = ไม่มีวันครบกำหนด · รับของวันนี้ = อายุ 0 วัน · ไม่มีทะเบียน/PR → ช่องว่าง ไม่ใช่ undefined
const waitBare: ApRow = { ...base, depositCode: "LBDD26100002", receivedAt: today, creditTerm: "", dueDate: "", overdue: 0, fileCount: 0 }
// ตีกลับ 28/10 ตี 1 ครึ่งเวลาไทย (UTC ยังเป็น 27/10) → ต้องได้ 28/10 · จ่ายไปแล้วก่อนถูกตีกลับ
const rej: ApRow = { ...base, depositCode: "LBDD26100003", receivedAt: "2026-10-01", dueDate: "2026-10-31", overdue: 0,
  sentMarkedDate: "2026-10-05", sentMarkedBy: "กุ้ง",
  review: { status: "ไม่ผ่าน", note: "ใบกำกับชื่อบริษัทผิด", by: "บัญชี A", at: "2026-10-27T18:30:00.000Z" },
  paid: { date: "2026-10-23" } }
const rejBare: ApRow = { ...base, depositCode: "LBDD26100004", receivedAt: "2026-10-02", dueDate: "", overdue: 0,
  review: { status: "ไม่ผ่าน", note: "" } }

const WAIT_HEADERS = ["เลขใบรับของ", "วันที่รับของ", "อายุใบ (วัน)", "คลัง", "ซัพพลายเออร์", "PO", "ทะเบียนรถ", "เบอร์รถ",
  "รวมสุทธิ", "เครดิตเทอม", "ครบกำหนด", "เกินกำหนด (วัน)", "ไฟล์แนบ", "หมายเหตุ PR", "หมายเหตุ"]
const REJECTED_HEADERS = ["เลขใบรับของ", "วันที่รับของ", "คลัง", "ซัพพลายเออร์", "PO", "ทะเบียนรถ", "เบอร์รถ", "รวมสุทธิ",
  "เครดิตเทอม", "กดส่งเมื่อ", "ส่งโดย", "ตีกลับเมื่อ", "ตีกลับโดย", "เหตุผลที่ไม่ผ่าน", "จ่ายแล้วเมื่อ", "หมายเหตุ"]

// ความกว้างต้องเท่าจำนวนคอลัมน์ ไม่งั้นคอลัมน์ท้าย ๆ แคบผิดตัว
assert.equal(AP_WAIT_WIDTHS.length, WAIT_HEADERS.length)
assert.equal(AP_REJECTED_WIDTHS.length, REJECTED_HEADERS.length)

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), "ap-export-"))

function roundTrip(sheet: string, rows: object[], widths: XLSX.ColInfo[]): Record<string, unknown>[] {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws["!cols"] = widths
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  const file = join(outDir, `เจ้าหนี้${sheet}_2026-10.xlsx`)
  XLSX.writeFile(wb, file)
  const back = XLSX.readFile(file)
  assert.deepEqual(back.SheetNames, [sheet])
  const header = (XLSX.utils.sheet_to_json(back.Sheets[sheet], { header: 1 })[0] ?? []) as string[]
  assert.deepEqual(header, sheet === "รอประกบ" ? WAIT_HEADERS : REJECTED_HEADERS, `หัวคอลัมน์ ${sheet}`)
  console.log(`  ${file}`)
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(back.Sheets[sheet], { defval: "" })
}

const w = roundTrip("รอประกบ", [wait, waitBare].map((r) => apWaitRow(r, today)), AP_WAIT_WIDTHS)
assert.equal(w.length, 2)
assert.equal(w[0]["อายุใบ (วัน)"], 39, "20/09 → 29/10 = 39 วัน")
assert.equal(w[0]["เกินกำหนด (วัน)"], 9)
assert.equal(w[0]["ครบกำหนด"], "2026-10-20")
assert.equal(w[0]["รวมสุทธิ"], 1070, "ยอดเป็นตัวเลข ไม่ใช่ข้อความ — เอาไปรวมใน Excel ได้")
assert.equal(w[0]["ไฟล์แนบ"], 2)
assert.equal(w[0]["หมายเหตุ PR"], "MR123 เปลี่ยนยาง")
assert.equal(w[1]["อายุใบ (วัน)"], 0)
assert.equal(w[1]["ครบกำหนด"], "")
assert.equal(w[1]["ทะเบียนรถ"], "")
assert.equal(w[1]["หมายเหตุ PR"], "")

const r = roundTrip("ไม่ผ่าน", [rej, rejBare].map(apRejectedRow), AP_REJECTED_WIDTHS)
assert.equal(r.length, 2)
assert.equal(r[0]["ตีกลับเมื่อ"], "2026-10-28", "review.at เป็น UTC ต้องแปลงเป็นวันไทย")
assert.equal(r[0]["ตีกลับโดย"], "บัญชี A")
assert.equal(r[0]["เหตุผลที่ไม่ผ่าน"], "ใบกำกับชื่อบริษัทผิด")
assert.equal(r[0]["กดส่งเมื่อ"], "2026-10-05")
assert.equal(r[0]["ส่งโดย"], "กุ้ง")
assert.equal(r[0]["จ่ายแล้วเมื่อ"], "2026-10-23")
assert.equal(r[1]["ตีกลับเมื่อ"], "")
assert.equal(r[1]["ส่งโดย"], "")
assert.equal(r[1]["จ่ายแล้วเมื่อ"], "")

console.log("ok — Excel รอประกบ/ไม่ผ่าน ตรงทุกข้อ")
