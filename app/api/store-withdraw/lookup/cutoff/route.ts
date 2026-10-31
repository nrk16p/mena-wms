// GET /api/store-withdraw/lookup/cutoff?mr=<MR code>&inv= → { lines: [{ skuId, skuCode, skuName, qty, ddCode }] }
//
// สายข้อมูลที่ตั้งใจใช้ (อ่านสำเนา Mongo `atms` อย่างเดียว ผูกกับรหัส MR ตรง ๆ ห้าม scan ทั้ง collection):
//   purchase_requests ที่ "หมายเหตุ" ขึ้นต้น `1.<MR>`  →  purchase_orders ("ใบขอสั่งซื้อ (PR)" = รหัส PR)
//   →  deposit_header.purchase_order (กรองคลัง) →  deposit_items.deposit_id
// ที่ยังทำไม่ได้: deposit_items เก็บแค่ `item` (ข้อความ) / qty / unit_price ไม่มี sku id หรือรหัส SKU
// ตัวเลือกคือเดาจับคู่ชื่อกับ atms_sku_master ซึ่งอาจผิด แต่ใบเบิกต้องใช้ sku id จริง จึงยังไม่เติมรายการให้
// → คืน lines ว่างเสมอ ผู้ขอ/สโตร์เพิ่มรายการเองจากช่องค้นหา SKU · DD มีเฉพาะปี 2026 ขึ้นไป
import { NextResponse, type NextRequest } from "next/server"
import { getActor, guard, isResponse, err } from "@/lib/store-withdraw/http"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getActor(req, true)
    if (isResponse(actor)) return actor
    const mr = (req.nextUrl.searchParams.get("mr") ?? "").trim()
    if (!mr) return err("ใส่รหัสใบแจ้งซ่อม (MR) ที่จะดึงรายการ", 400)
    return NextResponse.json({ lines: [] })
  })
}
