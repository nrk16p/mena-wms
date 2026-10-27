// lib/vendor-portal.ts — กติกาพอร์ทัลเจ้าหนี้ (ใช้ร่วม API · หน้าเว็บ · เทสต์) ไม่แตะฐานข้อมูล
// spec: docs/superpowers/specs/2026-10-27-vendor-portal-design.md
//
// หลักใหญ่: เจ้าหนี้เห็น "แค่สถานะ" — ขั้นภายในของจัดซื้อ/บัญชี (รอประกบ ครบชุด ส่งบัญชี ตีกลับ)
// รวมเป็น "กำลังดำเนินการ" และทุกอย่างที่ส่งออกไปต้องผ่าน vpBillOf (whitelist) เท่านั้น
import { apPaidConfirmed, parseAmount, AP_GO_LIVE } from "./ap-tracking"
import { normVendorCode } from "./ap-doc-template"

export type VpStatus = "processing" | "scheduled" | "paid"

export const VP_STATUS_LABEL: Record<VpStatus, string> = {
  processing: "กำลังดำเนินการ",
  scheduled:  "รอโอน",
  paid:       "โอนแล้ว",
}

/** ลำดับต่างจาก apStage(): ฝั่งภายใน "ไม่ผ่าน" ชนะทุกขั้น แต่เจ้าหนี้ที่ได้เงินแล้วต้องเห็น "โอนแล้ว" */
export function vpStatusOf(t: {
  review?: { status?: string } | null
  pay?: { payDate?: string } | null
  paid?: { paymentNos?: string[]; date?: string } | null
} | null | undefined): VpStatus {
  if (!t) return "processing"
  if (apPaidConfirmed(t.paid)) return "paid"
  if (String(t.review?.status ?? "").trim() === "ผ่าน") return "scheduled"
  return "processing"
}

// ── ช่วงเวลา (วันที่เป็น YYYY-MM-DD เวลาไทยเสมอ — ผู้เรียกส่ง todayICT() มา) ─────────────
const firstOfMonthsAgo = (todayISO: string, n: number) => {
  const [y, m] = todayISO.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return d.toISOString().slice(0, 10)
}

/** ย้อนหลัง 6 เดือน = เดือนนี้ + 5 เดือนก่อน นับจากวันที่ 1 */
export function vpWindowStart(todayISO: string): string {
  return firstOfMonthsAgo(todayISO, 5)
}

/** ใบที่ยังไม่โอนโชว์ย้อนได้ไกลกว่า (ใบเครดิตยาวโอนหลังหลุดช่วง) แต่ไม่ก่อน go-live และไม่เกิน 12 เดือน */
export function vpLookbackStart(todayISO: string): string {
  const a = firstOfMonthsAgo(todayISO, 12)
  return a > AP_GO_LIVE ? a : AP_GO_LIVE
}

/** YYYY-MM ตั้งแต่เดือนของ fromISO ถึงเดือนของ todayISO (เรียงเก่า → ใหม่) */
export function vpMonths(fromISO: string, todayISO: string): string[] {
  const [fy, fm] = fromISO.split("-").map(Number)
  const [ty, tm] = todayISO.split("-").map(Number)
  const out: string[] = []
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    if (out.length > 120) break   // กันวนไม่จบถ้าวันที่เพี้ยน
  }
  return out
}

export function vpVisible(receivedAt: string, status: VpStatus, todayISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) return false
  if (receivedAt >= vpWindowStart(todayISO)) return true
  return status !== "paid" && receivedAt >= vpLookbackStart(todayISO)
}

// ── ใครเห็นอะไร ────────────────────────────────────────────────────────────
/** คลังตระกูลสระบุรี (ไม่ใช่สาย DIST) — WMS ไม่ได้ติดตามการจ่ายของคลังนี้ จึงซ่อนจากพอร์ทัล
 *  กติกาเดียวกับ isSaraburi ใน app/api/ap-tracking/payment-import/route.ts */
