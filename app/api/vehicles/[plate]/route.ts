import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "vehicle_master"
type Params = { params: Promise<{ plate: string }> }

// GET /api/vehicles/[plate]
export async function GET(_req: NextRequest, { params }: Params) {
  const { plate } = await params
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await col.findOne({ plate: decodeURIComponent(plate) } as any)
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(doc)
}

// PUT /api/vehicles/[plate]
export async function PUT(req: NextRequest, { params }: Params) {
  const { plate } = await params
  const body = await req.json()
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const update = {
    fleetNo:      body.fleetNo      ?? "",
    fleet:        body.fleet        ?? "",
    brand:        body.brand        ?? "",
    branch:       body.branch       ?? "",
    vehicleType:  body.vehicleType  ?? "",
    vehicleTypeExtra: body.vehicleTypeExtra ?? "",
    model:        body.model        ?? "",
    engineNo:     body.engineNo     ?? "",
    chassisNo:    body.chassisNo    ?? "",
    fuelType:     body.fuelType     ?? "",
    year:         body.year         ?? "",
    ownership:    body.ownership    ?? "",
    project:      body.project      ?? "",
    plant:        body.plant        ?? "",
    hasPump:      !!body.hasPump,
    isTrailer:    !!body.isTrailer,
    note:         body.note         ?? "",
    updatedAt:    new Date(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.updateOne({ plate: decodeURIComponent(plate) } as any, { $set: update })
  return NextResponse.json({ ok: true })
}

// DELETE /api/vehicles/[plate]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { plate } = await params
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.deleteOne({ plate: decodeURIComponent(plate) } as any)
  return NextResponse.json({ ok: true })
}
