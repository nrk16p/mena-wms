import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { REPAIR_FIELD_LABELS, diffRepair, writeRepairLog, type RepairChange } from "@/lib/repair-log"
import { bkkToday } from "@/lib/bkk-time"
import { DONE_STATUSES, isDoneStatus, normalizeStatus, stageEtaRequired, validateJobUpdate } from "@/lib/repair-external"
import { buildDoc } from "../../route"

// POST /api/repair-external/[id]/update — "อัพเดทงาน" หนึ่งครั้ง { status, stageEta, note, fields? }
//
// ทางเดียวที่สถานะจะเปลี่ยนได้จากหน้าเว็บ · เขียน 3 อย่างในคำขอเดียว ไม่ให้หลุดครึ่งทาง
//   1. ใบงาน       — สถานะ + วันคาดพ้นขั้น (+ วันเข้าสถานะ เมื่อสถานะเปลี่ยนจริง) + ช่องข้อมูลที่แก้ (fields)
//   2. ข้อความ     — ลง repair_external_comment พร้อม status/statusFrom/stageEta (kind = "update") · มีข้อความเท่านั้น
//   3. log         — repair_external_log พร้อม noteId ชี้กลับไปที่ข้อความ (ไทม์ไลน์กันซ้ำด้วยตัวนี้)
//
// fields (2026-09-17) = ฟอร์มทั้งใบจากหน้ารายละเอียด (รูปแบบเดียวกับ PUT) — แก้ช่องข้อมูล + ขยับสถานะ
// + ปิดงาน ได้ในกดเดียว · แก้แค่ช่องข้อมูลไม่ต้องมีข้อความ (กติกาอยู่ที่ validateJobUpdate)
// เลือก "สถานะเดิม" ได้ = ยังค้างขั้นเดิม แต่ต้องเล่าว่าติดอะไร
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

  const from          = normalizeStatus(String(existing.status ?? "").trim())
  const statusChanged = from !== status
  const eta           = stageEtaRequired(status) ? stageEta : ""
  const now           = new Date()
  const by            = session?.user?.name || email

  // ช่องข้อมูลที่แก้มาพร้อมกัน — สถานะ/วันคาดยึดค่าจากอัพเดทนี้เสมอ ไม่ใช่จากฟอร์ม
  const doc = body.fields && typeof body.fields === "object"
    ? { ...buildDoc(body.fields as Record<string, unknown>), status, stageEta: eta }
    : null
  // เทียบทุกช่องที่ buildDoc ให้มา (รวมรูปแนบซึ่ง diffRepair ไม่นับ) · ค่าที่ใบงานไม่เคยมี = ค่าว่างของชนิดนั้น
  const blank = (v: unknown) => (Array.isArray(v) ? [] : typeof v === "number" ? 0 : "")
  const fieldsChanged = !!doc && Object.entries(doc).some(([k, v]) =>
    k !== "status" && k !== "stageEta" && JSON.stringify(existing[k] ?? blank(v)) !== JSON.stringify(v))

  const bad = validateJobUpdate({ status, stageEta, note, current: existing, fields: doc, fieldsChanged })
  if (bad) return NextResponse.json(bad, { status: 400 })

  // กันซ้ำแบบเดียวกับ PUT: ใบที่ยังไม่เสร็จ ห้ามชนทะเบียน/เบอร์รถกับใบอื่นที่ยังไม่เสร็จ
  if (doc && !isDoneStatus(status)) {
    if (!doc.plate) return NextResponse.json({ error: "กรุณาระบุทะเบียนรถ" }, { status: 400 })
    const or: Record<string, string>[] = [{ plate: doc.plate }]
    if (doc.fleetNo) or.push({ fleetNo: doc.fleetNo })
    const dup = await col.findOne({ _id: { $ne: new ObjectId(id) }, status: { $nin: DONE_STATUSES }, $or: or })
    if (dup) {
      const which = dup.plate === doc.plate ? `ทะเบียน ${doc.plate}` : `เบอร์รถ ${doc.fleetNo}`
      return NextResponse.json({ error: `รถ ${which} มีรายการ (${dup.jobType || "อู่นอก"}) ที่ยังไม่เสร็จอยู่แล้ว (ต้องปิดงานหรือลบรายการเดิมก่อน)` }, { status: 409 })
    }
  }

  const set: Record<string, unknown> = { ...(doc ?? {}), status, stageEta: eta, editedBy: by, updatedAt: now }
  // วันเข้าสถานะขยับเฉพาะตอนสถานะเปลี่ยนจริง — ไม่งั้น "ค้างในสถานะกี่วัน" จะถูกรีเซ็ตทุกครั้งที่อัพเดท
  if (statusChanged) {
    set.statusSince   = bkkToday()
    set.statusSinceAt = now.toISOString()
  }
  await col.updateOne({ _id: new ObjectId(id) }, { $set: set })

  // แก้แค่ช่องข้อมูล (ไม่มีข้อความ) → ไม่ลงความคิดเห็น เหลือแค่ log ว่าแก้ช่องไหน
  let noteId: string | undefined
  if (note) {
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
    noteId = String(inserted.insertedId)
  }

  const changes: RepairChange[] = doc ? diffRepair(existing, { ...doc, status: from }) : []
  if (statusChanged) {
    changes.push({ field: "status", label: REPAIR_FIELD_LABELS.status, from, to: status })
  }
  if (String(existing.stageEta ?? "") !== eta && !changes.some((c) => c.field === "stageEta")) {
    changes.push({ field: "stageEta", label: REPAIR_FIELD_LABELS.stageEta, from: String(existing.stageEta ?? ""), to: eta })
  }
  // ไม่มีข้อความและไม่มีช่องที่นับใน log (เช่น แก้แค่รูปแนบ) → ไม่ลง log แบบเดียวกับ PUT
  if (noteId || changes.length > 0) await writeRepairLog(db, {
    repairId: id,
    plate:   String(doc?.plate ?? existing.plate ?? ""),
    fleetNo: String(doc?.fleetNo ?? existing.fleetNo ?? ""),
    action:  "update",
    by,
    byEmail: email,
    at:      now,
    statusChange: statusChanged ? { from, to: status } : undefined,
    changes,
    noteId,
  })

  return NextResponse.json({ ok: true, commentId: noteId ?? null, statusChanged, changed: changes.length }, { status: 201 })
}
