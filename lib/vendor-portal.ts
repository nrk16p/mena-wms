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

/** ในช่วง 6 เดือนโชว์ทุกใบ · ก่อนช่วงโชว์เฉพาะใบ "รอโอน" (บัญชีผ่านแล้ว มีวันโอน)
 *  ไม่ใช้ "ยังไม่โอน" ทั้งหมด: ใบเก่ายุค Excel (ก่อน ส.ค. 69) หลายใบไม่มีหลักฐานจ่ายในระบบ
 *  จะค้าง "กำลังดำเนินการ" ทั้งที่จ่ายไปแล้ว (รีวิว 27/10/2569) */
export function vpVisible(receivedAt: string, status: VpStatus, todayISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) return false
  if (receivedAt >= vpWindowStart(todayISO)) return true
  return status === "scheduled" && receivedAt >= vpLookbackStart(todayISO)
}

// ── ใครเห็นอะไร ────────────────────────────────────────────────────────────
/** ชื่อที่ใช้ดึงใบให้บัญชีหนึ่ง — ตัดถังเงินสด (บิลหลายร้านปนกัน) และชื่อที่ ATMS มีหลายรหัส */
export function vpPortalNames(names: string[], ambiguous: Set<string>): string[] {
  return names.filter((n) => !isCashVendor(n) && !ambiguous.has(n))
}

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

// ── ด่านสิทธิ์ ───────────────────────────────────────────────────────────────
/** ใบนี้เจ้าที่ล็อกอินดูได้ไหม — ชื่อผู้ขายต้องอยู่ในชุดของบัญชี · ไม่ใช่คลังสระบุรี · อยู่ในช่วงเวลา
 *  ใช้ทั้งตอนดึงรายการใบและด่าน 404 ของรายการสินค้า (ไม่ผ่าน = ทำเหมือนหาใบไม่เจอ) */
export function vpCanSeeHead(
  head: { supplier?: string; warehouse?: string; receivedAt: string },
  names: string[],
  status: VpStatus,
  todayISO: string,
): boolean {
  const sup = String(head.supplier ?? "").trim()
  if (!sup || !names.includes(sup)) return false
  if (isSaraburiWarehouse(String(head.warehouse ?? ""))) return false
  return vpVisible(head.receivedAt, status, todayISO)
}

/** ชื่อที่ ATMS มีมากกว่า 1 รหัส — DD เก็บแค่ชื่อ จึงแยกไม่ได้ว่าเป็นของเจ้าไหน → ไม่ขึ้นให้ใครเห็นเลย */
export function vpAmbiguousNames(rows: { name?: string; code?: string }[]): Set<string> {
  const codes = new Map<string, Set<string>>()
  for (const r of rows ?? []) {
    const n = String(r?.name ?? "").trim()
    const c = String(r?.code ?? "").trim()
    if (!n) continue
    if (!codes.has(n)) codes.set(n, new Set())
    codes.get(n)!.add(c)
  }
  return new Set([...codes].filter(([, cs]) => cs.size > 1).map(([n]) => n))
}

// ── หน้าจัดการบัญชี (WMS) ─────────────────────────────────────────────────────
export type VpAccountInfo = { disabled: boolean; loginCount: number; lastLoginAt?: string; passwordSetAt?: string }
export type VpAccountRow = {
  username: string          // "" = ไม่มีรหัสผู้ขาย สร้างบัญชีไม่ได้
  atmsCode: string
  allNames: string[]        // ทุกชื่อใน ap_supplier ที่รหัสนี้ (ไว้จับคู่กับแถวในตาราง)
  names: string[]           // ชื่อที่เจ้าหนี้จะเห็นใบจริง (ตัดเงินสด/ชื่อซ้ำใน ATMS แล้ว)
  hiddenNames: string[]     // ชื่อซ้ำใน ATMS — ใบของชื่อนี้ไม่ขึ้นในพอร์ทัล
  displayName: string
  lastDdAt: string
  recent: boolean           // มีใบ DD ในช่วง 6 เดือน (นับจาก lastDdAt ที่ sync ไว้)
  eligible: boolean
  reason?: "ไม่มีรหัสผู้ขาย" | "เงินสด" | "ชื่อซ้ำใน ATMS"
  account?: VpAccountInfo
}

export function vpAccountRows(
  sups: { name?: string; atmsCode?: unknown; lastDdAt?: string }[],
  ambiguous: Set<string>,
  accounts: ({ username: string } & Partial<VpAccountInfo>)[],
  windowStart: string,
): VpAccountRow[] {
  const accBy = new Map(accounts.map((a) => [a.username, a]))
  const groups = new Map<string, { name: string; last: string }[]>()
  const out: VpAccountRow[] = []
  for (const x of sups) {
    const name = String(x.name ?? "").trim()
    if (!name) continue
    const last = String(x.lastDdAt ?? "").trim()
    const code = normVpUsername(x.atmsCode)
    if (!code) {
      out.push({ username: "", atmsCode: "", allNames: [name], names: [], hiddenNames: [], displayName: name,
        lastDdAt: last, recent: last >= windowStart, eligible: false, reason: "ไม่มีรหัสผู้ขาย" })
      continue
    }
    if (!groups.has(code)) groups.set(code, [])
    groups.get(code)!.push({ name, last })
  }
  for (const [code, list] of groups) {
    const allNames = list.map((l) => l.name)
    const cash = allNames.filter(isCashVendor)
    const hiddenNames = allNames.filter((n) => !isCashVendor(n) && ambiguous.has(n))
    const names = allNames.filter((n) => !isCashVendor(n) && !ambiguous.has(n))
    const lastDdAt = list.reduce((m, l) => (l.last > m ? l.last : m), "")
    const best = [...list].filter((l) => names.includes(l.name)).sort((a, b) => b.last.localeCompare(a.last))[0]
    const a = accBy.get(code)
    const row: VpAccountRow = {
      username: code, atmsCode: code, allNames, names, hiddenNames,
      displayName: best?.name ?? allNames[0],
      lastDdAt, recent: lastDdAt >= windowStart,
      eligible: names.length > 0,
    }
    if (!names.length) row.reason = cash.length === allNames.length ? "เงินสด" : "ชื่อซ้ำใน ATMS"
    if (a) row.account = {
      disabled: Boolean(a.disabled), loginCount: a.loginCount ?? 0,
      ...(a.lastLoginAt ? { lastLoginAt: a.lastLoginAt } : {}),
      ...(a.passwordSetAt ? { passwordSetAt: a.passwordSetAt } : {}),
    }
    out.push(row)
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "th"))
}

