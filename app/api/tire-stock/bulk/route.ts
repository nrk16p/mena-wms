import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { normStatus } from "@/lib/tire"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_stock"

type Skipped = { serialNo: string; reason: string }

// POST /api/tire-stock/bulk — { branch, items: [...] }
// Inserts valid rows, reports skipped ones (missing/duplicate serial) so nothing is silently dropped.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const branch = body.branch?.trim()
  const items: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : []

  if (!branch)            return NextResponse.json({ error: "branch is required" }, { status: 400 })
  if (items.length === 0) return NextResponse.json({ error: "ไม่มีรายการให้บันทึก" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const serials = items
    .map((i) => String(i.serialNo ?? "").trim())
    .filter(Boolean)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.find({ branch, serialNo: { $in: serials } } as any)
    .project({ serialNo: 1 })
    .toArray()
  const existingSet = new Set(existing.map((d) => d.serialNo as string))

  const seen    = new Set<string>()
  const skipped: Skipped[] = []
  const docs = []

  for (const item of items) {
    const serialNo = String(item.serialNo ?? "").trim()
    if (!serialNo) {
      skipped.push({ serialNo: "(ว่าง)", reason: "ไม่มี Serial No" })
      continue
    }
    if (existingSet.has(serialNo)) {
      skipped.push({ serialNo, reason: "มีอยู่แล้วในสาขานี้" })
      continue
    }
    if (seen.has(serialNo)) {
      skipped.push({ serialNo, reason: "ซ้ำกันในรายการที่วาง" })
      continue
    }
    seen.add(serialNo)

    docs.push({
      branch,
      prCode:      String(item.prCode      ?? ""),
      ddCode:      String(item.ddCode      ?? ""),
      depositDate: String(item.depositDate ?? ""),
      productCode: String(item.productCode ?? ""),
      productName: String(item.productName ?? ""),
      serialNo,
      unitPrice:   Number(item.unitPrice) || 0,
      brand:       String(item.brand      ?? ""),
      tireSize:    String(item.tireSize   ?? ""),
      tireModel:   String(item.tireModel  ?? ""),
      distance:    Number(item.distance)  || 0,
      status:      normStatus(item.status),
      tireType:      String(item.tireType      ?? ""),
      warrantyUntil: String(item.warrantyUntil ?? ""),
      createdAt:   new Date(),
      updatedAt:   new Date(),
    })
  }

  if (docs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await col.insertMany(docs as any)
  }

  return NextResponse.json({
    inserted: docs.length,
    insertedSerials: docs.map((d) => d.serialNo),
    skipped,
  })
}
