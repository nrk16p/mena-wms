import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MEDIA_API_URL } from "@/lib/media"

// POST /api/media/presign → proxies to presign-api with the caller's X-User-Id
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId  = session?.user?.email
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  try {
    const res = await fetch(`${MEDIA_API_URL}/media/presign`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId },
      body:    JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Media service unavailable" }, { status: 502 })
  }
}
