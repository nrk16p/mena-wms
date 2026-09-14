import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { rebuildTireDistance } from "@/lib/tire-distance"

const DB = process.env.MONGO_DB ?? "master_data"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filter = Record<string, any>

// "ยังคำนวณไม่ได้" มี 2 แบบที่ต้องแยกให้ผู้ใช้แก้ถูกทาง:
//   nospec    = รู้ระยะที่วิ่งแล้ว แต่ยังไม่ตั้งระยะกำหนดของรุ่นยาง → ไปตั้งที่ /tire/master
//   nodistance = ไม่มีวันเปลี่ยนเข้า หรือทะเบียนไม่มีทั้ง GPS และค่าเที่ยว → แก้ที่ต้นทาง
const GROUP_FILTER: Record<string, Filter> = {
  alert:      { level: { $in: ["over", "due"] } },
  over:       { level: "over" },
  due:        { level: "due" },
  warn:       { level: "warn" },
  ok:         { level: "ok" },
  nospec:     { level: "unknown", source: { $ne: "none" }, changeIn: { $ne: null }, specDistance: { $lte: 0 } },
  nodistance: { level: "unknown", $or: [{ source: "none" }, { changeIn: null }] },
  // ยางอะไหล่ยังไม่ได้ใช้งาน — แยกไว้ ไม่ให้ไปปนกับยางที่วิ่งจริง
  spare:      { isSpare: true },
}

// GET /api/tire-due?branch=&unit=&q=&group=alert&includeSnoozed=0
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const unit   = searchParams.get("unit")?.trim()   ?? ""
  const q      = searchParams.get("q")?.trim()      ?? ""
  const group  = searchParams.get("group")?.trim()  || "alert"
  const includeSnoozed = searchParams.get("includeSnoozed") === "1"
  // badge บนแท็บอยากได้แค่ตัวเลข — ไม่ต้องลากรายการเป็นพันแถวมาทิ้ง
  const countsOnly = searchParams.get("countsOnly") === "1"

  const client = await clientPromise
  const col = client.db(DB).collection("tire_distance")

  const base: Filter = {}
  if (branch) base.branch = branch
  if (unit === "head" || unit === "trailer") base.unit = unit
  if (q) base.plate = { $regex: q, $options: "i" }
  if (group !== "spare") base.isSpare = { $ne: true }
  const notSnoozed: Filter = { $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: new Date() } }] }

  const listFilter: Filter = { ...base, ...(GROUP_FILTER[group] ?? GROUP_FILTER.alert) }
  if (!includeSnoozed && group !== "snoozed") Object.assign(listFilter, notSnoozed)
  if (group === "snoozed") listFilter.snoozedUntil = { $gt: new Date() }

  const [items, counts, meta, snoozed] = await Promise.all([
    countsOnly ? [] : col.find(listFilter).sort({ usedPct: -1, kmUsed: -1 }).limit(1000).toArray(),
    Promise.all(
      Object.entries(GROUP_FILTER).map(async ([key, f]) => {
        // นับยางอะไหล่ต้องไม่ติดเงื่อนไข isSpare:{$ne:true} ที่ base ใส่ให้กลุ่มอื่น
        const scope: Filter = { ...base }
        if (key === "spare") delete scope.isSpare
        return [key, await col.countDocuments({ ...scope, ...f, ...notSnoozed })] as const
      }),
    ),
    col.find({}).sort({ computedAt: -1 }).limit(1).project({ computedAt: 1, dataThrough: 1 }).next(),
    col.countDocuments({ ...base, snoozedUntil: { $gt: new Date() } }),
  ])

  return NextResponse.json({
    items,
    summary: { ...Object.fromEntries(counts), snoozed },
    computedAt:  meta?.computedAt  ?? null,
    dataThrough: meta?.dataThrough ?? null,
  })
}

// POST /api/tire-due — สั่งคำนวณใหม่เอง (ปกติรอบจริงพ่วงท้าย cron tire-sync 02:00)
export async function POST() {
  const result = await rebuildTireDistance()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
