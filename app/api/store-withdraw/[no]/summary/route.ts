// POST /api/store-withdraw/:no/summary — ผู้ขอ (Mobile/PM) สรุปว่าใช้ของกับรถคันไหน · ของเหลือ = คืนสโตร์ (คำนวณให้)
// body { usages: [{ lineIndex, plate, mrCode, mrItemId, mrItemLabel, qty }], note? } · ได้เฉพาะเจ้าของใบ สถานะ HANDED_OUT
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { linkAttachments, resolveLinkable } from "@/lib/store-withdraw/attachments"
import { submitSummary } from "@/lib/store-withdraw/settle"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const body = await readJson(req)
    const attachIds = await resolveLinkable(no, body.attachmentIds, "summary", actor) // ไฟล์แนบไม่บังคับ
    const { _id: _drop, ...request } = await submitSummary(no, body, actor)
    void _drop
    await linkAttachments(no, attachIds, { type: "summary" })
    return NextResponse.json({ request })
  })
}
