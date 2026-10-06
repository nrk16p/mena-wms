// lib/ap-search-db.ts
// ภาพรวมสำหรับค้นข้ามเดือน (/api/ap-tracking/search) + หัวใบ DD (/api/ap-tracking/[code]) — ฝั่งเซิร์ฟเวอร์เท่านั้น
// logic การค้นอยู่ที่ lib/ap-search-index.ts (ทดสอบได้ไม่ต้องต่อฐาน) · ไฟล์นี้แค่ดึง + แคช
//
// ดึงเฉพาะตอนมีคำขอที่ต้องใช้ (ไม่มีตั้งเวลา ไม่มีอุ่นเครื่องตอนเปิดหน้า) ผ่านแคชกลาง lib/shared-cache.ts
//   • atms.* (purchase_orders / purchase_requests / deposit_header) — pipeline ของ api-ncac เขียน (PR ทุกชม. · PO/DD ทุก 4 ชม.)
//     ไม่มีสัญญาณที่เชื่อได้ว่าข้อมูลเปลี่ยน (procurement_runs ถูกเขียน "หลัง" รอบดึงเสร็จ ระหว่างรอบข้อมูลเปลี่ยนไปแล้ว)
//     → สด 2 นาที · เสิร์ฟของเก่าระหว่างโหลดใหม่ได้ไม่เกิน 5 นาที
//   • master_data.ap_tracking — WMS เขียน → tag "ap" ล้างทันทีที่บันทึก (+ เพดานเวลาเดียวกัน เผื่อสคริปต์นอกเว็บ)
// ก้อนเกิน ~1.9MB (deposit_header ~19k ใบ) แคชกลางเก็บในหน่วยความจำของ instance เอง — การล้างด้วย tag ยังมีผล
import type { Db, Document } from "mongodb"
import clientPromise from "@/lib/mongo"
import { CACHE_TAGS, sharedCache } from "@/lib/shared-cache"
import {
  AP_SEARCH_PROJECTION, findDdHead, toDdRow, toPoRow, toPrRow, toTrackRow,
  type ApSearchIndex,
} from "@/lib/ap-search-index"

const MD = process.env.MONGO_DB ?? "master_data"
const FRESH_MS = 2 * 60_000
const MAX_STALE_MS = 5 * 60_000
const SCAN_MAX_MS = 20_000
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// ไล่ทั้ง collection ไม่ filter ไม่ sort = natural order เดียวกับ .find(regex).limit() เดิม (collscan)
// แปลงทีละแถวระหว่างอ่าน — ไม่ถือเอกสารดิบทั้งก้อนไว้ในหน่วยความจำ
async function scan<T>(db: Db, coll: string, projection: Document, toRow: (d: Document) => T | null): Promise<T[]> {
  const out: T[] = []
  for await (const d of db.collection(coll).find({}, { projection }).maxTimeMS(SCAN_MAX_MS)) {
    const r = toRow(d)
    if (r) out.push(r)
  }
  return out
}
const atms = async () => (await clientPromise).db("atms")

const getDdRows = () => sharedCache.get({
  key: "ap-search:dd", freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS,
  load: async () => scan(await atms(), "deposit_header", AP_SEARCH_PROJECTION.dds, toDdRow),
})

export async function getApSearchIndex(): Promise<ApSearchIndex> {
  const [tracks, pos, prs, dds] = await Promise.all([
    sharedCache.get({
      key: `ap-search:tracks:${MD}`, freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS, tags: [CACHE_TAGS.ap],
      load: async () => scan((await clientPromise).db(MD), "ap_tracking", AP_SEARCH_PROJECTION.tracks, toTrackRow),
    }),
    sharedCache.get({
      key: "ap-search:po", freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS,
      load: async () => scan(await atms(), "purchase_orders", AP_SEARCH_PROJECTION.pos, toPoRow),
    }),
    sharedCache.get({
      key: "ap-search:pr", freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS,
      load: async () => scan(await atms(), "purchase_requests", AP_SEARCH_PROJECTION.prs, toPrRow),
    }),
    getDdRows(),
  ])
  return { tracks, pos, prs, dds }
}

/** หัวใบ DD ที่ /api/ap-tracking/[code] ใช้ — depositId ดิบ · hasPo = if (head.purchase_order) ดิบ */
export type ApDepositHead = { depositId: unknown; hasPo: boolean; purchaseOrder: string; supplier: string }

/** = findOne({ deposit_code }) เดิม อ่านจากภาพรวม · ไม่เจอในภาพรวม (ใบใหม่กว่าภาพรวม) / deposit_id ชนิดแปลก /
 *  โหลดภาพรวมไม่สำเร็จ → อ่าน DB ตรงแบบเดิม (ไม่มีทางได้ "ไม่พบ" เพราะภาพรวมยังไม่ทันรอบ) */
export async function findDepositHead(atmsDb: Db, depositCode: string): Promise<ApDepositHead | null> {
  const rows = await getDdRows().catch((e) => {
    console.warn("[ap-search] โหลดภาพรวม deposit_header ไม่สำเร็จ — อ่านตรง:", e instanceof Error ? e.message : e)
    return null
  })
  const row = rows ? findDdHead(rows, depositCode) : null
  if (row && !row.oddId) return { depositId: row.depositId, hasPo: row.hasPo, purchaseOrder: row.purchaseOrder, supplier: row.supplier }
  const head = await atmsDb.collection("deposit_header").findOne(
    { deposit_code: depositCode },
    { projection: { _id: 0, deposit_id: 1, purchase_order: 1, supplier: 1 } },
  )
  return head
    ? { depositId: head.deposit_id, hasPo: Boolean(head.purchase_order), purchaseOrder: s(head.purchase_order), supplier: s(head.supplier) }
    : null
}
