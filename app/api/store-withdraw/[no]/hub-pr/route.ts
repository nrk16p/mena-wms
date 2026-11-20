// POST /api/store-withdraw/:no/hub-pr — ผูก/เปลี่ยน PR เติมของ Hub { code, id? } · ผู้ขอ (เจ้าของใบ) หรือสโตร์
import { NextResponse, type NextRequest } from "next/server"
import { getActorWithStore, guard, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { bindHubPr } from "@/lib/store-withdraw/hub-service"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const who = await getActorWithStore(req)
    if (who instanceof NextResponse) return who
    const { no } = await ctx.params
    const body = await readJson(req)
    const { _id: _drop, ...request } = await bindHubPr(no, { code: body.code, id: body.id }, who.actor, who.isStore)
    void _drop
    return NextResponse.json({ request })
  })
}
