// lib/vendor-onboarding/public.ts — ฝั่ง vendor (ไม่มี login): ค่าฟอร์ม · ขอลิงก์อัปโหลด · ส่งใบสมัคร · ลิงก์ส่งเอกสารเพิ่ม
import {
  CONSENT_ITEMS, CONSENT_VERSION, DOC_MAX_BYTES, DOC_MAX_FILES, DOC_TYPES, OPEN_STATUSES,
  type Criterion, type DocEntry, type DocSlot, type OnboardingDoc, type OnboardingStatus,
} from "./types"
import { activeCriteria, activeDocSlots, appCol, getSettings, linkCol, nextRef, type LinkRow } from "./db"
import { bad, conflict, HttpError, notFound } from "./http"
import { checkUploadMeta, copyDraft, deleteKeysQuietly, DRAFT_ROOT, draftPrefix, isDraftId, presignUnder, refPrefix, VO_KEY_ROOT, verifyUploaded } from "./files"
import { verifyLineIdToken } from "./line"
import {
  missingRequired, normalizeAnswers, normalizeConsent, normalizeDocInput, normalizeProfile, uploadable, validateProfile,
  type FieldErrors,
} from "./validate"

/** GET /api/form-vendor/config */
export async function getPublicConfig() {
  const [criteria, docSlots] = await Promise.all([activeCriteria(), activeDocSlots()])
  return {
    criteria, docSlots,
    consentItems: CONSENT_ITEMS, consentVersion: CONSENT_VERSION,
    maxBytes: DOC_MAX_BYTES, maxFiles: DOC_MAX_FILES, types: DOC_TYPES,
  }
}

function findUploadSlot(slots: DocSlot[], key: unknown): DocSlot {
  const s = slots.find((x) => x.key === key)
  if (!s || !uploadable(s)) throw bad("ไม่พบรายการเอกสารนี้")
  return s
}

/** POST /api/form-vendor/uploads/presign */
export async function presignDraft(body: Record<string, unknown>) {
  if (!isDraftId(body.draftId)) throw bad("รหัสฟอร์มไม่ถูกต้อง รีเฟรชหน้าแล้วลองใหม่")
  const slot = findUploadSlot(await activeDocSlots(), body.slot)
  const meta = checkUploadMeta(body)
  return presignUnder(draftPrefix(body.draftId, slot.key), meta.name, meta.contentType, meta.size)
}

type SubmitCtx = { ip: string | null; userAgent: string | null }

