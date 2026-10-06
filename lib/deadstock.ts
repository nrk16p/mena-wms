// lib/deadstock.ts
// ชั้นคุย MongoDB ของหน้า /deadstock — ตรรกะทั้งหมดอยู่ใน deadstock-core.ts
import clientPromise from "@/lib/mongo"
import {
  DB_NAME, COLL_NAME, INVENTORY_ID, LAYER_PIPELINE, ISSUE_PIPELINE, buildPayload,
  type LayerDoc, type IssueDoc, type DeadstockPayload,
} from "@/lib/deadstock-core"
import { fetchOnOrderBySku } from "@/lib/on-order"
import { fetchPrDetailIdByPr, fetchRequesterByPr } from "@/lib/pr-snapshot"
import { sharedCache } from "@/lib/shared-cache"

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

// ข้อมูลต้นทางอัปเดตวันละไม่กี่รอบจาก pipeline ATMS — ไม่มีเหตุให้ยิง DB ทุก request
// แคชกลางร่วมทุก instance (lib/shared-cache.ts): สด 1 ชม. เท่าเดิม · เลยแล้วเสิร์ฟของเดิมได้ถึง 6 ชม.
// ระหว่างโหลดใหม่เบื้องหลัง (เดิม instance ที่แคชว่าง/หมดอายุต้องรอ query ~5.5 วินาที)
// ไม่ผูก tag — ไม่มีเส้นไหนใน WMS เขียน collection ที่ใช้คำนวณ (ป้ายการจัดการอยู่ /api/deadstock/action แยกไม่แคช)
const CACHE_KEY = "deadstock:v1"
const FRESH_MS = 60 * 60 * 1000
const MAX_STALE_MS = 6 * 60 * 60 * 1000

/** opts.maxAgeMs — ผู้เรียกที่รับข้อมูลเก่ากว่านี้ไม่ได้ (cron safety-stock เก็บลง snapshot) จะรอผลโหลดใหม่
 *  ต่อคิวกับการโหลดเบื้องหลังที่เพิ่งถูกสั่ง จึงไม่ยิง DB ซ้ำ */
export async function getDeadstock(force = false, opts: { maxAgeMs?: number } = {}): Promise<DeadstockPayload> {
  const get = (f: boolean) => sharedCache.get({
    key: CACHE_KEY, load: loadDeadstock, freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS, force: f,
  })
  const data = await get(force)
  if (!force && opts.maxAgeMs !== undefined && Date.now() - Date.parse(data.asOf) >= opts.maxAgeMs) return get(true)
  return data
}

async function loadDeadstock(): Promise<DeadstockPayload> {
  const asOf = new Date()
  const client = await clientPromise
  const { layers, issues } = await fetchRaw()
  // "กำลังจะซื้อซ้ำ" — ของที่สั่งไปแล้วยังไม่รับเข้า ทั้งที่ของเก่ายังค้างในคลัง · พังก็ไม่ล้มทั้งหน้า
  // (fetchOnOrderBySku คืน Map ว่างเองเมื่อ query พัง) แค่คอลัมน์นั้นว่างไป ตัวเลข deadstock หลักไม่กระทบ
  const onOrder = await fetchOnOrderBySku(client.db("atms"), INVENTORY_ID, asOf)
  const data = buildPayload(layers, issues, asOf, onOrder)
  // ผู้ขอซื้ออยู่ที่หัวใบ PR คนละ collection กับ stockmovement — เติมหลัง build เพราะเพิ่งรู้ตอนนี้
  // ว่าใบไหน "ค้างจริง" (~364 ใบ วัดจริง 25/08/2026) $in จึงเล็กกว่าการยิงทุกใบรับที่เคยมี (~2,500)
  // detail_id สำหรับลิงก์ตรงเข้าหน้าใบ PR ใน ATMS ก็อยู่อีก collection — ยิงคู่กันไปเลย ชุด $in เดียวกัน
  const pendingPrCodes = data.pending.map((p) => p.prCode ?? "")
  const [requesters, detailIds] = await Promise.all([
    fetchRequesterByPr(client, pendingPrCodes),
    fetchPrDetailIdByPr(client, pendingPrCodes),
  ])
  for (const row of data.pending) {
    row.requester = (row.prCode && requesters.get(row.prCode)) || null
    row.prDetailId = (row.prCode && detailIds.get(row.prCode)) || null
  }
  return data
}
