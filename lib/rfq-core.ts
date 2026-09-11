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
/** กำลังการซ่อมของอู่ = จำนวนช่องซ่อม แยก หนัก/กลาง/เบา (ผู้ใช้นิยาม 2026-09-10) */
export type RfqCapacity = { bays: number; heavy: number; mid: number; light: number }

/** ข้อมูลอู่ที่อู่กรอกเอง (ผู้ใช้ขอ 2026-09-10): กำลังการซ่อม + พิกัด · ส่งแล้วจะถูกคัดลอกไป vendor_approval */
export type RfqProfile = {
  capacity: RfqCapacity
  lat?: number
  lng?: number
  /** ลิงก์ Google Maps ที่อู่วางมา (เก็บไว้ดูต้นทาง) */
  mapUrl: string
  address: string
  at: string
}

export type RfqContact = { name: string; phone: string; email: string; confirmedVendor: boolean; at: string }
export type RfqConfirm = { by: string; email: string; at: string; validFrom: string; validTo: string; note: string }
export type RfqInvite = {
  _id?: string
  token: string; vendor: string; sheets: string[]; sections: RfqSection[]; catalogVersion: number
  /** เลือกข้อย่อย (งานช่าง) เฉพาะบางงานในชีตที่ให้ · ไม่มี/ว่าง = ทุกงานของชีตนั้น (ผู้ใช้ขอ 2026-09-10) */
  jobCodes?: string[]
  /** หัวข้อที่จัดซื้อเพิ่มเองตอนสร้างลิงก์ (นอกแคตตาล็อก) — อยู่กับใบนี้เท่านั้น jobCode ขึ้นต้น "X-" (ผู้ใช้ขอ 2026-09-11) */
  customJobs?: RfqJob[]
  title: string; deadline: string; status: RfqStatus
  contact: RfqContact | null; openedAt: string | null
  profile?: RfqProfile | null
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

// ── งาน/อะไหล่ที่ใบนี้ให้เสนอ ────────────────────────────────────────────────
export function partKey(sheet: string, sku: string): string { return `${sheet}|${sku}` }

/** งานช่างที่ใบนี้ให้เสนอ: อยู่ในชีตที่ให้ และ (ถ้าเลือกข้อย่อยไว้) อยู่ในรายการที่เลือก · ส่วน labour ต้องเปิด */
export function jobsForInvite(inv: Pick<RfqInvite, "sheets" | "sections" | "jobCodes" | "customJobs">, jobs: RfqJob[]): RfqJob[] {
  if (!inv.sections.includes("labour")) return []
  const sheets = new Set(inv.sheets)
  const pick = inv.jobCodes?.length ? new Set(inv.jobCodes) : null
  const fromCatalog = jobs.filter((j) => sheets.has(j.sheet) && (!pick || pick.has(j.jobCode)))
  // หัวข้อที่เพิ่มเองมาต่อท้ายชีตของตัวเอง (จัดซื้อตั้งใจเพิ่ม จึงไม่ต้องผ่านการเลือกข้อย่อย)
  const custom = (inv.customJobs ?? []).filter((j) => sheets.has(j.sheet))
  const order = (s: string) => SHEET_ORDER.indexOf(s)
  return [...fromCatalog, ...custom].sort((a, b) => order(a.sheet) - order(b.sheet) || a.seq - b.seq)
}

export const CUSTOM_JOB_PREFIX = "X-"
export const isCustomJob = (code: string) => code.startsWith(CUSTOM_JOB_PREFIX)

/** ตรวจหัวข้อที่เพิ่มเอง (จาก modal) → RfqJob พร้อมรหัส X-<ชีต>-<ลำดับ> · seq 900+ ให้ต่อท้ายงานแคตตาล็อก */
export function validateCustomJobs(x: unknown, sheets: string[], version: number): RfqJob[] | string {
  if (!Array.isArray(x)) return []
  const out: RfqJob[] = []
  const per: Record<string, number> = {}
  for (const raw of x.slice(0, 50)) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    const sheet = String(o.sheet ?? "").trim()
    const name = String(o.name ?? "").trim().slice(0, 200)
    if (!sheets.includes(sheet)) return `หัวข้อเพิ่ม "${name || "?"}" อยู่ในชีตที่ไม่ได้ให้ (${sheet || "ว่าง"})`
    if (!name) return "หัวข้อเพิ่มต้องมีชื่องาน"
    per[sheet] = (per[sheet] ?? 0) + 1
    out.push({
      sheet, sheetTitle: String(o.sheetTitle ?? "").trim().slice(0, 120), seq: 900 + per[sheet],
      jobCode: `${CUSTOM_JOB_PREFIX}${sheet}-${per[sheet]}`, name,
      scope: String(o.scope ?? "").trim().slice(0, 500), tierCriteria: String(o.tierCriteria ?? "").trim().slice(0, 500),
      refHoursL: null, refHoursS: null, version, active: true,
    })
  }
  return out
}

