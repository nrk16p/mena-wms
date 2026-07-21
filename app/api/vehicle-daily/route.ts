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
  if (!plate && !fleetNo) return NextResponse.json({})

  const client = await clientPromise
  const col    = client.db(ATMS).collection(COLL)
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
