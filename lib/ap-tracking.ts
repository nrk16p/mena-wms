// lib/ap-tracking.ts
// ติดตามเจ้าหนี้ — logic ล้วน (ไม่แตะ DB/React) ทดสอบด้วย scripts/check-ap-tracking.ts
//
// กติกาหลัก: 1 แถว = 1 ใบ DD ต้อง "ประกบชุดเอกสาร" ให้ครบก่อนส่งบัญชี
//   ครบชุด = ✓DD + ✓PO + อย่างน้อย 1 ใน 5 เอกสารการเงิน

export type ApDocKey = "dd" | "po" | "bill" | "invoice" | "taxInvoice" | "receipt" | "billingNote"
export type ApDocMark = { checked: boolean; by: string; at: string }
export type ApDocs = Partial<Record<ApDocKey, ApDocMark>>
export type ApSentType = "" | "นอกรอบ" | "ตามรอบ"
export type ApStatus = "รอประกบ" | "ครบชุด" | "ส่งบัญชีแล้ว"

export const AP_DOC_FIELDS: { key: ApDocKey; label: string; short: string }[] = [
  { key: "dd",          label: "DD (ใบรับของ)",        short: "DD" },
  { key: "po",          label: "PO (ใบสั่งซื้อ)",       short: "PO" },
  { key: "bill",        label: "บิล/ใบส่งของ",          short: "บิล" },
  { key: "invoice",     label: "ใบแจ้งหนี้",            short: "แจ้งหนี้" },
  { key: "taxInvoice",  label: "ต้นฉบับใบกำกับภาษี",   short: "ใบกำกับ" },
  { key: "receipt",     label: "ใบเสร็จรับเงิน",        short: "ใบเสร็จ" },
  { key: "billingNote", label: "ใบวางบิล",              short: "วางบิล" },
]

// 5 ช่องการเงิน — ต้องมีอย่างน้อย 1 ช่องถึงจะครบชุด
export const FINANCE_DOC_KEYS: ApDocKey[] = ["bill", "invoice", "taxInvoice", "receipt", "billingNote"]

const isOn = (m?: ApDocMark) => Boolean(m?.checked)

export function isDocSetComplete(docs: ApDocs): boolean {
  if (!isOn(docs.dd) || !isOn(docs.po)) return false
  return FINANCE_DOC_KEYS.some((k) => isOn(docs[k]))
}

export function apStatusOf(docs: ApDocs, sentDate: string): ApStatus {
  if (sentDate) return "ส่งบัญชีแล้ว"
  return isDocSetComplete(docs) ? "ครบชุด" : "รอประกบ"
}

const AP_STATUS_META: Record<ApStatus, { value: ApStatus; emoji: string; cls: string; color: string }> = {
  "รอประกบ":       { value: "รอประกบ",       emoji: "🔴", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",       color: "#f43f5e" },
  "ครบชุด":        { value: "ครบชุด",        emoji: "🟡", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",    color: "#f59e0b" },
  "ส่งบัญชีแล้ว":  { value: "ส่งบัญชีแล้ว",  emoji: "✅", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",     color: "#22c55e" },
}
export const AP_STATUSES: ApStatus[] = ["รอประกบ", "ครบชุด", "ส่งบัญชีแล้ว"]
export function apStatusMeta(s: ApStatus) {
  return AP_STATUS_META[s] ?? AP_STATUS_META["รอประกบ"]
}

export const CREDIT_TERMS = ["Immediate", "7D", "15D", "30D", "60D"] as const
const TERM_DAYS: Record<string, number> = { Immediate: 0, "7D": 7, "15D": 15, "30D": 30, "60D": 60 }

export function termDays(term: string): number | null {
  const d = TERM_DAYS[String(term ?? "").trim()]
  return d === undefined ? null : d
}

// "DD/MM/YYYY" (อาจมีเวลาต่อท้าย) → "YYYY-MM-DD" · ค่าอื่น → ""
export function parseDmy(s: unknown): string {
  const t = String(s ?? "").trim().split(" ")[0]
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (!m) return ""
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

// "1,234.56" หรือ number → number · ค่าที่แปลงไม่ได้ → 0
export function parseAmount(s: unknown): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0
  const n = Number(String(s ?? "").replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

// คำนวณด้วย UTC เสมอ กัน timezone เลื่อนวัน
const toUTC = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN
}
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86_400_000

export function dueDateOf(receivedISO: string, term: string): string {
  const days = termDays(term)
  const base = toUTC(receivedISO)
  if (days === null || Number.isNaN(base)) return ""
  return fromUTC(base + days * DAY)
}

export function overdueDays(dueISO: string, todayISO: string): number {
  const due = toUTC(dueISO), today = toUTC(todayISO)
  if (Number.isNaN(due) || Number.isNaN(today) || today <= due) return 0
  return Math.round((today - due) / DAY)
}

// บัญชีโอน "นอกรอบ" ทุกวันพฤหัส — คืนวันพฤหัสที่ใกล้ที่สุดที่ >= วันที่ให้มา
export function nextThursday(fromISO: string): string {
  const base = toUTC(fromISO)
  if (Number.isNaN(base)) return ""
  const dow = new Date(base).getUTCDay()      // 0=อา, 4=พฤ
  return fromUTC(base + ((4 - dow + 7) % 7) * DAY)
}

const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
export function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  if (!m) return "—"
  return `${+m[3]} ${TH_MONTHS[+m[2] - 1]} ${(+m[1] + 543) % 100}`
}
