import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { normStatus } from "@/lib/tire"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_stock"
type Params = { params: Promise<{ id: string }> }

// PUT /api/tire-stock/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json()

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const update = {
    prCode:      body.prCode      ?? "",
    ddCode:      body.ddCode      ?? "",
    depositDate: body.depositDate ?? "",
    productCode: body.productCode ?? "",
    productName: body.productName ?? "",
    serialNo:    body.serialNo    ?? "",
    unitPrice:   Number(body.unitPrice) || 0,
    brand:       body.brand       ?? "",
    tireSize:    body.tireSize    ?? "",
    tireModel:   body.tireModel   ?? "",
    distance:    Number(body.distance) || 0,
    status:      normStatus(body.status),
    tireType:      body.tireType      ?? "",
    warrantyUntil: body.warrantyUntil ?? "",
    updatedAt:   new Date(),
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set: update })
  return NextResponse.json({ ok: true })
}

// DELETE /api/tire-stock/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  await col.deleteOne({ _id: new ObjectId(id) })
  return NextResponse.json({ ok: true })
}
