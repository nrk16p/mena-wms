// lib/store-withdraw/hub-api.ts — ตรรกะของ route หน้า Hub สโตร์ (แยกจาก route เพื่อเรียกทดสอบตรง ๆ ได้ ไม่ต้องมี session)
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import type { NextRequest } from "next/server"
import { authOptions } from "@/lib/auth"
import { atLeast, type Access, type Level } from "@/lib/access-policy"
import { err, getActor, isResponse, HttpError } from "./http"
import { ConflictError, type Actor } from "./db"
import { getHubSite, hubCols, listHubMoves, listHubStock, receiveHub, searchHubItems, type HubMove } from "./hub-db"

type Params = URLSearchParams
const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** ผู้ทำรายการหน้า Hub: ต้องเป็น session + สิทธิ์ store-hub ระดับที่ต้องการ (เช็กซ้ำจาก middleware) */
export async function getHubActor(req: NextRequest, need: Level): Promise<Actor | NextResponse> {
  const actor = await getActor(req, false)
  if (isResponse(actor)) return actor
  const session = await getServerSession(authOptions)
  const access = (session?.user as { access?: Access } | undefined)?.access
  if (!access || !atLeast(access["store-hub"], need)) return err("หน้านี้เฉพาะผู้ได้รับสิทธิ์อะไหล่ Hub ขอสิทธิ์จากผู้ดูแลระบบ", 403)
  return actor
}

/** ผู้ขอ (ฟอร์มขอเบิก) ค้นอะไหล่ Hub — แค่ล็อกอินและมีสิทธิ์ยื่นคำขอ/คิวสโตร์ (middleware คุมไว้แล้ว) */
export async function getHubSearchActor(req: NextRequest): Promise<Actor | NextResponse> {
  const actor = await getActor(req, false)
  if (isResponse(actor)) return actor
  const session = await getServerSession(authOptions)
  const access = (session?.user as { access?: Access } | undefined)?.access
  if (!access || !(atLeast(access["store-withdraw"], "view") || atLeast(access["store-queue"], "view"))) return err("ไม่มีสิทธิ์ค้นอะไหล่ Hub", 403)
  return actor
}

export async function hubItemsHandler(p: Params): Promise<NextResponse> {
  const inventoryId = posInt(p.get("inventoryId"))
  if (!inventoryId) return err("ต้องระบุคลัง", 400)
  if (!(await getHubSite(inventoryId))) return NextResponse.json({ results: [], enabled: false })
  const limit = Math.min(posInt(p.get("limit")) ?? 20, 50)
  const q = (p.get("q") ?? "").trim()
  if (!q) return NextResponse.json({ results: [], enabled: true })
  const rows = await searchHubItems(inventoryId, q, limit)
  const results = rows.map((r) => ({ skuId: r.skuId, skuCode: r.skuCode, skuName: r.skuName, unit: r.unit, vendorCode: r.vendorCode, vendorName: r.vendorName, qty: r.qty }))
  return NextResponse.json({ results, enabled: true })
}

export async function hubStockHandler(p: Params): Promise<NextResponse> {
  const filter: { inventoryId?: number; vendorCode?: string } = {}
  if (p.has("inventoryId")) {
    const id = posInt(p.get("inventoryId"))
    if (!id) return err("คลังไม่ถูกต้อง", 400)
    filter.inventoryId = id
  }
  const vc = str(p.get("vendorCode"))
  if (vc) filter.vendorCode = vc
  return NextResponse.json({ rows: await listHubStock(filter) })
}

