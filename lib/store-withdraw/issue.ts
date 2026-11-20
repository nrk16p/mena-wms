// lib/store-withdraw/issue.ts — ส่งใบเบิก/รับคืนเข้า ATMS ผ่าน api-ncac แบบทำต่อได้ (resumable)
// กันยิงซ้ำ: สลับสถานะด้วย findOneAndUpdate({no, status: เดิม}) ใน transition · progress เก็บไว้ส่งซ้ำตอน retry
import { getCreds } from "./creds"
import { ConflictError, NotFoundError, ddmmyyyyBkk, swCol, transition, writeLog, type Actor } from "./db"
import { isPendingFlow } from "./core"
import { HttpError } from "./http"
import { hubCutPlan, hubIssueLines, hubStatusOf, hubWdDone, isHubLine, normalIssueLines } from "./hub-core"
import { cutHubForRequest, getHubSite } from "./hub-db"
import { NCAC_CONFIG_MSG, NcacConfigError, ncac } from "./ncac"
import type { AtmsProgress, SwLine, SwRequest } from "./types"
import { syncCoreRowsSafe } from "@/lib/core-return/sw-sync"

export const STUCK_MS = 5 * 60_000

type WireProgress = { gm_id?: number | null; done?: number[]; approved?: boolean; code?: string | null }
type Reply = { progress?: WireProgress; detail?: unknown }

/** ข้อความไทยของงานส่ง ATMS — settle.ts ใช้ร่วม */
export const MSG = {
  noCreds: "ยังไม่ได้ผูกบัญชี ATMS ไปผูกบัญชีก่อน แล้วกดส่งใหม่",
  badAuth: "ATMS ไม่รับบัญชีนี้ (รหัสผ่านอาจเปลี่ยน) ผูกบัญชีใหม่ แล้วกดส่งใหม่",
  config: NCAC_CONFIG_MSG,
  // ส่งออกไปแล้วแต่ไม่ได้คำตอบ (timeout/เครือข่าย) ไม่รู้ว่า ATMS ทำไปหรือยัง จึงห้ามยิงซ้ำทันที
  unknown: "ยังไม่รู้ผลจาก ATMS รอ 5 นาทีแล้วกดลองใหม่",
  network: "ติดต่อ ATMS ไม่ได้ตอนนี้ กดส่งใหม่ได้เลย จะทำต่อจากที่ค้างไว้",
  incomplete: "ข้อมูลที่ส่งไป ATMS ไม่ครบ แจ้งแอดมิน",
  noLines: "ไม่มีรายการที่จ่ายได้ ตรวจจำนวนจ่ายในใบนี้ก่อน",
  noWd: "ใบเบิกนี้ยังไม่มีเลขใบเบิกใน ATMS ส่งเบิกให้สำเร็จก่อนจึงรับคืนได้",
  noPrice: (codes: string[]) => `ไม่พบราคาต่อหน่วยของ ${codes.join(", ")} ในใบเบิก ATMS เช็กใบเบิกใน ATMS แล้วลองใหม่`,
  crashed: "ระบบขัดข้องระหว่างส่ง ATMS กดลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแล",
  noCode: "ATMS ไม่ส่งเลขใบกลับมา กดลองใหม่",
  over: "คืนเกินจำนวนที่เบิก",
  wdFail: "อ่านใบเบิกจาก ATMS ไม่ได้ ลองใหม่อีกครั้ง",
  partial: "ATMS ทำไม่ครบ กดส่งใหม่เพื่อทำต่อ",
  hubShort: (codes: string[]) => `ยอด Hub ไม่พอ: ${codes.join(", ")} แก้จำนวนแล้วกดส่งใหม่`,
  hubBusy: "กำลังตัดยอด Hub อยู่ ลองใหม่อีกครั้ง",
  hubNoSite: "คลังนี้ยังไม่ตั้งคลัง Hub ใน ATMS แจ้งผู้ดูแล",
  hubWdBusy: "กำลังตัด WD Hub อยู่ หรือยังรอผลจาก ATMS รอ 5 นาทีแล้วลองใหม่",
} as const

export const toWire = (a: AtmsProgress) =>
  a.gmId == null && a.done.length === 0 ? undefined : { gm_id: a.gmId, done: a.done, approved: a.approved, code: a.code }

