// lib/core-return/service.ts — งานของหน้าติดตามซาก: รายการ/สรุป/กลุ่ม · คืนซาก · ขายแล้ว · Rebuild เสร็จ · ตามงาน · สร้างแถวจากใบเบิก WMS
// ทุกการเปลี่ยนสถานะ = findOneAndUpdate({row_key, coreStatus: ที่คาดไว้}) ตัวเดียวชนะ · ตามด้วย log ต่อโซ่แฮช
import type { Filter } from "mongodb"
import {
  CHOICE_TO, CORE_STATUSES, CoreHttpError, LIST_SORT, OPEN, OUTSTANDING, PAGE_SIZE, STATUS_LABEL,
  UNCERTAIN_GARAGE_SOURCES, buildQuery, daysSince, parseFollowUp, parseRebuilt, parseReturn, parseSold,
  type Actor, type CoreRow, type CoreStatus, type GroupBy, type ListFilters,
} from "./core"
import { linkCoreAttachments, resolveCoreLinkable } from "./attachments"
import { baseCol, logCol, verifyCoreLog, writeCoreLog, type CoreLogDoc } from "./db"

const MAX_MS = 10_000
const who = (a: Actor) => ({ email: a.email, name: a.name })

export type Summary = Record<CoreStatus | "followQueue", { count: number; amount: number }>

