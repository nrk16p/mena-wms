// POST /api/core-return/:key/attachments/confirm — ยืนยันว่าอัปโหลดเสร็จ (เช็กไฟล์+ขนาดในที่เก็บ)
import { NextResponse, type NextRequest } from "next/server"
import { confirmCoreAttachment } from "@/lib/core-return/attachments"
import { getCoreActor, guard, isResponse, readJson } from "@/lib/core-return/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return guard(async () => {
    const ctx = await getCoreActor(req, "return")
    if (isResponse(ctx)) return ctx
    const { key } = await params
    return NextResponse.json(await confirmCoreAttachment(decodeURIComponent(key), (await readJson(req)).id, ctx.actor))
  })
}
