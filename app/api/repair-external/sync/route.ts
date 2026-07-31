import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// กัน regex พิเศษจาก input ภายนอก (endpoint นี้เปิด public)
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// GET /api/repair-external/sync?vehicle=<ทะเบียนหรือเบอร์รถ>&scope=active|done&limit=100
// Public read-only endpoint สำหรับทีมภายนอก sync ข้อมูลรถซ่อมอู่นอก
// ค้นหาด้วยทะเบียน (plate) หรือเบอร์รถ (fleetNo) อย่างใดอย่างหนึ่งด้วย parameter เดียว
// ไม่ส่ง scope = งานที่เปิดอยู่ทั้งหมด + รถเสร็จเฉพาะรายการล่าสุด 1 รายการ
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const vehicle = searchParams.get("vehicle")?.trim() ?? ""
  const scope   = searchParams.get("scope")?.trim()   ?? ""
  const limit   = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100") || 100, 1), 500)

  if (!vehicle) {
    return NextResponse.json(
      { ok: false, error: "กรุณาระบุ ?vehicle= ทะเบียนหรือเบอร์รถ (เช่น ?vehicle=70-1234 หรือ ?vehicle=M123)" },
      { status: 400 }
    )
  }

  const rx = { $regex: escapeRegex(vehicle), $options: "i" }
  const vehicleFilter = { $or: [{ plate: rx }, { fleetNo: rx }] }
  // ตัด field รูปภาพออก — payload ใหญ่และไม่จำเป็นสำหรับการ sync สถานะ
  const projection = { images: 0, negotiationImages: 0 }
  const sort = { receivedDate: -1 as const, _id: -1 as const }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  let items
  if (scope === "done") {
    items = await col.find({ ...vehicleFilter, status: "รถเสร็จ" })
      .project(projection).sort(sort).limit(limit).toArray()
  } else if (scope === "active") {
    items = await col.find({ ...vehicleFilter, status: { $ne: "รถเสร็จ" } })
      .project(projection).sort(sort).limit(limit).toArray()
  } else {
    // default: งานที่ยังไม่เสร็จทั้งหมด + รถเสร็จล่าสุด 1 รายการ
    const [active, latestDone] = await Promise.all([
      col.find({ ...vehicleFilter, status: { $ne: "รถเสร็จ" } })
        .project(projection).sort(sort).limit(limit).toArray(),
      col.find({ ...vehicleFilter, status: "รถเสร็จ" })
        .project(projection).sort(sort).limit(1).toArray(),
    ])
    items = [...active, ...latestDone]
  }

  return NextResponse.json({ ok: true, vehicle, scope: scope || "default", count: items.length, items })
}
