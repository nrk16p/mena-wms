// POST /api/store-withdraw/:no/summary — ผู้ขอ (Mobile/PM) สรุปว่าใช้ของกับรถคันไหน · ของเหลือ = คืนสโตร์ (คำนวณให้)
// body { usages: [{ lineIndex, plate, mrCode, mrItemId, mrItemLabel, qty, attachmentIds: [id ≥1] }], note?, attachmentIds? }
// ได้เฉพาะเจ้าของใบ สถานะ HANDED_OUT · ตรวจ/ผูกไฟล์แนบใน submitSummary (lib/store-withdraw/settle.ts)
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { submitSummary } from "@/lib/store-withdraw/settle"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const body = await readJson(req)
    const { _id: _drop, ...request } = await submitSummary(no, body, actor)
    void _drop
    return NextResponse.json({ request })
  })
}
