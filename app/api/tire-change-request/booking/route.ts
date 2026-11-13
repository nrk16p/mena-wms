import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { loadLatestPlantsSafe } from "@/lib/vehicle-plant"
import { isIgnoredPlate } from "@/lib/tire-due"
import { invalidateCache, sharedCache, CACHE_TAGS } from "@/lib/shared-cache"
import { uploadImage } from "@/lib/spaces"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
const MAX_PHOTO_LENGTH = 8 * 1024 * 1024

// GET /api/tire-change-request/booking?branch= — รายชื่อรถให้ช่องค้นหาในฟอร์มจอง (ทะเบียน + เบอร์รถ)
// เอาจาก tire_distance (รถที่มียางอยู่ในระบบตอนนี้) — ก้อนเล็ก ราวพันคัน แคชตาม tag "tire"
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch")?.trim() ?? ""
  const client = await clientPromise
  const items = await sharedCache.get({
    key: `tire-booking-vehicles:${branch}`,
    tags: [CACHE_TAGS.tire],
    freshMs: 10 * 60_000,
    maxStaleMs: 60 * 60_000,
    load: async () => {
      const rows = await client.db(DB).collection("tire_distance").aggregate<{
        _id: { b: string; p: string }; n: string; f: string; pl: string; t: string; u: string
      }>([
        { $match: branch ? { branch } : {} },
        { $group: {
          _id: { b: "$branch", p: "$plate" },
          n: { $max: "$fleetNo" }, f: { $first: "$fleet" }, pl: { $first: "$plant" }, t: { $first: "$vehicleType" }, u: { $first: "$unit" },
        } },
      ]).toArray()
      return rows
        .filter((r) => String(r._id.p ?? "").trim() && !isIgnoredPlate(r._id.p))
        .map((r) => ({
          branch: r._id.b, plate: String(r._id.p).trim(), fleetNo: String(r.n ?? "").trim(),
          fleet: String(r.f ?? "").trim(), plant: String(r.pl ?? "").trim(), vehicleType: String(r.t ?? "").trim(),
          unit: r.u === "trailer" ? "trailer" : "head",
        }))
        .sort((a, b) => a.plate.localeCompare(b.plate, "th", { numeric: true }))
    },
  })
  return NextResponse.json({ items })
}

