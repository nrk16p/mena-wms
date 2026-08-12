import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  fetchHandoverData, fetchDrivers, assignTruck, updateDriverStatus, normTruckNum,
} from "@/lib/driver-handover"
import { ACTIVE_STATUSES } from "@/lib/driver-handover-meta"

export const dynamic = "force-dynamic"

const s = (v: unknown) => String(v ?? "").trim()

// GET — ข้อมูลรวม: พจส.ใหม่จากชีต + รถจาก fleet/open-jobs
export async function GET() {
  try {
    const data = await fetchHandoverData()
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}

// POST — ยืนยันรถให้ พจส. (เขียนเบอร์รถ+ทะเบียนกลับชีต)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const row = Number(body.row) || 0
  const name = s(body.name)
  const trucknum = s(body.trucknum)
  const plate = s(body.plate)
  if (!row || !name) return NextResponse.json({ error: "ข้อมูลแถว/ชื่อ พจส. ไม่ครบ" }, { status: 400 })
  if (!trucknum) return NextResponse.json({ error: "กรุณาระบุเบอร์รถ" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  try {
    // กันจองซ้ำ: เช็คว่าเบอร์รถนี้ยังไม่ถูกจองโดย พจส. active คนอื่น
    const drivers = await fetchDrivers()
    const dup = drivers.find(
      (d) => d.truckNum && normTruckNum(d.truckNum) === normTruckNum(trucknum) &&
        (ACTIVE_STATUSES as readonly string[]).includes(d.status) &&
        !(d.row === row && d.name === name)
    )
    if (dup)
      return NextResponse.json(
        { error: `เบอร์รถ ${trucknum} ถูกจองให้ ${dup.name} (${dup.status}) แล้ว` },
        { status: 409 }
      )

    const result = await assignTruck({
      row, code: s(body.code), name, trucknum, plate, by, note: s(body.note),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}

// PATCH — อัปเดตสถานะ พจส. (เขียนสถานะ+วันที่กลับชีต)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const row = Number(body.row) || 0
  const name = s(body.name)
  const toStatus = s(body.toStatus)
  if (!row || !name) return NextResponse.json({ error: "ข้อมูลแถว/ชื่อ พจส. ไม่ครบ" }, { status: 400 })
  if (!toStatus) return NextResponse.json({ error: "กรุณาระบุสถานะใหม่" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  try {
    const result = await updateDriverStatus({
      row, code: s(body.code), name,
      fromStatus: s(body.fromStatus), toStatus, by, note: s(body.note),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = String(e)
    const status = msg.includes("ไม่อยู่ในรายการ") || msg.includes("ไม่พบแถว") ? 400 : 502
    return NextResponse.json({ ok: false, error: msg }, { status })
  }
}
