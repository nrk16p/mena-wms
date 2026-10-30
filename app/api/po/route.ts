import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { loadPoPage } from "@/lib/po-export-db"
import { poRangeError, PO_MAX_ROWS, PO_PAGE_SIZE, type PoDateField } from "@/lib/po-export"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/po?from=YYYY-MM-DD&to=YYYY-MM-DD&field=po|due&page=0
// ใบสั่งซื้อในช่วงวันที่ (หัวใบ + PR + DD + เบอร์รถ) ทีละหน้า — หน้าเว็บดึงจนครบแล้วกรอง/ส่งออกเอง
// สิทธิ์: ส่วนงาน PR (lib/access-policy.ts) — middleware ตรวจก่อนถึงตรงนี้
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const from = sp.get("from")?.trim() ?? ""
  const to = sp.get("to")?.trim() ?? ""
  const field: PoDateField = sp.get("field") === "due" ? "due" : "po"
  const page = Number(sp.get("page") ?? "0")
  const bad = poRangeError(from, to)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  if (!Number.isInteger(page) || page < 0 || page >= Math.ceil(PO_MAX_ROWS / PO_PAGE_SIZE)) {
    return NextResponse.json({ error: "หน้าที่ขอเกินจำนวนที่ดึงได้" }, { status: 400 })
  }
  try {
    const atms = (await clientPromise).db("atms")
    const out = await loadPoPage(atms, { from, to, field, page })
    return NextResponse.json({ ...out, page, pageSize: PO_PAGE_SIZE })
  } catch (err) {
    console.error("[api/po]", err)
    return NextResponse.json({ error: "โหลดใบสั่งซื้อไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
