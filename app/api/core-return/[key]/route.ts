// GET /api/core-return/:key — แถวเดียว + ประวัติทั้งหมด + ผลตรวจโซ่แฮช
import { NextResponse, type NextRequest } from "next/server"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"
import { getRow } from "@/lib/core-return/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    return NextResponse.json(await getRow(decodeURIComponent(key)))
  })
}
