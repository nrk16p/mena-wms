import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { itemAppointment, rollupRequestStatus } from "@/lib/tire-request-status"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string; itemId: string }> }

type Item = { _id: ObjectId; status?: string; appointmentDate?: Date | null; createdAt?: Date; positionCode?: string; serialNo?: string }

/** ฟิลด์ระดับใบที่ต้องยกไปด้วยตอนแยกยางออกเป็นคำขอใบใหม่ (ดู action "split") */
const CARRY_FIELDS = [
  "branch", "driverName", "plate", "truckNumber", "currentOdometer", "odometerPhoto",
  "fleet", "plant", "vehicleType", "requestedBy", "requestedByEmail", "source",
] as const

// PATCH /api/tire-change-request/[id]/items/[itemId] — { action: "approve" | "reject" | "editJob" | "appointment" | "done" | "split", reason?, jobNo?, date? }
// อนุมัติ/ปฏิเสธยางรายเส้น แล้วคำนวณ status ของ request อัตโนมัติ — หรือแก้ไขเลข Job ของเส้นที่อนุมัติแล้ว (ไม่กระทบ status)
// นัดหมายเป็นรายเส้น (แต่ละล้อนัดคนละวันได้) — request จะขึ้นเป็น appointment เมื่อยางที่อนุมัติมีวันนัดครบทุกเส้น
// done = ปิดงานรายเส้น ทำได้ทันทีที่ล้อนั้นมีวันนัดแล้ว ไม่ต้องรอเส้นอื่นในใบเดียวกัน
// split = ย้ายยางเส้นที่ยังไม่ถูกตัดสินออกไปตั้งเป็นใบใหม่ ให้อนุมัติได้ เมื่อใบเดิมปิดไปแล้ว
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, itemId } = await params
  if (!ObjectId.isValid(id) || !ObjectId.isValid(itemId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const body   = await req.json()
  const action = String(body.action ?? "")
  const ACTIONS = ["approve", "reject", "editJob", "appointment", "done", "split"]
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action must be ${ACTIONS.join(" / ")}` }, { status: 400 })
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

  /**
   * แยกยางเส้นนี้ออกไปตั้งเป็น "คำขอใบใหม่" — ทางออกของเส้นที่ค้างในใบที่ปิดไปแล้ว
   *
   * ใบเดิมไม่ถูกเปิดใหม่: ยางที่นัด/ปิดงานไปแล้วยังคงสถานะเดิมทุกเส้น สิ่งที่เกิดขึ้นคือ
   * เส้นที่ยังไม่มีใครตัดสินย้ายไปอยู่ใบของตัวเอง แล้วอนุมัติ/ปฏิเสธได้ตามปกติ
   *
   * ลำดับ insert ก่อน pull ตั้งใจไว้แบบนี้ — ถ้าจังหวะใดจังหวะหนึ่งพลาด ผลที่ยอมรับได้คือ
   * ยางเส้นเดียวโผล่สองใบ (แก้ตามได้) ไม่ใช่ยางหายไปจากระบบทั้งเส้น (กู้ไม่ได้)
   */
  if (action === "split") {
    if ((target.status ?? "pending") !== "pending") {
      return NextResponse.json({ error: "แยกได้เฉพาะยางเส้นที่ยังไม่ถูกอนุมัติหรือปฏิเสธ" }, { status: 409 })
    }

    // ค่าปกติ: ย้าย "ทุกเส้นที่ยังไม่ถูกตัดสิน" ในใบนี้ไปใบใหม่ใบเดียวกัน
    // เพราะนัดหมาย/ปิดงานเป็นการกระทำระดับใบ — ถ้าแยกเส้นละใบ คนคลังต้องปิดงานหลายรอบตลอดไป
    // ส่ง withSiblings: false มาถ้าอยากหยิบออกทีละเส้นจริง ๆ
    const withSiblings = body.withSiblings !== false
    const moving    = withSiblings ? items.filter((it) => (it.status ?? "pending") === "pending") : [target]
    const movingIds = new Set(moving.map((it) => String(it._id)))
    const remaining = items.filter((it) => !movingIds.has(String(it._id)))

    if (!remaining.length) {
      return NextResponse.json(
        { error: "ทุกเส้นในคำขอนี้ยังไม่ถูกตัดสิน — แยกออกไปก็เหมือนเดิม อนุมัติหรือปฏิเสธได้เลย" },
        { status: 409 },
      )
    }

    // สถานะใบเดิมคิดใหม่จากเส้นที่เหลือ — เส้นที่นัดไว้ครบแล้วจะกลับไปเป็น appointment เอง
    // (ไม่ต้องกดนัดซ้ำหลังแยกใบ) และไม่มีทางค้างเป็น appointment ทั้งที่ยังมีเส้นรอตัดสิน
    const newReqStatus = rollupRequestStatus(remaining, doc.appointmentDate)

    const carried = Object.fromEntries(
      CARRY_FIELDS.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]])
    )
    // คงวันที่คนขับยื่นไว้ (เส้นที่เก่าสุดในกลุ่มที่ย้าย) — "อายุคำขอ" บนหน้าติดตามต้องไม่ถูก
    // รีเซ็ตเพราะการแยกใบ ไม่งั้นเส้นที่รอมา 10 วันจะกลายเป็นของใหม่วันนี้
    const createdAt = moving
      .map((it) => it.createdAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? now

    const fresh = {
      ...carried,
      status: "pending",
      createdAt,
      splitFromRequestId: doc._id,
      splitBy: by,
      splitAt: now,
      items: moving,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted = await col.insertOne(fresh as any)

    await col.updateOne(
      { _id: new ObjectId(id) },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $pull: { items: { _id: { $in: moving.map((it) => new ObjectId(String(it._id))) } } } as any,
        $set: { status: newReqStatus, updatedAt: now },
      }
    )

    return NextResponse.json({
      ok: true,
      requestId: String(inserted.insertedId),
      movedCount: moving.length,
      requestStatus: newReqStatus,
      previousRequestStatus: reqStatus,
    })
  }

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

    // roll up ขึ้น request จากทุกเส้น (นัดครบ + ไม่มีเส้นค้างตัดสิน = appointment)
    const nextItems = items.map((it) => (String(it._id) === itemId ? { ...it, appointmentDate: date } : it))
    const scheduled = nextItems
      .filter((it) => (it.status ?? "pending") === "approved" && !!it.appointmentDate)
      .map((it) => new Date(it.appointmentDate as Date).getTime())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqSet: Record<string, any> = { updatedAt: now, status: rollupRequestStatus(nextItems, doc.appointmentDate) }
    if (scheduled.length > 0) reqSet.appointmentDate = new Date(Math.max(...scheduled))
    await col.updateOne({ _id: new ObjectId(id) }, { $set: reqSet })

    return NextResponse.json({ ok: true, appointmentDate: date, requestStatus: reqSet.status })
  }

  /**
   * ปิดงานรายเส้น — ยางล้อนี้เปลี่ยนเสร็จแล้ว ปิดได้เลยโดยไม่ต้องรอเส้นอื่นในใบเดียวกัน
   *
   * เดิมปิดงานได้แค่ "ทั้งใบ" ซึ่งต้องให้ยางทุกเส้นถูกตัดสินและนัดครบก่อน — รถที่ทยอย
   * เปลี่ยนทีละล้อจึงปิดงานไม่ได้เลยจนกว่าเส้นสุดท้ายจะจบ (เคสจริง T-0003 / สบ.70-6788:
   * RA8+RA7 เปลี่ยนตามนัด 17 ส.ค. แล้ว แต่ค้างเพราะ RA3+F2 ยังไม่มีใครตัดสิน)
   */
  if (action === "done") {
    if (target.status !== "approved") {
      return NextResponse.json({ error: "ปิดงานได้เฉพาะยางเส้นที่อนุมัติแล้ว" }, { status: 409 })
    }
    // ต้องมีวันนัดก่อน — ปิดงานคือยืนยันว่าเปลี่ยนตามนัดแล้ว ไม่ใช่ข้ามขั้นจากอนุมัติ
    if (!itemAppointment(items, target, doc.appointmentDate)) {
      return NextResponse.json({ error: "ยางเส้นนี้ยังไม่มีวันนัดหมาย — กรุณาลงวันนัดก่อนปิดงาน" }, { status: 409 })
    }

    await col.updateOne(
      { _id: new ObjectId(id), "items._id": new ObjectId(itemId) },
      { $set: { "items.$.status": "done", "items.$.doneBy": by, "items.$.doneAt": now } }
    )

    const nextItems = items.map((it) => (String(it._id) === itemId ? { ...it, status: "done" } : it))
    const requestStatus = rollupRequestStatus(nextItems, doc.appointmentDate)
    // ปิดครบทุกเส้นแล้วค่อยปั๊ม doneBy/doneAt ระดับใบ — รายงานเดิมที่อ่านสองฟิลด์นี้
    // จะได้ยังหมายถึง "ทั้งใบจบแล้ว" เหมือนตอนที่ปิดงานได้ทีเดียวทั้งใบ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqSet: Record<string, any> = { status: requestStatus, updatedAt: now }
    if (requestStatus === "done") { reqSet.doneBy = by; reqSet.doneAt = now }
    await col.updateOne({ _id: new ObjectId(id) }, { $set: reqSet })

    return NextResponse.json({ ok: true, itemStatus: "done", requestStatus })
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

  // สถานะใบคิดใหม่จากยางทุกเส้น — เส้นที่เหลือมีวันนัดครบอยู่แล้วจะกลับเป็น appointment เอง
  // ไม่ต้องให้คนกดนัดหมายซ้ำเพียงเพื่อปลดล็อกปุ่มปิดงาน
  const nextItems = items.map((it) =>
    String(it._id) === itemId ? { ...it, status: action === "approve" ? "approved" : "rejected" } : it
  )
  const newStatus = rollupRequestStatus(nextItems, doc.appointmentDate)

  await col.updateOne({ _id: new ObjectId(id) }, { $set: { status: newStatus, updatedAt: now } })

  return NextResponse.json({ ok: true, itemStatus: action === "approve" ? "approved" : "rejected", requestStatus: newStatus })
}
