import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { SNOOZE_DAYS } from "@/lib/tire-due"

const DB = process.env.MONGO_DB ?? "master_data"

type Params = { params: Promise<{ id: string }> }

// PATCH /api/tire-due/[id]
//   body { snooze: true,  by?: "ชื่อคนกด", note?: "เหตุผล" }  → เงียบ 14 วัน
//   body { snooze: false }                                   → ยกเลิกการเลื่อน
//
// ใช้ทั้งปุ่มบนเว็บและแอปคนขับ: คนขับที่ไปดูของจริงแล้วเห็นว่าดอกยางยังเหลือ
// เลื่อนเองได้เลยไม่ต้องรออนุมัติ — แต่บันทึกไว้ว่าใครเลื่อนเพราะอะไร
// ไม่งั้นยางที่ถูกเลื่อนซ้ำ ๆ จะหายไปจากเรดาร์โดยไม่มีใครรับผิดชอบ
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const on   = body.snooze !== false
  const now  = new Date()

  const update = on
    ? {
        snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * 86_400_000),
        snoozedAt:    now,
        snoozedBy:    String(body.by ?? "").trim(),
        snoozedNote:  String(body.note ?? "").trim(),
      }
    : { snoozedUntil: null, snoozedAt: null, snoozedBy: "", snoozedNote: "" }

  const client = await clientPromise
  const res = await client.db(DB).collection("tire_distance")
    .updateOne({ _id: new ObjectId(id) }, { $set: update })

  if (!res.matchedCount) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })
  return NextResponse.json({ ok: true, snoozeDays: on ? SNOOZE_DAYS : 0, ...update })
}
