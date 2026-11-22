// lib/vendor-onboarding/validate.ts — ตรวจข้อมูลฝั่งเดียวกันทั้งฟอร์ม (client) และ API (server)
// ไฟล์นี้ต้องไม่ import ของ server (mongo / spaces / node:*) — UI import ได้
import { taxIdOk } from "../vendor-register"
import {
  CONSENT_ITEMS, CONSENT_VERSION, DOC_MAX_BYTES, DOC_MAX_FILES, DOC_TYPES, isDocRequired,
  type Criterion, type DocSlot, type EntityType, type VendorAnswers, type VendorProfile,
} from "./types"

/** ค่าตั้งของงานคัดเลือก (เอกสาร _id "default" ใน VO_SETTINGS_COLL) */
export type OnboardingSettings = {
  passThreshold: number
  reviewerEmails: string[]
  approverEmails: string[]
  linkDays: number
}

/** ข้อผิดพลาดรายช่อง — key เป็น path เช่น "profile.taxId", "profile.contact.phone", "answers.1.3", "documents.bookbank", "consent.core" */
export type FieldErrors = Record<string, string>

export const PROFILE_MAX = { companyName: 200, branch: 100, address: 500, productType: 200, name: 100, position: 100, email: 120 } as const
export const ANSWER_TEXT_MAX = 500
export const NOTE_MAX = 500

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const emailOk = (s: string) => s.length <= PROFILE_MAX.email && EMAIL_RE.test(s)
export const phoneOk = (s: string) => /^0\d{8,9}$/.test(s)

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const digits = (v: unknown) => str(v).replace(/\D/g, "")
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** body ใด ๆ → VendorProfile ที่ trim แล้ว (เบอร์/เลขภาษีเหลือแต่ตัวเลข · อีเมลตัวเล็ก) */
export function normalizeProfile(raw: unknown): VendorProfile {
  const b = obj(raw)
  const c = obj(b.contact)
  const et = str(b.entityType)
  return {
    entityType: (et === "company" || et === "individual" ? et : "") as EntityType,
    companyName: str(b.companyName),
    taxId: digits(b.taxId),
    branch: str(b.branch),
    address: str(b.address),
    phone: digits(b.phone),
    email: str(b.email).toLowerCase(),
    productType: str(b.productType),
    contact: { name: str(c.name), phone: digits(c.phone), email: str(c.email).toLowerCase(), position: str(c.position) },
  }
}

export function validateProfile(p: VendorProfile): FieldErrors {
  const e: FieldErrors = {}
  const len = (k: string, v: string, max: number) => { if (!e[k] && v.length > max) e[k] = `ยาวเกิน ${max} ตัวอักษร` }
  if (p.entityType !== "company" && p.entityType !== "individual") e["profile.entityType"] = "เลือกประเภทผู้ส่งมอบ"
  if (!p.companyName) e["profile.companyName"] = p.entityType === "individual" ? "กรอกชื่อ-นามสกุล" : "กรอกชื่อบริษัทหรือร้าน"
  if (p.taxId.length !== 13) e["profile.taxId"] = "เลขผู้เสียภาษีต้องมี 13 หลัก"
  else if (!taxIdOk(p.taxId)) e["profile.taxId"] = "เลขผู้เสียภาษีไม่ถูกต้อง ลองตรวจอีกครั้ง"
  if (!p.branch) e["profile.branch"] = "กรอกสาขา (หรือ สำนักงานใหญ่)"
  if (!p.address) e["profile.address"] = "กรอกที่อยู่"
  if (!phoneOk(p.phone)) e["profile.phone"] = "เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0"
  if (!p.email) e["profile.email"] = "กรอกอีเมล"
  else if (!emailOk(p.email)) e["profile.email"] = "อีเมลไม่ถูกต้อง"
  if (!p.productType) e["profile.productType"] = "กรอกประเภทสินค้าหรือบริการ"
  if (!p.contact.name) e["profile.contact.name"] = "กรอกชื่อผู้ประสานงาน"
  if (!phoneOk(p.contact.phone)) e["profile.contact.phone"] = "เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0"
  if (p.contact.email && !emailOk(p.contact.email)) e["profile.contact.email"] = "อีเมลไม่ถูกต้อง"
  len("profile.companyName", p.companyName, PROFILE_MAX.companyName)
  len("profile.branch", p.branch, PROFILE_MAX.branch)
  len("profile.address", p.address, PROFILE_MAX.address)
  len("profile.productType", p.productType, PROFILE_MAX.productType)
  len("profile.contact.name", p.contact.name, PROFILE_MAX.name)
  len("profile.contact.position", p.contact.position, PROFILE_MAX.position)
  return e
}

/** คำถามที่ vendor ต้องตอบ = criterion ที่ active + มี vendorQuestion + input ไม่ใช่ none */
export const vendorAsks = (c: Criterion) => c.active && c.vendorQuestion !== null && c.input.kind !== "none"

/** คำตอบตามชนิด: yesno = boolean (บังคับ) · number = ตัวเลข ≥ 0 (บังคับ) · text = ข้อความ (เว้นว่างได้)
 *  คืนคำตอบที่ทำความสะอาดแล้ว (ตัด key ที่ไม่มีในเกณฑ์ทิ้ง) + ข้อผิดพลาด */
