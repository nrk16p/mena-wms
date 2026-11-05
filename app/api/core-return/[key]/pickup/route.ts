// POST /api/core-return/:key/pickup — จัดซื้อรับซากกลับจากอู่นอก (markPickedUp) · ดู lib/core-return/service.ts
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { markPickedUp } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "pickup")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    const row = await markPickedUp(decodeURIComponent(key), await readJson(req), ctx.actor)
    return NextResponse.json({ row })
  })
}
