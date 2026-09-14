import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"
const SNOOZE_DAYS = 30

type Params = { params: Promise<{ id: string }> }

// PATCH /api/tire-due/[id]  body { snooze: true | false }
// พักการแจ้งเตือนยางเส้นนั้น 30 วัน — ยางเส้นที่รู้อยู่แล้วว่ายังวิ่งต่อได้
// จะได้ไม่ค้างอยู่บน badge จนคนเลิกสนใจตัวเลข
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const until = body.snooze === false ? null : new Date(Date.now() + SNOOZE_DAYS * 86_400_000)

  const client = await clientPromise
  const res = await client.db(DB).collection("tire_distance")
    .updateOne({ _id: new ObjectId(id) }, { $set: { snoozedUntil: until } })

  if (!res.matchedCount) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })
  return NextResponse.json({ ok: true, snoozedUntil: until })
}
