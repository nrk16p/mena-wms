import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchPrSnapshots } from "@/lib/pr-snapshot"
import { normalizeImages } from "@/lib/media"
import { OT_DONE_STATUS, statusFromSnapshot, normalizeOtStatus, cleanLinks } from "@/lib/order-tracking"
import { deptScope, canUseDept } from "@/lib/dept-access"

export const dynamic = "force-dynamic"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "order_tracking"

const s = (v: unknown) => String(v ?? "").trim()
const todayBKK = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

// GET /api/order-tracking?q=&status=&scope=active|done&dept=&limit=500
// โหลดรายการ + sync สถานะเรื่องที่ยังไม่ปิดและมีเลข PR จากข้อมูล ATMS (batch เดียว)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q      = searchParams.get("q")?.trim()      ?? ""
  const status = searchParams.get("status")?.trim() ?? ""
  const scope  = searchParams.get("scope")?.trim()  ?? ""
  const dept   = searchParams.get("dept")?.trim()   ?? ""
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "500") || 500, 2000)

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // ── sync: เรื่องที่ยังไม่ปิด + มี PR → อัปเดต snapshot/สถานะจากข้อมูลจริง ──
  const open = await col.find({ status: { $ne: OT_DONE_STATUS }, prCode: { $ne: "" } })
    .project({ prCode: 1, status: 1, acceptedBy: 1 }).limit(500).toArray()
  if (open.length) {
    const snaps = await fetchPrSnapshots(client, open.map((o) => s(o.prCode)))
    const now = new Date()
    const ops = open.flatMap((o) => {
      const snap = snaps.get(s(o.prCode))
      // normalize สถานะเก่า "เปิด PR แล้ว" (flow เดิม) เข้าขั้นปัจจุบันก่อนคำนวณ
      const base = normalizeOtStatus(s(o.status), s(o.acceptedBy))
      if (!snap) {
        // ไม่พบ PR ในระบบ — แค่ normalize สถานะเก่าถ้าจำเป็น
        return base !== s(o.status)
          ? [{ updateOne: { filter: { _id: o._id }, update: { $set: { status: base, updatedAt: now } } } }]
          : []
      }
      const newStatus = statusFromSnapshot(snap, base)
      const autoClosed = newStatus === OT_DONE_STATUS && s(o.status) !== OT_DONE_STATUS
      return [{
        updateOne: {
          filter: { _id: o._id },
          update: {
            $set: {
              prSnapshot: snap, prSyncedAt: now.toISOString(), status: newStatus, updatedAt: now,
              ...(autoClosed ? { closedAt: todayBKK() } : {}),
            },
            // ปิดจบอัตโนมัติ → ลง log ให้รู้ว่าระบบปิดจากข้อมูลรับของ (DD)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(autoClosed ? { $push: { log: { action: "close", by: "ระบบ (sync)", byEmail: "", at: now.toISOString(), note: `รับของครบ (DD) — PR ${s(o.prCode)}` } } as any } : {}),
          },
        },
      }]
    })
    if (ops.length) await col.bulkWrite(ops)
  }

  // ── list ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const and: Record<string, any>[] = []   // เงื่อนไขที่ต้องรวมกันแบบ AND (กัน $or ทับกัน)

  if (status)               filter.status = status
  else if (scope === "done")   filter.status = OT_DONE_STATUS
  else if (scope === "active") filter.status = { $ne: OT_DONE_STATUS }

  // ── ขอบเขตแผนก: เห็นเฉพาะแผนกตัวเอง (ยกเว้น admin / ผู้บริหาร / จัดซื้อ) ──
  // เรื่องที่ตัวเองเปิดเห็นได้เสมอ แม้แผนกจะอยู่นอกขอบเขต
  const session = await getServerSession(authOptions)
  const myScope = deptScope(session?.user?.employee, session?.user?.role)
  const myEmail = session?.user?.email ?? ""
  if (!myScope.all) {
    and.push({ $or: [{ dept: { $in: myScope.depts } }, { requesterEmail: myEmail }] })
  }

  // filter แผนกที่ผู้ใช้เลือกเอง — ต้องอยู่ในขอบเขตของตัวเองเท่านั้น
  if (dept && (myScope.all || canUseDept(myScope, dept))) filter.dept = dept

  if (q) {
    and.push({ $or: [
      { title:     { $regex: q, $options: "i" } },
      { detail:    { $regex: q, $options: "i" } },
      { note:      { $regex: q, $options: "i" } },
      { prCode:    { $regex: q, $options: "i" } },
      { requester: { $regex: q, $options: "i" } },
      { acceptedBy:{ $regex: q, $options: "i" } },
    ]})
  }
  if (and.length) filter.$and = and

  const items = await col.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray()
  return NextResponse.json(items)
}

