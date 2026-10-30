import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { loadPoItems } from "@/lib/po-export-db"
import { poParseCodes, PO_ITEMS_CHUNK } from "@/lib/po-export"

export const dynamic = "force-dynamic"

// GET /api/po/items?codes=PO1,PO2 (ไม่เกิน PO_ITEMS_CHUNK ใบ) → รายการสินค้าแยกตาม PO
// เป็น GET เพราะคนที่ "ดูอย่างเดียว" ในส่วนงาน PR (เช่นบัญชี) ต้องส่งออก Excel ได้ด้วย
export async function GET(req: NextRequest) {
  const codes = poParseCodes(req.nextUrl.searchParams.get("codes"))
  if (codes === null) return NextResponse.json({ error: `ขอรายการได้ครั้งละไม่เกิน ${PO_ITEMS_CHUNK} ใบ` }, { status: 400 })
  try {
    const atms = (await clientPromise).db("atms")
    return NextResponse.json(await loadPoItems(atms, codes))
  } catch (err) {
    console.error("[api/po/items]", err)
    return NextResponse.json({ error: "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
