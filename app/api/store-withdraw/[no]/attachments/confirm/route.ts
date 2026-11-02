// POST /api/store-withdraw/:no/attachments/confirm — อัปโหลดเสร็จแล้ว ให้ระบบเช็กไฟล์ในที่เก็บ (ขนาดต้องตรง) แล้วบันทึกเป็นหลักฐาน
import { NextResponse, type NextRequest } from "next/server"
import { confirmAttachment } from "@/lib/store-withdraw/attachments"
import { getAttachWho, isWho } from "@/lib/store-withdraw/attach-http"
import { guard, readJson, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const who = await getAttachWho(req)
    if (!isWho(who)) return who
    const { no } = await ctx.params
    return NextResponse.json(await confirmAttachment(no, (await readJson(req)).id, who))
  })
}