/** POST /api/form-vendor — ส่งใบสมัคร คืนเลขที่ใบ */
export async function submitApplication(body: Record<string, unknown>, ctx: SubmitCtx): Promise<{ ref: string }> {
  if (!isDraftId(body.draftId)) throw bad("รหัสฟอร์มไม่ถูกต้อง รีเฟรชหน้าแล้วลองใหม่")
  const draftId = body.draftId.toLowerCase()
  const [criteria, slots, settings] = await Promise.all([activeCriteria(), activeDocSlots(), getSettings()])

  const consent = normalizeConsent(body.consent)
  if (consent.staleVersion) throw new HttpError("ข้อความยินยอมเปลี่ยนแล้ว รีเฟรชหน้าแล้วลองใหม่", 409)
  const profile = normalizeProfile(body.profile)
  const ans = normalizeAnswers(body.answers, criteria)
  const docs = normalizeDocInput(body.documents)
  const errors: FieldErrors = { ...consent.errors, ...validateProfile(profile), ...ans.errors, ...docs.errors }

  for (const slotKey of docs.bySlot.keys()) {
    const s = slots.find((x) => x.key === slotKey)
    if (!s || !uploadable(s)) errors[`documents.${slotKey}`] = "ไม่พบรายการเอกสารนี้"
  }
  if (profile.entityType) {
    for (const s of missingRequired(slots, profile.entityType, docs.bySlot)) errors[`documents.${s.key}`] = "ต้องแนบเอกสารนี้"
  }
  if (Object.keys(errors).length) throw bad("ข้อมูลยังไม่ครบหรือไม่ถูกต้อง", errors)

  const col = await appCol()
  const dup = await col.findOne(
    { schemaVersion: 2, "profile.taxId": profile.taxId, status: { $in: OPEN_STATUSES } },
    { projection: { ref: 1 } },
  )
  if (dup) throw new HttpError("เลขผู้เสียภาษีนี้มีใบสมัครค้างอยู่แล้ว ติดต่อฝ่ายจัดซื้อ", 409)

  // ตรวจไฟล์ร่างทั้งหมดก่อนออกเลขที่ใบ (ไม่ผ่านจะได้ไม่เปลืองเลข)
  const verified = new Map<string, Awaited<ReturnType<typeof verifyUploaded>>>()
  for (const [slotKey, files] of docs.bySlot) {
    if (!files.length) continue
    const s = slots.find((x) => x.key === slotKey)!
    verified.set(slotKey, await verifyUploaded(files, draftPrefix(draftId, slotKey), s.label))
  }

  const line = typeof body.idToken === "string" ? await verifyLineIdToken(body.idToken)
    : typeof body.lineIdToken === "string" ? await verifyLineIdToken(body.lineIdToken) : null

  const ref = await nextRef()
  // คัดลอกทั้งหมดก่อน → บันทึกใบ → ค่อยลบร่าง · บันทึกไม่สำเร็จ = ลบของที่คัดลอกไป เก็บร่างไว้ให้ส่งใหม่ได้
  const documents: DocEntry[] = []
  const copied: string[] = []
  try {
    for (const s of slots.filter(uploadable)) {
      const files = verified.get(s.key)
      if (!files?.length) { documents.push({ slot: s.key, files: [], status: "missing" }); continue }
      const finals = await copyDraft(files, draftId, ref, s.key)
      copied.push(...finals.map((f) => f.key))
      documents.push({ slot: s.key, files: finals, status: "waiting" })
    }
  } catch (e) {
    await deleteKeysQuietly(copied, `${VO_KEY_ROOT}/${ref}/`)
    throw e
  }

  const now = new Date().toISOString()
  const doc: OnboardingDoc = {
    schemaVersion: 2,
    ref,
    status: "submitted",
    profile,
    answers: ans.answers,
    criteriaSnapshot: criteria,
    docSlotSnapshot: slots,
    documents,
    scores: [],
    passThreshold: settings.passThreshold,
    evaluatedBy: null,
    reviewedBy: null,
    approvedBy: null,
    vendorCode: null,
    consent: { version: CONSENT_VERSION, acceptedAt: now, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null, items: consent.items },
    timeline: [{ at: now, from: null, to: "submitted", action: "submit", by: null }],
    lineId: line?.lineId ?? null,
    lineDisplayName: line?.lineDisplayName ?? null,
    source: "form-vendor",
    createdAt: now,
    updatedAt: now,
  }
  try {
    await col.insertOne(doc as unknown as Record<string, unknown>)
  } catch (e) {
    await deleteKeysQuietly(copied, `${VO_KEY_ROOT}/${ref}/`)
    throw e
  }
  void deleteKeysQuietly([...verified.values()].flat().map((f) => f.key), DRAFT_ROOT + "/")
  return { ref }
}

// ── ลิงก์ส่งเอกสารเพิ่ม (need_docs) ─────────────────────────────────────────────
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/

export const linkUsable = (l: Pick<LinkRow, "usedAt" | "revokedAt" | "expiresAt">, now = Date.now()) =>
  !l.usedAt && !l.revokedAt && Date.parse(l.expiresAt) > now

type AppLite = { _id: unknown; ref: string; status: OnboardingStatus; profile: { companyName: string }; documents: DocEntry[]; docSlotSnapshot: DocSlot[]; criteriaSnapshot?: Criterion[]; updatedAt: string }

async function loadLink(token: string): Promise<{ link: LinkRow; app: AppLite }> {
  if (!TOKEN_RE.test(token)) throw notFound("ไม่พบลิงก์นี้ ตรวจลิงก์อีกครั้ง")
  const link = await (await linkCol()).findOne({ token })
  if (!link) throw notFound("ไม่พบลิงก์นี้ ตรวจลิงก์อีกครั้ง")
  const app = await (await appCol()).findOne(
    { _id: link.appId, schemaVersion: 2 },
    { projection: { ref: 1, status: 1, "profile.companyName": 1, documents: 1, docSlotSnapshot: 1, updatedAt: 1 } },
  ) as AppLite | null
  if (!app) throw notFound("ไม่พบใบสมัครของลิงก์นี้")
  return { link, app }
}

/** GET /api/form-vendor/link/[token] */
export async function getLinkView(token: string) {
  const { link, app } = await loadLink(token)
  const expired = !linkUsable(link) || app.status !== "need_docs"
  return {
    ref: app.ref, companyName: app.profile.companyName, status: app.status, requested: link.requested,
    expiresAt: link.expiresAt, expired, used: !!link.usedAt,
    maxBytes: DOC_MAX_BYTES, maxFiles: DOC_MAX_FILES, types: DOC_TYPES,
  }
}

