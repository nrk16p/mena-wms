// lib/ap-round-import.ts
// อ่านไฟล์ "รอบโอน" ที่การเงินส่งกลับมา — เนื้อไฟล์คือ "ใบปะหน้าส่งเข้า สกท." ที่ระบบ export เอง
// (ดู apCoverSheetAoa) พิมพ์/เซ็น/ส่งการเงิน แล้วการเงินใช้ไฟล์เดียวกันยืนยันว่าโอนแล้วรอบไหน
//
// ฟังก์ชันล้วน ไม่ต่อฐาน ไม่แตะ DOM — ไดอะล็อกในเบราว์เซอร์กับเทสต์เรียกตัวเดียวกัน
// อ่านคอลัมน์จาก "ชื่อหัวคอลัมน์" ไม่ใช่ตำแหน่งตายตัว (ไฟล์คนละรอบสลับคอลัมน์/แทรกคอลัมน์ได้)
// ไฟล์ที่หัวตารางไม่ตรง = ปฏิเสธพร้อมบอกเหตุผล ไม่เดาว่าเป็นไฟล์นี้ (ผู้ใช้สั่ง 13/09/2026)
//
// ⚠️ ไฟล์นี้ไม่มีเลข PV — มีแต่เลขตั้งหนี้ (LAPO…) · การยืนยัน "จ่ายแล้ว" จึงใช้วันรอบโอน
// เป็นหลักฐาน (ดู apPaidConfirmed ใน ap-tracking.ts) · เลข PV เติมทีหลังจากทะเบียนจ่ายของการเงิน
import { parseAmount } from "./ap-tracking"

/** ใบ DD หนึ่งใบในไฟล์ — ยุบจากหลายบรรทัด (ไฟล์เป็นรายชิ้นสินค้า) */
export type ApRoundDd = {
  depositCode: string
  supplier: string
  amount: number           // รวมทุกบรรทัดของใบนี้ — เอาไปเทียบกับยอดหัวใบใน ATMS อีกชั้น
  lines: number
  vouchers: string[]       // เลขตั้งหนี้ LAPO… (ไม่ใช่เลข PV)
  billingNos: string[]
  receivedAt: string       // YYYY-MM-DD จากคอลัมน์ "วันที่" (วันรับของ)
}

export type ApRoundSheet = {
  roundDate: string        // YYYY-MM-DD จาก "รอบโอน d/m/yyyy" ในหัวฟอร์ม — "" = ไม่เจอ ให้คนกรอกเอง
  dds: ApRoundDd[]         // เรียงตามลำดับที่เจอในไฟล์
  lineCount: number
  total: number
  errors: string[]         // ปัญหาที่ต้องให้คนตัดสิน — มี error = ยังนำเข้าไม่ได้
}

/** เพดานต่อไฟล์ — ใช้ทั้งหน้าเว็บและ API · ไฟล์จริงรอบหนึ่ง ~84 ใบ */
export const AP_ROUND_MAX = 500

const DD_RE = /^[A-Z]{2,4}DD\d{4,}$/
const HEAD_SCAN_ROWS = 40          // หัวฟอร์มของจริง 10 แถว — เผื่อไว้ไม่ให้ไล่ทั้งชีต
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

/** วันที่ในไฟล์: "DD/MM/YYYY" (ค.ศ. หรือ พ.ศ.) · "YYYY-MM-DD" · serial ของ Excel → "YYYY-MM-DD" */
export function roundYmd(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const t = s(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t)
  if (!dmy) return ""
  const y = Number(dmy[3])
  const year = y > 2400 ? y - 543 : y      // ไฟล์บางรุ่นพิมพ์ปี พ.ศ.
  return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
}

type Cols = { date: number; code: number; supplier: number; item: number; amount: number; voucher: number; billing: number; note: number }

// จับคอลัมน์จากชื่อหัว — เรียงจากเฉพาะเจาะจงไปกว้าง เพราะ "วันที่ส่งเอกสารให้ฝ่ายการเงิน"
// ก็ขึ้นต้นด้วย "วันที่" เหมือนกัน ถ้าเช็คแบบ startsWith ก่อนจะจับผิดคอลัมน์
function classify(label: string): keyof Cols | "" {
  const t = label.trim()
  if (!t) return ""
  if (t === "DD" || t.toUpperCase() === "DD") return "code"
  if (/^voucher/i.test(t)) return "voucher"
  if (t.includes("ใบวางบิล")) return "billing"
  if (t.includes("ยอดเงิน")) return "amount"
  if (t.includes("ซัพพลายเออร์")) return "supplier"
  if (t.includes("ชื่อสินค้า")) return "item"
  if (t.includes("หมายเหตุ")) return "note"
  if (t === "วันที่") return "date"
  return ""
}

