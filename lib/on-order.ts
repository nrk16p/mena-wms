// lib/on-order.ts
// "กำลังสั่งซื้อ" รายรหัสสินค้า — ชั้นดึงข้อมูลจาก atms (ตรรกะการตัดสินอยู่ที่ openPrQtyBySku ใน safety-stock-core)
//
// แยกเป็นไฟล์ของตัวเองเพราะใช้ร่วมกันสองหน้าที่มองคนละมุม และ import วนกันไม่ได้:
//   /safety-stock      — ของกำลังมา = ยังไม่ต้องสั่งเพิ่ม (safety-stock-build ซึ่ง import lib/deadstock อยู่แล้ว)
//   /deadstock/pending — ของกำลังมา = กำลังจะซื้อซ้ำทั้งที่ของเก่ายังค้างในคลัง (lib/deadstock)
// ถ้าปล่อยไว้ใน safety-stock-build แล้วให้ deadstock เรียก จะกลายเป็น import วน deadstock → build → deadstock
import type { Db } from "mongodb"
import { openPrQtyBySku, ageDaysFromDmy, ON_ORDER_MAX_AGE_DAYS, WAREHOUSES, type OnOrder } from "@/lib/safety-stock-core"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"
const WH_KEY = "คลังสินค้า"
const DATE_KEY = "วันที่"
const PLATE_KEY = "ทะเบียน"
const PO_RECEIVE_STATUS_KEY = "สถานะการรับสินค้า"

/** "กำลังสั่งซื้อ" รายรหัสสินค้าของคลังหนึ่ง — ดึงข้อมูลจาก atms แล้วส่งต่อให้ openPrQtyBySku ตัดสิน
 *  (นิยามอยู่ที่นั่น ไฟล์นี้รับผิดชอบแค่การ query) · แยกจาก buildSnapshotRows เพื่อให้ probe เรียกได้ตรงๆ
 *  โดยไม่ต้องลาก aggregation หนักบน stockmovement_v5 มาด้วย — ดู scripts/probe-on-order.ts
 *
 *  4 query ที่ bounded ทั้งหมด บน collection ขนาด 11k–17k แถว เทียบกับ aggregation บน stockmovement_v5
 *  476k แถวใน buildSnapshotRows ถือว่าเล็กมาก · purchase_orders.{PR_KEY} กับ deposit_header.purchase_order
 *  ยังไม่มี index (collscan ครั้งละ ~13k/17k doc) ยอมรับได้ที่ขนาดนี้ ไม่สร้าง index เพิ่มเพราะ collection
 *  พวกนี้เป็นของ pipeline อื่นที่เขียนเข้ามา ไม่ใช่ของหน้านี้
 *
 *  พังตรงไหนก็คืน Map ว่าง ไม่ล้มทั้ง build — ของที่กำลังมาเป็นข้อมูลเสริม min/max/ยอดเบิกคือตัวหลัก
 */
export async function fetchOnOrderBySku(atms: Db, inventoryId: string, asOf: Date): Promise<Map<string, OnOrder>> {
  const warehouseName = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? ""
  if (!warehouseName) return new Map()
  try {
    // PR ของคลังนี้ที่ยังไม่เกินอายุ — กรองอายุฝั่ง JS เพราะ ATMS เก็บวันที่เป็นสตริง "DD/MM/YYYY" ช่วงค่าไม่ได้
    const prHeadDocs = (await atms.collection("purchase_requests")
      .find({ [WH_KEY]: warehouseName })
      .project({ _id: 0, [PR_KEY]: 1, [DATE_KEY]: 1, [WH_KEY]: 1, [PLATE_KEY]: 1 })
      .toArray()) as Record<string, unknown>[]
    const prHeads = prHeadDocs
      .map((d) => ({
        code: String(d[PR_KEY] ?? ""), date: String(d[DATE_KEY] ?? ""),
        warehouse: String(d[WH_KEY] ?? ""), plate: String(d[PLATE_KEY] ?? ""),
      }))
      .filter((p) => {
        if (!p.code) return false
        const age = ageDaysFromDmy(p.date, asOf)
        return age !== null && age >= 0 && age <= ON_ORDER_MAX_AGE_DAYS
      })
    const inScopePrCodes = prHeads.map((p) => p.code)

    const poHeadDocs = inScopePrCodes.length
      ? ((await atms.collection("purchase_orders")
          .find({ [PR_KEY]: { $in: inScopePrCodes } })
          .project({ _id: 0, [PO_KEY]: 1, [PR_KEY]: 1, [PO_RECEIVE_STATUS_KEY]: 1 })
          .toArray()) as Record<string, unknown>[])
      : []
    const poHeads = poHeadDocs.map((d) => ({
      code: String(d[PO_KEY] ?? ""), prCode: String(d[PR_KEY] ?? ""),
      receiveStatus: String(d[PO_RECEIVE_STATUS_KEY] ?? ""),
    }))
    const livePoCodes = poHeads.filter((p) => !p.receiveStatus.includes("ยกเลิก")).map((p) => p.code).filter(Boolean)

    const [ddPoCodes, prItemDocs, poItemDocs] = await Promise.all([
      livePoCodes.length
        ? atms.collection("deposit_header").distinct("purchase_order", { purchase_order: { $in: livePoCodes } }) as Promise<string[]>
        : Promise.resolve([] as string[]),
      inScopePrCodes.length
        ? atms.collection("purchase_request_items")
            .find({ pr_code: { $in: inScopePrCodes } })
            .project({ _id: 0, pr_code: 1, sku: 1, amount: 1, warehouse: 1, group: 1 })
            .toArray() as Promise<Record<string, unknown>[]>
        : Promise.resolve([] as Record<string, unknown>[]),
      livePoCodes.length
        ? atms.collection("purchase_order_items")
            .find({ po_code: { $in: livePoCodes } })
            .project({ _id: 0, po_code: 1, sku: 1, received: 1 })
            .toArray() as Promise<Record<string, unknown>[]>
        : Promise.resolve([] as Record<string, unknown>[]),
    ])

    return openPrQtyBySku({
      prHeads, poHeads,
      ddPoCodes: ddPoCodes.map((x) => String(x ?? "")).filter(Boolean),
      prItems: prItemDocs.map((d) => ({
        prCode: String(d.pr_code ?? ""), sku: String(d.sku ?? ""),
        amount: Number(d.amount ?? 0), warehouse: String(d.warehouse ?? ""), group: String(d.group ?? ""),
      })),
      poItems: poItemDocs.map((d) => ({
        poCode: String(d.po_code ?? ""), sku: String(d.sku ?? ""), received: Number(d.received ?? 0),
      })),
      warehouse: warehouseName,
      asOf,
    })
  } catch {
    return new Map()
  }
}

