import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

// GET /api/repair-external/[id]/log — ประวัติการแก้ไขของรายการนี้ (ใหม่→เก่า)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const client = await clientPromise
  const items  = await client.db(DB).collection(REPAIR_LOG_COLL)
    .find({ repairId: id })
    .sort({ at: -1 })
    .limit(300)
    .toArray()
  return NextResponse.json(items)
}