function findHeader(rows: unknown[][]): { row: number; cols: Cols } | null {
  const limit = Math.min(rows.length, HEAD_SCAN_ROWS)
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map((c) => s(c))
    const cols: Cols = { date: -1, code: -1, supplier: -1, item: -1, amount: -1, voucher: -1, billing: -1, note: -1 }
    cells.forEach((label, idx) => {
      const key = classify(label)
      if (key && cols[key] === -1) cols[key] = idx
    })
    // ต้องมีอย่างน้อย "เลขใบ" กับ "ยอดเงิน" ถึงจะเป็นตารางของฟอร์มนี้
    if (cols.code >= 0 && cols.amount >= 0) return { row: i, cols }
  }
  return null
}

/** "รอบโอน 3/9/2026" อยู่ในเซลล์หัวฟอร์ม ไม่ได้อยู่ในตาราง — ไล่หาเฉพาะแถวก่อนหัวตาราง */
function findRoundDate(rows: unknown[][], headRow: number): string {
  for (let i = 0; i <= headRow && i < rows.length; i++) {
    for (const cell of rows[i] ?? []) {
      const m = /รอบโอน\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(s(cell))
      if (m) return roundYmd(m[1])
    }
  }
  return ""
}

export function parseApRoundSheet(rows: unknown[][]): ApRoundSheet {
  const errors: string[] = []
  const head = findHeader(rows)
  if (!head) {
    return { roundDate: "", dds: [], lineCount: 0, total: 0,
      errors: ['ไม่พบหัวตารางของฟอร์มรอบโอน (ต้องมีคอลัมน์ "DD" และ "ยอดเงิน") — ไฟล์นี้อาจไม่ใช่ใบปะหน้าส่งเข้า สกท.'] }
  }
  const { row: headRow, cols } = head
  const roundDate = findRoundDate(rows, headRow)

  const byCode = new Map<string, ApRoundDd>()
  let lineCount = 0
  for (let i = headRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const code = s(row[cols.code]).toUpperCase()
    // แถวลงนาม/แถวว่างท้ายชีตไม่มีเลขใบ — ข้ามเงียบ ๆ ไม่ใช่ error
    if (!DD_RE.test(code)) continue
    lineCount++

    const cell = row[cols.amount]
    const rawAmt = s(cell)
    const amount = typeof cell === "number" ? cell : parseAmount(rawAmt)
    const zeroOk = /^0([.,]0+)?$/.test(rawAmt)
    if (!Number.isFinite(amount) || (amount === 0 && !zeroOk)) {
      errors.push(`แถว ${i + 1} (${code}): ยอดเงินอ่านไม่ได้ — "${rawAmt}"`)
      continue
    }

    let dd = byCode.get(code)
    if (!dd) {
      dd = { depositCode: code, supplier: "", amount: 0, lines: 0, vouchers: [], billingNos: [], receivedAt: "" }
      byCode.set(code, dd)
    }
    dd.amount = Math.round((dd.amount + amount) * 100) / 100
    dd.lines++
    if (!dd.supplier && cols.supplier >= 0) dd.supplier = s(row[cols.supplier])
    if (!dd.receivedAt && cols.date >= 0) dd.receivedAt = roundYmd(row[cols.date])
    const voucher = cols.voucher >= 0 ? s(row[cols.voucher]) : ""
    if (voucher && !dd.vouchers.includes(voucher)) dd.vouchers.push(voucher)
    const billing = cols.billing >= 0 ? s(row[cols.billing]) : ""
    if (billing && !dd.billingNos.includes(billing)) dd.billingNos.push(billing)
  }

  const dds = [...byCode.values()]
  if (!dds.length && !errors.length) errors.push("ไม่พบรายการในไฟล์ (ไม่มีบรรทัดที่มีเลขใบ DD)")
  if (dds.length > AP_ROUND_MAX) errors.push(`ไฟล์มี ${dds.length} ใบ — เกินเพดาน ${AP_ROUND_MAX} ใบต่อไฟล์`)

  return {
    roundDate, dds, lineCount,
    total: Math.round(dds.reduce((n, d) => n + d.amount, 0) * 100) / 100,
    errors,
  }
}
