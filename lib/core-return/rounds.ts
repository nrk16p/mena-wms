// lib/core-return/rounds.ts — รอบขายซาก (SR-YYMM-NN): รวมซากที่อยู่คลังซากรอขาย → ขายทีเดียวทั้งรอบ
// แถวหนึ่งอยู่ได้รอบเดียว: ผูกด้วย updateOne({row_key, coreStatus: sell_waiting, saleRoundNo: null}) ตัวที่มาก่อนได้
// ยกเลิกรอบ = ปล่อยแถวกลับไปรอขาย · ขายทั้งรอบ = ทุกแถวในรอบเป็น "ขายซากแล้ว" · ทุกแถวที่ขยับมีประวัติใน core_return_log
import type { Filter } from "mongodb"
import { CoreHttpError, isYmd, todayBkk, type Actor, type CoreRow } from "./core"
import { baseCol, nextRoundNo, roundCol, writeCoreLog, type SaleRound } from "./db"

const who = (a: Actor) => ({ email: a.email, name: a.name })
const bad = (m: string) => new CoreHttpError(m, 400)
const strArr = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean)
const round2 = (n: number) => Math.round(n * 100) / 100

/** ซากที่เข้ารอบได้: รอขาย · ยังไม่อยู่รอบไหน · เข้าคลังซากไม่เกินวันตัดรอบ · คลังที่เลือก */
export function candidateQuery(warehouses: string[], cutoffDate: string): Filter<CoreRow> {
  return {
    coreStatus: "sell_waiting",
    saleRoundNo: { $in: [null] },
    "sale.scrapInDate": { $lte: cutoffDate },
    ...(warehouses.length ? { warehouse: { $in: warehouses } } : {}),
  } as Filter<CoreRow>
}

function parseScope(body: Record<string, unknown>) {
  const warehouses = strArr(body.warehouses ?? body.warehouse)
  const cutoffDate = body.cutoffDate ?? body.cutoff
  if (!warehouses.length) throw bad("เลือกคลังก่อน")
  if (!isYmd(cutoffDate)) throw bad("ใส่วันตัดรอบก่อน")
  return { warehouses, cutoffDate }
}

export async function previewRound(body: Record<string, unknown>, cap = 3000) {
  const { warehouses, cutoffDate } = parseScope(body)
  const rows = await (await baseCol()).find(candidateQuery(warehouses, cutoffDate), { projection: { _id: 0 }, maxTimeMS: 10_000 })
    .sort({ "sale.scrapInDate": 1, row_key: 1 }).limit(cap + 1).toArray()
  return { warehouses, cutoffDate, items: rows.slice(0, cap), truncated: rows.length > cap }
}

/** สร้างรอบ: keys = แถวที่ติ๊กไว้ (ไม่ส่ง = ทุกแถวที่เข้าเงื่อนไข) · แถวที่ถูกรอบอื่นคว้าไปก่อนจะถูกข้าม · ไม่ได้สักแถว = 409 */
export async function createRound(body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const { warehouses, cutoffDate } = parseScope(body)
  const base = await baseCol()
  const wanted = body.keys === undefined ? null : strArr(body.keys)
  if (wanted && wanted.length === 0) throw bad("ติ๊กเลือกซากอย่างน้อย 1 รายการ")
  if (wanted && wanted.length > 5000) throw bad("รอบเดียวได้ไม่เกิน 5,000 รายการ")
  const q = candidateQuery(warehouses, cutoffDate)
  const keys = wanted ?? (await base.find(q, { projection: { row_key: 1 } }).limit(5000).toArray()).map((r) => r.row_key)
  if (!keys.length) throw new CoreHttpError("ไม่มีซากรอขายตามคลัง/วันตัดรอบนี้", 409)
  const roundNo = await nextRoundNo(now)
  const rounds = await roundCol()
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : ""
  await rounds.insertOne({ roundNo, warehouses, cutoffDate, status: "open", keys: [], count: 0, costAmount: 0, createdBy: who(actor), createdAt: now, note })
  const got: string[] = []
  let cost = 0
  for (const k of keys) {
    const after = await base.findOneAndUpdate({ ...q, row_key: k } as Filter<CoreRow>, { $set: { saleRoundNo: roundNo, coreUpdatedAt: now } }, { returnDocument: "after", projection: { amount: 1 } })
    if (!after) continue
    got.push(k)
    cost += after.amount ?? 0
    await writeCoreLog({ row_key: k, action: "round_add", from: "sell_waiting", to: "sell_waiting", actor: { ...who(actor), via: actor.via }, data: { roundNo } }, now)
  }
  if (!got.length) {
    await rounds.deleteOne({ roundNo, count: 0 }) // ไม่มีแถวผูก = ไม่มีอะไรให้เก็บประวัติ (เลขรอบนี้ข้ามไป)
    throw new CoreHttpError("ซากที่เลือกถูกรอบอื่นเลือกไปก่อนแล้ว ลองรีเฟรช", 409)
  }
  await rounds.updateOne({ roundNo }, { $set: { keys: got, count: got.length, costAmount: round2(cost) } })
  return { roundNo, count: got.length, skipped: keys.length - got.length, costAmount: round2(cost) }
}

