import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"

const DB   = "datawarehouse"
const COLL = "master"
type Params = { params: Promise<{ id: string }> }

// PUT /api/tire-master/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json()

  const brand    = String(body.brand    ?? "").trim()
  const tireSize = String(body.tireSize ?? "").trim()
  if (!brand)    return NextResponse.json({ error: "กรุณาระบุยี่ห้อยาง" }, { status: 400 })
  if (!tireSize) return NextResponse.json({ error: "กรุณาระบุขนาดยาง" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const tireModel = String(body.tireModel ?? "").trim()
  const tireType  = String(body.tireType  ?? "").trim()

  // guard against creating a duplicate key on another document
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dup = await col.findOne({ brand, tireSize, tireModel, tireType, _id: { $ne: new ObjectId(id) } } as any)
  if (dup) return NextResponse.json({ error: "มีรายการ Master นี้อยู่แล้ว (ยี่ห้อ + ขนาด + รุ่น + ประเภทซ้ำ)" }, { status: 409 })

  const standardDistance = Number(body.standardDistance) || 0
  const standardPrice    = Number(body.standardPrice)    || 0
  const update = {
    brand, tireSize, tireModel, tireType,
    standardDistance,
    standardPrice,
    standardTreadMm:   Number(body.standardTreadMm) || 0,
    standardBahtPerKm: standardDistance > 0 ? standardPrice / standardDistance : 0,
    note:    String(body.note ?? "").trim(),
    active:  body.active !== false,
    updatedAt: new Date(),
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set: update })
  return NextResponse.json({ ok: true })
}

// DELETE /api/tire-master/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  await col.deleteOne({ _id: new ObjectId(id) })
  return NextResponse.json({ ok: true })
}
