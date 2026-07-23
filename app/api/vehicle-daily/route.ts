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

  // ?q=... → ค้นหารายการ (autocomplete ทะเบียน/เบอร์รถ) จากข้อมูลล่าสุดใน vehicle_daily
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20"), 50)
    const rx = { $regex: q, $options: "i" }
    const rows = await col
      .find({ $or: [{ "ทะเบียน": rx }, { "เบอร์รถ": rx }] })
      .project({ "ทะเบียน": 1, "เบอร์รถ": 1, "ฟลีท": 1, "แพล้นท์": 1, t_date: 1, _id: 0 })
      .limit(limit * 3)
      .toArray()
    // dedup ตามทะเบียน (1 คัน/รายการ)
    const seen = new Set<string>()
    const out: { plate: string; fleetNo: string; fleet: string; plant: string; date: string }[] = []
    for (const d of rows) {
      const plate = String(d["ทะเบียน"] ?? "").trim()
      if (!plate || seen.has(plate)) continue
      seen.add(plate)
      out.push({
        plate,
        fleetNo: String(d["เบอร์รถ"] ?? "").trim(),
        fleet:   String(d["ฟลีท"] ?? "").trim(),
        plant:   String(d["แพล้นท์"] ?? "").trim(),
        date:    String(d["t_date"] ?? "").trim(),
      })
      if (out.length >= limit) break
    }
    return NextResponse.json(out)
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
