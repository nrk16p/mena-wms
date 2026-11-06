import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb, getOptions } from "@/lib/tyre-sheet-db"
import { KIND_COLL, isKind, cleanFields, computeRow, serialKey, sizeFromText, type AnyRow } from "@/lib/tyre-sheet"

type Params = { params: Promise<{ kind: string }> }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// GET /api/tyre-sheet/rows?stage=prep|sent&size=11R22.5&q=&month=2026-10&page=1&limit=200
// GET /api/tyre-sheet/storage?q=&page=  ·  GET /api/tyre-sheet/sales
export async function GET(req: NextRequest, { params }: Params) {
  const { kind } = await params
  if (!isKind(kind)) return NextResponse.json({ error: "ไม่รู้จักตารางนี้" }, { status: 404 })
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1)
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit") ?? 200) || 200))
  const q = (sp.get("q") ?? "").trim()

  const filter: AnyRow = {}
  let sort: AnyRow = { date: -1, _id: -1 }
  if (kind === "rows") {
    const stage = sp.get("stage") === "prep" ? "prep" : "sent"
    filter.stage = stage
    const size = sp.get("size")
    if (stage === "sent" && size) filter.size = size
    const month = sp.get("month") ?? ""
    if (/^\d{4}-\d{2}$/.test(month)) filter.bookingDate = { $gte: `${month}-01`, $lte: `${month}-31` }
    if (q) {
      const re = new RegExp(escapeRe(q), "i")
      filter.$or = [{ plate: re }, { mrNo: re }, { oldSerial: re }, { newSerial: re }, { driver: re }, { pr: re }]
    }
    sort = stage === "prep" ? { createdAt: 1, _id: 1 } : { seq: -1, _id: -1 }
  } else if (q) {
    const re = new RegExp(escapeRe(q), "i")
    filter.$or = kind === "storage" ? [{ serial: re }, { note: re }, { status: re }] : [{ item: re }]
  }

  const db = await sheetDb()
  const col = db.collection(KIND_COLL[kind])
  const [docs, total] = await Promise.all([
    col.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ])
  const opts = kind === "rows" ? await getOptions(db) : null
  const rows = kind === "rows" ? docs.map((d) => computeRow(d, opts!)) : docs
  return NextResponse.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) })
}

// POST /api/tyre-sheet/{kind} — { rows: [{...}] } เพิ่มแถว (เตรียมข้อมูลเริ่มที่ stage=prep)
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const { kind } = await params
  if (!isKind(kind)) return NextResponse.json({ error: "ไม่รู้จักตารางนี้" }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const input: AnyRow[] = Array.isArray(body.rows) ? body.rows : [body]
  if (!input.length || input.length > 100) return NextResponse.json({ error: "เพิ่มได้ครั้งละ 1–100 แถว" }, { status: 400 })

  const user = session.user?.name ?? session.user?.email ?? ""
  const now = new Date()
  const docs = input.map((raw) => {
    const f = cleanFields(kind, raw)
    const doc: AnyRow = { ...f, source: "wms", createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }
    if (kind === "rows") {
      doc.stage = "prep"
      doc.seq = null
      doc.size = sizeFromText(f.tyreType) ?? null
      doc.serialKey = serialKey(f.oldSerial)
      if (raw.atms && typeof raw.atms === "object") doc.atms = raw.atms
    }
    return doc
  })
  const db = await sheetDb()
  const r = await db.collection(KIND_COLL[kind]).insertMany(docs)
  return NextResponse.json({ ok: true, ids: Object.values(r.insertedIds).map(String) })
}
