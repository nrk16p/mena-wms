import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function GET() {
  const client = await clientPromise
  const docs = await client.db(DB).collection(COLL)
    .find({})
    .sort({ brand: 1, tireSize: 1, tireModel: 1 })
    .toArray()
  return NextResponse.json(docs)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const brand     = String(body.brand     ?? "").trim()
  const tireSize  = String(body.tireSize  ?? "").trim()
  const tireModel = String(body.tireModel ?? "").trim()
  const distance  = Number(body.distance) || 0

  if (!brand)        return NextResponse.json({ error: "กรุณาระบุยี่ห้อ" },    { status: 400 })
  if (!tireSize)     return NextResponse.json({ error: "กรุณาระบุขนาดยาง" }, { status: 400 })
  if (!tireModel)    return NextResponse.json({ error: "กรุณาระบุรุ่นยาง" },  { status: 400 })
  if (distance <= 0) return NextResponse.json({ error: "กรุณาระบุระยะทาง" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ brand, tireSize, tireModel } as any)
  if (existing) return NextResponse.json({ error: `สเปค ${brand} ${tireSize} ${tireModel} มีอยู่แล้ว` }, { status: 409 })

  const doc = {
    brand, tireSize, tireModel, distance,
    productCode: String(body.productCode ?? "").trim(),
    productName: String(body.productName ?? "").trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
