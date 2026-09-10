// lib/rfq-core.ts
// ตรรกะล้วนของฟอร์มขอราคาอู่ (Vendor RFQ) — import ได้แค่ทะเบียนประเภทการซ่อม
// เพื่อให้ทดสอบตรง ๆ ด้วย tsx และให้ฝั่งจอ/ฝั่ง API ใช้กฎชุดเดียวกัน
// spec: docs/superpowers/specs/2026-09-10-vendor-rfq-design.md
import { REPAIR_TYPES } from "@/lib/repair-type-master"

export type RfqSection = "labour" | "parts"
export type RfqStatus = "สร้างแล้ว" | "กำลังกรอก" | "ส่งแล้ว" | "ยืนยันแล้ว" | "ส่งกลับแก้" | "ยกเลิก"
export type EffectiveStatus = RfqStatus | "หมดอายุ"

export type RfqJob = {
  sheet: string; sheetTitle: string; seq: number; jobCode: string; name: string
  scope: string; tierCriteria: string; refHoursL: number | null; refHoursS: number | null
  version: number; active: boolean
}
export type RfqPart = {
  sheet: string; sheetTitle: string; seq: number; sku: string; name: string
  useWith: string; unit: string; version: number; active: boolean
}
export type Tier = { rate?: number; hours?: number; light?: number; mid?: number; heavy?: number }
export type RfqAnswer = {
  mode: "hourly" | "lump" | "skip"; L: Tier; S: Tier; sameAsL: boolean
  warrantyMonths?: number; note: string; at: string
}
export type RfqPartAnswer = {
  skip: boolean; priceL?: number; priceS?: number; sameAsL: boolean
  brand: string; warrantyMonths?: number; leadDays?: number; note: string; at: string
}
export type RfqContact = { name: string; phone: string; email: string; confirmedVendor: boolean; at: string }
export type RfqConfirm = { by: string; email: string; at: string; validFrom: string; validTo: string; note: string }
export type RfqInvite = {
  _id?: string
  token: string; vendor: string; sheets: string[]; sections: RfqSection[]; catalogVersion: number
  title: string; deadline: string; status: RfqStatus
  contact: RfqContact | null; openedAt: string | null
  items: Record<string, RfqAnswer>; parts: Record<string, RfqPartAnswer>
  submittedAt: string | null; submitNote: string
  confirm: RfqConfirm | null; returnNote: string
  createdBy: { name: string; email: string }; createdAt: string; updatedAt: string
}
export type RfqLogAction = "create" | "open" | "contact" | "submit" | "confirm" | "return" | "cancel" | "extend"
export type RfqLogEntry = {
  inviteId: string; action: RfqLogAction; from?: string; to?: string
  by: string; byEmail: string; note?: string; at: Date
}

// ── ชีต ─────────────────────────────────────────────────────────────────────
export const SVC_SHEET = "SVC"
/** ลำดับชีตตามไฟล์ต้นฉบับ — ใช้เรียงทุกที่ */
export const SHEET_ORDER = ["S45", "S37", "S39", "S35", "S33", "S47", "S61", "S59", "S31", "S43", "S65", "S85", SVC_SHEET]

/** รหัสที่ติ๊กในตารางความสามารถ (อู่นอก) → ชีตในฟอร์ม (spec §2.4)
 *  ทำจากทะเบียนเพื่อไม่ต้องจำเลข: จับด้วยชื่องาน (work) ยกเว้นที่ระบุตรง ๆ */
