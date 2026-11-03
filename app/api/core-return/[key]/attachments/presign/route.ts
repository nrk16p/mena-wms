// POST /api/core-return/:key/attachments/presign — ขอลิงก์อัปโหลดรูป (คนที่คืนซากแถวนี้ได้)
import { NextResponse, type NextRequest } from "next/server"
import { presignCoreAttachment } from "@/lib/core-return/attachments"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "return")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    return NextResponse.json(await presignCoreAttachment(decodeURIComponent(key), await readJson(req), ctx.actor), { status: 201 })
  })
}
