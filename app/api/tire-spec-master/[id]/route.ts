import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { ObjectId } from "mongodb"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const brand     = String(body.brand     ?? "").trim()
  const tireSize  = String(body.tireSize  ?? "").trim()
  const tireModel = String(body.tireModel ?? "").trim()
  const distance  = Number(body.distance) || 0

  if (!brand || !tireSize || !tireModel || distance <= 0)
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 })

  let oid: ObjectId
  try { oid = new ObjectId(id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const update = {
    brand, tireSize, tireModel, distance,
    productCode: String(body.productCode ?? "").trim(),
    productName: String(body.productName ?? "").trim(),
    updatedAt: new Date(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.updateOne({ _id: oid } as any, { $set: update })
  return NextResponse.json({ _id: id, ...update })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let oid: ObjectId
  try { oid = new ObjectId(id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.db(DB).collection(COLL).deleteOne({ _id: oid } as any)
  return NextResponse.json({ ok: true })
}
