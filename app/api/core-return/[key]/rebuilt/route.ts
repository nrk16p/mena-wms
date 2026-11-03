// POST /api/core-return/:key/rebuilt — ดู lib/core-return/service.ts (markRebuilt)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { markRebuilt } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "rebuilt")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    const row = await markRebuilt(decodeURIComponent(key), await readJson(req), ctx.actor)
    return NextResponse.json({ row })
  })
}