export async function listRounds(limit = 100) {
  return (await roundCol()).find({}, { projection: { _id: 0, keys: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray()
}

export async function getRound(roundNo: string) {
  const round = await (await roundCol()).findOne({ roundNo }, { projection: { _id: 0 } })
  if (!round) throw new CoreHttpError("ไม่พบรอบขายนี้", 404)
  const items = round.keys.length
    ? await (await baseCol()).find({ row_key: { $in: round.keys } }, { projection: { _id: 0 } }).sort({ "sale.scrapInDate": 1, row_key: 1 }).toArray()
    : []
  return { round, items }
}

/**
 * ขายทั้งรอบ: รอบ open → sold (ตัวเดียวชนะ) แล้วไล่แถวในรอบที่ยังรอขาย → sold
 * รอบที่ขายไปแล้วแต่ยังมีแถวค้าง (เช่นเซิร์ฟเวอร์ล่มกลางทาง) กดซ้ำได้ ไล่ต่อเฉพาะแถวที่ค้าง
 */
export async function sellRound(roundNo: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const soldDate = body.soldDate
  if (!isYmd(soldDate)) throw bad("ใส่วันที่ขายก่อน")
  if (soldDate > todayBkk(now)) throw bad("วันที่ขายต้องไม่เกินวันนี้")
  const totalIn = body.totalPrice === "" || body.totalPrice == null ? null : Number(body.totalPrice)
  if (totalIn !== null && !(Number.isFinite(totalIn) && totalIn >= 0)) throw bad("ราคารวมไม่ถูกต้อง")
  const linePrices: Record<string, number> = {}
  if (body.linePrices && typeof body.linePrices === "object") {
    for (const [k, v] of Object.entries(body.linePrices as Record<string, unknown>)) {
      if (v === "" || v == null) continue
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) throw bad("ราคาขายรายบรรทัดไม่ถูกต้อง")
      linePrices[k] = n
    }
  }
  const buyer = typeof body.buyer === "string" ? body.buyer.trim().slice(0, 200) || null : null
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : ""
  const rounds = await roundCol()
  const cur = await rounds.findOne({ roundNo })
  if (!cur) throw new CoreHttpError("ไม่พบรอบขายนี้", 404)
  if (cur.status === "cancelled") throw new CoreHttpError("รอบนี้ยกเลิกไปแล้ว", 409)
  const latestScrap = (await (await baseCol()).find({ row_key: { $in: cur.keys } }, { projection: { "sale.scrapInDate": 1 } }).sort({ "sale.scrapInDate": -1 }).limit(1).next())?.sale?.scrapInDate
  if (latestScrap && soldDate < latestScrap) throw bad("วันที่ขายต้องไม่ก่อนวันที่ซากเข้าคลังซาก")
  const sumLines = Object.values(linePrices).reduce((a, b) => a + b, 0)
  const totalPrice = totalIn ?? (Object.keys(linePrices).length ? round2(sumLines) : null)
  if (cur.status === "open") {
    const claimed = await rounds.findOneAndUpdate({ roundNo, status: "open" },
      { $set: { status: "sold", soldDate, buyer, totalPrice, note: note || cur.note || "", soldBy: who(actor), soldAt: now } }, { returnDocument: "after" })
    if (!claimed) throw new CoreHttpError("รอบนี้มีคนบันทึกไปก่อนแล้ว ลองรีเฟรช", 409)
  }
  const base = await baseCol()
  let sold = 0
  for (const k of cur.keys) {
    const r = await base.findOne({ row_key: k, coreStatus: "sell_waiting", saleRoundNo: roundNo })
    if (!r) continue
    const price = linePrices[k] ?? null
    const sale = { ...(r.sale ?? { scrapInDate: null }), soldDate: cur.status === "sold" ? cur.soldDate ?? soldDate : soldDate, roundNo, price, buyer: cur.status === "sold" ? cur.buyer ?? buyer : buyer, note, soldAt: now, soldBy: who(actor) }
    const after = await base.findOneAndUpdate({ row_key: k, coreStatus: "sell_waiting", saleRoundNo: roundNo }, { $set: { coreStatus: "sold", sale, coreUpdatedAt: now } }, { returnDocument: "after" })
    if (!after) continue
    sold++
    await writeCoreLog({ row_key: k, action: "sold", from: "sell_waiting", to: "sold", actor: { ...who(actor), via: actor.via }, note: note || undefined, data: { roundNo, soldDate: sale.soldDate, price, buyer: sale.buyer } }, now)
  }
  return { roundNo, sold }
}

export async function cancelRound(roundNo: string, body: Record<string, unknown>, actor: Actor, now = new Date()) {
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : ""
  if (!reason) throw bad("บอกเหตุผลที่ยกเลิกรอบ")
  const rounds = await roundCol()
  const cur = await rounds.findOneAndUpdate({ roundNo, status: "open" }, { $set: { status: "cancelled", cancelledBy: who(actor), cancelledAt: now, cancelReason: reason } }, { returnDocument: "after" })
  if (!cur) {
    const exists = await rounds.findOne({ roundNo }, { projection: { status: 1 } })
    if (!exists) throw new CoreHttpError("ไม่พบรอบขายนี้", 404)
    throw new CoreHttpError(exists.status === "sold" ? "รอบนี้ขายไปแล้ว ยกเลิกไม่ได้" : "รอบนี้ยกเลิกไปแล้ว", 409)
  }
  const base = await baseCol()
  let released = 0
  for (const k of cur.keys) {
    const r = await base.updateOne({ row_key: k, coreStatus: "sell_waiting", saleRoundNo: roundNo }, { $set: { saleRoundNo: null, coreUpdatedAt: now } })
    if (!r.modifiedCount) continue
    released++
    await writeCoreLog({ row_key: k, action: "round_cancel", from: "sell_waiting", to: "sell_waiting", actor: { ...who(actor), via: actor.via }, note: reason, data: { roundNo } }, now)
  }
  return { roundNo, released }
}

export type { SaleRound }
