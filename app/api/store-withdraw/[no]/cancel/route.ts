// POST /api/store-withdraw/:no/cancel — ผู้ขอยกเลิกใบของตัวเอง (ได้เฉพาะสถานะ NEW)
import { NextResponse, type NextRequest } from "next/server"
import { swCol, transition } from "@/lib/store-withdraw/db"
import { assertOwner, getActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const cur = await (await swCol()).findOne({ no })
    if (!cur) return err("ไม่พบใบขอเบิกนี้ — ตรวจเลขที่ใบอีกครั้ง", 404)
    assertOwner(cur, actor)
    const { _id: _drop, ...request } = await transition(no, "cancel", actor)
    void _drop
    return NextResponse.json({ request })
  })
}
