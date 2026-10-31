// PATCH /api/store-withdraw/:no/lines — สโตร์แก้จำนวนจ่าย/ของขาด · ได้เฉพาะสถานะ PREPARING
// (progress ใน ATMS อ้าง index ของรายการที่ส่งไปแล้ว จึงห้ามแก้หลังจากนั้น)
import { NextResponse, type NextRequest } from "next/server"
import { validateLineEdit } from "@/lib/store-withdraw/core"
import { ConflictError, swCol, writeLog } from "@/lib/store-withdraw/db"
import { getActor, guard, isResponse, readJson, err, type RouteCtx } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function PATCH(req: NextRequest, ctx: RouteCtx<{ no: string }>) {
  return guard(async () => {
    const actor = await getActor(req, false)
    if (isResponse(actor)) return actor
    const { no } = await ctx.params
    const body = await readJson(req)
    const edits = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : []
    if (edits.length === 0) return err("ไม่มีรายการที่จะแก้", 400)

    const col = await swCol()
    const cur = await col.findOne({ no })
    if (!cur) return err("ไม่พบใบขอเบิกนี้ — ตรวจเลขที่ใบอีกครั้ง", 404)
    if (cur.status !== "PREPARING") throw new ConflictError("แก้จำนวนได้เฉพาะใบที่กำลังจัด — รับงานก่อน หรือรีเฟรชดูสถานะ")

    const set: Record<string, unknown> = {}
    for (const e of edits) {
      const index = Number(e.index)
      const issuedQty = Number(e.issuedQty)
      if (!Number.isInteger(index) || index < 0 || index >= cur.lines.length) return err("รายการที่จะแก้ไม่ถูกต้อง — รีเฟรชแล้วลองใหม่", 400)
      const bad = validateLineEdit(cur.lines[index], issuedQty)
      if (bad) return err(bad, 400)
      set[`lines.${index}.issuedQty`] = issuedQty
      set[`lines.${index}.short`] = e.short === true
    }
    const after = await col.findOneAndUpdate(
      { no, status: "PREPARING" },
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: "after", projection: { _id: 0 } },
    )
    if (!after) throw new ConflictError()
    await writeLog({ no, action: "lines", from: "PREPARING", to: "PREPARING", actor: { email: actor.email, name: actor.name, via: actor.via } })
    return NextResponse.json({ request: after })
  })
}
