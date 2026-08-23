import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { REPAIR_FIELD_LABELS, writeRepairLog, type RepairChange } from "@/lib/repair-log"
import { bkkToday } from "@/lib/bkk-time"
import { normalizeStatus, stageEtaRequired, validateJobUpdate } from "@/lib/repair-external"

// POST /api/repair-external/[id]/update — "อัพเดทงาน" หนึ่งครั้ง { status, stageEta, note }
//
// ทางเดียวที่สถานะจะเปลี่ยนได้จากหน้าเว็บ · เขียน 3 อย่างในคำขอเดียว ไม่ให้หลุดครึ่งทาง
//   1. ใบงาน       — สถานะ + วันคาดพ้นขั้น (+ วันเข้าสถานะ เมื่อสถานะเปลี่ยนจริง)
//   2. ข้อความ     — ลง repair_external_comment พร้อม status/statusFrom/stageEta (kind = "update")
//   3. log         — repair_external_log พร้อม noteId ชี้กลับไปที่ข้อความ (ไทม์ไลน์กันซ้ำด้วยตัวนี้)
//
// เลือก "สถานะเดิม" ได้ = ยังค้างขั้นเดิม แต่ต้องเล่าว่าติดอะไร (กติกาอยู่ที่ validateJobUpdate)
const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
const CMT  = "repair_external_comment"
type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const email   = session?.user?.email ?? ""
  if (!email) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 })

  const body     = await req.json().catch(() => ({}))
  const status   = normalizeStatus(String(body.status ?? "").trim())
  const stageEta = String(body.stageEta ?? "").trim()
  const note     = String(body.note ?? "").trim()

  const db  = (await clientPromise).db(DB)
  const col = db.collection(COLL)
  const existing = await col.findOne({ _id: new ObjectId(id) })
  if (!existing) return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 })

  const bad = validateJobUpdate({ status, stageEta, note, current: existing })
  if (bad) return NextResponse.json(bad, { status: 400 })

  const from          = normalizeStatus(String(existing.status ?? "").trim())
  const statusChanged = from !== status
  const eta           = stageEtaRequired(status) ? stageEta : ""
  const now           = new Date()
  const by            = session?.user?.name || email

  const set: Record<string, unknown> = { status, stageEta: eta, editedBy: by, updatedAt: now }
  // วันเข้าสถานะขยับเฉพาะตอนสถานะเปลี่ยนจริง — ไม่งั้น "ค้างในสถานะกี่วัน" จะถูกรีเซ็ตทุกครั้งที่อัพเดท
  if (statusChanged) {
    set.statusSince   = bkkToday()
    set.statusSinceAt = now.toISOString()
  }
  await col.updateOne({ _id: new ObjectId(id) }, { $set: set })

  const comment = {
    repairId: id,
    parentId: null,
    kind:     "update",
    text:     note,
    status,
    statusFrom: from,
    stageEta:   eta,
    by,
    byEmail:  email,
    at:       now,
  }
  const inserted = await db.collection(CMT).insertOne(comment)
  const noteId   = String(inserted.insertedId)

  const changes: RepairChange[] = []
  if (statusChanged) {
    changes.push({ field: "status", label: REPAIR_FIELD_LABELS.status, from, to: status })
  }
  if (String(existing.stageEta ?? "") !== eta) {
    changes.push({ field: "stageEta", label: REPAIR_FIELD_LABELS.stageEta, from: String(existing.stageEta ?? ""), to: eta })
  }
  await writeRepairLog(db, {
    repairId: id,
    plate:   String(existing.plate ?? ""),
    fleetNo: String(existing.fleetNo ?? ""),
    action:  "update",
    by,
    byEmail: email,
    at:      now,
    statusChange: statusChanged ? { from, to: status } : undefined,
    changes,
    noteId,
  })

  return NextResponse.json({ ok: true, commentId: noteId, statusChanged }, { status: 201 })
}
