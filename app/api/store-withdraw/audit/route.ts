// GET /api/store-withdraw/audit?from=&to=&status=&workType=&q= — รายการใบสำหรับตรวจย้อนหลัง (ต้องมีช่วงวันที่ ≤ 93 วัน · ไม่เกิน 400 ใบ)
import { NextResponse, type NextRequest } from "next/server"
import { getAuditActor } from "@/lib/store-withdraw/audit-http"
import { listAudit } from "@/lib/store-withdraw/audit"
import { guard, isResponse } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getAuditActor(req)
    if (isResponse(actor)) return actor
    const p = req.nextUrl.searchParams
    const { rows, truncated } = await listAudit(p.get("from"), p.get("to"), { status: p.get("status") ?? undefined, workType: p.get("workType") ?? undefined, q: p.get("q") ?? undefined })
    return NextResponse.json({ rows, truncated, max: 400 })
  })
}
