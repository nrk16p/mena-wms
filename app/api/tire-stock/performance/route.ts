import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-stock/performance?branch=latkrabang
// Returns performance grouped by brand+tireSize+tireModel, sorted by cost variance (worst first)
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch")?.trim() ?? ""
  if (!branch) return NextResponse.json({ error: "branch required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)

  const stockRows = await db.collection("tire_stock").find({ branch }).toArray()
  if (stockRows.length === 0) return NextResponse.json([])

  const serials = stockRows.map((s) => String(s.serialNo ?? "").trim()).filter(Boolean)

  const requests = await db
    .collection("tire_change_request")
    .find({ branch, "items.serialNo": { $in: serials } })
    .sort({ createdAt: -1 })
    .toArray()

  // serial → latest request item data
  type ReqData = {
    plate: string
    reason: string
    usedDistance: number
    requestStatus: string
    itemCreatedAt: string | null
  }
  const serialToReq = new Map<string, ReqData>()
  for (const r of requests) {
    for (const it of (r.items ?? []) as Record<string, unknown>[]) {
      const sn = String(it.serialNo ?? "").trim()
      if (!serials.includes(sn) || serialToReq.has(sn)) continue
      serialToReq.set(sn, {
        plate:         String(r.plate ?? ""),
        reason:        String(it.reason ?? ""),
        usedDistance:  Number(it.usedDistance) || 0,
        requestStatus: String(r.status ?? "pending"),
        itemCreatedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })
    }
  }

  // group by brand + tireSize + tireModel
  type TirePerf = {
    serialNo: string; unitPrice: number; status: string
    plate: string | null; reason: string | null
    usedDistance: number | null; remainingPct: number | null
    bahtPerKm: number | null; stdBahtPerKm: number | null
    requestStatus: string | null; itemCreatedAt: string | null
  }
  type Group = {
    brand: string; tireSize: string; tireModel: string
    stdDistance: number; tires: TirePerf[]
  }

  const groupMap = new Map<string, Group>()
  for (const s of stockRows) {
    const brand     = String(s.brand     ?? "")
    const tireSize  = String(s.tireSize  ?? "")
    const tireModel = String(s.tireModel ?? "")
    const key       = `${brand}||${tireSize}||${tireModel}`
    const stdDist   = Number(s.distance) || 0
    const unitPrice = Number(s.unitPrice) || 0
    const sn        = String(s.serialNo ?? "").trim()

    if (!groupMap.has(key)) groupMap.set(key, { brand, tireSize, tireModel, stdDistance: stdDist, tires: [] })
    const g = groupMap.get(key)!
    if (stdDist > g.stdDistance) g.stdDistance = stdDist

    const req        = serialToReq.get(sn)
    const usedDist   = req?.usedDistance && req.usedDistance > 0 ? req.usedDistance : null
    const remainPct  = g.stdDistance > 0 && usedDist ? Math.round((1 - usedDist / g.stdDistance) * 100) : null
    const bahtPerKm  = unitPrice > 0 && usedDist ? Math.round((unitPrice / usedDist) * 10000) / 10000 : null
    const stdBpk     = unitPrice > 0 && stdDist > 0 ? Math.round((unitPrice / stdDist) * 10000) / 10000 : null

    g.tires.push({
      serialNo: sn, unitPrice, status: String(s.status ?? ""),
      plate:         req?.plate     ?? null,
      reason:        req?.reason    ?? null,
      usedDistance:  usedDist,
      remainingPct:  remainPct,
      bahtPerKm,
      stdBahtPerKm:  stdBpk,
      requestStatus: req?.requestStatus ?? null,
      itemCreatedAt: req?.itemCreatedAt ?? null,
    })
  }

  // aggregate and sort
  const result = [...groupMap.values()].map((g) => {
    const issued  = g.tires.filter((t) => t.usedDistance !== null)
    const withBpk = issued.filter((t) => t.bahtPerKm !== null)

    const avgUsedDistance  = issued.length ? Math.round(issued.reduce((s, t) => s + (t.usedDistance ?? 0), 0) / issued.length) : null
    const avgBahtPerKm     = withBpk.length ? Math.round(withBpk.reduce((s, t) => s + (t.bahtPerKm ?? 0), 0) / withBpk.length * 10000) / 10000 : null
    const avgStdBahtPerKm  = withBpk.length ? Math.round(withBpk.reduce((s, t) => s + (t.stdBahtPerKm ?? 0), 0) / withBpk.length * 10000) / 10000 : null
    const avgRemainingPct  = issued.filter((t) => t.remainingPct !== null).length
      ? Math.round(issued.filter((t) => t.remainingPct !== null).reduce((s, t) => s + (t.remainingPct ?? 0), 0) / issued.filter((t) => t.remainingPct !== null).length)
      : null
    const costVariance = avgBahtPerKm !== null && avgStdBahtPerKm !== null
      ? Math.round((avgBahtPerKm - avgStdBahtPerKm) * 10000) / 10000
      : null

    return {
      brand: g.brand, tireSize: g.tireSize, tireModel: g.tireModel,
      stdDistance: g.stdDistance,
      count: g.tires.length, countIssued: issued.length,
      avgUsedDistance, avgRemainingPct, avgBahtPerKm, avgStdBahtPerKm, costVariance,
      tires: g.tires.sort((a, b) => {
        if (a.usedDistance === null && b.usedDistance === null) return 0
        if (a.usedDistance === null) return 1
        if (b.usedDistance === null) return -1
        return (b.bahtPerKm ?? 0) - (a.bahtPerKm ?? 0)
      }),
    }
  }).sort((a, b) => {
    if (a.costVariance === null && b.costVariance === null) return 0
    if (a.costVariance === null) return 1
    if (b.costVariance === null) return -1
    return b.costVariance - a.costVariance
  })

  return NextResponse.json(result)
}
