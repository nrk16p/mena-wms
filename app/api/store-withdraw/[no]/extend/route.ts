// POST /api/store-withdraw/:no/extend — ผู้ขอเลื่อนกำหนดสรุปยอด { summaryDueAt } (อนาคต · ไม่เกิน 60 วัน) · สถานะ HANDED_OUT เท่านั้น
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { extendDue } from "@/lib/store-withdraw/settle"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await extendDue(no, await readJson(req), actor)
    void _drop
    return NextResponse.json({ request })
  })
}
