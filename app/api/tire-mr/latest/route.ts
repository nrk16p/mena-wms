import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import type { MrSummary } from "@/lib/tire-mr"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"

// GET /api/tire-mr/latest?branch=xxx&plates=a,b,c
// Returns: Record<plate, MrSummary>  (ใบล่าสุดของแต่ละทะเบียน)
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

  const map: Record<string, MrSummary> = {}
  for (const r of rows) {
    map[r.plate] = {
      mrId:      String(r._id),
      status:    r.status,
      note:      r.note ?? "",
      updatedBy: r.updatedBy ?? r.createdBy ?? "",
      updatedAt: r.updatedAt,
      createdBy: r.createdBy ?? "",
      createdAt: r.createdAt,
      logsCount: Array.isArray(r.logs) ? r.logs.length : 0,
    }
  }
  return NextResponse.json(map)
}
