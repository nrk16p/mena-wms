import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchAtmsBoard, normKey } from "@/lib/atms-board"
import { findAtmsGarage, garageKey } from "@/lib/atms-garage"
import { writeRepairLog } from "@/lib/repair-log"
import { DONE_STATUSES, JOB_TYPE_PARTS } from "@/lib/repair-external"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// POST /api/repair-external/garage-sync { ids: string[] } — ใช้ชื่ออู่ตาม Mena-Next/ATMS กับใบงาน WMS
// server หาคู่เองจากข้อมูล Mena-Next (ไม่เชื่อชื่อที่ client ส่งมา) · ข้ามใบที่ MR คนละใบ (อาจเป็นคนละรอบซ่อม)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  if (!email) return NextResponse.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
  const by = session?.user?.name || email

  const body = await req.json().catch(() => ({}))
  const ids  = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x: string) => ObjectId.isValid(x))
  if (!ids.length) return NextResponse.json({ ok: false, error: "ไม่ได้เลือกใบงาน" }, { status: 400 })

  const db  = (await clientPromise).db(DB)
  const col = db.collection(COLL)
  const [board, docs] = await Promise.all([
    fetchAtmsBoard(),
    col.find({ _id: { $in: ids.map((x: string) => new ObjectId(x)) }, status: { $nin: DONE_STATUSES }, jobType: { $ne: JOB_TYPE_PARTS } }).toArray(),
  ])
  const jobByPlate = new Map(board.jobs.map((j) => [normKey(j.plate), j]))

  const now = new Date()
  const updated: string[] = []
  const skipped: { id: string; reason: string }[] = []
  for (const d of docs) {
    const id  = String(d._id)
    const job = jobByPlate.get(normKey(d.plate))
    if (!job?.vendor) { skipped.push({ id, reason: "ไม่มีงานอู่นอกใน Mena-Next" }); continue }
    if (normKey(d.mrNo) && normKey(d.mrNo) !== normKey(job.mrCode)) { skipped.push({ id, reason: `MR คนละใบ (${d.mrNo} / ${job.mrCode})` }); continue }
    const g = await findAtmsGarage(job.vendor)
    if (!g) { skipped.push({ id, reason: `ไม่พบ "${job.vendor}" ใน ATMS` }); continue }
    if (garageKey(d.garage) === garageKey(g.name) && Number(d.garageAtmsId) === g.atmsId) { skipped.push({ id, reason: "ตรงกันอยู่แล้ว" }); continue }
    await col.updateOne({ _id: d._id }, { $set: { garage: g.name, garageAtmsId: g.atmsId, editedBy: by, updatedAt: now } })
    await writeRepairLog(db, {
      repairId: id,
      plate: String(d.plate ?? ""), fleetNo: String(d.fleetNo ?? ""),
      action: "update",
      by, byEmail: email, at: now,
      changes: [{ field: "garage", label: "อู่ (ตาม Mena-Next/ATMS)", from: String(d.garage ?? ""), to: g.name }],
    })
    updated.push(id)
  }
  return NextResponse.json({ ok: true, updated: updated.length, skipped })
}
