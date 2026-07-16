import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string; itemId: string }> }

type Item = { _id: ObjectId; status?: string }

// PATCH /api/tire-change-request/[id]/items/[itemId] — { action: "approve" | "reject" | "editJob", reason?, jobNo? }
// อนุมัติ/ปฏิเสธยางรายเส้น แล้วคำนวณ status ของ request อัตโนมัติ — หรือแก้ไขเลข Job ของเส้นที่อนุมัติแล้ว (ไม่กระทบ status)
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, itemId } = await params
  if (!ObjectId.isValid(id) || !ObjectId.isValid(itemId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const body   = await req.json()
  const action = String(body.action ?? "")
  if (action !== "approve" && action !== "reject" && action !== "editJob") {
    return NextResponse.json({ error: "action must be approve / reject / editJob" }, { status: 400 })
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
