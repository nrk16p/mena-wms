// POST /api/store-withdraw/:no/summary — ผู้ขอ (Mobile/PM) สรุปว่าใช้ของกับรถคันไหน · ของเหลือ = คืนสโตร์ (คำนวณให้)
// body { usages: [{ lineIndex, plate, mrCode, mrItemId, mrItemLabel, qty }], note? } · ได้เฉพาะเจ้าของใบ สถานะ HANDED_OUT
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { submitSummary } from "@/lib/store-withdraw/settle"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await submitSummary(no, await readJson(req), actor)
    void _drop
    return NextResponse.json({ request })
  })
}
