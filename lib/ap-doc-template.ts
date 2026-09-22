// lib/ap-doc-template.ts
// แม่แบบเอกสารประกบชุดส่งบัญชี "ตามผู้ขาย" — logic ล้วน (ไม่แตะ DB/React) ทดสอบด้วย scripts/check-ap-doc-template.ts
//
// ที่มา: ~/Documents/project/เอกสารปะกบชุดส่งบัญชีตามผู้ขาย.xlsx (ผู้ขาย × ชนิดเอกสาร, ติ๊ก ☑/☐)
// แม่แบบเก็บชื่อเอกสาร "ตามที่ผู้ขายรู้จัก" (ใบวางบิล กับ ใบแจ้งหนี้ แยกกัน) เพราะรูปที่ส่งให้ผู้ขายต้องบอกชัด
// ส่วนช่องติ๊กบนใบ DD ถูกรวมไว้ตั้งแต่ 17/08/2026 → แต่ละชนิดชี้ไปที่ช่องติ๊ก (check) ของ AP_DOC_FIELDS
//
// กติกาที่ผู้ใช้เลือก 22/09/2026: แม่แบบเป็น "ตัวช่วยบอก" เท่านั้น — ไม่เปลี่ยนกติกาครบชุด/ส่งบัญชี
// (ยังคงเป็น isDocSetComplete = เอกสารการเงิน ≥1 ใบ) · ใบรับสินค้า/ใบสั่งซื้อ ไม่อยู่ในแม่แบบ
// เพราะระบบดึงใบ DD/PO จาก ATMS เองทุกใบ

import { AP_DOC_FIELDS, docChecked, type ApDocKey, type ApDocs } from "@/lib/ap-tracking"

export type ApTplDocKey =
  | "billingNote" | "receipt" | "taxInvoice" | "invoice" | "cashBill" | "deliveryNote" | "debtAck"

// ลำดับตามคอลัมน์ใน Excel (ผู้ใช้คุ้นตา) · ใบรับสภาพหนี้ไม่มีใน Excel — เพิ่มเองได้ในหน้าเว็บ
export const AP_TEMPLATE_DOCS: { key: ApTplDocKey; label: string; excel: string; check: ApDocKey }[] = [
  { key: "billingNote",  label: "ใบวางบิล",                excel: "ใบวางบิล",       check: "invoice" },
  { key: "receipt",      label: "ใบเสร็จรับเงิน",          excel: "ใบเสร็จรับเงิน",  check: "receipt" },
  { key: "taxInvoice",   label: "ใบกำกับภาษี (ต้นฉบับ)",   excel: "ใบกำกับภาษี",    check: "taxInvoice" },
  { key: "invoice",      label: "ใบแจ้งหนี้",              excel: "ใบแจ้งหนี้",      check: "invoice" },
  { key: "cashBill",     label: "บิลเงินสด",              excel: "บิลเงินสด",       check: "bill" },
  { key: "deliveryNote", label: "ใบส่งของ",               excel: "ใบส่งของ",        check: "bill" },
  { key: "debtAck",      label: "ใบรับสภาพหนี้",           excel: "",               check: "debtAck" },
]

const TPL_KEYS = new Set<string>(AP_TEMPLATE_DOCS.map((d) => d.key))

export type ApDocTemplate = {
  code: string              // รหัสผู้ขายของ ATMS (VEN-00008 / 142) — "" ได้ถ้าเป็นเจ้าที่เพิ่มเองไม่มีใน ATMS
  name: string
  docs: ApTplDocKey[]       // [] = ตั้งใจว่าไม่มีแม่แบบ (ยังเก็บไว้ กันสคริปต์นำเข้าทับของที่คนแก้)
  source: "excel" | "manual"
  updatedBy?: string
  updatedAt?: string
}

// ทำความสะอาดลิสต์ชนิดเอกสาร — ทิ้งคีย์แปลก ตัดซ้ำ แล้วเรียงตาม AP_TEMPLATE_DOCS เสมอ
// (ลำดับคงที่ ทำให้เทียบว่า "แก้หรือยัง" ด้วย join ได้ และรูปที่ส่งผู้ขายเรียงเหมือนกันทุกเจ้า)
export function cleanTemplateDocs(v: unknown): ApTplDocKey[] {
  if (!Array.isArray(v)) return []
  const want = new Set(v.map((x) => String(x ?? "").trim()).filter((k) => TPL_KEYS.has(k)))
  return AP_TEMPLATE_DOCS.map((d) => d.key).filter((k) => want.has(k))
}

export function templateDocLabel(key: ApTplDocKey): string {
  return AP_TEMPLATE_DOCS.find((d) => d.key === key)?.label ?? key
}

