import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { rebuildTireDistance } from "@/lib/tire-distance"
import { DUE_LABEL, SOURCE_LABEL, positionOrder, type DueLevel, type DistanceSource } from "@/lib/tire-due"

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

// ── โหมดรถคันเดียว (แอปคนขับ) ───────────────────────────────────────────────
// GET /api/tire-due?plate=สบ.71-3569   หรือ   ?fleetNo=T-0080
// คนขับดูได้เฉพาะรถที่ถืออยู่ ไม่ต้องลากรายการทั้งฟลีตลงเครื่อง
// ส่งเฉพาะเส้นที่ต้องรู้ (เกิน/ถึงกำหนด/เฝ้าระวัง) — เส้นที่ยังปกติไม่ต้องรบกวน
async function vehicleView(req: NextRequest, plate: string, fleetNo: string) {
  const client = await clientPromise
  const col = client.db(DB).collection("tire_distance")

  const key: Filter = plate ? { plate: plate.trim() } : { fleetNo: fleetNo.trim() }
  const rows = await col
    .find({ ...key, isSpare: { $ne: true }, level: { $in: ["over", "due", "warn"] } })
    .toArray()

  if (rows.length === 0) {
    // แยก 2 กรณีให้แอปบอกผู้ใช้ได้ถูก: ไม่รู้จักทะเบียน กับ รู้จักแต่ยางยังไม่ถึงกำหนด
    const known = await col.countDocuments(key)
    return NextResponse.json({
      ...(plate ? { plate: plate.trim() } : { fleetNo: fleetNo.trim() }),
      found: known > 0,
      alert: false,
      summary: { over: 0, due: 0, warn: 0 },
      items: [],
      message: known > 0 ? "ยางทุกเส้นยังไม่ถึงกำหนดเปลี่ยน" : "ไม่พบทะเบียน/เบอร์รถนี้ในระบบ",
    }, { status: known > 0 ? 200 : 404 })
  }

  const now = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isSnoozed = (r: any) => !!r.snoozedUntil && new Date(r.snoozedUntil) > now
  rows.sort((a, b) => positionOrder(String(a.tirePosition ?? "")) - positionOrder(String(b.tirePosition ?? "")))

  const summary = { over: 0, due: 0, warn: 0 }
  for (const r of rows) if (!isSnoozed(r)) summary[r.level as "over" | "due" | "warn"]++

  const first = rows[0]
  return NextResponse.json({
    plate:       first.plate,
    fleetNo:     first.fleetNo ?? "",
    branch:      first.branch,
    vehicleType: first.vehicleType ?? "",
    found:       true,
    // แอปเอาค่านี้ไปตัดสินว่าจะเด้งแจ้งเตือนไหม — เส้นที่ถูกเลื่อนไว้ไม่นับ
    alert:       summary.over + summary.due > 0,
    summary,
    dataThrough: first.dataThrough ?? null,
    computedAt:  first.computedAt ?? null,
    items: rows.map((r) => ({
      id:           String(r._id),
      tirePosition: r.tirePosition,
      product:      r.product,
      serialNo:     r.serialNo,
      changeIn:     r.changeIn,
      kmUsed:       r.kmUsed,
      specDistance: r.specDistance,
      usedPct:      r.usedPct,
      level:        r.level,
      levelLabel:   DUE_LABEL[r.level as DueLevel],
      source:       SOURCE_LABEL[r.source as DistanceSource],
      // ระยะที่นับได้ยังไม่ครบตลอดอายุยาง (ใส่ก่อนวันที่ต้นทางเริ่มเก็บข้อมูล)
      partial:      !!r.partial,
      snoozedUntil: isSnoozed(r) ? r.snoozedUntil : null,
      snoozedBy:    isSnoozed(r) ? (r.snoozedBy ?? "") : "",
    })),
  })
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

  // แอปคนขับส่ง plate หรือ fleetNo มา → ตอบเป็นรถคันเดียว คนละรูปแบบกับรายการฝั่งแอดมิน
  const plate   = searchParams.get("plate")?.trim()   ?? ""
  const fleetNo = searchParams.get("fleetNo")?.trim() ?? ""
  if (plate || fleetNo) return vehicleView(req, plate, fleetNo)

  const client = await clientPromise
  const col = client.db(DB).collection("tire_distance")

  // ตัวกรองหลายชั้นมี $or ของตัวเอง (ค้นหา / ยังไม่ snooze / กลุ่ม nodistance)
  // ถ้า spread รวมกันตรงๆ ตัวหลังจะทับ $or ตัวหน้าเงียบๆ — ต้องต่อกันด้วย $and เสมอ
  const all = (...parts: Filter[]): Filter => {
    const use = parts.filter((p) => Object.keys(p).length > 0)
    return use.length === 0 ? {} : use.length === 1 ? use[0] : { $and: use }
  }

  const base: Filter = {}
  if (branch) base.branch = branch
  if (unit === "head" || unit === "trailer") base.unit = unit
  if (group !== "spare") base.isSpare = { $ne: true }
  // ค้นหาได้ทั้งทะเบียนและเบอร์รถ — คนวางแผนจำเบอร์รถมากกว่าทะเบียน
  const search: Filter = q
    ? { $or: [{ plate: { $regex: q, $options: "i" } }, { fleetNo: { $regex: q, $options: "i" } }] }
    : {}
  const notSnoozed: Filter = { $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: new Date() } }] }

  const groupFilter = GROUP_FILTER[group] ?? GROUP_FILTER.alert
  const listFilter =
    group === "snoozed" ? all(base, search, { snoozedUntil: { $gt: new Date() } })
    : includeSnoozed    ? all(base, search, groupFilter)
    :                     all(base, search, groupFilter, notSnoozed)

  const [items, counts, meta, snoozed] = await Promise.all([
    countsOnly ? [] : col.find(listFilter).sort({ usedPct: -1, kmUsed: -1 }).limit(1000).toArray(),
    Promise.all(
      Object.entries(GROUP_FILTER).map(async ([key, f]) => {
        // นับยางอะไหล่ต้องไม่ติดเงื่อนไข isSpare:{$ne:true} ที่ base ใส่ให้กลุ่มอื่น
        const scope: Filter = { ...base }
        if (key === "spare") delete scope.isSpare
        return [key, await col.countDocuments(all(scope, search, f, notSnoozed))] as const
      }),
    ),
    col.find({}).sort({ computedAt: -1 }).limit(1).project({ computedAt: 1, dataThrough: 1 }).next(),
    col.countDocuments(all(base, search, { snoozedUntil: { $gt: new Date() } })),
  ])

  return NextResponse.json({
    items,
    summary: { ...Object.fromEntries(counts), snoozed },
    computedAt:  meta?.computedAt  ?? null,
    dataThrough: meta?.dataThrough ?? null,
  })
}

// POST /api/tire-due — สั่งคำนวณใหม่เอง (ปกติรอบจริงพ่วงท้าย cron tire-sync)
//
// เปิดเฉพาะคนที่ login เว็บ — งานนี้กินเวลาราว 20 วินาทีและยิง api-ncac หลายสิบครั้ง
// ถ้าปล่อยให้แอปคนขับเรียกได้ด้วย x-api-key เครื่องเดียวกดรัวก็ถล่มระบบได้
export async function POST(req: NextRequest) {
  const hasSession =
    req.cookies.get("next-auth.session-token") ?? req.cookies.get("__Secure-next-auth.session-token")
  if (!hasSession) {
    return NextResponse.json(
      { error: "ต้องเข้าสู่ระบบผ่านเว็บ — สั่งคำนวณใหม่ทั้งฟลีตจากแอปไม่ได้" },
      { status: 403 },
    )
  }
  const result = await rebuildTireDistance()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
