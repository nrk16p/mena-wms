import { NextRequest, NextResponse } from "next/server"
import { sheetDb } from "@/lib/tyre-sheet-db"
import { ROUNDS_COLL, ROWS_COLL, parseDate, type AnyRow } from "@/lib/tyre-sheet"

// GET /api/tyre-sheet/rounds/prs?from=2026-10-01&to=2026-10-31
// เลข PR ที่มีในข้อมูลยาง (ส่งแล้ว) ช่วงวันที่จองนั้น — ไว้ให้เลือกตอนตั้งรอบ ไม่ใส่ช่วงวันที่ = PR ล่าสุด 15 เลข
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const from = parseDate(sp.get("from")), to = parseDate(sp.get("to"))
  const match: AnyRow = { stage: "sent", pr: { $nin: ["", null] } }
  if (from || to) match.bookingDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  const db = await sheetDb()
  const prs = await db.collection(ROWS_COLL).aggregate([
    { $match: match },
    { $group: { _id: "$pr", count: { $sum: 1 }, from: { $min: "$bookingDate" }, to: { $max: "$bookingDate" }, sizes: { $addToSet: "$size" } } },
    { $sort: { to: -1, _id: -1 } },
    { $limit: from || to ? 50 : 15 },
  ]).toArray()
  const used = new Set((await db.collection(ROUNDS_COLL).find({ pr: { $in: prs.map((p) => p._id) } }, { projection: { pr: 1 } }).toArray()).map((r) => r.pr))
  return NextResponse.json(prs.map((p) => ({
    pr: p._id, count: p.count, from: p.from, to: p.to,
    sizes: (p.sizes as (string | null)[]).filter(Boolean).sort(),
    hasRound: used.has(p._id),
  })))
}
