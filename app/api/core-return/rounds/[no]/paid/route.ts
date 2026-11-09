// POST /api/core-return/rounds/:no/paid — บัญชีรับเงินค่าซาก · ดู lib/core-return/rounds.ts (payRound)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"
import { payRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "pay")
    if (isResponse(ctx)) return ctx
    return NextResponse.json(await payRound((await params).no, await readJson(req), ctx.actor))
  })
}
