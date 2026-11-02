// POST /api/store-withdraw/:no/attachments/presign — ขอลิงก์อัปโหลดไฟล์แนบ (รูป/PDF ไม่เกิน 10 MB)
import { NextResponse, type NextRequest } from "next/server"
import { presignAttachment } from "@/lib/store-withdraw/attachments"
import { getAttachWho, isWho } from "@/lib/store-withdraw/attach-http"
import { guard, readJson, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const who = await getAttachWho(req)
    if (!isWho(who)) return who
    const { no } = await ctx.params
    return NextResponse.json(await presignAttachment(no, await readJson(req), who), { status: 201 })
  })
}
