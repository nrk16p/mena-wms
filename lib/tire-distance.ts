// สร้าง snapshot "ยางถึงกำหนดเปลี่ยน" ลง collection `tire_distance`
//
// ทำไมต้อง snapshot ไม่คำนวณสดตอนเปิดหน้า: ระยะทางมาจาก api-ncac (Render มี cold start)
// และต้องดึงหลายเดือน — ยิงสดทุกครั้งที่เปิดแท็บคือรอเป็นสิบวินาที
// รอบสร้างจริงพ่วงท้าย cron `tire-sync` (02:00) ซึ่งเป็นตอนที่ tire_change เพิ่งอัปเดตเสร็จพอดี

import type { Db } from "mongodb"
import clientPromise from "@/lib/mongo"
import {
  dueLevel, monthRange, normalizePlateForGps, normalizeProductKey,
  sumMonthlyDistance, isTrailerUnit, isSpareTire, isNotATire, isIgnoredPlate, isFrontTire,
  type DistanceSource, type DueLevel,
} from "@/lib/tire-due"

const DB   = process.env.MONGO_DB ?? "master_data"
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"

// ข้อมูลต้นทางเริ่มมีตั้งแต่เมื่อไหร่ — ยางที่เปลี่ยนก่อนหน้านี้จะได้ระยะไม่ครบ (ติดธง partial)
const GPS_FROM  = Date.UTC(2024, 9, 1)  // drivingdistance (Postgres) เริ่ม 2024-10-01
const TRIP_FROM = Date.UTC(2023, 7, 1)  // truck_distance_summary เริ่ม 2023-08 (เติมย้อนจาก ATMS 2026-09-14 — ไกลกว่านี้ไม่มีไฟล์รายงานแล้ว)
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

// ── ระยะทางรายเดือนจาก GPS ชุดใหม่ (mena-intelligence) ────────────────────
// ฐาน `gps` บน Mongo เก็บ 8 เจ้า (terminus/hino/songdee/cartrack/besttech/dtc/thaitracking/nostra)
// ครอบคลุมกว่าตาราง drivingdistance ฝั่ง Postgres — ถาม 1,086 ทะเบียนได้ 695 (Postgres ได้ 579)
// และใช้ทะเบียนเต็ม ("สบ.71-7386") ตรงกับ ATMS ไม่ต้องแปลงฟอร์แมต
//
// **ห้ามอ่าน collection ดิบเอง**: รถคันเดียวมีกล่อง GPS หลายเจ้าพร้อมกัน (terminus + besttech)
// บวกข้าม collection = นับซ้ำสองเท่า — endpoint นี้ยุบให้แล้ว (เทียบแล้ว 4,675 vs รวมดิบ 8,246)
//
// ข้อจำกัด: ย้อนได้แค่ 2026-01 → ใช้เป็นชั้นบนทับของ Postgres ที่ย้อนถึง 2024-10
const INTEL_GPS = process.env.INTEL_GPS_URL ?? "https://mena-intelligence.vercel.app/api/gps/distance/range"
const INTEL_FROM = "2026-01"   // เดือนแรกที่ฐาน gps มีข้อมูล

// เพดานความสมเหตุสมผล: รถบรรทุกวิ่งเกินนี้ต่อวันไม่ได้จริง
// ของจริงในฟลีต p50 75 · p95 358 กม./วัน แล้วกระโดดไป 7,000+ ในทะเบียนที่ข้อมูลเสีย (10 คัน)
// ตั้งไว้ 1,200 เพราะอยู่กลางช่องว่างนั้น — ขยับได้ในช่วง 800-7,000 โดยผลไม่เปลี่ยน
const MAX_KM_PER_DAY = 1_200

async function fetchIntelGpsMonthly(months: string[], plates: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (plates.length === 0) return out

  const runOne = async (m: string) => {
    const [y, mo] = m.split("-").map(Number)
    const start = `${m}-01`
    const end   = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
    try {
      const res = await fetch(INTEL_GPS, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ startdate: start, enddate: end, plates }),
        cache:   "no-store",
      })
      if (!res.ok) throw new Error(`intel-gps ${m}: HTTP ${res.status}`)
      const data = await res.json()
      for (const row of data?.rows ?? []) {
        const plate = String(row.plate ?? "").trim()
        const km    = Number(row.distance || 0)
        const days  = Number(row.days || 0)
        if (!plate || km <= 0 || days <= 0) continue
        // ทะเบียนที่ข้อมูลเสีย (เช่น 61,509 กม./วัน) ทิ้งเดือนนั้นไป แล้วปล่อยให้ตกไปใช้ค่าของ Postgres แทน
        if (km / days > MAX_KM_PER_DAY) continue
        let byMonth = out.get(plate)
        if (!byMonth) { byMonth = new Map(); out.set(plate, byMonth) }
        byMonth.set(m, km)
      }
    } catch (e) {
      console.error("[tire-distance]", (e as Error).message)
    }
  }

  for (let i = 0; i < months.length; i += 3) {
    await Promise.all(months.slice(i, i + 3).map(runOne))
  }
  return out
}

