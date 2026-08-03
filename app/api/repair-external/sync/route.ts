import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { DONE_STATUSES, JOB_TYPE_GARAGE, JOB_TYPE_PARTS } from "@/lib/repair-external"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// กัน regex พิเศษจาก input ภายนอก (endpoint นี้เปิด public)
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// GET /api/repair-external/sync?vehicle=<ทะเบียนหรือเบอร์รถ>&scope=active|done&type=อู่นอก|อะไหล่ลงคัน&limit=100
// Public read-only endpoint สำหรับทีมภายนอก sync ข้อมูลงานอู่นอก + อะไหล่ลงคัน
// ค้นหาด้วยทะเบียน (plate) หรือเบอร์รถ (fleetNo) อย่างใดอย่างหนึ่งด้วย parameter เดียว
// ไม่ส่ง scope = งานที่เปิดอยู่ทั้งหมด + งานปิดแล้ว (รถเสร็จ/ลงคันเสร็จ) เฉพาะรายการล่าสุด 1 รายการ
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const vehicle = searchParams.get("vehicle")?.trim() ?? ""
  const scope   = searchParams.get("scope")?.trim()   ?? ""
  const type    = searchParams.get("type")?.trim()    ?? ""
  const limit   = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100") || 100, 1), 500)

  if (!vehicle) {
    return NextResponse.json(
      { ok: false, error: "กรุณาระบุ ?vehicle= ทะเบียนหรือเบอร์รถ (เช่น ?vehicle=70-1234 หรือ ?vehicle=M123)" },
      { status: 400 }
    )
  }

  const rx = { $regex: escapeRegex(vehicle), $options: "i" }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: Record<string, any> = { $or: [{ plate: rx }, { fleetNo: rx }] }
  // เอกสารเก่าไม่มี jobType = อู่นอก
  if (type === JOB_TYPE_PARTS)       base.jobType = JOB_TYPE_PARTS
  else if (type === JOB_TYPE_GARAGE) base.jobType = { $ne: JOB_TYPE_PARTS }
  // ตัด field รูปภาพออก — payload ใหญ่และไม่จำเป็นสำหรับการ sync สถานะ
  const projection = { images: 0, negotiationImages: 0 }
  const sort = { receivedDate: -1 as const, _id: -1 as const }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  let items
  if (scope === "done") {
    items = await col.find({ ...base, status: { $in: DONE_STATUSES } })
      .project(projection).sort(sort).limit(limit).toArray()
  } else if (scope === "active") {
    items = await col.find({ ...base, status: { $nin: DONE_STATUSES } })
      .project(projection).sort(sort).limit(limit).toArray()
  } else {
    // default: งานที่ยังไม่เสร็จทั้งหมด + งานปิดแล้วล่าสุด 1 รายการ
    const [active, latestDone] = await Promise.all([
      col.find({ ...base, status: { $nin: DONE_STATUSES } })
        .project(projection).sort(sort).limit(limit).toArray(),
      col.find({ ...base, status: { $in: DONE_STATUSES } })
        .project(projection).sort(sort).limit(1).toArray(),
    ])
    items = [...active, ...latestDone]
  }

  return NextResponse.json({ ok: true, vehicle, scope: scope || "default", type: type || "all", count: items.length, items })
}
