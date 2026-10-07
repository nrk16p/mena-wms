// app/api/admin/access-log/route.ts
// GET /api/admin/access-log?limit=200 — ประวัติการเปลี่ยนสิทธิ์ (wms_access_log) ใหม่สุดก่อน
// superadmin เท่านั้น
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/admin-guard"
import { ACCESS_LOG_COLL } from "@/lib/access-refresh"
import { cleanOverrides, parseLogLimit } from "@/lib/access-admin"

export const dynamic = "force-dynamic"

const DB = () => process.env.MONGO_DB ?? "master_data"

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.res

  const limit = parseLogLimit(req.nextUrl.searchParams.get("limit"))
  try {
    const db = (await (await import("@/lib/mongo")).default).db(DB())
    const rows = await db.collection(ACCESS_LOG_COLL).find({}, { projection: { _id: 0 } })
      .sort({ at: -1 }).limit(limit).toArray()
    const entries = rows.map((r) => ({
      at: r.at, by: String(r.by ?? ""), target: String(r.target ?? ""),
      before: cleanOverrides(r.before), after: cleanOverrides(r.after),
    }))
    return NextResponse.json({ entries })
  } catch (e) {
    console.error("[admin/access-log] GET", e)
    return NextResponse.json({ error: "โหลดประวัติไม่สำเร็จ" }, { status: 500 })
  }
}
