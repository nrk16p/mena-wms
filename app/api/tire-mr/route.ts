import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"

// GET /api/tire-mr?branch=xxx&plate=yyy
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const plate  = searchParams.get("plate")?.trim()  ?? ""

  const client = await clientPromise
  const db = client.db(DB)
  const filter: Record<string, string> = {}
  if (branch) filter.branch = branch
  if (plate)  filter.plate  = plate

  const rows = await db.collection(COL).find(filter).sort({ createdAt: -1 }).toArray()
  return NextResponse.json(rows)
}

// POST /api/tire-mr — admin creates MR
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { branch, plate, requestId, note, createdBy } = body
  if (!branch || !plate) return NextResponse.json({ error: "branch and plate required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)
  const now = new Date()
  const doc = {
    branch,
    plate:     plate.trim(),
    requestId: requestId ?? null,
    status:    "pending",
    note:      note ?? "",
    createdBy: createdBy ?? "",
    createdAt: now,
    updatedAt: now,
    logs: [{ status: "pending", note: note ?? "", updatedBy: createdBy ?? "", updatedAt: now }],
  }

  const result = await db.collection(COL).insertOne(doc)
  return NextResponse.json({ _id: result.insertedId, ...doc }, { status: 201 })
}
