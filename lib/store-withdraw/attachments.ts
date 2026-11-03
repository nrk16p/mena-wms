// lib/store-withdraw/attachments.ts — ไฟล์แนบหลักฐานของใบเบิก (เพิ่มได้อย่างเดียว · ไม่มีลบ/แก้เนื้อหา)
// ขั้นตอน: presign (สร้าง record ยังไม่ยืนยัน) → browser PUT ตรงเข้า Spaces → confirm (HeadObject เช็กไฟล์+ขนาด) → writeLog "attach"
// เปลี่ยนค่าได้แค่ 2 อย่าง: confirmedAt (ตอนยืนยัน) กับ linkedTo (ตอนผูกกับใบคืน/ปฏิเสธ/สรุป) · ทั้งคู่ตั้งได้ครั้งเดียว
import { randomBytes } from "node:crypto"
import type { Collection } from "mongodb"
import { HttpError } from "./http"
import { NotFoundError, getDb, swCol, writeLog, type Actor } from "./db"
import { attachStorage } from "./storage"

export const ATTACH_CONTEXTS = ["return", "reject", "summary", "receipt", "other"] as const
export type AttachContext = (typeof ATTACH_CONTEXTS)[number]
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const
export const ATTACH_TYPES: string[] = [...IMAGE_TYPES, "application/pdf"]
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024
export const MAX_ATTACH_PER_CONTEXT = 8
/** สรุปการใช้แยกรายคัน มีรูปหลายคันต่อใบ จึงให้ 40 ไฟล์ · หัวข้ออื่น 8 เท่าเดิม */
export const MAX_ATTACH_SUMMARY = 40
export const attachCap = (context: AttachContext) => (context === "summary" ? MAX_ATTACH_SUMMARY : MAX_ATTACH_PER_CONTEXT)
const PENDING_WINDOW_MS = 60 * 60_000

export type LinkTarget = { type: "return" | "reject" | "summary"; rid?: string }

export type AttachDoc = {
  _id: string
  no: string
  context: AttachContext
  key: string
  filename: string
  contentType: string
  size: number
  sha256: string | null
  by: { email: string; name: string }
  at: Date
  confirmedAt: Date | null
  linkedTo?: LinkTarget
}

export async function attachCol(): Promise<Collection<AttachDoc>> {
  return (await getDb()).collection<AttachDoc>("store_withdraw_attachments")
}

/** ชื่อไฟล์ปลอดภัยสำหรับ key: ตัด path, อักขระควบคุม, ยาวไม่เกิน 100 */
export function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ""
  const clean = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").replace(/\s+/g, " ").trim()
  const name = clean.replace(/^\.+/, "")
  return (name || "file").slice(-100)
}

export const keyName = (name: string) => name.replace(/[^\w.\-฀-๿]+/g, "_")

export const isImageType = (t: string) => (IMAGE_TYPES as readonly string[]).includes(t)

/** ใครแนบได้: เจ้าของใบ หรือสโตร์ (store-queue ระดับแก้ได้) · storeView = สโตร์ระดับดูได้ (ดูไฟล์ได้อย่างเดียว) */
export type Who = { actor: Actor; isStore: boolean; storeView: boolean }

async function loadReq(no: string) {
  const r = await (await swCol()).findOne({ no }, { projection: { no: 1, status: 1, requestedBy: 1 } })
  if (!r) throw new NotFoundError()
  return r
}

