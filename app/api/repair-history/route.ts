import { NextRequest, NextResponse } from "next/server"

const BASE = "https://main-api-mena-548129382487.asia-southeast1.run.app"

export async function GET(req: NextRequest) {
  const plate = req.nextUrl.searchParams.get("truckplate") ?? ""
  const res = await fetch(`${BASE}/repair-request/requests?truckplate=${encodeURIComponent(plate)}`)
  if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: res.status })
  const data = await res.json()
  return NextResponse.json(data)
}
