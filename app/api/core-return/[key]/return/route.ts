// POST /api/core-return/:key/return — ดู lib/core-return/service.ts (returnCore)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { returnCore } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "return")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    const row = await returnCore(decodeURIComponent(key), await readJson(req), ctx.actor)
    return NextResponse.json({ row })
  })
}