export async function hubReceiveHandler(body: Record<string, unknown>, actor: Actor): Promise<NextResponse> {
  const inventoryId = posInt(body.inventoryId)
  if (!inventoryId) return err("ต้องระบุคลัง", 400)
  const vendorCode = str(body.vendorCode)
  if (!vendorCode) return err("ต้องเลือก Sub", 400)
  const refNo = str(body.refNo)
  if (refNo.length < 1 || refNo.length > 40) return err("ต้องใส่เลขเอกสารส่งของ 1–40 ตัวอักษร", 400)
  const raw = Array.isArray(body.lines) ? body.lines : []
  if (raw.length < 1) return err("ยังไม่มีรายการรับเข้า", 400)
  if (raw.length > 100) return err("รับเข้าได้ครั้งละไม่เกิน 100 รายการ", 400)
  const seen = new Set<number>()
  const lines: Parameters<typeof receiveHub>[0]["lines"] = []
  for (const x of raw) {
    const l = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
    const skuId = posInt(l.skuId)
    const skuCode = str(l.skuCode), skuName = str(l.skuName)
    if (!skuId || !skuCode || !skuName) return err("รายการไม่ครบ ต้องมีรหัสและชื่ออะไหล่", 400)
    if (seen.has(skuId)) return err(`อะไหล่ ${skuCode} ซ้ำในรายการ รวมเป็นบรรทัดเดียว`, 400)
    seen.add(skuId)
    const qty = typeof l.qty === "number" ? l.qty : NaN
    if (!Number.isFinite(qty) || qty <= 0) return err(`จำนวนของ ${skuCode} ต้องมากกว่า 0`, 400)
    const price = l.price == null || l.price === "" ? null : typeof l.price === "number" && Number.isFinite(l.price) && l.price >= 0 ? l.price : NaN
    if (Number.isNaN(price)) return err(`ราคาของ ${skuCode} ไม่ถูกต้อง`, 400)
    lines.push({ skuId, skuCode, skuName, qty, price, ...(str(l.unit) ? { unit: str(l.unit) } : {}) })
  }
  if (!(await getHubSite(inventoryId))) return err("คลังนี้ยังไม่เปิดอะไหล่ Hub", 400)
  const c = await hubCols()
  // กันรับซ้ำ (กดสองที) ด้วย marker เลขเอกสาร+Sub แบบ unique · สำเร็จแล้วเก็บไว้ · พังกลางทางลบทิ้งให้ลองใหม่ (receiveHub ข้ามบรรทัดที่รับไปแล้ว)
  const _id = `recv:${vendorCode}:${refNo}`
  try {
    await c.locks.insertOne({ _id, at: new Date() })
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ConflictError("เลขเอกสารส่งของนี้รับเข้าแล้ว")
    throw e
  }
  let moves: HubMove[]
  try {
    moves = await receiveHub({ inventoryId, vendorCode, refNo, lines }, { email: actor.email, name: actor.name })
  } catch (e) {
    await c.locks.deleteOne({ _id })
    throw e
  }
  return NextResponse.json({ moves })
}

const TYPES = ["items", "vendors", "sites"] as const
type MasterType = (typeof TYPES)[number]
export const masterType = (p: Params): MasterType | null => {
  const t = p.get("type")
  return (TYPES as readonly string[]).includes(t ?? "") ? (t as MasterType) : null
}

export async function hubMasterGet(p: Params): Promise<NextResponse> {
  const t = masterType(p)
  if (!t) return err("ต้องระบุ type = items / vendors / sites", 400)
  const c = await hubCols()
  if (t === "items") return NextResponse.json({ rows: await listHubStock({ ...(posInt(p.get("inventoryId")) ? { inventoryId: posInt(p.get("inventoryId"))! } : {}), ...(str(p.get("vendorCode")) ? { vendorCode: str(p.get("vendorCode")) } : {}) }) })
  if (t === "vendors") return NextResponse.json({ rows: await c.vendors.find({}, { projection: { _id: 0 } }).sort({ code: 1 }).toArray() })
  return NextResponse.json({ rows: await c.sites.find({}, { projection: { _id: 0 } }).sort({ inventoryId: 1 }).toArray() })
}

