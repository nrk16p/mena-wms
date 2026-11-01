// GET /api/store-withdraw/lookup/doc/{po|dd}/{id}?inv= → { doc, lines, warnings } รายการในใบ PO / DD (อ่านอย่างเดียว)
// lines: skuId (จากสำเนา atms_sku_master แล้วค่อยถาม ATMS) · stockQty · alreadyCut/cutBy (คำขออื่นที่อ้างใบนี้) ดูสัญญาใน docs/superpowers/specs/2026-11-01-store-withdraw-doc-ref-design.md
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"
import { getDocDetail } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, ctx: RouteCtx<{ kind: string; id: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const { kind, id } = await ctx.params
    if (kind !== "po" && kind !== "dd") return err("ชนิดใบไม่ถูกต้อง (po หรือ dd)", 400)
    const n = Number(id)
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(n) || n <= 0) return err("id ของใบไม่ถูกต้อง", 400)
    const inv = Number(req.nextUrl.searchParams.get("inv"))
    return NextResponse.json(await getDocDetail(kind, n, Number.isInteger(inv) && inv > 0 ? inv : undefined))
  })
}
