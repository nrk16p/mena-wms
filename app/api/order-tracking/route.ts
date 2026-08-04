import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchPrSnapshots } from "@/lib/pr-snapshot"
import { OT_DONE_STATUS, statusFromSnapshot } from "@/lib/order-tracking"

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
    .project({ prCode: 1, status: 1 }).limit(500).toArray()
  if (open.length) {
    const snaps = await fetchPrSnapshots(client, open.map((o) => s(o.prCode)))
    const now = new Date()
    const ops = open.flatMap((o) => {
      const snap = snaps.get(s(o.prCode))
      if (!snap) return []
      const newStatus = statusFromSnapshot(snap, s(o.status))
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
  if (status)               filter.status = status
  else if (scope === "done")   filter.status = OT_DONE_STATUS
  else if (scope === "active") filter.status = { $ne: OT_DONE_STATUS }
  if (dept) filter.dept = dept
  if (q) {
    filter.$or = [
      { title:     { $regex: q, $options: "i" } },
      { detail:    { $regex: q, $options: "i" } },
      { note:      { $regex: q, $options: "i" } },
      { prCode:    { $regex: q, $options: "i" } },
      { requester: { $regex: q, $options: "i" } },
      { acceptedBy:{ $regex: q, $options: "i" } },
    ]
  }
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
    dept:   s(body.dept),
    requester: by,
    requesterEmail: byEmail,
    status,
    acceptedBy: "", acceptedAt: "", estimatedDone: s(body.estimatedDone),
    prSnapshot: snap, prSyncedAt: snap ? now.toISOString() : "",
    closedAt: status === OT_DONE_STATUS ? todayBKK() : "",
    log,
    createdAt: now, updatedAt: now, updatedBy: by,
  }
  const r = await col.insertOne(doc)
  return NextResponse.json({ ...doc, _id: r.insertedId }, { status: 201 })
}
