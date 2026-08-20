import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { DONE_STATUSES, isDoneStatus, JOB_TYPE_GARAGE, JOB_TYPE_PARTS } from "@/lib/repair-external"
import { REPAIR_LOG_COLL, diffRepair, writeRepairLog } from "@/lib/repair-log"
import { buildDoc, validateStatus } from "../route"
import { bkkToday, bkkTimestamps } from "@/lib/bkk-time"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"
const COMMENT_COLL = "repair_external_comment"
// field เวลาที่ต้องแปลงเป็นเวลาไทยก่อนส่งออก
const TIME_FIELDS = ["createdAt", "updatedAt", "statusSinceAt", "lastCheckedAt"]

// กัน regex พิเศษจาก input ภายนอก (endpoint นี้เปิด public)
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// GET /api/repair-external/sync?vehicle=<ทะเบียนหรือเบอร์รถ>&scope=active|done&type=อู่นอก|อะไหล่ลงคัน&limit=100
// Public read-only endpoint สำหรับทีมภายนอก sync ข้อมูลงานอู่นอก + อะไหล่ลงคัน
// ค้นหาด้วยทะเบียน (plate) หรือเบอร์รถ (fleetNo) อย่างใดอย่างหนึ่งด้วย parameter เดียว
// ไม่ส่ง scope = งานที่เปิดอยู่ทั้งหมด + งานปิดแล้ว (รถเสร็จ/ลงคันเสร็จ) เฉพาะรายการล่าสุด 1 รายการ
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const vehicle = searchParams.get("vehicle")?.trim() ?? ""
  const scope   = searchParams.get("scope")?.trim()   ?? ""
  const type    = searchParams.get("type")?.trim()    ?? ""
  const limit   = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100") || 100, 1), 500)

  if (!vehicle) {
    return NextResponse.json(
      { ok: false, error: "กรุณาระบุ ?vehicle= ทะเบียนหรือเบอร์รถ (เช่น ?vehicle=70-1234 หรือ ?vehicle=M123)" },
      { status: 400 }
    )
  }

  const rx = { $regex: escapeRegex(vehicle), $options: "i" }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: Record<string, any> = { $or: [{ plate: rx }, { fleetNo: rx }] }
  // เอกสารเก่าไม่มี jobType = อู่นอก
  if (type === JOB_TYPE_PARTS)       base.jobType = JOB_TYPE_PARTS
  else if (type === JOB_TYPE_GARAGE) base.jobType = { $ne: JOB_TYPE_PARTS }
  // ตัด field รูปภาพออก — payload ใหญ่และไม่จำเป็นสำหรับการ sync สถานะ
  const projection = { images: 0, negotiationImages: 0 }
  const sort = { receivedDate: -1 as const, _id: -1 as const }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  let items
  if (scope === "done") {
    items = await col.find({ ...base, status: { $in: DONE_STATUSES } })
      .project(projection).sort(sort).limit(limit).toArray()
  } else if (scope === "active") {
    items = await col.find({ ...base, status: { $nin: DONE_STATUSES } })
      .project(projection).sort(sort).limit(limit).toArray()
  } else {
    // default: งานที่ยังไม่เสร็จทั้งหมด + งานปิดแล้วล่าสุด 1 รายการ
    const [active, latestDone] = await Promise.all([
      col.find({ ...base, status: { $nin: DONE_STATUSES } })
        .project(projection).sort(sort).limit(limit).toArray(),
      col.find({ ...base, status: { $in: DONE_STATUSES } })
        .project(projection).sort(sort).limit(1).toArray(),
    ])
    items = [...active, ...latestDone]
  }

  // ── ประวัติการแก้ไข (repair_external_log) แนบต่อรายการ — เรียงเก่า→ใหม่ ──
  // ปิดได้ด้วย ?history=0 ถ้าต้องการ payload เบา
  const withHistory = searchParams.get("history") !== "0"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let out: any[] = items
  if (withHistory && items.length) {
    const ids  = items.map((i) => String(i._id))
    const logs = await client.db(DB).collection(REPAIR_LOG_COLL)
      .find({ repairId: { $in: ids } })
      .project({ _id: 0, repairId: 1, action: 1, by: 1, at: 1, statusChange: 1, changes: 1 })
      .sort({ at: 1 })
      .toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any[]>()
    for (const l of logs) {
      const k = String(l.repairId)
      if (!byId.has(k)) byId.set(k, [])
      const { repairId: _r, ...rest } = l
      byId.get(k)!.push(rest)
    }
    out = items.map((i) => ({ ...i, history: byId.get(String(i._id)) ?? [] }))
  }

  // ── ความคิดเห็น/โน้ตในรายการ (repair_external_comment) แนบต่อรายการ — เรียงเก่า→ใหม่ ──
  // ปิดได้ด้วย ?comments=0 · ไม่ส่ง byEmail ออก เพราะ GET นี้เปิด public
  const withComments = searchParams.get("comments") !== "0"
  if (withComments && items.length) {
    const ids = items.map((i) => String(i._id))
    const comments = await client.db(DB).collection(COMMENT_COLL)
      .find({ repairId: { $in: ids } })
      .project({ repairId: 1, parentId: 1, text: 1, by: 1, at: 1 })
      .sort({ at: 1 })
      .limit(2000)
      .toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cById = new Map<string, any[]>()
    for (const c of comments) {
      const k = String(c.repairId)
      if (!cById.has(k)) cById.set(k, [])
      // id ส่งออกด้วย เพราะ reply อ้างถึงกันผ่าน parentId
      cById.get(k)!.push({ id: String(c._id), parentId: c.parentId ?? null, text: c.text ?? "", by: c.by ?? "", at: c.at })
    }
    out = out.map((i) => ({ ...i, comments: cById.get(String(i._id)) ?? [] }))
  }

  // เวลาทั้งหมดที่ส่งออกเป็นเวลาไทย (+07:00) — เดิมเป็น UTC (…Z) อ่านแล้วสับสน
  out = out.map((i) => ({
    ...bkkTimestamps(i, TIME_FIELDS),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(i.history ? { history: i.history.map((h: any) => bkkTimestamps(h, ["at"])) } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(i.dailyChecks ? { dailyChecks: i.dailyChecks.map((c: any) => bkkTimestamps(c, ["at"])) } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(i.comments ? { comments: i.comments.map((c: any) => bkkTimestamps(c, ["at"])) } : {}),
  }))

  return NextResponse.json({ ok: true, vehicle, scope: scope || "default", type: type || "all", count: out.length, timezone: "Asia/Bangkok (+07:00)", items: out })
}

// ── Write API สำหรับทีมภายนอก — ต้องส่ง header x-api-key (middleware บังคับ) ──
// ผู้ทำรายการ: ส่ง header "x-user: ชื่อ" เพื่อบันทึกใน log (ไม่ส่ง = "API ภายนอก")
// HTTP header ถูกตีความเป็น latin-1 — ชื่อไทยต้อง decode กลับเป็น UTF-8
function apiUser(req: NextRequest): string {
  const raw = req.headers.get("x-user")?.trim() || ""
  if (!raw) return "API ภายนอก"
  if (/[-ÿ]/.test(raw)) {
    try { return Buffer.from(raw, "latin1").toString("utf8") } catch { /* ใช้ค่าดิบ */ }
  }
  return raw
}
// "วันนี้" ต้องเป็นวันตามเวลาไทย — ถ้าใช้ UTC ช่วงเที่ยงคืน-7 โมงเช้าจะได้วันที่ของเมื่อวาน
const todayStr = () => bkkToday()

// POST /api/repair-external/sync — เปิดรายการใหม่ (กติกาเดียวกับหน้าเว็บ)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const doc  = buildDoc(body)
  if (!doc.plate)  return NextResponse.json({ ok: false, error: "กรุณาระบุ plate (ทะเบียนรถ)" }, { status: 400 })
  if (!doc.status) return NextResponse.json({ ok: false, error: "กรุณาระบุ status" }, { status: 400 })
  const statusErr = validateStatus(doc.jobType, doc.status)
  if (statusErr) return NextResponse.json({ ok: false, error: statusErr }, { status: 400 })

  const by     = apiUser(req)
  const client = await clientPromise
  const db     = client.db(DB)
  const col    = db.collection(COLL)

  // กันซ้ำ: รถ 1 คัน (ทะเบียนหรือเบอร์รถตรงกัน) มีรายการไม่เสร็จได้ 1 รายการ
  if (!isDoneStatus(doc.status)) {
    const or: Record<string, string>[] = [{ plate: doc.plate }]
    if (doc.fleetNo) or.push({ fleetNo: doc.fleetNo })
    const dup = await col.findOne({ status: { $nin: DONE_STATUSES }, $or: or })
    if (dup) {
      return NextResponse.json({ ok: false, error: `รถคันนี้มีรายการ (${dup.jobType || "อู่นอก"}) ที่ยังไม่เสร็จอยู่แล้ว`, existingId: String(dup._id) }, { status: 409 })
    }
  }

  const now = new Date()
  const result = await col.insertOne({ ...doc, statusSince: todayStr(), statusSinceAt: now.toISOString(), createdBy: by, editedBy: by, createdAt: now, updatedAt: now })
  await writeRepairLog(db, {
    repairId: result.insertedId.toString(),
    plate: doc.plate, fleetNo: doc.fleetNo,
    action: "create", by, byEmail: "", at: now,
    statusChange: { from: "", to: doc.status },
  })
  return NextResponse.json({ ok: true, id: String(result.insertedId), ...doc }, { status: 201 })
}

