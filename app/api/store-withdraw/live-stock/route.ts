// GET /api/store-withdraw/live-stock?inv=4&items=CODE:skuId,CODE:skuId → { stock: { [code]: { qty, live } } }
// สต๊อกให้ dialog จัดของ: ของสดจาก ATMS ผ่าน api-ncac ก่อน (live=true) · ล่ม/ไม่เจอ = ใช้ stockQty ในสำเนา atms_sku_master (live=false)
// ไม่เจอทั้งสองทาง = ไม่ใส่คีย์นั้น · สโตร์ (session) เท่านั้น · จำกัด 20 รหัสต่อคำขอ
import { NextResponse, type NextRequest } from "next/server"
import { ATMS_SKU_LIVE_MAX, fetchLiveSku } from "@/lib/atms-sku-live"
import { getStoreActor, guard, isResponse } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getStoreActor(req)
    if (isResponse(actor)) return actor
    const sp = req.nextUrl.searchParams
    const inv = Number(sp.get("inv"))
    const items = (sp.get("items") ?? "").split(",").map((x) => {
      const i = x.lastIndexOf(":")
      return i > 0 ? { code: x.slice(0, i).trim(), skuId: Number(x.slice(i + 1)) } : null
    }).filter((x): x is { code: string; skuId: number } => !!x && !!x.code).slice(0, ATMS_SKU_LIVE_MAX)

    const stock: Record<string, { qty: number; live: boolean }> = {}
    const live = await fetchLiveSku(items.map((x) => x.code))
    // รับของสดเฉพาะแถวที่เป็น SKU เดียวกับบรรทัดในใบ (skuPk ตรง) — ไม่ตรง/ไม่มี = ถอยไปสำเนา
    for (const [code, row] of live) {
      const it = items.find((x) => x.code === code)
      if (it && row.skuPk === it.skuId) stock[code] = { qty: row.stockQty, live: true }
    }

    const missing = items.filter((x) => !(x.code in stock) && Number.isInteger(x.skuId))
    if (missing.length) {
      try {
        const client = await (await import("@/lib/mongo")).default
        const docs = await client.db(process.env.MONGO_DB ?? "master_data").collection("atms_sku_master")
          .find({ skuPk: { $in: missing.map((x) => x.skuId) } }, { projection: { _id: 0, skuPk: 1, stockQty: 1, inventoryId: 1 } }).toArray()
        for (const m of docs) {
          if (Number.isInteger(inv) && inv > 0 && typeof m.inventoryId === "number" && m.inventoryId !== inv) continue
          const it = missing.find((x) => x.skuId === Number(m.skuPk))
          if (it && typeof m.stockQty === "number") stock[it.code] = { qty: m.stockQty, live: false }
        }
      } catch {
        // เงียบ: ไม่มีตัวเลขสต๊อกก็จัดของต่อได้
      }
    }
    return NextResponse.json({ stock })
  })
}
