// lib/safety-stock-build.ts
// ชั้นคุย MongoDB ฝั่งสร้าง snapshot ของหน้า /safety-stock — ตรรกะสูตรอยู่ใน safety-stock-core.ts
import clientPromise from "@/lib/mongo"
import { getDeadstock } from "@/lib/deadstock"
import {
  aduFrom, sdDailyFrom, median, prCodeFromNote, leadTimeDaysBetween,
  LT_MIN_SAMPLES, LT_LOOKBACK_MONTHS, USAGE_LOOKBACK_MONTHS,
  type SnapshotRow, type LeadTimeSource,
} from "@/lib/safety-stock-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const ATMS_DB = "atms"
const MOVE_COLL = "stockmovement_v5"
const PR_KEY = "ใบขอสั่งซื้อ (PR)"

export type BuildStats = {
  skuTotal: number; withMinMax: number
  ltFromSku: number; ltFromGroup: number; ltFromWarehouse: number
  prMatched: number; prMissed: number
}

/** "YYYY-MM" ของ n เดือนก่อน asOf (รวมเดือนปัจจุบัน) */
function ymBack(asOf: Date, n: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (n - 1), 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** รายชื่อเดือนย้อนหลัง n เดือนถึงเดือนของ asOf — ต้องเติมเดือนที่ไม่มีการเบิกเป็น 0 ด้วย
 *  ไม่งั้น SD จะคำนวณจากเฉพาะเดือนที่มีการเบิก ซึ่งทำให้ความผันผวนต่ำกว่าความจริงมาก */
function ymList(asOf: Date, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

type IssueDoc = { _id: { i: string | null; m: string | null }; q: number | null; n: number | null }
type RecvDoc = { i: string | null; d: Date | null; note: string | null; c: number | null; g: string | null }

export async function buildSnapshotRows(
  inventoryId: string,
  asOf: Date
): Promise<{ rows: SnapshotRow[]; latestMovementDate: string | null; stats: BuildStats }> {
  const client = await clientPromise
  const atms = client.db(ATMS_DB)
  const move = atms.collection(MOVE_COLL)
  const masterCol = client.db(MASTER_DB).collection("atms_sku_master")

  const usageStartYm = ymBack(asOf, USAGE_LOOKBACK_MONTHS)
  const ltStartYm = ymBack(asOf, LT_LOOKBACK_MONTHS)
  const notLabour = { กลุ่มสินค้า: { $not: /^ค่าแรง/ } }

  // 1) SKU ที่ตั้ง min หรือ max ไว้เท่านั้น — คัดที่ Mongo ไม่ดึงทั้ง 9,630 แถวมา
  const masters = await masterCol
    .find({
      inventoryId,
      $or: [{ minQty: { $gt: 0 } }, { maxQty: { $gt: 0 } }],
      group: { $not: /^ค่าแรง/ },
    })
    .project({ _id: 0, skuPk: 1, code: 1, name: 1, group: 1, unit: 1, brand: 1, oracleCode: 1, stockQty: 1, minQty: 1, maxQty: 1 })
    .toArray()

  const skuTotal = await masterCol.countDocuments({ inventoryId })

  // 2) ยอดเบิกรายเดือน 12 เดือน — ยุบที่ Mongo ก่อนเสมอ (ดึงแถวดิบใช้เวลาต่างกันเป็นร้อยเท่า)
  const issues = await move
    .aggregate<IssueDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: usageStartYm }, จ่าย: { $gt: 0 }, ...notLabour } },
        { $group: { _id: { i: "$รหัสสินค้า", m: "$year_month" }, q: { $sum: "$จ่าย" }, n: { $sum: 1 } } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 3) แถวรับ 24 เดือน — ต้องได้ `หมายเหตุ` รายแถวเพื่อแกะเลข PR จึงยุบไม่ได้
  const receipts = await move
    .aggregate<RecvDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: ltStartYm }, รับ: { $gt: 0 }, ...notLabour } },
        { $project: { _id: 0, i: "$รหัสสินค้า", d: "$วันที่", note: "$หมายเหตุ", c: "$ราคาทุน", g: "$กลุ่มสินค้า" } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 4) วันที่ของ PR ที่ถูกอ้างถึงจริงเท่านั้น — bounded ตามจำนวน PR ที่พบในข้อ 3
  const prCodes = [...new Set(receipts.map((r) => prCodeFromNote(r.note)).filter((x): x is string => !!x))]
  const prDocs = prCodes.length
    ? ((await atms
        .collection("purchase_requests")
        .find({ [PR_KEY]: { $in: prCodes } })
        .project({ _id: 0, [PR_KEY]: 1, "วันที่": 1 })
        .toArray()) as Record<string, unknown>[])
    : []
  const prDate = new Map<string, string>()
  for (const d of prDocs) prDate.set(String(d[PR_KEY] ?? ""), String(d["วันที่"] ?? ""))

  // 5) lead time รายรหัส + รายกลุ่ม + ทั้งคลัง
  const ltBySku = new Map<string, number[]>()
  const ltByGroup = new Map<string, number[]>()
  const allLt: number[] = []
  const costBySku = new Map<string, number>()
  let prMatched = 0
  let prMissed = 0

  for (const r of receipts) {
    const code = r.i ?? ""
    if (!code) continue
    if (r.c != null && r.c > 0) costBySku.set(code, r.c) // ราคาทุนล่าสุดที่เจอ
    const pr = prCodeFromNote(r.note)
    if (!pr) continue
    const pd = prDate.get(pr)
    if (!pd) { prMissed++; continue }
    const days = r.d ? leadTimeDaysBetween(pd, r.d) : null
    if (days === null) { prMissed++; continue }
    prMatched++
    if (!ltBySku.has(code)) ltBySku.set(code, [])
    ltBySku.get(code)!.push(days)
    const g = (r.g ?? "").trim() || "ไม่ระบุ"
    if (!ltByGroup.has(g)) ltByGroup.set(g, [])
    ltByGroup.get(g)!.push(days)
    allLt.push(days)
  }

  const warehouseLt = allLt.length ? median(allLt) : 30 // ไม่มีข้อมูลเลย ใช้ 30 วันเป็นค่าตั้งต้น
  const groupLt = new Map<string, number>()
  for (const [g, xs] of ltByGroup) if (xs.length >= LT_MIN_SAMPLES) groupLt.set(g, median(xs))

  // 6) ยอดเบิกรายเดือนต่อรหัส — เติมเดือนที่ไม่มีการเบิกเป็น 0
  const issueByCode = new Map<string, Map<string, { q: number; n: number }>>()
  for (const d of issues) {
    const code = d._id.i ?? ""
    const m = d._id.m ?? ""
    if (!code || !m) continue
    if (!issueByCode.has(code)) issueByCode.set(code, new Map())
    issueByCode.get(code)!.set(m, { q: d.q ?? 0, n: d.n ?? 0 })
  }

  const months12 = ymList(asOf, 12)
  const windows: { key: "m3" | "m6" | "m12"; months: string[] }[] = [
    { key: "m3", months: months12.slice(-3) },
    { key: "m6", months: months12.slice(-6) },
    { key: "m12", months: months12 },
  ]

  // 7) FIFO จากหน้า /deadstock — ข้อมูลประกอบ ใช้ cache เดิม ไม่ยิง DB ซ้ำ
  //    ข้อมูล FIFO มีเฉพาะคลังลาดกระบัง (inv 4) — คลังอื่นข้ามไปเลย ไม่ต้องยิง cache/DB เปล่าๆ
  const dead = inventoryId === "4" ? await getDeadstock() : null
  const fifoByCode = new Map((dead?.items ?? []).map((it) => [it.itemCode, it]))

  const stats: BuildStats = {
    skuTotal, withMinMax: masters.length,
    ltFromSku: 0, ltFromGroup: 0, ltFromWarehouse: 0,
    prMatched, prMissed,
  }

  const rows: SnapshotRow[] = masters.map((m) => {
    const code = String(m.code ?? "")
    const group = (String(m.group ?? "").trim()) || "ไม่ระบุ"
    const perMonth = issueByCode.get(code) ?? new Map()

    const usage = { m3: 0, m6: 0, m12: 0 }
    const issueCounts = { m3: 0, m6: 0, m12: 0 }
    const adu = { m3: 0, m6: 0, m12: 0 }
    const sdDaily = { m3: 0, m6: 0, m12: 0 }

    for (const w of windows) {
      const qs = w.months.map((ym) => perMonth.get(ym)?.q ?? 0)
      const ns = w.months.map((ym) => perMonth.get(ym)?.n ?? 0)
      const totalQ = qs.reduce((a, b) => a + b, 0)
      usage[w.key] = Math.round(totalQ * 100) / 100
      issueCounts[w.key] = ns.reduce((a, b) => a + b, 0)
      adu[w.key] = aduFrom(totalQ, w.months.length)
      sdDaily[w.key] = sdDailyFrom(qs)
    }

    const skuSamples = ltBySku.get(code) ?? []
    let leadTimeDays: number
    let leadTimeSource: LeadTimeSource
    if (skuSamples.length >= LT_MIN_SAMPLES) {
      leadTimeDays = median(skuSamples); leadTimeSource = "sku"; stats.ltFromSku++
    } else if (groupLt.has(group)) {
      leadTimeDays = groupLt.get(group)!; leadTimeSource = "group"; stats.ltFromGroup++
    } else {
      leadTimeDays = warehouseLt; leadTimeSource = "warehouse"; stats.ltFromWarehouse++
    }

    const fifo = fifoByCode.get(code)
    const cost = costBySku.get(code) ?? 0
    const stockQty = Number(m.stockQty ?? 0)

    return {
      code,
      name: String(m.name ?? ""),
      group,
      unit: String(m.unit ?? ""),
      brand: String(m.brand ?? ""),
      oracleCode: String(m.oracleCode ?? ""),
      inventoryId,
      minQty: Number(m.minQty ?? 0),
      maxQty: Number(m.maxQty ?? 0),
      stockQty,
      fifoRemaining: fifo?.remaining ?? 0,
      oldestAgeDays: fifo?.oldestAgeDays ?? 0,
      usage, issueCounts, adu, sdDaily,
      leadTimeDays: Math.round(leadTimeDays * 10) / 10,
      leadTimeSource,
      leadTimeSamples: skuSamples.length,
      cost: Math.round(cost * 100) / 100,
      value: Math.round(stockQty * cost * 100) / 100,
    }
  })

  const latest = await move
    .find({ inventory_id: inventoryId })
    .sort({ วันที่: -1 })   // ใช้ index วันที่_1 ที่มีอยู่แล้ว
    .limit(1)
    .project({ _id: 0, "วันที่": 1 })
    .toArray()
  const latestMovementDate = latest[0]?.["วันที่"] ? new Date(latest[0]["วันที่"] as Date).toISOString() : null

  return { rows, latestMovementDate, stats }
}
