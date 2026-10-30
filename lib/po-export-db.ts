// lib/po-export-db.ts — อ่าน PO ตามช่วงวันที่ + รายการสินค้า สำหรับหน้า /po (อ่านอย่างเดียว)
import type { Db } from "mongodb"
import { sharedCache } from "@/lib/shared-cache"
import { fleetPairs, PR_FLEET_KEY, PR_FLEET_FRESH_MS, PR_FLEET_MAX_STALE_MS } from "@/lib/pr-list-cache"
import {
  PO_KEY, PR_KEY, PO_DATE_FIELDS, PO_PAGE_SIZE, poMonthRegex, poRowOf, poItemOf, s,
  type PoDateField, type PoItem, type PoRow,
} from "@/lib/po-export"

type Doc = Record<string, unknown>

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

// เบอร์รถต่อทะเบียน — ใช้แคชก้อนเดียวกับหน้า /pr (key เดียวกัน · vehicle_daily ทับ vehiclemaster)
async function fleetMap(atms: Db): Promise<Map<string, string>> {
  const pairs = await sharedCache.get({
    key: PR_FLEET_KEY,
    freshMs: PR_FLEET_FRESH_MS,
    maxStaleMs: PR_FLEET_MAX_STALE_MS,
    load: async () => {
      const [vm, vd] = await Promise.all([
        atms.collection("vehiclemaster").find({}).project({ "ทะเบียน": 1, "เลขรถ": 1, _id: 0 }).toArray() as Promise<Doc[]>,
        atms.collection("vehicle_daily").find({}).project({ "ทะเบียน": 1, "เบอร์รถ": 1, _id: 0 }).toArray() as Promise<Doc[]>,
      ])
      return fleetPairs(vm, vd)
    },
  })
  return new Map(pairs)
}

export type PoPage = { rows: PoRow[]; total: number; sum: number }

/**
 * PO ที่วันที่ (PO หรือกำหนดส่ง) อยู่ในช่วง from–to · เรียงวันที่ล่าสุดก่อน · ทีละ PO_PAGE_SIZE ใบ
 * purchase_orders เล็ก (หลักหมื่นใบ) ไม่มี index บนวันที่ — กรองเดือนด้วย regex ก่อนแล้วค่อยแปลงวันที่จริง
 */
export async function loadPoPage(atms: Db, q: { from: string; to: string; field: PoDateField; page: number }): Promise<PoPage> {
  const f = PO_DATE_FIELDS[q.field]
  const [res] = await atms.collection("purchase_orders").aggregate([
    { $match: { [f]: { $regex: poMonthRegex(q.from, q.to) } } },
    { $addFields: { _d: { $dateFromString: {
      dateString: { $arrayElemAt: [{ $split: [`$${f}`, " "] }, 0] }, format: "%d/%m/%Y", onError: null, onNull: null,
    } } } },
    { $match: { _d: { $gte: utc(q.from), $lte: utc(q.to) } } },
    { $facet: {
      meta: [{ $group: { _id: null, n: { $sum: 1 }, sum: { $sum: "$รวม" } } }],
      rows: [
        { $sort: { _d: -1, [PO_KEY]: -1 } },
        { $skip: q.page * PO_PAGE_SIZE },
        { $limit: PO_PAGE_SIZE },
        { $project: { _id: 0, _d: 0, scraped_at: 0 } },
      ],
    } },
  ], { maxTimeMS: 25000 }).toArray() as { meta: { n: number; sum: number }[]; rows: Doc[] }[]

  const pos = res?.rows ?? []
  const meta = res?.meta?.[0]
  const codes = [...new Set(pos.map((p) => s(p[PO_KEY])).filter(Boolean))]
  const prCodes = [...new Set(pos.map((p) => s(p[PR_KEY])).filter(Boolean))]

  const [prs, dds, fleet] = await Promise.all([
    prCodes.length
      ? atms.collection("purchase_requests").find(
        { [PR_KEY]: { $in: prCodes } },
        { projection: { _id: 0, [PR_KEY]: 1, "วันที่": 1, "ผู้ขอซื้อ": 1, "คลังสินค้า": 1, "แผนก": 1, "ทะเบียน": 1, "หมายเหตุ": 1 }, maxTimeMS: 15000 },
      ).toArray() as Promise<Doc[]>
      : [],
    codes.length
      ? atms.collection("deposit_header").find(
        { purchase_order: { $in: codes } },
        { projection: { _id: 0, deposit_code: 1, purchase_order: 1, received_at: 1 }, maxTimeMS: 15000 },
      ).toArray() as Promise<Doc[]>
      : [],
    fleetMap(atms),
  ])

  const prBy = new Map(prs.map((p) => [s(p[PR_KEY]), p]))
  const ddBy = new Map<string, { code: string; date: unknown }[]>()
  for (const d of dds) {
    const po = s(d.purchase_order)
    if (!ddBy.has(po)) ddBy.set(po, [])
    ddBy.get(po)!.push({ code: s(d.deposit_code), date: d.received_at })
  }

  const rows = pos.map((po) => {
    const pr = prBy.get(s(po[PR_KEY])) ?? null
    const plate = s(po["ยานพาหนะ"]) || s(pr?.["ทะเบียน"])
    return poRowOf(po, { pr, dd: ddBy.get(s(po[PO_KEY])) ?? [], fleetNo: fleet.get(plate) ?? "" })
  })
  return { rows, total: meta?.n ?? 0, sum: Math.round((meta?.sum ?? 0) * 100) / 100 }
}

/** รายการสินค้าของ PO หลายใบ (purchase_order_items มี index บน po_code) + detail_id ไว้ลิงก์ไป ATMS */
export async function loadPoItems(atms: Db, codes: string[]): Promise<{ items: Record<string, PoItem[]>; detailIds: Record<string, string> }> {
  const items: Record<string, PoItem[]> = {}
  const detailIds: Record<string, string> = {}
  if (!codes.length) return { items, detailIds }
  const docs = await atms.collection("purchase_order_items").find(
    { po_code: { $in: codes } },
    { projection: { _id: 0, scraped_at: 0 }, maxTimeMS: 15000 },
  ).toArray() as Doc[]
  for (const d of docs) {
    const it = poItemOf(d)
    if (!it.poCode) continue
    ;(items[it.poCode] ??= []).push(it)
    if (!detailIds[it.poCode] && s(d.detail_id)) detailIds[it.poCode] = s(d.detail_id)
  }
  for (const list of Object.values(items)) list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  return { items, detailIds }
}
