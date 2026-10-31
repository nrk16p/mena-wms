// POST /api/store-withdraw/:no/ready — สโตร์จัดของครบ (session เท่านั้น)
import { NextResponse, type NextRequest } from "next/server"
import { allZeroIssue } from "@/lib/store-withdraw/core"
import { NotFoundError, swCol, transition } from "@/lib/store-withdraw/db"
import { getStoreActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const cur = await (await swCol()).findOne({ no })
    if (!cur) throw new NotFoundError()
    // จ่าย 0 ทุกบรรทัด = ไม่มีอะไรให้ตัด ATMS (ใบจะค้างที่ส่งไม่ได้) → ให้ปฏิเสธแทน
    if (cur.status === "PREPARING" && allZeroIssue(cur.lines)) return err("ไม่มีของจ่ายเลย กดปฏิเสธแทน", 400)
    const { _id: _drop, ...request } = await transition(no, "ready", actor)
    void _drop
    return NextResponse.json({ request })
  })
}
