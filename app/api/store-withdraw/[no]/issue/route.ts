// POST /api/store-withdraw/:no/issue — ส่งของ/ตัดยอด → WD ใน ATMS (ลองใหม่ก็ endpoint นี้) · session เท่านั้น
// ผล ISSUE_FAILED ตอบ 200 พร้อมใบ (atms.error บอกว่าต้องทำอะไรต่อ) — หน้าจอแสดงจากสถานะในใบ
// Mobile/PM แบบ pending: ส่งของ = HANDED_OUT ไม่แตะ ATMS (ไปตัดตอนสโตร์กดตัดสต๊อกหลังช่างสรุป)
import { NextResponse, type NextRequest } from "next/server"
import { isPendingFlow } from "@/lib/store-withdraw/core"
import { NotFoundError, swCol } from "@/lib/store-withdraw/db"
import { issueRequest } from "@/lib/store-withdraw/issue"
import { handOut } from "@/lib/store-withdraw/settle"
import { getStoreActor, guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const cur = await (await swCol()).findOne({ no }, { projection: { workType: 1, summaryDueAt: 1 } })
    if (!cur) throw new NotFoundError()
    const { _id: _drop, ...request } = isPendingFlow(cur) ? await handOut(no, actor) : await issueRequest(no, actor)
    void _drop
    return NextResponse.json({ request })
  })
}
