import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { tireAge, isTrailerPosition } from "@/lib/tire"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-fleet?branch=&q= — รถ unique ทุกคันจาก Change History (ทั้ง 2 สาขา)
// พร้อมสรุปสภาพยางรายคัน (รอบเปลี่ยนจาก tire_distance, อายุยางเป็นตัวสำรอง) + จำนวนคำขอที่ค้างอยู่
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const q      = searchParams.get("q")?.trim()      ?? ""

  const client = await clientPromise
  const db = client.db(DB)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match: Record<string, any> = { isLatest: true, vehicle: { $nin: ["", null] } }
  if (branch) match.branch = branch
  if (q) match.vehicle = { $regex: q, $options: "i" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqMatch: Record<string, any> = {
    "items.0": { $exists: true },
    $or: [{ status: { $in: ["pending", "approved", "appointment"] } }, { status: { $exists: false } }],
  }
  if (branch) reqMatch.branch = branch

  // สถานะรอบเปลี่ยนรายเส้น — ตัวเดียวกับที่แอปคนขับและแท็บ "ยางถึงกำหนดเปลี่ยน" ใช้
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dueMatch: Record<string, any> = { isSpare: { $ne: true } }
  if (branch) dueMatch.branch = branch

  const [tires, activeReqs, dueRows] = await Promise.all([
    db.collection("tire_change")
      .find(match)
      .project({ branch: 1, vehicle: 1, tirePosition: 1, changeIn: 1 })
      .toArray(),
    db.collection("tire_change_request")
      .find(reqMatch)
      .project({ branch: 1, plate: 1, status: 1 })
      .toArray(),
    db.collection("tire_distance")
      .find(dueMatch)
      .project({ branch: 1, plate: 1, level: 1, usedPct: 1, snoozedUntil: 1 })
      .toArray(),
  ])

  // branch|plate → จำนวนเส้นแต่ละระดับ + % สูงสุดของคัน (เส้นที่พักแจ้งเตือนไว้นับเป็นปกติ)
  type DueCount = "over" | "due" | "warn" | "ok" | "unknown"
  type DueGroup = Record<DueCount, number> & { maxPct: number }
  const dueByPlate = new Map<string, DueGroup>()
  const nowMs = Date.now()
  for (const r of dueRows) {
    const key = `${r.branch}|${r.plate}`
    let g = dueByPlate.get(key)
    if (!g) { g = { over: 0, due: 0, warn: 0, ok: 0, unknown: 0, maxPct: 0 }; dueByPlate.set(key, g) }
    const snoozed = !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > nowMs
    const raw = snoozed ? "ok" : String(r.level ?? "unknown")
    const level = (["over", "due", "warn", "ok"].includes(raw) ? raw : "unknown") as DueCount
    g[level]++
    if (!snoozed && Number(r.usedPct) > g.maxPct) g.maxPct = Number(r.usedPct)
  }

  // group by branch + plate
  type Group = {
    branch: string; plate: string; tireCount: number
    headTires: number; trailerTires: number
    danger: number; warn: number; normal: number; unknown: number
    oldestDays: number; oldestAgeText: string | null
  }
  const groups = new Map<string, Group>()
  for (const t of tires) {
    const key = `${t.branch}|${t.vehicle}`
    let g = groups.get(key)
    if (!g) {
      g = { branch: t.branch, plate: t.vehicle, tireCount: 0, headTires: 0, trailerTires: 0, danger: 0, warn: 0, normal: 0, unknown: 0, oldestDays: -1, oldestAgeText: null }
      groups.set(key, g)
    }
    g.tireCount++
    if (isTrailerPosition(String(t.tirePosition ?? ""))) g.trailerTires++
    else g.headTires++
    const age = tireAge(t.changeIn ?? null)
    if (!age) { g.unknown++; continue }
    g[age.level]++
    const days = t.changeIn ? (Date.now() - new Date(t.changeIn).getTime()) / 86400000 : -1
    if (days > g.oldestDays) { g.oldestDays = days; g.oldestAgeText = age.text }
  }

  // active request count per branch+plate
  const reqCount = new Map<string, number>()
  for (const r of activeReqs) {
    const key = `${r.branch}|${r.plate}`
    reqCount.set(key, (reqCount.get(key) ?? 0) + 1)
  }

  // vehicle master join (type / fleet)
  const plates = [...new Set([...groups.values()].map((g) => g.plate))]
  const masters = plates.length > 0
    ? await db.collection("vehicle_master")
        .find({ plate: { $in: plates } })
        .project({ plate: 1, vehicleType: 1, fleet: 1, plant: 1 })
        .toArray()
    : []
  const masterMap = new Map(masters.map((m) => [m.plate, m]))

  const items = [...groups.values()].map((g) => {
    const m = masterMap.get(g.plate)
    // ทะเบียนถือเป็น "หาง" เมื่อยางทุกเส้นเป็นตำแหน่งหาง หรือประเภทรถระบุว่าเป็นหาง
    const isTrailerPlate =
      (g.trailerTires > 0 && g.headTires === 0) ||
      String(m?.vehicleType ?? "").includes("หาง")
    const d = dueByPlate.get(`${g.branch}|${g.plate}`)
    return {
      branch:         g.branch,
      plate:          g.plate,
      unit:           isTrailerPlate ? "trailer" as const : "head" as const,
      vehicleType:    m?.vehicleType ?? "",
      fleet:          m?.fleet ?? "",
      plant:          m?.plant ?? "",
      tireCount:      g.tireCount,
      danger:         g.danger,
      warn:           g.warn,
      normal:         g.normal,
      unknown:        g.unknown,
      oldestAgeText:  g.oldestAgeText,
      // สรุปรอบเปลี่ยนรายคัน — null = ยังไม่มีแถวใน tire_distance (ทะเบียนที่ตัดออก / cron ยังไม่รัน)
      due: d ? {
        over: d.over, due: d.due, warn: d.warn, ok: d.ok, unknown: d.unknown,
        maxPct: d.maxPct,
      } : null,
      activeRequests: reqCount.get(`${g.branch}|${g.plate}`) ?? 0,
    }
  })

  // รถที่มีคำขอค้าง / ยางเกินรอบ ขึ้นก่อน — เรียงด้วยเกณฑ์รอบเปลี่ยนก่อน แล้วค่อยตกไปที่อายุยาง
  items.sort((a, b) =>
    b.activeRequests - a.activeRequests ||
    (b.due?.over ?? 0) - (a.due?.over ?? 0) ||
    (b.due?.due  ?? 0) - (a.due?.due  ?? 0) ||
    (b.due?.warn ?? 0) - (a.due?.warn ?? 0) ||
    b.danger - a.danger ||
    b.warn - a.warn ||
    a.plate.localeCompare(b.plate, "th")
  )

  return NextResponse.json({ items, total: items.length })
}