export async function presignAttachment(no: string, body: Record<string, unknown>, who: Who): Promise<{ id: string; uploadUrl: string; key: string }> {
  const req = await loadReq(no)
  if (!who.isStore && req.requestedBy.email.trim().toLowerCase() !== who.actor.email) {
    throw new HttpError("แนบไฟล์ได้เฉพาะคนที่ยื่นใบนี้ หรือสโตร์", 403)
  }
  const context = String(body.context ?? "") as AttachContext
  if (!ATTACH_CONTEXTS.includes(context)) throw new HttpError(`context ไม่ถูกต้อง (${ATTACH_CONTEXTS.join(", ")})`, 400)
  const contentType = String(body.contentType ?? "").toLowerCase()
  if (!ATTACH_TYPES.includes(contentType)) throw new HttpError("แนบได้เฉพาะรูป (jpg, png, webp, heic) หรือไฟล์ PDF", 400)
  const size = Number(body.size)
  if (!Number.isInteger(size) || size <= 0) throw new HttpError("ขนาดไฟล์ไม่ถูกต้อง", 400)
  if (size > MAX_ATTACH_BYTES) throw new HttpError("ไฟล์ใหญ่เกิน 10 MB ลดขนาดแล้วลองใหม่", 400)
  const filename = safeName(String(body.filename ?? ""))
  const sha = body.sha256 == null || body.sha256 === "" ? null : String(body.sha256).toLowerCase()
  if (sha !== null && !/^[0-9a-f]{64}$/.test(sha)) throw new HttpError("sha256 ต้องเป็นเลขฐานสิบหก 64 ตัว", 400)

  const col = await attachCol()
  const used = await col.countDocuments({
    no, context,
    $or: [{ confirmedAt: { $ne: null } }, { at: { $gte: new Date(Date.now() - PENDING_WINDOW_MS) } }],
  })
  if (used >= attachCap(context)) throw new HttpError(`แนบได้ไม่เกิน ${attachCap(context)} ไฟล์ต่อหัวข้อ`, 400)

  const id = randomBytes(8).toString("hex")
  const key = `store-withdraw/${no}/${id}-${keyName(filename)}`
  const uploadUrl = await attachStorage().presignPut(key, contentType)
  await col.insertOne({
    _id: id, no, context, key, filename, contentType, size, sha256: sha,
    by: { email: who.actor.email, name: who.actor.name }, at: new Date(), confirmedAt: null,
  })
  return { id, uploadUrl, key }
}

export async function confirmAttachment(no: string, id: unknown, who: Who): Promise<{ id: string; confirmedAt: Date }> {
  const req0 = await loadReq(no)
  if (!who.isStore && req0.requestedBy.email.trim().toLowerCase() !== who.actor.email) {
    throw new HttpError("แนบไฟล์ได้เฉพาะคนที่ยื่นใบนี้ หรือสโตร์", 403)
  }
  const col = await attachCol()
  const doc = typeof id === "string" ? await col.findOne({ _id: id, no }) : null
  if (!doc) throw new NotFoundError("ไม่พบไฟล์แนบนี้ อัปโหลดใหม่อีกครั้ง")
  if (doc.by.email !== who.actor.email) throw new HttpError("ไฟล์นี้คนอื่นอัปโหลด ยืนยันได้เฉพาะคนที่อัปโหลด", 403)
  if (doc.confirmedAt) return { id: doc._id, confirmedAt: doc.confirmedAt }
  const head = await attachStorage().headObject(doc.key)
  if (!head) throw new HttpError("ยังไม่เจอไฟล์ในที่เก็บ อัปโหลดให้เสร็จก่อนแล้วกดยืนยัน", 409)
  if (head.size !== doc.size) throw new HttpError("ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้ อัปโหลดใหม่อีกครั้ง", 409)
  const now = new Date()
  const upd = await col.findOneAndUpdate({ _id: doc._id, confirmedAt: null }, { $set: { confirmedAt: now } }, { returnDocument: "after" })
  if (upd) {
    const r = await loadReq(no)
    await writeLog({
      no, action: "attach", from: r.status, to: r.status,
      actor: { email: who.actor.email, name: who.actor.name, via: who.actor.via },
      note: `${doc._id} · ${doc.context} · ${doc.filename} · ${doc.size}B${doc.sha256 ? ` · sha256 ${doc.sha256}` : ""}`,
    })
  }
  return { id: doc._id, confirmedAt: upd?.confirmedAt ?? now }
}

export type AttachItem = {
  id: string; context: AttachContext; filename: string; contentType: string; size: number; sha256: string | null
  by: { email: string; name: string }; at: Date; confirmedAt: Date; linkedTo?: LinkTarget; url: string
}

