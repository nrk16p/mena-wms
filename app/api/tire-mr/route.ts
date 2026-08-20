import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { MR_LABEL, type MrStatus } from "@/lib/tire-mr"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"

// GET /api/tire-mr?branch=xxx&plate=yyy — ประวัติ MR ของทะเบียน (ใหม่ → เก่า) พร้อม logs
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const plate  = searchParams.get("plate")?.trim()  ?? ""

  const client = await clientPromise
  const db = client.db(DB)
  const filter: Record<string, string> = {}
  if (branch) filter.branch = branch
  if (plate)  filter.plate  = plate

  const rows = await db.collection(COL).find(filter).sort({ createdAt: -1 }).limit(100).toArray()
  return NextResponse.json(rows)
}

// POST /api/tire-mr — admin creates MR
export async function POST(req: NextRequest) {
  // เปิดให้ทุกคนที่ล็อกอิน — คนเดียวกับที่กดอนุมัติยางในแท็บคำขอ/อนุมัติ (ซึ่งไม่จำกัดแอดมิน)
  // เป็นคนเดินเรื่องซ่อมด้วย ถ้าล็อกไว้เฉพาะแอดมินจะปิด MR ไม่ได้ทั้งที่อนุมัติยางได้
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { branch, plate, requestId, note } = body
  if (!branch || !plate) return NextResponse.json({ error: "branch and plate required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)
  const plateTrim = String(plate).trim()

  // กันเปิดใบซ้ำ — ทะเบียนเดียวมีใบที่ยังไม่ปิดได้ทีละใบ (การอนุมัติยางอ่านใบล่าสุดใบเดียว
  // ถ้าเปิดซ้อนกัน ใบเก่าจะถูกทิ้งค้างโดยไม่มีใครเห็น)
  const open = await db.collection(COL).findOne(
    { branch, plate: plateTrim, status: { $ne: "completed" } },
    { sort: { createdAt: -1 } },
  )
  if (open) {
    return NextResponse.json(
      { error: `ทะเบียน ${plateTrim} มี MR ที่ยัง "${MR_LABEL[open.status as MrStatus] ?? open.status}" อยู่แล้ว`, mrId: String(open._id) },
      { status: 409 },
    )
  }

  const now = new Date()
  const user = session.user?.name ?? session.user?.email ?? ""
  const noteText = String(note ?? "").trim()
  const doc = {
    branch,
    plate:     plateTrim,
    requestId: requestId ?? null,
    status:    "pending",
    note:      noteText,
    createdBy: user,
    updatedBy: user,
    createdAt: now,
    updatedAt: now,
    logs: [{ status: "pending", note: noteText, updatedBy: user, updatedAt: now }],
  }

  const result = await db.collection(COL).insertOne(doc)
  return NextResponse.json({ _id: result.insertedId, ...doc }, { status: 201 })
}
