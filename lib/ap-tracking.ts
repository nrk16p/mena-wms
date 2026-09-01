// lib/ap-tracking.ts
// ติดตามเจ้าหนี้ — logic ล้วน (ไม่แตะ DB/React) ทดสอบด้วย scripts/check-ap-tracking.ts
//
// กติกาหลัก: 1 แถว = 1 ใบ DD ต้อง "ประกบชุดเอกสาร" ให้ครบก่อนส่งบัญชี
//   ครบชุด = มีเอกสารการเงินอย่างน้อย 1 ใบ (ชนิดเอกสารดู AP_DOC_FIELDS)
//
// เดิมนับ ✓DD + ✓PO ด้วย — ถอดออก 2026-08-17 ตามที่ผู้ใช้สั่ง: ตัวใบ DD กับ PO ระบบดึงมาจาก ATMS
// อยู่แล้ว (ทุกแถวคือใบ DD และ PO ผูกมาให้เห็นในโมดัล) การให้คนติ๊กซ้ำไม่ได้เพิ่มข้อมูลอะไร
// ผลพลอยได้: ใบที่ไม่มี PO ผูกใน ATMS เคยติดค้าง "รอประกบ" ตลอดกาลจนส่งบัญชีไม่ได้ — หายไปด้วย

import type { SkuImage } from "@/lib/media"

export type ApDocKey = "bill" | "invoice" | "taxInvoice" | "receipt" | "debtAck" | "billingNote"
export type ApDocMark = { checked: boolean; by: string; at: string }
export type ApDocs = Partial<Record<ApDocKey, ApDocMark>>
export type ApItems = Record<string, ApDocMark>          // คีย์ = apItemKeys() ของรายการสินค้าในใบ
export type ApFile = SkuImage & { docType: ApDocKey | ""; by?: string; at?: string }
export type ApSentType = "" | "นอกรอบ" | "ตามรอบ"
export type ApStatus = "รอประกบ" | "ครบชุด" | "ส่งบัญชีแล้ว"

// ใบวางบิลรวมเข้ากับใบแจ้งหนี้ 2026-08-17 (ผู้ใช้สั่ง) — เจ้าหนี้ส่วนใหญ่ส่งมาเป็นชุดเดียวกัน
// คีย์ที่ใช้เขียนคือ "invoice" ส่วน "billingNote" กลายเป็นคีย์เก่า (ไม่มีช่องติ๊กของตัวเองแล้ว)
export const AP_DOC_FIELDS: { key: ApDocKey; label: string; short: string }[] = [
  { key: "bill",       label: "บิล/ใบส่งของ",          short: "บิล" },
  { key: "invoice",    label: "ใบแจ้งหนี้/ใบวางบิล",   short: "แจ้งหนี้/วางบิล" },
  { key: "taxInvoice", label: "ต้นฉบับใบกำกับภาษี",   short: "ใบกำกับ" },
  { key: "receipt",    label: "ใบเสร็จรับเงิน",        short: "ใบเสร็จ" },
  // เพิ่ม 19/08/2026 — รถร่วม/เจ้าหนี้บางรายวางบิลเป็นใบรับสภาพหนี้ (เช่น SBAD26080007)
  { key: "debtAck",    label: "ใบรับสภาพหนี้",         short: "รับสภาพหนี้" },
]

// คีย์เก่าที่ยังต้อง "นับ" และ "เขียนได้": ใบที่เคยติ๊กใบวางบิลไว้ต้องไม่หลุดสถานะครบชุด
// และต้องล้างค่าได้เมื่อผู้ใช้เอาติ๊กช่องรวมออก (ไม่งั้นจะเหลือติ๊กผีที่มองไม่เห็นแต่ทำให้ยังครบชุด)
export const AP_LEGACY_DOC_KEYS: ApDocKey[] = ["billingNote"]

// เลขที่เอกสาร — ATMS ไม่มีให้ ต้องคีย์เอง · ใบ DD ใบเดียวมีเอกสารชนิดเดียวกันได้หลายใบ จึงเก็บเป็นลิสต์
// เดิมมีช่องเดียว (taxInvoiceNos) — เพิ่มอีก 3 ช่องวันที่ 18/08/2026 ตามที่ผู้ใช้สั่ง
// 25/08/2026 ถอด vatInvoiceNos ("เลขที่ใบกำกับภาษี") ออก — ซ้ำกับ taxInvoiceNos ที่แปลว่าใบเดียวกัน
// (ตอนถอดไม่มีใบไหนกรอกช่องนั้นเลยสักใบ จึงไม่ต้องย้ายข้อมูล) · taxInvoiceNos รับชื่อ "เลขที่ใบกำกับภาษี" แทน
// เพิ่มช่องที่ 5 ในอนาคต = เติมบรรทัดเดียวที่นี่ ทั้ง UI/API/ค้นหา วนจากตารางนี้ตัวเดียว
// (ช่อง "เลขที่ใบแจ้งหนี้/ใบวางบิล" เคยมีอยู่ช่วงสั้น ๆ วันที่ 17/08/2026 แล้วผู้ใช้สั่งเอาออก)
export type ApNoKey = "taxInvoiceNos" | "billingNoteNos" | "cashBillNos" | "ncAcNos" | "voucherNos"
export type ApDocNos = Record<ApNoKey, string[]>

export const AP_NO_FIELDS: { key: ApNoKey; label: string; short: string }[] = [
  { key: "taxInvoiceNos",  label: "เลขที่ใบกำกับภาษี",  short: "ใบกำกับภาษี" },
  { key: "billingNoteNos", label: "เลขที่ใบวางบิล",     short: "ใบวางบิล" },
  { key: "cashBillNos",    label: "เลขที่บิลเงินสด",    short: "บิลเงินสด" },
  { key: "ncAcNos",        label: "เลขที่ NC/AC",       short: "NC/AC" },      // เพิ่ม 19/08/2026
  // เลขตั้งหนี้ที่บัญชีออกตอนผ่าน (VoucherNo. จากไฟล์บัญชี เช่น LAPO26080130) — เพิ่ม 19/08/2026
  { key: "voucherNos",     label: "เลขที่ Voucher/ตั้งหนี้", short: "Voucher" },
]

export const AP_NO_MAX  = 60      // ความยาวต่อเลข
export const AP_NOS_MAX = 20      // จำนวนเลขต่อช่องต่อใบ

// ทำความสะอาดลิสต์เลขเอกสาร — ตัดช่องว่าง ทิ้งค่าว่าง ตัดซ้ำ (คีย์ผิดซ้ำกันบ่อย) และคุมเพดาน
export function cleanDocNos(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const raw of v) {
    const t = String(raw ?? "").trim().slice(0, AP_NO_MAX)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= AP_NOS_MAX) break
  }
  return out
}

// อ่านเลขทุกช่องจาก document เดียว — คืนครบทุกคีย์เสมอ (ช่องที่ยังไม่มีข้อมูล = [])
// เพื่อให้ทั้ง API และหน้าเว็บไม่ต้องเช็ค undefined ทีละช่อง
export function readDocNos(src: Record<string, unknown> | null | undefined): ApDocNos {
  return Object.fromEntries(
    AP_NO_FIELDS.map((f) => [f.key, cleanDocNos(src?.[f.key])]),
  ) as ApDocNos
}

// เหมือน readDocNos แต่ตัดช่องที่ว่างทิ้ง — ใช้กับ payload ของตารางที่ส่งทีละหมื่นแถว
// ส่งคีย์ว่างครบ 4 ช่องทุกแถวกินไปราว 90 bytes/แถว (~1.2MB ที่ 13,000 แถว) โดยไม่ได้ข้อมูลอะไรเลย
// ฝั่งอ่านต้องทนคีย์ที่หายไปได้ — docNosText กับ ApRow["docNos"] เป็น Partial ด้วยเหตุนี้
export function compactDocNos(src: Record<string, unknown> | null | undefined): Partial<ApDocNos> {
  const out: Partial<ApDocNos> = {}
  for (const f of AP_NO_FIELDS) {
    const v = cleanDocNos(src?.[f.key])
    if (v.length) out[f.key] = v
  }
  return out
}

