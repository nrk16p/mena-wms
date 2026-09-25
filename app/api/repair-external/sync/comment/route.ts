import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { isDoneStatus } from "@/lib/repair-external"
import { emitRepairEvents, eventBase } from "@/lib/repair-events"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
const CMT  = "repair_external_comment"
const MAX_TEXT = 2000

// ชื่อผู้เขียนจาก header x-user (latin-1 → UTF-8 เหมือน /sync)
function apiUser(req: NextRequest): string {
  const raw = req.headers.get("x-user")?.trim() || ""
  if (!raw) return "API ภายนอก"
  if (/[-ÿ]/.test(raw)) {
    try { return Buffer.from(raw, "latin1").toString("utf8") } catch { /* ใช้ค่าดิบ */ }
  }
  return raw
}

// POST /api/repair-external/sync/comment — Mena-Next เขียนข้อความลงใบงาน (public เหมือน /sync)
// body { id | nextJobId, text, parentId? } · ขึ้นในไทม์ไลน์หน้าเว็บเป็นโน้ต (ตอบกลับ = ซ้อนใต้ข้อความหลัก)
// เขียนได้จนกว่าใบงานจะปิด (รถเสร็จ/ลงคันเสร็จ) — ปิดแล้วตอบ 409
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const text = String(body.text ?? "").trim()
  if (!text) return NextResponse.json({ ok: false, error: "กรุณาระบุ text" }, { status: 400 })
  if (text.length > MAX_TEXT) return NextResponse.json({ ok: false, error: `text ยาวเกิน ${MAX_TEXT} ตัวอักษร` }, { status: 400 })

  const db  = (await clientPromise).db(DB)
  const col = db.collection(COLL)

  const id        = String(body.id ?? "").trim()
  const nextJobId = String(body.nextJobId ?? "").trim()
  const job = ObjectId.isValid(id)
    ? await col.findOne({ _id: new ObjectId(id) })
    : nextJobId ? await col.findOne({ nextJobId }) : null
  if (!job) return NextResponse.json({ ok: false, error: "ไม่พบใบงาน — ระบุ id (จาก GET /sync) หรือ nextJobId" }, { status: 404 })
  if (isDoneStatus(String(job.status ?? ""))) {
    return NextResponse.json({ ok: false, error: `ใบงานปิดแล้ว (${job.status}) — เพิ่มข้อความไม่ได้` }, { status: 409 })
  }
  const repairId = String(job._id)

  // ตอบกลับได้ชั้นเดียว — parent ต้องเป็นข้อความหลักของใบงานเดียวกัน
  let parentId: string | null = null
  if (body.parentId) {
    const pid = String(body.parentId).trim()
    const parent = ObjectId.isValid(pid) ? await db.collection(CMT).findOne({ _id: new ObjectId(pid), repairId }) : null
    if (!parent) return NextResponse.json({ ok: false, error: "ไม่พบ parentId ในใบงานนี้" }, { status: 400 })
    parentId = parent.parentId ? String(parent.parentId) : pid
  }

  const by  = apiUser(req)
  const now = new Date()
  const res = await db.collection(CMT).insertOne({ repairId, parentId, kind: "external", text, by, byEmail: "", at: now })
  const commentId = String(res.insertedId)

  await emitRepairEvents(db, [
    { ...eventBase(repairId, {}, job, by, "api", now), type: "comment.created", data: { commentId, parentId, text } },
  ])
  return NextResponse.json({ ok: true, id: repairId, commentId, parentId }, { status: 201 })
}
