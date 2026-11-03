// GET /api/core-return — รายการติดตามซาก (ตัวกรอง + หน้า 50) + การ์ดสรุปต่อสถานะ · ?meta=1 แนบรายชื่อคลัง · ?mine=1 เฉพาะที่ฉันเบิก
import { NextResponse, type NextRequest } from "next/server"
import { parseFilters, parseSort } from "@/lib/core-return/core"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { garages, list, summary, warehouses } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const sp = req.nextUrl.searchParams
    const f = parseFilters(sp)
    if (sp.get("mine") === "1") f.requesterEmail = ctx.actor.email // ของฉัน (เฉพาะแถวจากใบเบิก WMS ที่มีผู้ขอ)
    const now = new Date()
    if (sp.get("only") === "summary") return NextResponse.json({ summary: await summary(f, now), today: now.toISOString() }) // ชิปสถานะ: ไม่ต้องดึงรายการ
    const [page, sum, whs, gas] = await Promise.all([
      list(f, Number(sp.get("page") ?? 1), now, parseSort(sp.get("sort"))),
      sp.get("summary") === "0" ? null : summary(f, now),
      sp.get("meta") === "1" ? warehouses() : null,
      sp.get("meta") === "1" ? garages() : null,
    ])
    return NextResponse.json({ ...page, summary: sum, warehouses: whs, garages: gas, today: now.toISOString() })
  })
}
