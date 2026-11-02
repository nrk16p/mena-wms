// GET /api/store-withdraw/audit/:no — ไทม์ไลน์เต็มของใบ + ไฟล์แนบ (ลิงก์อายุสั้น) + ลิงก์ ATMS + ผลตรวจโซ่ log
import { NextResponse, type NextRequest } from "next/server"
import { getAuditActor } from "@/lib/store-withdraw/audit-http"
import { auditDetail } from "@/lib/store-withdraw/audit"
import { guard, isResponse, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getAuditActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    return NextResponse.json(await auditDetail(no))
  })
}
