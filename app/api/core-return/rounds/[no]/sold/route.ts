// POST /api/core-return/rounds/:no/sold — ดู lib/core-return/rounds.ts (sellRound)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { sellRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "round")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await sellRound((await params).no, await readJson(req), ctx.actor))
  })
}
