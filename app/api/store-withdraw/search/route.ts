// GET /api/store-withdraw/search?inv=&q=&days= → { items: QueueItem[] } ค้นใบย้อนหลังของคลัง (session + สิทธิ์ store-queue เหมือนคิว)
// อ่านใบล่าสุดไม่เกิน 500 ใบของคลังในช่วง days วัน (ค่าเริ่ม 90 · สูงสุด 180) แล้วกรองด้วย matchesSearch · คืนไม่เกิน 50 ใบ
import { NextResponse, type NextRequest } from "next/server"
import { countAttachments } from "@/lib/store-withdraw/attachments"
import { searchActive } from "@/lib/store-withdraw/core"
import { err, getStoreActor, guard, isResponse } from "@/lib/store-withdraw/http"
import { SEARCH_DAYS_DEFAULT, SEARCH_DAYS_MAX, searchInventory } from "@/lib/store-withdraw/service"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const sp = req.nextUrl.searchParams
    const inv = Number(sp.get("inv"))
    if (!Number.isInteger(inv) || inv <= 0) return err("ระบุคลัง (inv)", 400)
    const q = (sp.get("q") ?? "").slice(0, 100)
    if (!searchActive(q)) return err("พิมพ์คำค้นอย่างน้อย 2 ตัวอักษร", 400)
    const d = Math.floor(Number(sp.get("days")))
    const days = Number.isFinite(d) && d > 0 ? Math.min(d, SEARCH_DAYS_MAX) : SEARCH_DAYS_DEFAULT
    const items = await searchInventory(inv, q, days)
    const counts = await countAttachments(items.map((i) => i.no))
    return NextResponse.json({ items: items.map((i) => ({ ...i, attachCount: counts.get(i.no) ?? 0 })), days })
  })
}