/** ข้อความที่จัดซื้อคัดลอกไปส่งไลน์ให้เจ้าหนี้ */
export function vpLineMessage(c: { username: string; password: string }, origin: string): string {
  return [
    "ลิงก์ดูสถานะบิลกับวันโอนเงินของร้านครับ",
    `${origin.replace(/\/+$/, "")}/vendor-portal`,
    `ชื่อผู้ใช้ ${c.username}`,
    `รหัสผ่าน ${c.password}`,
  ].join("\n")
}

// ── หน้าเจ้าหนี้: กรอง/ค้นหา/เรียง (ทำในเบราว์เซอร์ — ใบของเจ้าเดียวหลักร้อยใบ) ─────────────
export type VpSort = "recent" | "payDate" | "amount"
export type VpFilter = { q?: string; statuses?: VpStatus[]; months?: string[]; from?: string; to?: string; sort?: VpSort }

// ค้นแบบไม่สนตัวพิมพ์ ช่องว่าง และขีด — "715742" เจอ "71-5742"
const squash = (v: string) => v.toLowerCase().replace(/[\s-]+/g, "")

export function vpFilterBills(bills: VpBill[], f: VpFilter): VpBill[] {
  const q = squash(f.q ?? "")
  const st = new Set(f.statuses ?? [])
  const mo = new Set(f.months ?? [])
  const out = bills.filter((b) => {
    if (st.size && !st.has(b.status)) return false
    if (mo.size && !mo.has(b.receivedAt.slice(0, 7))) return false
    if (f.from && b.receivedAt < f.from) return false
    if (f.to && b.receivedAt > f.to) return false
    if (q) {
      const hay = [b.depositCode, b.fleetNo, b.vehicle, b.supplierRefNo].filter(Boolean).map((x) => squash(x!))
      if (!hay.some((h) => h.includes(q))) return false
    }
    return true
  })
  const recent = (a: VpBill, b: VpBill) =>
    b.receivedAt.localeCompare(a.receivedAt) || b.depositCode.localeCompare(a.depositCode)
  if (f.sort === "amount") return out.sort((a, b) => b.amount - a.amount || recent(a, b))
  if (f.sort === "payDate") {
    return out.sort((a, b) => {
      const pa = a.status === "scheduled" && a.payDate ? a.payDate : ""
      const pb = b.status === "scheduled" && b.payDate ? b.payDate : ""
      if (pa && pb) return pa.localeCompare(pb) || recent(a, b)
      if (pa || pb) return pa ? -1 : 1
      return recent(a, b)
    })
  }
  return out.sort(recent)
}

/** เดือนที่มีใบจริง (รวมใบค้างที่เก่ากว่าช่วง 6 เดือน) เรียงเก่า → ใหม่ */
export function vpBillMonths(bills: VpBill[]): string[] {
  return [...new Set(bills.map((b) => b.receivedAt.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort()
}

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
const TH_MON_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]

/** "2026-10-29" → "29 ต.ค. 69" */
export function vpThaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""))
  if (!m) return ""
  return `${Number(m[3])} ${TH_MON[Number(m[2]) - 1]} ${String(Number(m[1]) + 543).slice(-2)}`
}

/** "2026-10" → "ต.ค. 69" · full → "ตุลาคม 2569" */
export function vpMonthLabel(ym: string, full = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ""))
  if (!m) return ""
  const i = Number(m[2]) - 1
  return full ? `${TH_MON_FULL[i]} ${Number(m[1]) + 543}` : `${TH_MON[i]} ${String(Number(m[1]) + 543).slice(-2)}`
}

/** ข้อความวันที่ข้างป้ายสถานะ — เลยวันกำหนดโอนแต่การเงินยังไม่ยืนยัน = บอกตรง ๆ ว่ารอยืนยัน */
export function vpDueText(b: VpBill, todayISO: string): string {
  if (b.status === "paid") return b.paidDate ? `โอน ${vpThaiDate(b.paidDate)}` : ""
  if (b.status === "scheduled" && b.payDate) {
    return b.payDate < todayISO
      ? `ครบกำหนดโอน ${vpThaiDate(b.payDate)} · รอยืนยันยอดโอน`
      : `กำหนดโอน ${vpThaiDate(b.payDate)}`
  }
  return ""
}
