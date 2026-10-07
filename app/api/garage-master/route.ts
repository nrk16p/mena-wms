import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "garage_master"

// GET /api/garage-master[?withCounts=1] — รายชื่ออู่ทั้งหมด (+ จำนวนที่ใช้งานใน repair_external)
export async function GET(req: NextRequest) {
  const withCounts = req.nextUrl.searchParams.get("withCounts") === "1"
  const client = await clientPromise
  const db     = client.db(DB)
  const items  = await db.collection(COLL).find({}).sort({ name: 1 }).toArray()
  if (!withCounts) return NextResponse.json(items)

  const agg = await db.collection("repair_external").aggregate([
    { $match: { garage: { $ne: "" } } },
    { $group: { _id: "$garage", n: { $sum: 1 } } },
  ]).toArray()
  const countByName = new Map(agg.map((g) => [g._id as string, g.n as number]))
  return NextResponse.json(items.map((it) => ({ ...it, count: countByName.get(it.name as string) || 0 })))
}

// POST /api/garage-master — ปิดแล้ว (07/10/2569): ชื่ออู่ใช้ซัพพลายเออร์ใน ATMS เท่านั้น ไม่เพิ่มชื่อเองอีก
// (garage_master เก็บไว้อ่านอย่างเดียวเป็นประวัติ)
export async function POST() {
  return NextResponse.json({ error: "เพิ่มอู่เองไม่ได้แล้ว — ให้จัดซื้อเพิ่มซัพพลายเออร์ใน ATMS (ขึ้นในรายการวันถัดไป)" }, { status: 410 })
}
