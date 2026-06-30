import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const brand     = searchParams.get("brand")?.trim()     ?? ""
  const tireSize  = searchParams.get("tireSize")?.trim()  ?? ""
  const tireModel = searchParams.get("tireModel")?.trim() ?? ""

  if (!brand || !tireSize || !tireModel) return NextResponse.json(null)

  const client = await clientPromise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await client.db(DB).collection(COLL).findOne({ brand, tireSize, tireModel } as any)
  return NextResponse.json(doc ?? null)
}
