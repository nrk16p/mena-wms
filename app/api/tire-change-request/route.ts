import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"

// GET /api/tire-change-request?branch=&status=&q=&page=1&limit=50 — list requests (admin)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const status = searchParams.get("status")?.trim() ?? ""
  const plate  = searchParams.get("plate")?.trim()  ?? ""
  const q      = searchParams.get("q")?.trim()      ?? ""
  const page   = Math.max(parseInt(searchParams.get("page") ?? "1"), 1)
  const limit  = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50"), 1), 200)

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {
    // only requests that actually contain tire items
    "items.0": { $exists: true },
  }
  if (branch) filter.branch = branch
  if (plate)  filter.plate = plate
  // requests created before the status workflow existed count as pending
  if (status === "pending") filter.$or = [{ status: "pending" }, { status: { $exists: false } }]
  else if (status) filter.status = status
  if (q) {
    const search = [
      { plate:       { $regex: q, $options: "i" } },
      { driverName:  { $regex: q, $options: "i" } },
      { truckNumber: { $regex: q, $options: "i" } },
    ]
    if (filter.$or) { filter.$and = [{ $or: filter.$or }, { $or: search }]; delete filter.$or }
    else filter.$or = search
  }

  const [items, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ])

  return NextResponse.json({ items, total, page, pages: Math.ceil(total / limit) })
}

// POST /api/tire-change-request — save a tire change request
export async function POST(req: NextRequest) {
  const body = await req.json()
  const branch          = String(body.branch ?? "").trim()
  const driverName      = String(body.driverName ?? "").trim()
  const plate           = String(body.plate ?? "").trim()
  const truckNumber     = String(body.truckNumber ?? "").trim()
  const currentOdometer = Number(String(body.currentOdometer ?? "").replace(/,/g, ""))

  if (!branch)      return NextResponse.json({ error: "branch is required" }, { status: 400 })
  if (!driverName)  return NextResponse.json({ error: "กรุณาระบุชื่อคนขับ" }, { status: 400 })
  if (!plate)       return NextResponse.json({ error: "กรุณาระบุทะเบียนรถ" }, { status: 400 })
  if (!truckNumber) return NextResponse.json({ error: "กรุณาระบุเบอร์รถ" }, { status: 400 })
  if (!Number.isFinite(currentOdometer) || currentOdometer <= 0) {
    return NextResponse.json({ error: "กรุณาระบุเลขไมล์ปัจจุบันให้ถูกต้อง" }, { status: 400 })
  }

  const session = await getServerSession(authOptions)

  const doc = {
    branch,
    driverName,
    plate,
    truckNumber,
    currentOdometer,
    // vehicle master snapshot at request time
    fleet:       String(body.fleet ?? ""),
    plant:       String(body.plant ?? ""),
    vehicleType: String(body.vehicleType ?? ""),
    // session for web; body fields for mobile (x-api-key) callers
    requestedBy:      session?.user?.name  || String(body.requestedBy ?? ""),
    requestedByEmail: session?.user?.email || String(body.requestedByEmail ?? ""),
    source:           session ? "web" : "mobile",
    status:           "pending",
    createdAt:        new Date(),
  }

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)

  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
