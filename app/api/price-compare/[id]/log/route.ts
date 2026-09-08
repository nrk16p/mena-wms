// app/api/price-compare/[id]/log/route.ts — ประวัติของใบ (ใหม่→เก่า)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { PC_LOG_COLL } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const items = await (await clientPromise).db(DB).collection(PC_LOG_COLL).find({ docId: id }).sort({ at: -1 }).limit(300).toArray()
  return NextResponse.json(items.map((i) => ({ ...i, _id: String(i._id) })))
}
