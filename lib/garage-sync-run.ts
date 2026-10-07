// lib/garage-sync-run.ts
// รอบ sync อู่ Mena-Next → WMS (ผ่าน timeline) — ตัวเรียกหลักคือ "ผู้ใช้ WMS ที่เปิดหน้าอยู่" (ผู้ใช้กำหนด 07/10/2569)
// ทุกแท็บที่เปิดดูอยู่ส่งสัญญาณทุก 2 นาที → ล็อกกลางใน Mongo ให้ทำงานจริงได้ไม่เกิน 1 รอบต่อ 2 นาที ไม่ว่าเปิดกี่คน
// ไม่มีใครเปิด = ไม่ sync · cron รายวัน (tire-sync) เรียก force เป็นตัวสำรอง
import type { Db } from "mongodb"
import { followNextGarages } from "@/lib/garage-mapping"
import { nextVendorsForOpenWms } from "@/lib/next-job-map"
import { DONE_STATUSES } from "@/lib/repair-external"

const LOCK_COLL = "sync_locks"
const LOCK_ID   = "garage-sync"
export const GARAGE_SYNC_EVERY_MS = 2 * 60 * 1000
const STUCK_MS  = 10 * 60 * 1000   // รอบที่ค้าง (function ถูกตัด) — ปล่อยล็อกหลัง 10 นาที

/** จองรอบ — true = ได้สิทธิ์ทำรอบนี้ (ไม่มีใครทำใน 2 นาทีที่ผ่านมา และไม่มีรอบที่กำลังทำอยู่) */
export async function claimGarageSync(db: Db, force = false): Promise<boolean> {
  const now = new Date()
  const due = new Date(now.getTime() - GARAGE_SYNC_EVERY_MS)
  const stuck = new Date(now.getTime() - STUCK_MS)
  try {
    const r = await db.collection<{ _id: string }>(LOCK_COLL).findOneAndUpdate(
      force ? { _id: LOCK_ID } : {
        _id: LOCK_ID,
        $and: [
          { $or: [{ startedAt: { $lt: due } }, { startedAt: { $exists: false } }] },
          { $or: [{ running: { $ne: true } }, { startedAt: { $lt: stuck } }] },
        ],
      },
      { $set: { startedAt: now, running: true } },
      { upsert: true, returnDocument: "after" },
    )
    return !!r
  } catch (e) {
    // upsert ชนกับเอกสารที่มีอยู่ (เงื่อนไขไม่ผ่าน) = มีคนทำไปแล้ว
    if ((e as { code?: number }).code === 11000) return false
    throw e
  }
}

/** ทำรอบ sync (เรียกหลัง claim สำเร็จ) — บันทึกผลไว้ในล็อกให้ดูย้อนหลังได้ */
export async function runGarageSync(db: Db) {
  const t0 = Date.now()
  let result: { checked: number; followed: number; error?: string }
  try {
    const items = await nextVendorsForOpenWms(db, "repair_external", DONE_STATUSES)
    const done = await followNextGarages(db, items)
    result = { checked: items.length, followed: done.length }
  } catch (e) {
    result = { checked: 0, followed: 0, error: e instanceof Error ? e.message : String(e) }
  }
  await db.collection<{ _id: string }>(LOCK_COLL).updateOne({ _id: LOCK_ID }, { $set: { running: false, finishedAt: new Date(), ms: Date.now() - t0, last: result } })
  return result
}
