import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MEDIA_API_URL } from "@/lib/media"

type Params = { params: Promise<{ id: string }> }

// POST /api/media/{id}/complete → tells presign-api the S3 PUT succeeded
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const userId  = session?.user?.email
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  try {
    const res = await fetch(`${MEDIA_API_URL}/media/${encodeURIComponent(id)}/complete`, {
      method:  "POST",
      headers: { "X-User-Id": userId },
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Media service unavailable" }, { status: 502 })
  }
}
