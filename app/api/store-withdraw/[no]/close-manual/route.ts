// POST /api/store-withdraw/:no/close-manual — ใบที่ส่ง ATMS ค้าง (ISSUE_FAILED) และมี WD แล้ว สโตร์แก้ใน ATMS เองแล้วปิดใบ
// ต้องมีหมายเหตุ · ไปที่สถานะ REJECTED (rejectReason ขึ้นต้น "ปิดมือ: ") · session เท่านั้น
import { NextResponse, type NextRequest } from "next/server"
import { transition } from "@/lib/store-withdraw/db"
import { getStoreActor, guard, isResponse, readJson, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const note = String((await readJson(req)).note ?? "").trim()
    if (!note) return err("ใส่หมายเหตุว่าแก้อะไรใน ATMS ไปแล้ว", 400)
    const { _id: _drop, ...request } = await transition(no, "closeManual", actor, { rejectReason: `ปิดมือ: ${note}`.slice(0, 500) })
    void _drop
    return NextResponse.json({ request })
  })
}