export async function hubMasterWrite(method: "POST" | "PATCH" | "PUT", p: Params, body: Record<string, unknown>, actor: Actor): Promise<NextResponse> {
  const t = masterType(p)
  if (!t) return err("ต้องระบุ type = items / vendors / sites", 400)
  const c = await hubCols()
  const by = { email: actor.email, name: actor.name }
  const noId = { projection: { _id: 0 } } as const
  // ลงประวัติหลังแก้สำเร็จ (ค่าก่อน/หลังทั้งแถว) — พังตอนลง log ไม่ทำให้การแก้ล้ม (แก้ไปแล้ว)
  const audit = async (key: string, before: object | null, after: object | null) => {
    try {
      await c.masterLog.insertOne({ type: t, key, before: before as Record<string, unknown> | null, after: after as Record<string, unknown> | null, by, at: new Date() })
    } catch (e) {
      console.error("[hub] ลงประวัติแก้ master ไม่สำเร็จ", t, key, e instanceof Error ? e.message : e)
    }
  }
  if (t === "sites" && method === "PUT") {
    const inventoryId = posInt(body.inventoryId), atms = posInt(body.atmsHubInventoryId)
    if (!inventoryId || !atms) return err("เลขคลังและเลขคลัง Hub ใน ATMS ต้องเป็นจำนวนเต็มมากกว่า 0", 400)
    const active = body.active !== false
    const before = await c.sites.findOne({ inventoryId }, noId)
    await c.sites.updateOne({ inventoryId }, { $set: { atmsHubInventoryId: atms, active } }, { upsert: true })
    await audit(String(inventoryId), before, await c.sites.findOne({ inventoryId }, noId))
    return NextResponse.json({ site: { inventoryId, atmsHubInventoryId: atms, active } })
  }
  if (t === "vendors" && method === "POST") {
    const code = str(body.code), name = str(body.name)
    if (!code || !name) return err("ต้องใส่รหัสและชื่อ Sub", 400)
    const before = await c.vendors.findOne({ code }, noId)
    await c.vendors.updateOne({ code }, { $set: { name, active: true }, $setOnInsert: { createdAt: new Date() } }, { upsert: true })
    await audit(code, before, await c.vendors.findOne({ code }, noId))
    return NextResponse.json({ vendor: { code, name, active: true } })
  }
  if (t === "vendors" && method === "PATCH") {
    const code = str(body.code)
    if (!code || typeof body.active !== "boolean") return err("ต้องระบุรหัส Sub และเปิด/ปิด", 400)
    const before = await c.vendors.findOneAndUpdate({ code }, { $set: { active: body.active } }, { ...noId, returnDocument: "before" })
    if (!before) return err("ไม่พบ Sub รายนี้", 404)
    await audit(code, before, await c.vendors.findOne({ code }, noId))
    return NextResponse.json({ ok: true })
  }
  if (t === "items" && method === "PATCH") {
    const inventoryId = posInt(body.inventoryId), skuId = posInt(body.skuId), vendorCode = str(body.vendorCode)
    if (!inventoryId || !skuId || !vendorCode) return err("ต้องระบุคลัง Sub และอะไหล่", 400)
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if ("price" in body) {
      if (body.price !== null && !(typeof body.price === "number" && Number.isFinite(body.price) && body.price >= 0)) return err("ราคาไม่ถูกต้อง", 400)
      set.price = body.price
    }
    if ("unit" in body) set.unit = str(body.unit)
    if ("active" in body) {
      if (typeof body.active !== "boolean") return err("เปิด/ปิดไม่ถูกต้อง", 400)
      set.active = body.active
    }
    const before = await c.items.findOneAndUpdate({ inventoryId, vendorCode, skuId }, { $set: set }, { ...noId, returnDocument: "before" })
    if (!before) return err("ไม่พบรายการนี้", 404)
    await audit(`${inventoryId}|${vendorCode}|${skuId}`, before, await c.items.findOne({ inventoryId, vendorCode, skuId }, noId))
    return NextResponse.json({ ok: true })
  }
  throw new HttpError("วิธีเรียกไม่ตรงกับ type นี้", 405)
}

export const MOVE_LABEL: Record<HubMove["type"], string> = { receive: "รับเข้า", issue: "จ่ายออก", return: "คืนเข้า", adjust: "ปรับยอด" }

/** ประวัติเคลื่อนไหว ≤ 2000 แถว · เติมชื่อ Sub/รหัสอะไหล่ให้อ่านง่าย */
export async function hubMovesRows(p: Params) {
  const filter: { vendorCode?: string; skuId?: number; from?: Date; to?: Date } = {}
  if (p.has("vendorCode")) filter.vendorCode = str(p.get("vendorCode"))
  if (p.has("skuId")) {
    const s = posInt(p.get("skuId"))
    if (!s) throw new HttpError("รหัสอะไหล่ไม่ถูกต้อง", 400)
    filter.skuId = s
  }
  for (const k of ["from", "to"] as const) {
    const v = p.get(k)
    if (!v) continue
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) throw new HttpError("วันที่ไม่ถูกต้อง", 400)
    filter[k] = d
  }
  const rows = await listHubMoves(filter, 2000)
  const c = await hubCols()
  const codes = [...new Set(rows.map((r) => r.vendorCode))]
  const skus = [...new Set(rows.map((r) => r.skuId))]
  const items = rows.length ? await c.items.find({ vendorCode: { $in: codes }, skuId: { $in: skus } }).toArray() : []
  const code = new Map(items.map((i) => [`${i.vendorCode}|${i.skuId}`, i.skuCode]))
  const vs = await c.vendors.find({ code: { $in: codes } }).toArray()
  const vname = new Map(vs.map((v) => [v.code, v.name]))
  return rows.map((r) => ({ ...r, skuCode: code.get(`${r.vendorCode}|${r.skuId}`) ?? String(r.skuId), vendorName: vname.get(r.vendorCode) ?? r.vendorCode }))
}

export async function hubMovesXlsx(rows: Awaited<ReturnType<typeof hubMovesRows>>): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("เคลื่อนไหว Hub")
  ws.columns = [
    { header: "วันที่", key: "at", width: 20 }, { header: "ประเภท", key: "ty", width: 10 }, { header: "Sub", key: "sub", width: 28 },
    { header: "รหัส", key: "code", width: 16 }, { header: "จำนวน", key: "qty", width: 10 }, { header: "เลขอ้างอิง", key: "ref", width: 20 },
    { header: "โดย", key: "by", width: 26 },
  ]
  for (const r of rows) ws.addRow({ at: r.at.toISOString(), ty: MOVE_LABEL[r.type], sub: r.vendorName, code: r.skuCode, qty: r.qty, ref: r.refNo, by: r.by.name || r.by.email })
  ws.getRow(1).font = { bold: true }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
