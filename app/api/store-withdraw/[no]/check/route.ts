// POST /api/store-withdraw/:no/check — สโตร์เปิดดูใบ → เทียบกับ ATMS ว่าถูกแก้หลังตัดหรือไม่ (session + สิทธิ์สโตร์เท่านั้น)
// ใบเดียวไม่ตรวจถี่เกิน 1 ครั้ง/60 วิ (กัน ATMS โดนยิงเวลาเปิดปิดการ์ดซ้ำ ๆ)
import { NextResponse, type NextRequest } from "next/server"
import { swCol } from "@/lib/store-withdraw/db"
import { checkDriftDetailed } from "@/lib/store-withdraw/drift"
import { getStoreActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"
const MIN_GAP_MS = 60_000

export function POST(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const cur = await (await swCol()).findOne({ no }, { projection: { _id: 0 } })
    if (!cur) return err("ไม่พบใบขอเบิกนี้ — ตรวจเลขที่ใบอีกครั้ง", 404)
    if (cur.status !== "ISSUED" && cur.status !== "RECEIVED") return NextResponse.json({ request: cur, checked: false })
    const last = cur.atms.lastCheckAt ? new Date(cur.atms.lastCheckAt).getTime() : 0
    if (Date.now() - last < MIN_GAP_MS) return NextResponse.json({ request: cur, checked: false })
    const { request, state } = await checkDriftDetailed(no)
    const { _id: _drop, ...rest } = (request ?? cur) as typeof cur & { _id?: unknown }
    void _drop
    return NextResponse.json({ request: rest, checked: state === "checked" })
  })
}
