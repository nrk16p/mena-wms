import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"

// PUT /api/pr/track — บันทึกวันกำหนดส่ง (คาดว่าจะได้รับ) ของ PR
// body: { prCode, expectedDelivery: "YYYY-MM-DD" | "", note?: string }
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const prCode = String(body?.prCode ?? "").trim()
  if (!prCode) return NextResponse.json({ error: "prCode is required" }, { status: 400 })

  const expectedDelivery = String(body?.expectedDelivery ?? "").trim()
  if (expectedDelivery && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDelivery)) {
    return NextResponse.json({ error: "expectedDelivery ต้องเป็น YYYY-MM-DD" }, { status: 400 })
  }
  const note = String(body?.note ?? "").trim()

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""

  const client = await clientPromise
  const col = client.db("master_data").collection("pr_tracking")
  await col.updateOne(
    { prCode },
    { $set: { prCode, expectedDelivery, note, updatedAt: new Date(), updatedBy: by } },
    { upsert: true },
  )
  return NextResponse.json({ ok: true, prCode, expectedDelivery })
}
