import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

// atms.vehicle_daily (คลัสเตอร์เดียวกับแอป) — 1 แถว/คัน (snapshot ล่าสุด)
// ฟิลด์ไทย: ฟลีท (fleet), แพล้นท์ (plant), เบอร์รถ, ทะเบียน
const ATMS = "atms"
const COLL = "vehicle_daily"

// GET /api/vehicle-daily?plate=สบ.71-4288  (หรือ ?fleetNo=ME887)
// → { fleet, plant, fleetNo, plate }  สำหรับเติมอัตโนมัติในฟอร์มซ่อม
export async function GET(req: NextRequest) {
  const plate   = req.nextUrl.searchParams.get("plate")?.trim()   ?? ""
  const fleetNo = req.nextUrl.searchParams.get("fleetNo")?.trim() ?? ""

  const client = await clientPromise
  const col    = client.db(ATMS).collection(COLL)

  // ?fleets=1 → รายชื่อฟลีททั้งหมด (สำหรับ dropdown)
  if (req.nextUrl.searchParams.get("fleets") === "1") {
    const fleets = (await col.distinct("ฟลีท")).map((f) => String(f ?? "").trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "th"))
    return NextResponse.json(fleets)
  }

  if (!plate && !fleetNo) return NextResponse.json({})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = plate ? { "ทะเบียน": plate } : { "เบอร์รถ": fleetNo }
  const doc = await col.findOne(filter)
  if (!doc) return NextResponse.json({})

  return NextResponse.json({
    fleet:   String(doc["ฟลีท"] ?? "").trim(),
    plant:   String(doc["แพล้นท์"] ?? "").trim(),
    fleetNo: String(doc["เบอร์รถ"] ?? "").trim(),
    plate:   String(doc["ทะเบียน"] ?? "").trim(),
    date:    String(doc["t_date"] ?? "").trim(),   // วันที่ของข้อมูล (ref)
  })
}
