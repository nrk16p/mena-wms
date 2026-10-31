// lib/store-withdraw/issue.ts — ส่งใบเบิก/รับคืนเข้า ATMS ผ่าน api-ncac แบบทำต่อได้ (resumable)
// กันยิงซ้ำ: สลับสถานะด้วย findOneAndUpdate({no, status: เดิม}) ใน transition · progress เก็บไว้ส่งซ้ำตอน retry
import { getCreds } from "./creds"
import { ConflictError, NotFoundError, ddmmyyyyBkk, swCol, transition, writeLog, type Actor } from "./db"
import { issueLines } from "./core"
import { NCAC_CONFIG_MSG, NcacConfigError, ncac } from "./ncac"
import type { AtmsProgress, SwLine, SwRequest } from "./types"

export const STUCK_MS = 5 * 60_000

type WireProgress = { gm_id?: number | null; done?: number[]; approved?: boolean; code?: string | null }
type Reply = { progress?: WireProgress; detail?: unknown }

const MSG = {
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
} as const

const toWire = (a: AtmsProgress) =>
  a.gmId == null && a.done.length === 0 ? undefined : { gm_id: a.gmId, done: a.done, approved: a.approved, code: a.code }

function fromWire(p: WireProgress | undefined, prev: AtmsProgress): AtmsProgress {
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

const headerRemark = (r: SwRequest) => [r.mrCode, r.plate, r.remark].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")

type Outcome = { kind: "ok" | "partial" | "auth" | "config" | "error"; atms: AtmsProgress }

/** แปลงผลตอบกลับของ api-ncac เป็นสถานะ progress ใหม่ — ใช้ร่วมกันทั้ง issue และ return */
function interpret(status: number, data: Reply | null, prev: AtmsProgress): Outcome {
  const base = { ...prev, needCreds: false }
  if (status >= 200 && status < 300) return { kind: "ok", atms: { ...fromWire(data?.progress, base), error: null } }
  if (status === 409) return { kind: "partial", atms: { ...fromWire(data?.progress, base), error: detailText(data?.detail, MSG.partial) } }
  // 401 = ATMS ไม่รับบัญชีของผู้ใช้ (ผูกใหม่) · 403 = api-ncac ไม่รับ key ของ WMS (ปัญหาตั้งค่า ผู้ใช้ผูกบัญชีใหม่ก็ไม่หาย)
  if (status === 401) return { kind: "auth", atms: { ...base, needCreds: true, error: MSG.badAuth } }
  if (status === 403) return { kind: "config", atms: { ...base, needCreds: false, error: MSG.config } }
  return { kind: "error", atms: { ...base, error: detailText(data?.detail, `ATMS ตอบกลับผิดปกติ (${status}) ลองใหม่อีกครั้ง`) } }
}

async function callNcac(...args: Parameters<typeof ncac>): Promise<{ status: number; data: Reply | null } | null> {
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

/** ใบที่ ISSUING ค้างเกิน 5 นาที (โปรเซสตายกลางคัน) ให้ยึดมาทำต่อได้ ไม่งั้นค้างตลอด */
async function claimIssue(no: string, actor: Actor): Promise<SwRequest> {
  const col = await swCol()
  const cur = await col.findOne({ no })
  if (!cur) throw new NotFoundError()
  if (cur.status === "ISSUING" && Date.now() - cur.updatedAt.getTime() > STUCK_MS) {
    const after = await col.findOneAndUpdate(
      { no, status: "ISSUING", updatedAt: cur.updatedAt },
      { $set: { updatedAt: new Date() } },
      { returnDocument: "after" },
    )
    if (!after) throw new ConflictError()
    await writeLog({ no, action: "issue-resume", from: "ISSUING", to: "ISSUING", actor: { email: actor.email, name: actor.name, via: actor.via } })
    return after
  }
  return transition(no, "issue", actor)
}

export async function issueRequest(no: string, actor: Actor): Promise<SwRequest> {
  const claimed = await claimIssue(no, actor)
  try {
    return await runIssue(claimed, actor)
  } catch (e) {
    if (e instanceof ConflictError) throw e
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

async function runIssue(claimed: SwRequest, actor: Actor): Promise<SwRequest> {
  const no = claimed.no
  const col = await swCol()
  const startedAt = claimed.atms.startedAt ?? new Date()
  if (!claimed.atms.startedAt) await col.updateOne({ no, "atms.startedAt": null }, { $set: { "atms.startedAt": startedAt } })
  const prev: AtmsProgress = { ...claimed.atms, startedAt }

  const fail = (atms: AtmsProgress) => transition(no, "issueFailed", actor, { atms })

  const creds = await getCreds(actor.email)
  if (!creds) return fail({ ...prev, needCreds: true, error: MSG.noCreds })

  const sent = issueLines(claimed.lines) // progress.done เป็น index ของลิสต์นี้
  if (sent.length === 0) return fail({ ...prev, needCreds: false, error: MSG.noLines })

  const body = {
    inventory_id: claimed.inventoryId,
    pick_to_id: claimed.pickToId,
    remark_token: claimed.no,
    remark: headerRemark(claimed),
    date: ddmmyyyyBkk(startedAt),
    lines: sent.map(({ line }) => ({
      sku_id: line.skuId,
      amount: line.issuedQty ?? line.requestedQty,
      sku_name: line.skuName,
      ...(line.mrItemId != null ? { mr_item_id: line.mrItemId } : {}),
      ...(line.serialNoId != null ? { serial_no_id: line.serialNoId } : {}),
      ...(line.remark ? { remark: line.remark } : {}),
    })),
    ...(toWire(prev) ? { progress: toWire(prev) } : {}),
  }

  const r = await callNcac("POST", "/atms/withdraw/issue", { creds, body })
  if (!r) return holdIssueUnknown(no, actor)
  const out = interpret(r.status, r.data, prev)
  if (out.kind === "ok" && !(out.atms.code && out.atms.approved)) return fail({ ...out.atms, error: MSG.noCode })
  if (out.kind === "ok") return transition(no, "issued", actor, { atms: { ...out.atms, drift: null } }) // ส่งสำเร็จ = ล้างธงเก่า
  return fail(out.atms)
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
    { $set: { "returns.$[r].status": "RETURNING", "returns.$[r].acceptedBy": actor.email, updatedAt: now } },
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
