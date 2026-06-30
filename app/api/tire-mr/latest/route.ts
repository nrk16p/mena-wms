import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"

// GET /api/tire-mr/latest?branch=xxx&plates=a,b,c
// Returns: Record<plate, { mrId, status, note, updatedAt, createdBy }>
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch      = searchParams.get("branch")?.trim() ?? ""
  const platesParam = searchParams.get("plates") ?? ""

  if (!branch || !platesParam) return NextResponse.json({})

  const plates = platesParam.split(",").map((p) => p.trim()).filter(Boolean)
  const client = await clientPromise
  const db = client.db(DB)

  const rows = await db.collection(COL).aggregate([
    { $match: { branch, plate: { $in: plates } } },
    { $sort:  { createdAt: -1 } },
    { $group: { _id: "$plate", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },
  ]).toArray()

  const map: Record<string, { mrId: string; status: string; note: string; updatedAt: Date; createdBy: string }> = {}
  for (const r of rows) {
    map[r.plate] = {
      mrId:      String(r._id),
      status:    r.status,
      note:      r.note ?? "",
      updatedAt: r.updatedAt,
      createdBy: r.createdBy ?? "",
    }
  }
  return NextResponse.json(map)
}
