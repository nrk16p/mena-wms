import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { splitPosition, tireAge, remainingLevel } from "@/lib/tire"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-change-request/lookup?branch=latkrabang&plate=สบ.71-3569&odometer=250000
// endpoint เดียวจบสำหรับหน้า Change Tire Request — คืนตารางประวัติยางพร้อมค่าคำนวณครบทุกคอลัมน์
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch   = searchParams.get("branch")?.trim() ?? ""
  const plate    = searchParams.get("plate")?.trim()  ?? ""
  const odometer = Number(String(searchParams.get("odometer") ?? "").replace(/,/g, "")) || 0

  if (!branch) return NextResponse.json({ error: "branch is required" }, { status: 400 })
  if (!plate)  return NextResponse.json({ error: "plate is required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)

  const [history, vehicle, requests] = await Promise.all([
    db.collection("tire_change")
      .find({ branch, vehicle: plate, sellRepairStatus: "อื่นๆ" })
      .limit(500)
      .toArray(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.collection("vehicle_master").findOne({ plate } as any, {
      projection: { plate: 1, vehicleType: 1, brand: 1, model: 1, fleet: 1, fleetNo: 1, plant: 1, year: 1, fuelType: 1 },
    }),
    db.collection("tire_change_request")
      .find({ branch, plate, "items.0": { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
  ])

  // stock join by serial
  const serials = [...new Set(history.map((h) => String(h.serialNo ?? "").trim()).filter(Boolean))]
  const stock = serials.length > 0
    ? await db.collection("tire_stock").find({ branch, serialNo: { $in: serials } }).toArray()
    : []
  const stockMap = new Map(stock.map((s) => [String(s.serialNo).trim(), s]))

  // serial → สถานะคำขอที่ยังค้างอยู่ (ข้าม done/rejected; คำขอใหม่สุดชนะ)
  const statusMap = new Map<string, { itemStatus: string; requestStatus: string; appointmentDate: Date | null }>()
  for (const r of requests) {
    const rStatus = (r.status as string) ?? "pending"
    if (rStatus === "done" || rStatus === "rejected") continue
    for (const it of (r.items ?? []) as { serialNo?: string; status?: string }[]) {
      const iStatus = it.status ?? "pending"
      const key = String(it.serialNo ?? "").trim()
      if (iStatus === "rejected" || !key || statusMap.has(key)) continue
      statusMap.set(key, { itemStatus: iStatus, requestStatus: rStatus, appointmentDate: r.appointmentDate ?? null })
    }
  }

  // current tires (ล่าสุด = yes) first, then by position
  history.sort((a, b) =>
    Number(!!b.isLatest) - Number(!!a.isLatest) ||
    String(a.tirePosition ?? "").localeCompare(String(b.tirePosition ?? ""), "th")
  )

  const items = history.map((h) => {
    const serialNo     = String(h.serialNo ?? "").trim()
    const mileageStart = Number(h.mileageStart) || 0
    const pos          = splitPosition(String(h.tirePosition ?? ""))
    const s            = stockMap.get(serialNo)
    const unitPrice    = s ? Number(s.unitPrice) || 0 : null
    const stockDistance = s ? Number(s.distance) || 0 : null

    // ระยะทางใช้งาน = เลขไมล์ปัจจุบัน - ไมล์เริ่มต้น
    const usedDistance = odometer > 0 && mileageStart > 0 ? odometer - mileageStart : null

    // ประสิทธิภาพคงเหลือ % (ติดลบได้)
    let remainingPct: number | null = null
    if (stockDistance !== null && stockDistance > 0 && usedDistance !== null) {
      remainingPct = Math.round((1 - usedDistance / stockDistance) * 100)
    }

    // บาทต่อกิโล
    let bahtPerKm: number | null = null
    if (unitPrice !== null && unitPrice > 0 && usedDistance !== null && usedDistance > 0) {
      bahtPerKm = Math.round((unitPrice / usedDistance) * 10000) / 10000
    }

    return {
      _id:           h._id,
      vehicle:       h.vehicle ?? "",
      tirePosition:  h.tirePosition ?? "",
      positionCode:  pos.code,
      positionName:  pos.name,
      product:       h.product ?? "",
      serialNo,
      treadMm:       Number(h.treadMm) || 0,
      mileageStart,
      mileageEnd:    Number(h.mileageEnd) || 0,
      maintenanceRequest: h.maintenanceRequest ?? "",
      changeIn:      h.changeIn ?? null,
      changeOut:     h.changeOut ?? null,
      isLatest:      !!h.isLatest,
      unitPrice,
      stockDistance,
      usedDistance,
      remainingPct,
      remainingLevel: remainingPct === null ? null : remainingLevel(remainingPct),
      bahtPerKm,
      age:           tireAge(h.changeIn ?? null),
      request:       statusMap.get(serialNo) ?? null,
    }
  })

  return NextResponse.json({
    vehicle: vehicle ?? null,
    odometer,
    total: items.length,
    items,
  })
}
