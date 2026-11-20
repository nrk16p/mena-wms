// lib/store-withdraw/settle.ts — Mobile/PM แบบ pending: ส่งของ (ไม่แตะ ATMS) · ช่างสรุปการใช้ · เลื่อนกำหนด · สโตร์ตัดสต๊อก
// ตัดสต๊อก = WD หนึ่งใบต่อทะเบียน ด้วยบัญชี ATMS ของสโตร์ · กติกากันยิงซ้ำเดียวกับ issue.ts:
//   สลับสถานะด้วย findOneAndUpdate({no, status}) · แต่ละกลุ่มมี remark_token + progress ของตัวเอง (ส่งซ้ำตอน retry)
//   ไม่รู้ผล = ค้าง SETTLING ห้ามยิงซ้ำจนค้างเกิน 5 นาที · POST ไม่ลองซ้ำเอง · กลุ่มที่ DONE แล้วไม่ยิงอีกเด็ดขาด
// อะไหล่ Hub: ตัดยอด Hub ตอนส่งของ · กลุ่ม Hub (คลัง Hub ใน ATMS) ยิงหลังใบ SETTLED แล้ว ล้มไม่ดึงใบกลับ (ดู runHubSettle)
//   ของเหลือของบรรทัด Hub คืนเข้ายอด Hub ตอนสโตร์ยืนยันรับคืน · ใบ pending ไม่เคยคืนยอดแบบ restore
import { getCreds } from "./creds"
import { ConflictError, NotFoundError, ddmmyyyyBkk, swCol, transition, writeLog, type Actor } from "./db"
import { isPendingFlow } from "./core"
import { HttpError } from "./http"
import { MSG, STUCK_MS, callNcac, interpret, takeHubWdLock, toWire } from "./issue"
import { hubCutPlan, hubStatusOf, isHubLine } from "./hub-core"
import { HUB_RESTORE_NOTE, cutHubForRequest, getHubSite, restoreHubForRequest, returnHubLeftover } from "./hub-db"
import { linkAttachments, resolveLinkable } from "./attachments"
import { buildSettleGroups, leftoverTotal, parseDue, parseSummary, settleRemark, summaryAttachIds } from "./pending"
import type { AtmsProgress, SwRequest, SwSettleGroup } from "./types"
import { syncCoreRowsSafe } from "@/lib/core-return/sw-sync"

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

/**
 * ใบ pending: ส่งของ = READY → HANDED_OUT ไม่เขียน ATMS (จำนวนจ่าย/ของขาดแก้ไว้แล้วตอนจัดของ)
 * มีบรรทัด Hub: ตัดยอด Hub ทุกบรรทัดก่อน (ได้ทั้งหมดหรือไม่ได้เลย) แล้วสลับสถานะพร้อม hubIssuedAt (เริ่มนับ 1 วัน PR)
 *   ยอดไม่พอ = 409 กลับไปจัดของ (แก้จำนวนได้เฉพาะ PREPARING) · ชนกัน = 409 สถานะเดิม · ใบไม่มี Hub = ทางเดิม
 */
export async function handOut(no: string, actor: Actor): Promise<SwRequest> {
  const cur = await load(no)
  if (!cur.lines.some(isHubLine) || cur.hubIssuedAt) return transition(no, "handOut", actor)
  if (!isPendingFlow(cur) || cur.status !== "READY") throw new ConflictError()
  const col = await swCol()
  const plan = hubCutPlan(cur.lines, cur.inventoryId)
  const res = plan.length ? await cutHubForRequest(no, plan, cur.inventoryId, { email: actor.email, name: actor.name }) : ({ ok: true } as const)
  if (!res.ok) {
    const msg = res.busy ? MSG.hubBusy : MSG.hubShort([...new Set(res.short.map((x) => x.skuCode ?? String(x.skuId)))])
    const back = res.busy ? "READY" : "PREPARING"
    if (!res.busy) await col.updateOne({ no, status: "READY" }, { $set: { status: back, updatedAt: new Date() } })
    await writeLog({ no, action: res.busy ? "hubBusy" : "hubShort", from: "READY", to: back, actor: who(actor), note: msg })
    throw new HttpError(msg, 409)
  }
  const hubIssuedAt = new Date()
  try {
    return await transition(no, "handOut", actor, { hubIssuedAt, hubStatus: hubStatusOf({ ...cur, status: "HANDED_OUT", hubIssuedAt }) })
  } catch (e) {
    // ตัดยอดแล้วแต่ใบถูกเปลี่ยนสถานะไปก่อน (เช่นถูกปฏิเสธพร้อมกัน)
    // ใบปิดแล้วและไม่เคยส่งของ (hubIssuedAt ว่าง) = ยังไม่มี WD Hub แน่นอน (ใบ pending ยิง WD Hub ตอน settle) → คืนยอดที่เพิ่งตัดทันที
    // สถานะอื่น (ไม่ควรเกิด) = ไม่แตะยอด ลง log ให้คนตาม
    const latest = await col.findOne({ no })
    if (plan.length && latest && latest.status !== "HANDED_OUT") {
      const closed = (latest.status === "REJECTED" || latest.status === "CANCELLED") && !latest.hubIssuedAt
      let restored = -1
      if (closed) {
        try {
          restored = await restoreHubForRequest(no, { email: actor.email, name: actor.name }, HUB_RESTORE_NOTE)
          await col.updateOne({ no }, { $set: { hubRestoredAt: new Date() } })
        } catch (err) {
          console.error("[store-withdraw] คืนยอด Hub (handOut ชน) ไม่สำเร็จ", no, err instanceof Error ? err.message : err)
        }
      }
      if (restored >= 0) {
        await writeLog({ no, action: "hubRestore", from: latest.status, to: latest.status, actor: who(actor), note: `ส่งของชนกับการปิดใบ ${HUB_RESTORE_NOTE} ${restored} บรรทัด` })
      } else {
        await writeLog({ no, action: "hubCut-orphan", from: latest.status, to: latest.status, actor: who(actor), note: "ตัดยอด Hub แล้วแต่ส่งของไม่สำเร็จ ตรวจยอด Hub แล้วปรับเอง" })
      }
    }
    throw e
  }
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
    ? { ...confirm, settleGroups: buildSettleGroups(no, cur.summary.usages, emptyAtms, cur.lines) }
    : { ...confirm, "settleGroups.$[].atms.error": null, "settleGroups.$[].atms.needCreds": false }
  return transition(no, "settle", actor, patch)
}

