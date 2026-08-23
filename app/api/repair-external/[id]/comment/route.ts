import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external_comment"
type Params = { params: Promise<{ id: string }> }

// GET /api/repair-external/[id]/comment — ความคิดเห็นของรายการนี้ (เก่า→ใหม่)
// แนบ canEdit มาด้วย: แก้ไข/ลบได้เฉพาะเจ้าของ — ให้ server ตัดสินสิทธิ์ ฝั่งหน้าเว็บไม่ต้องรู้อีเมลใคร
// (ความคิดเห็นเก่าที่ไม่มี byEmail จะแก้ไม่ได้ ซึ่งถูกแล้ว — พิสูจน์ความเป็นเจ้าของไม่ได้)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  const client  = await clientPromise
  const items   = await client.db(DB).collection(COLL)
    .find({ repairId: id })
    .sort({ at: 1 })
    .limit(500)
    .toArray()
  return NextResponse.json(
    items.map((c) => ({ ...c, canEdit: !!email && String(c.byEmail ?? "") === email })),
  )
}

// POST /api/repair-external/[id]/comment — ปิดแล้ว
// ข้อความลอย ๆ ไม่มีอีก: ทุกข้อความต้องมาพร้อมสถานะ ผ่าน POST /api/repair-external/[id]/update
// (คงเส้นทางไว้เพื่อบอกผู้เรียกเก่าให้ชัด แทนที่จะ 404 เฉย ๆ)
export async function POST() {
  return NextResponse.json(
    { error: "ตอนนี้ต้องอัพเดทงานพร้อมสถานะ — ใช้ POST /api/repair-external/[id]/update" },
    { status: 410 },
  )
}

// หาความคิดเห็นพร้อมตรวจว่าคนที่เรียกเป็นเจ้าของ — คืน error response ถ้าไม่ผ่าน
async function ownedComment(id: string, commentId: string) {
  if (!ObjectId.isValid(commentId)) {
    return { error: NextResponse.json({ error: "commentId ไม่ถูกต้อง" }, { status: 400 }) }
  }
  const session = await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  if (!email) return { error: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) }

  const col = (await clientPromise).db(DB).collection(COLL)
  const doc = await col.findOne({ _id: new ObjectId(commentId), repairId: id })
  if (!doc) return { error: NextResponse.json({ error: "ไม่พบความคิดเห็น" }, { status: 404 }) }
  if (String(doc.byEmail ?? "") !== email) {
    return { error: NextResponse.json({ error: "แก้ไข/ลบได้เฉพาะความคิดเห็นของตัวเอง" }, { status: 403 }) }
  }
  return { col, doc }
}

// PUT /api/repair-external/[id]/comment — แก้ข้อความ { commentId, text } (เจ้าของเท่านั้น)
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body   = await req.json().catch(() => ({}))
  const text   = String(body.text ?? "").trim()
  if (!text) return NextResponse.json({ error: "กรุณาพิมพ์ข้อความ" }, { status: 400 })

  const found = await ownedComment(id, String(body.commentId ?? "").trim())
  if (found.error) return found.error

  const editedAt = new Date()
  await found.col!.updateOne({ _id: found.doc!._id }, { $set: { text, editedAt } })
  return NextResponse.json({ ok: true, text, editedAt })
}

// DELETE /api/repair-external/[id]/comment — ลบ { commentId } (เจ้าของเท่านั้น)
// ลบความคิดเห็นหลัก = ลบข้อความตอบกลับที่ห้อยอยู่ด้วย ไม่งั้นจะเหลือ reply ลอยไม่มีต้นเรื่อง
// (หน้าเว็บเตือนจำนวนที่จะถูกลบก่อนยืนยัน)
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body   = await req.json().catch(() => ({}))
  const commentId = String(body.commentId ?? "").trim()

  const found = await ownedComment(id, commentId)
  if (found.error) return found.error

  const res = await found.col!.deleteMany({
    $or: [{ _id: found.doc!._id }, { repairId: id, parentId: commentId }],
  })
  return NextResponse.json({ ok: true, deleted: res.deletedCount })
}
