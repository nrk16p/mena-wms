// lib/vendor-onboarding/admin.ts — ฝั่งพนักงาน: รายการ · รายละเอียด · ให้คะแนน · ตรวจเอกสาร · เปลี่ยนสถานะ · รหัส vendor · ไฟล์ · ค่าตั้ง
import { randomBytes } from "node:crypto"
import { ObjectId, type Document } from "mongodb"
import { headPrivate, presignPrivateGet } from "../spaces"
import { appCol, getSettings, linkCol, saveSettings, type LinkRow } from "./db"
import { bad, conflict, forbidden, HttpError, notFound } from "./http"
import { linkUsable } from "./public"
import { canDo, getActorRoles, ROLE_DENY, type SessionInfo } from "./roles"
import {
  ACTIONS, STATUS_LABEL, canSendReview, isDocRequired, scoreSummary,
  type Actor, type DocEntry, type DocStatus, type OnboardingAction, type OnboardingDoc, type OnboardingStatus,
  type OnboardingSummary, type ScoreItem, type Signoff,
} from "./types"
import { NOTE_MAX, normalizeSettings, uploadable } from "./validate"

const LIST_CAP = 2000
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "")

function oid(id: string): ObjectId {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id.toLowerCase()) throw notFound()
  return new ObjectId(id)
}

// ── รายการ ────────────────────────────────────────────────────────────────
type SummaryStatus = OnboardingSummary["status"]

function summarize(d: Document): OnboardingSummary {
  const id = String(d._id)
  if (d.schemaVersion !== 2) {
    const st = d.status === "approved" ? "legacy_approved" : d.status === "rejected" ? "legacy_rejected" : "legacy_pending"
    return {
      id, ref: null, legacy: true, status: st,
      companyName: d.onBehalf || d.fullName || "-", entityType: null, taxId: d.taxId ?? "",
      productType: null, contactName: d.fullName ?? null, contactPhone: d.phone ?? null,
      score: null, docs: null, vendorCode: d.vendorCode ?? null,
      createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt ?? d.createdAt),
    }
  }
  const doc = d as OnboardingDoc
  const s = scoreSummary(doc)
  const byKey = new Map(doc.documents.map((x) => [x.slot, x]))
  const required = doc.docSlotSnapshot.filter((sl) => uploadable(sl) && isDocRequired(sl, doc.profile.entityType))
  return {
    id, ref: doc.ref, legacy: false, status: doc.status,
    companyName: doc.profile.companyName, entityType: doc.profile.entityType, taxId: doc.profile.taxId,
    productType: doc.profile.productType, contactName: doc.profile.contact?.name ?? null, contactPhone: doc.profile.contact?.phone ?? null,
    score: { pass: s.pass, fail: s.fail, blank: s.blank, threshold: s.threshold },
    docs: {
      requiredTotal: required.length,
      requiredPassed: required.filter((sl) => byKey.get(sl.key)?.status === "passed").length,
      waiting: doc.documents.filter((x) => x.status === "waiting").length,
      redo: doc.documents.filter((x) => x.status === "redo").length,
    },
    vendorCode: doc.vendorCode, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  }
}

const LIST_PROJECTION = {
  // ทั้งสองแบบ
  schemaVersion: 1, status: 1, taxId: 1, vendorCode: 1, createdAt: 1, updatedAt: 1,
  // แบบเก่า
  fullName: 1, onBehalf: 1, phone: 1,
  // แบบใหม่
  ref: 1, profile: 1, scores: 1, passThreshold: 1, documents: 1,
  "criteriaSnapshot.key": 1, "criteriaSnapshot.active": 1,
  "docSlotSnapshot.key": 1, "docSlotSnapshot.requirement": 1, "docSlotSnapshot.active": 1,
}

// แสดงเฉพาะใบจากฟอร์มใหม่ (schemaVersion 2) — ใบจากฟอร์มเดิมไม่แสดง (ผู้ใช้สั่ง 2026-11-22)
export async function listApplications(session: SessionInfo) {
  const [rowsRaw, settings] = await Promise.all([
    (await appCol()).find({ schemaVersion: 2 }, { projection: LIST_PROJECTION }).sort({ _id: -1 }).limit(LIST_CAP).toArray(),
    getSettings(),
  ])
  const rows = rowsRaw.map(summarize)
  const counts: Partial<Record<SummaryStatus, number>> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return { rows, counts, roles: getActorRoles(session, settings), settings: { passThreshold: settings.passThreshold }, capped: rowsRaw.length >= LIST_CAP }
}

