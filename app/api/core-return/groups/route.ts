// GET /api/core-return/groups?by=vehicle|mr|warehouse — ยังไม่คืนซาก จัดกลุ่ม (นับ/บาท/ค้างนานสุด)
import { NextResponse, type NextRequest } from "next/server"
import { isGroupBy, parseFilters } from "@/lib/core-return/core"
import { err, getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { groups } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const sp = req.nextUrl.searchParams
    const by = sp.get("by") ?? "vehicle"
    if (!isGroupBy(by)) return err("จัดกลุ่มได้ตาม vehicle / mr / warehouse / garage", 400)
    return NextResponse.json(await groups(parseFilters(sp), by, Number(sp.get("page") ?? 1), new Date(), Number(sp.get("size") ?? 30) || 30))
  })
}
