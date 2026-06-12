import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"

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
    requestedBy:      session?.user?.name  ?? "",
    requestedByEmail: session?.user?.email ?? "",
    createdAt:        new Date(),
  }

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)

  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
