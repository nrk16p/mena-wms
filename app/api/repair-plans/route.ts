import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { PLAN_STATUS_VALUES, PLAN_CANCELLED } from "@/lib/repair-plan"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_plans"

// แปลง body → doc แผนเข้าซ่อม (ใช้ร่วมกับ PUT ใน [id]/route.ts)
export function buildPlanDoc(body: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? "").trim()
  return {
    plate:          s(body.plate),
    fleetNo:        s(body.fleetNo),
    repairItems:    s(body.repairItems),
    garage:         s(body.garage),
    plannedInDate:  s(body.plannedInDate),
    plannedOutDate: s(body.plannedOutDate),
    planStatus:     PLAN_STATUS_VALUES.includes(s(body.planStatus)) ? s(body.planStatus) : PLAN_STATUS_VALUES[0],
    note:           s(body.note),
  }
}

// ตรวจฟิลด์บังคับ + ลำดับวัน — คืนข้อความ error (null = ผ่าน)
export function validatePlan(doc: ReturnType<typeof buildPlanDoc>): string | null {
  if (!doc.plate)         return "กรุณาระบุทะเบียนรถ"
  if (!doc.repairItems)   return "กรุณาระบุรายการที่ต้องซ่อม"
  if (!doc.garage)        return "กรุณาระบุอู่"
  if (!doc.plannedInDate) return "กรุณาระบุวันนัดเข้าอู่"
  if (doc.plannedOutDate && doc.plannedOutDate < doc.plannedInDate) return "วันคาดว่าเสร็จต้องไม่ก่อนวันนัดเข้าอู่"
  return null
}

// GET /api/repair-plans?scope=active|all — active (default) = ไม่รวมแผนที่ยกเลิก
export async function GET(req: NextRequest) {
  const scope  = req.nextUrl.searchParams.get("scope") ?? "active"
  const client = await clientPromise
  const filter = scope === "all" ? {} : { planStatus: { $ne: PLAN_CANCELLED } }
  const items  = await client.db(DB).collection(COLL)
    .find(filter)
    .sort({ plannedInDate: 1, _id: 1 })
    .limit(500)
    .toArray()
  return NextResponse.json(items)
}

// POST /api/repair-plans — เพิ่มแผนใหม่ (ไม่กันซ้ำต่อทะเบียน — หลายแผนต่อคันคือจุดประสงค์หลัก)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const doc  = buildPlanDoc(body)
  const err  = validatePlan(doc)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const session = await getServerSession(authOptions)
  const by      = session?.user?.name || session?.user?.email || ""
  const now     = new Date()
  const client  = await clientPromise
  const result  = await client.db(DB).collection(COLL)
    .insertOne({ ...doc, linkedRepairId: "", dateHistory: [], createdBy: by, editedBy: by, createdAt: now, updatedAt: now })
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