function assertOpen(link: LinkRow, app: AppLite) {
  if (link.usedAt) throw new HttpError("ลิงก์นี้ส่งเอกสารไปแล้ว ถ้าต้องส่งเพิ่ม ติดต่อฝ่ายจัดซื้อ", 410)
  if (!linkUsable(link) || app.status !== "need_docs") throw new HttpError("ลิงก์นี้หมดอายุแล้ว ติดต่อฝ่ายจัดซื้อเพื่อขอลิงก์ใหม่", 410)
}

/** POST /api/form-vendor/link/[token]/presign */
export async function presignLink(token: string, body: Record<string, unknown>) {
  const { link, app } = await loadLink(token)
  assertOpen(link, app)
  const slot = String(body.slot ?? "")
  if (!link.requested.some((r) => r.slot === slot)) throw bad("รายการนี้ไม่ได้อยู่ในเอกสารที่ขอเพิ่ม")
  const meta = checkUploadMeta(body)
  return presignUnder(refPrefix(app.ref, slot), meta.name, meta.contentType, meta.size)
}

const MAX_FILES_TOTAL_PER_SLOT = 20

/** POST /api/form-vendor/link/[token]/submit — เพิ่มไฟล์เข้าช่องที่ขอ → รอตรวจ · ใบกลับไป checking · ลิงก์ใช้แล้ว */
export async function submitLink(token: string, body: Record<string, unknown>): Promise<{ ok: true; ref: string }> {
  const { link, app } = await loadLink(token)
  assertOpen(link, app)
  const docs = normalizeDocInput(body.documents)
  const errors: FieldErrors = { ...docs.errors }
  for (const slotKey of docs.bySlot.keys()) {
    if (!link.requested.some((r) => r.slot === slotKey)) errors[`documents.${slotKey}`] = "รายการนี้ไม่ได้อยู่ในเอกสารที่ขอเพิ่ม"
  }
  for (const r of link.requested) if (!docs.bySlot.get(r.slot)?.length) errors[`documents.${r.slot}`] = "แนบไฟล์รายการนี้ด้วย"
  if (Object.keys(errors).length) throw bad("ยังแนบเอกสารไม่ครบ", errors)

  const existingKeys = new Set(app.documents.flatMap((d) => d.files.map((f) => f.key)))
  const added = new Map<string, Awaited<ReturnType<typeof verifyUploaded>>>()
  for (const r of link.requested) {
    const files = docs.bySlot.get(r.slot)!
    if (files.some((f) => existingKeys.has(f.key))) throw bad(`ไฟล์ใน "${r.label}" ส่งไปแล้ว อัปโหลดใหม่อีกครั้ง`)
    added.set(r.slot, await verifyUploaded(files, refPrefix(app.ref, r.slot), r.label))
  }

  // จองลิงก์ก่อน (กันกดส่งซ้ำพร้อมกัน) — ถ้าอัปเดตใบไม่สำเร็จค่อยคืนลิงก์
  const now = new Date().toISOString()
  const links = await linkCol()
  const claim = await links.updateOne({ _id: link._id, usedAt: null, revokedAt: null }, { $set: { usedAt: now } })
  if (claim.modifiedCount !== 1) throw new HttpError("ลิงก์นี้ส่งเอกสารไปแล้ว", 409)

  const documents: DocEntry[] = app.documents.map((d) => {
    const extra = added.get(d.slot)
    if (!extra) return d
    const files = [...d.files, ...extra].slice(-MAX_FILES_TOTAL_PER_SLOT)
    return { slot: d.slot, files, status: "waiting", ...(d.note ? { note: d.note } : {}) }
  })
  for (const [slot, files] of added) if (!documents.some((d) => d.slot === slot)) documents.push({ slot, files, status: "waiting" })

  const labels = link.requested.map((r) => r.label).join(", ")
  const res = await (await appCol()).updateOne(
    { _id: app._id as never, schemaVersion: 2, status: "need_docs", updatedAt: app.updatedAt },
    {
      $set: { documents, status: "checking", updatedAt: now },
      $push: { timeline: { at: now, from: "need_docs", to: "checking", action: "resubmit", by: null, note: `ส่งเอกสารเพิ่ม: ${labels}`.slice(0, 500) } } as never,
    },
  )
  if (res.modifiedCount !== 1) {
    await links.updateOne({ _id: link._id }, { $set: { usedAt: null } }).catch(() => {})
    throw conflict("ใบสมัครเปลี่ยนสถานะไปแล้ว ติดต่อฝ่ายจัดซื้อ")
  }
  return { ok: true, ref: app.ref }
}