// POST /api/tire-change-request/booking — แอดมินจองเปลี่ยนยางเอง (หน้า คำขอ / อนุมัติ)
// body { vehicle (ทะเบียนหรือเบอร์รถ), branch?, reason, tires?: [{ tirePosition, positionCode, positionName, serialNo, product, mileageStart, usedDistance }],
//        currentOdometer, currentTreadMm?, photos?: dataUrl[], note?, appointmentDate? }
//
// คนจองคือคนอนุมัติเอง → ไม่ต้องผ่าน "รออนุมัติ": ใบใหม่ขึ้นเป็น appointment (รอเปลี่ยน) ทันที
// ยาง 1 เส้น = 1 รายการ (อนุมัติ + นัดวันในตัว) · ไม่ส่ง tires = 1 รายการไม่ระบุตำแหน่ง (รถที่ไม่มีข้อมูลยาง)
// รูป/หมายเหตุ/มิลยางใช้ร่วมกันทุกเส้นในใบ · ใบแยกของตัวเองเสมอ ไม่รวมกับใบที่ค้างอยู่
// (รวมเข้าใบ pending จะลากใบนั้นให้ข้ามขั้นอนุมัติไปด้วย) · ปิดงาน/แก้เลข Job ต่อได้ตามปกติ
//
// เว็บเท่านั้น — แอปคนขับที่ถือ x-api-key ห้ามใช้ทางลัดข้ามการอนุมัตินี้
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "ต้องเข้าสู่ระบบผ่านเว็บ" }, { status: 403 })
  const by = session.user.name || session.user.email || ""

  const body = await req.json().catch(() => ({}))
  const q = String(body.vehicle ?? "").trim()
  const branchIn = String(body.branch ?? "").trim()
  const currentOdometer = Number(String(body.currentOdometer ?? "").replace(/,/g, ""))
  const currentTreadMm = Number(String(body.currentTreadMm ?? "").replace(/,/g, "")) || 0
  const note = String(body.note ?? "").trim()
  const reason = String(body.reason ?? "").trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tires = (Array.isArray(body.tires) ? body.tires : []).slice(0, 30).map((t: any) => ({
    tirePosition: String(t?.tirePosition ?? ""), positionCode: String(t?.positionCode ?? ""),
    positionName: String(t?.positionName ?? ""), serialNo: String(t?.serialNo ?? "").trim(),
    product: String(t?.product ?? ""), mileageStart: Number(t?.mileageStart) || 0, usedDistance: Number(t?.usedDistance) || 0,
  }))
  const photos: string[] = (Array.isArray(body.photos) ? body.photos : []).map(String).filter(Boolean)

  if (!q) return NextResponse.json({ error: "กรุณาระบุทะเบียนหรือเบอร์รถ" }, { status: 400 })
  if (!reason) return NextResponse.json({ error: "กรุณาเลือกสาเหตุ" }, { status: 400 })
  if (!Number.isFinite(currentOdometer) || currentOdometer <= 0) {
    return NextResponse.json({ error: "กรุณาระบุเลขไมล์ให้ถูกต้อง" }, { status: 400 })
  }
  if (photos.length > 3) return NextResponse.json({ error: "รูปถ่ายได้สูงสุด 3 รูป" }, { status: 400 })
  for (const p of photos) {
    if (!p.startsWith("data:image/") || p.length > MAX_PHOTO_LENGTH) {
      return NextResponse.json({ error: "รูปถ่ายไม่ถูกต้องหรือใหญ่เกินไป" }, { status: 400 })
    }
  }
  const appt = body.appointmentDate ? new Date(String(body.appointmentDate)) : new Date()
  if (isNaN(appt.getTime())) return NextResponse.json({ error: "วันนัดเปลี่ยนไม่ถูกต้อง" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)

  // หาตัวรถ: ทะเบียนหรือเบอร์รถ — tire_distance รู้สาขา+ฟลีต+แพล้นท์ครบที่สุด แล้วค่อยถอยไป vehicle_master
  const or = [{ plate: q }, { fleetNo: q }]
  const hits = await db.collection("tire_distance")
    .find({ $or: or, ...(branchIn ? { branch: branchIn } : {}) })
    .project({ branch: 1, plate: 1, fleetNo: 1, fleet: 1, plant: 1, vehicleType: 1 })
    .limit(50).toArray()
  const byVehicle = new Map(hits.map((h) => [`${h.branch}|${h.plate}`, h]))
  let v: { branch: string; plate: string; fleetNo: string; fleet: string; plant: string; vehicleType: string } | null = null
  if (byVehicle.size > 1) {
    return NextResponse.json({ error: `"${q}" ตรงกับรถหลายคัน — ระบุทะเบียนให้ชัดหรือเลือกสาขา` }, { status: 409 })
  }
  const h = [...byVehicle.values()][0]
  if (h) {
    v = {
      branch: String(h.branch), plate: String(h.plate), fleetNo: String(h.fleetNo ?? ""),
      fleet: String(h.fleet ?? ""), plant: String(h.plant ?? ""), vehicleType: String(h.vehicleType ?? ""),
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await db.collection("vehicle_master").findOne({ $or: or } as any, {
      projection: { plate: 1, fleetNo: 1, fleet: 1, plant: 1, vehicleType: 1 },
    })
    const plate = String(m?.plate ?? "").trim()
    const branch = branchIn || (plate
      ? String((await db.collection("tire_change").findOne({ vehicle: plate }, { projection: { branch: 1 } }))?.branch ?? "")
      : "")
    if (!m || !branch) return NextResponse.json({ error: `ไม่พบรถ "${q}" ในระบบยาง` }, { status: 404 })
    v = {
      branch, plate, fleetNo: String(m.fleetNo ?? ""), fleet: String(m.fleet ?? ""),
      plant: String(m.plant ?? ""), vehicleType: String(m.vehicleType ?? ""),
    }
  }
  // แพล้นท์ยึด vehicle_daily_asia วันล่าสุด (snapshot/master อาจเป็นแพล้นท์เดิมก่อนย้าย)
  v.plant = (await loadLatestPlantsSafe(client)).get(v.plate)?.plant ?? v.plant

  const id = new ObjectId()
  const photoUrls: string[] = []
  for (const p of photos) {
    try {
      photoUrls.push(await uploadImage(p, String(id)))
    } catch (err) {
      return NextResponse.json({ error: `อัปโหลดรูปไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
    }
  }

  // เส้นที่มีคำขอค้างอยู่แล้ว (รออนุมัติ/อนุมัติ/นัด) ห้ามจองซ้ำ — งานเดียวจะโผล่สองใบ
  const serials = tires.map((t: { serialNo: string }) => t.serialNo).filter(Boolean)
  if (serials.length > 0) {
    const dup = await db.collection(COLL).findOne(
      { branch: v.branch, plate: v.plate, items: { $elemMatch: { serialNo: { $in: serials }, status: { $nin: ["rejected", "done"] } } } },
      { projection: { _id: 1 } },
    )
    if (dup) return NextResponse.json({ error: "มียางที่เลือกอยู่ในคำขออื่นที่ยังไม่ปิด — รีเฟรชแล้วเลือกใหม่" }, { status: 409 })
  }

  const now = new Date()
  const blank = { tirePosition: "", positionCode: "", positionName: "", serialNo: "", product: "", mileageStart: 0, usedDistance: 0 }
  const items = (tires.length > 0 ? tires : [blank]).map((t: typeof blank) => ({
    _id: new ObjectId(),
    ...t,
    reason,
    note,
    photoUrl: photoUrls[0] ?? "",
    photoUrls,
    currentTreadMm,
    createdAt: now,
    status: "approved", approvedBy: by, approvedAt: now,
    appointmentDate: appt, appointmentBy: by, appointmentAt: now,
  }))
  const doc = {
    _id: id,
    branch: v.branch,
    driverName: "",
    plate: v.plate,
    truckNumber: v.fleetNo,
    currentOdometer,
    odometerPhoto: "",
    fleet: v.fleet, plant: v.plant, vehicleType: v.vehicleType,
    requestedBy: by,
    requestedByEmail: session.user.email ?? "",
    source: "booking",
    status: "appointment",
    approvedBy: by, approvedAt: now,
    appointmentDate: appt, appointmentBy: by, appointmentAt: now,
    items,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection(COLL).insertOne(doc)
  await invalidateCache([CACHE_TAGS.tire])
  return NextResponse.json({ ok: true, requestId: id, plate: v.plate, branch: v.branch, truckNumber: v.fleetNo, items: items.length }, { status: 201 })
}
