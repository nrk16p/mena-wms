import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchOpenJobByMr, moveNextJobVendor } from "@/lib/atms-board"
import { findAtmsGarage } from "@/lib/atms-garage"
import { writeRepairLog } from "@/lib/repair-log"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }

// POST /api/repair-external/[id]/push-next-garage — ส่งอู่ของใบงานนี้ไป Mena-Next (จับคู่ด้วย MR)
// เรียกหลังบันทึกใบงานแล้ว และเฉพาะเมื่อผู้ใช้ติ๊ก "อัปเดต Mena-Next ด้วย" (ผู้ใช้กำหนด 07/10/2569: ถามก่อนทุกครั้ง)
// อ่านค่าสดจาก Mena-Next ก่อนยิง — อู่ตรงกันอยู่แล้ว = ไม่ยิง (กันเปิดช่วง "ย้ายอู่" ซ้ำ)
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 })
  const session = await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  if (!email) return NextResponse.json({ ok: false, error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })
  const by = session?.user?.name || email

  const db  = (await clientPromise).db(DB)
  const doc = await db.collection(COLL).findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 404 })
  const vendorId = Number(doc.garageAtmsId) || 0
  if (!vendorId) return NextResponse.json({ ok: false, error: "อู่ในใบงานนี้ยังไม่ผูกกับ ATMS — เลือกอู่จากรายการ ATMS ก่อน" }, { status: 400 })
  if (!String(doc.mrNo ?? "").trim()) return NextResponse.json({ ok: false, error: "ใบงานนี้ยังไม่มีเลข MR — จับคู่กับ Mena-Next ไม่ได้" }, { status: 400 })

  let job
  try {
    job = await fetchOpenJobByMr(String(doc.mrNo))
  } catch (e) {
    return NextResponse.json({ ok: false, error: `อ่านข้อมูล Mena-Next ไม่สำเร็จ: ${String(e)}` }, { status: 502 })
  }
  if (!job || !job.jobId) return NextResponse.json({ ok: false, error: `ไม่พบงานอู่นอกที่เปิดอยู่ใน Mena-Next ของ MR ${doc.mrNo}` }, { status: 409 })

  // open-jobs ส่ง vendor_id มาเป็น null บ่อย → ถ้าไม่มี id ใช้ชื่อหา id ใน ATMS
  const currentId = job.vendorId ?? (await findAtmsGarage(job.vendor).catch(() => null))?.atmsId ?? null
  if (currentId === vendorId) return NextResponse.json({ ok: true, skipped: true, message: "อู่ใน Mena-Next ตรงกันอยู่แล้ว" })

  try {
    await moveNextJobVendor(job.jobId, vendorId, by)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 502 })
  }
  // กันโหลดหน้าถัดไปดึงอู่เก่าจาก cache ของ Mena-Next กลับมาทับ (followNextGarages เว้นช่วงนี้)
  await db.collection(COLL).updateOne({ _id: doc._id }, { $set: { nextPushAt: new Date() } })
  await writeRepairLog(db, {
    repairId: id,
    plate: String(doc.plate ?? ""), fleetNo: String(doc.fleetNo ?? ""),
    action: "update",
    by, byEmail: email, at: new Date(),
    changes: [{ field: "nextGarage", label: "อู่ใน Mena-Next (ย้ายอู่)", from: job.vendor || "-", to: String(doc.garage ?? "") }],
  })
  return NextResponse.json({ ok: true, jobId: job.jobId, from: job.vendor, to: doc.garage })
}
