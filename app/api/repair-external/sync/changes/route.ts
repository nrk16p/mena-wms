import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { REPAIR_EVENT_COLL, eventForExport } from "@/lib/repair-events"

const DB = process.env.MONGO_DB ?? "master_data"
const TYPES = new Set(["job.created", "status.changed", "quotation.updated", "comment.created"])

// GET /api/repair-external/sync/changes?after=<id ล่าสุดที่อ่านแล้ว>&type=quotation.updated,comment.created&limit=100
// feed เหตุการณ์ของทุกใบงาน (public เหมือน /sync) — ให้ Mena-Next ดึงเป็นรอบแทนการไล่ถามทีละทะเบียน
// ครั้งแรกใช้ ?since=<ISO> (ไม่ส่งทั้งคู่ = 24 ชม.ล่าสุด) แล้วรอบต่อไปส่ง ?after=<next_after> ที่ได้คืน — ไม่ตกหล่น/ไม่ซ้ำ
export async function GET(req: NextRequest) {
  const sp    = req.nextUrl.searchParams
  const after = sp.get("after")?.trim() ?? ""
  const since = sp.get("since")?.trim() ?? ""
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "100") || 100, 1), 500)
  const types = (sp.get("type") ?? "").split(",").map((t) => t.trim()).filter(Boolean)
  const nextJobId = sp.get("nextJobId")?.trim() ?? ""

  const bad = types.find((t) => !TYPES.has(t))
  if (bad) return NextResponse.json({ ok: false, error: `type ไม่รู้จัก: ${bad} (มี ${[...TYPES].join(", ")})` }, { status: 400 })

  // cursor = _id ของเหตุการณ์ (ObjectId เรียงตามเวลาที่สร้าง)
  let cursor: ObjectId
  if (after) {
    if (!ObjectId.isValid(after)) return NextResponse.json({ ok: false, error: "after ไม่ถูกต้อง (ใช้ next_after จากรอบก่อน)" }, { status: 400 })
    cursor = new ObjectId(after)
  } else {
    const t = since ? Date.parse(since) : Date.now() - 24 * 3600_000
    if (Number.isNaN(t)) return NextResponse.json({ ok: false, error: "since ต้องเป็นวันเวลา ISO เช่น 2026-09-25T08:00:00+07:00" }, { status: 400 })
    // ลบ 1 วินาที: ObjectId จากเวลา = ค่าต่ำสุดของวินาทีนั้น ใช้ $gt แล้วต้องไม่ตัดเหตุการณ์ในวินาทีเดียวกันทิ้ง
    cursor = ObjectId.createFromTime(Math.floor(t / 1000) - 1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = { _id: { $gt: cursor } }
  if (types.length) q.type = { $in: types }
  if (nextJobId) q.nextJobId = nextJobId

  const rows = await (await clientPromise).db(DB).collection(REPAIR_EVENT_COLL)
    .find(q).sort({ _id: 1 }).limit(limit).toArray()
  const events = rows.map(eventForExport)
  const last = rows.at(-1)

  return NextResponse.json({
    ok: true,
    count: events.length,
    // ไม่มีเหตุการณ์ใหม่ = ส่ง cursor เดิมกลับ (รอบหน้าใช้ค่าเดิมต่อ)
    next_after: last ? String(last._id) : (after || String(cursor)),
    has_more: rows.length === limit,
    timezone: "Asia/Bangkok (+07:00)",
    events,
  })
}