// ── ระยะทางรายเดือนจาก GPS (Postgres ผ่าน api-ncac) ───────────────────────
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
// ระยะกำหนดของฟลีตขึ้นกับ 3 อย่าง: สาขา · รุ่นยาง · ตำแหน่งล้อ (หน้า/หลัง)
// เช่นลาดกระบัง ผ้าใบ 1000-20 = ล้อหน้า 20,000 / ล้อหลัง 40,000 ส่วนสาขาอื่นอาจใช้เกณฑ์คนละชุด
//
// ลำดับการหา: สเปคของสาขานั้นตามชื่อสินค้า → สเปคกลาง (ไม่ระบุสาขา) ตามชื่อสินค้า
//            → สเปคกลางตาม ยี่ห้อ+ขนาด+รุ่น → ค่าที่ตั้งไว้ราย serial ใน stock
type SpecEntry = { front: number; rear: number }
type SpecLookup = {
  byBranchProduct: Map<string, SpecEntry>   // `${branch}|${ชื่อสินค้า}`
  byProduct:       Map<string, SpecEntry>
  byModel:         Map<string, SpecEntry>
  byStock:         Map<string, number>
}

// แถวสเปคหนึ่งแถวอาจตั้งแยกหน้า/หลัง หรือตั้งค่าเดียวใช้ทั้งคัน (distance เดิม)
function specEntry(s: Record<string, unknown>): SpecEntry | null {
  const flat  = Number(s.distance) || 0
  const front = Number(s.distanceFront) || flat
  const rear  = Number(s.distanceRear)  || flat
  if (front <= 0 && rear <= 0) return null
  return { front: front || rear, rear: rear || front }
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

  const byBranchProduct = new Map<string, SpecEntry>()
  const byProduct       = new Map<string, SpecEntry>()
  const byModel         = new Map<string, SpecEntry>()
  for (const s of specs) {
    const entry = specEntry(s)
    if (!entry) continue
    const branch = String(s.branch ?? "").trim()
    const pk     = normalizeProductKey(s.productName)
    if (pk && branch) byBranchProduct.set(`${branch}|${pk}`, entry)
    else if (pk)      byProduct.set(pk, entry)
    if (!branch) {
      const mk = normalizeProductKey(`${s.brand}|${s.tireSize}|${s.tireModel}`)
      if (mk) byModel.set(mk, entry)
    }
  }

  const byStock = new Map<string, number>()
  for (const s of stock) byStock.set(String(s.serialNo).trim(), Number(s.distance) || 0)

  return { byBranchProduct, byProduct, byModel, byStock }
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

    const plates = [...new Set(tires.map((t) => String(t.vehicle ?? "").trim()).filter(Boolean))]
    const intelMonths = gpsMonths.filter((m) => m >= INTEL_FROM)

    const [gps, gpsIntel, trip, specs, vehicles] = await Promise.all([
      fetchGpsMonthly(gpsMonths),
      fetchIntelGpsMonthly(intelMonths, plates),
      fetchTripMonthly(db),
      loadSpecs(db, [...new Set(tires.map((t) => String(t.serialNo ?? "").trim()).filter(Boolean))]),
      loadVehicleInfo(db, plates),
    ])

    // รวม GPS สองชุดต่อทะเบียน: ชุดใหม่ (8 เจ้า ย้อนแค่ 2026) เป็นชั้นบน + ชุด Postgres (3 เจ้า ย้อนถึง 2024-10) เป็นชั้นล่าง
    //
    // เดือนไหนชุดใหม่มีและผ่านเกณฑ์ กม./วัน ใช้ของชุดใหม่ (ครอบคลุมกว่า รวมหลายเจ้าให้แล้ว)
    // เดือนไหนไม่มี — ไม่ว่าจะเพราะย้อนไม่ถึง 2026 หรือโดนคัดออกเพราะข้อมูลเสีย — ตกไปใช้ของ Postgres
    const gpsCache = new Map<string, { months: Map<string, number>; from: number; through: Date } | undefined>()
    const mergeGps = (plate: string) => {
      if (gpsCache.has(plate)) return gpsCache.get(plate)
      const intel = gpsIntel.get(plate)
      const pg    = gps.get(normalizePlateForGps(plate))
      let merged: { months: Map<string, number>; from: number; through: Date } | undefined
      if (intel || pg) {
        const months = new Map<string, number>(pg ?? [])
        if (intel) for (const [m, km] of intel) months.set(m, km)
        const keys = [...months.keys()].sort()
        merged = {
          months,
          // ข้อมูลของทะเบียนนี้เริ่มเดือนไหนจริง ๆ (ไม่ใช่ค่าคงที่ของทั้งระบบ)
          from: keys.length ? Date.UTC(Number(keys[0].slice(0, 4)), Number(keys[0].slice(5, 7)) - 1, 1) : GPS_FROM,
          through: gpsThrough,
        }
      }
      gpsCache.set(plate, merged)
      return merged
    }

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
      const gpsMap  = trailer ? undefined : mergeGps(plate)
      const tripMap = trip.get(`${plate}|${trailer ? "tail" : "head"}`)

      let source: DistanceSource = "none"
      let monthly: Map<string, number> | undefined
      let through = now
      let from    = TRIP_FROM
      // GPS ชนะเมื่อข้อมูลของทะเบียนนั้นครอบคลุมตั้งแต่วันที่ใส่ยาง — ไม่งั้นค่าเที่ยวที่ย้อนได้ไกลกว่าดีกว่า
      if (gpsMap && validDate && changeIn!.getTime() >= gpsMap.from) {
        source = "gps";  monthly = gpsMap.months; through = gpsMap.through; from = gpsMap.from
      } else if (tripMap) {
        source = "trip"; monthly = tripMap;       through = now;            from = TRIP_FROM
      } else if (gpsMap) {
        source = "gps";  monthly = gpsMap.months; through = gpsMap.through; from = gpsMap.from
      }

      const kmUsed = validDate && monthly ? Math.max(0, sumMonthlyDistance(monthly, changeIn!, through)) : 0
      // ยางที่เปลี่ยนก่อนวันที่ต้นทางมีข้อมูล = ระยะที่ได้ต่ำกว่าจริง ต้องบอกผู้ใช้ ไม่ใช่เงียบ
      const partial    = !!validDate && source !== "none" && changeIn!.getTime() < from

      // ระยะกำหนด: สาขานี้ตั้งไว้เองไหม → ไม่มีก็ใช้สเปคกลาง → แล้วค่อยลองจับด้วย ยี่ห้อ+ขนาด+รุ่น
      const branch  = String(t.branch ?? "").trim()
      const pk      = normalizeProductKey(product)
      const front   = isFrontTire(position)
      const entry   = specs.byBranchProduct.get(`${branch}|${pk}`) ?? specs.byProduct.get(pk) ?? specs.byModel.get(pk)
      const stockKm = specs.byStock.get(serialNo) ?? 0
      const specDistance = entry ? (front ? entry.front : entry.rear) : stockKm
      const specSource =
        specs.byBranchProduct.has(`${branch}|${pk}`) ? "spec-branch"
        : specs.byProduct.has(pk) ? "spec-name"
        : specs.byModel.has(pk)   ? "spec-model"
        : stockKm > 0             ? "stock" : "none"

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
              branch, plate, serialNo, tirePosition: position, product,
              unit: trailer ? "trailer" : "head",
              isSpare: spare,
              fleetNo:     vehicles.get(plate)?.fleetNo ?? "",
              vehicleType: vehicles.get(plate)?.vehicleType ?? "",
              changeIn: validDate ? changeIn : null,
              kmUsed, source, partial,
              specDistance, specSource, specAxle: front ? "front" : "rear", usedPct, level,
              dataThrough: source === "gps" ? gpsThrough : now,
              computedAt: runAt,
            },
            // สถานะที่คนกดเอง (พัก/รับเรื่อง) ต้องรอดจากการคำนวณใหม่ทุกคืน
            $setOnInsert: { snoozedUntil: null, acceptedAt: null, acceptedBy: "" },
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
