import { NextRequest, NextResponse } from "next/server"
import { ObjectId, type UpdateFilter, type Document } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { buildPlanDoc, validatePlan } from "../route"
import { PLAN_STATUS_VALUES } from "@/lib/repair-plan"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_plans"
type Params = { params: Promise<{ id: string }> }

// PUT /api/repair-plans/[id] — แก้ไขแผนทั้งใบ · เลื่อนนัด (plannedInDate เปลี่ยน) จะ push dateHistory ให้เอง
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json()
  const doc  = buildPlanDoc(body)
  const err  = validatePlan(doc)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const session = await getServerSession(authOptions)
  const by      = session?.user?.name || session?.user?.email || ""
  const client  = await clientPromise
  const col     = client.db(DB).collection(COLL)

  const existing = await col.findOne({ _id: new ObjectId(id) })
  if (!existing) return NextResponse.json({ error: "ไม่พบแผน" }, { status: 404 })

  const now = new Date()
  const dateMoved = String(existing.plannedInDate ?? "") !== doc.plannedInDate
  const update: UpdateFilter<Document> = { $set: { ...doc, editedBy: by, updatedAt: now } }
  if (dateMoved) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update.$push = { dateHistory: { from: String(existing.plannedInDate ?? ""), to: doc.plannedInDate, by, at: now.toISOString() } } as any
  }
  await col.updateOne({ _id: new ObjectId(id) }, update)
  return NextResponse.json({ ok: true })
}

// PATCH /api/repair-plans/[id] — อัพเดทเฉพาะสถานะ/ลิงก์ใบงาน (ใช้ตอนแปลงแผน → ใบงานจริง)
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json()
  const set: Record<string, string | Date> = { updatedAt: new Date() }
  const planStatus = String(body.planStatus ?? "").trim()
  if (planStatus) {
    if (!PLAN_STATUS_VALUES.includes(planStatus)) return NextResponse.json({ error: `สถานะแผน "${planStatus}" ไม่ถูกต้อง` }, { status: 400 })
    set.planStatus = planStatus
  }
  if (body.linkedRepairId != null) set.linkedRepairId = String(body.linkedRepairId).trim()

  const session = await getServerSession(authOptions)
  set.editedBy = session?.user?.name || session?.user?.email || ""
  const client = await clientPromise
  const result = await client.db(DB).collection(COLL).updateOne({ _id: new ObjectId(id) }, { $set: set })
  if (!result.matchedCount) return NextResponse.json({ error: "ไม่พบแผน" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/repair-plans/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const client = await clientPromise
  const result = await client.db(DB).collection(COLL).deleteOne({ _id: new ObjectId(id) })
  if (!result.deletedCount) return NextResponse.json({ error: "ไม่พบแผน" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
