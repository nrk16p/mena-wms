// GET /api/store-withdraw/lookup/{mr|sku|serial|wd|po|dd|pr|mrv}?q=&limit=&inv=&sku_id= — ค้นข้อมูล ATMS ด้วยบัญชีค้นข้อมูลของ WMS
// pr: q = ทะเบียน/เบอร์รถ → 5 ใบ PR ล่าสุดของรถคันนั้น (มี remark)
// mrv: q = ทะเบียน/เบอร์รถ → หัวใบแจ้งซ่อม (MR) 5 ใบล่าสุดของรถคันนั้น
// sku: รวมสต๊อกจาก atms_sku_master (stockQty, ไม่มี = null)
import { NextResponse, type NextRequest } from "next/server"
import { clampLimit } from "@/lib/store-withdraw/core"
import { getActor, guard, isResponse, err, type RouteCtx } from "@/lib/store-withdraw/http"
import { lookup, lookupKind } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

const optNum = (v: string | null) => { const n = Number(v); return v && Number.isInteger(n) && n > 0 ? n : undefined }

export function GET(req: NextRequest, ctx: RouteCtx<{ kind: string }>) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const kind = lookupKind((await ctx.params).kind)
    if (!kind) return err("ชนิดการค้นหาไม่ถูกต้อง (mr, mrv, sku, serial, wd, po, dd, pr)", 400)
    const sp = req.nextUrl.searchParams
    const q = (sp.get("q") ?? "").trim()
    if (q.length < 2) return NextResponse.json({ results: [] })
    const limit = clampLimit(sp.get("limit"), 20, 50)
    const results = await lookup(kind, q, limit, optNum(sp.get("inv") ?? sp.get("inventory_id")), optNum(sp.get("sku_id")))
    return NextResponse.json({ results })
  })
}
