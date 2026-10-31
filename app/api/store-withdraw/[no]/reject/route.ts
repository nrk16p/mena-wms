// POST /api/store-withdraw/:no/reject — สโตร์ปฏิเสธคำขอ ต้องมีเหตุผล (session เท่านั้น)
import { NextResponse, type NextRequest } from "next/server"
import { transition } from "@/lib/store-withdraw/db"
import { getStoreActor, guard, isResponse, readJson, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const reason = String((await readJson(req)).reason ?? "").trim()
    if (!reason) return err("ใส่เหตุผลที่ปฏิเสธก่อน ผู้ขอจะเห็นข้อความนี้", 400)
    const { _id: _drop, ...request } = await transition(no, "reject", actor, { rejectReason: reason.slice(0, 500) })
    void _drop
    return NextResponse.json({ request })
  })
}
