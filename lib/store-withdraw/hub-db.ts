// lib/store-withdraw/hub-db.ts — ยอด Hub ของ Sub ใน Mongo (master + stock + สมุดเคลื่อนไหว)
// ไม่มี transaction (memory server single node) → ตัดแบบ conditional $inc + ถอยเองถ้าไม่ครบ
import { randomUUID } from "node:crypto"
import type { Collection, Db } from "mongodb"
import { getDb, swCol, writeLog, type Actor } from "./db"
import { HttpError } from "./http"
import { isPendingFlow } from "./core"
import { hubStatusOf, hubWdDone, type hubCutPlan } from "./hub-core"
import type { SwRequest } from "./types"

export type HubSite = { inventoryId: number; atmsHubInventoryId: number; active: boolean }
export type HubVendor = { code: string; name: string; active: boolean; createdAt: Date }
export type HubItem = {
  inventoryId: number; vendorCode: string; skuId: number; skuCode: string; skuName: string
  unit: string; price: number | null; active: boolean; updatedAt: Date
}
export type HubStock = { inventoryId: number; vendorCode: string; skuId: number; qty: number }
export type HubMove = {
  type: "receive" | "issue" | "return" | "adjust"
  inventoryId: number; vendorCode: string; skuId: number
  qty: number // บวก = เข้า · ลบ = ออก
  refNo: string; lineIndex: number | null; note?: string
  by: { email: string; name: string }; at: Date
}
type By = { email: string; name: string }
type Plan = ReturnType<typeof hubCutPlan>

const indexed = new WeakSet<Db>()

export async function hubCols() {
  const db = await getDb()
  const cols = {
    sites: db.collection<HubSite>("hub_sites"),
    vendors: db.collection<HubVendor>("hub_vendors"),
    items: db.collection<HubItem>("hub_items"),
    stock: db.collection<HubStock>("hub_stock"),
    moves: db.collection<HubMove>("hub_moves"),
    locks: db.collection<{ _id: string; at: Date; owner?: string }>("hub_locks"),
  }
  if (!indexed.has(db)) {
    const key = { inventoryId: 1, vendorCode: 1, skuId: 1 } as const
    await Promise.all([
      cols.items.createIndex(key, { unique: true }),
      cols.stock.createIndex(key, { unique: true }),
      // receive เก็บ lineIndex null → หลายบรรทัดใช้ refNo เดียวกันได้ · issue/return/adjust ซ้ำบรรทัดเดิมไม่ได้
      cols.moves.createIndex({ type: 1, refNo: 1, lineIndex: 1 }, { unique: true, partialFilterExpression: { lineIndex: { $type: "number" } } }),
      cols.moves.createIndex({ vendorCode: 1, at: 1 }),
      cols.moves.createIndex({ refNo: 1 }),
      cols.vendors.createIndex({ code: 1 }, { unique: true }),
      cols.sites.createIndex({ inventoryId: 1 }, { unique: true }),
    ])
    indexed.add(db)
  }
  return cols
}

const isDup = (e: unknown) => (e as { code?: number }).code === 11000

export async function getHubSite(inventoryId: number): Promise<HubSite | null> {
  const { sites } = await hubCols()
  return sites.findOne({ inventoryId, active: true }, { projection: { _id: 0 } })
}

