import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { CREDIT_TERMS } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_supplier"

// GET /api/ap-suppliers — เครดิตเทอมของซัพพลายเออร์ทั้งหมด
export async function GET() {
  const client = await clientPromise
  const items = await client.db(DB).collection(COLL)
    .find({}, { projection: { _id: 0, name: 1, creditTerm: 1, updatedBy: 1, updatedAt: 1 } })
    .sort({ name: 1 })
    .toArray()
  return NextResponse.json(items)
}

// PUT /api/ap-suppliers — ตั้ง/แก้เครดิตเทอมของซัพพลายเออร์หนึ่งราย
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? "").trim()
  const creditTerm = String(body?.creditTerm ?? "").trim()
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อซัพพลายเออร์" }, { status: 400 })
  if (creditTerm && !(CREDIT_TERMS as readonly string[]).includes(creditTerm)) {
    return NextResponse.json({ error: `creditTerm ต้องเป็นหนึ่งใน ${CREDIT_TERMS.join(", ")}` }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  const client = await clientPromise
  await client.db(DB).collection(COLL).updateOne(
    { name },
    { $set: { name, creditTerm, updatedBy: by, updatedAt: new Date().toISOString() } },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, name, creditTerm })
}
