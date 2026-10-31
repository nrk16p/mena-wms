// POST /api/store-withdraw/:no/claim — สโตร์รับงาน (session เท่านั้น)
import { NextResponse, type NextRequest } from "next/server"
import { transition } from "@/lib/store-withdraw/db"
import { getActor, guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await transition(no, "claim", actor, { claimedBy: { email: actor.email, name: actor.name } })
    void _drop
    return NextResponse.json({ request })
  })
}