export async function receiveHub(
  input: { inventoryId: number; vendorCode: string; refNo: string; lines: { skuId: number; skuCode: string; skuName: string; unit?: string; price?: number | null; qty: number }[] },
  by: By,
): Promise<HubMove[]> {
  const c = await hubCols()
  const v = await c.vendors.findOne({ code: input.vendorCode, active: true })
  if (!v) throw new HttpError("ไม่พบ Sub รายนี้ หรือถูกปิดใช้งานแล้ว", 400)
  for (const l of input.lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) throw new HttpError("จำนวนรับเข้าต้องมากกว่า 0", 400)
  }
  const out: HubMove[] = []
  for (const l of input.lines) {
    const now = new Date()
    const set: Partial<HubItem> = { skuCode: l.skuCode, skuName: l.skuName, active: true, updatedAt: now }
    if (l.unit) set.unit = l.unit
    if (l.price != null) set.price = l.price
    const onInsert: Partial<HubItem> = {}
    if (!l.unit) onInsert.unit = ""
    if (l.price == null) onInsert.price = null
    await c.items.updateOne(
      { inventoryId: input.inventoryId, vendorCode: input.vendorCode, skuId: l.skuId },
      { $set: set, ...(Object.keys(onInsert).length ? { $setOnInsert: onInsert } : {}) },
      { upsert: true },
    )
    await c.stock.updateOne({ inventoryId: input.inventoryId, vendorCode: input.vendorCode, skuId: l.skuId }, { $inc: { qty: l.qty } }, { upsert: true })
    const m: HubMove = { type: "receive", inventoryId: input.inventoryId, vendorCode: input.vendorCode, skuId: l.skuId, qty: l.qty, refNo: input.refNo, lineIndex: null, by, at: now }
    await c.moves.insertOne({ ...m })
    out.push(m)
  }
  return out
}

export type HubCutResult = { ok: true } | { ok: false; short: { skuCode?: string; skuId: number; have: number; need: number }[]; busy?: true }
const LOCK_STALE_MS = 60_000

/** ตัดยอดต่อใบแบบล็อกทีละใบ — ถ้ามีอีกการตัดของใบเดียวกันกำลังทำอยู่ คืน busy (ผู้เรียกตอบ 409 ให้ลองใหม่) */
export async function cutHubForRequest(no: string, plan: Plan, inventoryId: number, by: By): Promise<HubCutResult> {
  const c = await hubCols()
  const _id = `cut:${no}`
  const owner = randomUUID() // ผู้ถือล็อก — ตัวที่ถูกยึดล็อกไปแล้วจะลบล็อกของเจ้าใหม่ไม่ได้
  const take = async () => { try { await c.locks.insertOne({ _id, at: new Date(), owner }); return true } catch (e) { if (isDup(e)) return false; throw e } }
  if (!(await take())) {
    // ล็อกค้างเกิน 60 วิ = ตัวเดิมตายไปแล้ว → ลบเฉพาะอันที่เก่า (เงื่อนไขกัน 2 ตัวแย่งลบล็อกใหม่) แล้วลองใหม่ครั้งเดียว
    await c.locks.deleteOne({ _id, at: { $lt: new Date(Date.now() - LOCK_STALE_MS) } })
    if (!(await take())) return { ok: false, short: [], busy: true }
  }
  try {
    return await cutLocked(c, no, plan, inventoryId, by)
  } finally {
    await c.locks.deleteOne({ _id, owner })
  }
}

