// lib/on-order.ts
// "กำลังสั่งซื้อ" รายรหัสสินค้า — ชั้นดึงข้อมูลจาก atms (ตรรกะการตัดสินอยู่ที่ openPoQtyBySku ใน safety-stock-core)
//
// แยกเป็นไฟล์ของตัวเองเพราะใช้ร่วมกันสองหน้าที่มองคนละมุม และ import วนกันไม่ได้:
//   /safety-stock      — ของกำลังมา = ยังไม่ต้องสั่งเพิ่ม (safety-stock-build ซึ่ง import lib/deadstock อยู่แล้ว)
//   /deadstock/pending — PR ที่ยังไม่รับของ = กำลังจะซื้อซ้ำทั้งที่ของเก่ายังค้างในคลัง (lib/deadstock)
// สองหน้านับคนละแบบ (ผู้ใช้สั่ง 21/10/2026): /safety-stock นับจาก PO ค้างรับ (fetchOnOrderBySku)
// /deadstock/pending ยังนับจาก PR แบบเดิม (fetchOpenPrBySku) ไม่ให้กระทบ
// ถ้าปล่อยไว้ใน safety-stock-build แล้วให้ deadstock เรียก จะกลายเป็น import วน deadstock → build → deadstock
import type { Db } from "mongodb"
import {
  openPoQtyBySku, openPrQtyBySku, poCodesGoneFromAtms, ageDaysFromDmy, ON_ORDER_MAX_AGE_DAYS, WAREHOUSES,
  type OnOrder, type OpenPrOrder, type ProcurementRunRef,
} from "@/lib/safety-stock-core"

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

/** ผลตรวจ PO ที่ถูกลบใน ATMS — ส่ง object เข้ามาถ้าอยากรู้ (probe ใช้) */
export type OnOrderDiag = { goneCodes: string[]; goneSkipped: string | null; inWindow: number }

/** รอบดึงข้อมูลจัดซื้อล่าสุดที่จบสำเร็จและดึง PO — 30 รอบ ≈ 5 วัน (light ~5 รอบ + full 1 รอบ ต่อวัน)
 *  พอให้ใบเก่าที่มีแต่รอบ full ครอบ มีรอบตัดสินครบ 3 · collection เล็ก (~30 แถว/วัน) collscan ได้
 *  อ่านไม่ได้ = คืน [] → poCodesGoneFromAtms ข้ามการตรวจ (นับทุกใบเหมือนเดิม ดีกว่าตัดผิด) */
async function recentProcurementRuns(atms: Db): Promise<ProcurementRunRef[]> {
  try {
    const docs = (await atms.collection("procurement_runs")
      .find({ ok: true, "counts.purchase_orders": { $exists: true } }, { maxTimeMS: MAX_TIME_MS })
      .sort({ created_at: -1 }).limit(30)
      .project({ _id: 0, started_at: 1, from_date: 1, "counts.purchase_orders": 1 })
      .toArray()) as Record<string, unknown>[]
    return docs.flatMap((d) => {
      const po = ((d.counts as Record<string, unknown> | undefined)?.purchase_orders ?? {}) as Record<string, unknown>
      const startedAt = d.started_at instanceof Date ? d.started_at : null
      return startedAt
        ? [{ startedAt, fromDate: s(d.from_date), poSeen: Number(po.inserted ?? 0) + Number(po.updated ?? 0) }]
        : []
    })
  } catch {
    return []
  }
}

/** "กำลังสั่งซื้อ" รายรหัสสินค้าของคลังหนึ่ง = บรรทัด PO ที่ยังค้างรับ (ดู openPoQtyBySku)
 *  ใบที่ถูกลบใน ATMS แล้วแต่ยังค้างในสำเนาถูกตัดออกก่อน (ดู poCodesGoneFromAtms)
 *
 *  3 query ที่ bounded ทั้งหมด (+ procurement_runs 10 แถว):
 *   1) purchase_orders ที่สถานะยังค้างรับ + ปีไม่เก่ากว่ากรอบอายุ — สถานะไม่มี index (collscan ~13k doc)
 *      ยอมรับได้ที่ขนาดนี้เหมือนรุ่นก่อน · กรองอายุละเอียดฝั่ง JS เพราะวันที่เป็นสตริง "DD/MM/YYYY"
 *   2) purchase_requests ของ PR ที่ PO อ้างถึง (มี index ที่ PR_KEY) — ใช้แค่กรองอะไหล่ลงคัน/อนุมัติ/ยกเลิก + คลังสำรอง
 *   3) purchase_order_items ของ PO ที่เหลือ
 *  พังตรงไหนก็คืน Map ว่าง ไม่ล้มทั้ง build — ของที่กำลังมาเป็นข้อมูลเสริม */
