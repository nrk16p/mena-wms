// app/api/store-withdraw/[no]/route.ts — รายละเอียดใบ + log
import { NextResponse, type NextRequest } from "next/server"
import { swCol, swLogCol } from "@/lib/store-withdraw/db"
import { getActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const request = await (await swCol()).findOne({ no }, { projection: { _id: 0 } })
    if (!request) return err("ไม่พบใบขอเบิกนี้ — ตรวจเลขที่ใบอีกครั้ง", 404)
    if (actor.via === "api" && request.requestedBy.email !== actor.email) return err("ใบนี้ไม่ใช่ของคุณ", 403)
    const log = await (await swLogCol()).find({ no }, { projection: { _id: 0 } }).sort({ at: 1 }).limit(500).toArray()
    return NextResponse.json({ request, log })
  })
}
