import { NextRequest, NextResponse } from "next/server"
import { sheetDb, getOptions } from "@/lib/tyre-sheet-db"
import { ROWS_COLL, computeRow, toNum, type AnyRow } from "@/lib/tyre-sheet"

/**
 * GET /api/tyre-sheet/cpk?from=2026-01&to=2026-11&symptom=ปกติ
 * ส่งแถวยางนอกที่ส่งข้อมูลแล้ว (กลุ่มอาการปกติ) แบบตัดช่องให้เหลือเท่าที่ dashboard ใช้
 * หน้าเว็บเอาไปรวมกลุ่มเอง (ข้อมูลทั้งปี ~1 พันแถว) จะได้เปลี่ยนตัวกรอง/แตกคอลัมน์ได้ทันทีไม่ต้องยิงใหม่
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symptom = (sp.get("symptom") ?? "ปกติ").trim() || "ปกติ"
  const filter: AnyRow = { stage: "sent", symptom }
  const from = sp.get("from") ?? "", to = sp.get("to") ?? ""
  const range: AnyRow = {}
  if (/^\d{4}-\d{2}$/.test(from)) range.$gte = `${from}-01`
  if (/^\d{4}-\d{2}$/.test(to)) range.$lte = `${to}-31`
  if (Object.keys(range).length) filter.bookingDate = range

  const db = await sheetDb()
  const [docs, opts] = await Promise.all([
    db.collection(ROWS_COLL).find(filter).sort({ bookingDate: 1, seq: 1 }).limit(5000).toArray(),
    getOptions(db),
  ])
  const rows = docs.map((d) => {
    const r = computeRow(d, opts)
    return {
      id: String(d._id),
      size: r.size ?? null,
      bookingDate: r.bookingDate ?? null,
      plate: r.plate ?? "",
      position: r.position ?? "",
      mrNo: r.mrNo ?? "",
      oldSerial: r.oldSerial ?? "",
      brand: String(r.brand ?? "").trim(),
      headTail: r.headTail ?? "",
      price: toNum(r.price),
      km: toNum(r.mileageDiff),
      mileagePrev: toNum(r.mileagePrev),
      ratedKm: toNum(r.ratedKm),
      bpk: toNum(r.bpk),
    }
  })
  return NextResponse.json({ rows })
}
