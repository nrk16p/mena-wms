import { NextRequest, NextResponse } from "next/server"
import { runBranchSync, BRANCH_IDS, AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import clientPromise from "@/lib/mongo"

const DB       = process.env.MONGO_DB ?? "master_data"
const BRANCHES = Object.keys(BRANCH_IDS) // ["latkrabang", "saraburi"]

export type SyncLogEntry = {
  branch:       string
  ok:           boolean
  count:        number
  stockUpdated: number
  error:        string | null
  trigger:      "cron" | "manual"
  syncedAt:     Date
}

// GET /api/cron/tire-sync — invoked by Vercel Cron every 6 hours
// Protected by Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  // Auth check — skip in local dev when CRON_SECRET is not configured
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const phpsessid = process.env.ATMS_SESSION ?? ""
  if (!phpsessid) {
    return NextResponse.json({ error: "ATMS_SESSION env var not configured" }, { status: 500 })
  }

  const client   = await clientPromise
  const logCol   = client.db(DB).collection<SyncLogEntry>("tire_sync_log")
  const results: SyncLogEntry[] = []

  for (const branch of BRANCHES) {
    let entry: SyncLogEntry
    try {
      const r = await runBranchSync(branch, phpsessid)
      entry = { branch, ok: true, count: r.count, stockUpdated: r.stockUpdated, error: null, trigger: "cron", syncedAt: r.syncedAt }
    } catch (err) {
      let msg = "Unknown error"
      if (err instanceof AtmsSessionError) msg = "Session expired — update ATMS_SESSION env var"
      else if (err instanceof AtmsNetworkError) msg = `Network error: ${err.message}`
      else if (err instanceof Error) msg = err.message
      entry = { branch, ok: false, count: 0, stockUpdated: 0, error: msg, trigger: "cron", syncedAt: new Date() }
    }

    // upsert — keep latest cron result per branch
    await logCol.updateOne(
      { branch, trigger: "cron" },
      { $set: entry },
      { upsert: true }
    )
    results.push(entry)
  }

  const allOk = results.every((r) => r.ok)
  return NextResponse.json({ ok: allOk, results })
}
