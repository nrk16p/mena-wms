import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchPrSnapshots } from "@/lib/pr-snapshot"
import { normalizeImages } from "@/lib/media"
import { OT_DONE_STATUS, statusFromSnapshot, normalizeOtStatus, cleanLinks } from "@/lib/order-tracking"
import { deptScope, canUseDept } from "@/lib/dept-access"
import type { Session } from "next-auth"

export const dynamic = "force-dynamic"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "order_tracking"
type Params = { params: Promise<{ id: string }> }

const s = (v: unknown) => String(v ?? "").trim()
const todayBKK = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

/**
 * แตะเรื่องนี้ได้ไหม — ต้องอยู่ในแผนกของตัวเอง หรือเป็นคนเปิดเรื่องเอง
 * (admin / ผู้บริหาร / จัดซื้อ ผ่านหมด — ดู lib/dept-access.ts)
 */
function canTouch(session: Session | null, doc: Record<string, unknown>): boolean {
  const scope = deptScope(session?.user?.employee, session?.user?.role)
  if (scope.all) return true
  if (s(doc.requesterEmail) && s(doc.requesterEmail) === (session?.user?.email ?? "")) return true
  return canUseDept(scope, s(doc.dept))
}

// PUT /api/order-tracking/[id]
// body ปกติ: { title, detail, note, dept, prCode, estimatedDone, status? }
// body { action: "accept" }: จัดซื้อกดรับเรื่อง — ระบบจดชื่อผู้กดจาก session
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const body = await req.json().catch(() => ({}))

  const session = await getServerSession(authOptions)
  const by      = session?.user?.name || session?.user?.email || ""
  const client  = await clientPromise
  const col     = client.db(DB).collection(COLL)
  const _id     = new ObjectId(id)

  const existing = await col.findOne({ _id })
  if (!existing) return NextResponse.json({ error: "ไม่พบเรื่อง" }, { status: 404 })
  if (!canTouch(session, existing)) {
    return NextResponse.json({ error: "เรื่องนี้อยู่นอกแผนกของคุณ" }, { status: 403 })
  }
  const now = new Date()

  // ── จัดซื้อรับเรื่อง — รับได้ทุกสถานะที่ยังไม่มีผู้รับ (เรื่องที่ผูก PR แล้วข้าม "แจ้งเรื่อง" ไปก็รับได้) ──
  if (s(body.action) === "accept") {
    // รับเรื่อง = งานของจัดซื้อ — จำกัดที่ผู้ที่เข้าถึงได้ทุกแผนก (จัดซื้อ / ผู้บริหาร / admin)
    if (!deptScope(session?.user?.employee, session?.user?.role).all) {
      return NextResponse.json({ error: "เฉพาะจัดซื้อเท่านั้นที่กดรับเรื่องได้" }, { status: 403 })
    }
    if (s(existing.acceptedBy)) {
      return NextResponse.json({ error: `เรื่องนี้ถูกรับไปแล้วโดย ${s(existing.acceptedBy)}` }, { status: 409 })
    }
    await col.updateOne({ _id }, {
      $set: {
        // สถานะขยับเป็น "รับเรื่องแล้ว" เฉพาะตอนยังอยู่ขั้นแจ้งเรื่อง — ขั้นที่ sync มาแล้ว (เปิด PR/PO) คงเดิม
        ...(s(existing.status) === "แจ้งเรื่อง" ? { status: "รับเรื่องแล้ว" } : {}),
        acceptedBy: by, acceptedAt: todayBKK(),
        ...(s(body.estimatedDone) ? { estimatedDone: s(body.estimatedDone) } : {}),
        updatedAt: now, updatedBy: by,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $push: { log: { action: "accept", by, byEmail: session?.user?.email || "", at: now.toISOString() } } as any,
    })
    return NextResponse.json({ ok: true, acceptedBy: by })
  }

  // ── แก้ไขทั่วไป ──
  const prCode = s(body.prCode ?? existing.prCode)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = {
    title:  s(body.title ?? existing.title),
    detail: s(body.detail ?? existing.detail),
    note:   s(body.note ?? existing.note),
    dept:   s(body.dept ?? existing.dept),
    estimatedDone: s(body.estimatedDone ?? existing.estimatedDone),
    prCode,
    images: Array.isArray(body.images) ? normalizeImages(body.images) : (existing.images ?? []),
    links:  Array.isArray(body.links) ? cleanLinks(body.links) : (existing.links ?? []),
    updatedAt: now, updatedBy: by,
  }
  if (!set.title) return NextResponse.json({ error: "กรุณาระบุเรื่องที่ขอ" }, { status: 400 })

  // 1 เรื่อง : 1 PR — เลข PR ห้ามชนกับเรื่องเปิดอยู่เรื่องอื่น
  if (prCode && prCode !== s(existing.prCode)) {
    const dup = await col.findOne({ _id: { $ne: _id }, prCode, status: { $ne: OT_DONE_STATUS } })
    if (dup) return NextResponse.json({ error: `PR ${prCode} มีเรื่องติดตามที่ยังไม่ปิดอยู่แล้ว` }, { status: 409 })
  }

  // sync สถานะจาก PR (ถ้ามีเลข) — ไม่มีเลขให้คงสถานะ manual (แจ้งเรื่อง/รับเรื่องแล้ว หรือปิดงาน manual)
  let status = normalizeOtStatus(s(body.status ?? existing.status), s(existing.acceptedBy))
  if (prCode) {
    const snaps = await fetchPrSnapshots(client, [prCode])
    const snap  = snaps.get(prCode) ?? null
    set.prSnapshot = snap
    set.prSyncedAt = snap ? now.toISOString() : ""
    // ปิดงาน manual ยอมให้คงไว้ · นอกนั้นคำนวณจากข้อมูลจริง
    if (status !== OT_DONE_STATUS) status = statusFromSnapshot(snap, status)
    else if (snap) status = statusFromSnapshot(snap, status) === OT_DONE_STATUS ? OT_DONE_STATUS : status
  } else {
    set.prSnapshot = null
    set.prSyncedAt = ""
  }
  set.status = status
  const nowClosed = status === OT_DONE_STATUS && s(existing.status) !== OT_DONE_STATUS
  if (nowClosed) set.closedAt = todayBKK()
  if (status !== OT_DONE_STATUS) set.closedAt = ""

  const byEmail = session?.user?.email || ""
  const logEntry = nowClosed
    ? { action: "close", by, byEmail, at: now.toISOString() }
    : { action: "update", by, byEmail, at: now.toISOString() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.updateOne({ _id }, { $set: set, $push: { log: logEntry } as any })
  return NextResponse.json({ ok: true, status })
}

// DELETE /api/order-tracking/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  const _id    = new ObjectId(id)

  const existing = await col.findOne({ _id })
  if (!existing) return NextResponse.json({ error: "ไม่พบเรื่อง" }, { status: 404 })
  const session = await getServerSession(authOptions)
  if (!canTouch(session, existing)) {
    return NextResponse.json({ error: "เรื่องนี้อยู่นอกแผนกของคุณ" }, { status: 403 })
  }

  await col.deleteOne({ _id })
  return NextResponse.json({ ok: true })
}
