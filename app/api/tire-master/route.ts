import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

// Master reference data for tires lives in its own warehouse DB
const DB   = "datawarehouse"
const COLL = "master"

const SORTABLE = new Set([
  "brand", "tireSize", "tireModel", "tireType",
  "standardDistance", "standardPrice", "standardBahtPerKm", "updatedAt",
])

// GET /api/tire-master?page=1&limit=50&q=&brand=&tireType=&sortBy=brand&sortDir=asc
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q        = searchParams.get("q")?.trim()        ?? ""
  const brand    = searchParams.get("brand")?.trim()    ?? ""
  const tireType = searchParams.get("tireType")?.trim() ?? ""
  const sortByRaw  = searchParams.get("sortBy")  ?? "brand"
  const sortBy     = SORTABLE.has(sortByRaw) ? sortByRaw : "brand"
  const sortDir    = searchParams.get("sortDir") === "desc" ? -1 : 1
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")))

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (brand)    filter.brand    = brand
  if (tireType) filter.tireType = tireType
  if (q) {
    filter["$or"] = [
      { brand:     { $regex: q, $options: "i" } },
      { tireSize:  { $regex: q, $options: "i" } },
      { tireModel: { $regex: q, $options: "i" } },
      { note:      { $regex: q, $options: "i" } },
    ]
  }

  const total = await col.countDocuments(filter)
  const items = await col
    .find(filter)
    .sort({ [sortBy]: sortDir, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray()

  // distinct brands for the filter dropdown (unfiltered, so options stay stable)
  const brands = (await col.distinct("brand")).filter(Boolean).sort()

  return NextResponse.json({ total, page, limit, items, brands })
}

// POST /api/tire-master — create a master entry
export async function POST(req: NextRequest) {
  const body = await req.json()
  const brand    = String(body.brand    ?? "").trim()
  const tireSize = String(body.tireSize ?? "").trim()
  if (!brand)    return NextResponse.json({ error: "กรุณาระบุยี่ห้อยาง" }, { status: 400 })
  if (!tireSize) return NextResponse.json({ error: "กรุณาระบุขนาดยาง" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const tireModel = String(body.tireModel ?? "").trim()
  const tireType  = String(body.tireType  ?? "").trim()

  // a master record is unique per brand + size + model + type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dup = await col.findOne({ brand, tireSize, tireModel, tireType } as any)
  if (dup) return NextResponse.json({ error: "มีรายการ Master นี้อยู่แล้ว (ยี่ห้อ + ขนาด + รุ่น + ประเภทซ้ำ)" }, { status: 409 })

  const standardDistance = Number(body.standardDistance) || 0
  const standardPrice    = Number(body.standardPrice)    || 0
  const doc = {
    brand, tireSize, tireModel, tireType,
    standardDistance,
    standardPrice,
    standardTreadMm:    Number(body.standardTreadMm) || 0,
    standardBahtPerKm:  standardDistance > 0 ? standardPrice / standardDistance : 0,
    note:    String(body.note ?? "").trim(),
    active:  body.active !== false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
