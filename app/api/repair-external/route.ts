import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { writeRepairLog } from "@/lib/repair-log"
import { JOB_TYPE_GARAGE, JOB_TYPE_PARTS, DONE_STATUSES, isDoneStatus } from "@/lib/repair-external"
import { normalizeImages } from "@/lib/media"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// แปลง body → doc ที่จะบันทึก (ใช้ร่วมกับ PUT ผ่าน buildDoc)
export function buildDoc(body: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? "").trim()
  return {
    jobType:      s(body.jobType) === JOB_TYPE_PARTS ? JOB_TYPE_PARTS : JOB_TYPE_GARAGE,
    receivedDate:  s(body.receivedDate),
    garageInDate:  s(body.garageInDate),
    dueDate:       s(body.dueDate),
    completedDate: s(body.completedDate),
    mrNo:         s(body.mrNo),
    symptom:      s(body.symptom),
    plate:        s(body.plate),
    fleetNo:      s(body.fleetNo),
    driverName:   s(body.driverName),
    driverPhone:  s(body.driverPhone),
    breakdownLocation: s(body.breakdownLocation),
    cementStatus: s(body.cementStatus),
    fleet:        s(body.fleet),
    plant:        s(body.plant),
    garage:       s(body.garage),
    status:       s(body.status),
    prCode:       s(body.prCode),
    poCode:       s(body.poCode),
    note:         s(body.note),
    repairPrice:  Number(body.repairPrice) || 0,
    warranty:     s(body.warranty),
    negotiationScope: s(body.negotiationScope) || "ทั้งหมด",
    negotiationItem:  s(body.negotiationItem),
    offerPrice:      Number(body.offerPrice) || 0,
    negotiatedPrice: Number(body.negotiatedPrice) || 0,
    offerWarranty:   s(body.offerWarranty),
    negotiationImages: normalizeImages(body.negotiationImages),
    images:       normalizeImages(body.images),
  }
}

// GET /api/repair-external?q=&status=&garage=&plate=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&limit=500
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q        = searchParams.get("q")?.trim()        ?? ""
  const status   = searchParams.get("status")?.trim()   ?? ""
  const scope    = searchParams.get("scope")?.trim()    ?? ""  // active = ยังไม่เสร็จ, done = รถเสร็จ/ลงคันเสร็จ
  const type     = searchParams.get("type")?.trim()     ?? ""  // อู่นอก | อะไหล่ลงคัน (ว่าง = ทั้งหมด)
  const garage    = searchParams.get("garage")?.trim()    ?? ""
  const fleet     = searchParams.get("fleet")?.trim()     ?? ""
  const createdBy = searchParams.get("createdBy")?.trim() ?? ""
  const editedBy  = searchParams.get("editedBy")?.trim()  ?? ""
  const plate    = searchParams.get("plate")?.trim()    ?? ""
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? ""
  const dateTo   = searchParams.get("dateTo")?.trim()   ?? ""
  const limit    = Math.min(parseInt(searchParams.get("limit") ?? "500"), 2000)

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (status)               filter.status = status
  else if (scope === "done")   filter.status = { $in: DONE_STATUSES }
  else if (scope === "active") filter.status = { $nin: DONE_STATUSES }
  // เอกสารเก่าไม่มี jobType = อู่นอก
  if (type === JOB_TYPE_PARTS)       filter.jobType = JOB_TYPE_PARTS
  else if (type === JOB_TYPE_GARAGE) filter.jobType = { $ne: JOB_TYPE_PARTS }
  if (garage)    filter.garage    = garage
  if (fleet)     filter.fleet     = fleet
  if (createdBy) filter.createdBy = createdBy
  if (editedBy)  filter.editedBy  = editedBy
  if (plate)  filter.plate  = { $regex: plate, $options: "i" }
  if (dateFrom || dateTo) {
    filter.receivedDate = {}
    if (dateFrom) filter.receivedDate.$gte = dateFrom
    if (dateTo)   filter.receivedDate.$lte = dateTo
  }
  if (q) {
    filter["$or"] = [
      { mrNo:    { $regex: q, $options: "i" } },
      { plate:   { $regex: q, $options: "i" } },
      { fleetNo: { $regex: q, $options: "i" } },
      { symptom: { $regex: q, $options: "i" } },
      { garage:  { $regex: q, $options: "i" } },
      { prCode:  { $regex: q, $options: "i" } },
      { poCode:  { $regex: q, $options: "i" } },
      { note:    { $regex: q, $options: "i" } },
    ]
  }

  const items = await col
    .find(filter)
    .sort({ receivedDate: -1, _id: -1 })
    .limit(limit)
    .toArray()

  return NextResponse.json(items)
}

// POST /api/repair-external — เพิ่มรายการซ่อมใหม่
export async function POST(req: NextRequest) {
  const body = await req.json()
  const doc  = buildDoc(body)
  if (!doc.plate)  return NextResponse.json({ error: "กรุณาระบุทะเบียนรถ" }, { status: 400 })
  if (!doc.status) return NextResponse.json({ error: "กรุณาเลือกสถานะ" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const client  = await clientPromise
  const db      = client.db(DB)
  const col     = db.collection(COLL)

  // กันซ้ำ: รถคันเดียวกัน (ทะเบียน "หรือ" เบอร์รถ ตรงกัน) มีรายการที่ยัง "ไม่เสร็จ" ได้แค่ 1 รายการ
  // นับรวมทุกประเภท (อู่นอก + อะไหล่ลงคัน เปิดพร้อมกันไม่ได้)
  if (!isDoneStatus(doc.status)) {
    const or: Record<string, string>[] = [{ plate: doc.plate }]
    if (doc.fleetNo) or.push({ fleetNo: doc.fleetNo })
    const dup = await col.findOne({ status: { $nin: DONE_STATUSES }, $or: or })
    if (dup) {
      const which = dup.plate === doc.plate ? `ทะเบียน ${doc.plate}` : `เบอร์รถ ${doc.fleetNo}`
      return NextResponse.json({ error: `รถ ${which} มีรายการ (${dup.jobType || "อู่นอก"}) ที่ยังไม่เสร็จอยู่แล้ว เปิดใหม่ไม่ได้ (ต้องปิดงานหรือลบรายการเดิมก่อน)` }, { status: 409 })
    }
  }

  const now   = new Date()
  const today = now.toISOString().slice(0, 10)
  const by    = session?.user?.name || session?.user?.email || ""
  const result = await col.insertOne({ ...doc, statusSince: today, createdBy: by, editedBy: by, createdAt: now, updatedAt: now })
  await writeRepairLog(db, {
    repairId: result.insertedId.toString(),
    plate: doc.plate, fleetNo: doc.fleetNo,
    action: "create",
    by:      session?.user?.name  || "",
    byEmail: session?.user?.email || "",
    at: now,
    statusChange: { from: "", to: doc.status },
  })
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
