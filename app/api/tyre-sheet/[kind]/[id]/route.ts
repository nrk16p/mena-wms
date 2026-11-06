import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb, toObjectId, getOptions } from "@/lib/tyre-sheet-db"
import { KIND_COLL, isKind, cleanFields, computeRow, serialKey, sizeFromText, type AnyRow } from "@/lib/tyre-sheet"

type Params = { params: Promise<{ kind: string; id: string }> }

// PATCH /api/tyre-sheet/{kind}/{id} — แก้ช่องในแถว (เหมือนพิมพ์ทับในชีต) · { atms } = เก็บค่าที่ดึงจาก ATMS ไว้แนะนำ
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const { kind, id } = await params
  const _id = toObjectId(id)
  if (!isKind(kind) || !_id) return NextResponse.json({ error: "ไม่พบแถวนี้" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const set: AnyRow = cleanFields(kind, body)
  if (kind !== "rows") delete set.seq
  if (kind === "rows" && body.atms && typeof body.atms === "object") set.atms = body.atms

  const db = await sheetDb()
  const col = db.collection(KIND_COLL[kind])
  const cur = await col.findOne({ _id })
  if (!cur) return NextResponse.json({ error: "ไม่พบแถวนี้ (อาจถูกลบไปแล้ว)" }, { status: 404 })

  if (kind === "rows") {
    if ("oldSerial" in set) set.serialKey = serialKey(set.oldSerial)
    // ไซซ์ตามชนิดยาง — แถวที่ส่งแล้วย้ายตารางเองได้ถ้าแก้ชนิดยาง
    if ("tyreType" in set) {
      const size = sizeFromText(set.tyreType)
      if (size) set.size = size
    }
    if (cur.source === "import") set.editedInWms = true
  }
  if (!Object.keys(set).length) return NextResponse.json({ error: "ไม่มีช่องที่แก้ได้" }, { status: 400 })

  set.updatedAt = new Date()
  set.updatedBy = session.user?.name ?? session.user?.email ?? ""
  await col.updateOne({ _id }, { $set: set })
  const doc = await col.findOne({ _id })
  const row = kind === "rows" && doc ? computeRow(doc, await getOptions(db)) : doc
  return NextResponse.json({ ok: true, row })
}

// DELETE /api/tyre-sheet/{kind}/{id}
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const { kind, id } = await params
  const _id = toObjectId(id)
  if (!isKind(kind) || !_id) return NextResponse.json({ error: "ไม่พบแถวนี้" }, { status: 404 })
  const db = await sheetDb()
  const r = await db.collection(KIND_COLL[kind]).deleteOne({ _id })
  return NextResponse.json({ ok: r.deletedCount === 1 })
}
