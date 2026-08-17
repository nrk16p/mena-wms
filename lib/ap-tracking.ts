// lib/ap-tracking.ts
// ติดตามเจ้าหนี้ — logic ล้วน (ไม่แตะ DB/React) ทดสอบด้วย scripts/check-ap-tracking.ts
//
// กติกาหลัก: 1 แถว = 1 ใบ DD ต้อง "ประกบชุดเอกสาร" ให้ครบก่อนส่งบัญชี
//   ครบชุด = มีเอกสารการเงินอย่างน้อย 1 ใน 5 ใบ
//
// เดิมนับ ✓DD + ✓PO ด้วย — ถอดออก 2026-08-17 ตามที่ผู้ใช้สั่ง: ตัวใบ DD กับ PO ระบบดึงมาจาก ATMS
// อยู่แล้ว (ทุกแถวคือใบ DD และ PO ผูกมาให้เห็นในโมดัล) การให้คนติ๊กซ้ำไม่ได้เพิ่มข้อมูลอะไร
// ผลพลอยได้: ใบที่ไม่มี PO ผูกใน ATMS เคยติดค้าง "รอประกบ" ตลอดกาลจนส่งบัญชีไม่ได้ — หายไปด้วย

import type { SkuImage } from "@/lib/media"

export type ApDocKey = "bill" | "invoice" | "taxInvoice" | "receipt" | "billingNote"
export type ApDocMark = { checked: boolean; by: string; at: string }
export type ApDocs = Partial<Record<ApDocKey, ApDocMark>>
export type ApItems = Record<string, ApDocMark>          // คีย์ = apItemKeys() ของรายการสินค้าในใบ
export type ApFile = SkuImage & { docType: ApDocKey | ""; by?: string; at?: string }
export type ApSentType = "" | "นอกรอบ" | "ตามรอบ"
export type ApStatus = "รอประกบ" | "ครบชุด" | "ส่งบัญชีแล้ว"

export const AP_DOC_FIELDS: { key: ApDocKey; label: string; short: string }[] = [
  { key: "bill",        label: "บิล/ใบส่งของ",          short: "บิล" },
  { key: "invoice",     label: "ใบแจ้งหนี้",            short: "แจ้งหนี้" },
  { key: "taxInvoice",  label: "ต้นฉบับใบกำกับภาษี",   short: "ใบกำกับ" },
  { key: "receipt",     label: "ใบเสร็จรับเงิน",        short: "ใบเสร็จ" },
  { key: "billingNote", label: "ใบวางบิล",              short: "วางบิล" },
]

// ช่องที่ถอดออกแล้ว — เก็บป้ายไว้อ่านประวัติของเก่า (log ที่บันทึกไว้ก่อน 17/08/2026 ยังอ้างคีย์พวกนี้)
const AP_RETIRED_DOC_LABELS: Record<string, string> = {
  dd: "DD (ใบรับของ)",
  po: "PO (ใบสั่งซื้อ)",
}

export function apDocLabel(key: string): string {
  return AP_DOC_FIELDS.find((f) => f.key === key)?.label ?? AP_RETIRED_DOC_LABELS[key] ?? key
}

// ช่องการเงินทั้งหมด — ต้องมีอย่างน้อย 1 ช่องถึงจะครบชุด (ตอนนี้ = ทุกช่องที่เหลือ)
export const FINANCE_DOC_KEYS: ApDocKey[] = AP_DOC_FIELDS.map((f) => f.key)

const isOn = (m?: ApDocMark) => Boolean(m?.checked)

export function isDocSetComplete(docs: ApDocs): boolean {
  return FINANCE_DOC_KEYS.some((k) => isOn(docs[k]))
}

// รายชื่อเอกสารที่ยังขาดก่อนจะครบชุด — ใช้ร่วมกันทั้ง API (ข้อความ 409) และปุ่มส่งบัญชีในตาราง
// เพื่อไม่ให้กติกา "ครบชุด" ถูกเขียนซ้ำคนละที่แล้วเพี้ยนจากกัน
export function missingDocLabels(docs: ApDocs): string[] {
  return isDocSetComplete(docs) ? [] : ["เอกสารการเงินอย่างน้อย 1 ใบ"]
}

// ── ติ๊กหลักฐานรายรายการสินค้า ────────────────────────────────────────────────
// คีย์ต้องเสถียรข้ามการดึงข้อมูลใหม่: atms.deposit_items ถูก "ลบแล้วเขียนใหม่" ทุกครั้งที่ scrape
// → _id เปลี่ยนทุกรอบ ใช้เป็นคีย์ไม่ได้ · ใช้รหัสสินค้าที่ต้นข้อความ ("S16CSE0021 : ชื่อสินค้า") แทน
// และห้ามมี "." หรือ "$" เพราะเป็นคีย์ของ sub-document ใน Mongo (เขียนแบบ items.<key>)
const sanitizeItemKey = (s: string) => s.replace(/[.$\s]+/g, "_").replace(/^_+|_+$/g, "")