export async function summary(f: ListFilters, now = new Date()): Promise<Summary> {
  const col = await baseCol()
  const [fq] = await col.aggregate<{ count: number; amount: number }>([
    { $match: buildQuery({ ...f, status: undefined, queue: "followup" }, { now }) },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$amount", 0] } } } },
  ], { maxTimeMS: MAX_MS }).toArray()
  const rows = await col.aggregate<{ _id: CoreStatus; count: number; amount: number }>([
    { $match: buildQuery({ ...f, queue: null }, { omitStatus: true, now }) },
    { $group: { _id: "$coreStatus", count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$amount", 0] } } } },
  ], { maxTimeMS: MAX_MS }).toArray()
  const out = Object.fromEntries(CORE_STATUSES.map((s) => [s, { count: 0, amount: 0 }])) as Summary
  out.followQueue = { count: fq?.count ?? 0, amount: Math.round((fq?.amount ?? 0) * 100) / 100 }
  for (const r of rows) if (out[r._id]) out[r._id] = { count: r.count, amount: Math.round(r.amount * 100) / 100 }
  return out
}

export async function list(f: ListFilters, page: number, now = new Date()) {
  const col = await baseCol()
  const q = buildQuery(f, { now }) as Filter<CoreRow>
  const p = Math.max(1, Math.min(Math.floor(page) || 1, 10_000))
  const [items, total] = await Promise.all([
    col.find(q, { projection: { _id: 0 }, maxTimeMS: MAX_MS }).sort(LIST_SORT).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    col.countDocuments(q, { maxTimeMS: MAX_MS }),
  ])
  return { items, total, page: p, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}

export async function warehouses(): Promise<string[]> {
  const col = await baseCol()
  return ((await col.distinct("warehouse", {}, { maxTimeMS: MAX_MS })) as (string | null)[]).filter((w): w is string => !!w).sort()
}

export type Group = {
  key: { plate?: string; vehicleNo?: string; mrCode?: string; warehouse?: string; garageType?: string; garage?: string }
  count: number; pieces: number; amount: number; vehicles: number; mrs: number; oldest: string; days: number | null; plates?: string[]; uncertain?: boolean
}

/** ยังไม่คืนซาก จัดกลุ่มตามรถ / MR / คลัง / อู่ · เรียงค้างนานสุดก่อน (อู่: ยอดเงินมากสุดก่อน) · สถานะบังคับ pending+legacy */
export async function groups(f: ListFilters, by: GroupBy, page: number, now = new Date(), size = 30) {
  const col = await baseCol()
  const match = buildQuery({ ...f, status: OUTSTANDING }, { now })
  const id = by === "vehicle" ? { plate: { $ifNull: ["$plate", ""] }, vehicleNo: { $ifNull: ["$vehicleNo", ""] } }
    : by === "mr" ? { mrCode: { $ifNull: ["$mrCode", ""] } }
    : by === "garage" ? { garageType: { $ifNull: ["$garageType", ""] }, garage: { $ifNull: ["$garage", ""] } }
    : { warehouse: { $ifNull: ["$warehouse", ""] } }
  const p = Math.max(1, Math.min(Math.floor(page) || 1, 1000))
  const lim = Math.max(1, Math.min(size, 1000))
  const [res] = await col.aggregate<{ rows: { _id: Group["key"]; count: number; pieces: number; amount: number; oldest: string; plates: string[]; mrs: string[]; sources: string[] }[]; total: { n: number }[] }>([
    { $match: match },
    { $group: {
      _id: id, count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$amount", 0] } }, oldest: { $min: "$issuedDate" },
      pieces: { $sum: { $max: [0, { $subtract: [{ $ifNull: ["$qtyIssued", 0] }, { $ifNull: ["$coreQtyReturned", 0] }] }] } },
      plates: { $addToSet: "$plate" }, mrs: { $addToSet: "$mrCode" }, sources: { $addToSet: "$garageSource" },
    } },
    { $sort: by === "garage" ? { amount: -1, count: -1 } : { oldest: 1, count: -1 } },
    { $facet: { rows: [{ $skip: (p - 1) * lim }, { $limit: lim }], total: [{ $count: "n" }] } },
  ], { maxTimeMS: MAX_MS, allowDiskUse: true }).toArray()
  const total = res?.total[0]?.n ?? 0
  const items: Group[] = (res?.rows ?? []).map((r) => ({
    key: r._id, count: r.count, pieces: Math.round(r.pieces * 100) / 100, amount: Math.round(r.amount * 100) / 100,
    vehicles: r.plates.filter(Boolean).length, mrs: r.mrs.filter(Boolean).length, oldest: r.oldest, days: daysSince(r.oldest, now),
    ...(by === "mr" ? { plates: r.plates.filter(Boolean).slice(0, 3) } : {}),
    ...(by === "garage" ? { uncertain: r.sources.length > 0 && r.sources.every((s) => !!s && UNCERTAIN_GARAGE_SOURCES.includes(s)) } : {}),
  }))
  return { items, total, page: p, pages: Math.max(1, Math.ceil(total / lim)) }
}

/** รายชื่ออู่ (สำหรับตัวเลือก) */
export async function garages(): Promise<{ garageType: string; garage: string }[]> {
  const col = await baseCol()
  const rows = await col.aggregate<{ _id: { t: string | null; g: string | null } }>([
    { $group: { _id: { t: "$garageType", g: "$garage" } } }, { $limit: 5000 },
  ], { maxTimeMS: MAX_MS }).toArray()
  return rows.filter((r) => r._id.g).map((r) => ({ garageType: r._id.t ?? "", garage: r._id.g! })).sort((a, b) => a.garage.localeCompare(b.garage, "th"))
}

export async function getRow(key: string) {
  const row = await (await baseCol()).findOne({ row_key: key }, { projection: { _id: 0 } })
  if (!row) throw new CoreHttpError("ไม่พบรายการนี้ ลองรีเฟรช", 404)
  const history = await (await logCol()).find({ row_key: key }, { projection: { _id: 0 } }).sort({ seq: 1 }).limit(500).toArray()
  return { row, history, chain: verifyCoreLog(history) }
}

async function loadOrThrow(key: string): Promise<CoreRow> {
  const row = await (await baseCol()).findOne({ row_key: key })
  if (!row) throw new CoreHttpError("ไม่พบรายการนี้ ลองรีเฟรช", 404)
  return row
}
const conflict = () => new CoreHttpError("รายการนี้มีคนบันทึกไปก่อนแล้ว ลองรีเฟรช", 409)

/** เปลี่ยนสถานะแบบ atomic: ต้องยังเป็นสถานะเดิมตอนเขียน ไม่งั้น 409 */
async function move(row: CoreRow, to: CoreStatus, set: Record<string, unknown>, log: Omit<CoreLogDoc, "row_key" | "from" | "to" | "at" | "seq" | "hash">) {
  const col = await baseCol()
  const now = new Date()
  const after = await col.findOneAndUpdate(
    { row_key: row.row_key, coreStatus: row.coreStatus, ...(to === "sold" ? { saleRoundNo: { $in: [null] } } : {}) },
    { $set: { ...set, coreStatus: to, coreUpdatedAt: now } },
    { returnDocument: "after", projection: { _id: 0 } },
  )
  if (!after) throw conflict()
  await writeCoreLog({ row_key: row.row_key, from: row.coreStatus, to, ...log }, now)
  return after
}

/** คืนซาก: pending|legacy → sell_waiting | rebuild | no_core */
export async function returnCore(key: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const row = await loadOrThrow(key)
  if (!OUTSTANDING.includes(row.coreStatus)) throw new CoreHttpError(`รายการนี้ "${STATUS_LABEL[row.coreStatus] ?? row.coreStatus}" แล้ว คืนซากซ้ำไม่ได้`, 409)
  const v = parseReturn(body, row, now)
  const attachmentIds = await resolveCoreLinkable(key, body.attachmentIds, actor)
  const to = CHOICE_TO[v.choice]
  const ret = { choice: v.choice, qty: v.qty, shortReason: v.shortReason, note: v.note, at: now, by: who(actor), ...(attachmentIds.length ? { attachmentIds } : {}) }
  const set: Record<string, unknown> = { ret, coreQtyReturned: v.qty }
  if (v.choice === "sell") set.sale = { scrapInDate: v.scrapInDate, soldDate: null, price: null, buyer: null, note: "", soldAt: null, soldBy: null }
  if (v.choice === "rebuild") set.rebuild = { sentDate: v.rebuildSentDate, vendor: v.rebuildVendor, doneDate: null, note: "", doneAt: null, doneBy: null }
  if (v.choice === "no_core") set.noCore = { reason: v.noCoreReason, note: v.note }
  const after = await move(row, to, set, {
    action: "return", actor: { ...who(actor), via: actor.via }, note: v.note || undefined,
    data: { choice: v.choice, qty: v.qty, shortReason: v.shortReason, scrapInDate: v.scrapInDate, rebuildSentDate: v.rebuildSentDate, rebuildVendor: v.rebuildVendor, noCoreReason: v.noCoreReason, ...(attachmentIds.length ? { attachmentIds } : {}) },
  })
  await linkCoreAttachments(key, attachmentIds)
  return after
}

/** ขายซากแล้ว: sell_waiting → sold */
export async function markSold(key: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const row = await loadOrThrow(key)
  if (row.coreStatus !== "sell_waiting") throw new CoreHttpError("บันทึกขายได้เฉพาะรายการที่อยู่คลังซากรอขาย", 409)
  if (row.saleRoundNo) throw new CoreHttpError(`รายการนี้อยู่ในรอบขาย ${row.saleRoundNo} แล้ว บันทึกขายที่หน้ารอบขาย`, 409)
  const v = parseSold(body, row, now)
  const sale = { ...(row.sale ?? { scrapInDate: null }), soldDate: v.soldDate, price: v.price, buyer: v.buyer, note: v.note, soldAt: now, soldBy: who(actor) }
  return move(row, "sold", { sale }, { action: "sold", actor: { ...who(actor), via: actor.via }, note: v.note || undefined, data: { soldDate: v.soldDate, price: v.price, buyer: v.buyer } })
}

/** Rebuild เสร็จ: rebuild → rebuilt */
export async function markRebuilt(key: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const row = await loadOrThrow(key)
  if (row.coreStatus !== "rebuild") throw new CoreHttpError("บันทึก Rebuild เสร็จได้เฉพาะรายการที่ส่งซ่อมอยู่", 409)
  const v = parseRebuilt(body, row, now)
  const rebuild = { ...(row.rebuild ?? { sentDate: null, vendor: null }), doneDate: v.doneDate, note: v.note, doneAt: now, doneBy: who(actor) }
  return move(row, "rebuilt", { rebuild }, { action: "rebuilt", actor: { ...who(actor), via: actor.via }, note: v.note || undefined, data: { rebuiltDate: v.doneDate } })
}

/** ตามงาน (จัดซื้อ/สโตร์): ไม่เปลี่ยนสถานะ · นับครั้ง + โน้ตล่าสุด + วันตามครั้งถัดไป · เฉพาะรายการที่ยังไม่จบ */
export async function followUp(key: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const v = parseFollowUp(body, now)
  const col = await baseCol()
  const after = await col.findOneAndUpdate(
    { row_key: key, coreStatus: { $in: OPEN } },
    [{ $set: {
      followUp: {
        count: { $add: [{ $ifNull: ["$followUp.count", 0] }, 1] },
        lastAt: now, lastNote: v.note, lastBy: who(actor), nextDate: v.nextDate,
      },
      coreUpdatedAt: now,
    } }],
    { returnDocument: "after", projection: { _id: 0 } },
  )
  if (!after) {
    const exists = await col.findOne({ row_key: key }, { projection: { coreStatus: 1 } })
    if (!exists) throw new CoreHttpError("ไม่พบรายการนี้ ลองรีเฟรช", 404)
    throw new CoreHttpError("รายการนี้จบแล้ว ไม่ต้องตามต่อ", 409)
  }
  await writeCoreLog({ row_key: key, action: "follow_up", from: after.coreStatus, to: after.coreStatus, actor: { ...who(actor), via: actor.via }, note: v.note, data: { count: after.followUp?.count ?? 1, nextDate: v.nextDate } }, now)
  return after
}

/** ทุกแถวตามตัวกรอง (สำหรับ Excel) — จำกัดจำนวนกันหน่วยความจำบาน */
export async function exportRows(f: ListFilters, cap = 30_000) {
  const col = await baseCol()
  const rows = await col.find(buildQuery(f) as Filter<CoreRow>, { projection: { _id: 0 }, maxTimeMS: 30_000 }).sort(LIST_SORT).limit(cap + 1).toArray()
  return { rows: rows.slice(0, cap), truncated: rows.length > cap }
}

/** แถวซากของใบเบิก WMS หลายใบ (ชิปสถานะในหน้าใบของฉัน / คิวสโตร์) · คืนเฉพาะฟิลด์ที่ต้องโชว์ */
export async function rowsForRequests(nos: string[]) {
  if (!nos.length) return []
  return (await baseCol()).find({ swNo: { $in: nos.slice(0, 300) } }, {
    projection: { _id: 0, row_key: 1, garageType: 1, garage: 1, swNo: 1, swLineIndex: 1, swUsageIndex: 1, coreStatus: 1, qtyIssued: 1, coreQtyReturned: 1, issuedDate: 1, skuCode: 1, skuName: 1, plate: 1, vehicleNo: 1, wdCode: 1, mrCode: 1, warehouse: 1, amount: 1, requester: 1, "sale.scrapInDate": 1 },
    maxTimeMS: MAX_MS,
  }).limit(3000).toArray()
}
