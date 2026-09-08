// lib/price-compare-db.ts — ส่วนที่ต้องแตะ Mongo ของใบเทียบราคา
import type { Db, Document, Filter } from "mongodb"
import { ObjectId } from "mongodb"
import { docNoFor, counterKeyFor, isDocNo } from "./price-compare"

export const PC_COLL = "price_compare"
export const PC_COUNTER_COLL = "counters"

/** ใบเทียบราคาเปิดได้ทั้งด้วยเลขที่ (PC-YYMM-NNN) และ ObjectId (24-hex, fallback ของลิงก์เก่า) — อื่นๆ คืน null */
export function docFilter(key: string): Filter<Document> | null {
  if (isDocNo(key)) return { docNo: key }
  if (/^[0-9a-f]{24}$/i.test(key)) return { _id: new ObjectId(key) }
  return null
}

/** ออกเลขที่ PC-YYMM-NNN แบบ atomic — ลบใบแล้วเลขข้ามไป ไม่นำกลับมาใช้ */
export async function nextDocNo(db: Db, bkkDate: string): Promise<string> {
  const r = await db.collection<{ _id: string; seq: number }>(PC_COUNTER_COLL).findOneAndUpdate(
    { _id: counterKeyFor(bkkDate) },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  )
  if (!r || typeof r.seq !== "number") throw new Error("nextDocNo: counter update returned no document")
  return docNoFor(bkkDate, r.seq)
}
