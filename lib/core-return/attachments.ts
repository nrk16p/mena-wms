// lib/core-return/attachments.ts — รูป/ไฟล์หลักฐานของซาก (เพิ่มได้อย่างเดียว · ไม่มีลบ/แก้เนื้อหา)
// ขั้นตอน: presign (สร้าง record ยังไม่ยืนยัน) → browser PUT ตรงเข้าที่เก็บ → confirm (HeadObject เช็กไฟล์+ขนาด) → log "attach"
// เปลี่ยนค่าได้แค่ 2 อย่าง: confirmedAt (ตอนยืนยัน) กับ linkedTo (ตอนผูกกับใบคืนซาก) · ทั้งคู่ตั้งได้ครั้งเดียว
// ใช้ที่เก็บ/ชนิดไฟล์/ขนาดชุดเดียวกับไฟล์แนบของใบเบิก (lib/store-withdraw)
import { randomBytes } from "node:crypto"
import type { Collection } from "mongodb"
import { ATTACH_TYPES, MAX_ATTACH_BYTES, keyName, safeName } from "@/lib/store-withdraw/attachments"
import { attachStorage } from "@/lib/store-withdraw/storage"
import { CoreHttpError, OUTSTANDING, type Actor, type CoreRow } from "./core"
import { baseCol, getCoreDb, writeCoreLog } from "./db"

export const CORE_ATTACH_CONTEXTS = ["return", "other"] as const
export type CoreAttachContext = (typeof CORE_ATTACH_CONTEXTS)[number]
export const MAX_CORE_ATTACH = 8
const PENDING_WINDOW_MS = 60 * 60_000

export type CoreAttachDoc = {
  _id: string
  rowKey: string
  context: CoreAttachContext
  key: string
  filename: string
  contentType: string
  size: number
  sha256: string | null
  by: { email: string; name: string }
  at: Date
  confirmedAt: Date | null
  linkedTo?: { type: "return" }
}

export async function coreAttachCol(): Promise<Collection<CoreAttachDoc>> {
  return (await getCoreDb()).collection<CoreAttachDoc>("core_return_attachments")
}

async function loadRow(rowKey: string): Promise<CoreRow> {
  const row = await (await baseCol()).findOne({ row_key: rowKey }, { projection: { row_key: 1, coreStatus: 1 } })
  if (!row) throw new CoreHttpError("ไม่พบรายการนี้ ลองรีเฟรช", 404)
  return row as CoreRow
}

export async function presignCoreAttachment(rowKey: string, body: Record<string, unknown>, actor: Actor): Promise<{ id: string; uploadUrl: string; key: string }> {
  const row = await loadRow(rowKey)
  const context = String(body.context ?? "") as CoreAttachContext
  if (!CORE_ATTACH_CONTEXTS.includes(context)) throw new CoreHttpError(`context ไม่ถูกต้อง (${CORE_ATTACH_CONTEXTS.join(", ")})`, 400)
  if (context === "return" && !OUTSTANDING.includes(row.coreStatus)) throw new CoreHttpError("รายการนี้คืนซากไปแล้ว แนบรูปเพิ่มได้ที่ปุ่ม แนบรูปเพิ่ม", 409)
  const contentType = String(body.contentType ?? "").toLowerCase()
  if (!ATTACH_TYPES.includes(contentType)) throw new CoreHttpError("แนบได้เฉพาะรูป (jpg, png, webp, heic) หรือไฟล์ PDF", 400)
  const size = Number(body.size)
  if (!Number.isInteger(size) || size <= 0) throw new CoreHttpError("ขนาดไฟล์ไม่ถูกต้อง", 400)
  if (size > MAX_ATTACH_BYTES) throw new CoreHttpError("ไฟล์ใหญ่เกิน 10 MB ลดขนาดแล้วลองใหม่", 400)
  const filename = safeName(String(body.filename ?? ""))
  const sha = body.sha256 == null || body.sha256 === "" ? null : String(body.sha256).toLowerCase()
  if (sha !== null && !/^[0-9a-f]{64}$/.test(sha)) throw new CoreHttpError("sha256 ต้องเป็นเลขฐานสิบหก 64 ตัว", 400)

  const col = await coreAttachCol()
  const used = await col.countDocuments({
    rowKey,
    $or: [{ confirmedAt: { $ne: null } }, { at: { $gte: new Date(Date.now() - PENDING_WINDOW_MS) } }],
  })
  if (used >= MAX_CORE_ATTACH) throw new CoreHttpError(`แนบได้ไม่เกิน ${MAX_CORE_ATTACH} ไฟล์ต่อรายการ`, 400)

  const id = randomBytes(8).toString("hex")
  const key = `core-return/${keyName(rowKey)}/${id}-${keyName(filename)}`
  const uploadUrl = await attachStorage().presignPut(key, contentType)
  await col.insertOne({ _id: id, rowKey, context, key, filename, contentType, size, sha256: sha, by: { email: actor.email, name: actor.name }, at: new Date(), confirmedAt: null })
  return { id, uploadUrl, key }
}

