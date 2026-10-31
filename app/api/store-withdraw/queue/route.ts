// GET /api/store-withdraw/queue?inv= → { columns: {NEW, PREPARING, READY, DONE_TODAY}, atmsKeyed: [] } (session เท่านั้น)
// atmsKeyed = WD ที่คีย์ตรงใน ATMS — เติมในงานถัดไป
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse } from "@/lib/store-withdraw/http"
import { buildQueue } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const inv = Number(req.nextUrl.searchParams.get("inv"))
    const columns = await buildQueue(Number.isInteger(inv) && inv > 0 ? inv : null)
    return NextResponse.json({ columns, atmsKeyed: [] })
  })
}
