// ===========================================================================
// สถิติยางเกิน/ถึงกำหนดรายวัน — เก็บไว้ดูแนวโน้มบน Dashboard ยาง
// ===========================================================================
// tire_distance เป็น "ภาพล่าสุด" (คำนวณทับทุกคืน ยางที่ถอดแล้วถูกลบ) ย้อนดูเมื่อวานไม่ได้
// จึงถ่ายยอดเก็บลง tire_due_daily วันละ 1 เอกสาร (รอบคำนวณหลังสุดของวันทับรอบก่อน)
// เก็บแบบสรุปตามมิติที่ Slicer ใช้ — หน้าเว็บกรองกราฟตามตัวกรองเดียวกับตารางได้
//
//   { _id: "YYYY-MM-DD" (เวลาไทย), at, groups: [[branch, unit, plant, fleet, vehicleType, product, level, count]] }
//   เก็บเฉพาะ over / due / warn — ยางปกติไม่ต้องใช้ดูแนวโน้มงานค้าง

import type { Db } from "mongodb"
import { BKK_OFFSET_MS } from "@/lib/bkk-time"

export const DAILY_COLLECTION = "tire_due_daily"

export type DailyGroup = [string, string, string, string, string, string, string, number]
export type DailySnapshot = { _id: string; at: Date; groups: DailyGroup[] }

export const bkkDay = (d: Date | string | number) =>
  new Date(new Date(d).getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10)

export async function snapshotTireDue(db: Db, now = new Date()): Promise<number> {
  const rows = await db.collection("tire_distance").aggregate<{ _id: Record<string, string>; n: number }>([
    { $match: { isSpare: { $ne: true }, level: { $in: ["over", "due", "warn"] } } },
    {
      $group: {
        _id: {
          b: "$branch", u: "$unit", p: { $trim: { input: { $ifNull: ["$plant", ""] } } },
          f: { $trim: { input: { $ifNull: ["$fleet", ""] } } },
          v: { $trim: { input: { $ifNull: ["$vehicleType", ""] } } },
          r: { $trim: { input: { $ifNull: ["$product", ""] } } }, l: "$level",
        },
        n: { $sum: 1 },
      },
    },
  ]).toArray()
  const groups: DailyGroup[] = rows.map((g) => [
    g._id.b ?? "", g._id.u ?? "head", g._id.p ?? "", g._id.f ?? "", g._id.v ?? "", g._id.r ?? "", g._id.l, g.n,
  ])
  await db.collection<DailySnapshot>(DAILY_COLLECTION).updateOne(
    { _id: bkkDay(now) },
    { $set: { at: now, groups } },
    { upsert: true },
  )
  return groups.length
}
