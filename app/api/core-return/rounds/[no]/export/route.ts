// GET /api/core-return/rounds/:no/export — Excel รอบนี้ (สรุปรอบ + รายการซาก มีช่องราคาขายว่างไว้)
import { type NextRequest } from "next/server"
import { buildRoundWorkbook } from "@/lib/core-return/excel"
import { getCoreActor, guard, isResponse, xlsx } from "@/lib/core-return/http"
import { getRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const { round, items } = await getRound((await params).no)
    return xlsx(await buildRoundWorkbook(round, items), `${round.roundNo}.xlsx`)
  })
}
