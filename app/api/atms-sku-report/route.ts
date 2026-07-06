import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/atms-sku-report — monthly new-SKU counts + recent add events for the report page
export async function GET() {
  const client = await clientPromise
  const db     = client.db(DB)

  const [monthly, recent, lastSync] = await Promise.all([
    db.collection("atms_new_sku_monthly")
      .find({}, { projection: { _id: 0, month: 1, count: 1, updatedAt: 1 } })
      .sort({ month: 1 })
      .toArray(),
    db.collection("atms_sku_add_events")
      .find({}, { projection: { _id: 0, skuPk: 1, username: 1, addedAt: 1 } })
      .sort({ addedAt: -1 })
      .limit(100)
      .toArray(),
    db.collection("atms_sku_report_sync_log").findOne({ trigger: "cron" }, { projection: { _id: 0 } }),
  ])

  return NextResponse.json({ monthly, recent, lastSync })
}
