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

// POST /api/garage-master — เพิ่มอู่ใหม่ (กันชื่อซ้ำแบบ case-insensitive)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const name = String(body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "กรุณาระบุชื่ออู่" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const existing = await col.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } })
  if (existing) return NextResponse.json(existing)

  const doc    = { name, createdAt: new Date() }
  const result = await col.insertOne(doc)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
