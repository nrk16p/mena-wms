import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

// GET /api/sku/next-seq?wh=LK&type=PRT&l1=ENG&l2=OIL&l3=OFT
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const wh   = searchParams.get("wh")   ?? ""
  const type = searchParams.get("type") ?? ""
  const l1   = searchParams.get("l1")   ?? ""
  const l2   = searchParams.get("l2")   ?? ""
  const l3   = searchParams.get("l3")   ?? ""

  if (!wh || !type || !l1 || !l2) {
    return NextResponse.json({ seq: 1, sku: "" })
  }

  const prefix = l3 ? `${wh}-${type}-${l1}-${l2}-${l3}-` : `${wh}-${type}-${l1}-${l2}-`
  const client = await clientPromise
  const last   = await client.db(DB).collection(COLL)
    .find({ SKU: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } })
    .sort({ SKU: -1 })
    .limit(1)
    .toArray()

  const seq = last.length > 0
    ? parseInt(last[0].SKU.split("-").pop() ?? "0") + 1
    : 1

  const sku = `${prefix}${String(seq).padStart(4, "0")}`
  return NextResponse.json({ seq, sku })
}