// อัปเดตรายการ (ใช้ร่วม PUT = ส่งครบทุก field / PATCH = ส่งเฉพาะ field ที่แก้)
async function updateRecord(req: NextRequest, partial: boolean) {
  const body = await req.json().catch(() => ({}))
  const id   = String(body.id ?? "").trim()
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: "กรุณาระบุ id (จาก GET /sync)" }, { status: 400 })

  const by     = apiUser(req)
  const client = await clientPromise
  const db     = client.db(DB)
  const col    = db.collection(COLL)
  const _id    = new ObjectId(id)

  const existing = await col.findOne({ _id })
  if (!existing) return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 404 })

  // PATCH: field ที่ไม่ส่งมา ใช้ค่าเดิม · PUT: ใช้ body ทั้งชุด
  const doc = buildDoc(partial ? { ...existing, ...body } : body)

  const statusErr = validateStatus(doc.jobType, doc.status)
  if (statusErr) return NextResponse.json({ ok: false, error: statusErr }, { status: 400 })

  // ล็อกสถานะปิดงาน — เปลี่ยน/ย้อนไม่ได้
  const existingStatus = String(existing.status ?? "")
  if (isDoneStatus(existingStatus) && doc.status !== existingStatus) {
    return NextResponse.json({ ok: false, error: "รายการที่ปิดงานแล้ว ย้อนสถานะกลับไม่ได้" }, { status: 409 })
  }

  // กันซ้ำเหมือนหน้าเว็บ
  if (!isDoneStatus(doc.status)) {
    const or: Record<string, string>[] = [{ plate: doc.plate }]
    if (doc.fleetNo) or.push({ fleetNo: doc.fleetNo })
    const dup = await col.findOne({ _id: { $ne: _id }, status: { $nin: DONE_STATUSES }, $or: or })
    if (dup) return NextResponse.json({ ok: false, error: "รถคันนี้มีรายการอื่นที่ยังไม่เสร็จอยู่แล้ว", existingId: String(dup._id) }, { status: 409 })
  }

  const changes = diffRepair(existing, doc)
  const now = new Date()
  const statusChanged = existingStatus !== doc.status
  const statusSince = statusChanged ? todayStr() : (existing.statusSince ?? "")
  const statusSinceAt = statusChanged ? now.toISOString() : (existing.statusSinceAt ?? "")
  await col.updateOne({ _id }, { $set: { ...doc, statusSince, statusSinceAt, editedBy: by, updatedAt: now } })

  if (changes.length > 0) {
    const sc = changes.find((c) => c.field === "status")
    await writeRepairLog(db, {
      repairId: id, plate: doc.plate, fleetNo: doc.fleetNo,
      action: "update", by, byEmail: "", at: now,
      statusChange: sc ? { from: sc.from, to: sc.to } : undefined,
      changes,
    })
  }
  return NextResponse.json({ ok: true, id, changed: changes.length, status: doc.status })
}

// PUT /api/repair-external/sync — อัปเดตทั้งรายการ (ต้องส่ง field ครบ)
export async function PUT(req: NextRequest) { return updateRecord(req, false) }

// PATCH /api/repair-external/sync — อัปเดตบางส่วน (ส่งเฉพาะ id + field ที่แก้ เช่น status)
export async function PATCH(req: NextRequest) { return updateRecord(req, true) }