// POST /api/order-tracking — เปิดเรื่องใหม่ (มี PR หรือไม่มีก็ได้)
// มี PR → sync สถานะทันที: DD ครบ = ปิดงานอัตโนมัติ (auto completed)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const prCode = s(body.prCode)
  const title  = s(body.title)
  if (!title) return NextResponse.json({ error: "กรุณาระบุเรื่องที่ขอ" }, { status: 400 })

  const session = await getServerSession(authOptions)
  const by      = session?.user?.name || session?.user?.email || ""

  // เปิดเรื่องแทนแผนกอื่นไม่ได้ (ยกเว้น admin / ผู้บริหาร / จัดซื้อ) — ไม่งั้นเรื่องจะหายจากสายตาผู้เปิดเอง
  const dept = s(body.dept)
  const myScope = deptScope(session?.user?.employee, session?.user?.role)
  if (dept && !canUseDept(myScope, dept)) {
    return NextResponse.json({ error: `เลือกแผนกได้เฉพาะแผนกของตนเอง (${dept} อยู่นอกสิทธิ์)` }, { status: 403 })
  }

  const client  = await clientPromise
  const col     = client.db(DB).collection(COLL)

  // 1 เรื่อง : 1 PR — เลข PR เดียวกันเปิดซ้ำไม่ได้ (ถ้ายังไม่ปิด)
  if (prCode) {
    const dup = await col.findOne({ prCode, status: { $ne: OT_DONE_STATUS } })
    if (dup) return NextResponse.json({ error: `PR ${prCode} มีเรื่องติดตามที่ยังไม่ปิดอยู่แล้ว` }, { status: 409 })
  }

  let snap = null
  if (prCode) {
    const snaps = await fetchPrSnapshots(client, [prCode])
    snap = snaps.get(prCode) ?? null
  }
  const status = statusFromSnapshot(snap, "แจ้งเรื่อง")
  const now = new Date()
  const byEmail = session?.user?.email || ""
  const log = [{ action: "create", by, byEmail, at: now.toISOString() }]
  if (status === OT_DONE_STATUS) log.push({ action: "close", by: "ระบบ (sync)", byEmail: "", at: now.toISOString(), note: `รับของครบ (DD) — PR ${prCode}` } as typeof log[0])
  const doc = {
    prCode,
    title,
    detail: s(body.detail),
    note:   s(body.note),
    dept,
    // ผู้เปิดเรื่อง — อิงจากผู้ใช้ที่ล็อกอินเสมอ (ชื่อ + อีเมลจาก session, แก้ไม่ได้)
    requester: by,
    requesterEmail: byEmail,
    status,
    acceptedBy: "", acceptedAt: "", estimatedDone: s(body.estimatedDone),
    prSnapshot: snap, prSyncedAt: snap ? now.toISOString() : "",
    closedAt: status === OT_DONE_STATUS ? todayBKK() : "",
    images: normalizeImages(body.images),
    links: cleanLinks(body.links),
    log,
    createdAt: now, updatedAt: now, updatedBy: by,
  }
  const r = await col.insertOne(doc)
  return NextResponse.json({ ...doc, _id: r.insertedId }, { status: 201 })
}
