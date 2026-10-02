// lib/ap-voucher-import.ts
// อ่าน "รายงานตั้งเจ้าหนี้อื่นๆ" ที่บัญชี export จากระบบบัญชี (ปุ่มนำเข้าการตั้งเบิก ในหน้า /ap-tracking)
// เพิ่ม 02/10/2026 · ใช้ทั้งพรีวิวและตอนเขียนจริง (ฝั่ง API คิดซ้ำจากค่าที่ส่งมา)
//
// กติกาจากผู้ใช้:
//   - ใช้เฉพาะแถวที่ empname = อาทิติยา / วราพร (คนตั้งหนี้ฝั่งซ่อมบำรุง)
//   - เลขใบ DD อยู่ใน GoodRemark รูปแบบ KKDD/LBDD/SBDD + 8 หลัก (ผู้ใช้พิมพ์ SDDD แต่ข้อมูลจริงเป็น SBDD)
//   - เลขที่ Voucher/ตั้งหนี้ = DocuNo (LAPO…/SAPO…)
//
// ฟังก์ชันล้วน ไม่ต่อฐาน ไม่แตะ DOM — หาคอลัมน์จาก "ชื่อหัว" ไม่ยึดตำแหน่ง (แพตเทิร์นเดียวกับ ap-round-import)
import { roundYmd } from "./ap-round-import"

export const AP_VOUCHER_EMPLOYEES = ["อาทิติยา", "วราพร"]
export const AP_VOUCHER_MAX = 20_000

/** เลข DD ที่อ่านได้แน่นอน — prefix คลัง 2 ตัว + DD + 8 หลักพอดี (ไม่ติดตัวอักษร/ตัวเลขอื่นหัวท้าย) */
const DD_STRICT = /(?<![A-Z0-9])(?:KK|LB|SB)DD\d{8}(?!\d)/g
/** อะไรก็ตามที่ "หน้าตาเหมือน" เลข DD — ใช้จับตัวที่พิมพ์ผิด (7/9 หลัก, KDD, prefix อื่น) มาให้คนดู */
const DD_LOOSE = /[A-Z]{0,4}DD\d{2,}/g

export type ApVoucherDd = {
  depositCode: string
  vouchers: string[]        // DocuNo ทุกใบที่อ้าง DD นี้ (1 DD ตั้งหนี้แยก 2 ใบได้)
  docDate: string           // YYYY-MM-DD วันตั้งหนี้ล่าสุดของ DD นี้
  employees: string[]
}
export type ApVoucherUnreadable = { token: string; docNo: string; docDate: string; remark: string; employee: string }

export type ApVoucherSheet = {
  dds: ApVoucherDd[]
  unreadable: ApVoucherUnreadable[]
  stats: {
    rows: number              // แถวข้อมูลทั้งไฟล์
    kept: number              // แถวของคนตั้งหนี้ที่กำหนด
    byEmployee: Record<string, number>
    withDd: number
    noDd: number              // แถวที่ไม่มีเลข DD เลย (ค่ายาง/อุปกรณ์สำนักงาน ฯลฯ) — ไม่เกี่ยว ข้ามไป
    vouchers: number
    dateFrom: string
    dateTo: string
  }
  errors: string[]
}

const s = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim()

const REQUIRED = ["DocuNo", "DocuDate", "GoodRemark", "empname"] as const

export function parseApVoucherSheet(rows: unknown[][]): ApVoucherSheet {
  const out: ApVoucherSheet = {
    dds: [], unreadable: [], errors: [],
    stats: { rows: 0, kept: 0, byEmployee: {}, withDd: 0, noDd: 0, vouchers: 0, dateFrom: "", dateTo: "" },
  }
  const headIdx = rows.slice(0, 20).findIndex((r) => Array.isArray(r) && REQUIRED.every((k) => r.some((c) => s(c) === k)))
  if (headIdx < 0) {
    out.errors.push(`ไม่ใช่ไฟล์รายงานตั้งเจ้าหนี้ — ไม่พบหัวคอลัมน์ ${REQUIRED.join(" / ")}`)
    return out
  }
  const head = rows[headIdx].map((c) => s(c))
  const col = Object.fromEntries(REQUIRED.map((k) => [k, head.indexOf(k)])) as Record<(typeof REQUIRED)[number], number>

  const byDd = new Map<string, { vouchers: Set<string>; docDate: string; employees: Set<string> }>()
  const vouchers = new Set<string>()
  const seenBad = new Set<string>()

  for (const r of rows.slice(headIdx + 1)) {
    if (!Array.isArray(r) || r.every((c) => s(c) === "")) continue
    out.stats.rows++
    const emp = s(r[col.empname])
    const who = AP_VOUCHER_EMPLOYEES.find((n) => emp.startsWith(n))
    if (!who) continue
    out.stats.kept++
    out.stats.byEmployee[emp] = (out.stats.byEmployee[emp] ?? 0) + 1

    const docNo = s(r[col.DocuNo]).toUpperCase()
    const docDate = roundYmd(r[col.DocuDate])
    const remark = s(r[col.GoodRemark])
    const upper = remark.toUpperCase()
    if (docDate) {
      if (!out.stats.dateFrom || docDate < out.stats.dateFrom) out.stats.dateFrom = docDate
      if (docDate > out.stats.dateTo) out.stats.dateTo = docDate
    }

    const strict = [...new Set(upper.match(DD_STRICT) ?? [])]
    const loose = [...new Set(upper.match(DD_LOOSE) ?? [])].filter((t) => !strict.includes(t))
    if (!strict.length && !loose.length) { out.stats.noDd++; continue }
    if (strict.length) out.stats.withDd++

    for (const code of strict) {
      const cur = byDd.get(code) ?? { vouchers: new Set<string>(), docDate: "", employees: new Set<string>() }
      if (docNo) { cur.vouchers.add(docNo); vouchers.add(docNo) }
      if (docDate > cur.docDate) cur.docDate = docDate
      cur.employees.add(emp)
      byDd.set(code, cur)
    }
    // ตัวที่หน้าตาเหมือนเลข DD แต่ไม่เข้ารูปแบบ — เก็บไว้ให้คนตัดสิน ไม่เดาแก้ให้เอง
    for (const token of loose) {
      const key = `${token}|${docNo}`
      if (seenBad.has(key)) continue
      seenBad.add(key)
      out.unreadable.push({ token, docNo, docDate, remark, employee: emp })
    }
  }

  out.stats.vouchers = vouchers.size
  out.dds = [...byDd.entries()].map(([depositCode, v]) => ({
    depositCode, vouchers: [...v.vouchers].sort(), docDate: v.docDate, employees: [...v.employees],
  }))
  if (!out.stats.kept) out.errors.push(`ไม่พบแถวของ ${AP_VOUCHER_EMPLOYEES.join(" / ")} ในคอลัมน์ empname`)
  else if (!out.dds.length) out.errors.push("ไม่พบเลข DD ในคอลัมน์ GoodRemark เลย")
  if (out.dds.length > AP_VOUCHER_MAX) out.errors.push(`มีเลข DD ${out.dds.length} ใบ เกินเพดาน ${AP_VOUCHER_MAX}`)
  return out
}
