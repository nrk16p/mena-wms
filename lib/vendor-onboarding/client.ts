// New Vendor Onboarding — ตัวช่วยฝั่ง browser (fetch + อัปโหลด + จัดรูปแบบ)
// ใช้ทั้งหน้า public (/form-vendor, /form-vendor/docs/[token]) และหน้า admin (/vendors/onboarding)
// ไฟล์นี้ไม่มีของ server — import ได้จาก client component อย่างเดียว
import type {
  ActorRole, Criterion, DocSlot, OnboardingAction, OnboardingDoc, OnboardingStatus, OnboardingSummary,
  ScoreItem, DocStatus, VendorAnswers, VendorProfile,
} from "./types"

// ───────────────────────── รูปร่างข้อมูลจาก API ─────────────────────────

export type ConsentItemCfg = { id: string; required: boolean; label: string }

/** GET /api/form-vendor/config */
export type FormConfig = {
  criteria: Criterion[]
  docSlots: DocSlot[]
  consentItems: ConsentItemCfg[]
  consentVersion: string
  maxBytes: number
  maxFiles: number
  types: string[]
}

/** ไฟล์ที่อัปโหลดขึ้นที่เก็บแล้ว (ยังไม่ผูกกับใบ) */
export type UploadedFile = { key: string; name: string; size: number; contentType: string }

export type SubmitBody = {
  draftId: string
  consent: { items: { id: string; granted: boolean }[] }
  profile: VendorProfile
  answers: VendorAnswers
  documents: { slot: string; files: UploadedFile[] }[]
  idToken?: string | null
}

/** GET /api/form-vendor/link/[token] */
export type LinkInfo = {
  ref: string
  companyName: string
  status: OnboardingStatus
  requested: { slot: string; label: string; note?: string | null }[]
  expired: boolean
  /** ส่งไปแล้ว — ถ้า backend ส่งมา (ไม่มี = ดูจาก status) */
  used?: boolean
  maxBytes?: number
  maxFiles?: number
  types?: string[]
}

export type OnboardingCounts = Partial<Record<OnboardingSummary["status"], number>>

/** GET /api/vendors/onboarding */
export type ListResponse = {
  rows: OnboardingSummary[]
  counts: OnboardingCounts
  roles: ActorRole[]
  settings: { passThreshold: number }
}

/** เอกสารแบบเก่า (ใบลงทะเบียนสั้น) — ดู lib/vendor-register.ts */
export type LegacyDoc = {
  _id?: unknown
  id?: string
  firstName?: string
  lastName?: string
  fullName?: string
  onBehalf?: string | null
  address?: string
  phone?: string
  taxId?: string
  status?: string
  reviewedBy?: { name: string; email: string } | null
  reviewedAt?: string | null
  reviewNote?: string | null
  vendorCode?: string | null
  lineDisplayName?: string | null
  createdAt?: string
}

export type ActiveLink = { url: string; expiresAt: string; slots: string[]; usedAt?: string | null }

/** GET /api/vendors/onboarding/[id] */
export type DetailResponse = {
  doc: (OnboardingDoc & { id?: string }) | LegacyDoc
  roles: ActorRole[]
  canSendReview: { ok: boolean; reasons: string[] } | null
  activeLink?: ActiveLink | null
}

export type ActionResponse = { doc: OnboardingDoc; linkUrl?: string | null; linkExpiresAt?: string | null }

export type OnboardingSettings = {
  /** GET เท่านั้น — server บอกว่าแก้ได้ไหม */
  canEdit?: boolean
  passThreshold: number
  reviewerEmails: string[]
  approverEmails: string[]
  linkDays: number
}

export function isNewDoc(d: DetailResponse["doc"]): d is OnboardingDoc & { id?: string } {
  return (d as OnboardingDoc).schemaVersion === 2
}

// ───────────────────────── fetch ─────────────────────────

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

/** fetch + JSON · ไม่ ok = โยน ApiError ที่มีข้อความจาก server (ถ้ามี) */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  let res: Response
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new ApiError("เชื่อมต่อไม่ได้ ลองเช็กอินเทอร์เน็ตแล้วกดใหม่", 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    let msg = (data && typeof data === "object" && "error" in data && typeof data.error === "string") ? data.error : defaultError(res.status)
    // ข้อผิดรายช่องจาก server ({ errors: { field: msg } }) — ต่อท้าย 3 ข้อแรกให้รู้ว่าต้องแก้ตรงไหน
    const fieldErrs = data && typeof data === "object" && "errors" in data && data.errors && typeof data.errors === "object"
      ? Object.values(data.errors as Record<string, unknown>).filter((v): v is string => typeof v === "string") : []
    if (fieldErrs.length) msg += `: ${[...new Set(fieldErrs)].slice(0, 3).join(" · ")}`
    throw new ApiError(msg, res.status)
  }
  return data as T
}