export async function settleRequest(no: string, returnConfirmed: unknown, actor: Actor): Promise<SwRequest> {
  const claimed = await claimSettle(no, returnConfirmed, actor)
  const at = { n: null as number | null }
  try {
    await returnHubLeft(claimed, actor)
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

/**
 * ของเหลือของบรรทัด Hub (summary.returns) → คืนเข้ายอด Hub · claimSettle บังคับยืนยันรับคืนแล้ว
 * เรียกทุกครั้งที่ยึดงานตัดได้ คืนซ้ำไม่ได้ (unique ใน hub_moves) · พัง = SETTLE_FAILED แล้วกดใหม่ทำต่อ
 */
async function returnHubLeft(r: SwRequest, actor: Actor): Promise<void> {
  if (!r.hubIssuedAt) return // ไม่เคยตัดยอด Hub = ไม่มีอะไรต้องคืน
  const items = (r.summary?.returns ?? [])
    .filter((x) => x.qty > 0 && r.lines[x.lineIndex] && isHubLine(r.lines[x.lineIndex]))
    .map((x) => ({ lineIndex: x.lineIndex, vendorCode: r.lines[x.lineIndex].hub!.vendorCode, skuId: r.lines[x.lineIndex].skuId, qty: x.qty }))
  if (items.length) await returnHubLeftover(r.no, items, r.inventoryId, { email: actor.email, name: actor.name })
}

function groupBody(r: SwRequest, g: SwSettleGroup, prev: AtmsProgress, startedAt: Date, inventoryId = r.inventoryId) {
  return {
    inventory_id: inventoryId,
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
  // กลุ่ม Hub ไม่อยู่ในรอบนี้ — ยิงหลัง SETTLED (ล้มไม่ดึงใบกลับ)
  const todo = groups.filter((g) => !g.hub && g.status !== "DONE")
  // ใช้ 0 ทั้งใบ (คืนหมด) หรือทุกกลุ่มเสร็จแล้ว = ไม่ต้องยิง ATMS
  if (todo.length === 0) return settledThenHub(no, actor)

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
  return settledThenHub(no, actor)
}

/** ส่วนปกติเสร็จ → SETTLED · ใบที่มีบรรทัด Hub ยิงกลุ่ม Hub ต่อ (ไม่มีกลุ่ม Hub ก็อัปเดต hubStatus) */
async function settledThenHub(no: string, actor: Actor): Promise<SwRequest> {
  const after = await settled(no, actor)
  return after.lines.some(isHubLine) ? runHubSettle(no, actor, false) : after
}

/**
 * ยิงกลุ่ม Hub ที่ยังไม่ DONE ของใบที่ SETTLED แล้ว (คลัง Hub ใน ATMS) · ไม่แตะ status ของใบ
 * ล็อก hubWdBusyAt ตัวเดียวกับ WD Hub ของอู่ใน · ผลเขียนลงกลุ่มเฉพาะตอนยังถือล็อก · ไม่ได้คำตอบ = ล็อกค้าง ครบ 5 นาทีจึงลองใหม่
 * ห้าม throw (ยกเว้น strict + ล็อกไม่ได้) — เรียกจากตัดสต๊อก และจาก retryHubWd (ปุ่ม "ลองตัด WD Hub ใหม่")
 */
export async function runHubSettle(no: string, actor: Actor, strict: boolean): Promise<SwRequest> {
  const col = await swCol()
  const lock = await takeHubWdLock(no)
  if (!lock) {
    if (strict) throw new ConflictError(MSG.hubWdBusy)
    return (await col.findOne({ no }))!
  }
  const { got, lockAt } = lock
  const filters = (n: number) => ({ arrayFilters: [{ "g.n": n, "g.hub": true }], returnDocument: "after" as const })
  const setHub = (n: number, set: Record<string, unknown>, release: boolean, force = false) => {
    const $set: Record<string, unknown> = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(set)) $set[`settleGroups.$[g].${k}`] = v
    if (release) $set.hubWdBusyAt = null
    // ล็อกถูกยึดไปแล้ว = อีกตัวรับช่วง ไม่เขียนทับ · ยกเว้น force (ได้ WD ใน ATMS แล้ว ต้องบันทึกเลขไว้เสมอ)
    return col.findOneAndUpdate(force ? { no } : { no, hubWdBusyAt: lockAt }, { $set }, filters(n))
  }
  const release = () => col.findOneAndUpdate({ no, hubWdBusyAt: lockAt }, { $set: { hubWdBusyAt: null } }, { returnDocument: "after" })
  let doneAny = false
  const finish = async (doc: SwRequest | null): Promise<SwRequest> => {
    const d = doc ?? (await col.findOne({ no })) ?? got
    const hubStatus = hubStatusOf(d)
    if (d.hubStatus !== hubStatus) await col.updateOne({ no }, { $set: { hubStatus } })
    const after = { ...d, hubStatus }
    if (doneAny) await syncCoreRowsSafe(after, actor) // แถวรอคืนซากของบรรทัด Hub — หลังกลุ่ม Hub สำเร็จเท่านั้น
    return after
  }
  let at: number | null = null
  try {
    const todo = (got.settleGroups ?? []).filter((g) => g.hub && g.status !== "DONE")
    if (got.status !== "SETTLED" || todo.length === 0) return await finish(await release())
    const site = await getHubSite(got.inventoryId)
    if (!site) return await finish(await setHub(todo[0].n, { "atms.error": MSG.hubNoSite, "atms.needCreds": false }, true))
    const creds = await getCreds(actor.email)
    if (!creds) return await finish(await setHub(todo[0].n, { "atms.error": MSG.noCreds, "atms.needCreds": true }, true))

    for (const g of todo) {
      at = g.n
      const startedAt = g.atms.startedAt ?? new Date()
      // บันทึกวันเริ่มก่อนยิง — ลองใหม่ต้องใช้วันเดิม (ATMS ค้นหมายเหตุตามวันสร้าง)
      if (!g.atms.startedAt) {
        await col.updateOne({ no, hubWdBusyAt: lockAt }, { $set: { "settleGroups.$[g].atms.startedAt": startedAt } }, { arrayFilters: [{ "g.n": g.n, "g.hub": true, "g.atms.startedAt": null }] })
      }
      const prev: AtmsProgress = { ...g.atms, startedAt, error: null }
      const r = await callNcac("POST", "/atms/withdraw/issue", { creds, body: groupBody(got, g, prev, startedAt, site.atmsHubInventoryId) })
      if (!r) {
        await writeLog({ no, action: "hubWd-unknown", from: got.status, to: got.status, actor: who(actor), note: g.token })
        return await finish(await setHub(g.n, { "atms.error": MSG.unknown, "atms.needCreds": false }, false)) // ล็อกค้างไว้
      }
      const out = interpret(r.status, r.data, prev)
      if (out.kind === "ok" && out.atms.code && out.atms.approved) {
        const done = { status: "DONE", atms: { ...out.atms, drift: null } }
        const after = (await setHub(g.n, done, false)) ?? (await setHub(g.n, done, false, true))
        doneAny = true
        await writeLog({ no, action: "hubWd", from: got.status, to: got.status, actor: who(actor), note: `${g.token} ${g.plate} ${out.atms.code}` })
        if (after?.hubWdBusyAt?.getTime() !== lockAt.getTime()) return await finish(after) // ล็อกหลุด = หยุด ให้ตัวใหม่ทำต่อ
        continue
      }
      await writeLog({ no, action: "hubWdFailed", from: got.status, to: got.status, actor: who(actor), note: g.token })
      return await finish(await setHub(g.n, { atms: out.kind === "ok" ? { ...out.atms, error: MSG.noCode } : out.atms }, true))
    }
    at = null
    return await finish(await release())
  } catch (e) {
    console.error("[store-withdraw] hub settle crashed", no, e instanceof Error ? e.message : e)
    try {
      return await finish(at != null ? await setHub(at, { "atms.error": MSG.crashed, "atms.needCreds": false }, true) : await release())
    } catch {
      return (await col.findOne({ no })) ?? got
    }
  }
}

/** SETTLING → SETTLED แล้วสร้างแถวรอคืนซากต่อแถวสรุปการใช้ (พังไม่กระทบใบ) */
async function settled(no: string, actor: Actor): Promise<SwRequest> {
  const after = await transition(no, "settled", actor)
  await syncCoreRowsSafe(after, actor)
  return after
}