export const SHEET_OF_CODE: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  const WORK_TO_SHEET: Record<string, string> = {
    "ระบบโม่": "S45", "ระบบเบรกและคลัตช์": "S37", "ระบบเกียร์": "S37", "ระบบแอร์และไฟ": "S39",
    "ระบบช่วงล่าง": "S35", "ระบบเครื่องยนต์": "S33", "ระบบหม้อน้ำและท่อไอเสีย": "S47",
    "ระบบเชื้อเพลิง": "S61", "ระบบลม": "S59", "ระบบหัวเก๋ง": "S31", "ปะผุและทำสี": "S43", "ทำความสะอาด": "S85",
  }
  for (const r of REPAIR_TYPES) {
    if (r.side !== "อู่นอก") continue
    if (r.group === "PM") { out[r.code] = "S65"; continue }
    const s = WORK_TO_SHEET[r.work]
    if (s) out[r.code] = s
  }
  return out
})()

export function sheetsForVendor(codes: string[]): string[] {
  const set = new Set<string>([SVC_SHEET])
  for (const c of codes) { const s = SHEET_OF_CODE[c]; if (s) set.add(s) }
  return SHEET_ORDER.filter((s) => set.has(s))
}

// ── token ────────────────────────────────────────────────────────────────────
/** 18 ไบต์สุ่ม → base64url 24 ตัว · ใช้ Web Crypto ที่มีทั้ง Node ≥19 และ edge */
export function newToken(): string {
  const bytes = new Uint8Array(18)
  globalThis.crypto.getRandomValues(bytes)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ── สถานะ ────────────────────────────────────────────────────────────────────
const OPEN_STATUSES = new Set<RfqStatus>(["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้"])

export function effectiveStatus(inv: Pick<RfqInvite, "status" | "deadline">, today: string): EffectiveStatus {
  if (OPEN_STATUSES.has(inv.status) && inv.deadline < today) return "หมดอายุ"
  return inv.status
}

export function canVendorWrite(inv: Pick<RfqInvite, "status" | "deadline">, today: string): boolean {
  return OPEN_STATUSES.has(inv.status) && inv.deadline >= today
}

const TRANSITIONS: Record<"submit" | "confirm" | "return" | "cancel" | "extend", Set<RfqStatus>> = {
  submit:  new Set(["กำลังกรอก", "ส่งกลับแก้"]),
  confirm: new Set(["ส่งแล้ว"]),
  return:  new Set(["ส่งแล้ว"]),
  cancel:  new Set(["สร้างแล้ว", "กำลังกรอก", "ส่งแล้ว", "ส่งกลับแก้"]),
  extend:  new Set(["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้"]),
}
export function canTransition(from: RfqStatus, action: keyof typeof TRANSITIONS): boolean {
  return TRANSITIONS[action].has(from)
}

export const STATUS_META: Record<EffectiveStatus, { bg: string; fg: string }> = {
  "สร้างแล้ว":  { bg: "#F4F4F5", fg: "#52525B" },
  "กำลังกรอก":  { bg: "#EFF6FF", fg: "#1D4ED8" },
  "ส่งแล้ว":    { bg: "#FFFBEB", fg: "#92400E" },
  "ยืนยันแล้ว": { bg: "#ECFDF5", fg: "#047857" },
  "ส่งกลับแก้": { bg: "#FFF7ED", fg: "#C2410C" },
  "ยกเลิก":     { bg: "#FEF2F2", fg: "#B91C1C" },
  "หมดอายุ":    { bg: "#F4F4F5", fg: "#9CA3AF" },
}

// ── ความคืบหน้า ──────────────────────────────────────────────────────────────
export function partKey(sheet: string, sku: string): string { return `${sheet}|${sku}` }

export function progress(
  inv: Pick<RfqInvite, "items" | "parts" | "sheets" | "sections">,
  jobs: RfqJob[], parts: RfqPart[]
): { labour: { done: number; total: number }; parts: { done: number; total: number } } {
  const sheets = new Set(inv.sheets)
  const hasL = inv.sections.includes("labour"), hasP = inv.sections.includes("parts")
  const js = hasL ? jobs.filter((j) => sheets.has(j.sheet)) : []
  const ps = hasP ? parts.filter((p) => sheets.has(p.sheet)) : []
  return {
    labour: { done: js.filter((j) => !!inv.items[j.jobCode]).length, total: js.length },
    parts:  { done: ps.filter((p) => !!inv.parts[partKey(p.sheet, p.sku)]).length, total: ps.length },
  }
}

// ── ตรวจค่าที่อู่ส่งมา ─────────────────────────────────────────────────────────
const MAX_NUM = 9_999_999
const NOTE_MAX = 500
const num = (v: unknown): number | undefined | string => {
  if (v === undefined || v === null || v === "") return undefined
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  if (!Number.isFinite(n)) return "ตัวเลขไม่ถูกต้อง"
  if (n < 0) return "ตัวเลขต้องไม่ติดลบ"
  if (n > MAX_NUM) return "ตัวเลขเกินเพดาน"
  return Math.round(n * 100) / 100
}
const str = (v: unknown, max = NOTE_MAX) => String(v ?? "").trim().slice(0, max)
const nowIso = () => new Date().toISOString()

function tier(x: unknown): Tier | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const out: Tier = {}
  for (const k of ["rate", "hours", "light", "mid", "heavy"] as const) {
    const n = num(o[k]); if (typeof n === "string") return `${k}: ${n}`
    if (n !== undefined) out[k] = n
  }
  return out
}

