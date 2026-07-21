import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external_comment"
type Params = { params: Promise<{ id: string }> }

// GET /api/repair-external/[id]/comment — ความคิดเห็นของรายการนี้ (เก่า→ใหม่)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const client = await clientPromise
  const items  = await client.db(DB).collection(COLL)
    .find({ repairId: id })
    .sort({ at: 1 })
    .limit(500)
    .toArray()
  return NextResponse.json(items)
}

// POST /api/repair-external/[id]/comment — เพิ่มความคิดเห็น { text, parentId? }
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body   = await req.json()
  const text   = String(body.text ?? "").trim()
  if (!text) return NextResponse.json({ error: "กรุณาพิมพ์ข้อความ" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const client  = await clientPromise
  const col     = client.db(DB).collection(COLL)

  const doc = {
    repairId: id,
    parentId: body.parentId ? String(body.parentId) : null,
    text,
    by:      session?.user?.name  || "",
    byEmail: session?.user?.email || "",
    at:      new Date(),
  }
  const result = await col.insertOne(doc)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
