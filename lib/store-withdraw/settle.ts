// lib/store-withdraw/settle.ts — Mobile/PM แบบ pending: ส่งของ (ไม่แตะ ATMS) · ช่างสรุปการใช้ · เลื่อนกำหนด · สโตร์ตัดสต๊อก
// ตัดสต๊อก = WD หนึ่งใบต่อทะเบียน ด้วยบัญชี ATMS ของสโตร์ · กติกากันยิงซ้ำเดียวกับ issue.ts:
//   สลับสถานะด้วย findOneAndUpdate({no, status}) · แต่ละกลุ่มมี remark_token + progress ของตัวเอง (ส่งซ้ำตอน retry)
//   ไม่รู้ผล = ค้าง SETTLING ห้ามยิงซ้ำจนค้างเกิน 5 นาที · POST ไม่ลองซ้ำเอง · กลุ่มที่ DONE แล้วไม่ยิงอีกเด็ดขาด
import { getCreds } from "./creds"
import { ConflictError, NotFoundError, ddmmyyyyBkk, swCol, transition, writeLog, type Actor } from "./db"
import { isPendingFlow } from "./core"
import { HttpError } from "./http"
import { MSG, STUCK_MS, callNcac, interpret, toWire } from "./issue"
import { linkAttachments, resolveLinkable } from "./attachments"
import { buildSettleGroups, leftoverTotal, parseDue, parseSummary, settleRemark, summaryAttachIds } from "./pending"
import type { AtmsProgress, SwRequest, SwSettleGroup } from "./types"

const emptyAtms = (): AtmsProgress => ({
  gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null,
})
const who = (a: Actor) => ({ email: a.email, name: a.name, via: a.via })
const isOwner = (r: SwRequest, a: Actor) => r.requestedBy.email.trim().toLowerCase() === a.email

async function load(no: string): Promise<SwRequest> {
  const cur = await (await swCol()).findOne({ no })
  if (!cur) throw new NotFoundError()
  return cur
}

// ---------- ส่งของ (สโตร์) ----------

/** ใบ pending: ส่งของ = READY → HANDED_OUT ไม่เขียน ATMS (จำนวนจ่าย/ของขาดแก้ไว้แล้วตอนจัดของ) */
export async function handOut(no: string, actor: Actor): Promise<SwRequest> {
  return transition(no, "handOut", actor)
}

// ---------- สรุปการใช้ (ผู้ขอ) ----------

export async function submitSummary(no: string, body: Record<string, unknown>, actor: Actor): Promise<SwRequest> {
  const cur = await load(no)
  if (!isOwner(cur, actor)) throw new HttpError("ใบนี้ไม่ใช่ของคุณ สรุปได้เฉพาะใบที่ตัวเองยื่น", 403)
  if (!isPendingFlow(cur)) throw new ConflictError("ใบนี้ไม่ใช่งาน Mobile/PM แบบสรุปทีหลัง")
  if (cur.status !== "HANDED_OUT") throw new ConflictError("สรุปได้เฉพาะใบที่สโตร์ส่งของแล้วและยังไม่ได้สรุป รีเฟรชดูสถานะ")
  const p = parseSummary(cur.lines, body)
  if ("error" in p) throw new HttpError(p.error, 400)
  const all = summaryAttachIds(p.usages, body.attachmentIds)
  if ("error" in all) throw new HttpError(all.error, 400)
  // ทุก id ต้องเป็นไฟล์ของใบนี้ หัวข้อ summary ที่ผู้สรุปอัปโหลดเอง ยืนยันแล้ว และยังไม่ถูกผูก — ไม่ผ่านสักตัว = 400
  const ids = await resolveLinkable(no, all, "summary", actor)
  const summary = { ...p, by: { email: actor.email, name: actor.name }, at: new Date() }
  const after = await transition(no, "summarize", actor, { summary })
  // ผูกครั้งเดียว (ไฟล์ที่ผูกแล้วไม่ถูกแตะ) · id เดียวอยู่หลายแถวได้ ผูกครั้งเดียวพอ
  await linkAttachments(no, ids, { type: "summary" })
  return after
}

// ---------- เลื่อนกำหนดสรุป (ผู้ขอ) ----------

