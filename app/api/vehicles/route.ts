import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "vehicle_master"

// GET /api/vehicles?q=สบ71&type=Mixer&limit=50&groups=true
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q      = searchParams.get("q")?.trim()     ?? ""
  const type   = searchParams.get("type")?.trim()  ?? ""
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500)
  const groups = searchParams.get("groups") === "true"
  const plates = searchParams.get("plates")?.split(",").map((p) => p.trim()).filter(Boolean) ?? []

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // Batch fetch by specific plates
  if (plates.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = await col.find({ plate: { $in: plates } } as any)
      .project({ plate: 1, fleetNo: 1, fleet: 1, brand: 1, model: 1, vehicleType: 1, fuelType: 1, year: 1, engineNo: 1, chassisNo: 1 })
      .toArray()
    return NextResponse.json(items)
  }

  // Return vehicle type groups with counts
  if (groups) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchStage: Record<string, any> = {}
    if (q) matchStage.vehicleType = { $regex: q, $options: "i" }

    const agg = await col.aggregate([
      { $match: matchStage },
      { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray()

    return NextResponse.json(agg.filter((g) => g._id).map((g) => ({ vehicleType: g._id as string, count: g.count as number })))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}

  if (q) {
    filter["$or"] = [
      { plate:       { $regex: q, $options: "i" } },
      { fleetNo:     { $regex: q, $options: "i" } },
      { brand:       { $regex: q, $options: "i" } },
      { model:       { $regex: q, $options: "i" } },
      { engineNo:    { $regex: q, $options: "i" } },
      { chassisNo:   { $regex: q, $options: "i" } },
      { vehicleType: { $regex: q, $options: "i" } },
    ]
  }
  if (type) filter.vehicleType = { $regex: type, $options: "i" }

  const items = await col
    .find(filter)
    .sort({ vehicleType: 1, plate: 1 })
    .limit(limit)
    .project({ plate: 1, fleetNo: 1, fleet: 1, brand: 1, model: 1, vehicleType: 1, fuelType: 1, year: 1, branch: 1, engineNo: 1, chassisNo: 1, isTrailer: 1, hasPump: 1 })
    .toArray()

  return NextResponse.json(items)
}

// POST /api/vehicles — add new vehicle
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { plate } = body
  if (!plate?.trim()) return NextResponse.json({ error: "plate is required" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ plate: plate.trim() } as any)
  if (existing) return NextResponse.json({ error: `ทะเบียน ${plate} มีอยู่แล้ว` }, { status: 409 })

  const doc = {
    plate:        plate.trim(),
    fleetNo:      body.fleetNo      || "",
    fleet:        body.fleet        || "",
    brand:        body.brand        || "",
    branch:       body.branch       || "",
    vehicleType:  body.vehicleType  || "",
    vehicleTypeExtra: body.vehicleTypeExtra || "",
    model:        body.model        || "",
    engineNo:     body.engineNo     || "",
    chassisNo:    body.chassisNo    || "",
    fuelType:     body.fuelType     || "",
    year:         body.year         || "",
    ownership:    body.ownership    || "",
    project:      body.project      || "",
    plant:        body.plant        || "",
    hasPump:      !!body.hasPump,
    isTrailer:    !!body.isTrailer,
    note:         body.note         || "",
    createdAt:    new Date(),
    updatedAt:    new Date(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.insertOne(doc as any)
  return NextResponse.json(doc, { status: 201 })
}
