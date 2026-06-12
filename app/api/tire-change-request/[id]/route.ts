import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string }> }

// PATCH /api/tire-change-request/[id] — { action: "approve" | "reject" | "appointment" | "done", ... }
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body   = await req.json()
  const action = String(body.action ?? "")
  const session = await getServerSession(authOptions)
  const by = session?.user?.name || String(body.by ?? "")

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  const doc    = await col.findOne({ _id: new ObjectId(id) })
  if (!doc) return NextResponse.json({ error: "ไม่พบคำขอ" }, { status: 404 })

  const status: string = doc.status ?? "pending"
  const now = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let update: Record<string, any>

  switch (action) {
    case "approve":
      if (status !== "pending") return NextResponse.json({ error: `อนุมัติได้เฉพาะสถานะ pending (ปัจจุบัน: ${status})` }, { status: 409 })
      update = { status: "approved", approvedBy: by, approvedAt: now }
      break

    case "reject":
      if (status !== "pending") return NextResponse.json({ error: `ปฏิเสธได้เฉพาะสถานะ pending (ปัจจุบัน: ${status})` }, { status: 409 })
      update = { status: "rejected", rejectedBy: by, rejectedAt: now, rejectReason: String(body.reason ?? "") }
      break

    case "appointment": {
      if (status !== "approved" && status !== "appointment") {
        return NextResponse.json({ error: `นัดหมายได้หลังอนุมัติแล้วเท่านั้น (ปัจจุบัน: ${status})` }, { status: 409 })
      }
      const date = new Date(String(body.date ?? ""))
      if (isNaN(date.getTime())) return NextResponse.json({ error: "กรุณาระบุวันนัดหมาย" }, { status: 400 })
      update = { status: "appointment", appointmentDate: date, appointmentNote: String(body.note ?? ""), appointmentBy: by, appointmentAt: now }
      break
    }

    case "done":
      if (status !== "appointment") return NextResponse.json({ error: `ปิดงานได้หลังนัดหมายแล้วเท่านั้น (ปัจจุบัน: ${status})` }, { status: 409 })
      update = { status: "done", doneBy: by, doneAt: now }
      break

    default:
      return NextResponse.json({ error: "action must be approve / reject / appointment / done" }, { status: 400 })
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set: { ...update, updatedAt: now } })
  return NextResponse.json({ ok: true, status: update.status })
}
