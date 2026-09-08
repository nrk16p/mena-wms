// app/api/price-compare/route.ts — รายการ + สร้างใบเทียบราคา
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { bkkToday, toBkkIso } from "@/lib/bkk-time"
import { newDoc, normalizeDoc, supplierTotals, lowestNet, type PriceCompare } from "@/lib/price-compare"
import { PC_COLL, nextDocNo } from "@/lib/price-compare-db"
import { writePcLog } from "@/lib/price-compare-log"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { name: session.user.name || session.user.email || "", email: session.user.email || "" }
}

// GET /api/price-compare?status=&month=YYMM&q=&limit=
export async function GET(req: NextRequest) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const status = sp.get("status")?.trim() || ""
  const month  = sp.get("month")?.trim() || ""       // "2609"
  const q      = sp.get("q")?.trim() || ""
  const limit  = Math.min(parseInt(sp.get("limit") ?? "500", 10) || 500, 2000)

  const filter: Record<string, unknown> = {}
  if (status) filter.status = status
  if (/^\d{4}$/.test(month)) filter.docNo = { $regex: `^PC-${month}-` }   // ต้องเป็น YYMM 4 หลักเท่านั้น กัน regex ที่ผู้ใช้ส่งมาเอง
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
    filter.$or = [{ docNo: rx }, { title: rx }, { "suppliers.name": rx }, { requestDept: rx }]
  }
  const client = await clientPromise
  const rows = await client.db(DB).collection(PC_COLL).find(filter).sort({ updatedAt: -1 }).limit(limit).toArray()
  const items = rows.map((r) => {
    const d = normalizeDoc(r)
    const li = lowestNet(d)
    return {
      _id: String(r._id), docNo: d.docNo, title: d.title, requestDept: d.requestDept, status: d.status,
      preparedBy: d.preparedBy, updatedAt: d.updatedAt, createdAt: d.createdAt, revision: d.revision,
      supplierCount: d.suppliers.length, selectedSupplier: d.selectedSupplier,
      selectedName: d.selectedSupplier ? d.suppliers[d.selectedSupplier - 1]?.name ?? "" : "",
      selectedNet: d.selectedSupplier ? supplierTotals(d, d.selectedSupplier - 1).net : null,
      lowestNet: li == null ? null : supplierTotals(d, li).net,
    }
  })
  return NextResponse.json(items)
}

// POST /api/price-compare — สร้างใบใหม่ (ออกเลขที่ทันที)
export async function POST(req: NextRequest) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const base = normalizeDoc({ ...newDoc(me), ...body, preparedBy: me, status: "ร่าง", revision: 0, createdBy: me.name, editedBy: me.name })

  const client = await clientPromise
  const db = client.db(DB)
  const now = new Date()
  const doc: Omit<PriceCompare, "_id"> = { ...base, docNo: await nextDocNo(db, bkkToday()), createdAt: toBkkIso(now), updatedAt: toBkkIso(now) }
  delete (doc as { _id?: string })._id

  // เลขที่ชนกับใบที่มีอยู่ (unique index) — เช่น seed/นำเข้าเก่าที่จองเลขไว้โดยไม่ผ่าน counter → ออกเลขใหม่แล้วลองอีกครั้งเดียว
  let r
  try {
    r = await db.collection(PC_COLL).insertOne(doc)
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e
    doc.docNo = await nextDocNo(db, bkkToday())
    r = await db.collection(PC_COLL).insertOne(doc)
  }

  try {
    await writePcLog(db, { docId: String(r.insertedId), docNo: doc.docNo, action: "create", by: me.name, byEmail: me.email, at: now, statusChange: { from: "", to: "ร่าง" } })
  } catch (e) { console.error("[price-compare log]", e) }   // log ล้มต้องไม่ทำให้การสร้างที่สำเร็จแล้วกลายเป็น 500
  return NextResponse.json({ ...doc, _id: String(r.insertedId) }, { status: 201 })
}