export function apItemKeys(items: { item?: string }[]): string[] {
  const seen = new Map<string, number>()
  return items.map((it, idx) => {
    const raw  = String(it?.item ?? "").split(":")[0].trim()
    const base = sanitizeItemKey(raw) || `row${idx + 1}`
    const n    = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    // รหัสซ้ำในใบเดียวกัน (สินค้าเดิมคนละ serial) — ต่อลำดับกันชนกันเอง
    return n === 1 ? base : `${base}__${n}`
  })
}

export function apItemsDone(keys: string[], items: ApItems | undefined): number {
  if (!items) return 0
  return keys.filter((k) => isOn(items[k])).length
}

// ── ไฟล์แนบ ──────────────────────────────────────────────────────────────────
export const AP_FILES_MAX = 30

// จำนวนไฟล์แนบต่อประเภทเอกสาร — เอาไปโชว์ 📎N ข้างช่องติ๊ก
export function apFilesByDoc(files: ApFile[] | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of files ?? []) {
    const t = String(f?.docType ?? "")
    if (t) out[t] = (out[t] ?? 0) + 1
  }
  return out
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

// วันเริ่มใช้ระบบ (go-live) — ใบรับของที่ "รับก่อนวันนี้" เป็นของกระบวนการ Excel เดิม
// ปิดจบไปแล้วในไฟล์ เจ้าหนี้เดือน xx.xlsx ไม่ใช่ยอดค้างของระบบนี้ จึงตัดออกจากสโคปทั้งหมด
// เหตุผล: ap_tracking ยังว่าง (ยังไม่มีใครติ๊ก) ทุกใบที่ scraper เคยเก็บมาจึงเข้าเงื่อนไข
// "ยังไม่ส่งบัญชี" = ค้างยกมาหมด · วัดจริงก่อนใส่ cutoff: เปิดเดือน ส.ค. ได้ 11,203 แถว
// ฿155,807,603 ใช้เวลา 8.4 วินาที และเดือน ก.ค. ชนเพดาน 12,000 แถวจนข้อมูลถูกตัด
// แก้ที่เดียวตรงนี้ที่เดียว (ฝั่ง API อ่านค่านี้ไปใช้) · เปิดดูย้อนหลังได้ด้วย ?since=YYYY-MM-DD
export const AP_GO_LIVE = "2026-08-01"

// "YYYY-MM-DD" ที่เป็นวันที่จริง (ปฏิเสธ 2026-13-01 / 2026-02-30) — ไม่ใช่แค่รูปแบบถูก
function isValidYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

// ใบอยู่ในสโคปเมื่อวันรับของ >= cutoff (ทั้งคู่เป็น YYYY-MM-DD เทียบ string ตรง ๆ ได้)
// ไม่มีวันรับของที่อ่านได้ = วางบนเส้นเวลาไม่ได้ = นอกสโคป
export function inApScope(receivedISO: string, since: string = AP_GO_LIVE): boolean {
  return Boolean(receivedISO) && receivedISO >= since
}

// เดือนที่จบไปทั้งเดือนก่อน cutoff ไม่ต้องถามฐานข้อมูลเลย (ตัดตั้งแต่ตอนประกอบ $or)
export function monthInApScope(ym: string, since: string = AP_GO_LIVE): boolean {
  return Boolean(ym) && ym >= since.slice(0, 7)
}

// since ที่รับจาก query — ต้องเป็นวันที่จริงเท่านั้น ไม่ถูก/ไม่ส่งมา ถอยไปใช้ AP_GO_LIVE
export function apSinceOf(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim()
  return isValidYmd(v) ? v : AP_GO_LIVE
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

// "วันนี้" ตามเวลาไทย (Asia/Bangkok = UTC+7 ตลอดปี ไม่มี DST)
// ห้ามใช้ new Date().toISOString().slice(0,10) เป็นวันนี้ เพราะทั้งเซิร์ฟเวอร์ (Vercel) และ
// เบราว์เซอร์ที่ตั้ง TZ อื่น จะได้วันของ "เมื่อวาน" ในช่วง 00:00–07:00 เวลาไทย
// → วันครบกำหนด/จำนวนวันเกิน/"พฤหัสนี้" เลื่อนไปทั้งระบบ
export const ICT_OFFSET_MS = 7 * 60 * 60 * 1000
export function todayICT(): string {
  return new Date(Date.now() + ICT_OFFSET_MS).toISOString().slice(0, 10)
}

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

// วันพฤหัสที่กำลังจะถึง n ตัวถัดไป (ตัวแรก = พฤหัสนี้ ถ้าวันนี้เป็นพฤหัสก็คือวันนี้)
// ใช้เป็นตัวเลือกของ "นอกรอบ" — ผู้ใช้เลือกได้เฉพาะวันพฤหัสเท่านั้น ไม่ให้พิมพ์วันอื่นเอง
export function upcomingThursdays(fromISO: string, n = 4): string[] {
  const first = nextThursday(fromISO)
  if (!first) return []
  const base = toUTC(first)
  return Array.from({ length: Math.max(0, n) }, (_, i) => fromUTC(base + i * 7 * DAY))
}

const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
export function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  if (!m) return "—"
  return `${+m[3]} ${TH_MONTHS[+m[2] - 1]} ${(+m[1] + 543) % 100}`
}
