import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getUserPermissions } from "@/lib/permissions"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/atms-sku-report?warehouse=<name>[,<name>...] — data for the new-SKU report page
// All aggregations run over atms_sku_add_events (full history since Dec 2015).
// Requires the "report" section permission (or superadmin).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const perms = await getUserPermissions(session?.user?.email)
  if (!perms.isSuperAdmin && !perms.allowed.includes("report")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const selected = (req.nextUrl.searchParams.get("warehouse") ?? "").split(",").filter(Boolean)
  const match = selected.length ? { warehouse: { $in: selected } } : {}

  const client = await clientPromise
  const db     = client.db(DB)
  const events = db.collection("atms_sku_add_events")

  const [monthly, warehouses, topGroups, topUsers, recent, lastSync] = await Promise.all([
    events.aggregate([
      { $match: match },
      { $group: { _id: "$month", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", count: 1 } },
    ]).toArray(),
    events.aggregate([
      { $group: { _id: { $ifNull: ["$warehouse", "ไม่ระบุ"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, warehouse: "$_id", count: 1 } },
    ]).toArray(),
    events.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ["$group", "ไม่ระบุ"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, group: "$_id", count: 1 } },
    ]).toArray(),
    events.aggregate([
      { $match: match },
      { $group: { _id: "$username", count: { $sum: 1 }, lastAt: { $max: "$addedAt" } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, username: "$_id", count: 1, lastAt: 1 } },
    ]).toArray(),
    events
      .find(match, {
        projection: { _id: 0, skuPk: 1, username: 1, addedAt: 1, addedAtText: 1, code: 1, name: 1, group: 1, warehouse: 1 },
      })
      .sort({ addedAt: -1 })
      .limit(100)
      .toArray(),
    db.collection("atms_sku_report_sync_log").findOne({ trigger: "cron" }, { projection: { _id: 0 } }),
  ])

  return NextResponse.json({ monthly, warehouses, topGroups, topUsers, recent, lastSync })
}