export function isSaraburiWarehouse(w: string): boolean {
  const t = String(w ?? "")
  return t.includes("สระบุรี") && !t.includes("DIST")
}

/** "เงินสด (ไม่มีVAT)" ฯลฯ คือถังรวมซื้อเงินสด ไม่ใช่ร้านจริง — ไม่ออกบัญชีให้ */
export function isCashVendor(name: string): boolean {
  return String(name ?? "").trim().startsWith("เงินสด")
}

export function normVpUsername(v: unknown): string {
  return normVendorCode(v ?? "").trim().toUpperCase()
}

// ── สิ่งที่ส่งถึงเบราว์เซอร์เจ้าหนี้ ───────────────────────────────────────────
export type VpBill = {
  depositCode: string
  receivedAt: string
  supplierRefNo?: string
  vehicle?: string
  fleetNo?: string
  amount: number
  status: VpStatus
  payDate?: string
  paidDate?: string
}

export const VP_BILL_KEYS = [
  "depositCode", "receivedAt", "supplierRefNo", "vehicle", "fleetNo", "amount", "status", "payDate", "paidDate",
] as const

/** whitelist — สร้าง object ใหม่จากคีย์ที่อนุญาตเท่านั้น ค่าว่างไม่แบกคีย์
 *  payDate ส่งเฉพาะใบรอโอน · paidDate ส่งเฉพาะใบโอนแล้ว */
export function vpBillOf(x: {
  depositCode: string; receivedAt: string; supplierRefNo?: string; vehicle?: string; fleetNo?: string
  amount: number; status: VpStatus; payDate?: string; paidDate?: string
}): VpBill {
  const s = (v: unknown) => (v == null ? "" : String(v)).trim()
  const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : "")
  const out: VpBill = {
    depositCode: s(x.depositCode),
    receivedAt:  s(x.receivedAt),
    amount:      Number.isFinite(x.amount) ? Math.round(x.amount * 100) / 100 : 0,
    status:      x.status,
  }
  if (s(x.supplierRefNo)) out.supplierRefNo = s(x.supplierRefNo)
  if (s(x.vehicle))       out.vehicle       = s(x.vehicle)
  if (s(x.fleetNo))       out.fleetNo       = s(x.fleetNo)
  if (x.status === "scheduled" && ymd(x.payDate)) out.payDate  = ymd(x.payDate)
  if (x.status === "paid" && ymd(x.paidDate))     out.paidDate = ymd(x.paidDate)
  return out
}

export function vpNextTransfer(bills: VpBill[], todayISO: string): { date: string; count: number; amount: number } | null {
  const upcoming = bills.filter((b) => b.status === "scheduled" && b.payDate && b.payDate >= todayISO)
  if (!upcoming.length) return null
  const date = upcoming.reduce((min, b) => (b.payDate! < min ? b.payDate! : min), upcoming[0].payDate!)
  const same = upcoming.filter((b) => b.payDate === date)
  const amount = Math.round(same.reduce((n, b) => n + b.amount, 0) * 100) / 100
  return { date, count: same.length, amount }
}

// ── รายการสินค้าใน DD ────────────────────────────────────────────────────────
export type VpItem = { code: string; name: string; qty: string; unitPrice: number; total: number }

/** atms.deposit_items: item = "รหัส : ชื่อ" (ชื่ออาจมี ":" ต่อ) · ตัวเลขเป็น string มีจุลภาค */
export function vpItemsOf(items: { item?: string; qty?: string; unit_price?: string; total?: string }[]): VpItem[] {
  return (items ?? []).map((it) => {
    const raw = String(it?.item ?? "").trim()
    const at = raw.indexOf(":")
    const code = at > 0 ? raw.slice(0, at).trim() : ""
    const name = at > 0 ? raw.slice(at + 1).trim() : raw
    return {
      code, name,
      qty:       String(it?.qty ?? "").trim(),
      unitPrice: parseAmount(it?.unit_price),
      total:     parseAmount(it?.total),
    }
  })
}
