import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { ObjectId } from "mongodb"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"

// PATCH /api/tire-mr/[id] — admin updates status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { status, note, updatedBy } = body

  if (!status) return NextResponse.json({ error: "status required" }, { status: 400 })

  let _id: ObjectId
  try { _id = new ObjectId(id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  const db = client.db(DB)
  const now = new Date()

  const logEntry = { status, note: note ?? "", updatedBy: updatedBy ?? "", updatedAt: now }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.collection(COL).updateOne({ _id }, { $set: { status, updatedAt: now }, $push: { logs: logEntry } as any })

  if (result.matchedCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/tire-mr/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let _id: ObjectId
  try { _id = new ObjectId(id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  const db = client.db(DB)
  await db.collection(COL).deleteOne({ _id })
  return NextResponse.json({ ok: true })
}
