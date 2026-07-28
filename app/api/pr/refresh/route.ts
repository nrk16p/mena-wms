import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"

// server-side เท่านั้น (Next.js API route) — ไม่หลุดถึง browser
const NCAC = "https://api-ncac.onrender.com"
const KEY  = "mena-pipeline-2026"
const RATE_LIMIT_MIN = 60      // รีเฟรชได้ 1 ครั้ง/ชม.
const ETA_SEC = 720            // light run (30 วัน) ~11-12 นาที

// POST /api/pr/refresh — สั่งดึงข้อมูลใหม่ (7 วันล่าสุด) ผ่าน pipeline atms_procurement_light
export async function POST() {
  const client = await clientPromise
  const db = client.db("atms")

  // rate-limit: ถ้าเพิ่งรีเฟรช (run ล่าสุด < 60 นาที) → 429
  const last = await db.collection("procurement_runs").find({}).sort({ created_at: -1 }).limit(1).next()
  if (last?.created_at) {
    const ageMin = (Date.now() - new Date(last.created_at as string | Date).getTime()) / 60000
    if (ageMin < RATE_LIMIT_MIN) {
      return NextResponse.json(
        { error: "rate_limited", retry_after_min: Math.max(1, Math.ceil(RATE_LIMIT_MIN - ageMin)) },
        { status: 429 },
      )
    }
  }

  try {
    const res = await fetch(`${NCAC}/pipeline/run/atms_procurement_light`, {
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
