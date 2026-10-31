// GET /api/store-withdraw/queue?inv= → { columns: {NEW, PREPARING, READY, DONE_TODAY}, atmsKeyed: [] } (session เท่านั้น)
// atmsKeyed = WD วันนี้ที่คีย์ตรงใน ATMS (แคช 3 นาที · ต้องผูกบัญชี ATMS ของคนเปิดจอ ไม่งั้นว่าง) · ต้องมีสิทธิ์ store-queue แก้ได้
import { NextResponse, type NextRequest } from "next/server"
import { getStoreActor, guard, isResponse } from "@/lib/store-withdraw/http"
import { buildQueue, listAtmsKeyed } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const inv = Number(req.nextUrl.searchParams.get("inv"))
    const validInv = Number.isInteger(inv) && inv > 0
    const [columns, atmsKeyed] = await Promise.all([
      buildQueue(validInv ? inv : null),
      validInv ? listAtmsKeyed(inv, new Date(), actor.email) : Promise.resolve([]),
    ])
    return NextResponse.json({ columns, atmsKeyed })
  })
}
