// lib/store-withdraw/hub-service.ts — ผูก PR เติมของ Hub เข้าใบ (ผู้ขอหรือสโตร์)
import { ConflictError, NotFoundError, swCol, writeLog, type Actor } from "./db"
import { parseRef } from "./core"
import { HttpError } from "./http"
import { hubClosedWdDone, hubStatusOf, isHubLine } from "./hub-core"
import type { SwRequest } from "./types"

/** ผูก/เปลี่ยน PR ของ Hub · ผู้ขอ (เจ้าของใบ) หรือสโตร์เท่านั้น */
export async function bindHubPr(no: string, body: { code: unknown; id: unknown }, actor: Actor, isStore: boolean): Promise<SwRequest> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new NotFoundError()
  const owner = cur.requestedBy.email.trim().toLowerCase() === actor.email
  if (!owner && !isStore) throw new HttpError("ใบนี้ไม่ใช่ของคุณ ผูก PR ได้เฉพาะใบที่ตัวเองยื่น", 403)
  if (!cur.lines.some(isHubLine)) throw new ConflictError("ใบนี้ไม่มีอะไหล่ Hub")
  // ปิดใบแล้ว: ผูกได้เฉพาะใบที่ WD Hub ตัดไปแล้ว (ของออกไปจริง ยังค้าง PR)
  if ((cur.status === "REJECTED" || cur.status === "CANCELLED") && !hubClosedWdDone(cur)) throw new ConflictError("ใบนี้ปิดไปแล้ว ผูก PR ไม่ได้")
  const p = parseRef({ type: "pr", code: body.code, id: body.id })
  if ("error" in p) throw new HttpError(p.error, 400)
  const ref = p.ref!
  const hubPr = { code: ref.code, id: ref.id, by: { email: actor.email, name: actor.name }, at: new Date() }
  // เงื่อนไข hubPr เดิม + status เดิม: ถ้ามีคนผูก/ปิดใบพร้อมกันจะไม่ผ่าน · hubStatus เขียนในคำสั่งเดียวกัน (ไม่มีช่วงค่าเก่าค้าง)
  // WD Hub เปลี่ยนพร้อมกัน (ลองตัดใหม่สำเร็จ) → hubWd.code/approved อยู่ในเงื่อนไขด้วย ค่าที่คิดไว้จึงไม่ผิด
  const hubStatus = hubStatusOf({ ...cur, hubPr })
  const after = await col.findOneAndUpdate(
    { no, status: cur.status, hubPr: cur.hubPr ?? null, "hubWd.code": cur.hubWd?.code ?? null, "hubWd.approved": cur.hubWd?.approved ?? null } as never,
    { $set: { hubPr, hubStatus, updatedAt: new Date() } },
    { returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  // กลุ่ม Hub ของ Mobile/PM เปลี่ยนพร้อมกันได้ (ไม่อยู่ในเงื่อนไข) → คิดซ้ำจากค่าจริง ต่างก็แก้ให้ตรง
  const fresh = hubStatusOf(after)
  if (fresh !== hubStatus) await col.updateOne({ no, hubStatus }, { $set: { hubStatus: fresh } })
  await writeLog({ no, action: "hubPr", from: cur.status, to: cur.status, actor: { email: actor.email, name: actor.name, via: actor.via }, note: `${cur.hubPr?.code ?? "-"} → ${ref.code}` })
  return { ...after, hubStatus: fresh }
}