// เลขทุกช่องรวมเป็นสายเดียวสำหรับค้นหา — ใช้ตัวเดียวกันทั้งฝั่ง API และฝั่งหน้าเว็บ
// ไม่งั้นค้นด้วยเลขใบวางบิลแล้วยอดสรุปกับตารางจะกรองคนละชุด
export function docNosText(src: Record<string, unknown> | null | undefined): string {
  return AP_NO_FIELDS.map((f) => cleanDocNos(src?.[f.key]).join(" ")).filter(Boolean).join(" ")
}

// ช่องที่ถอดออกแล้ว — เก็บป้ายไว้อ่านประวัติของเก่า (log ที่บันทึกไว้ก่อน 17/08/2026 ยังอ้างคีย์พวกนี้)
const AP_RETIRED_DOC_LABELS: Record<string, string> = {
  dd: "DD (ใบรับของ)",
  po: "PO (ใบสั่งซื้อ)",
  taxInvoiceNo:  "เลขที่ใบกำกับภาษี",         // ช่องเดี่ยวรุ่นแรก (ก่อนเปลี่ยนเป็นลิสต์)
  vatInvoiceNos: "เลขที่ใบกำกับภาษี",         // ช่องซ้ำ 18–25/08/2026 — รวมกลับเข้า taxInvoiceNos แล้ว
  invoiceNo: "เลขที่ใบแจ้งหนี้/ใบวางบิล",     // ถอดออกแล้ว
  billingNote: "ใบวางบิล (รวมกับใบแจ้งหนี้แล้ว)",
}

export function apDocLabel(key: string): string {
  return AP_DOC_FIELDS.find((f) => f.key === key)?.label
    ?? AP_NO_FIELDS.find((f) => f.key === key)?.label
    ?? AP_RETIRED_DOC_LABELS[key] ?? key
}

// ช่องการเงินทั้งหมดที่นับว่า "มีเอกสารแล้ว" = ช่องที่โชว์ + คีย์เก่าที่ยังมีข้อมูลค้างอยู่
export const FINANCE_DOC_KEYS: ApDocKey[] = [...AP_DOC_FIELDS.map((f) => f.key), ...AP_LEGACY_DOC_KEYS]
// คีย์ที่ API ยอมให้เขียน — รวมคีย์เก่าไว้ด้วยเพื่อล้างติ๊กผีได้
export const AP_WRITABLE_DOC_KEYS: ApDocKey[] = FINANCE_DOC_KEYS

const isOn = (m?: ApDocMark) => Boolean(m?.checked)

// ค่าติ๊กที่ควรโชว์ในช่องหนึ่ง ๆ — ช่องรวม "ใบแจ้งหนี้/ใบวางบิล" ต้องขึ้นว่าติ๊กแล้วด้วย
// ถ้าใบนั้นเคยติ๊กไว้ที่คีย์เก่า billingNote (ไม่งั้นเปิดใบเก่ามาจะเหมือนติ๊กหาย)
export function docChecked(docs: ApDocs, key: ApDocKey): boolean {
  if (key === "invoice") return Boolean(docs.invoice?.checked || docs.billingNote?.checked)
  return Boolean(docs[key]?.checked)
}

export function isDocSetComplete(docs: ApDocs): boolean {
  return FINANCE_DOC_KEYS.some((k) => isOn(docs[k]))
}

// รายชื่อเอกสารที่ยังขาดก่อนจะครบชุด — ใช้ร่วมกันทั้ง API (ข้อความ 409) และปุ่มส่งบัญชีในตาราง
// เพื่อไม่ให้กติกา "ครบชุด" ถูกเขียนซ้ำคนละที่แล้วเพี้ยนจากกัน
export function missingDocLabels(docs: ApDocs): string[] {
  return isDocSetComplete(docs) ? [] : ["เอกสารการเงินอย่างน้อย 1 ใบ"]
}

// ── บัญชีตรวจเอกสาร ──────────────────────────────────────────────────────────
// ขั้นตอนหลังจากจัดชุดเอกสารเสร็จ: บัญชีตรวจแล้วชี้ขาดว่าผ่านหรือไม่ผ่าน
// "ไม่ผ่าน" ต้องมีเหตุผลทุกครั้ง ไม่งั้นคนจัดเอกสารไม่รู้ว่าต้องแก้อะไร
export type ApReviewStatus = "" | "ผ่าน" | "ไม่ผ่าน"
export type ApReview = { status: ApReviewStatus; note: string; by?: string; at?: string }
export const AP_REVIEW_STATUSES: ApReviewStatus[] = ["ผ่าน", "ไม่ผ่าน"]
export const AP_REVIEW_NOTE_MAX = 500