function defaultError(status: number) {
  if (status === 401) return "หมดเวลาเข้าระบบ ล็อกอินใหม่แล้วลองอีกครั้ง"
  if (status === 403) return "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้"
  if (status === 404) return "ไม่พบข้อมูล อาจถูกลบหรือลิงก์ผิด"
  if (status === 429) return "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่"
  return `ทำรายการไม่สำเร็จ (${status}) ลองใหม่อีกครั้ง`
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// public
export const getFormConfig = () => api<FormConfig>("/api/form-vendor/config")
export const submitForm = (body: SubmitBody) => api<{ ref: string }>("/api/form-vendor", { method: "POST", json: body })
export const getLink = (token: string) => api<LinkInfo>(`/api/form-vendor/link/${encodeURIComponent(token)}`)
export const submitLink = (token: string, documents: SubmitBody["documents"]) =>
  api<{ ok?: boolean; ref?: string }>(`/api/form-vendor/link/${encodeURIComponent(token)}/submit`, { method: "POST", json: { documents } })

// admin
const base = "/api/vendors/onboarding"
export const listOnboarding = () => api<ListResponse>(base)
export const getOnboarding = (id: string) => api<DetailResponse>(`${base}/${encodeURIComponent(id)}`)
export const fileUrl = (id: string, key: string) => `${base}/${encodeURIComponent(id)}/file?key=${encodeURIComponent(key)}`
export const patchDocument = (id: string, body: { slot: string; status: DocStatus; note?: string }) =>
  api<{ doc: OnboardingDoc }>(`${base}/${encodeURIComponent(id)}/documents`, { method: "PATCH", json: body })
export const patchScores = (id: string, scores: ScoreItem[]) =>
  api<{ doc?: OnboardingDoc }>(`${base}/${encodeURIComponent(id)}/scores`, { method: "PATCH", json: { scores } })
export const postAction = (id: string, body: { action: OnboardingAction; note?: string; requestedSlots?: string[] }) =>
  api<ActionResponse>(`${base}/${encodeURIComponent(id)}/action`, { method: "POST", json: body })
export const patchVendorCode = (id: string, vendorCode: string) =>
  api<{ doc?: OnboardingDoc }>(`${base}/${encodeURIComponent(id)}/vendor-code`, { method: "PATCH", json: { vendorCode } })
export const getSettings = () => api<OnboardingSettings>(`${base}/settings`)
export const putSettings = (s: OnboardingSettings) => api<OnboardingSettings>(`${base}/settings`, { method: "PUT", json: s })

// ───────────────────────── อัปโหลด ─────────────────────────

/** ย่อรูปใหญ่ก่อนอัป (ด้านยาว ≤ 2000px, JPEG 0.85) — PDF/รูปเล็ก/ย่อไม่ได้ = คืนไฟล์เดิม */
export async function downscaleImage(file: File, maxSide = 2000): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.type === "image/jpeg") { bmp.close(); return file }
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" })
  } catch {
    return file
  }
}

/** PUT ไฟล์ไปที่ URL ที่ presign มา — ใช้ XHR เพื่อให้เห็น % */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`อัปโหลดไม่สำเร็จ (${xhr.status}) ลองใหม่อีกครั้ง`)))
    xhr.onerror = () => reject(new Error("อัปโหลดไม่สำเร็จ ลองเช็กอินเทอร์เน็ตแล้วกดใหม่"))
    xhr.onabort = () => reject(new Error("ยกเลิกแล้ว"))
    signal?.addEventListener("abort", () => xhr.abort())
    xhr.send(file)
  })
}

/** presign → PUT · presignUrl = /api/form-vendor/uploads/presign หรือ /api/form-vendor/link/[token]/presign */
export async function uploadFile(
  presignUrl: string,
  extra: Record<string, unknown>,
  slot: string,
  file: File,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const { key, url } = await api<{ key: string; url: string }>(presignUrl, {
    method: "POST",
    json: { ...extra, slot, name: file.name, size: file.size, contentType: file.type },
  })
  await putWithProgress(url, file, onProgress, signal)
  return { key, name: file.name, size: file.size, contentType: file.type }
}

// ───────────────────────── รูปแบบตัวเลข/วันที่ ─────────────────────────

export const digits = (s: string) => s.replace(/\D/g, "")
const group = (s: string, sizes: number[]) => {
  const out: string[] = []
  let i = 0
  for (const n of sizes) { if (i >= s.length) break; out.push(s.slice(i, i + n)); i += n }
  return out.join("-")
}
/** 0-0000-00000-00-0 */
export const fmtTaxId = (id: string) => group(id, [1, 4, 5, 2, 1])
/** 081-234-5678 · 02-123-4567 */
export const fmtPhone = (p: string) => group(p, p.startsWith("02") ? [2, 3, 4] : [3, 3, 4])

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/** 22 พ.ย. 69 */
export function thDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return `${get("day")} ${TH_MON[get("month") - 1]} ${String(get("year") + 543).slice(-2)}`
}

/** 22 พ.ย. 2569 (ปีเต็ม — ใช้ในใบพิมพ์) */
export function thDateLong(iso: string | null | undefined) {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", year: "numeric" })
}

/** 22 พ.ย. 69 09:41 */
export function thDateTime(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const t = d.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })
  return `${thDate(iso)} ${t}`
}

/** uuid v4 — crypto.randomUUID ไม่มีในเบราว์เซอร์เก่า/ไม่ใช่ https */
export function newDraftId(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID === "function") return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** คำตอบของ vendor เป็นข้อความอ่านง่าย */
export function answerText(c: Criterion, v: VendorAnswers[string] | undefined): string {
  if (v === undefined || v === null || v === "") return "—"
  if (c.input.kind === "yesno") return v === true ? "มี" : v === false ? "ไม่มี" : String(v)
  if (c.input.kind === "number") return `${v} ${c.input.unit}`
  return String(v)
}
