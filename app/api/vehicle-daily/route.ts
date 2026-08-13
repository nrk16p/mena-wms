import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

// atms.vehicle_daily (คลัสเตอร์เดียวกับแอป) — 1 แถว/คัน (snapshot ล่าสุด)
// ฟิลด์ไทย: ฟลีท (fleet), แพล้นท์ (plant), เบอร์รถ, ทะเบียน
// เสริมด้วย mena_partner.vehicle_master (รถร่วม/รถที่ยังไม่เข้า ATMS) — มีแค่ทะเบียน+เบอร์รถ
const ATMS = "atms"
const COLL = "vehicle_daily"
const PARTNER_DB = "mena_partner"
const PARTNER_COLL = "vehicle_master"

// ค้นแบบไม่สนจุด/เว้นวรรค/ขีด — "สบ 71-5734", "สบ.71-5734", "715734" เจอคันเดียวกัน
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function looseRegex(q: string): RegExp {
  const chars = q.replace(/[\s.\-_]/g, "").split("")
  if (!chars.length) return /$^/
  return new RegExp(chars.map(escapeRx).join("[\\s.\\-_]*"), "i")
}

type VehicleHit = { plate: string; fleetNo: string; fleet: string; plant: string; date: string }

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

  // ?q=... → ค้นหารายการ (autocomplete ทะเบียน/เบอร์รถ) จาก vehicle_daily + เติมด้วยรถร่วมของ mena-partner
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20"), 50)
    const rx = looseRegex(q)
    const rows = await col
      .find({ $or: [{ "ทะเบียน": rx }, { "เบอร์รถ": rx }] })
      .project({ "ทะเบียน": 1, "เบอร์รถ": 1, "ฟลีท": 1, "แพล้นท์": 1, t_date: 1, _id: 0 })
      .limit(limit * 3)
      .toArray()
    // dedup ตามทะเบียน (1 คัน/รายการ)
    const seen = new Set<string>()
    const out: VehicleHit[] = []
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

    // ยังไม่เต็ม → เติมรถจากทะเบียนรถของ mena-partner (รถร่วม/รถใหม่ที่ยังไม่มีใน ATMS)
    if (out.length < limit) {
      const pRows = await client.db(PARTNER_DB).collection(PARTNER_COLL)
        .find({ $or: [{ licensePlate: rx }, { truckNumber: rx }] })
        .project({ licensePlate: 1, truckNumber: 1, brand: 1, model: 1, _id: 0 })
        .limit(limit)
        .toArray()
      for (const d of pRows) {
        const plate = String(d.licensePlate ?? "").trim()
        if (!plate || seen.has(plate)) continue
        seen.add(plate)
        out.push({
          plate,
          fleetNo: String(d.truckNumber ?? "").trim(),
          fleet:   "",
          plant:   "",
          date:    "",
        })
        if (out.length >= limit) break
      }
    }
    return NextResponse.json(out)
  }

  if (!plate && !fleetNo) return NextResponse.json({})
  // เทียบแบบไม่สนจุด/เว้นวรรค เพื่อให้ค่าที่พิมพ์เองยังเติมฟลีท/แพล้นท์ได้
  const rx = looseRegex(plate || fleetNo)
  const doc = await col.findOne(plate ? { "ทะเบียน": rx } : { "เบอร์รถ": rx })
  if (doc) {
    return NextResponse.json({
      fleet:   String(doc["ฟลีท"] ?? "").trim(),
      plant:   String(doc["แพล้นท์"] ?? "").trim(),
      fleetNo: String(doc["เบอร์รถ"] ?? "").trim(),
      plate:   String(doc["ทะเบียน"] ?? "").trim(),
      date:    String(doc["t_date"] ?? "").trim(),   // วันที่ของข้อมูล (ref)
    })
  }

  // ไม่มีใน ATMS → หาในทะเบียนรถของ mena-partner (ได้แค่ทะเบียน+เบอร์รถ)
  const pDoc = await client.db(PARTNER_DB).collection(PARTNER_COLL)
    .findOne(plate ? { licensePlate: rx } : { truckNumber: rx })
  if (!pDoc) return NextResponse.json({})
  return NextResponse.json({
    fleet:   "",
    plant:   "",
    fleetNo: String(pDoc.truckNumber ?? "").trim(),
    plate:   String(pDoc.licensePlate ?? "").trim(),
    date:    "",
  })
}
