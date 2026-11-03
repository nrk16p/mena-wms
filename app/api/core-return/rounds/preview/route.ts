// GET /api/core-return/rounds/preview?warehouses=a,b&cutoffDate=YYYY-MM-DD — ซากรอขายที่เข้ารอบได้ (ยังไม่อยู่รอบไหน)
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { previewRound } from "@/lib/core-return/rounds"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await previewRound({ warehouses: sp.get("warehouses") ?? "", cutoffDate: sp.get("cutoffDate") ?? "" }))
  })
}