export function fromWire(p: WireProgress | undefined, prev: AtmsProgress): AtmsProgress {
  if (!p) return prev
  return { ...prev, gmId: p.gm_id ?? prev.gmId, done: p.done ?? prev.done, approved: p.approved ?? prev.approved, code: p.code ?? prev.code }
}

/** ข้อความจาก ATMS ที่ปลอดภัยให้ผู้ใช้เห็น · โครงสร้าง (เช่น 422 ของ FastAPI) ไม่โชว์ดิบ เก็บไว้ใน log ฝั่งเซิร์ฟเวอร์ */
function detailText(d: unknown, fallback: string): string {
  if (typeof d === "string" && d) return d.slice(0, 300)
  if (d != null && typeof d === "object") {
    console.warn("[store-withdraw] ncac detail (โครงสร้าง):", JSON.stringify(d).slice(0, 500))
    return MSG.incomplete
  }
  return fallback
}

const headerRemark = (r: SwRequest) => [r.mrCode, r.ref?.code, r.plate, r.remark].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")

export type Outcome = { kind: "ok" | "partial" | "auth" | "config" | "error"; atms: AtmsProgress }

/** แปลงผลตอบกลับของ api-ncac เป็นสถานะ progress ใหม่ — ใช้ร่วมกันทั้ง issue และ return */
export function interpret(status: number, data: Reply | null, prev: AtmsProgress): Outcome {
  const base = { ...prev, needCreds: false }
  if (status >= 200 && status < 300) return { kind: "ok", atms: { ...fromWire(data?.progress, base), error: null } }
  if (status === 409) return { kind: "partial", atms: { ...fromWire(data?.progress, base), error: detailText(data?.detail, MSG.partial) } }
  // 401 = ATMS ไม่รับบัญชีของผู้ใช้ (ผูกใหม่) · 403 = api-ncac ไม่รับ key ของ WMS (ปัญหาตั้งค่า ผู้ใช้ผูกบัญชีใหม่ก็ไม่หาย)
  if (status === 401) return { kind: "auth", atms: { ...base, needCreds: true, error: MSG.badAuth } }
  if (status === 403) return { kind: "config", atms: { ...base, needCreds: false, error: MSG.config } }
  return { kind: "error", atms: { ...base, error: detailText(data?.detail, `ATMS ตอบกลับผิดปกติ (${status}) ลองใหม่อีกครั้ง`) } }
}

export async function callNcac(...args: Parameters<typeof ncac>): Promise<{ status: number; data: Reply | null } | null> {
  try {
    const r = await ncac<Reply | null>(...args)
    return r
  } catch (e) {
    // ตั้งค่า api-ncac ไม่ครบ = ยังไม่ได้ยิงอะไร → ทำเหมือน 403 (ตั้งค่าผิด) ไม่ใช่ "ไม่รู้ผล"
    if (e instanceof NcacConfigError) return { status: 403, data: null }
    return null // timeout / เครือข่ายล่ม — ไม่เก็บ error ดิบ เผื่อมี URL/ข้อมูลหลุด
  }
}

/**
 * ยิง ATMS ไปแล้วแต่ไม่ได้คำตอบ: ค้างสถานะ ISSUING ไว้ (ไม่ใช่ ISSUE_FAILED) บันทึกแค่ atms.error + เวลา
 * ปล่อยให้กติกา "ค้างเกิน 5 นาที ยึดทำต่อได้" เป็นตัวเปิดให้ลองใหม่ → ไม่ยิงซ้อนกับคำขอเดิมที่อาจยังวิ่งอยู่ใน ATMS
 */
