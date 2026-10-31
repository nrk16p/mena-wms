// POST /api/store-withdraw/:no/issue — ส่งของ/ตัดยอด → WD ใน ATMS (ลองใหม่ก็ endpoint นี้) · session เท่านั้น
// ผล ISSUE_FAILED ตอบ 200 พร้อมใบ (atms.error บอกว่าต้องทำอะไรต่อ) — หน้าจอแสดงจากสถานะในใบ
import { NextResponse, type NextRequest } from "next/server"
import { issueRequest } from "@/lib/store-withdraw/issue"
import { getActor, guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const { _id: _drop, ...request } = await issueRequest(no, actor)
    void _drop
    return NextResponse.json({ request })
  })
}
