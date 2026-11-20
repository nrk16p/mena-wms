// POST /api/store-withdraw/:no/hub-wd-retry — สโตร์ลองตัด WD Hub ใหม่ (session + สิทธิ์คิวสโตร์)
import { NextResponse, type NextRequest } from "next/server"
import { getStoreActor, guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"
import { withHub } from "@/lib/store-withdraw/hub-core"
import { retryHubWd } from "@/lib/store-withdraw/issue"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await retryHubWd(no, actor)
    void _drop
    return NextResponse.json({ request: withHub(request as never, new Date()) })
  })
}