/** รายการที่ยืนยันแล้ว + ลิงก์ดาวน์โหลดอายุสั้น */
export async function listAttachments(nos: string[]): Promise<Map<string, AttachItem[]>> {
  const out = new Map<string, AttachItem[]>()
  if (nos.length === 0) return out
  const docs = await (await attachCol()).find({ no: { $in: nos }, confirmedAt: { $ne: null } }).sort({ confirmedAt: 1 }).limit(2000).toArray()
  const st = attachStorage()
  for (const d of docs) {
    const item: AttachItem = {
      id: d._id, context: d.context, filename: d.filename, contentType: d.contentType, size: d.size, sha256: d.sha256,
      by: d.by, at: d.at, confirmedAt: d.confirmedAt as Date, linkedTo: d.linkedTo, url: await st.presignGet(d.key, d.filename),
    }
    const a = out.get(d.no) ?? []
    a.push(item)
    out.set(d.no, a)
  }
  return out
}

/** นับไฟล์ที่ยืนยันแล้วต่อใบ (ไม่ต้อง presign) */
export async function countAttachments(nos: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  if (nos.length === 0) return m
  const rows = await (await attachCol()).aggregate<{ _id: string; n: number }>([
    { $match: { no: { $in: nos }, confirmedAt: { $ne: null } } },
    { $group: { _id: "$no", n: { $sum: 1 } } },
  ]).toArray()
  for (const r of rows) m.set(r._id, r.n)
  return m
}

/**
 * ตรวจ id ที่จะผูก: ต้องเป็นของใบนี้ · context ตรง · คนนี้อัปโหลด · ยืนยันแล้ว · ยังไม่เคยผูก · รูป/PDF
 * คืน id ที่ผ่าน (ไม่ซ้ำ) · ไม่ผ่านสักตัว = 400
 */
export async function resolveLinkable(no: string, raw: unknown, context: AttachContext, actor: Actor): Promise<string[]> {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new HttpError("attachmentIds ต้องเป็นรายการ", 400)
  const ids = [...new Set(raw.map((x) => String(x)))]
  if (ids.length === 0) return []
  if (ids.length > attachCap(context)) throw new HttpError(`แนบได้ไม่เกิน ${attachCap(context)} ไฟล์`, 400)
  const docs = await (await attachCol()).find({ _id: { $in: ids }, no, context, "by.email": actor.email, confirmedAt: { $ne: null }, linkedTo: { $exists: false } }).toArray()
  if (docs.length !== ids.length || docs.some((d) => !ATTACH_TYPES.includes(d.contentType))) {
    throw new HttpError("ไฟล์แนบบางไฟล์ใช้ไม่ได้ (ไม่ใช่ของคุณ ไม่ใช่ใบนี้ ยังอัปโหลดไม่เสร็จ หรือถูกใช้กับรายการอื่นแล้ว) แนบใหม่แล้วลองอีกครั้ง", 400)
  }
  return ids
}

/** ผูกไฟล์กับใบคืน/ปฏิเสธ/สรุป · ตั้งได้ครั้งเดียว (ที่ผูกแล้วไม่ถูกแตะ) */
export async function linkAttachments(no: string, ids: string[], target: LinkTarget): Promise<void> {
  if (ids.length === 0) return
  await (await attachCol()).updateMany({ _id: { $in: ids }, no, linkedTo: { $exists: false } }, { $set: { linkedTo: target } })
}

/** ดูไฟล์ได้: เจ้าของใบ หรือสโตร์ระดับดูขึ้นไป */
export async function assertCanView(no: string, who: Who): Promise<void> {
  const req = await loadReq(no)
  if (!who.storeView && req.requestedBy.email.trim().toLowerCase() !== who.actor.email) {
    throw new HttpError("ดูไฟล์แนบได้เฉพาะคนที่ยื่นใบนี้ หรือสโตร์", 403)
  }
}