export async function confirmCoreAttachment(rowKey: string, id: unknown, actor: Actor): Promise<{ id: string; confirmedAt: Date }> {
  await loadRow(rowKey)
  const col = await coreAttachCol()
  const doc = typeof id === "string" ? await col.findOne({ _id: id, rowKey }) : null
  if (!doc) throw new CoreHttpError("ไม่พบไฟล์แนบนี้ อัปโหลดใหม่อีกครั้ง", 404)
  if (doc.by.email !== actor.email) throw new CoreHttpError("ไฟล์นี้คนอื่นอัปโหลด ยืนยันได้เฉพาะคนที่อัปโหลด", 403)
  if (doc.confirmedAt) return { id: doc._id, confirmedAt: doc.confirmedAt }
  const head = await attachStorage().headObject(doc.key)
  if (!head) throw new CoreHttpError("ยังไม่เจอไฟล์ในที่เก็บ อัปโหลดให้เสร็จก่อนแล้วกดยืนยัน", 409)
  if (head.size !== doc.size) throw new CoreHttpError("ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้ อัปโหลดใหม่อีกครั้ง", 409)
  const now = new Date()
  const upd = await col.findOneAndUpdate({ _id: doc._id, confirmedAt: null }, { $set: { confirmedAt: now } }, { returnDocument: "after" })
  if (upd) {
    // นับไว้บนแถว (ชิป "รูป N" ในรายการ) · ไม่แตะสถานะ
    const after = await (await baseCol()).findOneAndUpdate({ row_key: rowKey }, { $inc: { attachCount: 1 } }, { projection: { coreStatus: 1 } })
    const st = after?.coreStatus ?? null
    await writeCoreLog({
      row_key: rowKey, action: "attach", from: st, to: st, actor: { email: actor.email, name: actor.name, via: actor.via },
      data: { attachmentId: doc._id, context: doc.context, filename: doc.filename, size: doc.size, sha256: doc.sha256 },
    }, now)
  }
  return { id: doc._id, confirmedAt: upd?.confirmedAt ?? now }
}

export type CoreAttachItem = {
  id: string; context: CoreAttachContext; filename: string; contentType: string; size: number
  by: { email: string; name: string }; confirmedAt: Date; linked: boolean; url: string
}

/** รายการที่ยืนยันแล้ว + ลิงก์ดูไฟล์อายุสั้น */
export async function listCoreAttachments(rowKey: string): Promise<CoreAttachItem[]> {
  await loadRow(rowKey)
  const docs = await (await coreAttachCol()).find({ rowKey, confirmedAt: { $ne: null } }).sort({ confirmedAt: 1 }).limit(50).toArray()
  const st = attachStorage()
  return Promise.all(docs.map(async (d) => ({
    id: d._id, context: d.context, filename: d.filename, contentType: d.contentType, size: d.size,
    by: d.by, confirmedAt: d.confirmedAt as Date, linked: !!d.linkedTo, url: await st.presignGet(d.key, d.filename),
  })))
}

/** ตรวจ id ที่จะผูกกับใบคืน: ของแถวนี้ · context return · คนนี้อัปโหลด · ยืนยันแล้ว · ยังไม่เคยผูก */
export async function resolveCoreLinkable(rowKey: string, raw: unknown, actor: Actor): Promise<string[]> {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new CoreHttpError("attachmentIds ต้องเป็นรายการ", 400)
  const ids = [...new Set(raw.map((x) => String(x)))]
  if (ids.length === 0) return []
  if (ids.length > MAX_CORE_ATTACH) throw new CoreHttpError(`แนบได้ไม่เกิน ${MAX_CORE_ATTACH} ไฟล์`, 400)
  const n = await (await coreAttachCol()).countDocuments({ _id: { $in: ids }, rowKey, context: "return", "by.email": actor.email, confirmedAt: { $ne: null }, linkedTo: { $exists: false } })
  if (n !== ids.length) throw new CoreHttpError("ไฟล์แนบบางไฟล์ใช้ไม่ได้ (ไม่ใช่ของคุณ ไม่ใช่รายการนี้ ยังอัปโหลดไม่เสร็จ หรือถูกใช้ไปแล้ว) แนบใหม่แล้วลองอีกครั้ง", 400)
  return ids
}

/** ผูกกับใบคืน · ตั้งได้ครั้งเดียว (ที่ผูกแล้วไม่ถูกแตะ) */
export async function linkCoreAttachments(rowKey: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await (await coreAttachCol()).updateMany({ _id: { $in: ids }, rowKey, linkedTo: { $exists: false } }, { $set: { linkedTo: { type: "return" } } })
}
