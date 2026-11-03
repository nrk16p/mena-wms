// POST /api/core-return/rounds/:no/cancel — ดู lib/core-return/rounds.ts (cancelRound)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { cancelRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "round")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await cancelRound((await params).no, await readJson(req), ctx.actor))
  })
}
