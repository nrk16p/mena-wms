// POST /api/core-return/:key/follow-up — ดู lib/core-return/service.ts (followUp)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { followUp } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "follow_up")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    const row = await followUp(decodeURIComponent(key), await readJson(req), ctx.actor)
    return NextResponse.json({ row })
  })
}
