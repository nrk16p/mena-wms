// app/api/price-compare/[id]/log/route.ts — ประวัติของใบ (ใหม่→เก่า)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { PC_COLL, docFilter } from "@/lib/price-compare-db"
import { PC_LOG_COLL } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const filter = docFilter(id)
  if (!filter) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const db = (await clientPromise).db(DB)
  // log เก็บ docId เป็น ObjectId string เสมอ (ไม่ว่าจะเปิดด้วย docNo หรือ ObjectId) — ต้องหา doc ก่อนเพื่อได้ _id จริง
  const doc = await db.collection(PC_COLL).findOne(filter, { projection: { _id: 1 } })
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 })
  const items = await db.collection(PC_LOG_COLL).find({ docId: String(doc._id) }).sort({ at: -1 }).limit(300).toArray()
  return NextResponse.json(items.map((i) => ({ ...i, _id: String(i._id) })))
}