// ช่องติ๊กบนใบ DD ที่แม่แบบบังคับ — เรียงตาม AP_DOC_FIELDS (ลำดับเดียวกับที่โชว์ในโมดัล) ไม่ซ้ำ
export function templateRequiredChecks(docs: ApTplDocKey[] | undefined): ApDocKey[] {
  const need = new Set(
    (docs ?? []).map((k) => AP_TEMPLATE_DOCS.find((d) => d.key === k)?.check).filter(Boolean) as ApDocKey[],
  )
  return AP_DOC_FIELDS.map((f) => f.key).filter((k) => need.has(k))
}

// ป้ายของช่องติ๊กที่แม่แบบต้องการแต่ยังไม่ติ๊ก — ใช้ป้ายของช่องติ๊ก (สิ่งที่คนต้องไปกด)
// ไม่ใช่ชื่อตามแม่แบบ: ใบวางบิล+ใบแจ้งหนี้ ต้องการช่องเดียวกัน จะขึ้นเป็น "ใบแจ้งหนี้/ใบวางบิล" ครั้งเดียว
export function templateMissing(docs: ApTplDocKey[] | undefined, marks: ApDocs): string[] {
  return templateRequiredChecks(docs)
    .filter((k) => !docChecked(marks, k))
    .map((k) => AP_DOC_FIELDS.find((f) => f.key === k)?.label ?? k)
}

// ชนิดเอกสารในแม่แบบที่ชี้มาที่ช่องติ๊กนี้ — ขึ้นใต้ป้าย "ต้องมี" ให้รู้ว่าผู้ขายส่งอะไรมา
// (ช่อง "บิล/ใบส่งของ" ของเจ้าหนึ่งอาจหมายถึงบิลเงินสด อีกเจ้าหมายถึงใบส่งของ)
export function templateDocsForCheck(docs: ApTplDocKey[] | undefined, check: ApDocKey): string[] {
  const want = new Set(docs ?? [])
  return AP_TEMPLATE_DOCS.filter((d) => d.check === check && want.has(d.key)).map((d) => d.excel || d.label)
}

// ── นำเข้าจาก Excel ──────────────────────────────────────────────────────────
// รหัสผู้ขายในไฟล์มาได้ทั้ง "VEN-00008" และตัวเลขที่ Excel เก็บเป็น float (6 → 6.0)
// ต้องได้รูปเดียวกับ ap_supplier.atmsCode ("6") ไม่งั้นจับคู่ไม่ติด
export function normVendorCode(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v))
  const t = String(v ?? "").trim()
  return /^\d+\.0+$/.test(t) ? t.replace(/\.0+$/, "") : t
}

// แถวหนึ่งของชีต (คีย์ = หัวคอลัมน์ภาษาไทย) → ชนิดเอกสารที่ติ๊ก ☑
// ช่องว่าง/☐/อื่น ๆ = ไม่ติ๊ก · ใบรับสินค้า/ใบสั่งซื้อ ถูกข้ามเพราะไม่อยู่ใน AP_TEMPLATE_DOCS
export function templateDocsFromExcelRow(row: Record<string, unknown>): ApTplDocKey[] {
  return AP_TEMPLATE_DOCS
    .filter((d) => d.excel && String(row[d.excel] ?? "").trim() === "☑")
    .map((d) => d.key)
}

// ── ข้อความบนรูปที่ส่งผู้ขาย ────────────────────────────────────────────────────
// เทอมของ ATMS (Immediate/7D/…/90D) → ภาษาที่ผู้ขายอ่านรู้เรื่อง · เทอมแปลก/ว่าง = "" (ไม่พิมพ์บรรทัดนั้น)
export function creditTermText(term: string | undefined): string {
  const t = String(term ?? "").trim()
  if (t === "Immediate") return "ชำระทันที (ไม่มีเครดิต)"
  const m = /^(\d+)D$/.exec(t)
  return m ? `เครดิต ${Number(m[1])} วัน` : ""
}

// ที่ส่งเอกสาร/ผู้ติดต่อ ที่พิมพ์บนรูป — เหมือนกันทุกผู้ขาย
// ช่องที่ยังว่างจะไม่ถูกพิมพ์ และหน้าต่างพรีวิวจะเตือนให้กรอก (รอข้อความจริงจากผู้ใช้ 22/09/2026)
// เลขผู้เสียภาษี/สาขา ถอดออกพร้อมบล็อก "ออกเอกสารในนาม" บนรูป (ผู้ใช้สั่ง 22/09/2026)
export const AP_BILLING_INFO = {
  sendTo: "",                       // ส่งเอกสารที่ไหน (ที่อยู่/แผนก)
  contact: "",                      // ผู้ติดต่อ ชื่อ · โทร · LINE
} as const

export function billingInfoGaps(info: { sendTo: string; contact: string } = AP_BILLING_INFO): string[] {
  const gaps: string[] = []
  if (!info.sendTo.trim())  gaps.push("ที่ส่งเอกสาร")
  if (!info.contact.trim()) gaps.push("ผู้ติดต่อ")
  return gaps
}
