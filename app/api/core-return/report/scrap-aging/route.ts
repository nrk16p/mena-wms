// GET /api/core-return/report/scrap-aging[?warehouse=] — Excel ซากรอขาย ณ วันนี้ (คลัง × กลุ่มสินค้า × อายุในคลังซาก)
import { type NextRequest } from "next/server"
import { todayBkk } from "@/lib/core-return/core"
import { buildScrapAgingWorkbook } from "@/lib/core-return/excel"
import { getCoreActor, guard, isResponse, xlsx } from "@/lib/core-return/http"
import { exportRows } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const warehouse = req.nextUrl.searchParams.get("warehouse")?.trim() || null
    const { rows } = await exportRows({ status: ["sell_waiting"], warehouse })
    return xlsx(await buildScrapAgingWorkbook(rows), `scrap-waiting_${todayBkk()}.xlsx`)
  })
}
