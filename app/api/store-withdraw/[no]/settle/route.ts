// POST /api/store-withdraw/:no/settle — สโตร์ตัดสต๊อกใบ Mobile/PM ที่ช่างสรุปแล้ว → WD ใน ATMS หนึ่งใบต่อทะเบียน (ลองใหม่ก็ endpoint นี้)
// body { returnConfirmed: true } บังคับเมื่อมีของเหลือ · session + สิทธิ์คิวสโตร์เท่านั้น · ผล SETTLE_FAILED ตอบ 200 พร้อมใบ
import { NextResponse, type NextRequest } from "next/server"
import { getStoreActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { settleRequest } from "@/lib/store-withdraw/settle"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await settleRequest(no, (await readJson(req)).returnConfirmed, actor)
    void _drop
    return NextResponse.json({ request })
  })
}
