import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { buildDoc } from "../route"
import { diffRepair, writeRepairLog } from "@/lib/repair-log"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }

// GET /api/repair-external/[id] — ดึงรายการเดียว (สำหรับลิงก์แชร์ ?id=)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const client = await clientPromise
  const doc    = await client.db(DB).collection(COLL).findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })
  return NextResponse.json(doc)
}

// PUT /api/repair-external/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json()
  const doc  = buildDoc(body)

  const session = await getServerSession(authOptions)
  const client  = await clientPromise
  const db      = client.db(DB)
  const col     = db.collection(COLL)

  const existing = await col.findOne({ _id: new ObjectId(id) })
  if (!existing) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })

  // ล็อกสถานะ "รถเสร็จ" — เปลี่ยน/ย้อนสถานะกลับไม่ได้เมื่อปิดงานแล้ว
  if (String(existing.status ?? "") === "รถเสร็จ" && doc.status !== "รถเสร็จ") {
    return NextResponse.json({ error: "รายการที่ซ่อมเสร็จแล้ว ย้อนสถานะกลับไม่ได้" }, { status: 409 })
  }

  const changes = diffRepair(existing, doc)
  const now = new Date()
  // อัปเดตวันเข้าสถานะเมื่อสถานะเปลี่ยนเท่านั้น (ไว้คำนวณ "ค้างในสถานะกี่วัน")
  const statusChanged = String(existing.status ?? "") !== doc.status
  const statusSince = statusChanged ? now.toISOString().slice(0, 10) : (existing.statusSince ?? "")
  const editedBy = session?.user?.name || session?.user?.email || existing.editedBy || ""
  await col.updateOne({ _id: new ObjectId(id) }, { $set: { ...doc, statusSince, editedBy, updatedAt: now } })

  // บันทึก log เฉพาะเมื่อมีการเปลี่ยนแปลงจริง
  if (changes.length > 0) {
    const sc = changes.find((c) => c.field === "status")
    await writeRepairLog(db, {
      repairId: id,
      plate: doc.plate, fleetNo: doc.fleetNo,
      action: "update",
      by:      session?.user?.name  || "",
      byEmail: session?.user?.email || "",
      at: now,
      statusChange: sc ? { from: sc.from, to: sc.to } : undefined,
      changes,
    })
  }
  return NextResponse.json({ ok: true, changed: changes.length })
}

// DELETE /api/repair-external/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const client  = await clientPromise
  const db      = client.db(DB)
  const col     = db.collection(COLL)

  const existing = await col.findOne({ _id: new ObjectId(id) })
  await col.deleteOne({ _id: new ObjectId(id) })
  if (existing) {
    await writeRepairLog(db, {
      repairId: id,
      plate: existing.plate ?? "", fleetNo: existing.fleetNo ?? "",
      action: "delete",
      by:      session?.user?.name  || "",
      byEmail: session?.user?.email || "",
      at: new Date(),
    })
  }
  return NextResponse.json({ ok: true })
}
