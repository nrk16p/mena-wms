// GET /api/core-return/rounds — รอบขายซากล่าสุด · POST สร้างรอบ {warehouses, cutoffDate, keys?, note?}
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { createRound, listRounds } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    return NextResponse.json({ items: await listRounds() })
  })
}

export function POST(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "round")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await createRound(await readJson(req), ctx.actor), { status: 201 })
  })
}
