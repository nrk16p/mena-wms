import { NextResponse } from "next/server"
import { MENA_API_BASE } from "@/lib/mena-api"

export const dynamic = "force-dynamic"

// GET /api/pr/refresh/status — สถานะ light run (running + last_run) จาก Mena API
export async function GET() {
  try {
    const res = await fetch(`${MENA_API_BASE}/pipeline/status/atms_procurement_light`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e), running: false, last_run: null }, { status: 200 })
  }
}
