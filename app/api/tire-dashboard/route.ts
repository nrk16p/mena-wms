import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { sharedCache, CACHE_TAGS } from "@/lib/shared-cache"
import { tireFreshness } from "@/lib/tire-freshness"
import { BKK_OFFSET_MS } from "@/lib/bkk-time"
import { loadRequestTimeline, type TimelineItem } from "@/lib/tire-request-timeline"
import { loadLatestPlantsSafe } from "@/lib/vehicle-plant"
import { isIgnoredPlate } from "@/lib/tire-due"

const DB = process.env.MONGO_DB ?? "master_data"

export const dynamic = "force-dynamic"

// GET /api/tire-dashboard?branch= — ยางที่อยู่บนรถตอนนี้ "ทุกเส้น" (ไม่ตัด 1,000 แถวแบบ /api/tire-due)
// ให้หน้า Dashboard ทำ Slicer / Pivot ฝั่งเครื่องผู้ใช้ได้เอง
//
// ราวหมื่นเส้น → ส่งแบบพจนานุกรม: ข้อมูลรายคัน (ทะเบียน/ฟลีท/แพล้นท์) กับชื่อรุ่นยางส่งครั้งเดียว
// แต่ละเส้นอ้างเป็นเลขลำดับ ไม่ต้องทวนชื่อแพล้นท์ซ้ำหมื่นรอบ
//
//   vehicles[i] = [branch, plate, fleetNo, vehicleType, fleet, plant, activeRequests]
//   tires[j]    = [vehicleIdx, productIdx, unit(h|t), level, usedPct|null, kmUsed, specDistance,
//                  source, changeIn(YYYY-MM-DD)|"", positionIdx, serialNo, flags,
//                  id, follow, acceptedByIdx|-1, acceptedAt(YYYY-MM-DD)|""]
//   positions[k] = ชื่อตำแหน่งยาง ("F2ล้อหน้าข้างขวา") — ซ้ำกันทั้งฟลีต ส่งเป็นพจนานุกรมเหมือนรุ่นยาง
//   flags: 1 = พักแจ้งเตือนอยู่ · 2 = รับเรื่องไปแล้ว · 4 = ระยะนับได้ไม่ครบ (partial)
//   follow (งานติดตาม): p = รออนุมัติ · w = รอเปลี่ยน (อนุมัติ/นัดหมายแล้ว) · d = เปลี่ยนแล้ว
//                      a = รับเรื่องแล้ว (ยังไม่มีคำขอ) · n = ยังไม่รับเรื่อง
//   people[k] = ชื่อคนรับเรื่อง
//
// แคชตาม tag "tire" เหมือนแท็บอื่น — เขียนผ่าน WMS ทุกเส้นล้างแคชให้เอง
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch")?.trim() ?? ""

  const client = await clientPromise
  const db = client.db(DB)

  const payload = await sharedCache.get({
    key: `tire-dashboard:${branch}`,
    tags: [CACHE_TAGS.tire],
    freshMs: 5 * 60_000,
    maxStaleMs: 60 * 60_000,
    load: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match: Record<string, any> = { isSpare: { $ne: true } }
      if (branch) match.branch = branch
      const [rows, timeline, latestPlant] = await Promise.all([
        db.collection("tire_distance").find(match).project({
          branch: 1, plate: 1, fleetNo: 1, vehicleType: 1, fleet: 1, plant: 1, unit: 1,
          product: 1, level: 1, usedPct: 1, kmUsed: 1, specDistance: 1, source: 1, changeIn: 1,
          tirePosition: 1, serialNo: 1, snoozedUntil: 1, acceptedAt: 1, acceptedBy: 1, partial: 1,
        }).toArray(),
        loadRequestTimeline(db, branch),
        loadLatestPlantsSafe(client),
      ])

      // งานติดตามรายเส้น — จับคู่คำขอกับยางด้วยซีเรียล (กติกาเดียวกับหน้ารถรายคัน)
      // "เปลี่ยนแล้ว" ดูย้อน 45 วัน: ยางเก่ายังค้างบนรถจนกว่าจะดึง ATMS รอบหน้า (จับด้วยซีเรียล)
      // ดึงแล้วยางใหม่ขึ้นแทนที่ตำแหน่งเดิม → จับด้วยตำแหน่ง ถ้าใส่หลังวันแจ้ง
      const recent = Date.now() - 45 * 86_400_000
      const bySerial = new Map<string, TimelineItem>()
      const doneByPos = new Map<string, TimelineItem>()
      const reqCount = new Map<string, number>()
      const rank = (t: TimelineItem) => (t.stage === "pending" || t.stage === "waiting" ? 2 : t.stage === "done" ? 1 : 0)
      for (const t of timeline) {
        const vk = `${t.branch}|${t.plate}`
        if (t.stage === "pending" || t.stage === "waiting") reqCount.set(vk, (reqCount.get(vk) ?? 0) + 1)
        if (t.stage === "done" && (!t.closedAt || t.closedAt.getTime() < recent)) continue
        if (t.stage === "rejected") continue
        if (t.serialNo) {
          const k = `${vk}|${t.serialNo}`
          const cur = bySerial.get(k)
          if (!cur || rank(t) > rank(cur) || (rank(t) === rank(cur) && t.createdAt > cur.createdAt)) bySerial.set(k, t)
        }
        if (t.stage === "done" && t.position) {
          const k = `${vk}|${t.position}`
          const cur = doneByPos.get(k)
          if (!cur || t.createdAt > cur.createdAt) doneByPos.set(k, t)
        }
      }
      const people: string[] = []
      const peopleIdx = new Map<string, number>()

      const vIdx = new Map<string, number>()
      const vehicles: (string | number)[][] = []
      const pIdx = new Map<string, number>()
      const products: string[] = []
      const posIdx = new Map<string, number>()
      const positions: string[] = []
      const now = Date.now()
      const tires: (string | number | null)[][] = []

      for (const r of rows) {
        const plate = String(r.plate ?? "").trim()
        // snapshot เก่าอาจยังมีทะเบียนที่เพิ่งตั้งกฎตัด — กรองซ้ำตอนอ่านจนกว่าจะ rebuild รอบหน้า
        if (!plate || isIgnoredPlate(plate)) continue
        const vk = `${r.branch}|${plate}`
        let vi = vIdx.get(vk)
        if (vi === undefined) {
          vi = vehicles.length
          vIdx.set(vk, vi)
          vehicles.push([
            String(r.branch ?? ""), plate, String(r.fleetNo ?? ""), String(r.vehicleType ?? "").trim(),
            // แพล้นท์ยึด vehicle_daily_asia วันล่าสุด — snapshot อาจค้างค่าก่อนย้ายแพล้นท์
            String(r.fleet ?? "").trim(), latestPlant.get(plate)?.plant ?? String(r.plant ?? "").trim(), reqCount.get(vk) ?? 0,
          ])
        }
        // ชื่อรุ่นจากต้นทางบางเส้นมีช่องว่างท้าย — ตัดก่อน ไม่งั้นแตกเป็นสองรุ่นใน Slicer
        const product = String(r.product ?? "").trim()
        let pi = pIdx.get(product)
        if (pi === undefined) { pi = products.length; pIdx.set(product, pi); products.push(product) }

        const position = String(r.tirePosition ?? "")
        let ki = posIdx.get(position)
        if (ki === undefined) { ki = positions.length; posIdx.set(position, ki); positions.push(position) }

        const changeIn = r.changeIn ? new Date(r.changeIn) : null
        const snoozed  = !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > now
        const flags = (snoozed ? 1 : 0) | (r.acceptedAt ? 2 : 0) | (r.partial ? 4 : 0)

        const serial = String(r.serialNo ?? "").trim()
        let req = serial ? bySerial.get(`${vk}|${serial}`) : undefined
        if (!req) {
          const d = doneByPos.get(`${vk}|${position}`)
          if (d && changeIn && changeIn.getTime() >= d.createdAt.getTime() - 86_400_000) req = d
        }
        const follow = req
          ? req.stage === "pending" ? "p" : req.stage === "waiting" ? "w" : "d"
          : r.acceptedAt ? "a" : "n"
        const by = String(r.acceptedBy ?? "").trim()
        let bi = -1
        if (r.acceptedAt && by) {
          bi = peopleIdx.get(by) ?? -1
          if (bi < 0) { bi = people.length; peopleIdx.set(by, bi); people.push(by) }
        }
        const day = (v: unknown) => {
          const d = v ? new Date(v as string) : null
          return d && !isNaN(d.getTime()) ? new Date(d.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10) : ""
        }
        tires.push([
          vi, pi, r.unit === "trailer" ? "t" : "h", String(r.level ?? "unknown"),
          typeof r.usedPct === "number" ? r.usedPct : null,
          Math.round(Number(r.kmUsed) || 0), Math.round(Number(r.specDistance) || 0),
          String(r.source ?? "none"),
          day(r.changeIn), ki, serial, flags,
          String(r._id), follow, bi, r.acceptedAt ? day(r.acceptedAt) : "",
        ])
      }
      return { vehicles, products, positions, people, tires }
    },
  })

  const freshness = await tireFreshness(db, branch)
  return NextResponse.json({ ...payload, freshness })
}
