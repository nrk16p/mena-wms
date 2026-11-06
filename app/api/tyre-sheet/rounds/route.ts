import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb } from "@/lib/tyre-sheet-db"
import { ROUNDS_COLL, ROWS_COLL, parseDate } from "@/lib/tyre-sheet"

// GET /api/tyre-sheet/rounds — รอบอนุมัติ ใหม่ → เก่า พร้อมจำนวนเส้นในรอบ
export async function GET() {
  const db = await sheetDb()
  const rounds = await db.collection(ROUNDS_COLL).find({}).sort({ fromDate: -1, _id: -1 }).limit(100).toArray()
  const withCounts = await Promise.all(rounds.map(async (r) => ({
    ...r,
    count: await db.collection(ROWS_COLL).countDocuments({ stage: "sent", bookingDate: { $gte: r.fromDate, $lte: r.toDate }, pr: r.pr }),
  })))
  return NextResponse.json(withCounts)
}

// POST /api/tyre-sheet/rounds — ตั้งรอบใหม่ (ช่องเดิมของ template: จากวันที่ ถึงวันที่ PR ผู้จัดทำ ผู้อนุมัติ 1/2)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const fromDate = parseDate(b.fromDate), toDate = parseDate(b.toDate)
  const pr = String(b.pr ?? "").trim()
  if (!fromDate || !toDate || !pr) return NextResponse.json({ error: "ต้องมีจากวันที่ ถึงวันที่ และเลข PR" }, { status: 400 })
  if (fromDate > toDate) return NextResponse.json({ error: "จากวันที่ต้องไม่เกินถึงวันที่" }, { status: 400 })
  const user = session.user?.name ?? session.user?.email ?? ""
  const now = new Date()
  const doc = {
    fromDate, toDate, pr,
    preparer: String(b.preparer ?? "").trim(),
    approver1: String(b.approver1 ?? "").trim(),
    approver2: String(b.approver2 ?? "").trim(),
    createdAt: now, createdBy: user, updatedAt: now, updatedBy: user,
  }
  const db = await sheetDb()
  const r = await db.collection(ROUNDS_COLL).insertOne(doc)
  return NextResponse.json({ ok: true, id: String(r.insertedId) })
}
