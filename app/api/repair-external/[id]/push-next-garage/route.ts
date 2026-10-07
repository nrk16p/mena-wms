import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchAtmsBoard, moveNextJobVendor, normKey } from "@/lib/atms-board"
import { currentSegment, resolveNextJob } from "@/lib/next-job-map"
import { writeRepairLog } from "@/lib/repair-log"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
type Params = { params: Promise<{ id: string }> }
// ครั้งแรกต้องไล่อ่าน timeline ของ Mena-Next ~300 งาน (ทำตาราง MR → job_id) — เผื่อเวลาเกิน default
export const maxDuration = 60

// POST /api/repair-external/[id]/push-next-garage — ส่งอู่ของใบงานนี้ไป Mena-Next (จับคู่ด้วย MR)
// เรียกหลังบันทึกใบงานแล้ว และเฉพาะเมื่อผู้ใช้ติ๊ก "อัปเดต Mena-Next ด้วย" (ผู้ใช้กำหนด 07/10/2569: ถามก่อนทุกครั้ง)
// อ่านค่าสดจาก Mena-Next ก่อนยิง — อู่ตรงกันอยู่แล้ว = ไม่ยิง (กันเปิดช่วง "ย้ายอู่" ซ้ำ)
// รหัสงาน Mena-Next ≠ MR id → หาเองจาก timeline (lib/next-job-map.ts) ไม่ต้องให้ทีม Mena-Next แก้อะไร
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
    job = await resolveNextJob(db, String(doc.mrNo))
  } catch (e) {
    return NextResponse.json({ ok: false, error: `อ่านข้อมูล Mena-Next ไม่สำเร็จ: ${String(e instanceof Error ? e.message : e)}` }, { status: 502 })
  }
  // ส่งไม่ได้ (Mena-Next ไม่มีงานของ MR นี้ในตารางงาน / งานปิดแล้ว) → WMS คงอู่ที่คนแก้ไว้
  // จำอู่ที่ Mena-Next แสดงอยู่ตอนนี้ (open-jobs) — followNextGarages จะไม่ดึงอู่นี้กลับมาทับ จนกว่า Mena-Next จะเปลี่ยนเป็นอู่อื่น
  // (บั๊ก 07/10/2569: ME086 จัดซื้อแก้อู่พร้อมออก PO แล้วโดนปรับกลับภายใน 7 วิ)
  if (!job || job.closed_at) {
    const shown = await fetchAtmsBoard()
      .then((b) => b.jobs.find((j) => normKey(j.mrCode) === normKey(doc.mrNo))?.vendor ?? "")
      .catch(() => "")
    await db.collection(COLL).updateOne({ _id: doc._id }, { $set: { nextPushAt: new Date(), nextPushFrom: shown } })
    return NextResponse.json({
      ok: false, kept: true,
      error: !job
        ? `Mena-Next ยังไม่มีงานซ่อมของ MR ${doc.mrNo} ในระบบงาน — ส่งอู่ไปไม่ได้ · อู่ใน WMS คงไว้ตามที่แก้ (ไม่ถูกปรับกลับ)`
        : `งานของ MR ${doc.mrNo} ใน Mena-Next ปิดไปแล้ว — ส่งอู่ไปไม่ได้ · อู่ใน WMS คงไว้ตามที่แก้`,
    }, { status: 409 })
  }

  const seg = currentSegment(job)
  const fromName = seg?.vendor_name || "-"
  if (seg?.repair_mode === "external" && Number(seg.vendor_id) === vendorId) {
    return NextResponse.json({ ok: true, skipped: true, message: "อู่ใน Mena-Next ตรงกันอยู่แล้ว" })
  }

  try {
    await moveNextJobVendor(job.job_id, vendorId, by)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 502 })
  }
  // open-jobs ของ Mena-Next ตามหลัง timeline (ทดสอบจริง 07/10/2569: >40 วิ) — จำอู่ก่อนยิงไว้
  // followNextGarages จะไม่ดึงอู่เก่านี้กลับมาทับ จนกว่า open-jobs จะอัปเดต (หรือพ้น 24 ชม.)
  await db.collection(COLL).updateOne({ _id: doc._id }, { $set: { nextPushAt: new Date(), nextPushFrom: fromName } })
  await writeRepairLog(db, {
    repairId: id,
    plate: String(doc.plate ?? ""), fleetNo: String(doc.fleetNo ?? ""),
    action: "update",
    by, byEmail: email, at: new Date(),
    changes: [{ field: "nextGarage", label: "อู่ใน Mena-Next (ย้ายอู่)", from: fromName, to: String(doc.garage ?? "") }],
  })
  return NextResponse.json({ ok: true, jobId: job.job_id, from: fromName, to: doc.garage })
}
