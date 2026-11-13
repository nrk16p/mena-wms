import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb, toObjectId, cleanPlateNotes } from "@/lib/tyre-sheet-db"
import { ROUNDS_COLL, parseDate, type AnyRow } from "@/lib/tyre-sheet"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const { id } = await params
  const _id = toObjectId(id)
  if (!_id) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const set: AnyRow = {}
  if ("fromDate" in b) set.fromDate = parseDate(b.fromDate)
  if ("toDate" in b) set.toDate = parseDate(b.toDate)
  for (const k of ["pr", "preparer", "approver1", "approver2"]) if (k in b) set[k] = String(b[k] ?? "").trim()
  if ("plateNotes" in b) set.plateNotes = cleanPlateNotes(b.plateNotes)
  if (("fromDate" in set && !set.fromDate) || ("toDate" in set && !set.toDate)) return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 })
  set.updatedAt = new Date()
  set.updatedBy = session.user?.name ?? session.user?.email ?? ""
  const db = await sheetDb()
  await db.collection(ROUNDS_COLL).updateOne({ _id }, { $set: set })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const { id } = await params
  const _id = toObjectId(id)
  if (!_id) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 })
  const db = await sheetDb()
  await db.collection(ROUNDS_COLL).deleteOne({ _id })
  return NextResponse.json({ ok: true })
}