async function cutLocked(c: Awaited<ReturnType<typeof hubCols>>, no: string, plan: Plan, inventoryId: number, by: By): Promise<HubCutResult> {
  const done: Plan = []
  const keyOf = (p: Plan[number]) => ({ inventoryId, vendorCode: p.vendorCode, skuId: p.skuId })
  for (const p of plan) {
    if (await c.moves.findOne({ type: "issue", refNo: no, lineIndex: p.lineIndex }, { projection: { _id: 1 } })) continue // ตัดไปแล้ว
    const r = await c.stock.updateOne({ ...keyOf(p), qty: { $gte: p.qty } }, { $inc: { qty: -p.qty } })
    if (r.modifiedCount === 0) {
      // ถอยของที่ตัดไปในรอบนี้ (ทั้งยอดและแถวสมุด) แล้วรายงานทุกบรรทัดที่ไม่พอ
      for (const d of done) {
        await c.stock.updateOne(keyOf(d), { $inc: { qty: d.qty } })
        await c.moves.deleteOne({ type: "issue", refNo: no, lineIndex: d.lineIndex })
      }
      const short: { skuCode?: string; skuId: number; have: number; need: number }[] = []
      for (const q of plan) {
        if (await c.moves.findOne({ type: "issue", refNo: no, lineIndex: q.lineIndex }, { projection: { _id: 1 } })) continue
        const have = (await c.stock.findOne(keyOf(q)))?.qty ?? 0
        if (have >= q.qty) continue
        const it = await c.items.findOne(keyOf(q))
        short.push({ ...(it ? { skuCode: it.skuCode } : {}), skuId: q.skuId, have, need: q.qty })
      }
      return { ok: false, short }
    }
    try {
      await c.moves.insertOne({ type: "issue", ...keyOf(p), qty: -p.qty, refNo: no, lineIndex: p.lineIndex, by, at: new Date() })
      done.push(p)
    } catch (e) {
      if (!isDup(e)) {
        await c.stock.updateOne(keyOf(p), { $inc: { qty: p.qty } })
        for (const d of done) {
          await c.stock.updateOne(keyOf(d), { $inc: { qty: d.qty } })
          await c.moves.deleteOne({ type: "issue", refNo: no, lineIndex: d.lineIndex })
        }
        throw e
      }
      await c.stock.updateOne(keyOf(p), { $inc: { qty: p.qty } }) // แถวนี้มีอยู่แล้ว (เช็กซ้ำกันพลาด) → คืนยอดที่เพิ่งหัก
    }
  }
  return { ok: true }
}

/** คืนยอดที่ตัดไปของใบนี้ทุกบรรทัดที่ยังไม่ถูกคืน — เรียกซ้ำได้ ไม่คืนซ้ำ */
export async function restoreHubForRequest(no: string, by: By, note: string): Promise<number> {
  const c = await hubCols()
  const issues = await c.moves.find({ type: "issue", refNo: no }).toArray()
  let n = 0
  for (const m of issues) {
    const back = -m.qty
    try {
      await c.moves.insertOne({ type: "adjust", inventoryId: m.inventoryId, vendorCode: m.vendorCode, skuId: m.skuId, qty: back, refNo: `${no}:restore`, lineIndex: m.lineIndex, note, by, at: new Date() })
    } catch (e) {
      if (isDup(e)) continue
      throw e
    }
    await c.stock.updateOne({ inventoryId: m.inventoryId, vendorCode: m.vendorCode, skuId: m.skuId }, { $inc: { qty: back } }, { upsert: true })
    n++
  }
  return n
}

export const HUB_RESTORE_NOTE = "ใบไม่สำเร็จ คืนยอด Hub"

/**
 * เรียกจาก transition หลังปิดใบแบบไม่สำเร็จ (reject / closeManual / cancel) ของใบที่มีบรรทัด Hub
 * ตัดยอดไปแล้ว + WD Hub ยังไม่สำเร็จ = คืนยอดทั้งหมด (เรียกซ้ำไม่คืนซ้ำ) · WD Hub สำเร็จแล้ว = ไม่คืน
 * ห้าม throw — ใบเปลี่ยนสถานะไปแล้ว คืนยอดพลาดให้ log ไว้ (hubRestoredAt ยังว่าง = ตามเก็บได้)
 */
export async function onHubClose(after: SwRequest, actor: Actor): Promise<SwRequest> {
  let doc = after
  try {
    const col = await swCol()
    if (after.hubIssuedAt && !after.hubRestoredAt && !isPendingFlow(after) && !hubWdDone(after)) {
      const n = await restoreHubForRequest(after.no, { email: actor.email, name: actor.name }, HUB_RESTORE_NOTE)
      doc = (await col.findOneAndUpdate({ no: after.no }, { $set: { hubRestoredAt: new Date() } }, { returnDocument: "after" })) ?? doc
      await writeLog({ no: after.no, action: "hubRestore", from: after.status, to: after.status, actor: { email: actor.email, name: actor.name, via: actor.via }, note: `${HUB_RESTORE_NOTE} ${n} บรรทัด` })
    }
    const hubStatus = hubStatusOf(doc)
    if (doc.hubStatus !== hubStatus) {
      await col.updateOne({ no: after.no }, { $set: { hubStatus } })
      doc = { ...doc, hubStatus }
    }
  } catch (e) {
    console.error("[store-withdraw] คืนยอด Hub ไม่สำเร็จ", after.no, e instanceof Error ? e.message : e)
  }
  return doc
}

