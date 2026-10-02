// lib/ap-payment-report-import.ts
// อ่าน "รายงานจ่ายชำระเจ้าหนี้" (export ดิบจากระบบบัญชี) สำหรับปุ่มนำเข้าการจ่าย ในหน้า /ap-tracking
// เพิ่ม 02/10/2026 · ใช้ทั้งพรีวิวและตอนเขียนจริง (ฝั่ง API คิดซ้ำจากค่าที่ส่งมา)
//
// 1 แถว = 1 invoice ที่จ่าย · PV = DocuNo · วันจ่าย = DocuDate · ยอด = PayAmnt
// ไม่มีคอลัมน์เลข DD — สะพานคือ DocuNo_inv (เลขตั้งหนี้ LAPO…/SAPO…) → ap_tracking.voucherNos (ฝั่ง API)
// + InvNo ที่ร้านคีย์เลข DD ไว้ (สำรอง) · ตรรกะเดียวกับ format B ใน scripts/import-ap-payment.ts
//
// ⚠️ หัวคอลัมน์ซ้ำในไฟล์จริง (DocuDate ×2, Remark ×3, JobID ×2) — ใช้ "ตัวแรก" เสมอ
//    DocuDate ตัวหลังเป็นวันของงาน (Job) ไม่ใช่วันจ่าย
import { roundYmd } from "./ap-round-import"
import { parseAmount } from "./ap-tracking"

export const AP_PAYMENT_REPORT_MAX = 40_000
const DD_STRICT = /(?<![A-Z0-9])(?:KK|LB|SB)DD\d{8}(?!\d)/g
const REQUIRED = ["DocuNo", "DocuDate", "DocuNo_inv", "PayAmnt"] as const
const s = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim()

/** 1 รายการต่อเลขตั้งหนี้ (LAPO) — ยุบหลายแถว/หลาย PV ของเลขเดียวกัน */
export type ApPaymentLapo = {
  lapo: string              // "" = แถวไม่มีเลขตั้งหนี้ (ใช้ได้เฉพาะเมื่อ InvNo มีเลข DD)
  pvs: string[]
  date: string              // วันจ่ายล่าสุด YYYY-MM-DD (จ่ายหลายงวด = วันล่าสุด · กติกา 21/08/2026)
  amount: number
  dds: string[]             // เลข DD ที่อ่านได้จาก InvNo
}

export type ApPaymentSheet = {
  items: ApPaymentLapo[]
  stats: { rows: number; pvs: number; lapos: number; invDdRows: number; dateFrom: string; dateTo: string }
  errors: string[]
}

/** ไฟล์นี้ใช่ "รายงานจ่ายชำระเจ้าหนี้" ไหม — ดูจากหัวคอลัมน์ (ใช้แยกจากไฟล์ใบปะหน้ารอบโอนแบบเดิม) */
export function isApPaymentReport(rows: unknown[][]): boolean {
  return rows.slice(0, 10).some((r) => Array.isArray(r) && REQUIRED.every((k) => r.some((c) => s(c) === k)))
}

export function parseApPaymentReport(rows: unknown[][]): ApPaymentSheet {
  const out: ApPaymentSheet = { items: [], errors: [], stats: { rows: 0, pvs: 0, lapos: 0, invDdRows: 0, dateFrom: "", dateTo: "" } }
  const headIdx = rows.slice(0, 10).findIndex((r) => Array.isArray(r) && REQUIRED.every((k) => r.some((c) => s(c) === k)))
  if (headIdx < 0) {
    out.errors.push(`ไม่ใช่ไฟล์รายงานจ่ายชำระเจ้าหนี้ — ไม่พบหัวคอลัมน์ ${REQUIRED.join(" / ")}`)
    return out
  }
  const head = rows[headIdx].map((c) => s(c))
  const col = (k: string) => head.indexOf(k)          // indexOf = ตัวแรก (กันหัวซ้ำ)
  const c = { pv: col("DocuNo"), date: col("DocuDate"), lapo: col("DocuNo_inv"), amt: col("PayAmnt"), inv: col("InvNo") }

  const by = new Map<string, { pvs: Set<string>; date: string; amount: number; dds: Set<string> }>()
  const pvs = new Set<string>()
  for (const r of rows.slice(headIdx + 1)) {
    if (!Array.isArray(r) || r.every((x) => s(x) === "")) continue
    out.stats.rows++
    const pv = s(r[c.pv]).toUpperCase()
    if (!pv) continue
    const lapo = s(r[c.lapo]).toUpperCase()
    const dds = c.inv >= 0 ? [...new Set(s(r[c.inv]).toUpperCase().match(DD_STRICT) ?? [])] : []
    if (dds.length) out.stats.invDdRows++
    if (!lapo && !dds.length) continue
    const date = roundYmd(r[c.date])
    if (date) {
      if (!out.stats.dateFrom || date < out.stats.dateFrom) out.stats.dateFrom = date
      if (date > out.stats.dateTo) out.stats.dateTo = date
    }
    pvs.add(pv)
    // แถวไม่มีเลขตั้งหนี้ แยกคีย์ต่อ PV ไม่ให้ไปรวมกันเป็นก้อนเดียว
    const key = lapo || `#${pv}`
    const cur = by.get(key) ?? { pvs: new Set<string>(), date: "", amount: 0, dds: new Set<string>() }
    cur.pvs.add(pv)
    if (date > cur.date) cur.date = date
    cur.amount = Math.round((cur.amount + (typeof r[c.amt] === "number" ? (r[c.amt] as number) : parseAmount(r[c.amt]))) * 100) / 100
    for (const d of dds) cur.dds.add(d)
    by.set(key, cur)
  }
  out.stats.pvs = pvs.size
  out.items = [...by.entries()].map(([k, v]) => ({
    lapo: k.startsWith("#") ? "" : k, pvs: [...v.pvs].sort(), date: v.date, amount: v.amount, dds: [...v.dds],
  }))
  out.stats.lapos = out.items.filter((i) => i.lapo).length
  if (!out.items.length) out.errors.push("ไม่พบรายการจ่ายในไฟล์")
  if (out.items.length > AP_PAYMENT_REPORT_MAX) out.errors.push(`มี ${out.items.length} รายการ เกินเพดาน ${AP_PAYMENT_REPORT_MAX}`)
  return out
}
