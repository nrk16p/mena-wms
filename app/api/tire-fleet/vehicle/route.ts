import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { splitPosition, tireAge, remainingLevel } from "@/lib/tire"
import { DUE_LABEL, SOURCE_LABEL, type DueLevel, type DistanceSource } from "@/lib/tire-due"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-fleet/vehicle?branch=latkrabang&plate=สบ.71-3569&odometer=250000
// รายละเอียดรถ 1 คัน: ยางปัจจุบัน (พร้อมสถานะรอบเปลี่ยนจาก tire_distance) + ประวัติการเปลี่ยนทั้งหมด
// odometer ไม่บังคับ — ถ้าไม่ส่งจะใช้เลขไมล์จากคำขอล่าสุด หรือไมล์เริ่มต้นสูงสุดในประวัติ
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const plate  = searchParams.get("plate")?.trim()  ?? ""
  // รับได้ทั้ง odometer และ currentOdometer — mobile app ส่งชื่อเดียวกับ body ตอน POST
  const odoRaw   = searchParams.get("odometer") ?? searchParams.get("currentOdometer") ?? ""
  const odoParam = Number(String(odoRaw).replace(/,/g, "")) || 0

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

  // สถานะรอบเปลี่ยน (tire_distance) — ชุดเดียวกับแท็บ "ยางถึงกำหนดเปลี่ยน" และแอปคนขับ
  // คำนวณรอบละวันโดย cron จากระยะ GPS/ค่าเที่ยว เทียบระยะกำหนดของรุ่นยาง (แยกล้อหน้า/หลัง)
  // ไม่คิดสดตรงนี้ เพราะตัวเลขต้องตรงกับที่แอปคนขับเห็น ไม่ใช่ขยับตามเลขไมล์ที่แอดมินพิมพ์
  const due = await db.collection("tire_distance")
    .find({ plate })
    .project({
      serialNo: 1, tirePosition: 1, level: 1, usedPct: 1, kmUsed: 1,
      specDistance: 1, source: 1, partial: 1, isSpare: 1,
      snoozedUntil: 1, acceptedAt: 1, acceptedBy: 1, dataThrough: 1, computedAt: 1,
    })
    .toArray()
  // key ด้วย serial+ตำแหน่ง เหมือน upsert ฝั่ง cron — ตำแหน่งเดียวกันอาจเคยใส่หลายเส้น
  const dueMap = new Map(due.map((d) => [`${String(d.serialNo ?? "").trim()}|${String(d.tirePosition ?? "").trim()}`, d]))

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
    type ReqItem = { _id?: unknown; serialNo?: string; status?: string; reason?: string; jobNo?: string; appointmentDate?: Date | null }
    const rItems = (r.items ?? []) as ReqItem[]
    // คำขอเก่าที่นัดไว้ระดับคำขอ → ใช้วันนั้นกับทุกเส้นได้ แต่พอมีเส้นไหนนัดรายเส้นแล้ว ห้าม fallback อีก
    // ไม่งั้นวันนัดของเส้นเดียวจะรั่วไปโชว์ทุกล้อในคำขอเดียวกัน
    const legacyDate = rItems.some((it) => it.appointmentDate) ? null : r.appointmentDate ?? null
    for (const it of rItems) {
      const iStatus = it.status ?? "pending"
      const key = String(it.serialNo ?? "").trim()
      // เส้นที่จบแล้ว (ปฏิเสธ/ปิดงานรายเส้น) ไม่ใช่คำขอที่ยังค้าง — ใบอาจยังเปิดอยู่เพราะเส้นอื่น
      if (iStatus === "rejected" || iStatus === "done" || !key || statusMap.has(key)) continue
      statusMap.set(key, {
        requestId:       String(r._id),
        itemId:          String(it._id ?? ""),
        itemStatus:      iStatus,
        requestStatus:   rStatus,
        appointmentDate: it.appointmentDate ?? legacyDate,
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

    // ยางอะไหล่ยังไม่ได้แตะถนน — ระยะที่คิดให้เป็นของทั้งคัน ไม่ใช่ของเส้นนั้น
    // แอปคนขับตัดทิ้งตั้งแต่ชั้น API แล้ว (isSpare) ที่นี่ต้องตัดด้วยไม่งั้นล้ออะไหล่ขึ้นแดงทั้งที่ยางใหม่
    const dRow = dueMap.get(`${serialNo}|${String(h.tirePosition ?? "").trim()}`)
    const d = dRow && !dRow.isSpare ? dRow : null
    const snoozed = !!d?.snoozedUntil && new Date(d.snoozedUntil).getTime() > Date.now()
    // เส้นที่พักแจ้งเตือนไว้และยังไม่ครบกำหนด นับเป็นปกติ — เกณฑ์เดียวกับ isSnoozed ในแอปคนขับ
    const dueLv: DueLevel = snoozed ? "ok" : ((d?.level as DueLevel) ?? "unknown")
    const dueSrc = (d?.source as DistanceSource) ?? "none"

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
      due: d ? {
        level:        dueLv,
        levelLabel:   DUE_LABEL[dueLv],
        usedPct:      d.usedPct ?? null,
        kmUsed:       Number(d.kmUsed) || 0,
        specDistance: Number(d.specDistance) || 0,
        source:       SOURCE_LABEL[dueSrc] ?? SOURCE_LABEL.none,
        partial:      !!d.partial,
        snoozedUntil: snoozed ? d.snoozedUntil : null,
        acceptedAt:   d.acceptedAt ?? null,
        acceptedBy:   d.acceptedBy ?? "",
        dataThrough:  d.dataThrough ?? null,
        computedAt:   d.computedAt ?? null,
      } : null,
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