const AP_REVIEW_META: Record<string, { emoji: string; label: string; cls: string }> = {
  "":         { emoji: "⏳", label: "ยังไม่ตรวจ", cls: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" },
  "ผ่าน":     { emoji: "✅", label: "บัญชีตรวจผ่าน", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  "ไม่ผ่าน":  { emoji: "❌", label: "บัญชีตีกลับ",   cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
}
export function apReviewMeta(status: string) {
  return AP_REVIEW_META[status] ?? AP_REVIEW_META[""]
}

// ตีกลับต้องบอกเหตุผลเสมอ — กติกาเดียวใช้ทั้งปุ่มบันทึกฝั่งหน้าเว็บและ API
export function reviewNeedsNote(status: string, note: string): boolean {
  return status === "ไม่ผ่าน" && !String(note ?? "").trim()
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

// ── ตรวจรายการสินค้ากับ ATMS ─────────────────────────────────────────────────
// แทนการติ๊กหลักฐานด้วยมือ: ระบบเทียบเองว่ารายการที่เก็บไว้ยังตรงกับ ATMS หรือไม่
//
// เทียบยังไง: ยอดหัวใบ (deposit_header.amount) ถูกรีเฟรชทุกรอบ sync ส่วนรายการสินค้า
// (deposit_items) ดึงมาคนละจังหวะ → ถ้าใครแก้ใบใน ATMS แล้วรายการเราค้าง สองฝั่งจะไม่ตรงกัน
// ผลรวมรายการ ≠ ยอดหัวใบ จึงเป็นสัญญาณว่าข้อมูลบรรทัดเชื่อไม่ได้ (เคสจริง LBDD26080471
// 21/08/2026: ราคาน้ำกลั่นถูกแก้ 8 → 10 หลังเราดึงไปแล้ว หัวใบขึ้นเป็น 3,750 แต่รายการค้างที่ 3,510)
export type ApVerifyState = "ok" | "mismatch"
export type ApItemVerify = { state: ApVerifyState; at: string }
export type ApVerification = {
  rows: ApItemVerify[]
  okCount: number
  total: number
  itemsTotal: number
  headerAmount: number
  amountOk: boolean
  hasChecksum: boolean   // ใบที่หัวใบไม่มียอด (คืนสต็อก) เทียบไม่ได้ — อย่าขึ้นเตือนให้ตกใจเปล่า
  checkedAt: string      // scraped_at ล่าสุดในใบ ("" = ไม่รู้เวลา — ของที่ดึงมาก่อนมีฟิลด์นี้)
  warning: string
}

// ยอมให้ต่างได้เท่าไหร่: ATMS ปัดเศษ "รวม" ทีละบรรทัด ใบที่มีหลายสิบบรรทัดจึงเพี้ยนได้ระดับสตางค์
// (วัดจริงจากทั้งคอลเลกชัน 16,472 ใบ — เพี้ยนสูงสุด 0.03 บาทที่ 39 บรรทัด)
const verifyTolerance = (rows: number) => Math.max(0.05, rows * 0.01)
const round2 = (n: number) => Math.round(n * 100) / 100

export function apItemVerification(
  items: { total?: string; scraped_at?: string | Date }[],
  headerAmount: unknown,
): ApVerification {
  const list        = items ?? []
  const total       = list.length
  const itemsTotal  = round2(list.reduce((n, it) => n + parseAmount(it?.total), 0))
  const amount      = parseAmount(headerAmount)
  const hasChecksum = amount > 0
  const diff        = round2(amount - itemsTotal)
  const amountOk    = !hasChecksum || Math.abs(diff) <= verifyTolerance(total)

  const times = list
    .map((it) => (it?.scraped_at instanceof Date ? it.scraped_at.toISOString() : String(it?.scraped_at ?? "")))
    .filter((s) => !Number.isNaN(Date.parse(s)))
  const checkedAt = times.length ? times.sort()[times.length - 1] : ""

  // เทียบรายบรรทัดไม่ได้ (เรามีแค่ชุดที่เก็บไว้ ไม่มีของ ATMS มาวางข้าง ๆ) — ใบไหนยอดไม่ตรง
  // ก็เชื่อไม่ได้ทั้งใบ จึงติดธงทุกบรรทัดเหมือนกันหมด ตรงไปตรงมากว่าเดาว่าบรรทัดไหนผิด
  const state: ApVerifyState = amountOk ? "ok" : "mismatch"
  const rows = list.map((it) => ({
    state,
    at: it?.scraped_at instanceof Date ? it.scraped_at.toISOString() : String(it?.scraped_at ?? ""),
  }))

  let warning = ""
  if (total === 0 && hasChecksum)
    warning = `ไม่มีรายการสินค้าในระบบ แต่ใบนี้มียอด ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท — ยังไม่ได้ดึงจาก ATMS`
  else if (!amountOk)
    warning = `รายการรวม ${itemsTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ไม่ตรงยอดใบ ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} (ต่าง ${Math.abs(diff).toLocaleString("th-TH", { minimumFractionDigits: 2 })}) — มีคนแก้ใบใน ATMS หลังระบบดึงข้อมูล`

  return { rows, okCount: amountOk ? total : 0, total, itemsTotal, headerAmount: amount,
           amountOk, hasChecksum, checkedAt, warning }
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

// ── ขั้นของงาน (แกนหลักของหน้า) ───────────────────────────────────────────────
// 1 ใบอยู่ได้ขั้นเดียวเท่านั้น — เดิมใบหนึ่งเป็นได้หลายอย่างพร้อมกัน (ส่งบัญชีแล้ว + บัญชีตรวจผ่าน)
// ทำให้ตัวเลขทับซ้อนกันจนบวกไม่ได้ · ลำดับข้างล่างคือลำดับความสำคัญ: "ไม่ผ่าน" ชนะทุกขั้น
// เพราะตีกลับแล้วต้องแก้ ไม่ว่าจะส่งไปแล้วหรือยัง
export type ApStage = "wait" | "ready" | "sent" | "passed" | "paid" | "rejected"

export const AP_STAGES: { key: ApStage; label: string; dot: string; hint: string }[] = [
  { key: "wait",     label: "รอประกบ",       dot: "bg-rose-500",    hint: "เอกสารยังไม่ครบชุด" },
  { key: "ready",    label: "ครบชุด",        dot: "bg-amber-400",   hint: "ครบแล้ว รอกดส่งบัญชี" },
  { key: "sent",     label: "ส่งบัญชีแล้ว",  dot: "bg-sky-500",     hint: "ส่งแล้ว รอบัญชีตรวจ" },
  { key: "passed",   label: "ผ่าน",          dot: "bg-emerald-500", hint: "บัญชีตรวจผ่าน รอจ่ายเงิน" },
  // เพิ่ม 21/08/2026 — มีหลักฐานจ่ายจริงจากการเงิน (เลข PV) = จบวงจรของใบ
  { key: "paid",     label: "จ่ายแล้ว",      dot: "bg-teal-500",    hint: "การเงินจ่ายเงินแล้ว (มีเลข PV)" },
  { key: "rejected", label: "ไม่ผ่าน",       dot: "bg-rose-600",    hint: "บัญชีตีกลับ ต้องแก้" },
]

export function apStageMeta(stage: ApStage) {
  return AP_STAGES.find((s) => s.key === stage) ?? AP_STAGES[0]
}

export function apStage(o: {
  docs: ApDocs
  sentDate: string
  review?: { status?: string } | null
  // มีหลักฐานจ่ายจริง (เลข PV จากการเงิน) — วันนี้มาจากไฟล์ อนาคตดึงจากระบบการเงินตรง
  paid?: { paymentNos?: string[] } | null
}): ApStage {
  const rv = String(o.review?.status ?? "").trim()
  if (rv === "ไม่ผ่าน") return "rejected"          // ตีกลับชนะทุกขั้น — จ่ายไปแล้วก็ต้องกลับมาแก้
  if (o.paid?.paymentNos?.length) return "paid"
  if (rv === "ผ่าน") return "passed"
  if (o.sentDate) return "sent"
  return isDocSetComplete(o.docs) ? "ready" : "wait"
}

// ── เส้นทางสถานะ (timeline) ───────────────────────────────────────────────────
// อ่านจาก log ที่ API เขียนไว้ — ใช้ `field` เป็นตัวชี้ (ไม่แกะจากข้อความ action ที่แปลได้หลายแบบ)
// 5 ช่วง: เริ่มประกบ → เอกสารครบชุด → ส่งบัญชี → บัญชีตรวจ → จ่ายเงิน (เพิ่ม 21/08/2026)
// "ไม่ผ่าน" นับเป็นช่วงที่เกิดแล้ว (state done) แต่ป้ายกับสีบอกว่าเป็นการตีกลับ
export type ApTimelineState = "done" | "current" | "todo" | "rejected"
export type ApTimelineStep = { key: string; label: string; at: string; by: string; state: ApTimelineState }
type ApLogEntry = { action?: string; field?: string; at?: string; by?: string }

const isDocField = (f: string) => FINANCE_DOC_KEYS.includes(f as ApDocKey)

export function apTimeline(
  log: ApLogEntry[] | undefined,
  o: {
    docs: ApDocs; sentDate: string; review?: { status?: string } | null; receivedAt?: string
    paid?: { paymentNos?: string[]; date?: string } | null
  },
): ApTimelineStep[] {
  const entries = Array.isArray(log) ? log : []
  // ติ๊กครั้งล่าสุด = เวลาที่ชุดเอกสารครบ (ประมาณจาก log — ไม่ได้เก็บ "เวลาที่ครบชุด" เป็นฟิลด์แยก)
  const lastTick = [...entries].reverse().find((e) => isDocField(String(e.field)) && String(e.action).startsWith("ติ๊ก"))
  const sentAt   = [...entries].reverse().find((e) => e.field === "sent" && String(e.action).startsWith("ส่งบัญชี"))
  const reviewAt = [...entries].reverse().find((e) => e.field === "review" && String(e.action).startsWith("บัญชีตรวจ"))

  const complete = isDocSetComplete(o.docs)
  const sent     = Boolean(o.sentDate)
  const rv       = String(o.review?.status ?? "").trim()

  const step = (key: string, label: string, e: ApLogEntry | undefined, state: ApTimelineState): ApTimelineStep =>
    ({ key, label, at: String(e?.at ?? ""), by: String(e?.by ?? ""), state })

  const paid = Boolean(o.paid?.paymentNos?.length)
  return [
    // ช่วงแรกเริ่มนับจาก "วันที่ทำ DD" ไม่ใช่เวลาที่คนเริ่มติ๊ก — จะได้เห็นว่าใบนอนรอกี่วัน
    // ก่อนมีใครแตะ (ถ้าใช้เวลาติ๊กครั้งแรก ใบที่ติ๊กรวดเดียวจะขึ้นเวลาเท่ากับช่วงถัดไปพอดี ไม่บอกอะไร)
    { key: "received", label: "รอประกบ", at: String(o.receivedAt ?? ""), by: "",
      state: (complete ? "done" : "current") as ApTimelineState },
    step("ready", "เอกสารครบชุด", complete ? lastTick : undefined,
      complete ? "done" : "todo"),
    step("sent", "ส่งบัญชี", sent ? sentAt : undefined,
      sent ? "done" : complete ? "current" : "todo"),
    step("review", rv === "ไม่ผ่าน" ? "บัญชีตีกลับ" : rv === "ผ่าน" ? "บัญชีตรวจผ่าน" : "รอบัญชีตรวจ",
      rv ? reviewAt : undefined,
      rv === "ไม่ผ่าน" ? "rejected" : rv === "ผ่าน" ? "done" : sent ? "current" : "todo"),
    // ช่วงจ่ายเงิน — วันที่มาจากทะเบียนการเงิน (paid.date เป็น YYYY-MM-DD ไม่มีเวลา)
    // by ใส่เลข PV ให้เห็นใน tooltip · ตีกลับ = วงจรสะดุด ช่วงนี้กลับเป็น todo
    { key: "paid", label: paid ? "จ่ายเงินแล้ว" : "รอจ่ายเงิน",
      at: paid ? String(o.paid?.date ?? "") : "",
      by: paid ? (o.paid?.paymentNos ?? []).join(", ") : "",
      state: (paid ? "done" : rv === "ผ่าน" ? "current" : "todo") as ApTimelineState },
  ]
}

// วันเริ่มใช้ระบบ (go-live) — ใบรับของก่อนวันนี้ไม่อยู่ในสโคป · แก้ที่เดียวตรงนี้ที่เดียว
// (ฝั่ง API อ่านค่านี้ไปใช้) · เปิดดูย้อนหลังกว่านี้ได้ด้วย ?since=YYYY-MM-DD
//
// เดิม 2026-08-01: ใบก่อนหน้านั้นปิดจบใน เจ้าหนี้เดือน xx.xlsx ไปแล้ว และ ap_tracking ยังว่าง
// ทุกใบเก่าจึงเข้าเงื่อนไข "ยังไม่ส่งบัญชี" = ค้างยกมาหมด
// ย้ายมา 2026-01-01 เมื่อ 18/08/2026 ตามที่ผู้ใช้สั่ง — รับผลที่ตามมาแล้ว: เปิดเดือน ส.ค.
// จะเห็นใบ ก.พ.–ก.ค. โผล่เป็น "ค้างยกมา · รอประกบ" หลักหมื่นใบ และยอดค้างในแถบสรุปพุ่งขึ้น
//
// วัดจริง 18/08/2026: deposit_header มี 16,099 ใบ และเป็นเดือน ม.ค.–ส.ค. 69 ทั้งหมด
// (ตัดแถวคืนสต๊อกภายในแล้วเหลือ 13,017) → เส้นนี้เท่ากับดึงทั้ง collection เข้าสโคป
// หน้าต่างที่หนักสุดคือเปิดเดือน ก.ค. = ม.ค.–ก.ค. 12,018 แถว ซึ่งชนเพดานเดิม 12,000 พอดี
// จึงต้องขยายเพดานใน route.ts พร้อมกัน ไม่งั้นข้อมูลถูกตัดเงียบ ๆ
export const AP_GO_LIVE = "2026-01-01"

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

// เลข DD/PO/PR ของ ATMS ฝังเดือนไว้ในตัว: LBDD26020004 → ปี 26 เดือน 02 → "2026-02"
// ใช้เป็นทางลัดตอนค้นข้ามเดือน — รู้เดือนได้ทันทีโดยไม่ต้องถามฐานข้อมูล
// คืน "" เมื่อไม่ใช่รูปแบบเลขเอกสาร หรือเดือนไม่มีจริง (เลข 13 ขึ้นไป)
export function monthFromCode(q: string): string {
  const m = /^[A-Z]{2,4}(?:DD|PO|PR)(\d{2})(\d{2})\d*$/.exec(q.trim().toUpperCase())
  if (!m) return ""
  const mo = Number(m[2])
  return mo >= 1 && mo <= 12 ? `20${m[1]}-${m[2]}` : ""
}

// ลิงก์เปิดหน้า ATMS ตรง ๆ — ผู้ใช้ล็อกอิน ATMS ในเบราว์เซอร์อยู่แล้ว (ระบบเดียวกับที่ scrape)
// path เดียวกับที่ scraper ใช้ · id เป็นเลขภายในของ ATMS ไม่ใช่เลขเอกสาร
export const ATMS_BASE = "https://www.mena-atms.com"
export const atmsDepositUrl = (id: number) => `${ATMS_BASE}/inv/deposit/view/id/${id}`
export const atmsPoUrl = (id: number) => `${ATMS_BASE}/inv/purchase.order/view/id/${id}`

// ── ข้อความแจ้งการเงินขอจ่ายนอกรอบ ─────────────────────────────────────────────
// จัดซื้อต้องอีเมลแจ้งผู้จัดการฝ่ายบัญชี/การเงินทุกครั้งที่มีใบตกรอบ — เดิมพิมพ์มือ
// สร้างจากข้อมูลที่มีอยู่แล้ว: ราย DD (เลือกหลายใบได้) จัดกลุ่มตามเจ้าหนี้
// สาเหตุเป็นช่องให้กรอก — ไม่ใส่ค่าเดาแทน เว้นบรรทัดไว้ถ้ายังไม่กรอก
export type ApFinanceItem = {
  depositCode: string; supplier: string; amount: number; purchaseOrder?: string
  docNos?: Partial<ApDocNos>       // เลขที่เอกสารทุกช่องที่กรอกไว้ — โชว์พร้อมป้ายชนิด
}

export function apFinanceRequestText(
  items: ApFinanceItem[], payThursdayISO: string, reason: string,
): { subject: string; body: string } {
  const bySup = new Map<string, ApFinanceItem[]>()
  for (const it of items) {
    const k = it.supplier || "(ไม่ระบุเจ้าหนี้)"
    bySup.set(k, [...(bySup.get(k) ?? []), it])
  }
  const total = items.reduce((n, it) => n + it.amount, 0)
  const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const lines: string[] = []
  lines.push("เรียน ผู้จัดการฝ่ายบัญชีและการเงิน", "")
  lines.push(`เนื่องด้วยมีเจ้าหนี้จำนวน ${bySup.size} ราย ตกรอบการจ่าย`)
  lines.push(`สาเหตุ: ${reason.trim() || "................................................................"}`)
  lines.push(`จึงขอพิจารณาจ่ายนอกรอบ ในรอบวันพฤหัสบดีที่ ${thaiDate(payThursdayISO)}`, "")
  lines.push("รายละเอียดตามรายการด้านล่าง", "")
  for (const [sup, its] of bySup) {
    lines.push(`เจ้าหนี้ ${sup}`)
    its.forEach((it, i) => {
      // อ้างอิง DD · PO · เลขที่เอกสารทุกช่องที่กรอกไว้ (พร้อมป้ายชนิด) — การเงินตามหา
      // เอกสารได้จากเลขไหนก็ได้ · ช่องที่ไม่ได้กรอกไม่โผล่ (ผู้ใช้สั่ง 19/08/2026: ใช้เลขจากที่กรอก)
      const docRefs = AP_NO_FIELDS
        .map((f) => {
          const vals = cleanDocNos(it.docNos?.[f.key])
          return vals.length ? `${f.short} ${vals.join(", ")}` : ""
        })
        .filter(Boolean)
      const ref = [
        it.depositCode,
        it.purchaseOrder ? `PO ${it.purchaseOrder}` : "",
        ...docRefs,
      ].filter(Boolean).join(" · ")
      lines.push(`  ${i + 1}. ${ref} = ${thb(it.amount)}`)
    })
    lines.push("")
  }
  lines.push(`รวมทั้งสิ้น ${thb(total)} บาท (${items.length} ใบ)`, "")
  lines.push("จึงเรียนมาเพื่อโปรดพิจารณา", "ขอขอบคุณ")
  return {
    subject: `ขออนุมัติจ่ายนอกรอบ พฤหัสที่ ${thaiDate(payThursdayISO)} · ${bySup.size} ราย · ${thb(total)} บาท`,
    body: lines.join("\n"),
  }
}

// ── การจ่ายเงินจริง (จากไฟล์การเงิน · อนาคต: ดึงจากระบบการเงินตรง) ─────────────
// เซลล์ DD ในไฟล์การเงินเขียนได้สารพัดรูป (เจอจริงทั้งหมด): เลขเดี่ยว · คั่น "/" "-" ","
// · สองเลขติดกันไม่มีตัวคั่นเลย (LBDD26010929LBDD26020081) · มี ".N"/จุดลอยต่อท้าย
// · ปนเลข PO มาด้วย — จึงไม่ split ตามตัวคั่น แต่ "ดึงทุกช่วงที่เป็นรูปเลข DD" ออกมาตรง ๆ
// (\d{6,} กันไปจับเลขสั้น ๆ ที่ไม่ใช่เลขใบ — เลขจริงมี YYMM+ลำดับ ≥ 8 หลัก)
export function parsePaymentDdCell(cell: string): string[] {
  const out: string[] = []
  for (const m of String(cell ?? "").matchAll(/[A-Z]{2,4}DD\d{6,}/g)) {
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

// ── ใบปะหน้าส่งเอกสารเข้า สกท. (export จากแท็บ "ผ่าน") ─────────────────────────
// โครงตามไฟล์จริงของบัญชี "ใบปะหน้าส่งเข้า สกท.ปี2569.xlsx" (ดูชีต 18.8.69):
// หัวฟอร์ม 7 แถว → หัวตาราง → รายการ "รายชิ้นสินค้า" (ใบ DD ใบเดียวมีหลายแถว) → ลายเซ็น
// ช่องที่คนกรอกเอง (เลขที่/ถึง/จาก/บริษัท) เว้นจุดไข่ปลาไว้เหมือนฟอร์มจริง
export type ApCoverRow = {
  date: string           // วันรับของ YYYY-MM-DD
  depositCode: string
  supplier: string
  item: string
  amount: number
  voucher: string
  billingNo: string
  note: string
}

export function apCoverSheetAoa(rows: ApCoverRow[], docDateISO: string): (string | number)[][] {
  const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "")
  const [y, m, d] = docDateISO.split("-")
  const total = rows.reduce((n, r) => n + r.amount, 0)
  const nDD = new Set(rows.map((r) => r.depositCode)).size
  const aoa: (string | number)[][] = [
    ["", "", "", "", "", "", "", "ส่งกลับคืน ศลบ (แสตมป์)"],
    ["", "", "", "", "", "ฟอร์มส่งเอกสาร และส่งของ"],
    ["", "", "", "", "", "", `เลขที่..................`],
    ["", "", "", "", "", "", `วันที่...${d}...เดือน...${m}...พ.ศ...${Number(y) + 543}`],
    ["", "ถึง.........................................."],
    ["", "จาก หน่วย/แผนก.........................................."],
    ["", "", "บริษัท..........................", `หมายเลขเอกสาร ตั้งแต่...............ถึง...............`],
    ["", "วันที่", "DD", "ซัพพลายเออร์", "ชื่อสินค้า", "ยอดเงิน", "Voucher No. เลขตั้งหนี้", "ใบวางบิลเลขที่", "หมายเหตุ"],
    ...rows.map((r): (string | number)[] =>
      ["", dmy(r.date), r.depositCode, r.supplier, r.item, r.amount, r.voucher, r.billingNo, r.note]),
    ["", "", "", "", "รวม", Math.round(total * 100) / 100, "", "", `${nDD} ใบ / ${rows.length} รายการ`],
    [],
    ["", "", "..............................", "", "..............................", "", ".............................."],
    ["", "", "บัญชี ศลบ", "", "บัญชี สกท.", "", "วันที่ส่งเอกสารเข้า สกท."],
    ["", "", "ผู้จัดทำ", "", "ผู้รับเอกสาร"],
  ]
  return aoa
}

// ต้องตรงกับ master "ap term" ของ ATMS (/fin/ap.term/index) เพราะเทอมถูก sync มาจากที่นั่น —
// เทอมที่ไม่อยู่ในลิสต์นี้จะทำให้ termDays() คืน null แล้วใบตกกลุ่ม noTerm แบบเงียบ ๆ
export const CREDIT_TERMS = ["Immediate", "7D", "15D", "30D", "60D", "90D"] as const
const TERM_DAYS: Record<string, number> = { Immediate: 0, "7D": 7, "15D": 15, "30D": 30, "60D": 60, "90D": 90 }

export function termDays(term: string): number | null {
  const d = TERM_DAYS[String(term ?? "").trim()]
  return d === undefined ? null : d
}

// แหล่งที่มาของเครดิตเทอมบนใบหนึ่ง เรียงตามความน่าเชื่อถือ:
//   override  — คนตั้งทับไว้เองในหน้า suppliers (ชนะทุกอย่าง)
//   po        — "ap term" บน PO ของใบนั้น = เทอมที่ตกลงกัน ณ ตอนสั่งซื้อจริง
//   supplier  — ค่าปัจจุบันของซัพพลายเออร์ (ใช้เมื่อใบไม่มี PO ผูก หรือ PO ไม่ได้ระบุเทอม)
// ทำไม po ต้องมาก่อน supplier: เทอมของเจ้าหนึ่งถูกแก้ใน ATMS ได้ตลอด ใบเก่าต้องคิดด้วยเทอมเดิม
// (วัดจริง 24/08/2026: 180 ใบปี 2026 ที่สองแหล่งไม่ตรงกัน เช่น สมบัติเซอร์วิส 141 ใบ PO=15D แต่ master=7D)
export type ApTermSource = "override" | "po" | "supplier" | ""
export function resolveCreditTerm(
  override: string, poTerm: string, supplierTerm: string,
): { creditTerm: string; termSource: ApTermSource } {
  const o = String(override ?? "").trim()
  if (o) return { creditTerm: o, termSource: "override" }
  const p = String(poTerm ?? "").trim()
  if (p) return { creditTerm: p, termSource: "po" }
  const m = String(supplierTerm ?? "").trim()
  if (m) return { creditTerm: m, termSource: "supplier" }
  return { creditTerm: "", termSource: "" }
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

export function addDays(iso: string, n: number): string {
  const base = toUTC(iso)
  return Number.isNaN(base) ? "" : fromUTC(base + n * DAY)
}

// ความเร่งด่วนของใบหนึ่ง — ใช้จัดสีแถบซ้ายในตาราง ตัวกรอง "ต้องรีบ" และแถบสัดส่วนยอดค้าง
// ให้ผลเดียวกับที่ API ใช้จัดกลุ่ม unsentAging เพื่อไม่ให้ตัวเลขบนแถบกับสีในตารางเล่าคนละเรื่อง
export type ApUrgency = "sent" | "overdue" | "due7" | "noTerm" | "ok"
export function apUrgency(dueISO: string, sentDate: string, todayISO: string): ApUrgency {
  if (sentDate) return "sent"
  if (!dueISO) return "noTerm"
  if (overdueDays(dueISO, todayISO) > 0) return "overdue"
  // นับ "อีกกี่วันถึงกำหนด" ตรง ๆ และรวมวันที่ 7 ด้วย ให้ตรงกับป้าย "≤7 วัน"
  // (สูตรเดิมใน API เทียบ overdueDays(due, today+7) > 0 ซึ่งทำให้ใบที่ครบกำหนดอีก 7 วันพอดี
  //  ตกไปอยู่กลุ่ม "ยังไม่ครบกำหนด" — ขัดกับป้ายของตัวเอง)
  return overdueDays(todayISO, dueISO) <= 7 ? "due7" : "ok"
}

// ใบที่เอกสารพร้อมแล้วแต่บัญชียังไม่ได้ชี้ขาด — คิวงานของฝ่ายบัญชีโดยตรง
export function needsAccountingReview(status: ApStatus, reviewStatus: string | undefined): boolean {
  return status !== "รอประกบ" && !String(reviewStatus ?? "").trim()
}

export function overdueDays(dueISO: string, todayISO: string): number {
  const due = toUTC(dueISO), today = toUTC(todayISO)
  if (Number.isNaN(due) || Number.isNaN(today) || today <= due) return 0
  return Math.round((today - due) / DAY)
}

// ── กำหนดจ่ายเงิน (เริ่มนับตอนบัญชีกดผ่าน) ─────────────────────────────────────
// กติกาจากผู้ใช้ 18/08/2026 — จุดตั้งต้นคือ "วันที่บัญชีกดผ่าน" ไม่ใช่วันส่งเอกสาร:
//   ตามรอบ (เครดิตยาว 30D/60D/Immediate): เอา "วันกดผ่าน" เข้ารอบตัด 25 ตรง ๆ ไม่บวกเครดิตก่อน
//           (แก้ 01/09/2026 ตามผู้ใช้ — เดิมบวกเทอมเป็นวันครบกำหนดแล้วค่อยตัดรอบ = คิดเครดิตซ้ำ)
//           ตัดรอบวันที่ 25 นับถึงสิ้นวัน (กดผ่านวันที่ 25 พอดี = ทันรอบนั้น)
//           จ่ายวันที่ 5 ของเดือนที่ 2 ถัดจากเดือนตัดรอบ · เสาร์-อาทิตย์ไม่เลื่อน
//           เทอมยาวทุกตัวจึงได้วันจ่ายเท่ากัน (ผู้ใช้ยืนยัน 01/09/2026) — "+2 เดือน" คือตัวเครดิตเอง
//   ตามรอบ (เครดิตสั้น 7D/15D — แก้ 21/08/2026): จ่ายรอบพฤหัสเหมือนนอกรอบ
//           นับจาก "วันที่ส่งเอกสารเข้าบัญชี" (sentMarkedAt) เส้นตายอังคาร → พฤหัสสัปดาห์ถัดไป
//           ถ้าพฤหัสรอบนั้นผ่านไปแล้วตอนบัญชีกดผ่าน นับใหม่จากวันกดผ่านแทน
//           ใบที่ตีกลับแล้วส่งตรวจใหม่ วันส่งใหม่คือจุดตั้งต้นรอบใหม่ (ดู resubmit ใน API)
//   นอกรอบ: โอนทุกวันพฤหัส · เส้นตายคือวันอังคาร (แก้จากวันพุธ 19/08/2026 ตามผู้ใช้)
//           ปิดรอบอังคารไหน จ่ายพฤหัส "สัปดาห์ถัดไป" ของอังคารนั้น (แก้ 28/08/2026 ตามผู้ใช้ —
//           เดิมจ่ายพฤหัสถัดจากอังคารนั้นเลย ทำให้ทุกใบเร็วไป 1 สัปดาห์)
//           (ต่างจาก nextThursday ของฝั่งจัดซื้อที่คืนพฤหัสถัดไปบนปฏิทินเฉย ๆ)
// สิ่งที่จัดซื้อเลือกตอนส่งบัญชีเป็นแค่ "คำขอ" — ตัวจริงคือค่าที่บัญชียืนยันตอนกดผ่าน
export type ApPayType = "ตามรอบ" | "นอกรอบ"
export type ApPaySchedule = {
  type: ApPayType
  dueDate: string        // ตามรอบเท่านั้น — วันครบกำหนดตามเครดิตเทอม ("" สำหรับนอกรอบ)
  cutoff: string         // ตามรอบเท่านั้น — วันที่ 25 ที่ใบนี้ทันรอบ
  payDate: string        // วันเงินออก
}
export const AP_PAY_TYPES: ApPayType[] = ["ตามรอบ", "นอกรอบ"]

const pad2 = (n: number) => String(n).padStart(2, "0")

// พฤหัสที่เงินออก — เส้นตายคือวันอังคาร แล้วจ่ายพฤหัส "สัปดาห์ถัดไป" ของอังคารที่ปิดรอบ
// (แก้ 28/08/2026 ตามผู้ใช้ — เดิมจ่ายพฤหัสถัดจากอังคารนั้นเลย ทำให้เร็วไป 1 สัปดาห์ทุกใบ)
//   อา.–อังคาร → ปิดรอบอังคารสัปดาห์นั้น · พุธ–เสาร์ → ตกไปปิดรอบอังคารสัปดาห์ถัดไป
// ตัวอย่าง: ส่ง/กดผ่าน ศ 28/08/2026 → ปิดรอบ อ 01/09 → จ่าย พฤ 10/09
export function payThursday(passedISO: string): string {
  const base = toUTC(passedISO)
  if (Number.isNaN(base)) return ""
  const dow = new Date(base).getUTCDay()          // 0=อา … 2=อังคาร … 4=พฤ
  return fromUTC(base + (dow <= 2 ? 11 - dow : 18 - dow) * DAY)
}

// วันอังคารที่ปิดรอบของวันจ่ายนั้น — จ่ายพฤหัสสัปดาห์ถัดไปเสมอ = ห่างจากอังคาร 9 วัน
// ใช้โชว์ใน UI ให้คนส่งเอกสารเห็นเส้นตายจริง ไม่ต้องไล่นับปฏิทินเอง
export function billingCutoff(passedISO: string): string {
  const thu = payThursday(passedISO)
  return thu ? addDays(thu, -9) : ""
}

// ตัวเลือกวันโอนตอนกดผ่าน — ค่าตั้งต้นคือพฤหัสที่ถูกต้องตามรอบ · เลื่อนออกได้อีก 1 สัปดาห์
// (เดิม default ดันไปเป็น "พฤหัสหน้า" เพื่อกันเงินออกเร็วเกินตอนกดผ่าน อา.–อังคาร — พอกติกา
//  28/08/2026 บวกสัปดาห์ให้ทุกวันอยู่แล้ว พฤหัสเร็วสุดก็คือวันที่ถูกต้องพอดี ไม่ต้องดันซ้ำ
//  ผลของ อา.–อังคาร จึงไม่ขยับ ขยับเฉพาะ พุธ–เสาร์ ที่เคยตอบเร็วไป 1 สัปดาห์)
export function payThursdayChoices(passedISO: string): { options: string[]; def: string } {
  const first = payThursday(passedISO)
  if (!first) return { options: [], def: "" }
  return { options: [first, addDays(first, 7)], def: first }
}

// ตามรอบ: วันครบกำหนด → (วันตัดรอบ 25, วันจ่าย 5 ของเดือนที่ 2 ถัดจากเดือนตัดรอบ)
export function payFromCutoff(dueISO: string): { cutoff: string; payDate: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueISO)
  if (!m) return { cutoff: "", payDate: "" }
  let y = +m[1], mo = +m[2]
  if (+m[3] > 25) { mo++; if (mo > 12) { mo = 1; y++ } }       // เลย 25 = ตกไปรอบเดือนถัดไป
  const cutoff = `${y}-${pad2(mo)}-25`
  mo += 2; if (mo > 12) { mo -= 12; y++ }                      // จ่ายเว้นหนึ่งเดือน (ผู้ใช้แก้ 19/08/2026)
  return { cutoff, payDate: `${y}-${pad2(mo)}-05` }
}

// คิดกำหนดจ่ายทั้งใบ — คืน null เมื่อคิดไม่ได้ (วันที่เพี้ยน · ตามรอบแต่ไม่มีเครดิตเทอม
// · หรือนอกรอบที่เลือกวันโอนนอกตัวเลือกที่ทันรอบ — เซิร์ฟเวอร์ใช้แยกตอบ 400)
export function apPaySchedule(
  passedISO: string, type: ApPayType, creditTerm: string, chosenPayDate?: string, sentDocISO?: string,
): ApPaySchedule | null {
  if (type === "นอกรอบ") {
    const { options, def } = payThursdayChoices(passedISO)
    if (!def) return null
    if (chosenPayDate && !options.includes(chosenPayDate)) return null
    return { type, dueDate: "", cutoff: "", payDate: chosenPayDate || def }
  }
  // เครดิตสั้น (7D/15D): รอบพฤหัส นับจากวันส่งเอกสารเข้าบัญชี — cutoff เว้นว่างเป็นตัวบอก UI
  // ว่าใบนี้ไม่ได้เดินสายตัดรอบ 25 · ไม่มีวันส่ง (ใบเก่าก่อนเก็บ sentMarkedAt) ใช้วันกดผ่านแทน
  if (isShortCredit(creditTerm)) {
    const base = sentDocISO || passedISO
    let payDate = payThursday(base)
    if (!payDate) return null
    if (payDate < passedISO) payDate = payThursday(passedISO)   // รอบจากวันส่งเลยไปแล้ว — นับจากวันกดผ่าน
    return { type, dueDate: dueDateOf(base, creditTerm), cutoff: "", payDate }
  }
  // ตัดรอบจากวันกดผ่าน "ตรง ๆ" ไม่บวกเครดิตก่อน (ผู้ใช้แก้ 01/09/2026) — เดิมบวกเทอมให้เป็น
  // วันครบกำหนดแล้วค่อยเอาไปตัดรอบ ซึ่งคิดเครดิตซ้ำสองชั้น เพราะขั้น "จ่ายวันที่ 5 ของเดือนที่ 2
  // ถัดจากเดือนตัดรอบ" ก็คือการให้เครดิตอยู่แล้ว · ผลคือใบข้ามเส้น 25 ไปเกาะรอบถัดไปทั้งที่ไม่ควร
  // (ใบ LBDD26081031 กดผ่าน 31/08 เทอม 30D: เดิม +30 วัน = 30/09 → ตัดรอบ 25/10 → จ่าย 05/12
  //  ที่ถูกคือ 31/08 เลย 25/08 แล้ว → ตัดรอบ 25/09 → จ่าย 05/11)
  // ผลพ่วงที่ผู้ใช้ยืนยันแล้ว: เทอมยาวทุกตัวได้วันจ่ายเท่ากัน — creditTerm เหลือหน้าที่แยกสาย
  // 7D/15D (รอบพฤหัส) ออกจากเทอมยาว จึงยังบังคับต้องมี ไม่งั้นเลือกสายไม่ได้
  if (!creditTerm) return null
  const { cutoff, payDate } = payFromCutoff(passedISO)
  if (!cutoff) return null
  // dueDate เว้นว่างเหมือนนอกรอบ — ไม่มีวันครบกำหนดที่ใช้คิดวันจ่ายอีกแล้ว การเก็บเลขที่ไม่ได้
  // ใช้งานไว้แล้วเอาไปโชว์คู่กับ "ครบกำหนด" บนหัวใบ (คนละตัวตั้ง) คือต้นเหตุที่คนอ่านสับสน
  return { type, dueDate: "", cutoff, payDate }
}

// วันที่จัดซื้อ "ขอ" ตอนกดส่งบัญชี (sentType + sentDate) ก็ถูกแช่ไว้แบบเดียวกับ pay — คิดตอน
// กดส่ง แล้วไม่มีใครคิดใหม่ กติกาที่เปลี่ยนทีหลังจึงไม่ย้อนไปถึงใบที่ยังรออยู่ในคิว
// ต่างจาก pay ตรงที่ค่านี้ "เลือกได้" — จัดซื้อกดเลื่อนออกไปเองได้หลายรอบ จึงตัดสินว่าเพี้ยน
// เฉพาะตอนที่ค่าที่เก็บไว้ "เร็วกว่า" วันเร็วสุดที่กติกาวันนี้ยอมให้เท่านั้น (clamp ขึ้นอย่างเดียว)
// เกณฑ์คือ "เร็วกว่ารอบของวันที่ส่งตัวเอง" ไม่ใช่ "ส่งมานานแค่ไหน" — ใบเก่าก็ถูก clamp ได้
// ถ้าวันของมันเร็วกว่ารอบของวันส่งตัวเอง (ตอนรันจริง 31/08/2026 ไม่มีใบก่อน ส.ค. เข้าเงื่อนไข
// สักใบ เพราะใบเก่าที่ยังค้างคิวเกือบทั้งหมดเป็นตามรอบเครดิตยาว ซึ่งฟังก์ชันนี้ไม่แตะ —
// นั่นเป็นเรื่องของข้อมูล ไม่ใช่ข้อรับประกันของกฎ)
// คืน "" = ไม่ต้องแก้ / ข้อมูลไม่พอจะตัดสิน
export function apSentRecalc(
  sentType: string, sentDate: string, sentMarkedDateISO: string, creditTerm: string,
): string {
  const type = String(sentType ?? "").trim()
  const date = String(sentDate ?? "").trim()
  const marked = String(sentMarkedDateISO ?? "").trim()
  if (!date || !marked) return ""
  // เครดิตยาว (30D/60D/Immediate) ตามรอบ: sentDate คือวันครบกำหนดจาก dueDateOf ซึ่งกติกา
  // ไม่เคยเปลี่ยน — และจัดซื้อแก้วันตั้งต้นเองได้ ไม่มีวัน "เร็วสุด" ให้เทียบ จึงไม่แตะ
  if (type === "ตามรอบ" && !isShortCredit(creditTerm)) return ""
  if (type !== "ตามรอบ" && type !== "นอกรอบ") return ""
  const earliest = payThursday(marked)
  if (!earliest) return ""
  return date < earliest ? earliest : ""
}

// เครดิตสั้น = เดินรอบพฤหัสแทนสายตัดรอบ 25 (กติกา 21/08/2026)
export function isShortCredit(term: string): boolean {
  const t = String(term ?? "").trim()
  return t === "7D" || t === "15D"
}

// ค่าใน pay ถูกคิดครั้งเดียวตอนบัญชีกดผ่านแล้วแช่ไว้ ไม่มีใครคิดใหม่ — กติกาที่เปลี่ยนทีหลัง
// จึงไม่ย้อนไปถึงใบเก่า หน้าเว็บโชว์เลขที่เลิกใช้แล้วอย่างเงียบ ๆ ทั้งที่ข้อความอธิบายข้าง ๆ
// render จากโค้ดใหม่ (เจอจริง 31/08/2026: ใบ 15D กดผ่าน 21/08 14:39 ยังเดินสายตัดรอบ 25
// ที่ถูกยกเลิกตอน 17:09 วันเดียวกัน — โชว์ "จ่าย 5 พ.ย." ทั้งที่กติกาใหม่คือ "จ่าย 3 ก.ย.")
// คืนตารางตามกติกาวันนี้เมื่อไม่ตรงกับที่เก็บไว้ · null = ตรงแล้ว / ข้อมูลไม่พอจะคิดใหม่
// ใช้ร่วมกันระหว่าง UI (ติดธงเตือน) กับ scripts/backfill-ap-pay.ts (เขียนทับ) — สูตรเดียว ไม่แตกสองทาง
export type ApPayStored = {
  type?: string; dueDate?: string; cutoff?: string; payDate?: string
  basis?: { passedDate?: string; creditTerm?: string } | null
  at?: string
}
export function apPayRecalc(pay: ApPayStored | null | undefined, sentDocISO: string): ApPaySchedule | null {
  if (!pay) return null
  const t = String(pay.type ?? "").trim()
  if (t !== "ตามรอบ" && t !== "นอกรอบ") return null
  const type = t as ApPayType
  // ตัวตั้งคือวันที่กดผ่านตอนนั้น ไม่ใช่วันนี้ — ผลจึงเป็น "ถ้าตอนนั้นใช้กติกาวันนี้จะได้อะไร"
  // ไม่ใช่เลื่อนวันจ่ายหนีไปเรื่อย ๆ ตามวันที่เปิดหน้าเว็บ
  const passed = String(pay.basis?.passedDate ?? "").trim() || ictDate(String(pay.at ?? ""))
  if (!passed) return null
  if (type === "นอกรอบ") {
    // บัญชีเลือกวันโอนเอง — ถือว่ายังใช้ได้ถ้าเป็นหนึ่งในตัวเลือกที่กติกาวันนี้ยอมรับ
    const { options, def } = payThursdayChoices(passed)
    if (!def || options.includes(String(pay.payDate ?? "").trim())) return null
    return { type, dueDate: "", cutoff: "", payDate: def }
  }
  const creditTerm = String(pay.basis?.creditTerm ?? "").trim()
  if (!creditTerm) return null
  const next = apPaySchedule(passed, type, creditTerm, undefined, sentDocISO)
  if (!next) return null
  const same = String(pay.dueDate ?? "").trim() === next.dueDate
    && String(pay.cutoff ?? "").trim() === next.cutoff
    && String(pay.payDate ?? "").trim() === next.payDate
  return same ? null : next
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

// ตัวเลือกวันโอน "นอกรอบ" ฝั่งจัดซื้อ — เริ่มจากพฤหัสที่ทันรอบจริงตามเส้นตายอังคาร
// (ต่างจาก upcomingThursdays ที่เริ่มจากพฤหัสถัดไปบนปฏิทิน ซึ่งเป็นรอบที่ปิดไปแล้ว)
export function upcomingPayThursdays(fromISO: string, n = 4): string[] {
  const first = payThursday(fromISO)
  if (!first) return []
  const base = toUTC(first)
  return Array.from({ length: Math.max(0, n) }, (_, i) => fromUTC(base + i * 7 * DAY))
}

const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

/** "2026-08" → "ส.ค. 69" — ชื่อเดือนแบบที่บัญชีใช้ตั้งชื่อชีต/ไฟล์
 *  คืนค่าเดิมเมื่อรูปแบบไม่ตรง ดีกว่าคืนค่าว่างจนชีตไม่มีชื่อ */
export function thaiMonthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim())
  if (!m) return String(ym ?? "")
  return `${TH_MONTHS[+m[2] - 1]} ${String(+m[1] + 543).slice(-2)}`
}
// timestamp ISO (UTC) → "17 ส.ค. 69 14:32" ตามเวลาไทย
// log เก็บเวลาเป็น UTC (new Date().toISOString()) ถ้าโชว์ตรง ๆ จะช้าไป 7 ชม.
// และงานที่ทำตอนเช้าไทยจะดูเหมือนเกิดเมื่อวาน
export function thaiDateTime(iso: string): string {
  const ms = Date.parse(String(iso ?? ""))
  if (Number.isNaN(ms)) return "—"
  const d = new Date(ms + ICT_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${thaiDate(d.toISOString().slice(0, 10))} ${hh}:${mm}`
}

// ── วันที่กดส่งบัญชี (จัดซื้อเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว") ────────────────
// คนละตัวกับ sentDate ซึ่งคือ "วันที่เงินจะออก" (พฤหัสนอกรอบ/วันครบกำหนด) — เวลาที่คนกดปุ่ม
// เคยอยู่ใน log อย่างเดียว ซึ่ง API ตารางตัดทิ้ง (projection log:0) จึงเก็บเป็นฟิลด์ sentMarkedAt

// timestamp ISO (UTC) → "YYYY-MM-DD" ตามเวลาไทย · อ่านไม่ออก → ""
// ต้องบวก ICT ก่อนตัด ไม่งั้นงานที่กดตอนเช้าไทย (ก่อน 07:00) จะไปกองอยู่กลุ่มของเมื่อวาน
export function ictDate(iso: string): string {
  const ms = Date.parse(String(iso ?? ""))
  return Number.isNaN(ms) ? "" : new Date(ms + ICT_OFFSET_MS).toISOString().slice(0, 10)
}

// อยู่ในช่วงวันที่ไหม — ปลายไหนว่าง = ไม่จำกัดด้านนั้น (ทุกค่าเป็น YYYY-MM-DD เทียบ string ตรง ๆ ได้)
// ไม่ได้ตั้งช่วงเลย = ผ่านหมด รวมถึงแถวที่ยังไม่มีวันที่ · ตั้งช่วงเมื่อไหร่ แถวที่ไม่มีวันที่ตกทันที
// (วางบนเส้นเวลาไม่ได้ = ตอบไม่ได้ว่าอยู่ในช่วงหรือเปล่า — กติกาเดียวกับ inApScope)
// ymd รับ undefined ได้ — แถวที่ยังไม่เคยกดส่งไม่มีคีย์นี้มาเลย (API ตัดคีย์ว่างทิ้ง) ไม่ใช่ ""
export function inDateRange(ymd: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!ymd) return false
  if (from && ymd < from) return false
  if (to && ymd > to) return false
  return true
}

// ปุ่มลัดของแถบกรอง — คิดจาก "วันนี้" ที่ส่งเข้ามา ไม่อ่านนาฬิกาเอง (เทสต์ได้ + ตรงกับ todayICT ที่หน้าใช้)
export type ApRangePreset = "today" | "7d" | "month"
export function apRangeOf(preset: ApRangePreset, todayISO: string): { from: string; to: string } {
  if (preset === "today") return { from: todayISO, to: todayISO }
  // "7 วันล่าสุด" นับรวมวันนี้ = ย้อนหลัง 6 วัน (ไม่ใช่ 7) ไม่งั้นจะได้ 8 วันตามป้ายที่เขียนไว้
  if (preset === "7d")   return { from: addDays(todayISO, -6), to: todayISO }
  return { from: `${todayISO.slice(0, 7)}-01`, to: todayISO }
}

// จัดกลุ่มแถวตามวัน เรียงวันใหม่ → เก่า · แถวที่ไม่มีวันที่ ("") ไปกองท้ายสุดเป็นกลุ่มเดียว
// ลำดับแถวภายในกลุ่มคงตามที่รับมา (ตารางเรียงมาแล้ว) — ไม่เรียงซ้ำให้เพี้ยนจากมุมมองรายการ
export function groupByDate<T>(rows: T[], dateOf: (r: T) => string | undefined): { date: string; rows: T[] }[] {
  const by = new Map<string, T[]>()
  for (const r of rows) {
    const d = dateOf(r) || ""
    const g = by.get(d)
    if (g) g.push(r)
    else by.set(d, [r])
  }
  return [...by.entries()]
    .map(([date, rs]) => ({ date, rows: rs }))
    .sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : a.date ? -1 : 1))
}

// ชื่อวันในสัปดาห์ — หัวกลุ่มของมุมมอง "จัดกลุ่มตามวันที่กดส่ง" (บัญชีโอนวันพฤหัส วันจึงมีความหมาย)
const TH_DOW = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]
export function thaiDow(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  return m ? TH_DOW[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : ""
}

export function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "")
  if (!m) return "—"
  return `${+m[3]} ${TH_MONTHS[+m[2] - 1]} ${(+m[1] + 543) % 100}`
}
