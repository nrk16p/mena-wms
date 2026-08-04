import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string; itemId: string }> }

type Item = { _id: ObjectId; status?: string; appointmentDate?: Date | null }

// PATCH /api/tire-change-request/[id]/items/[itemId] — { action: "approve" | "reject" | "editJob" | "appointment", reason?, jobNo?, date? }
// อนุมัติ/ปฏิเสธยางรายเส้น แล้วคำนวณ status ของ request อัตโนมัติ — หรือแก้ไขเลข Job ของเส้นที่อนุมัติแล้ว (ไม่กระทบ status)
// นัดหมายเป็นรายเส้น (แต่ละล้อนัดคนละวันได้) — request จะขึ้นเป็น appointment เมื่อยางที่อนุมัติมีวันนัดครบทุกเส้น
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, itemId } = await params
  if (!ObjectId.isValid(id) || !ObjectId.isValid(itemId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const body   = await req.json()
  const action = String(body.action ?? "")
  if (action !== "approve" && action !== "reject" && action !== "editJob" && action !== "appointment") {
    return NextResponse.json({ error: "action must be approve / reject / editJob / appointment" }, { status: 400 })
  }

  const jobNo = String(body.jobNo ?? "").trim()
  if ((action === "approve" || action === "editJob") && !jobNo) {
    return NextResponse.json({ error: "กรุณาระบุเลข Job" }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || String(body.by ?? "")
  const now = new Date()

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)

  const doc = await col.findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 })

  const items: Item[] = Array.isArray(doc.items) ? doc.items : []
  const target = items.find((it) => String(it._id) === itemId)
  if (!target) return NextResponse.json({ error: "ไม่พบยางเส้นนี้ในคำขอ" }, { status: 404 })

  if (action === "editJob") {
    if (target.status !== "approved") {
      return NextResponse.json({ error: "แก้ไขเลข Job ได้เฉพาะเส้นที่อนุมัติแล้ว" }, { status: 409 })
    }
    await col.updateOne(
      { _id: new ObjectId(id), "items._id": new ObjectId(itemId) },
      { $set: { "items.$.jobNo": jobNo, "items.$.jobNoUpdatedBy": by, "items.$.jobNoUpdatedAt": now } }
    )
    return NextResponse.json({ ok: true, jobNo })
  }

  const reqStatus: string = doc.status ?? "pending"

  if (action === "appointment") {
    if (target.status !== "approved") {
      return NextResponse.json({ error: "นัดหมายได้เฉพาะยางเส้นที่อนุมัติแล้ว" }, { status: 409 })
    }
    if (reqStatus === "done") {
      return NextResponse.json({ error: "แก้ไขไม่ได้ — คำขอปิดงานแล้ว" }, { status: 409 })
    }
    const date = new Date(String(body.date ?? ""))
    if (isNaN(date.getTime())) return NextResponse.json({ error: "กรุณาระบุวันนัดหมาย" }, { status: 400 })

    await col.updateOne(
      { _id: new ObjectId(id), "items._id": new ObjectId(itemId) },
      { $set: { "items.$.appointmentDate": date, "items.$.appointmentBy": by, "items.$.appointmentAt": now } }
    )

    // roll up ขึ้น request: นัดครบทุกเส้นที่อนุมัติ (และไม่มีเส้นค้างอนุมัติ) → appointment
    const approved = items
      .filter((it) => (it.status ?? "pending") === "approved")
      .map((it) => (String(it._id) === itemId ? date : it.appointmentDate ?? null))
    const hasPending  = items.some((it) => (it.status ?? "pending") === "pending")
    const scheduled   = approved.filter((d): d is Date => !!d).map((d) => new Date(d).getTime())
    const allSchedule = approved.length > 0 && scheduled.length === approved.length

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqSet: Record<string, any> = { updatedAt: now }
    if (scheduled.length > 0) reqSet.appointmentDate = new Date(Math.max(...scheduled))
    if (!hasPending) reqSet.status = allSchedule ? "appointment" : "approved"
    await col.updateOne({ _id: new ObjectId(id) }, { $set: reqSet })

    return NextResponse.json({ ok: true, appointmentDate: date, requestStatus: reqSet.status ?? reqStatus })
  }

  if (reqStatus === "appointment" || reqStatus === "done") {
    return NextResponse.json({ error: `แก้ไขไม่ได้ — คำขออยู่สถานะ ${reqStatus} แล้ว` }, { status: 409 })
  }

  const itemSet =
    action === "approve"
      ? { "items.$.status": "approved", "items.$.approvedBy": by, "items.$.approvedAt": now, "items.$.jobNo": jobNo }
      : { "items.$.status": "rejected", "items.$.rejectedBy": by, "items.$.rejectedAt": now, "items.$.rejectReason": String(body.reason ?? "") }

  await col.updateOne(
    { _id: new ObjectId(id), "items._id": new ObjectId(itemId) },
    { $set: itemSet }
  )

  // derive request status from item decisions
  const statuses = items.map((it) =>
    String(it._id) === itemId ? (action === "approve" ? "approved" : "rejected") : (it.status ?? "pending")
  )
  const newStatus = statuses.includes("pending")
    ? "pending"
    : statuses.includes("approved") ? "approved" : "rejected"

  await col.updateOne({ _id: new ObjectId(id) }, { $set: { status: newStatus, updatedAt: now } })

  return NextResponse.json({ ok: true, itemStatus: action === "approve" ? "approved" : "rejected", requestStatus: newStatus })
}