export async function fetchOnOrderBySku(
  atms: Db, inventoryId: string, asOf: Date, diag?: OnOrderDiag,
): Promise<Map<string, OnOrder>> {
  const warehouseName = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? ""
  if (!warehouseName) return new Map()
  try {
    const minYear = String(new Date(asOf.getTime() - ON_ORDER_MAX_AGE_DAYS * 86_400_000).getFullYear())
    const poHeadDocs = (await atms.collection("purchase_orders")
      .find({
        [PO_RECEIVE_STATUS_KEY]: { $regex: "บางส่วน|ยังไม่ได้รับ" },
        $expr: { $gte: [{ $substrCP: [`$${DATE_KEY}`, 6, 4] }, minYear] },
      }, { maxTimeMS: MAX_TIME_MS })
      .project({ _id: 0, [PO_KEY]: 1, [PR_KEY]: 1, [PO_RECEIVE_STATUS_KEY]: 1, [DATE_KEY]: 1, scraped_at: 1 })
      .toArray()) as Record<string, unknown>[]
    const fresh = poHeadDocs
      .map((d) => ({
        code: s(d[PO_KEY]), prCode: s(d[PR_KEY]), receiveStatus: s(d[PO_RECEIVE_STATUS_KEY]), date: s(d[DATE_KEY]),
        scrapedAt: d.scraped_at instanceof Date ? d.scraped_at : null,
      }))
      .filter((p) => {
        if (!p.code) return false
        const age = ageDaysFromDmy(p.date, asOf)
        return age !== null && age >= 0 && age <= ON_ORDER_MAX_AGE_DAYS
      })
    const check = poCodesGoneFromAtms({ poHeads: fresh, runs: await recentProcurementRuns(atms) })
    if (diag) Object.assign(diag, { goneCodes: [...check.gone], goneSkipped: check.skipped, inWindow: check.inWindow })
    if (check.skipped === "too-many") console.warn("[on-order] PO หายจาก ATMS เกินเกณฑ์ ไม่ตัด — รอบดึงข้อมูลน่าจะผิดปกติ", inventoryId)
    const poHeads = fresh.filter((p) => !check.gone.has(p.code))
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

/** รุ่น PR เดิม (ไม่เปลี่ยน) — ใช้กับ /deadstock/pending เท่านั้น ดึงข้อมูลจาก atms แล้วส่งต่อให้ openPrQtyBySku ตัดสิน
 *  (นิยามอยู่ที่นั่น ไฟล์นี้รับผิดชอบแค่การ query) · แยกจาก buildSnapshotRows เพื่อให้ probe เรียกได้ตรงๆ
 *  โดยไม่ต้องลาก aggregation หนักบน stockmovement_v5 มาด้วย — ดู scripts/probe-on-order.ts
 *
 *  4 query ที่ bounded ทั้งหมด บน collection ขนาด 17k–30k แถว เทียบกับ aggregation บน stockmovement_v5
 *  476k แถวใน buildSnapshotRows ถือว่าเล็กมาก · purchase_orders.{PR_KEY} กับ deposit_header.purchase_order
 *  ยังไม่มี index (collscan ครั้งละ ~13k/17k doc) ยอมรับได้ที่ขนาดนี้ ไม่สร้าง index เพิ่มเพราะ collection
 *  พวกนี้เป็นของ pipeline อื่นที่เขียนเข้ามา ไม่ใช่ของหน้านี้
 *
 *  พังตรงไหนก็คืน Map ว่าง ไม่ล้มทั้ง build — ของที่กำลังมาเป็นข้อมูลเสริม min/max/ยอดเบิกคือตัวหลัก
 */
export async function fetchOpenPrBySku(atms: Db, inventoryId: string, asOf: Date): Promise<Map<string, OpenPrOrder>> {
  const warehouseName = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? ""
  if (!warehouseName) return new Map()
  try {
    // PR ของคลังนี้ที่ยังไม่เกินอายุ — กรองอายุฝั่ง JS เพราะ ATMS เก็บวันที่เป็นสตริง "DD/MM/YYYY" ช่วงค่าไม่ได้
    // ตัดปีที่เก่าเกินออกฝั่ง Mongo ก่อน ไม่งั้นลากใบเก่ามาทิ้งเปล่าๆ (หลัง backfill ปี 2568 เข้ามา
    // ลาดกระบังมี 15,046 ใบ แต่ในกรอบ 90 วันจริงๆ ไม่ถึง 1 ใน 4) · ปลอดภัยเพราะใบที่ผ่านตัวกรอง JS
    // ต้องมีอายุ ≤ maxAge เสมอ ปีของมันจึงไม่มีทางเก่ากว่าปีของ (asOf − maxAge)
    const minYear = String(new Date(asOf.getTime() - ON_ORDER_MAX_AGE_DAYS * 86_400_000).getFullYear())
    const prHeadDocs = (await atms.collection("purchase_requests")
      .find({ [WH_KEY]: warehouseName, $expr: { $gte: [{ $substrCP: [`$${DATE_KEY}`, 6, 4] }, minYear] } })
      .project({ _id: 0, [PR_KEY]: 1, [DATE_KEY]: 1, [WH_KEY]: 1, [PLATE_KEY]: 1, [PR_APPROVED_KEY]: 1, [PR_NOTE_KEY]: 1 })
      .toArray()) as Record<string, unknown>[]
    const prHeads = prHeadDocs
      .map((d) => ({
        code: String(d[PR_KEY] ?? ""), date: String(d[DATE_KEY] ?? ""),
        warehouse: String(d[WH_KEY] ?? ""), plate: String(d[PLATE_KEY] ?? ""),
        // boolean เท่านั้นที่ถือเป็นสถานะจริง — null/ไม่มีฟิลด์ = ไม่รู้ ส่ง null ให้ core นับต่อเหมือนเดิม
        approved: typeof d[PR_APPROVED_KEY] === "boolean" ? (d[PR_APPROVED_KEY] as boolean) : null,
        note: String(d[PR_NOTE_KEY] ?? ""),
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