/** อะไหล่ที่ใบนี้ให้เสนอ: ตามชีตทั้งชุด (ยังไม่มีเลือกข้อย่อยฝั่งอะไหล่) · ส่วน parts ต้องเปิด */
export function partsForInvite(inv: Pick<RfqInvite, "sheets" | "sections">, parts: RfqPart[]): RfqPart[] {
  if (!inv.sections.includes("parts")) return []
  const sheets = new Set(inv.sheets)
  return parts.filter((p) => sheets.has(p.sheet))
}

// ── ความคืบหน้า ──────────────────────────────────────────────────────────────

export function progress(
  inv: Pick<RfqInvite, "items" | "parts" | "sheets" | "sections" | "jobCodes">,
  jobs: RfqJob[], parts: RfqPart[]
): { labour: { done: number; total: number }; parts: { done: number; total: number } } {
  const js = jobsForInvite(inv, jobs)
  const ps = partsForInvite(inv, parts)
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
  if (!a.sameAsL) return a
  // ไม่ตั้ง priceS เป็น undefined ทิ้งไว้ — Mongo driver จะเก็บเป็น null แล้วฝั่งจอเจอ null แทน "ไม่กรอก"
  const { priceS: _drop, ...rest } = a
  void _drop
  return a.priceL === undefined ? rest : { ...rest, priceS: a.priceL }
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

// ── พิกัดจากลิงก์แผนที่ ───────────────────────────────────────────────────────
/** ดึง lat,lng จากข้อความ/ลิงก์ Google Maps รูปแบบที่เจอบ่อย:
 *  "13.7563, 100.5018" · …/@13.7563,100.5018,17z · ?q=13.7,100.5 · ?ll=… · /place/…/@… · !3d13.7!4d100.5
 *  ลิงก์ย่อ maps.app.goo.gl ไม่มีพิกัดในตัว ต้องให้ server ตามลิงก์ก่อน (ดู expandMapUrl ใน route) */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = (text ?? "").trim()
  if (!t) return null
  const pats = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|center|destination)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/,
  ]
  for (const re of pats) {
    const m = re.exec(t)
    if (!m) continue
    const lat = Number(m[1]), lng = Number(m[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  return null
}

const bayNum = (v: unknown): number | string => {
  if (v === undefined || v === null || v === "") return 0
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 999) return "จำนวนช่องต้องเป็นเลขจำนวนเต็ม 0–999"
  return n
}

/** ตรวจข้อมูลอู่จากฟอร์ม — ช่องซ่อมเป็นจำนวนเต็ม (ถ้าไม่ใส่รวม ใช้ผลบวก หนัก+กลาง+เบา) · พิกัดต้องมีทั้งคู่หรือไม่มีเลย */
export function validateProfile(x: unknown): Omit<RfqProfile, "at"> | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const c = (o.capacity && typeof o.capacity === "object" ? o.capacity : {}) as Record<string, unknown>
  const heavy = bayNum(c.heavy), mid = bayNum(c.mid), light = bayNum(c.light), baysRaw = bayNum(c.bays)
  for (const v of [heavy, mid, light, baysRaw]) if (typeof v === "string") return v
  const sum = (heavy as number) + (mid as number) + (light as number)
  const bays = (baysRaw as number) || sum
  if (bays < sum) return "ช่องซ่อมรวมต้องไม่น้อยกว่าผลรวม หนัก+กลาง+เบา"
  const capacity: RfqCapacity = { bays, heavy: heavy as number, mid: mid as number, light: light as number }
  const mapUrl = String(o.mapUrl ?? "").trim().slice(0, 500)
  const address = String(o.address ?? "").trim().slice(0, 300)
  let lat: number | undefined, lng: number | undefined
  const hasLat = o.lat !== undefined && o.lat !== null && o.lat !== "", hasLng = o.lng !== undefined && o.lng !== null && o.lng !== ""
  if (hasLat !== hasLng) return "พิกัดต้องมีทั้ง lat และ lng"
  if (hasLat) {
    lat = Number(o.lat); lng = Number(o.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "พิกัดไม่ถูกต้อง"
  } else {
    const p = parseLatLng(mapUrl)
    if (p) { lat = p.lat; lng = p.lng }
  }
  return { capacity, mapUrl, address, ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}) }
}

export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

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
