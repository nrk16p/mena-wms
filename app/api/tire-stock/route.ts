import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { normStatus } from "@/lib/tire"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_stock"

// GET /api/tire-stock?branch=latkrabang&q=...&status=...&prCode=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&serials=a,b,c&limit=200
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch   = searchParams.get("branch")?.trim()   ?? ""
  const q        = searchParams.get("q")?.trim()        ?? ""
  const status   = searchParams.get("status")?.trim()   ?? ""
  const prCode   = searchParams.get("prCode")?.trim()   ?? ""
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? ""
  const dateTo   = searchParams.get("dateTo")?.trim()   ?? ""
  const serials  = searchParams.get("serials")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
  const limit    = Math.min(parseInt(searchParams.get("limit") ?? "500"), 2000)

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (branch) filter.branch = branch
  if (status) filter.status = status
  if (prCode) filter.prCode = { $regex: prCode, $options: "i" }
  if (dateFrom || dateTo) {
    filter.depositDate = {}
    if (dateFrom) filter.depositDate.$gte = dateFrom
    if (dateTo)   filter.depositDate.$lte = dateTo
  }
  if (serials.length > 0) filter.serialNo = { $in: serials }
  if (q) {
    filter["$or"] = [
      { prCode:      { $regex: q, $options: "i" } },
      { ddCode:      { $regex: q, $options: "i" } },
      { productCode: { $regex: q, $options: "i" } },
      { productName: { $regex: q, $options: "i" } },
      { serialNo:    { $regex: q, $options: "i" } },
      { brand:       { $regex: q, $options: "i" } },
      { tireSize:    { $regex: q, $options: "i" } },
      { tireModel:   { $regex: q, $options: "i" } },
    ]
  }

  const items = await col
    .find(filter)
    .sort({ depositDate: -1, prCode: 1 })
    .limit(limit)
    .toArray()

  return NextResponse.json(items)
}

// POST /api/tire-stock — add new tire stock record
export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.branch?.trim())   return NextResponse.json({ error: "branch is required" }, { status: 400 })
  if (!body.serialNo?.trim()) return NextResponse.json({ error: "กรุณาระบุ Serial No" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ branch: body.branch.trim(), serialNo: body.serialNo.trim() } as any)
  if (existing) return NextResponse.json({ error: `Serial No "${body.serialNo}" มีอยู่แล้วในสาขานี้` }, { status: 409 })

  const doc = {
    branch:      body.branch.trim(),
    prCode:      body.prCode      || "",
    ddCode:      body.ddCode      || "",
    depositDate: body.depositDate || "",
    productCode: body.productCode || "",
    productName: body.productName || "",
    serialNo:    body.serialNo.trim(),
    unitPrice:   Number(body.unitPrice) || 0,
    brand:       body.brand       || "",
    tireSize:    body.tireSize    || "",
    tireModel:   body.tireModel   || "",
    distance:    Number(body.distance) || 0,
    status:      normStatus(body.status),
    tireType:      body.tireType      || "",
    warrantyUntil: body.warrantyUntil || "",
    createdAt:   new Date(),
    updatedAt:   new Date(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
