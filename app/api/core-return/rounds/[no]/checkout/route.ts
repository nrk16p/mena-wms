// POST /api/core-return/rounds/:no/checkout — ดู lib/core-return/rounds.ts (checkoutRound)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { checkoutRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "round")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await checkoutRound((await params).no, await readJson(req), ctx.actor))
  })
}
