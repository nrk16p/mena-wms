// lib/vendor-onboarding/files.ts — key ของไฟล์ใน Spaces (bucket ส่วนตัว) + ตรวจไฟล์ที่อัปโหลดแล้ว
//   ร่าง (ก่อนส่งฟอร์ม):  vendor-onboarding/_drafts/{draftId}/{slot}/{random}-{name}
//   ของจริง (หลังส่ง):    vendor-onboarding/{ref}/{slot}/{random}-{name}
import { randomBytes } from "node:crypto"
import { copyPrivate, deletePrivate, headPrivate, presignPrivatePut } from "../spaces"
import { bad } from "./http"
import { DOC_MAX_BYTES, DOC_TYPES, type DocFile } from "./types"
import { keySafeName, type FileInput } from "./validate"

export const VO_KEY_ROOT = "vendor-onboarding"
export const DRAFT_ROOT = `${VO_KEY_ROOT}/_drafts`
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ร่างที่ไม่ได้ส่งค้างอยู่ใต้ _drafts/ — ให้ตั้ง lifecycle rule ของ bucket ลบ prefix นี้หลัง 1 วัน
export const isDraftId = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s)
export const draftPrefix = (draftId: string, slot?: string) => `${DRAFT_ROOT}/${draftId.toLowerCase()}/${slot ? slot + "/" : ""}`
export const refPrefix = (ref: string, slot?: string) => `${VO_KEY_ROOT}/${ref}/${slot ? slot + "/" : ""}`

/** ตรวจขนาด/ชนิดก่อนออกลิงก์อัปโหลด */
export function checkUploadMeta(body: Record<string, unknown>): { name: string; size: number; contentType: string } {
  const contentType = String(body.contentType ?? "").toLowerCase()
  if (!DOC_TYPES.includes(contentType)) throw bad("รับเฉพาะไฟล์ PDF หรือรูป (jpg, png, webp)")
  const size = Number(body.size)
  if (!Number.isInteger(size) || size <= 0) throw bad("ขนาดไฟล์ไม่ถูกต้อง")
  if (size > DOC_MAX_BYTES) throw bad("ไฟล์ใหญ่เกิน 10 MB ลดขนาดแล้วลองใหม่")
  const name = String(body.name ?? "").trim().slice(0, 200) || "file"
  return { name, size, contentType }
}

/** ออกลิงก์ PUT ตรงเข้า Spaces · อายุ 10 นาที
 *  browser ต้อง PUT ด้วย Content-Type เดียวกัน และไฟล์ต้องขนาดเท่าที่แจ้งพอดี (เซ็น Content-Length ไว้ ใหญ่กว่า = ถูกปฏิเสธ) */
export async function presignUnder(prefix: string, name: string, contentType: string, size: number): Promise<{ key: string; url: string }> {
  const key = `${prefix}${randomBytes(6).toString("hex")}-${keySafeName(name)}`
  return { key, url: await presignPrivatePut(key, contentType, 600, size) }
}

/** ตรวจว่าไฟล์อยู่ใต้ prefix ที่อนุญาตและมีอยู่จริงใน Spaces · ขนาด/ชนิดเอาจาก HeadObject เป็นหลัก */
export async function verifyUploaded(files: FileInput[], prefix: string, slotLabel: string): Promise<DocFile[]> {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  return Promise.all(files.map(async (f) => {
    if (!f.key.startsWith(prefix) || f.key.includes("..") || seen.has(f.key)) throw bad(`ไฟล์ใน "${slotLabel}" ไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง`)
    seen.add(f.key)
    const head = await headPrivate(f.key)
    if (!head || !head.size) throw bad(`ไม่พบไฟล์ "${f.name}" หรือไฟล์ว่าง อัปโหลดใหม่อีกครั้ง`)
    if (head.size > DOC_MAX_BYTES) throw bad(`ไฟล์ "${f.name}" ใหญ่เกิน 10 MB`)
    const contentType = head.contentType && DOC_TYPES.includes(head.contentType.toLowerCase()) ? head.contentType.toLowerCase() : f.contentType
    return { key: f.key, name: f.name || "file", size: head.size, contentType, uploadedAt: now }
  }))
}

/** คัดลอกไฟล์จากร่างไปไว้ใต้เลขที่ใบ (ยังไม่ลบร่าง — ลบหลังบันทึกใบสำเร็จด้วย deleteKeysQuietly) */
export async function copyDraft(files: DocFile[], draftId: string, ref: string, slot: string): Promise<DocFile[]> {
  const from = draftPrefix(draftId, slot)
  return Promise.all(files.map(async (f) => {
    const key = refPrefix(ref, slot) + f.key.slice(from.length)
    await copyPrivate(f.key, key)
    return { ...f, key }
  }))
}

/** ลบไฟล์แบบ best-effort (ไม่โยน error) — จำกัดเฉพาะใต้ allowPrefix */
export function deleteKeysQuietly(keys: string[], allowPrefix: string): Promise<void> {
  return Promise.all(keys.map((k) => deletePrivate(k, allowPrefix).catch((e) => console.warn("[vendor-onboarding] delete", k, e))))
    .then(() => undefined)
}
