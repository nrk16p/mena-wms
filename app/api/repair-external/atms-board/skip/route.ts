import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { NEXT_SKIP_COLL, isNextSkipReason, nextSkipUntil, normKey } from "@/lib/atms-board"
import { bkkToday } from "@/lib/bkk-time"

const DB = process.env.MONGO_DB ?? "master_data"

// POST /api/repair-external/atms-board/skip  { plate, trucknum, mrCode, since, reason }
// ตัดคันที่ "ขาดในระบบ" ออกจากการเทียบ Mena-Next ชั่วคราว (แย๊กโม่ / ซ่อมเสร็จ) — ดูกติกาที่ findActiveSkip
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  const by      = session.user?.name || session.user?.email || ""
  const byEmail = session.user?.email || ""

  const body = await req.json().catch(() => ({}))
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const plate = str(body.plate), trucknum = str(body.trucknum), mrCode = str(body.mrCode), since = str(body.since)
  if (!isNextSkipReason(body.reason)) return NextResponse.json({ ok: false, error: "เหตุผลไม่ถูกต้อง" }, { status: 400 })
  if (!normKey(plate) && !normKey(trucknum)) return NextResponse.json({ ok: false, error: "ไม่มีทะเบียน/เบอร์รถ" }, { status: 400 })

  const today = bkkToday()
  const now   = new Date().toISOString()
  const coll  = (await clientPromise).db(DB).collection(NEXT_SKIP_COLL)
  // กดซ้ำคันเดิมรอบเดิม → ปิดรายการเก่าก่อน ให้เหลือรายการที่ยังใช้อยู่รายการเดียว (กดยกเลิกแล้วหายจริง)
  await coll.updateMany(
    { plate, trucknum, mrCode, cancelledAt: null, until: { $gte: today } },
    { $set: { cancelledAt: now, cancelledBy: by, cancelNote: "กดใหม่แทน" } },
  )
  const doc = { plate, trucknum, mrCode, since, reason: body.reason, by, byEmail, at: now, until: nextSkipUntil(today), cancelledAt: null }
  const { insertedId } = await coll.insertOne(doc)
  return NextResponse.json({ ok: true, id: String(insertedId), until: doc.until })
}

// DELETE /api/repair-external/atms-board/skip?id=  — ยกเลิกการตัด (เก็บรายการไว้ดูย้อนหลัง ไม่ลบจริง)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  const id = req.nextUrl.searchParams.get("id") ?? ""
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 })

  const coll = (await clientPromise).db(DB).collection(NEXT_SKIP_COLL)
  const res = await coll.updateOne(
    { _id: new ObjectId(id), cancelledAt: null },
    { $set: { cancelledAt: new Date().toISOString(), cancelledBy: session.user?.name || session.user?.email || "" } },
  )
  if (!res.matchedCount) return NextResponse.json({ ok: false, error: "ไม่พบรายการ หรือยกเลิกไปแล้ว" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
