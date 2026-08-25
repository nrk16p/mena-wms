// lib/deadstock.ts
// ชั้นคุย MongoDB ของหน้า /deadstock — ตรรกะทั้งหมดอยู่ใน deadstock-core.ts
import clientPromise from "@/lib/mongo"
import {
  DB_NAME, COLL_NAME, INVENTORY_ID, LAYER_PIPELINE, ISSUE_PIPELINE, buildPayload,
  type LayerDoc, type IssueDoc, type DeadstockPayload,
} from "@/lib/deadstock-core"
import { fetchOnOrderBySku } from "@/lib/on-order"
import { fetchRequesterByPr } from "@/lib/pr-snapshot"

/** ยุบข้อมูลฝั่ง Mongo ก่อนเสมอ — ดึงแถวดิบ 54k แถวใช้ 152 วินาที ส่วนยุบก่อนใช้ 1.7 วินาที */
async function fetchRaw(): Promise<{ layers: LayerDoc[]; issues: IssueDoc[] }> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection(COLL_NAME)
  const [layers, issues] = await Promise.all([
    col.aggregate<LayerDoc>(LAYER_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
    col.aggregate<IssueDoc>(ISSUE_PIPELINE, { maxTimeMS: 60_000 }).toArray(),
  ])
  return { layers, issues }
}

// ข้อมูลต้นทางอัปเดตวันละครั้งจาก pipeline ATMS — ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis เพื่อให้รอดข้าม hot-reload ตอน dev และข้าม warm invocation บน Vercel
const TTL_MS = 60 * 60 * 1000

declare global {
  var _deadstockCache: { at: number; data: DeadstockPayload } | undefined
}

export async function getDeadstock(force = false): Promise<DeadstockPayload> {
  const hit = globalThis._deadstockCache
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.data
  const asOf = new Date()
  const client = await clientPromise
  const { layers, issues } = await fetchRaw()
  // "กำลังจะซื้อซ้ำ" — ของที่สั่งไปแล้วยังไม่รับเข้า ทั้งที่ของเก่ายังค้างในคลัง · พังก็ไม่ล้มทั้งหน้า
  // (fetchOnOrderBySku คืน Map ว่างเองเมื่อ query พัง) แค่คอลัมน์นั้นว่างไป ตัวเลข deadstock หลักไม่กระทบ
  const onOrder = await fetchOnOrderBySku(client.db("atms"), INVENTORY_ID, asOf)
  const data = buildPayload(layers, issues, asOf, onOrder)
  // ผู้ขอซื้ออยู่ที่หัวใบ PR คนละ collection กับ stockmovement — เติมหลัง build เพราะเพิ่งรู้ตอนนี้
  // ว่าใบไหน "ค้างจริง" (~364 ใบ วัดจริง 25/08/2026) $in จึงเล็กกว่าการยิงทุกใบรับที่เคยมี (~2,500)
  const requesters = await fetchRequesterByPr(client, data.pending.map((p) => p.prCode ?? ""))
  for (const row of data.pending) row.requester = (row.prCode && requesters.get(row.prCode)) || null
  globalThis._deadstockCache = { at: Date.now(), data }
  return data
}
