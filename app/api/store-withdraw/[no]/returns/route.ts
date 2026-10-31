// POST /api/store-withdraw/:no/returns — ผู้ขอขอคืนอะไหล่ · 409 ถ้าเกินจำนวนที่คืนได้
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { requestReturn } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { rid } = await requestReturn(no, await readJson(req), actor)
    return NextResponse.json({ rid }, { status: 201 })
  })
}
