// POST /api/store-withdraw/:no/returns/:rid/accept — สโตร์รับคืน → DD ใน ATMS (session เท่านั้น)
import { NextResponse, type NextRequest } from "next/server"
import { acceptReturn } from "@/lib/store-withdraw/issue"
import { getActor, guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string; rid: string }>) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const { no, rid } = await ctx.params
    const { _id: _drop, ...request } = await acceptReturn(no, rid, actor)
    void _drop
    return NextResponse.json({ request })
  })
}
