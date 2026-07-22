import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { REPAIR_DONE_STATUS, REPAIR_STATUS_SLA_DAYS, REPAIR_SLA_FROM_DUE } from "@/lib/repair-external"

// วันที่ = today ลบ n วัน → "YYYY-MM-DD"
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// GET /api/repair-external/stats?scope=active|done
// นับจำนวนต่อสถานะ (ตาม scope) + total + overdue (เลยกำหนดและยังไม่เสร็จ)
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope")?.trim() ?? ""

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match: Record<string, any> =
    scope === "done"   ? { status: REPAIR_DONE_STATUS } :
    scope === "active" ? { status: { $ne: REPAIR_DONE_STATUS } } : {}

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const agg = await col.aggregate([
    { $match: match },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]).toArray()

  const counts: Record<string, number> = {}
  let total = 0
  for (const g of agg) { counts[(g._id as string) || ""] = g.n as number; total += g.n as number }

  const today = new Date().toISOString().slice(0, 10)
  const overdue = await col.countDocuments({
    dueDate: { $ne: "", $lt: today },
    status:  { $ne: REPAIR_DONE_STATUS },
  })

  // ค้างเกิน SLA: อยู่ในสถานะที่มีลิมิต และเกิน N วัน (จาก statusSince หรือ dueDate)
  const slaConds = Object.entries(REPAIR_STATUS_SLA_DAYS).map(([status, limit]) => {
    const field = REPAIR_SLA_FROM_DUE.has(status) ? "dueDate" : "statusSince"
    return { status, [field]: { $ne: "", $lt: daysAgo(limit) } }
  })
  const slaBreached = slaConds.length ? await col.countDocuments({ $or: slaConds }) : 0

  // รอใบเสนอราคา ที่ยังไม่มี PR
  const noPr = await col.countDocuments({ status: "รอใบเสนอราคา", $or: [{ prCode: "" }, { prCode: { $exists: false } }] })

  // ค่าเฉลี่ยวันซ่อม (today − receivedDate) + การกระจายตามอายุงาน + เฉลี่ยต่อสถานะ
  const dated = await col.find({ ...match, receivedDate: { $ne: "" } }).project({ receivedDate: 1, status: 1, _id: 0 }).toArray()
  const nowMs = Date.now()
  let sum = 0, n = 0
  const agingBuckets = { lt8: 0, d8_14: 0, gte15: 0 }
  const stSum: Record<string, number> = {}, stN: Record<string, number> = {}
  for (const d of dated) {
    const dt = new Date(d.receivedDate as string)
    if (isNaN(dt.getTime())) continue
    const days = Math.max(0, Math.floor((nowMs - dt.getTime()) / 86400000))
    sum += days; n++
    if (days >= 15) agingBuckets.gte15++
    else if (days >= 8) agingBuckets.d8_14++
    else agingBuckets.lt8++
    const st = (d.status as string) || ""
    stSum[st] = (stSum[st] || 0) + days
    stN[st]   = (stN[st] || 0) + 1
  }
  const avgDays = n ? Math.round((sum / n) * 10) / 10 : 0
  const avgByStatus: Record<string, number> = {}
  for (const st of Object.keys(stN)) avgByStatus[st] = Math.round(stSum[st] / stN[st])

  // สัดส่วนตามฟลีท
  const fleetAgg = await col.aggregate([
    { $match: { ...match, fleet: { $ne: "" } } },
    { $group: { _id: "$fleet", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray()
  const fleetDist = fleetAgg.map((f) => ({ fleet: (f._id as string) || "—", count: f.n as number }))

  return NextResponse.json({ counts, total, overdue, slaBreached, noPr, avgDays, avgByStatus, agingBuckets, fleetDist })
}