// ── รายละเอียด ───────────────────────────────────────────────────────────
async function loadV2(id: string): Promise<OnboardingDoc & { _id: ObjectId }> {
  const d = await (await appCol()).findOne({ _id: oid(id) })
  if (!d) throw notFound()
  if (d.schemaVersion !== 2) throw new HttpError("ใบแบบเก่าทำรายการในหน้านี้ไม่ได้", 400)
  return d as unknown as OnboardingDoc & { _id: ObjectId }
}

const serialize = <T extends { _id?: unknown }>(d: T) => ({ ...d, _id: String(d._id), id: String(d._id) })

function linkView(l: LinkRow, origin: string) {
  return {
    url: `${origin}/form-vendor/docs/${l.token}`, expiresAt: l.expiresAt, usedAt: l.usedAt,
    slots: l.requested.map((r) => r.slot), requested: l.requested, createdAt: l.createdAt, createdBy: l.createdBy,
  }
}

export async function getApplication(id: string, session: SessionInfo, origin: string) {
  const d = await (await appCol()).findOne({ _id: oid(id) })
  if (!d) throw notFound()
  const settings = await getSettings()
  const roles = getActorRoles(session, settings)
  if (d.schemaVersion !== 2) {
    return { legacy: true, doc: { ...d, _id: String(d._id), id: String(d._id), createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt), reviewedAt: d.reviewedAt ? iso(d.reviewedAt) : null }, roles, canSendReview: null, activeLink: null }
  }
  const doc = d as unknown as OnboardingDoc
  let activeLink: ReturnType<typeof linkView> | null = null
  if (doc.status === "need_docs") {
    const l = await (await linkCol()).find({ appId: d._id }).sort({ createdAt: -1 }).limit(1).next()
    if (l && linkUsable(l)) activeLink = linkView(l, origin)
  }
  return { legacy: false, doc: serialize(doc), roles, canSendReview: doc.status === "checking" ? canSendReview(doc) : null, activeLink }
}

// ── ให้คะแนน / ตรวจเอกสาร (officer · checking) ────────────────────────────
async function officerOnChecking(id: string, session: SessionInfo) {
  const settings = await getSettings()
  if (!getActorRoles(session, settings).includes("officer")) throw forbidden(ROLE_DENY.officer)
  const doc = await loadV2(id)
  if (doc.status !== "checking") throw conflict("แก้ได้เฉพาะตอนสถานะ กำลังตรวจ")
  return doc
}

async function writeIfUnchanged(doc: { _id: ObjectId; updatedAt: string }, status: OnboardingStatus, update: Document) {
  const r = await (await appCol()).findOneAndUpdate(
    { _id: doc._id, schemaVersion: 2, status, updatedAt: doc.updatedAt },
    update,
    { returnDocument: "after" },
  )
  if (!r) throw conflict()
  return serialize(r as unknown as OnboardingDoc)
}

