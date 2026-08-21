import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { ObjectId } from "mongodb"
import { MR_LABEL, canMrTransition, isMrStatus, type MrLog, type MrStatus } from "@/lib/tire-mr"

const DB  = process.env.MONGO_DB ?? "master_data"
const COL = "tire_mr"
type Params = { params: Promise<{ id: string }> }

const toObjectId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null)

// GET /api/tire-mr/[id] — ใบเดียวพร้อมไทม์ไลน์ (logs) สำหรับ modal ประวัติ MR
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const _id = toObjectId(id)
  if (!_id) return NextResponse.json({ error: "invalid id" }, { status: 400 })

  const client = await clientPromise
  const doc = await client.db(DB).collection(COL).findOne({ _id })
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(doc)
}

// PATCH /api/tire-mr/[id] — เดินสถานะ หรือแก้หมายเหตุของบรรทัดเดิมในไทม์ไลน์ (ต้องล็อกอิน)
//   { status, note? }     → เดินสถานะทีละขั้น (pending → in_progress → completed) เพิ่ม 1 บรรทัดในไทม์ไลน์
//   { logIndex, note }    → แก้ทับหมายเหตุของบรรทัดนั้น ไม่เพิ่มบรรทัดใหม่ ทำได้ทุกสถานะรวมใบที่ปิดแล้ว
//
// ที่ยอมให้แก้ย้อนหลัง เพราะรายละเอียดงานซ่อมมักได้มาทีหลัง (ช่างสรุปงานตามมา / พิมพ์ผิดตอนกดปิดใบ)
// และต้องเป็นการ "แก้ของเดิม" ไม่ใช่ต่อบรรทัดใหม่ ไม่งั้นไทม์ไลน์จะอ่านเหมือนรถถูกซ่อมหลายรอบ
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })

  const { id } = await params
  const _id = toObjectId(id)
  if (!_id) return NextResponse.json({ error: "invalid id" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const { status, note, logIndex } = body
  const noteText  = String(note ?? "").trim()
  const editingLog = logIndex !== undefined && logIndex !== null

  if (!editingLog && !status)   return NextResponse.json({ error: "status required" }, { status: 400 })
  if (!editingLog && !isMrStatus(status)) {
    return NextResponse.json({ error: `สถานะไม่ถูกต้อง: ${status}` }, { status: 400 })
  }

  const client = await clientPromise
  const db = client.db(DB)
  const existing = await db.collection(COL).findOne({ _id })
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })

  const now  = new Date()
  const user = session.user?.name ?? session.user?.email ?? ""
  const logs: MrLog[] = Array.isArray(existing.logs) ? existing.logs : []

  /**
   * แก้หมายเหตุของบรรทัดเดิม — สถานะ/เวลา/คนกดของบรรทัดนั้นไม่ขยับ เปลี่ยนแค่เนื้อความ
   * แล้วบันทึกไว้ว่าใครแก้เมื่อไร (editedBy/editedAt) เพื่อให้ยังตามรอยได้
   */
  if (editingLog) {
    const i = Number(logIndex)
    if (!Number.isInteger(i) || i < 0 || i >= logs.length) {
      return NextResponse.json({ error: "ไม่พบรายการนี้ในไทม์ไลน์" }, { status: 404 })
    }
    if (!noteText) return NextResponse.json({ error: "กรุณาระบุหมายเหตุ" }, { status: 400 })

    // หมายเหตุบนหัวใบ = บรรทัดล่าสุดที่ไม่ว่าง (หน้ารายงาน/latest อ่านตัวนี้) — คิดใหม่หลังแก้
    // ไม่งั้นแก้บรรทัดสุดท้ายแล้วชิปบนหน้าจอยังโชว์ข้อความเก่า
    const nextNotes = logs.map((l, n) => (n === i ? noteText : String(l.note ?? "").trim()))
    const headNote  = [...nextNotes].reverse().find(Boolean) ?? ""

    await db.collection(COL).updateOne(
      { _id },
      { $set: {
        [`logs.${i}.note`]:     noteText,
        [`logs.${i}.editedBy`]: user,
        [`logs.${i}.editedAt`]: now,
        note: headNote,
      } },
    )

    return NextResponse.json({
      ok: true, logIndex: i, note: noteText, headNote,
      editedBy: user, editedAt: now.toISOString(),
    })
  }

  // สถานะเดินหน้าทีละขั้นเท่านั้น — กันกดซ้ำจากหน้าจอที่ค้าง และกันปิดใบข้ามขั้นตอนซ่อม
  const current = String(existing.status ?? "")
  if (!canMrTransition(current, status)) {
    const msg = current === status
      ? `MR อยู่สถานะ "${MR_LABEL[status as MrStatus]}" อยู่แล้ว`
      : `เปลี่ยนจาก "${MR_LABEL[current as MrStatus] ?? current}" เป็น "${MR_LABEL[status as MrStatus]}" ไม่ได้ — ต้องเดินหน้าทีละขั้น`
    return NextResponse.json({ error: msg, status: current }, { status: 409 })
  }

  // note บนหัวใบ = หมายเหตุล่าสุดที่ไม่ว่าง (หน้ารายงาน/latest อ่านตัวนี้)
  // ถ้าครั้งนี้ไม่ได้พิมพ์อะไร คงหมายเหตุเดิมไว้ ไม่ล้างทิ้ง — ส่วนไทม์ไลน์เก็บครบทุกครั้งใน logs
  const set: Record<string, unknown> = { status, updatedAt: now, updatedBy: user }
  if (noteText) set.note = noteText

  const logEntry = { status, note: noteText, updatedBy: user, updatedAt: now }
  await db.collection(COL).updateOne(
    { _id, status: current },              // guard กันสองคนกดพร้อมกัน
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $set: set, $push: { logs: logEntry } as any },
  )

  return NextResponse.json({
    ok: true,
    status,
    note: noteText || String(existing.note ?? ""),
    updatedBy: user,
    updatedAt: now.toISOString(),
    logsCount: logs.length + 1,
  })
}

// DELETE /api/tire-mr/[id] — ลบทิ้งทั้งใบ (รวมไทม์ไลน์) จึงยังจำกัดเฉพาะแอดมิน
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session)                       return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  if (session.user?.role !== "admin") return NextResponse.json({ error: "เฉพาะแอดมินเท่านั้น" }, { status: 403 })

  const { id } = await params
  const _id = toObjectId(id)
  if (!_id) return NextResponse.json({ error: "invalid id" }, { status: 400 })

  const client = await clientPromise
  await client.db(DB).collection(COL).deleteOne({ _id })
  return NextResponse.json({ ok: true })
}