export async function returnHubLeftover(
  no: string, items: { lineIndex: number; vendorCode: string; skuId: number; qty: number }[], inventoryId: number, by: By,
): Promise<void> {
  const c = await hubCols()
  for (const it of items) {
    if (!(it.qty > 0)) continue
    try {
      await c.moves.insertOne({ type: "return", inventoryId, vendorCode: it.vendorCode, skuId: it.skuId, qty: it.qty, refNo: no, lineIndex: it.lineIndex, by, at: new Date() })
    } catch (e) {
      if (isDup(e)) continue // คืนบรรทัดนี้ไปแล้ว
      throw e
    }
    await c.stock.updateOne({ inventoryId, vendorCode: it.vendorCode, skuId: it.skuId }, { $inc: { qty: it.qty } }, { upsert: true })
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const withQty = async (items: HubItem[], stock: Collection<HubStock>) => {
  const out: (HubItem & { qty: number })[] = []
  for (const it of items) {
    const s = await stock.findOne({ inventoryId: it.inventoryId, vendorCode: it.vendorCode, skuId: it.skuId })
    out.push({ ...it, qty: s?.qty ?? 0 })
  }
  return out
}

export async function searchHubItems(inventoryId: number, q: string, limit: number): Promise<(HubItem & { qty: number; vendorName: string })[]> {
  const c = await hubCols()
  const re = new RegExp(esc(q.trim()), "i")
  const items = await c.items.find({ inventoryId, active: true, $or: [{ skuCode: re }, { skuName: re }] }, { projection: { _id: 0 } }).sort({ skuCode: 1 }).limit(limit).toArray()
  const rows = await withQty(items, c.stock)
  const vs = await c.vendors.find({ code: { $in: [...new Set(items.map((i) => i.vendorCode))] } }).toArray()
  const name = new Map(vs.map((v) => [v.code, v.name]))
  return rows.map((r) => ({ ...r, vendorName: name.get(r.vendorCode) ?? r.vendorCode }))
}

export async function listHubStock(filter: { inventoryId?: number; vendorCode?: string }): Promise<(HubItem & { qty: number })[]> {
  if ("vendorCode" in filter && !filter.vendorCode) return [] // ส่งมาแต่ว่าง = ไม่ตรงอะไรเลย ไม่ใช่ไม่กรอง
  const c = await hubCols()
  const f: Record<string, unknown> = {}
  if (filter.inventoryId != null) f.inventoryId = filter.inventoryId
  if (filter.vendorCode) f.vendorCode = filter.vendorCode
  const items = await c.items.find(f, { projection: { _id: 0 } }).sort({ skuCode: 1 }).toArray()
  return withQty(items, c.stock)
}

export async function listHubMoves(filter: { vendorCode?: string; skuId?: number; from?: Date; to?: Date }, limit: number): Promise<HubMove[]> {
  const c = await hubCols()
  if ("vendorCode" in filter && !filter.vendorCode) return [] // ส่งมาแต่ว่าง = ไม่ตรงอะไรเลย ไม่ใช่ไม่กรอง
  const f: Record<string, unknown> = {}
  if (filter.vendorCode) f.vendorCode = filter.vendorCode
  if (filter.skuId != null) f.skuId = filter.skuId
  if (filter.from || filter.to) f.at = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) }
  return c.moves.find(f, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray()
}
