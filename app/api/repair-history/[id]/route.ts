import { NextRequest, NextResponse } from "next/server"

const BASE = "https://main-api-mena-548129382487.asia-southeast1.run.app"
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const res = await fetch(`${BASE}/repair-request/requests/${id}`)
  if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: res.status })
  const data = await res.json()
  return NextResponse.json(data)
}
