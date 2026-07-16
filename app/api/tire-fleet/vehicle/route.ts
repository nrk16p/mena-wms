import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { splitPosition, tireAge, remainingLevel } from "@/lib/tire"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-fleet/vehicle?branch=latkrabang&plate=สบ.71-3569&odometer=250000
// รายละเอียดรถ 1 คัน: ยางปัจจุบัน (พร้อมค่าคำนวณประสิทธิภาพ) + ประวัติการเปลี่ยนทั้งหมด
// odometer ไม่บังคับ — ถ้าไม่ส่งจะใช้เลขไมล์จากคำขอล่าสุด หรือไมล์เริ่มต้นสูงสุดในประวัติ
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const plate  = searchParams.get("plate")?.trim()  ?? ""
  const odoParam = Number(String(searchParams.get("odometer") ?? "").replace(/,/g, "")) || 0

  if (!branch) return NextResponse.json({ error: "branch is required" }, { status: 400 })
  if (!plate)  return NextResponse.json({ error: "plate is required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)

  const [history, vehicle, requests, latestReq] = await Promise.all([
    db.collection("tire_change")
      .find({ branch, vehicle: plate })
      .limit(500)
      .toArray(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.collection("vehicle_master").findOne({ plate } as any, {
      projection: { plate: 1, vehicleType: 1, brand: 1, model: 1, fleet: 1, fleetNo: 1, plant: 1 },
    }),
    db.collection("tire_change_request")
      .find({ branch, plate, "items.0": { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    db.collection("tire_change_request")
      .find({ branch, plate, currentOdometer: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(1)
      .project({ currentOdometer: 1, createdAt: 1 })
      .next(),
  ])

  const current = history.filter((h) => !!h.isLatest)

  // เลขไมล์อ้างอิง: ที่ผู้ใช้ส่งมา > คำขอล่าสุด > ไมล์เริ่มต้นสูงสุดของยางปัจจุบัน
  let odometer = odoParam
  let odometerSource: "input" | "request" | "history" | "none" = odoParam > 0 ? "input" : "none"
  if (odometer <= 0) {
    // กันเคสคนขับกรอกไมล์ผิดในคำขอ — ใช้ค่าที่มากกว่าระหว่างคำขอล่าสุดกับประวัติ
    const reqOdo   = Number(latestReq?.currentOdometer) || 0
    const maxStart = Math.max(0, ...current.map((h) => Number(h.mileageStart) || 0))
    if (reqOdo >= maxStart && reqOdo > 0)      { odometer = reqOdo;   odometerSource = "request" }
    else if (maxStart > 0)                      { odometer = maxStart; odometerSource = "history" }
  }

  // stock join by serial (เฉพาะยางปัจจุบัน)
  const serials = [...new Set(current.map((h) => String(h.serialNo ?? "").trim()).filter(Boolean))]
  const stock = serials.length > 0
    ? await db.collection("tire_stock").find({ branch, serialNo: { $in: serials } }).toArray()
    : []
  const stockMap = new Map(stock.map((s) => [String(s.serialNo).trim(), s]))

  // serial → คำขอที่ยังค้างอยู่ (ข้าม done/rejected; คำขอใหม่สุดชนะ) — พก id ไว้ให้ approve/reject ได้จากหน้ารถ
  type ReqRef = {
    requestId: string; itemId: string
    itemStatus: string; requestStatus: string
    appointmentDate: Date | null; reason: string; driverName: string; jobNo: string
  }
  const statusMap = new Map<string, ReqRef>()
  for (const r of requests) {
    const rStatus = (r.status as string) ?? "pending"
    if (rStatus === "done" || rStatus === "rejected") continue
    type ReqItem = { _id?: unknown; serialNo?: string; status?: string; reason?: string; jobNo?: string }
    for (const it of (r.items ?? []) as ReqItem[]) {
      const iStatus = it.status ?? "pending"
      const key = String(it.serialNo ?? "").trim()
      if (iStatus === "rejected" || !key || statusMap.has(key)) continue
      statusMap.set(key, {
        requestId:       String(r._id),
        itemId:          String(it._id ?? ""),
        itemStatus:      iStatus,
        requestStatus:   rStatus,
        appointmentDate: r.appointmentDate ?? null,
        reason:          String(it.reason ?? ""),
        driverName:      String(r.driverName ?? ""),
        jobNo:           String(it.jobNo ?? ""),
      })
    }
  }

  const mapRow = (h: Record<string, unknown>) => {
    const serialNo     = String(h.serialNo ?? "").trim()
    const mileageStart = Number(h.mileageStart) || 0
    const pos          = splitPosition(String(h.tirePosition ?? ""))
    const s            = stockMap.get(serialNo)
    const unitPrice     = s ? Number(s.unitPrice) || 0 : null
    const stockDistance = s ? Number(s.distance) || 0 : null

    // ไมล์อ้างอิงน้อยกว่าไมล์ตอนใส่ยาง = ข้อมูลไม่น่าเชื่อถือ → ไม่คำนวณ
    const usedDistance = odometer > 0 && mileageStart > 0 && odometer >= mileageStart
      ? odometer - mileageStart : null

    let remainingPct: number | null = null
    if (stockDistance !== null && stockDistance > 0 && usedDistance !== null) {
      remainingPct = Math.round((1 - usedDistance / stockDistance) * 100)
    }

    let bahtPerKm: number | null = null
    if (unitPrice !== null && unitPrice > 0 && usedDistance !== null && usedDistance > 0) {
      bahtPerKm = Math.round((unitPrice / usedDistance) * 10000) / 10000
    }

    return {
      _id:           h._id,
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
      age:           tireAge((h.changeIn as string | Date | null) ?? null),
      request:       statusMap.get(serialNo) ?? null,
    }
  }

  const currentTires = current.map(mapRow).sort((a, b) => a.positionCode.localeCompare(b.positionCode, "en", { numeric: true }))

  const changeInMs = (v: unknown) => {
    const t = v ? new Date(v as string | Date).getTime() : 0
    return isNaN(t) ? 0 : t
  }
  const historyRows = history
    .map(mapRow)
    .sort((a, b) => changeInMs(b.changeIn) - changeInMs(a.changeIn))

  return NextResponse.json({
    vehicle: vehicle ?? null,
    plate,
    branch,
    odometer,
    odometerSource,
    current: currentTires,
    history: historyRows,
  })
}
