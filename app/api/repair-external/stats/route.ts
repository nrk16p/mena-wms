import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { DONE_STATUSES, JOB_TYPE_GARAGE, JOB_TYPE_PARTS, REPAIR_STATUS_SLA_DAYS } from "@/lib/repair-external"
import { bkkToday, bkkDaysAgo, daysSince } from "@/lib/bkk-time"
import { jobStartDate } from "@/lib/repair-external"

// วันที่ = วันนี้ (เวลาไทย) ลบ n วัน → "YYYY-MM-DD"
const daysAgo = (n: number): string => bkkDaysAgo(n)

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// GET /api/repair-external/stats?scope=active|done&type=อู่นอก|อะไหล่ลงคัน
// นับจำนวนต่อสถานะ (ตาม scope/type) + total + overdue (เลยกำหนดและยังไม่เสร็จ)
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope")?.trim() ?? ""
  const type  = req.nextUrl.searchParams.get("type")?.trim()  ?? ""

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match: Record<string, any> =
    scope === "done"   ? { status: { $in: DONE_STATUSES } } :
    scope === "active" ? { status: { $nin: DONE_STATUSES } } : {}
  // เอกสารเก่าไม่มี jobType = อู่นอก
  if (type === JOB_TYPE_PARTS)       match.jobType = JOB_TYPE_PARTS
  else if (type === JOB_TYPE_GARAGE) match.jobType = { $ne: JOB_TYPE_PARTS }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // นับแยก สถานะ × ประเภทงาน (เอกสารเก่าไม่มี jobType = อู่นอก) — ให้ UI แยก chips ต่อประเภทได้
  const agg = await col.aggregate([
    { $match: match },
    { $group: { _id: { s: "$status", t: { $ifNull: ["$jobType", JOB_TYPE_GARAGE] } }, n: { $sum: 1 } } },
  ]).toArray()

  const counts: Record<string, number> = {}
  const countsByType: Record<string, Record<string, number>> = { [JOB_TYPE_GARAGE]: {}, [JOB_TYPE_PARTS]: {} }
  let total = 0
  for (const g of agg) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = g._id as any
    const st = (id?.s as string) || ""
    const jt = (id?.t as string) === JOB_TYPE_PARTS ? JOB_TYPE_PARTS : JOB_TYPE_GARAGE
    counts[st] = (counts[st] || 0) + (g.n as number)
    countsByType[jt][st] = (countsByType[jt][st] || 0) + (g.n as number)
    total += g.n as number
  }

  // เงื่อนไขประเภทอย่างเดียว (ไม่มี status) — ใช้กับ query ที่กำหนด status เอง
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typeMatch: Record<string, any> = match.jobType !== undefined ? { jobType: match.jobType } : {}

  const today = bkkToday()
  const overdue = await col.countDocuments({
    ...typeMatch,
    dueDate: { $ne: "", $lt: today },
    status:  { $nin: DONE_STATUSES },
  })

  // ค้างเกิน SLA — กฎเดียว: สถานะในลิสต์ (รอ PR) ค้างเกิน N×24 ชม. นับจากเวลาเข้าสถานะ
  // รายการใหม่เทียบ statusSinceAt (ISO เวลาเต็ม) · รายการเก่าไม่มีเวลา → เทียบวันที่ statusSince
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slaConds: Record<string, any>[] = Object.entries(REPAIR_STATUS_SLA_DAYS).map(([status, limitDays]) => {
    const cutoffIso  = new Date(Date.now() - limitDays * 86400000).toISOString()
    const cutoffDate = daysAgo(limitDays)
    return {
      status,
      $or: [
        { statusSinceAt: { $ne: "", $lt: cutoffIso, $exists: true } },
        { $and: [ { $or: [{ statusSinceAt: { $exists: false } }, { statusSinceAt: "" }] }, { statusSince: { $ne: "", $lt: cutoffDate } } ] },
      ],
    }
  })
  const slaBreached = slaConds.length ? await col.countDocuments({ ...typeMatch, $or: slaConds }) : 0

  // รายการที่ยังไม่มี PR (ทุกสถานะในขอบเขต)
  const noPr = await col.countDocuments({ ...match, $or: [{ prCode: "" }, { prCode: { $exists: false } }] })

  // ค่าเฉลี่ยวันซ่อม (today − receivedDate) + การกระจายตามอายุงาน + เฉลี่ยต่อสถานะ
  const dated = await col.find({ ...match, receivedDate: { $ne: "" } }).project({ receivedDate: 1, garageInDate: 1, status: 1, _id: 0 }).toArray()
  const nowMs = Date.now()
  let sum = 0, n = 0
  const agingBuckets = { lt8: 0, d8_14: 0, gte15: 0 }
  const stSum: Record<string, number> = {}, stN: Record<string, number> = {}
  for (const d of dated) {
    const days = daysSince(jobStartDate(d as { receivedDate?: string; garageInDate?: string }))
    if (days === null) continue
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

  // จำนวนรถต่ออู่ (นับเฉพาะงานที่ยังไม่ปิด — "ตอนนี้อู่ไหนถือรถอยู่กี่คัน")
  const garageAgg = await col.aggregate([
    { $match: { ...match, garage: { $nin: ["", null] }, status: { $nin: DONE_STATUSES } } },
    { $group: { _id: "$garage", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray()
  const garageDist = garageAgg.map((g) => ({ garage: (g._id as string) || "—", count: g.n as number }))

  return NextResponse.json({ counts, countsByType, total, overdue, slaBreached, noPr, avgDays, avgByStatus, agingBuckets, fleetDist, garageDist })
}
