import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { MENA_API_BASE } from "@/lib/mena-api"
import { refreshWaitMin, REFRESH_COUNTED_PIPELINES } from "@/lib/pr-refresh"

export const dynamic = "force-dynamic"

// server-side เท่านั้น (Next.js API route) — ไม่หลุดถึง browser
const KEY = process.env.MENA_API_KEY ?? ""
const ETA_SEC = 720            // light run (30 วัน) ~11-12 นาที

// POST /api/pr/refresh — สั่งดึงข้อมูลใหม่ (7 วันล่าสุด) ผ่าน pipeline atms_procurement_light
export async function POST() {
  const client = await clientPromise
  const db = client.db("atms")

  // rate-limit: กดได้ทุก 30 นาที นับเฉพาะรอบดึงเต็ม (lib/pr-refresh.ts) — ไม่นับรอบ PR รายชั่วโมง
  const last = await db.collection("procurement_runs")
    .find({ pipeline: { $in: REFRESH_COUNTED_PIPELINES } }).sort({ created_at: -1 }).limit(1).next()
  const wait = refreshWaitMin(last?.created_at as string | Date | null, Date.now())
  if (wait > 0) {
    return NextResponse.json({ error: "rate_limited", retry_after_min: wait }, { status: 429 })
  }

  try {
    const res = await fetch(`${MENA_API_BASE}/pipeline/run/atms_procurement_light`, {
      method: "POST",
      headers: { "x-api-key": KEY },
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return NextResponse.json({ error: "trigger_failed", detail: data }, { status: 502 })
    if (data.status === "already_running") {
      return NextResponse.json({ status: "already_running", eta_sec: ETA_SEC, at: new Date().toISOString() })
    }
    return NextResponse.json({ status: "started", eta_sec: ETA_SEC, at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: "trigger_error", detail: String(e) }, { status: 502 })
  }
}
