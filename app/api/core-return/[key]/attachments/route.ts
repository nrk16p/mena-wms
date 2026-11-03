// GET /api/core-return/:key/attachments — รูปที่แนบกับซากนี้ + ลิงก์ดูอายุสั้น (คนที่ดูแถวได้ก็ดูได้)
import { NextResponse, type NextRequest } from "next/server"
import { listCoreAttachments } from "@/lib/core-return/attachments"
import { getCoreActor, guard, isResponse } from "@/lib/core-return/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "read")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    return NextResponse.json({ items: await listCoreAttachments(decodeURIComponent(key)) }, { headers: { "Cache-Control": "no-store" } })
  })
}
