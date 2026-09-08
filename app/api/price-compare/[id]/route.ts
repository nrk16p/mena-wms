// app/api/price-compare/[id]/route.ts — อ่าน/บันทึก/ลบ ใบเทียบราคา
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { toBkkIso } from "@/lib/bkk-time"
import { normalizeDoc, validateDoc, canTransition, type PriceCompare } from "@/lib/price-compare"
import { PC_COLL, docFilter } from "@/lib/price-compare-db"
import { diffPriceCompare, writePcLog } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
type Params = { params: Promise<{ id: string }> }

async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const filter = docFilter(id)
  if (!filter) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const raw = await (await clientPromise).db(DB).collection(PC_COLL).findOne(filter)
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(normalizeDoc(raw))
}

// PUT — บันทึกทั้งเอกสาร (docNo/preparedBy/createdAt/revision จัดการโดย server)
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const filter = docFilter(id)
  if (!filter) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const db = (await clientPromise).db(DB)
  const col = db.collection(PC_COLL)
  const raw = await col.findOne(filter)
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  const before = normalizeDoc(raw)

  const body = await req.json().catch(() => ({}))
  const next = normalizeDoc({ ...body, _id: String(raw._id), docNo: before.docNo, preparedBy: before.preparedBy, createdAt: before.createdAt, createdBy: before.createdBy })
  const errs = validateDoc(next)
  if (errs.length) return NextResponse.json({ error: errs.join(" · "), errors: errs }, { status: 400 })
  const tr = canTransition(before.status, next.status, next)
  if (!tr.ok) return NextResponse.json({ error: tr.reason ?? "เปลี่ยนสถานะไม่ได้" }, { status: 400 })

  const now = new Date()
  next.updatedAt = toBkkIso(now)
  next.editedBy = user.name
  next.revision = before.status === "ร่าง" ? before.revision : before.revision + 1
  const { _id: _drop, ...toSave } = next
  void _drop
  const w = await col.replaceOne({ _id: raw._id }, toSave as Omit<PriceCompare, "_id">)
  if (w.matchedCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 })

  const changes = diffPriceCompare(before, next)
  await writePcLog(db, {
    docId: String(raw._id), docNo: next.docNo, action: before.status !== next.status ? "status" : "update",
    by: user.name, byEmail: user.email, at: now, changes,
    ...(before.status !== next.status ? { statusChange: { from: before.status, to: next.status } } : {}),
  })
  return NextResponse.json(next)
}

// DELETE — ลบได้เฉพาะสถานะร่าง
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const filter = docFilter(id)
  if (!filter) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const db = (await clientPromise).db(DB)
  const raw = await db.collection(PC_COLL).findOne(filter)
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (raw.status !== "ร่าง") return NextResponse.json({ error: "ลบได้เฉพาะใบสถานะร่าง" }, { status: 400 })
  const w = await db.collection(PC_COLL).deleteOne({ _id: raw._id })
  if (w.deletedCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
  await writePcLog(db, { docId: String(raw._id), docNo: String(raw.docNo ?? ""), action: "delete", by: user.name, byEmail: user.email, at: new Date() })
  return NextResponse.json({ ok: true })
}
