// POST /api/core-return/:key/confirm — ยานยนต์ยืนยันส่งต่อให้บัญชี (confirmHandover) · ดู lib/core-return/service.ts
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { confirmHandover } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "confirm")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    const row = await confirmHandover(decodeURIComponent(key), await readJson(req), ctx.actor)
    return NextResponse.json({ row })
  })
}
