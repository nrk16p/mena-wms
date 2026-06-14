import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change"

// GET /api/tire-change?branch=latkrabang&q=...&vehicle=สบ.71-1234&latest=yes&page=1&limit=100
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch  = searchParams.get("branch")?.trim()  ?? ""
  const q       = searchParams.get("q")?.trim()       ?? ""
  const vehicle = searchParams.get("vehicle")?.trim() ?? ""
  const latest  = searchParams.get("latest")?.trim()  ?? ""
  const page   = Math.max(parseInt(searchParams.get("page") ?? "1"), 1)
  const limit  = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100"), 1), 500)

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (branch) filter.branch = branch
  if (vehicle) filter.vehicle = vehicle
  if (latest === "yes") filter.isLatest = true
  if (latest === "no")  filter.isLatest = false
  if (q) {
    filter["$or"] = [
      { vehicle:            { $regex: q, $options: "i" } },
      { serialNo:           { $regex: q, $options: "i" } },
      { product:            { $regex: q, $options: "i" } },
      { maintenanceRequest: { $regex: q, $options: "i" } },
      { tirePosition:       { $regex: q, $options: "i" } },
    ]
  }

  const [items, total, lastDoc, cronLog] = await Promise.all([
    col.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    col.countDocuments(filter),
    col.find(branch ? { branch } : {}).sort({ syncedAt: -1 }).limit(1).project({ syncedAt: 1 }).next(),
    branch
      ? client.db(DB).collection("tire_sync_log").findOne({ branch, trigger: "cron" }, { projection: { ok: 1, syncedAt: 1, error: 1, count: 1 } })
      : Promise.resolve(null),
  ])

  return NextResponse.json({
    items,
    total,
    page,
    pages: Math.ceil(total / limit),
    syncedAt: lastDoc?.syncedAt ?? null,
    cronStatus: cronLog ? { ok: cronLog.ok, syncedAt: cronLog.syncedAt, error: cronLog.error ?? null, count: cronLog.count ?? 0 } : null,
  })
}