/** PATCH scores — แทนที่เฉพาะข้อที่ส่งมา · value null/"" = ล้างข้อนั้น */
export async function patchScores(id: string, body: Record<string, unknown>, session: SessionInfo) {
  const doc = await officerOnChecking(id, session)
  if (!Array.isArray(body.scores) || body.scores.length === 0) throw bad("ไม่มีคะแนนที่จะบันทึก")
  const keys = new Set(doc.criteriaSnapshot.filter((c) => c.active).map((c) => c.key))
  const map = new Map(doc.scores.map((s) => [s.key, s]))
  for (const raw of body.scores as unknown[]) {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
    const key = String(o.key ?? "")
    if (!keys.has(key)) throw bad(`ไม่มีเกณฑ์ข้อ ${key || "(ว่าง)"} ในใบนี้`)
    if (o.value === null || o.value === "" || o.value === undefined) { map.delete(key); continue }
    if (o.value !== "pass" && o.value !== "fail") throw bad(`ข้อ ${key} ต้องเป็น ผ่าน หรือ ไม่ผ่าน`)
    const note = typeof o.note === "string" ? o.note.trim().slice(0, NOTE_MAX) : ""
    map.set(key, note ? { key, value: o.value, note } : { key, value: o.value })
  }
  const order = doc.criteriaSnapshot.map((c) => c.key)
  const scores: ScoreItem[] = [...map.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return writeIfUnchanged(doc, "checking", { $set: { scores, updatedAt: new Date().toISOString() } })
}

const DOC_SET: DocStatus[] = ["passed", "redo", "waiting"]

/** PATCH documents — ตั้งผลตรวจเอกสารทีละช่อง */
export async function patchDocument(id: string, body: Record<string, unknown>, session: SessionInfo) {
  const doc = await officerOnChecking(id, session)
  const slot = String(body.slot ?? "")
  const status = String(body.status ?? "") as DocStatus
  if (!DOC_SET.includes(status)) throw bad("สถานะเอกสารต้องเป็น ผ่าน / ขอใหม่ / รอตรวจ")
  const sl = doc.docSlotSnapshot.find((s) => s.key === slot)
  if (!sl || !uploadable(sl)) throw bad("ไม่พบรายการเอกสารนี้")
  const cur = doc.documents.find((d) => d.slot === slot)
  if (status === "passed" && !cur?.files.length) throw bad("ยังไม่มีไฟล์ ตั้งเป็นผ่านไม่ได้")
  const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : ""
  const now = new Date().toISOString()
  const entry: DocEntry = {
    slot, files: cur?.files ?? [], status: status === "waiting" && !cur?.files.length ? "missing" : status,
    ...(note ? { note } : {}), checkedBy: session.actor, checkedAt: now,
  }
  const documents = cur ? doc.documents.map((d) => (d.slot === slot ? entry : d)) : [...doc.documents, entry]
  return writeIfUnchanged(doc, "checking", { $set: { documents, updatedAt: now } })
}

// ── เปลี่ยนสถานะ ─────────────────────────────────────────────────────────
export async function runAction(id: string, body: Record<string, unknown>, session: SessionInfo, origin: string) {
  const action = String(body.action ?? "") as OnboardingAction
  const def = ACTIONS[action]
  if (!def || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw bad("ไม่รู้จักคำสั่งนี้")
  const settings = await getSettings()
  const roles = getActorRoles(session, settings)
  if (!canDo(action, def.role, roles)) throw forbidden(action === "reject" ? "งานนี้เฉพาะผู้รีวิวหรือผู้อนุมัติ" : ROLE_DENY[def.role])
  const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : ""
  if (def.needsNote && !note) throw bad("ใส่เหตุผลหรือหมายเหตุก่อน")

  const doc = await loadV2(id)
  if (!def.from.includes(doc.status)) throw conflict(`ทำไม่ได้แล้ว ใบนี้อยู่สถานะ "${STATUS_LABEL[doc.status]}" โหลดหน้าใหม่`)

  const now = new Date().toISOString()
  const actor: Actor = session.actor
  const signoff: Signoff = note ? { by: actor, at: now, note } : { by: actor, at: now }
  const $set: Document = { status: def.to, updatedAt: now }
  let requested: LinkRow["requested"] | null = null

  if (action === "send_review") {
    const chk = canSendReview(doc)
    if (!chk.ok) throw bad(`ยังส่งรีวิวไม่ได้: ${chk.reasons.join(" · ")}`)
    $set.evaluatedBy = signoff
  } else if (action === "review_pass") {
    $set.reviewedBy = signoff
  } else if (action === "approve") {
    $set.approvedBy = signoff
  } else if (action === "review_return" || action === "approve_return") {
    $set.reviewedBy = null
    $set.approvedBy = null
  } else if (action === "request_docs") {
    const want = Array.isArray(body.requestedSlots) ? [...new Set((body.requestedSlots as unknown[]).map(String))] : []
    if (!want.length) throw bad("เลือกเอกสารที่จะขอเพิ่มอย่างน้อย 1 รายการ")
    const slots = want.map((k) => {
      const sl = doc.docSlotSnapshot.find((s) => s.key === k)
      if (!sl || !uploadable(sl)) throw bad(`ไม่พบรายการเอกสาร ${k}`)
      return sl
    })
    const docs = [...doc.documents]
    for (const sl of slots) {
      const i = docs.findIndex((d) => d.slot === sl.key)
      if (i >= 0 && docs[i].files.length) docs[i] = { ...docs[i], status: "redo" }
      else if (i < 0) docs.push({ slot: sl.key, files: [], status: "missing" })
    }
    $set.documents = docs
    // เหตุผลที่จัดซื้อพิมพ์ตอนขอ → vendor เห็นในหน้าลิงก์
    requested = slots.map((sl) => ({ slot: sl.key, label: sl.label, note }))
  } else if (action === "reissue_link") {
    // ลิงก์เดิมหมดอายุ/หาย — ขอรายการเดิมจากลิงก์ล่าสุด · ไม่มีลิงก์เลย (ข้อมูลเก่า) ใช้ช่องที่ ขอใหม่/ยังไม่ส่ง และบังคับ
    const last = await (await linkCol()).find({ appId: doc._id }).sort({ createdAt: -1 }).limit(1).next()
    requested = last?.requested?.length ? last.requested
      : doc.docSlotSnapshot
        .filter((sl) => uploadable(sl) && (doc.documents.find((d) => d.slot === sl.key)?.status === "redo"
          || (isDocRequired(sl, doc.profile.entityType) && !doc.documents.find((d) => d.slot === sl.key)?.files.length)))
        .map((sl) => ({ slot: sl.key, label: sl.label, note: "" }))
    if (!requested.length) throw bad("ไม่พบรายการเอกสารที่ขอไว้ ตีกลับหรือยกเลิกใบนี้แทน")
  }

  // มีลิงก์: สร้างลิงก์ใหม่ก่อน → เขียนสถานะ (มีเงื่อนไข) → สำเร็จค่อยยกเลิกลิงก์เก่า · เขียนสถานะไม่ผ่าน = ลบลิงก์ใหม่ทิ้ง
  const links = requested ? await linkCol() : null
  let row: LinkRow | null = null
  if (links && requested) {
    row = {
      token: randomBytes(32).toString("base64url"), appId: doc._id, ref: doc.ref, requested, createdAt: now, createdBy: actor,
      expiresAt: new Date(Date.now() + settings.linkDays * 86_400_000).toISOString(), usedAt: null, revokedAt: null,
    }
    await links.insertOne(row)
  }

  const entry = { at: now, from: doc.status, to: def.to, action, by: actor, ...(note ? { note } : {}) }
  let updated
  try {
    updated = await writeIfUnchanged(doc, doc.status, { $set, $push: { timeline: entry } })
  } catch (e) {
    if (links && row) await links.deleteOne({ token: row.token }).catch((x) => console.warn("[vendor-onboarding] delete link", x))
    throw e
  }

  if (!links || !row) return { doc: updated, linkUrl: null, linkExpiresAt: null }
  await links.updateMany({ appId: doc._id, usedAt: null, revokedAt: null, token: { $ne: row.token } }, { $set: { revokedAt: now } })
  return { doc: updated, linkUrl: linkView(row, origin).url, linkExpiresAt: row.expiresAt }
}

// ── รหัส vendor (officer · approved) ─────────────────────────────────────
export async function patchVendorCode(id: string, body: Record<string, unknown>, session: SessionInfo) {
  const settings = await getSettings()
  if (!getActorRoles(session, settings).includes("officer")) throw forbidden(ROLE_DENY.officer)
  const doc = await loadV2(id)
  if (doc.status !== "approved") throw conflict("ใส่รหัส vendor ได้หลังอนุมัติแล้วเท่านั้น")
  const code = typeof body.vendorCode === "string" ? body.vendorCode.trim() : ""
  if (code.length > 50) throw bad("รหัส vendor ยาวเกิน 50 ตัวอักษร")
  return writeIfUnchanged(doc, "approved", { $set: { vendorCode: code || null, updatedAt: new Date().toISOString() } })
}

// ── ไฟล์ ───────────────────────────────────────────────────────────────
export async function fileUrl(id: string, key: string): Promise<string> {
  const d = await (await appCol()).findOne({ _id: oid(id), schemaVersion: 2 }, { projection: { documents: 1 } })
  if (!d) throw notFound()
  const file = (d.documents as DocEntry[] | undefined)?.flatMap((x) => x.files).find((f) => f.key === key)
  if (!file) throw notFound("ไม่พบไฟล์นี้ในใบสมัคร")
  if (!(await headPrivate(key))) throw notFound("ไม่พบไฟล์ในที่เก็บ (อาจเป็นข้อมูลตัวอย่าง)")
  return presignPrivateGet(key, file.name, 120)
}

// ── ค่าตั้ง ─────────────────────────────────────────────────────────────
export async function readSettings(session: SessionInfo) {
  const settings = await getSettings()
  const roles = getActorRoles(session, settings)
  // แบนให้อ่านเป็น OnboardingSettings ได้ตรง ๆ + บอกบทบาท/สิทธิ์แก้
  return { ...settings, roles, canEdit: session.admin || roles.includes("approver") }
}

export async function writeSettings(body: Record<string, unknown>, session: SessionInfo) {
  const cur = await getSettings()
  if (!session.admin && !getActorRoles(session, cur).includes("approver")) throw forbidden("แก้ค่าตั้งได้เฉพาะผู้อนุมัติหรือผู้ดูแลระบบ")
  const { settings, errors } = normalizeSettings(body)
  if (!settings) throw bad("ค่าตั้งไม่ถูกต้อง", errors)
  await saveSettings(settings, session.actor)
  return readSettings(session)
}