async function holdIssueUnknown(no: string, actor: Actor): Promise<SwRequest> {
  const col = await swCol()
  const after = await col.findOneAndUpdate(
    { no, status: "ISSUING" },
    { $set: { "atms.error": MSG.unknown, "atms.needCreds": false, updatedAt: new Date() } },
    { returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  await writeLog({ no, action: "issue-unknown", from: "ISSUING", to: "ISSUING", actor: { email: actor.email, name: actor.name, via: actor.via } })
  return after
}

async function holdReturnUnknown(no: string, rid: string, actor: Actor): Promise<SwRequest> {
  const col = await swCol()
  const after = await col.findOneAndUpdate(
    { no, returns: { $elemMatch: { rid, status: "RETURNING" } } },
    { $set: { "returns.$[r].atms.error": MSG.unknown, "returns.$[r].atms.needCreds": false, updatedAt: new Date() } },
    { arrayFilters: [{ "r.rid": rid }], returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  await writeLog({ no, action: "return-unknown", from: "RETURNING", to: "RETURNING", actor: { email: actor.email, name: actor.name, via: actor.via }, note: rid })
  return after
}

/** ใบที่ ISSUING ค้างเกิน 5 นาที (โปรเซสตายกลางคัน) ให้ยึดมาทำต่อได้ ไม่งั้นค้างตลอด · prior = สถานะก่อนยึด (ยอด Hub ไม่พอ → ถอยกลับ) */
async function claimIssue(no: string, actor: Actor): Promise<{ claimed: SwRequest; prior: SwRequest["status"] }> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new NotFoundError()
  const prior = cur.status
  if (cur.status === "ISSUING" && Date.now() - cur.updatedAt.getTime() > STUCK_MS) {
    const after = await col.findOneAndUpdate(
      { no, status: "ISSUING", updatedAt: cur.updatedAt },
      { $set: { updatedAt: new Date(), "atms.error": null } },
      { returnDocument: "after" },
    )
    if (!after) throw new ConflictError()
    await writeLog({ no, action: "issue-resume", from: "ISSUING", to: "ISSUING", actor: { email: actor.email, name: actor.name, via: actor.via } })
    return { claimed: after, prior }
  }
  return { claimed: await transition(no, "issue", actor, { "atms.error": null }), prior } // ลองใหม่ปกติ ไม่ให้การ์ดโชว์ error เก่า
}

export async function issueRequest(no: string, actor: Actor): Promise<SwRequest> {
  const { claimed, prior } = await claimIssue(no, actor)
  try {
    return await runIssue(claimed, prior, actor)
  } catch (e) {
    if (e instanceof ConflictError || e instanceof HttpError) throw e // HttpError = ยอด Hub ไม่พอ (ถอยสถานะไปแล้ว)
    // ห้ามค้าง ISSUING — แปลงเป็น ISSUE_FAILED พร้อมข้อความไทย (ไม่ใส่ข้อความ error ดิบ)
    // เขียนเฉพาะ atms.error / needCreds ห้ามเขียนทั้งก้อน atms ทับ (claimed อ่านก่อนบันทึก startedAt/gmId/done)
    console.error("[store-withdraw] issue crashed", no, e instanceof Error ? e.message : e)
    try {
      return await transition(no, "issueFailed", actor, { "atms.error": MSG.crashed, "atms.needCreds": false })
    } catch {
      return (await (await swCol()).findOne({ no })) ?? claimed
    }
  }
}

/** ลำดับ: ตัดยอด Hub (ครั้งเดียว) → WD ปกติ → WD Hub · สองใบหลังไม่ขึ้นต่อกัน · ใบไม่มี Hub = ทางเดิมทุกอย่าง */
async function runIssue(claimed: SwRequest, prior: SwRequest["status"], actor: Actor): Promise<SwRequest> {
  const hasHub = claimed.lines.some(isHubLine)
  if (hasHub && !claimed.hubIssuedAt) await cutHub(claimed, prior, actor)
  const after = await runNormal(claimed, actor)
  if (!hasHub || hubWdDone(after)) return after
  return runHubWd(claimed.no, actor, false)
}

/** ตัดยอด hub_stock ทุกบรรทัด Hub แบบได้ทั้งหมดหรือไม่ได้เลย · ไม่พอ/ชนกัน = ถอยสถานะ (ยังไม่มีอะไรเกิดใน ATMS) แล้ว 409 */
async function cutHub(claimed: SwRequest, prior: SwRequest["status"], actor: Actor): Promise<void> {
  const no = claimed.no
  const col = await swCol()
  const by = { email: actor.email, name: actor.name }
  const plan = hubCutPlan(claimed.lines, claimed.inventoryId)
  const res = plan.length ? await cutHubForRequest(no, plan, claimed.inventoryId, by) : ({ ok: true } as const)
  if (!res.ok) {
    // ยอดไม่พอ → กลับ PREPARING ให้สโตร์แก้จำนวนได้ (แก้ได้เฉพาะ PREPARING) · ชนกัน → กลับสถานะเดิม
    // ยึดใบที่ค้าง ISSUING มา = ยังไม่เคยยิง ATMS (ตัดยอดมาก่อนเสมอ) จึงกลับ READY ได้
    const back = !res.busy ? "PREPARING" : prior === "ISSUING" ? (claimed.atms.gmId == null ? "READY" : "ISSUE_FAILED") : prior
    const msg = res.busy ? MSG.hubBusy : MSG.hubShort([...new Set(res.short.map((x) => x.skuCode ?? String(x.skuId)))])
    await col.updateOne({ no, status: "ISSUING" }, { $set: { status: back, updatedAt: new Date() } })
    await writeLog({ no, action: res.busy ? "hubBusy" : "hubShort", from: "ISSUING", to: back, actor: { email: actor.email, name: actor.name, via: actor.via }, note: msg })
    throw new HttpError(msg, 409)
  }
  // hubIssuedAt + hubStatus ในคำสั่งเดียว (ไม่มีช่วงที่ส่งแล้วแต่ hubStatus ยัง WAIT_ISSUE)
  // ผู้ขอผูก PR พร้อมกันได้ → เงื่อนไข hubPr เดิม ไม่ผ่าน = อ่านใหม่แล้วคิดอีกรอบ
  const hubIssuedAt = new Date()
  let cur: SwRequest | null = claimed
  for (let i = 0; i < 3 && cur && !cur.hubIssuedAt; i++) {
    const r = await col.updateOne({ no, hubIssuedAt: null, hubPr: cur.hubPr ?? null } as never, { $set: { hubIssuedAt, hubStatus: hubStatusOf({ ...cur, hubIssuedAt }) } })
    if (r.modifiedCount) return
    cur = await col.findOne({ no })
  }
}

const wireLine = (line: SwLine) => ({
  sku_id: line.skuId,
  amount: line.issuedQty ?? line.requestedQty,
  sku_name: line.skuName,
  ...(line.mrItemId != null ? { mr_item_id: line.mrItemId } : {}),
  ...(line.serialNoId != null ? { serial_no_id: line.serialNoId } : {}),
  ...(line.remark ? { remark: line.remark } : {}),
})

async function runNormal(claimed: SwRequest, actor: Actor): Promise<SwRequest> {
  const no = claimed.no
  // ใบที่มีแต่ของ Hub = ส่วนปกติไม่มีอะไรต้องยิง ถือว่าเสร็จ
  if (claimed.lines.some(isHubLine) && normalIssueLines(claimed.lines).length === 0 && hubIssueLines(claimed.lines).length > 0) {
    return transition(no, "issued", actor)
  }
  const col = await swCol()
  const startedAt = claimed.atms.startedAt ?? new Date()
  if (!claimed.atms.startedAt) await col.updateOne({ no, "atms.startedAt": null }, { $set: { "atms.startedAt": startedAt } })
  const prev: AtmsProgress = { ...claimed.atms, startedAt }

  const fail = (atms: AtmsProgress) => transition(no, "issueFailed", actor, { atms })

  const creds = await getCreds(actor.email)
  if (!creds) return fail({ ...prev, needCreds: true, error: MSG.noCreds })

  const sent = normalIssueLines(claimed.lines) // progress.done เป็น index ของลิสต์นี้ (ไม่รวมบรรทัด Hub)
  if (sent.length === 0) return fail({ ...prev, needCreds: false, error: MSG.noLines })

  const body = {
    inventory_id: claimed.inventoryId,
    pick_to_id: claimed.pickToId,
    remark_token: claimed.no,
    remark: headerRemark(claimed),
    date: ddmmyyyyBkk(startedAt),
    lines: sent.map(({ line }) => wireLine(line)),
    ...(toWire(prev) ? { progress: toWire(prev) } : {}),
  }

  const r = await callNcac("POST", "/atms/withdraw/issue", { creds, body })
  if (!r) return holdIssueUnknown(no, actor)
  const out = interpret(r.status, r.data, prev)
  if (out.kind === "ok" && !(out.atms.code && out.atms.approved)) return fail({ ...out.atms, error: MSG.noCode })
  if (out.kind === "ok") {
    const after = await transition(no, "issued", actor, { atms: { ...out.atms, drift: null } }) // ส่งสำเร็จ = ล้างธงเก่า
    await syncCoreRowsSafe(after, actor) // แถวรอคืนซาก — หลังบันทึก ISSUED แล้วเท่านั้น · พังไม่กระทบใบ
    return after
  }
  return fail(out.atms)
}

// ---------- WD ของ Hub (ใบแยก คลัง Hub) ----------

const emptyAtms = (): AtmsProgress => ({ gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null, startedAt: null })

/**
 * ยึดล็อก hubWdBusyAt (ว่าง หรือค้างเกิน 5 นาที) ของใบที่ตัดยอด Hub แล้วและยังไม่ถูกปิด
 * ใช้ร่วม: WD Hub ใบเดียว (runHubWd) และกลุ่ม Hub ตอนตัดสต๊อก Mobile/PM (runHubSettle ใน settle.ts) · null = มีตัวอื่นถืออยู่
 */
export async function takeHubWdLock(no: string): Promise<{ got: SwRequest; lockAt: Date } | null> {
  const lockAt = new Date()
  const got = await (await swCol()).findOneAndUpdate(
    {
      no, hubIssuedAt: { $ne: null }, status: { $nin: ["REJECTED", "CANCELLED"] },
      $or: [{ hubWdBusyAt: null }, { hubWdBusyAt: { $lt: new Date(lockAt.getTime() - STUCK_MS) } }],
    },
    { $set: { hubWdBusyAt: lockAt } },
    { returnDocument: "after" },
  )
  return got ? { got, lockAt } : null
}

/**
 * ยิง WD Hub ของใบนี้ · เขียนแค่ hubWd/hubStatus ไม่แตะ status ของใบ · ห้าม throw (ยกเว้น strict + ล็อกไม่ได้)
 * ล็อก hubWdBusyAt กันยิงซ้อน · ไม่ได้คำตอบ = ล็อกค้างไว้ ครบ 5 นาทีจึงลองใหม่ได้ (เหมือน ISSUING ค้าง)
 */
async function runHubWd(no: string, actor: Actor, strict: boolean): Promise<SwRequest> {
  const col = await swCol()
  const lock = await takeHubWdLock(no)
  if (!lock) {
    if (strict) throw new ConflictError(MSG.hubWdBusy)
    return (await col.findOne({ no }))!
  }
  const { got, lockAt } = lock
  const who = { email: actor.email, name: actor.name, via: actor.via }
  const save = async (atms: AtmsProgress, release: boolean): Promise<SwRequest> => {
    const after = await col.findOneAndUpdate(
      { no, hubWdBusyAt: lockAt }, // ล็อกถูกยึดไปแล้ว = อีกตัวรับช่วง ไม่เขียนทับ
      { $set: { hubWd: atms, ...(release ? { hubWdBusyAt: null } : {}), updatedAt: new Date() } },
      { returnDocument: "after" },
    )
    if (!after) return (await col.findOne({ no }))!
    const hubStatus = hubStatusOf(after)
    await col.updateOne({ no }, { $set: { hubStatus } })
    return { ...after, hubStatus }
  }
  const base = got.hubWd ?? emptyAtms()
  try {
    if (hubWdDone(got)) return await save(base, true)
    const site = await getHubSite(got.inventoryId)
    if (!site) return await save({ ...base, needCreds: false, error: MSG.hubNoSite }, true)
    const creds = await getCreds(actor.email)
    if (!creds) return await save({ ...base, needCreds: true, error: MSG.noCreds }, true)

    // บันทึกวันเริ่มก่อนยิง — ลองใหม่ต้องใช้วันเดิม (ATMS ค้นหมายเหตุตามวันสร้าง)
    const startedAt = base.startedAt ?? new Date()
    if (!got.hubWd) await col.updateOne({ no }, { $set: { hubWd: { ...base, startedAt } } })
    else if (!base.startedAt) await col.updateOne({ no, "hubWd.startedAt": null }, { $set: { "hubWd.startedAt": startedAt } })
    const prev: AtmsProgress = { ...base, startedAt, error: null }
    const body = {
      inventory_id: site.atmsHubInventoryId,
      pick_to_id: got.pickToId,
      remark_token: `${no}-H`,
      remark: headerRemark(got),
      date: ddmmyyyyBkk(startedAt),
      lines: hubIssueLines(got.lines).map(({ line }) => wireLine(line)),
      ...(toWire(prev) ? { progress: toWire(prev) } : {}),
    }
    const r = await callNcac("POST", "/atms/withdraw/issue", { creds, body })
    if (!r) {
      await writeLog({ no, action: "hubWd-unknown", from: got.status, to: got.status, actor: who })
      return await save({ ...prev, needCreds: false, error: MSG.unknown }, false)
    }
    const out = interpret(r.status, r.data, prev)
    const ok = out.kind === "ok" && !!(out.atms.code && out.atms.approved)
    const atms = out.kind === "ok" && !ok ? { ...out.atms, error: MSG.noCode } : out.atms
    if (!ok) {
      const after = await save(atms, true)
      await writeLog({ no, action: "hubWdFailed", from: got.status, to: got.status, actor: who })
      return after
    }
    const done = { ...atms, drift: null }
    const live = await col.findOneAndUpdate(
      { no, hubWdBusyAt: lockAt, status: { $nin: ["REJECTED", "CANCELLED"] } },
      { $set: { hubWd: done, hubWdBusyAt: null, updatedAt: new Date() } },
      { returnDocument: "after" },
    )
    if (live) {
      const hubStatus = hubStatusOf(live)
      await col.updateOne({ no }, { $set: { hubStatus } })
      const after = { ...live, hubStatus }
      await writeLog({ no, action: "hubWd", from: got.status, to: got.status, actor: who, note: done.code ?? "" })
      await syncCoreRowsSafe(after, actor) // แถวรอคืนซากของบรรทัด Hub — หลัง WD Hub สำเร็จเท่านั้น
      return after
    }
    // ใบถูกปิดระหว่างรอ ATMS (หรือล็อกถูกยึด) — WD เกิดใน ATMS แล้ว ต้องบันทึกเลขไว้เสมอ
    const latest = await col.findOneAndUpdate({ no }, { $set: { hubWd: done, hubWdBusyAt: null, updatedAt: new Date() } }, { returnDocument: "after" })
    if (!latest) return got
    const hubStatus = hubStatusOf(latest)
    await col.updateOne({ no }, { $set: { hubStatus } })
    const after = { ...latest, hubStatus }
    if (latest.status === "REJECTED" || latest.status === "CANCELLED") {
      // ของ Hub ออกไปจริงแล้ว (ไม่ได้คืนยอด) → ใบยังค้าง PR (hubStatus WAIT_PR) + มีแถวซากเหมือนใบที่ WD Hub สำเร็จก่อนปิด
      await writeLog({ no, action: "hubWd-after-close", from: latest.status, to: latest.status, actor: who, note: `${done.code ?? ""} ได้ WD Hub หลังปิดใบ ตรวจยอด Hub กับ ATMS · ยังต้องผูก PR` })
      await syncCoreRowsSafe(after, actor)
      return after
    }
    await writeLog({ no, action: "hubWd", from: got.status, to: got.status, actor: who, note: done.code ?? "" })
    await syncCoreRowsSafe(after, actor)
    return after
  } catch (e) {
    console.error("[store-withdraw] hub wd crashed", no, e instanceof Error ? e.message : e)
    try {
      const latest = (await col.findOne({ no })) ?? got
      return await save({ ...(latest.hubWd ?? base), needCreds: false, error: MSG.crashed }, true)
    } catch {
      return (await col.findOne({ no })) ?? got
    }
  }
}

/**
 * ปุ่ม "ลองตัด WD Hub ใหม่" — ตัดยอด Hub แล้วแต่ WD Hub ยังไม่สำเร็จ · ไม่ตัดยอดซ้ำ
 * ใบ Mobile/PM: ได้เฉพาะใบที่ตัดสต๊อกแล้ว (SETTLED) ยิงเฉพาะกลุ่ม Hub ที่ยังไม่ DONE
 */
export async function retryHubWd(no: string, actor: Actor): Promise<SwRequest> {
  const cur = await (await swCol()).findOne({ no })
  if (!cur) throw new NotFoundError()
  if (!cur.hubIssuedAt || hubWdDone(cur) || cur.status === "REJECTED" || cur.status === "CANCELLED") throw new ConflictError()
  if (isPendingFlow(cur)) {
    if (cur.status !== "SETTLED") throw new ConflictError()
    const { runHubSettle } = await import("./settle") // import ตอนใช้ — settle.ts import ไฟล์นี้อยู่แล้ว
    return runHubSettle(no, actor, true)
  }
  return runHubWd(no, actor, true)
}

// ---------- รับคืน ----------

const RETURN_OPEN = ["RETURN_REQUESTED", "RETURN_FAILED"]

async function claimReturn(no: string, rid: string, actor: Actor): Promise<SwRequest> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  const prior = cur?.returns.find((x) => x.rid === rid)?.status
  if (!cur) throw new NotFoundError()
  if (!prior) throw new NotFoundError("ไม่พบใบคืนนี้")
  if (!["ISSUED", "RECEIVED"].includes(cur.status)) throw new ConflictError()
  const now = new Date()
  const stale = new Date(now.getTime() - STUCK_MS)
  const filter =
    prior === "RETURNING"
      ? { no, status: cur.status, returns: { $elemMatch: { rid, status: "RETURNING" } }, updatedAt: { $lt: stale } } // ค้างเกิน 5 นาที
      : RETURN_OPEN.includes(prior)
        ? { no, status: cur.status, returns: { $elemMatch: { rid, status: prior } } }
        : null
  if (!filter) throw new ConflictError()
  const after = await col.findOneAndUpdate(
    filter,
    { $set: { "returns.$[r].status": "RETURNING", "returns.$[r].acceptedBy": actor.email, "returns.$[r].atms.error": null, updatedAt: now } },
    { arrayFilters: [{ "r.rid": rid }], returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  // บันทึกเวลาเริ่มก่อนยิง ATMS — ค้างแล้วรีไทรต้องใช้วันเดิม (ATMS ค้นหมายเหตุตามวันสร้าง)
  await col.updateOne({ no }, { $set: { "returns.$[r].atms.startedAt": now } }, { arrayFilters: [{ "r.rid": rid, "r.atms.startedAt": null }] })
  const fresh = (await col.findOne({ no })) ?? after
  await writeLog({ no, action: "acceptReturn", from: prior, to: "RETURNING", actor: { email: actor.email, name: actor.name, via: actor.via }, note: rid })
  return fresh
}

async function settleReturn(
  no: string, rid: string, actor: Actor, ok: boolean, atms: AtmsProgress, inc: Record<string, number> = {},
): Promise<SwRequest> {
  const col = await swCol()
  const status = ok ? "RETURNED" : "RETURN_FAILED"
  const after = await col.findOneAndUpdate(
    { no, returns: { $elemMatch: { rid, status: "RETURNING" } } },
    {
      $set: { "returns.$[r].status": status, "returns.$[r].atms": atms, updatedAt: new Date() },
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
    },
    { arrayFilters: [{ "r.rid": rid }], returnDocument: "after" },
  )
  if (!after) throw new ConflictError()
  await writeLog({ no, action: ok ? "returned" : "returnFailed", from: "RETURNING", to: status, actor: { email: actor.email, name: actor.name, via: actor.via }, note: rid })
  return after
}

type WdItem = { sku_code?: string; unit_price?: number | string | null }

export async function acceptReturn(no: string, rid: string, actor: Actor): Promise<SwRequest> {
  const claimed = await claimReturn(no, rid, actor)
  try {
    return await runReturn(claimed, rid, actor)
  } catch (e) {
    if (e instanceof ConflictError) throw e
    console.error("[store-withdraw] return crashed", no, rid, e instanceof Error ? e.message : e)
    try {
      // อ่านใบล่าสุดก่อนเขียน — claimed เก่ากว่า startedAt/progress ที่บันทึกไปแล้ว
      const latest = (await (await swCol()).findOne({ no })) ?? claimed
      const atms = (latest.returns.find((x) => x.rid === rid) ?? claimed.returns.find((x) => x.rid === rid)!).atms
      return await settleReturn(no, rid, actor, false, { ...atms, needCreds: false, error: MSG.crashed })
    } catch {
      return (await (await swCol()).findOne({ no })) ?? claimed
    }
  }
}

async function runReturn(claimed: SwRequest, rid: string, actor: Actor): Promise<SwRequest> {
  const no = claimed.no
  const ret = claimed.returns.find((x) => x.rid === rid)!
  const startedAt = ret.atms.startedAt ?? new Date() // claimReturn บันทึกไว้แล้วเสมอ
  const prev: AtmsProgress = { ...ret.atms, startedAt }
  const fail = (atms: AtmsProgress) => settleReturn(no, rid, actor, false, atms)

  const creds = await getCreds(actor.email)
  if (!creds) return fail({ ...prev, needCreds: true, error: MSG.noCreds })

  const gmId = claimed.atms.gmId
  if (gmId == null || !claimed.atms.code) return fail({ ...prev, needCreds: false, error: MSG.noWd })

  const picked = ret.lines
    .filter((l) => l.qty > 0 && claimed.lines[l.lineIndex])
    .map((l) => ({ lineIndex: l.lineIndex, qty: l.qty, line: claimed.lines[l.lineIndex] as SwLine }))
  if (picked.length === 0) return fail({ ...prev, needCreds: false, error: MSG.noLines })

  // ราคาต่อหน่วยมาจากใบเบิกใน ATMS (จับคู่ด้วยรหัส SKU)
  const wd = await callNcac("GET", `/atms/withdraw/${gmId}`, { creds })
  if (!wd) return fail({ ...prev, needCreds: false, error: MSG.network }) // อ่านอย่างเดียว ยังไม่ได้เขียน ATMS → ลองใหม่ได้เลย
  if (wd.status === 401) return fail({ ...prev, needCreds: true, error: MSG.badAuth })
  if (wd.status === 403) return fail({ ...prev, needCreds: false, error: MSG.config })
  if (wd.status < 200 || wd.status >= 300) return fail({ ...prev, needCreds: false, error: detailText(wd.data?.detail, MSG.wdFail) })
  const items = ((wd.data as { items?: WdItem[] } | null)?.items ?? [])
  const price = new Map<string, number>()
  for (const it of items) {
    const p = Number(it.unit_price)
    if (it.sku_code && Number.isFinite(p) && !price.has(it.sku_code)) price.set(it.sku_code, p)
  }
  const missing = picked.filter((p) => !price.has(p.line.skuCode)).map((p) => p.line.skuCode)
  if (missing.length) return fail({ ...prev, needCreds: false, error: MSG.noPrice([...new Set(missing)]) })

  const thisQty = new Map<number, number>()
  for (const p of picked) thisQty.set(p.lineIndex, (thisQty.get(p.lineIndex) ?? 0) + p.qty)
  const complete = claimed.lines.every((l, i) => l.returnedQty + (thisQty.get(i) ?? 0) >= (l.issuedQty ?? l.requestedQty))

  // เช็กจำนวนอีกรอบก่อนยิง: ต้องไม่เกิน เบิก − คืนแล้ว − ใบคืนอื่นที่กำลัง RETURNING
  const latest = (await (await swCol()).findOne({ no })) ?? claimed
  const pending = new Map<number, number>()
  for (const o of latest.returns) {
    if (o.rid === rid || o.status !== "RETURNING") continue
    for (const l of o.lines) pending.set(l.lineIndex, (pending.get(l.lineIndex) ?? 0) + l.qty)
  }
  for (const [i, q] of thisQty) {
    const l = latest.lines[i]
    if (!l || q > (l.issuedQty ?? l.requestedQty) - l.returnedQty - (pending.get(i) ?? 0)) {
      return fail({ ...prev, needCreds: false, error: MSG.over })
    }
  }

  const body = {
    inventory_id: claimed.inventoryId,
    withdraw_id: gmId,
    withdraw_code: claimed.atms.code,
    remark_token: `${claimed.no}-${rid}`,
    date: ddmmyyyyBkk(startedAt),
    lines: picked.map(({ qty, line }) => ({
      sku_id: line.skuId,
      amount: qty,
      unit_price: price.get(line.skuCode)!,
      sku_name: line.skuName,
      ...(line.remark ? { remark: line.remark } : {}),
    })),
    ...(toWire(prev) ? { progress: toWire(prev) } : {}),
    mark_complete: complete,
  }

  const r = await callNcac("POST", "/atms/withdraw/return", { creds, body })
  if (!r) return holdReturnUnknown(no, rid, actor)
  const out = interpret(r.status, r.data, prev)
  if (out.kind !== "ok") return fail(out.atms)
  if (!(out.atms.code && out.atms.approved)) return fail({ ...out.atms, error: MSG.noCode })
  const inc: Record<string, number> = {}
  for (const [i, q] of thisQty) inc[`lines.${i}.returnedQty`] = q
  return settleReturn(no, rid, actor, true, out.atms, inc)
}