export async function extendDue(no: string, body: Record<string, unknown>, actor: Actor): Promise<SwRequest> {
  const cur = await load(no)
  if (!isOwner(cur, actor)) throw new HttpError("ใบนี้ไม่ใช่ของคุณ เลื่อนกำหนดได้เฉพาะใบที่ตัวเองยื่น", 403)
  if (!isPendingFlow(cur)) throw new ConflictError("ใบนี้ไม่มีกำหนดสรุปยอด")
  if (cur.status !== "HANDED_OUT") throw new ConflictError("เลื่อนกำหนดได้เฉพาะใบที่ยังไม่ได้สรุป รีเฟรชดูสถานะ")
  const d = parseDue(body.summaryDueAt, new Date())
  if ("error" in d) throw new HttpError(d.error, 400)
  const after = await (await swCol()).findOneAndUpdate(
    { no, status: "HANDED_OUT", summaryDueAt: cur.summaryDueAt },
    { $set: { summaryDueAt: d.due, updatedAt: new Date() }, $inc: { summaryExtensions: 1 } },
    { returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  const old = cur.summaryDueAt ? new Date(cur.summaryDueAt).toISOString() : "-"
  await writeLog({ no, action: "extendDue", from: "HANDED_OUT", to: "HANDED_OUT", actor: who(actor), note: `${old} → ${d.due.toISOString()}` })
  return after
}

// ---------- ตัดสต๊อก (สโตร์) ----------

/** ยึดงานตัด: SUMMARIZED/SETTLE_FAILED → SETTLING (atomic) · SETTLING ค้างเกิน 5 นาที = ยึดทำต่อ · ครั้งแรกบันทึกกลุ่มไว้ */
async function claimSettle(no: string, returnConfirmed: unknown, actor: Actor): Promise<SwRequest> {
  const col = await swCol()
  const cur = await load(no)
  if (!isPendingFlow(cur)) throw new ConflictError("ใบนี้ไม่ใช่งาน Mobile/PM แบบสรุปทีหลัง ใช้ปุ่มส่งของตามปกติ")
  if (!cur.summary) throw new ConflictError("ใบนี้ยังไม่มีสรุปการใช้จากช่าง")
  const left = leftoverTotal(cur.summary)
  if (left > 0 && returnConfirmed !== true) throw new HttpError("ติ๊ก \"รับของคืนแล้ว\" ก่อน ใบนี้มีของเหลือต้องคืนสโตร์", 400)

  if (cur.status === "SETTLING" && Date.now() - cur.updatedAt.getTime() > STUCK_MS) {
    const after = await col.findOneAndUpdate(
      { no, status: "SETTLING", updatedAt: cur.updatedAt },
      { $set: { updatedAt: new Date(), "settleGroups.$[].atms.error": null } },
      { returnDocument: "after" },
    )
    if (!after) throw new ConflictError()
    await writeLog({ no, action: "settle-resume", from: "SETTLING", to: "SETTLING", actor: who(actor) })
    return after
  }

  const confirm = left > 0 && !cur.returnConfirmedAt ? { returnConfirmedBy: { email: actor.email, name: actor.name }, returnConfirmedAt: new Date() } : {}
  // ครั้งแรก: บันทึกกลุ่ม (เลขกลุ่ม/token/บรรทัด) พร้อมสลับสถานะในคำสั่งเดียว · ลองใหม่: ใช้กลุ่มเดิม แค่ล้างข้อความ error เก่า
  const patch = cur.settleGroups == null
    ? { ...confirm, settleGroups: buildSettleGroups(no, cur.summary.usages, emptyAtms) }
    : { ...confirm, "settleGroups.$[].atms.error": null, "settleGroups.$[].atms.needCreds": false }
  return transition(no, "settle", actor, patch)
}

export async function settleRequest(no: string, returnConfirmed: unknown, actor: Actor): Promise<SwRequest> {
  const claimed = await claimSettle(no, returnConfirmed, actor)
  const at = { n: null as number | null }
  try {
    return await runSettle(claimed, actor, at)
  } catch (e) {
    if (e instanceof ConflictError) throw e
    // ห้ามค้าง SETTLING — เขียนเฉพาะ error ของกลุ่มที่กำลังทำ (ไม่ทับ progress) แล้วเป็น SETTLE_FAILED
    console.error("[store-withdraw] settle crashed", no, e instanceof Error ? e.message : e)
    try {
      if (at.n != null) await setGroup(no, at.n, { "atms.error": MSG.crashed, "atms.needCreds": false })
      return await transition(no, "settleFailed", actor)
    } catch {
      return (await (await swCol()).findOne({ no })) ?? claimed
    }
  }
}

/** แก้ field ของกลุ่มเดียว ขณะใบยัง SETTLING เท่านั้น */
async function setGroup(no: string, n: number, set: Record<string, unknown>): Promise<SwRequest> {
  const $set: Record<string, unknown> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(set)) $set[`settleGroups.$[g].${k}`] = v
  const after = await (await swCol()).findOneAndUpdate({ no, status: "SETTLING" }, { $set }, { arrayFilters: [{ "g.n": n }], returnDocument: "after" })
  if (!after) throw new ConflictError()
  return after
}

function groupBody(r: SwRequest, g: SwSettleGroup, prev: AtmsProgress, startedAt: Date) {
  return {
    inventory_id: r.inventoryId,
    pick_to_id: r.pickToId,
    remark_token: g.token,
    remark: settleRemark(r, g),
    date: ddmmyyyyBkk(startedAt),
    lines: g.lines.map((x) => {
      const line = r.lines[x.lineIndex]
      return {
        sku_id: line.skuId,
        amount: x.qty,
        sku_name: line.skuName,
        mr_item_id: x.mrItemId,
        ...(line.serialNoId != null ? { serial_no_id: line.serialNoId } : {}),
        ...(line.remark ? { remark: line.remark } : {}),
      }
    }),
    ...(toWire(prev) ? { progress: toWire(prev) } : {}),
  }
}

async function runSettle(claimed: SwRequest, actor: Actor, at: { n: number | null }): Promise<SwRequest> {
  const no = claimed.no
  const groups = claimed.settleGroups ?? []
  const todo = groups.filter((g) => g.status !== "DONE")
  // ใช้ 0 ทั้งใบ (คืนหมด) หรือทุกกลุ่มเสร็จแล้ว = ไม่ต้องยิง ATMS
  if (todo.length === 0) return transition(no, "settled", actor)

  const creds = await getCreds(actor.email)
  if (!creds) {
    await setGroup(no, todo[0].n, { "atms.needCreds": true, "atms.error": MSG.noCreds })
    return transition(no, "settleFailed", actor)
  }

  for (const g of todo) {
    at.n = g.n
    const startedAt = g.atms.startedAt ?? new Date()
    // บันทึกวันเริ่มก่อนยิง — retry ต้องใช้วันเดิม (ATMS ค้นหมายเหตุตามวันสร้าง)
    if (!g.atms.startedAt) {
      await (await swCol()).updateOne({ no, status: "SETTLING" }, { $set: { "settleGroups.$[g].atms.startedAt": startedAt } }, { arrayFilters: [{ "g.n": g.n, "g.atms.startedAt": null }] })
    }
    const prev: AtmsProgress = { ...g.atms, startedAt }
    const r = await callNcac("POST", "/atms/withdraw/issue", { creds, body: groupBody(claimed, g, prev, startedAt) })
    if (!r) {
      // ส่งไปแล้วไม่ได้คำตอบ: ค้าง SETTLING ไว้ ห้ามยิงซ้ำจนครบ 5 นาที (กติกาเดียวกับ issue)
      await setGroup(no, g.n, { "atms.error": MSG.unknown, "atms.needCreds": false })
      await writeLog({ no, action: "settle-unknown", from: "SETTLING", to: "SETTLING", actor: who(actor), note: g.token })
      return (await (await swCol()).findOne({ no }))!
    }
    const out = interpret(r.status, r.data, prev)
    if (out.kind === "ok" && out.atms.code && out.atms.approved) {
      await setGroup(no, g.n, { status: "DONE", atms: { ...out.atms, drift: null } })
      await writeLog({ no, action: "settle-group", from: "SETTLING", to: "SETTLING", actor: who(actor), note: `${g.token} ${g.plate} ${out.atms.code}` })
      continue
    }
    await setGroup(no, g.n, { atms: out.kind === "ok" ? { ...out.atms, error: MSG.noCode } : out.atms })
    return transition(no, "settleFailed", actor)
  }
  at.n = null
  return transition(no, "settled", actor)
}
