// สร้าง snapshot "ยางถึงกำหนดเปลี่ยน" ลง collection `tire_distance`
//
// ทำไมต้อง snapshot ไม่คำนวณสดตอนเปิดหน้า: ระยะทางมาจาก api-ncac (Render มี cold start)
// และต้องดึงหลายเดือน — ยิงสดทุกครั้งที่เปิดแท็บคือรอเป็นสิบวินาที
// รอบสร้างจริงพ่วงท้าย cron `tire-sync` (02:00) ซึ่งเป็นตอนที่ tire_change เพิ่งอัปเดตเสร็จพอดี

import type { Db } from "mongodb"
import clientPromise from "@/lib/mongo"
import {
  dueLevel, monthRange, normalizePlateForGps, normalizeProductKey,
  sumMonthlyDistance, isTrailerUnit, isSpareTire, isNotATire, isIgnoredPlate,
  type DistanceSource, type DueLevel,
} from "@/lib/tire-due"

const DB   = process.env.MONGO_DB ?? "master_data"
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"

// ข้อมูลต้นทางเริ่มมีตั้งแต่เมื่อไหร่ — ยางที่เปลี่ยนก่อนหน้านี้จะได้ระยะไม่ครบ (ติดธง partial)
const GPS_FROM  = Date.UTC(2024, 9, 1)  // drivingdistance เริ่ม 2024-10-01
const TRIP_FROM = Date.UTC(2024, 0, 1)  // truck_distance_summary เริ่ม 2024-01
// ETL ฝั่ง GPS รันบน Jenkins timezone UTC → ข้อมูลล่าสุดตามหลังเวลาไทยราว 2 วัน
const GPS_LAG_DAYS = 2

export type RebuildResult = {
  ok: boolean
  tires: number
  computed: number
  noSpec: number
  noDistance: number
  byLevel: Record<DueLevel, number>
  gpsMonths: number
  ms: number
  error?: string
}

// ── ระยะทางรายเดือนจาก GPS ────────────────────────────────────────────────
// sumdistance ถ้าไม่ส่ง plate_number = ได้ยอดรวมของ "ทุกทะเบียน" ในเดือนนั้น
// → เดือนละ 1 request แทนที่จะยิงทีละทะเบียน
async function fetchGpsMonthly(months: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()

  const runOne = async (m: string) => {
    const [y, mo] = m.split("-").map(Number)
    const start = `${m}-01`
    const end   = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
    try {
      const res = await fetch(`${NCAC}/drivingdistance/sumdistance`, {
        method:  "POST",
        headers: { "x-api-key": KEY, "content-type": "application/json" },
        body:    JSON.stringify({ start_at: start, end_at: end }),
        cache:   "no-store",
      })
      if (res.status === 404) return            // 404 = เดือนนั้นไม่มีข้อมูล ไม่ใช่ error
      if (!res.ok) throw new Error(`GPS ${m}: HTTP ${res.status}`)
      const data = await res.json()
      for (const row of data?.summary ?? []) {
        const plate = normalizePlateForGps(row.plate_number)
        if (!plate) continue
        let byMonth = out.get(plate)
        if (!byMonth) { byMonth = new Map(); out.set(plate, byMonth) }
        byMonth.set(m, (byMonth.get(m) ?? 0) + Number(row.total_distance || 0))
      }
    } catch (e) {
      // เดือนไหนล้มก็ข้ามไป ดีกว่าให้ทั้งรอบพัง — ยางที่ขาดเดือนนั้นจะได้ระยะต่ำกว่าจริงชั่วคราว
      console.error("[tire-distance]", (e as Error).message)
    }
  }

  // ยิงทีละ 4 เดือน — api-ncac เป็น instance เล็ก อย่าถล่ม
  for (let i = 0; i < months.length; i += 4) {
    await Promise.all(months.slice(i, i + 4).map(runOne))
  }
  return out
}

// ── ระยะทางรายเดือนจากค่าเที่ยว ────────────────────────────────────────────
// atms.truck_distance_summary — logic เดียวกับหน้า /truck-distance ของ mena-intelligence
// key = `ทะเบียน|head` หรือ `ทะเบียน|tail` (ยางหางต้องใช้ระยะของทะเบียนหาง)
async function fetchTripMonthly(db: Db): Promise<Map<string, Map<string, number>>> {
  const rows = await db.client.db("atms").collection("truck_distance_summary")
    .find({}, { projection: { _id: 0, plate: 1, type: 1, month_year: 1, total_distance: 1 } })
    .toArray()

  const out = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const plate = String(r.plate ?? "").trim()
    if (!plate) continue
    const key = `${plate}|${r.type === "tail" ? "tail" : "head"}`
    let byMonth = out.get(key)
    if (!byMonth) { byMonth = new Map(); out.set(key, byMonth) }
    const m = String(r.month_year ?? "")
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(r.total_distance || 0))
  }
  return out
}

