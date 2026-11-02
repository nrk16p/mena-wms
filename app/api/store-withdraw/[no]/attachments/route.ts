// GET /api/store-withdraw/:no/attachments — ไฟล์แนบที่ยืนยันแล้ว + ลิงก์ดาวน์โหลดอายุสั้น (เจ้าของใบหรือสโตร์) · ไม่มีแก้/ลบ
import { NextResponse, type NextRequest } from "next/server"
import { assertCanView, listAttachments } from "@/lib/store-withdraw/attachments"
import { getAttachWho, isWho } from "@/lib/store-withdraw/attach-http"
import { guard, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const who = await getAttachWho(req)
    if (!isWho(who)) return who
    const { no } = await ctx.params
    await assertCanView(no, who)
    const items = (await listAttachments([no])).get(no) ?? []
    return NextResponse.json({ items })
  })
}
