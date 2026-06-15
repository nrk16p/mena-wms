import { NextRequest, NextResponse } from "next/server"

const INTEL_BASE = "https://mena-intelligence.vercel.app/api/truck-distance"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const plate      = searchParams.get("plate")      ?? ""
  const startMonth = searchParams.get("startMonth") ?? ""
  const endMonth   = searchParams.get("endMonth")   ?? ""

  if (!plate) return NextResponse.json({ error: "plate required" }, { status: 400 })

  const url = new URL(INTEL_BASE)
  url.searchParams.set("plate", plate)
  if (startMonth) url.searchParams.set("startMonth", startMonth)
  if (endMonth)   url.searchParams.set("endMonth",   endMonth)

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: res.status })
    const data = await res.json()
    return NextResponse.json(Array.isArray(data) ? data : [])
  } catch (err) {
    console.error("[truck-distance proxy]", err)
    return NextResponse.json({ error: "fetch failed" }, { status: 502 })
  }
}