export function normalizeAnswers(raw: unknown, criteria: Criterion[]): { answers: VendorAnswers; errors: FieldErrors } {
  const b = obj(raw)
  const answers: VendorAnswers = {}
  const errors: FieldErrors = {}
  for (const c of criteria.filter(vendorAsks)) {
    const v = b[c.key]
    const k = `answers.${c.key}`
    if (c.input.kind === "yesno") {
      if (typeof v === "boolean") answers[c.key] = v
      else errors[k] = "ตอบ มี หรือ ไม่มี"
    } else if (c.input.kind === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
      if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) answers[c.key] = n
      else errors[k] = `กรอกตัวเลข (${c.input.unit})`
    } else if (c.input.kind === "text") {
      const s = str(v)
      if (s.length > ANSWER_TEXT_MAX) errors[k] = `ยาวเกิน ${ANSWER_TEXT_MAX} ตัวอักษร`
      else answers[c.key] = s
    }
  }
  return { answers, errors }
}

/** ความยินยอม: ทุกข้อที่ required ต้อง granted · version ถ้าส่งมาต้องตรงกับปัจจุบัน */
export function normalizeConsent(raw: unknown): { items: { id: string; granted: boolean }[]; errors: FieldErrors; staleVersion: boolean } {
  const b = obj(raw)
  const given = new Map<string, boolean>()
  if (Array.isArray(b.items)) for (const it of b.items) { const o = obj(it); if (typeof o.id === "string") given.set(o.id, o.granted === true) }
  const errors: FieldErrors = {}
  const items = CONSENT_ITEMS.map((c) => ({ id: c.id as string, granted: given.get(c.id) === true }))
  for (const c of CONSENT_ITEMS) if (c.required && given.get(c.id) !== true) errors[`consent.${c.id}`] = "ต้องติ๊กยินยอมข้อนี้ก่อนส่ง"
  const staleVersion = typeof b.version === "string" && b.version !== CONSENT_VERSION
  return { items, errors, staleVersion }
}

export type FileInput = { key: string; name: string; size: number; contentType: string }

/** รายการไฟล์ที่ฟอร์มส่งมา [{slot, files:[{key,name,size,contentType}]}] → Map slot → files (รูปแบบผิดตัดทิ้งพร้อม error) */
export function normalizeDocInput(raw: unknown): { bySlot: Map<string, FileInput[]>; errors: FieldErrors } {
  const bySlot = new Map<string, FileInput[]>()
  const errors: FieldErrors = {}
  if (!Array.isArray(raw)) return { bySlot, errors }
  for (const d of raw) {
    const o = obj(d)
    const slot = str(o.slot)
    if (!slot) continue
    const files: FileInput[] = []
    for (const f of Array.isArray(o.files) ? o.files : []) {
      const x = obj(f)
      const file = { key: str(x.key), name: str(x.name).slice(0, 200), size: Number(x.size), contentType: str(x.contentType).toLowerCase() }
      if (!file.key) continue
      if (!DOC_TYPES.includes(file.contentType)) errors[`documents.${slot}`] = "รับเฉพาะไฟล์ PDF หรือรูป (jpg, png, webp)"
      else if (!Number.isFinite(file.size) || file.size <= 0 || file.size > DOC_MAX_BYTES) errors[`documents.${slot}`] = "ไฟล์ใหญ่เกิน 10 MB"
      files.push(file)
    }
    const all = [...(bySlot.get(slot) ?? []), ...files]
    if (all.length > DOC_MAX_FILES) errors[`documents.${slot}`] = `แนบได้ไม่เกิน ${DOC_MAX_FILES} ไฟล์ต่อรายการ`
    bySlot.set(slot, all)
  }
  return { bySlot, errors }
}

/** ช่องเอกสารที่อัปโหลดได้ (ไม่ใช่ system) */
export const uploadable = (s: DocSlot) => s.active && s.requirement !== "system"

/** เอกสารบังคับตามประเภทผู้ส่งมอบที่ยังไม่มีไฟล์ */
export function missingRequired(slots: DocSlot[], entity: EntityType, bySlot: Map<string, FileInput[]>): DocSlot[] {
  return slots.filter((s) => uploadable(s) && isDocRequired(s, entity) && !(bySlot.get(s.key)?.length))
}

/** ชื่อไฟล์สำหรับ key: ASCII ล้วน (CopyObject/URL ไม่ต้องกังวลเรื่อง encode) · ชื่อจริงเก็บใน record */
export function keySafeName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKD")
  const dot = base.lastIndexOf(".")
  const ext = dot > 0 ? base.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() : ""
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)
  return `${stem || "file"}${ext ? "." + ext : ""}`
}

/** ตรวจค่าตั้ง (PUT settings) */
export function normalizeSettings(raw: unknown): { settings: OnboardingSettings | null; errors: FieldErrors } {
  const b = obj(raw)
  const errors: FieldErrors = {}
  const t = Number(b.passThreshold)
  if (!Number.isInteger(t) || t < 1 || t > 21) errors.passThreshold = "เกณฑ์ผ่านต้องเป็นเลข 1–21"
  const days = Number(b.linkDays)
  if (!Number.isInteger(days) || days < 1 || days > 90) errors.linkDays = "อายุลิงก์ต้องเป็น 1–90 วัน"
  const emails = (k: "reviewerEmails" | "approverEmails") => {
    const arr = Array.isArray(b[k]) ? (b[k] as unknown[]) : []
    const out = [...new Set(arr.map((x) => str(x).toLowerCase()).filter(Boolean))]
    if (out.length > 20) errors[k] = "ใส่ได้ไม่เกิน 20 อีเมล"
    const bad = out.find((x) => !emailOk(x))
    if (bad) errors[k] = `อีเมลไม่ถูกต้อง: ${bad}`
    return out
  }
  const reviewerEmails = emails("reviewerEmails")
  const approverEmails = emails("approverEmails")
  if (Object.keys(errors).length) return { settings: null, errors }
  return { settings: { passThreshold: t, reviewerEmails, approverEmails, linkDays: days }, errors }
}