export function applySameAsL(a: RfqAnswer): RfqAnswer {
  return a.sameAsL ? { ...a, S: { ...a.L } } : a
}
export function applyPartSameAsL(a: RfqPartAnswer): RfqPartAnswer {
  return a.sameAsL ? { ...a, priceS: a.priceL } : a
}

export function validateAnswer(x: unknown): RfqAnswer | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const mode = o.mode
  if (mode !== "hourly" && mode !== "lump" && mode !== "skip") return "mode ไม่ถูกต้อง"
  const L = tier(o.L); if (typeof L === "string") return `L ${L}`
  const S = tier(o.S); if (typeof S === "string") return `S ${S}`
  const w = num(o.warrantyMonths); if (typeof w === "string") return `รับประกัน: ${w}`
  return applySameAsL({
    mode, L, S, sameAsL: !!o.sameAsL,
    ...(w !== undefined ? { warrantyMonths: w } : {}),
    note: str(o.note), at: nowIso(),
  })
}

export function validatePartAnswer(x: unknown): RfqPartAnswer | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const pl = num(o.priceL); if (typeof pl === "string") return `฿ L: ${pl}`
  const ps = num(o.priceS); if (typeof ps === "string") return `฿ S: ${ps}`
  const w = num(o.warrantyMonths); if (typeof w === "string") return `รับประกัน: ${w}`
  const d = num(o.leadDays); if (typeof d === "string") return `ส่งมอบ: ${d}`
  return applyPartSameAsL({
    skip: !!o.skip, sameAsL: !!o.sameAsL,
    ...(pl !== undefined ? { priceL: pl } : {}), ...(ps !== undefined ? { priceS: ps } : {}),
    brand: str(o.brand, 120),
    ...(w !== undefined ? { warrantyMonths: w } : {}), ...(d !== undefined ? { leadDays: d } : {}),
    note: str(o.note), at: nowIso(),
  })
}

export function validateContact(x: unknown): Omit<RfqContact, "at"> | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const name = str(o.name, 120), phone = str(o.phone, 40), email = str(o.email, 120)
  if (!name) return "กรุณากรอกชื่อผู้ติดต่อ"
  if (!phone && !email) return "กรุณากรอกเบอร์โทรหรืออีเมลอย่างน้อย 1 อย่าง"
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "อีเมลไม่ถูกต้อง"
  if (!o.confirmedVendor) return "กรุณาติ๊กยืนยันชื่ออู่"
  return { name, phone, email, confirmedVendor: true }
}

// ── วันที่ (YYYY-MM-DD ล้วน ไม่ยุ่งกับ timezone) ──────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0")
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}
