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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = { $or: [{ plate: rx }, { fleetNo: rx }] }
  if (scope === "done")        filter.status = "รถเสร็จ"
  else if (scope === "active") filter.status = { $ne: "รถเสร็จ" }

  const client = await clientPromise
  const items  = await client
    .db(DB)
    .collection(COLL)
    .find(filter)
    // ตัด field รูปภาพออก — payload ใหญ่และไม่จำเป็นสำหรับการ sync สถานะ
    .project({ images: 0, negotiationImages: 0 })
    .sort({ receivedDate: -1, _id: -1 })
    .limit(limit)
    .toArray()

  return NextResponse.json({ ok: true, vehicle, scope: scope || "all", count: items.length, items })
}
