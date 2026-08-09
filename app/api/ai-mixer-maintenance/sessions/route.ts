import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { AI_MIXER_ALLOWED_EMAILS } from "@/lib/ai-mixer"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "ai_mixer_sessions"

async function guard() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? ""
  if (!AI_MIXER_ALLOWED_EMAILS.includes(email)) return null
  return email
}

// GET /api/ai-mixer-maintenance/sessions — รายการ session ที่บันทึกไว้
export async function GET() {
  const email = await guard()
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const client = await clientPromise
  const items = await client.db(DB).collection(COLL)
    .find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray()
  return NextResponse.json(items)
}

// POST /api/ai-mixer-maintenance/sessions — บันทึกผลที่ยืนยันครบ 3 ขั้น (audit trail)
export async function POST(req: NextRequest) {
  const email = await guard()
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.vehicle || !body?.step1 || !body?.step3) {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 })
  }

  const client = await clientPromise
  const doc = {
    createdAt: new Date(),
    createdBy: email,
    vehicle: body.vehicle,
    notifyText: body.notifyText ?? "",
    step1: body.step1, // ผล AI + ที่ user ยืนยัน/แก้
    step2: body.step2 ?? null,
    step3: body.step3,
  }
  const r = await client.db(DB).collection(COLL).insertOne(doc)
  return NextResponse.json({ ok: true, id: r.insertedId })
}
