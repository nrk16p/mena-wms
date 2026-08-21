import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string }> }

// PATCH /api/tire-change-request/[id] — { action: "appointment" | "done", ... }
// การกระทำระดับ "ใบคำขอ" เท่านั้น · อนุมัติ/ปฏิเสธย้ายไปอยู่ที่ items/[itemId] แล้ว (ตอบ 410)
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

  /**
   * ยางที่ยังไม่มีใครตัดสินในใบนี้ — ห้ามพาใบเดินหน้าไปขั้นนัดหมาย/ปิดงานทั้งที่ยังมีเส้นค้าง
   *
   * ถ้าปล่อยผ่าน เส้นที่ค้างจะกลายเป็นเส้นที่อนุมัติไม่ได้อีกเลย (PATCH items ตอบ 409 เมื่อใบ
   * อยู่ขั้น appointment/done) และหน้ารายละเอียดรถก็ไม่โชว์ให้เห็นด้วยเพราะมันข้ามใบที่ปิดแล้ว
   * — คนขับรอยางฟรี ๆ โดยไม่มีใครรู้ (เคสจริง: สบ.70-5556 / สบ.72-8062 / สบ.71-0323)
   *
   * สถานะใบเป็น "approved" พร้อมกับมีเส้นค้างได้จริงในข้อมูลเก่า จึงเช็คจากตัวเส้นเสมอ
   * ไม่เชื่อสถานะใบเพียงอย่างเดียว
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const undecided = (Array.isArray(doc.items) ? doc.items : []).filter((it: any) => (it.status ?? "pending") === "pending")
  const undecidedList = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    undecided.map((it: any) => String(it.positionCode ?? it.serialNo ?? "?")).join(", ")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let update: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let arrayFilters: Record<string, any>[] | undefined

  switch (action) {
    /**
     * อนุมัติ/ปฏิเสธ "ทั้งใบ" ถูกปิดแล้ว — ต้องตัดสินรายเส้นที่
     * PATCH /api/tire-change-request/[id]/items/[itemId] เท่านั้น
     *
     * ของเดิมเปลี่ยนแค่สถานะใบ ไม่ปั๊มสถานะยางแต่ละเส้นตามไปด้วย ผลคือใบบอกว่า
     * "อนุมัติแล้ว" ทั้งที่ทุกเส้นยังรออนุมัติ — สถานะสองชั้นขัดกันเอง ตัวเลขบน badge/ชิป
     * นับไม่ตรง และเป็นต้นตอที่ทำให้ยางถูกอนุมัติโดยไม่มีเลข Job (เจอในข้อมูลจริง 18 เส้น
     * ที่ สบ.71-8636 / สบ.71-7464 / สบ.71-1569) ซึ่งคลังเบิกยางออกไม่ได้
     *
     * ตัดสินรายเส้นบังคับกรอกเลข Job อยู่แล้ว จึงไม่มีทางหลุดสภาพนั้นอีก
     */
    case "approve":
    case "reject":
      return NextResponse.json(
        {
          error: "อนุมัติ/ปฏิเสธทั้งใบไม่ได้แล้ว — ต้องตัดสินยางเป็นรายเส้น (เลข Job ผูกกับยางแต่ละเส้น)",
          hint: `ใช้ PATCH /api/tire-change-request/${id}/items/{itemId} ด้วย action: "${action}"`,
        },
        { status: 410 },
      )

    case "appointment": {
      if (status !== "approved" && status !== "appointment") {
        return NextResponse.json({ error: `นัดหมายได้หลังอนุมัติแล้วเท่านั้น (ปัจจุบัน: ${status})` }, { status: 409 })
      }
      if (undecided.length) {
        return NextResponse.json(
          { error: `ยังมียางที่รออนุมัติในคำขอนี้ (${undecidedList()}) — กรุณาอนุมัติหรือปฏิเสธให้ครบก่อนนัดหมายทั้งคำขอ` },
          { status: 409 },
        )
      }
      const date = new Date(String(body.date ?? ""))
      if (isNaN(date.getTime())) return NextResponse.json({ error: "กรุณาระบุวันนัดหมาย" }, { status: 400 })
      // นัดทั้งคำขอ = ลงวันเดียวกันให้ยางที่อนุมัติทุกเส้น (รายเส้นแก้วันแยกได้ทีหลังที่ items endpoint)
      update = {
        status: "appointment", appointmentDate: date, appointmentNote: String(body.note ?? ""), appointmentBy: by, appointmentAt: now,
        "items.$[appr].appointmentDate": date, "items.$[appr].appointmentBy": by, "items.$[appr].appointmentAt": now,
      }
      arrayFilters = [{ "appr.status": "approved" }]
      break
    }

    case "done":
      if (status !== "appointment") return NextResponse.json({ error: `ปิดงานได้หลังนัดหมายแล้วเท่านั้น (ปัจจุบัน: ${status})` }, { status: 409 })
      // ปิดงานทับเส้นที่ยังไม่ตัดสิน = ทางตันถาวร — นี่คือจังหวะที่ทำให้ สบ.70-5556 พัง
      // (คนขับยื่น RB1/RB2 เวลา 07:46 แล้วมีคนกดปิดงานใบเดิม 07:51)
      if (undecided.length) {
        return NextResponse.json(
          { error: `ยังมียางที่รออนุมัติในคำขอนี้ (${undecidedList()}) — ปิดงานไม่ได้ กรุณาตัดสินให้ครบ หรือแยกเส้นที่ยังไม่พร้อมออกเป็นคำขอใบใหม่ก่อน` },
          { status: 409 },
        )
      }
      // ปิดทั้งใบ = ปั๊มสถานะ done ลงยางทุกเส้นที่อนุมัติด้วย ไม่ใช่แค่หัวใบ —
      // ตั้งแต่มีปิดงานรายเส้น สถานะเส้นคือแหล่งความจริง ถ้าปล่อยเส้นไว้ที่ approved
      // หน้าจอจะยังโชว์ปุ่ม "ปิดงาน" ของเส้นนั้นทั้งที่ใบปิดไปแล้ว
      update = {
        status: "done", doneBy: by, doneAt: now,
        "items.$[appr].status": "done", "items.$[appr].doneBy": by, "items.$[appr].doneAt": now,
      }
      arrayFilters = [{ "appr.status": "approved" }]
      break

    default:
      return NextResponse.json({ error: "action must be appointment / done (อนุมัติ/ปฏิเสธ ใช้ endpoint รายเส้น)" }, { status: 400 })
  }

  await col.updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...update, updatedAt: now } },
    arrayFilters ? { arrayFilters } : {}
  )
  return NextResponse.json({ ok: true, status: update.status })
}
