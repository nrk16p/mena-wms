// GET /api/core-return/export — Excel ตามตัวกรองเดียวกับหน้ารายการ (มีค้างกี่วัน + การตามล่าสุด)
import { type NextRequest } from "next/server"
import { parseFilters, todayBkk } from "@/lib/core-return/core"
import { buildListWorkbook } from "@/lib/core-return/excel"
import { getCoreActor, guard, isResponse, xlsx } from "@/lib/core-return/http"
import { exportRows, groups } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const f = parseFilters(req.nextUrl.searchParams)
    const [{ rows, truncated }, g] = await Promise.all([exportRows(f), groups(f, "garage", 1, new Date(), 1000)])
    return xlsx(await buildListWorkbook(rows, { truncated, garages: g.items }), `core-return_${todayBkk()}.xlsx`)
  })
}
