import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

// GET /api/sku/[id]
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await clientPromise
  const doc    = await client.db(DB).collection(COLL).findOne({ SKU: id })
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(doc)
}

// PUT /api/sku/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const body    = await req.json()
  const client  = await clientPromise
  const col     = client.db(DB).collection(COLL)

  const noPrice = ["LAB", "SVC", "CLN", "TRP", "ACC"].includes(body.ประเภทค่าใช้จ่าย ?? "")

  const update: Record<string, unknown> = {
    ชื่ออะไหล่_TH:    body.ชื่ออะไหล่_TH    ?? "",
    Part_Name_EN:      body.Part_Name_EN      ?? "",
    เบอร์อะไหล่:       body.เบอร์อะไหล่       ?? "",
    ตำแหน่ง:           body.ตำแหน่ง           ?? "GN",
    ราคาต่อหน่วย:      noPrice ? 0 : (parseFloat(body.ราคาต่อหน่วย) || 0),
    หน่วย:             body.หน่วย             ?? "PC",
    ยี่ห้อ:            body.ยี่ห้อ            ?? "",
    เบอร์แท้อ้างอิง:   body.เบอร์แท้อ้างอิง   ?? "",
    เบอร์เทียบอ้างอิง: body.เบอร์เทียบอ้างอิง ?? "",
    ทะเบียนหรือรุ่นรถ: body.ทะเบียนหรือรุ่นรถ ?? "",
    Grade:             body.Grade             ?? "NA",
    รหัสATMS:          Array.isArray(body.รหัสATMS) ? body.รหัสATMS : (body.รหัสATMS ? [body.รหัสATMS] : []),
    updatedAt:         new Date(),
  }

  const result = await col.updateOne({ SKU: id }, { $set: update })
  if (result.matchedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/sku/[id]
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const client  = await clientPromise
  const result  = await client.db(DB).collection(COLL).deleteOne({ SKU: id })
  if (result.deletedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