// ── ระยะทางที่กำหนดต่อเส้น ────────────────────────────────────────────────
// ลำดับ: ค่าที่ตั้งไว้ราย serial ใน stock → สเปคที่จับคู่ด้วยชื่อสินค้า → สเปคที่จับคู่ด้วย ยี่ห้อ+ขนาด+รุ่น
type SpecLookup = {
  byProduct: Map<string, number>
  byModel:   Map<string, number>
  byStock:   Map<string, number>
}

async function loadSpecs(db: Db, serials: string[]): Promise<SpecLookup> {
  const [specs, stock] = await Promise.all([
    db.collection("tire_spec_master").find({}).toArray(),
    serials.length
      ? db.collection("tire_stock")
          .find({ serialNo: { $in: serials }, distance: { $gt: 0 } })
          .project({ serialNo: 1, distance: 1 })
          .toArray()
      : Promise.resolve([]),
  ])

  const byProduct = new Map<string, number>()
  const byModel   = new Map<string, number>()
  for (const s of specs) {
    const km = Number(s.distance) || 0
    if (km <= 0) continue
    const pk = normalizeProductKey(s.productName)
    if (pk) byProduct.set(pk, km)
    const mk = normalizeProductKey(`${s.brand}|${s.tireSize}|${s.tireModel}`)
    if (mk) byModel.set(mk, km)
  }

  const byStock = new Map<string, number>()
  for (const s of stock) byStock.set(String(s.serialNo).trim(), Number(s.distance) || 0)

  return { byProduct, byModel, byStock }
}

// ── เบอร์รถ / ประเภทรถ ────────────────────────────────────────────────────
// คนวางแผนเรียกรถด้วย "เบอร์รถ" ไม่ใช่ทะเบียน — ต้องมีติดไปกับทุกแถว
// vehicle_master.fleetNo ครอบคลุมมากสุด (T-0080 / M-0003) ที่ขาดเติมจาก
// atms.truck_master_monthly.truck_no (TH1299) ของเดือนล่าสุด — คนละระบบเลขแต่เรียก "เบอร์รถ" เหมือนกัน
type VehicleInfo = { fleetNo: string; vehicleType: string }

async function loadVehicleInfo(db: Db, plates: string[]): Promise<Map<string, VehicleInfo>> {
  const out = new Map<string, VehicleInfo>()
  if (plates.length === 0) return out

  const masters = await db.collection("vehicle_master")
    .find({ plate: { $in: plates } })
    .project({ plate: 1, fleetNo: 1, vehicleType: 1 })
    .toArray()
  for (const m of masters) {
    out.set(String(m.plate), {
      fleetNo:     String(m.fleetNo ?? "").trim(),
      vehicleType: String(m.vehicleType ?? "").trim(),
    })
  }

  const missing = plates.filter((p) => !out.get(p)?.fleetNo)
  if (missing.length > 0) {
    const tmc    = db.client.db("atms").collection("truck_master_monthly")
    const months = await tmc.distinct("month_year")
    const latest = [...months].sort().pop()
    if (latest) {
      const rows = await tmc.find({ month_year: latest, plate: { $in: missing } })
        .project({ plate: 1, truck_no: 1 })
        .toArray()
      for (const r of rows) {
        const plate = String(r.plate)
        const prev  = out.get(plate)
        out.set(plate, { fleetNo: String(r.truck_no ?? "").trim(), vehicleType: prev?.vehicleType ?? "" })
      }
    }
  }
  return out
}

