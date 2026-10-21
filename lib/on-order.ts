// lib/on-order.ts
// "กำลังสั่งซื้อ" รายรหัสสินค้า — ชั้นดึงข้อมูลจาก atms (ตรรกะการตัดสินอยู่ที่ openPoQtyBySku ใน safety-stock-core)
//
// แยกเป็นไฟล์ของตัวเองเพราะใช้ร่วมกันสองหน้าที่มองคนละมุม และ import วนกันไม่ได้:
//   /safety-stock      — ของกำลังมา = ยังไม่ต้องสั่งเพิ่ม (safety-stock-build ซึ่ง import lib/deadstock อยู่แล้ว)
//   /deadstock/pending — ของกำลังมา = กำลังจะซื้อซ้ำทั้งที่ของเก่ายังค้างในคลัง (lib/deadstock)
// ถ้าปล่อยไว้ใน safety-stock-build แล้วให้ deadstock เรียก จะกลายเป็น import วน deadstock → build → deadstock
import type { Db } from "mongodb"
import { openPoQtyBySku, ageDaysFromDmy, ON_ORDER_MAX_AGE_DAYS, WAREHOUSES, type OnOrder } from "@/lib/safety-stock-core"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"
const WH_KEY = "คลังสินค้า"
const DATE_KEY = "วันที่"
const PLATE_KEY = "ทะเบียน"
const PO_RECEIVE_STATUS_KEY = "สถานะการรับสินค้า"
/** ไอคอนอนุมัติที่ scraper แกะเป็น boolean — null สำหรับใบก่อน ก.ค. 2026 ที่ยังไม่ได้ re-scrape */
const PR_APPROVED_KEY = "is approved"
const PR_NOTE_KEY = "หมายเหตุ"
/** เพดานต่อ query — collection พวกนี้ไม่ใหญ่ แต่ cluster เล็ก ห้ามปล่อยให้ query ค้างฝั่งเซิร์ฟเวอร์ */
const MAX_TIME_MS = 20_000

const s = (v: unknown) => String(v ?? "")
const n = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v))

/** "กำลังสั่งซื้อ" รายรหัสสินค้าของคลังหนึ่ง = บรรทัด PO ที่ยังค้างรับ (ดู openPoQtyBySku)
 *
 *  3 query ที่ bounded ทั้งหมด:
 *   1) purchase_orders ที่สถานะยังค้างรับ + ปีไม่เก่ากว่ากรอบอายุ — สถานะไม่มี index (collscan ~13k doc)
 *      ยอมรับได้ที่ขนาดนี้เหมือนรุ่นก่อน · กรองอายุละเอียดฝั่ง JS เพราะวันที่เป็นสตริง "DD/MM/YYYY"
 *   2) purchase_requests ของ PR ที่ PO อ้างถึง (มี index ที่ PR_KEY) — ใช้แค่กรองอะไหล่ลงคัน/อนุมัติ/ยกเลิก + คลังสำรอง
 *   3) purchase_order_items ของ PO ที่เหลือ
 *  พังตรงไหนก็คืน Map ว่าง ไม่ล้มทั้ง build — ของที่กำลังมาเป็นข้อมูลเสริม */
export async function fetchOnOrderBySku(atms: Db, inventoryId: string, asOf: Date): Promise<Map<string, OnOrder>> {
  const warehouseName = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? ""
  if (!warehouseName) return new Map()
  try {
    const minYear = String(new Date(asOf.getTime() - ON_ORDER_MAX_AGE_DAYS * 86_400_000).getFullYear())
    const poHeadDocs = (await atms.collection("purchase_orders")
      .find({
        [PO_RECEIVE_STATUS_KEY]: { $regex: "บางส่วน|ยังไม่ได้รับ" },
        $expr: { $gte: [{ $substrCP: [`$${DATE_KEY}`, 6, 4] }, minYear] },
      }, { maxTimeMS: MAX_TIME_MS })
      .project({ _id: 0, [PO_KEY]: 1, [PR_KEY]: 1, [PO_RECEIVE_STATUS_KEY]: 1, [DATE_KEY]: 1 })
      .toArray()) as Record<string, unknown>[]
    const poHeads = poHeadDocs
      .map((d) => ({ code: s(d[PO_KEY]), prCode: s(d[PR_KEY]), receiveStatus: s(d[PO_RECEIVE_STATUS_KEY]), date: s(d[DATE_KEY]) }))
      .filter((p) => {
        if (!p.code) return false
        const age = ageDaysFromDmy(p.date, asOf)
        return age !== null && age >= 0 && age <= ON_ORDER_MAX_AGE_DAYS
      })
    if (!poHeads.length) return new Map()

    const prCodes = [...new Set(poHeads.map((p) => p.prCode).filter(Boolean))]
    const [prHeadDocs, poItemDocs] = await Promise.all([
      prCodes.length
        ? atms.collection("purchase_requests")
            .find({ [PR_KEY]: { $in: prCodes } }, { maxTimeMS: MAX_TIME_MS })
            .project({ _id: 0, [PR_KEY]: 1, [DATE_KEY]: 1, [WH_KEY]: 1, [PLATE_KEY]: 1, [PR_APPROVED_KEY]: 1, [PR_NOTE_KEY]: 1 })
            .toArray() as Promise<Record<string, unknown>[]>
        : Promise.resolve([] as Record<string, unknown>[]),
      atms.collection("purchase_order_items")
        .find({ po_code: { $in: poHeads.map((p) => p.code) } }, { maxTimeMS: MAX_TIME_MS })
        .project({ _id: 0, po_code: 1, sku: 1, amount: 1, received: 1, outstanding: 1, warehouse: 1, group: 1 })
        .toArray() as Promise<Record<string, unknown>[]>,
    ])

    return openPoQtyBySku({
      poHeads,
      prHeads: prHeadDocs.map((d) => ({
        code: s(d[PR_KEY]), date: s(d[DATE_KEY]), warehouse: s(d[WH_KEY]), plate: s(d[PLATE_KEY]),
        // boolean เท่านั้นที่ถือเป็นสถานะจริง — null/ไม่มีฟิลด์ = ไม่รู้ นับต่อ
        approved: typeof d[PR_APPROVED_KEY] === "boolean" ? (d[PR_APPROVED_KEY] as boolean) : null,
        note: s(d[PR_NOTE_KEY]),
      })),
      poItems: poItemDocs.map((d) => ({
        poCode: s(d.po_code), sku: s(d.sku), amount: Number(d.amount ?? 0), received: Number(d.received ?? 0),
        outstanding: n(d.outstanding) ?? null, warehouse: s(d.warehouse), group: s(d.group),
      })),
      warehouse: warehouseName,
      asOf,
    })
  } catch {
    return new Map()
  }
}
