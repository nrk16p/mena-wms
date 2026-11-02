// GET /api/store-withdraw/audit/export?from=&to= — Excel 3 แผ่น (ใบเบิก · เหตุการณ์ · หลักฐานแนบ) ช่วงวันที่เดียวกับหน้ารายการ
import { NextResponse, type NextRequest } from "next/server"
import { getAuditActor } from "@/lib/store-withdraw/audit-http"
import { buildAuditWorkbook } from "@/lib/store-withdraw/audit"
import { guard, isResponse } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getAuditActor(req)
    if (isResponse(actor)) return actor
    const p = req.nextUrl.searchParams
    const { buffer } = await buildAuditWorkbook(p.get("from"), p.get("to"), { status: p.get("status") ?? undefined, workType: p.get("workType") ?? undefined, q: p.get("q") ?? undefined })
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="store-withdraw-audit_${p.get("from")}_${p.get("to")}.xlsx"`,
      },
    })
  })
}
