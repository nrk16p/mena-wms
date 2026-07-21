import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "garage_master"
type Params = { params: Promise<{ id: string }> }

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// PUT /api/garage-master/[id] — เปลี่ยนชื่ออู่ + อัปเดตชื่อในเรคคอร์ดซ่อมที่ใช้อยู่ (cascade)
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body    = await req.json()
  const newName = String(body.name ?? "").trim()
  if (!newName) return NextResponse.json({ error: "กรุณาระบุชื่ออู่" }, { status: 400 })

  const client = await clientPromise
  const db     = client.db(DB)
  const col    = db.collection(COLL)

  const existing = await col.findOne({ _id: new ObjectId(id) })
  if (!existing) return NextResponse.json({ error: "ไม่พบอู่" }, { status: 404 })

  // กันชื่อซ้ำกับอู่อื่น
  const dup = await col.findOne({ _id: { $ne: new ObjectId(id) }, name: { $regex: `^${escapeRegex(newName)}$`, $options: "i" } })
  if (dup) return NextResponse.json({ error: `มีอู่ชื่อ "${newName}" อยู่แล้ว` }, { status: 409 })

  const oldName = existing.name as string
  await col.updateOne({ _id: new ObjectId(id) }, { $set: { name: newName, updatedAt: new Date() } })

  let cascaded = 0
  if (oldName && oldName !== newName) {
    const r = await db.collection("repair_external").updateMany({ garage: oldName }, { $set: { garage: newName } })
    cascaded = r.modifiedCount
  }
  return NextResponse.json({ ok: true, cascaded })
}

// DELETE /api/garage-master/[id] — ลบอู่ออกจาก master (เรคคอร์ดซ่อมยังเก็บชื่อเดิมไว้)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const client = await clientPromise
  await client.db(DB).collection(COLL).deleteOne({ _id: new ObjectId(id) })
  return NextResponse.json({ ok: true })
}