// ── ตัวหลัก ────────────────────────────────────────────────────────────────
export async function rebuildTireDistance(): Promise<RebuildResult> {
  const t0 = Date.now()
  const byLevel: Record<DueLevel, number> = { over: 0, due: 0, warn: 0, ok: 0, unknown: 0 }

  try {
    const client = await clientPromise
    const db     = client.db(DB)

    const tires = (await db.collection("tire_change")
      .find({ isLatest: true, vehicle: { $nin: ["", null] } })
      .project({ branch: 1, vehicle: 1, tirePosition: 1, product: 1, serialNo: 1, changeIn: 1 })
      .toArray()).filter((t) => !isNotATire(String(t.product ?? "")) && !isIgnoredPlate(t.vehicle as string))

    const dated = tires.filter((t) => t.changeIn && !isNaN(new Date(t.changeIn).getTime()))
    const oldest = dated.reduce(
      (min, t) => Math.min(min, new Date(t.changeIn).getTime()),
      Date.now(),
    )

    const now         = new Date()
    const gpsThrough  = new Date(now.getTime() - GPS_LAG_DAYS * 86_400_000)
    const gpsMonths   = monthRange(new Date(Math.max(oldest, GPS_FROM)), gpsThrough)

    const [gps, trip, specs, vehicles] = await Promise.all([
      fetchGpsMonthly(gpsMonths),
      fetchTripMonthly(db),
      loadSpecs(db, [...new Set(tires.map((t) => String(t.serialNo ?? "").trim()).filter(Boolean))]),
      loadVehicleInfo(db, [...new Set(tires.map((t) => String(t.vehicle ?? "").trim()).filter(Boolean))]),
    ])

    const runAt = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = []
    let computed = 0, noSpec = 0, noDistance = 0

    for (const t of tires) {
      const plate       = String(t.vehicle ?? "").trim()
      const position    = String(t.tirePosition ?? "").trim()
      const serialNo    = String(t.serialNo ?? "").trim()
      const product     = String(t.product ?? "").trim()
      const trailer     = isTrailerUnit(position)
      const spare       = isSpareTire(position)
      const changeIn    = t.changeIn ? new Date(t.changeIn) : null
      const validDate   = changeIn && !isNaN(changeIn.getTime()) && changeIn.getTime() <= now.getTime()

      // เลือกแหล่งระยะทาง — ยางหางมีแต่ค่าเที่ยว (GPS เก็บเฉพาะทะเบียนหัว)
      const gpsMap  = trailer ? undefined : gps.get(normalizePlateForGps(plate))
      const tripMap = trip.get(`${plate}|${trailer ? "tail" : "head"}`)

      let source: DistanceSource = "none"
      let monthly: Map<string, number> | undefined
      let through = now
      if (gpsMap && validDate && changeIn!.getTime() >= GPS_FROM) { source = "gps";  monthly = gpsMap;  through = gpsThrough }
      else if (tripMap)                                           { source = "trip"; monthly = tripMap; through = now }
      else if (gpsMap)                                            { source = "gps";  monthly = gpsMap;  through = gpsThrough }

      const kmUsed = validDate && monthly ? Math.max(0, sumMonthlyDistance(monthly, changeIn!, through)) : 0
      // ยางที่เปลี่ยนก่อนวันที่ต้นทางมีข้อมูล = ระยะที่ได้ต่ำกว่าจริง ต้องบอกผู้ใช้ ไม่ใช่เงียบ
      const sourceFrom = source === "gps" ? GPS_FROM : TRIP_FROM
      const partial    = !!validDate && source !== "none" && changeIn!.getTime() < sourceFrom

      const specDistance =
        specs.byStock.get(serialNo) ??
        specs.byProduct.get(normalizeProductKey(product)) ??
        specs.byModel.get(normalizeProductKey(product)) ?? 0
      const specSource =
        specs.byStock.has(serialNo) ? "stock"
        : specs.byProduct.has(normalizeProductKey(product)) ? "spec-name"
        : specDistance > 0 ? "spec-model" : "none"

      const canCompute = validDate && source !== "none"
      const usedPct    = canCompute && specDistance > 0 ? Math.round((kmUsed / specDistance) * 100) : null
      const level      = canCompute ? dueLevel(usedPct) : "unknown"

      if (!canCompute) noDistance++
      else if (specDistance <= 0) noSpec++
      else computed++
      byLevel[level]++

      ops.push({
        updateOne: {
          filter: { plate, serialNo, tirePosition: position },
          update: {
            $set: {
              branch: String(t.branch ?? ""), plate, serialNo, tirePosition: position, product,
              unit: trailer ? "trailer" : "head",
              isSpare: spare,
              fleetNo:     vehicles.get(plate)?.fleetNo ?? "",
              vehicleType: vehicles.get(plate)?.vehicleType ?? "",
              changeIn: validDate ? changeIn : null,
              kmUsed, source, partial,
              specDistance, specSource, usedPct, level,
              dataThrough: source === "gps" ? gpsThrough : now,
              computedAt: runAt,
            },
            $setOnInsert: { snoozedUntil: null },
          },
          upsert: true,
        },
      })
    }

    const col = db.collection("tire_distance")
    // upsert ยิงตาม (ทะเบียน + serial + ตำแหน่ง) หมื่นครั้งต่อรอบ — ไม่มี index คือสแกนทั้ง collection ทุกครั้ง
    // createIndex เรียกซ้ำได้ ถ้ามีแล้วไม่ทำอะไร
    await Promise.all([
      col.createIndex({ plate: 1, serialNo: 1, tirePosition: 1 }),
      col.createIndex({ branch: 1, level: 1, usedPct: -1 }),
      col.createIndex({ computedAt: 1 }),
    ])
    for (let i = 0; i < ops.length; i += 500) {
      await col.bulkWrite(ops.slice(i, i + 500), { ordered: false })
    }
    // ยางที่ถูกถอดออกไปแล้วรอบนี้ไม่มีในผลลัพธ์ → ลบทิ้ง ไม่งั้นค้างเตือนทั้งที่ไม่ได้อยู่บนรถแล้ว
    await col.deleteMany({ computedAt: { $lt: runAt } })

    return {
      ok: true, tires: tires.length, computed, noSpec, noDistance,
      byLevel, gpsMonths: gpsMonths.length, ms: Date.now() - t0,
    }
  } catch (e) {
    return {
      ok: false, tires: 0, computed: 0, noSpec: 0, noDistance: 0,
      byLevel, gpsMonths: 0, ms: Date.now() - t0, error: (e as Error).message,
    }
  }
}
