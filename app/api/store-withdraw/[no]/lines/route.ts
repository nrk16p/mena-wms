// PATCH /api/store-withdraw/:no/lines — สโตร์แก้จำนวนจ่าย/ของขาด · ได้เฉพาะสถานะ PREPARING
// (progress ใน ATMS อ้าง index ของรายการที่ส่งไปแล้ว จึงห้ามแก้หลังจากนั้น) · ตรรกะอยู่ที่ editLines
import { NextResponse, type NextRequest } from "next/server"
import { getStoreActor, guard, isResponse, readJson, type RouteCtx } from "@/lib/store-withdraw/http"
import { editLines } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function PATCH(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const body = await readJson(req)
    const request = await editLines(no, body.lines, actor)
    return NextResponse.json({ request })
  })
}
