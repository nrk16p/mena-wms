import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-stock/pr-report?branch=latkrabang          → list of unique PR codes
// GET /api/tire-stock/pr-report?branch=latkrabang&prCode=X → full report for that PR
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch  = searchParams.get("branch")?.trim()  ?? ""
  const prCode  = searchParams.get("prCode")?.trim()  ?? ""

  if (!branch) return NextResponse.json({ error: "branch is required" }, { status: 400 })

  const client = await clientPromise
  const db = client.db(DB)

  // list mode — return unique PR codes for this branch
  if (!prCode) {
    const prs = await db.collection("tire_stock")
      .distinct("prCode", { branch, prCode: { $ne: "" } })
    return NextResponse.json((prs as string[]).filter(Boolean).sort())
  }

  // report mode — full join
  const stockRows = await db.collection("tire_stock")
    .find({ branch, prCode })
    .sort({ serialNo: 1 })
    .toArray()

  if (stockRows.length === 0) return NextResponse.json([])

  const serials = stockRows.map((s) => String(s.serialNo ?? "").trim()).filter(Boolean)

  // find all request items that match any of these serials
  const requests = await db.collection("tire_change_request")
    .find({ branch, "items.serialNo": { $in: serials } })
    .sort({ createdAt: -1 })
    .toArray()

  // build serial → [{ request header + item }] map (may have multiple requests per serial)
  type ReqItem = {
    requestId:        string
    requestDate:      Date | null
    plate:            string
    truckNumber:      string
    driverName:       string
    fleet:            string
    plant:            string
    currentOdometer:  number
    requestStatus:    string
    tirePosition:     string
    positionCode:     string
    positionName:     string
    product:          string
    reason:           string
    note:             string
    photoUrls:        string[]
    odometerPhotoUrl: string
    currentTreadMm:   number
    mileageStart:     number
    usedDistance:     number
    itemCreatedAt:    Date | null
    itemStatus:       string
    jobNo:            string
  }

  const serialToReqs = new Map<string, ReqItem[]>()
  for (const r of requests) {
    for (const it of (r.items ?? []) as Record<string, unknown>[]) {
      const sn = String(it.serialNo ?? "").trim()
      if (!serials.includes(sn)) continue
      const entry: ReqItem = {
        requestId:       String(r._id),
        requestDate:     r.createdAt ? new Date(r.createdAt) : null,
        plate:           String(r.plate ?? ""),
        truckNumber:     String(r.truckNumber ?? ""),
        driverName:      String(r.driverName ?? ""),
        fleet:           String(r.fleet ?? ""),
        plant:           String(r.plant ?? ""),
        currentOdometer: Number(r.currentOdometer) || 0,
        requestStatus:   String(r.status ?? "pending"),
        tirePosition:    String(it.tirePosition ?? ""),
        positionCode:    String(it.positionCode ?? ""),
        positionName:    String(it.positionName ?? ""),
        product:         String(it.product ?? ""),
        reason:          String(it.reason ?? ""),
        note:            String(it.note ?? ""),
        photoUrls:        Array.isArray(it.photoUrls) ? (it.photoUrls as string[]) : (it.photoUrl ? [String(it.photoUrl)] : []),
        odometerPhotoUrl: String(r.odometerPhoto ?? ""),
        currentTreadMm:  Number(it.currentTreadMm) || 0,
        mileageStart:    Number(it.mileageStart) || 0,
        usedDistance:    Number(it.usedDistance) || 0,
        itemCreatedAt:   it.createdAt ? new Date(it.createdAt as string) : null,
        itemStatus:      String(it.status ?? "pending"),
        jobNo:           String(it.jobNo ?? ""),
      }
      const arr = serialToReqs.get(sn) ?? []
      arr.push(entry)
      serialToReqs.set(sn, arr)
    }
  }

  // build report rows — one row per stock tire, with its request history
  const rows = stockRows.map((s) => {
    const sn        = String(s.serialNo ?? "").trim()
    const unitPrice = Number(s.unitPrice) || 0
    const stockDist = Number(s.distance)  || 0
    const reqItems  = serialToReqs.get(sn) ?? []

    const enrichedReqs = reqItems.map((ri) => {
      const usedDist = ri.usedDistance
      const remainingPct =
        stockDist > 0 && usedDist > 0
          ? Math.round((1 - usedDist / stockDist) * 100)
          : null
      const bahtPerKm =
        unitPrice > 0 && usedDist > 0
          ? Math.round((unitPrice / usedDist) * 10000) / 10000
          : null
      const bahtPerKmStock =
        unitPrice > 0 && stockDist > 0
          ? Math.round((unitPrice / stockDist) * 10000) / 10000
          : null
      return { ...ri, remainingPct, bahtPerKm, bahtPerKmStock }
    })

    return {
      _id:         String(s._id),
      prCode:      String(s.prCode ?? ""),
      ddCode:      String(s.ddCode ?? ""),
      depositDate: String(s.depositDate ?? ""),
      productCode: String(s.productCode ?? ""),
      productName: String(s.productName ?? ""),
      serialNo:    sn,
      unitPrice,
      brand:       String(s.brand ?? ""),
      tireSize:    String(s.tireSize ?? ""),
      tireModel:   String(s.tireModel ?? ""),
      distance:    stockDist,
      status:      String(s.status ?? ""),
      requests:    enrichedReqs,
    }
  })

  return NextResponse.json(rows)
}
