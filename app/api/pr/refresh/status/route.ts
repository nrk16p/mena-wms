import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const NCAC = "https://api-ncac.onrender.com"

// GET /api/pr/refresh/status — สถานะ light run (running + last_run) จาก NCAC
export async function GET() {
  try {
    const res = await fetch(`${NCAC}/pipeline/status/atms_procurement_light`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e), running: false, last_run: null }, { status: 200 })
  }
}
