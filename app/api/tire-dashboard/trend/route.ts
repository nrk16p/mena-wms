import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { sharedCache, CACHE_TAGS } from "@/lib/shared-cache"
import { isTrailerUnit } from "@/lib/tire-due"
import { DAILY_COLLECTION, bkkDay, snapshotTireDue, type DailySnapshot } from "@/lib/tire-due-daily"
import { loadRequestTimeline } from "@/lib/tire-request-timeline"

const DB = process.env.MONGO_DB ?? "master_data"
const DAYS = 30

export const dynamic = "force-dynamic"

// GET /api/tire-dashboard/trend?branch= — ข้อมูลกราฟรายวันย้อน 30 วันของ Dashboard ยาง
//
//   requests  = ยางในคำขอเปลี่ยนรายเส้น + วันแจ้ง/วันอนุมัติ/วันปิด (เปลี่ยนเสร็จหรือปฏิเสธ)
//               หน้าเว็บนับ "ค้าง ณ สิ้นวัน" เอง จะได้กรองตาม Slicer ได้ — ข้อมูลย้อนหลังจริงครบ
//     dict[] = ข้อความทั้งหมด · items[i] = [branch, plate, plant, fleet, vehicleType, product, unit(h|t),
//              created, approved|"", closed|""]  (ตัวเลข = ลำดับใน dict · วันที่ = YYYY-MM-DD เวลาไทย)
//   snapshots = ยอดยางเกิน/ถึงกำหนด/เฝ้าระวังรายวันจาก tire_due_daily (เพิ่งเริ่มเก็บ — วันก่อนหน้านั้นไม่มี)
//
// ยังไม่มียอดของวันนี้ (cron ยังไม่วิ่ง หรือเพิ่งเปิดใช้) → ถ่ายจาก tire_distance ตอนนี้เลย
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch")?.trim() ?? ""
  const client = await clientPromise
  const db = client.db(DB)

  const now   = new Date()
  const today = bkkDay(now)
  const days: string[] = []
  for (let i = DAYS; i >= 0; i--) days.push(bkkDay(now.getTime() - i * 86_400_000))
  const from = days[0]

  const daily = db.collection<DailySnapshot>(DAILY_COLLECTION)
  if (!(await daily.findOne({ _id: today }, { projection: { _id: 1 } }))) {
    await snapshotTireDue(db, now).catch((e) => console.error("[tire-dashboard/trend] snapshot failed", e))
  }

  const requests = await sharedCache.get({
    key: `tire-dashboard-trend:${branch}:${today}`,
    tags: [CACHE_TAGS.tire],
    freshMs: 5 * 60_000,
    maxStaleMs: 60 * 60_000,
    load: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vMatch: Record<string, any> = {}
      if (branch) vMatch.branch = branch
      const [timeline, vehicles] = await Promise.all([
        loadRequestTimeline(db, branch),
        db.collection("tire_distance").aggregate<{ _id: { b: string; p: string }; plant: string; fleet: string; vt: string }>([
          { $match: vMatch },
          { $group: { _id: { b: "$branch", p: "$plate" }, plant: { $first: "$plant" }, fleet: { $first: "$fleet" }, vt: { $first: "$vehicleType" } } },
        ]).toArray(),
      ])
      const vInfo = new Map(vehicles.map((v) => [`${v._id.b}|${String(v._id.p ?? "").trim()}`, v]))

      const dict: string[] = []
      const dIdx = new Map<string, number>()
      const s = (v: string) => {
        let i = dIdx.get(v)
        if (i === undefined) { i = dict.length; dIdx.set(v, i); dict.push(v) }
        return i
      }
      const items: (number | string)[][] = []
      for (const t of timeline) {
        const created = bkkDay(t.createdAt)
        const closed  = t.closedAt ? bkkDay(t.closedAt) : ""
        // ปิดไปก่อนช่วงกราฟ = ไม่เคยค้างในช่วงนี้ ไม่ต้องส่ง
        if (closed && closed < from) continue
        const v = vInfo.get(`${t.branch}|${t.plate}`)
        items.push([
          s(t.branch), s(t.plate),
          s(String(v?.plant ?? t.plant ?? "").trim()), s(String(v?.fleet ?? t.fleet ?? "").trim()),
          s(String(v?.vt ?? "").trim()), s(t.product),
          isTrailerUnit(t.position) ? "t" : "h",
          created, t.approvedAt ? bkkDay(t.approvedAt) : "", closed,
        ])
      }
      return { dict, items }
    },
  })

  const snapshots = await daily.find({ _id: { $gte: from } }).sort({ _id: 1 }).toArray()
  const filterBranch = (g: DailySnapshot["groups"]) => (branch ? g.filter((x) => x[0] === branch) : g)

  return NextResponse.json({
    days,
    requests,
    snapshots: snapshots.map((d) => ({ date: d._id, groups: filterBranch(d.groups) })),
  })
}
