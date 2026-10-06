import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { sharedCache, CACHE_TAGS } from "@/lib/shared-cache"
import { buildFleetBase, fleetPlates, finishFleet, tireFleetKey } from "@/lib/tire-fleet-summary"

const DB = process.env.MONGO_DB ?? "master_data"

// GET /api/tire-fleet?branch=&q= — รถ unique ทุกคันจาก Change History (ทั้ง 2 สาขา)
// พร้อมสรุปสภาพยางรายคัน (รอบเปลี่ยนจาก tire_distance, อายุยางเป็นตัวสำรอง) + จำนวนคำขอที่ค้างอยู่
//
// แคช: สแกน 3 collection ยาง (เขียนผ่าน WMS เท่านั้น ทุกเส้นล้าง tag "tire") เก็บเป็นก้อนสรุปที่ไม่ขึ้นกับเวลา
// ส่วนที่ขึ้นกับเวลา (อายุยาง / พักแจ้งเตือน) คิดสดทุกครั้ง · vehicle_master ดึงสดทุกครั้ง (มีคนเขียนนอกระบบยาง)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const branch = searchParams.get("branch")?.trim() ?? ""
  const q      = searchParams.get("q")?.trim()      ?? ""

  const client = await clientPromise
  const db = client.db(DB)

  const base = await sharedCache.get({
    key: tireFleetKey(branch, q),
    tags: [CACHE_TAGS.tire],
    freshMs: 5 * 60_000,
    maxStaleMs: 60 * 60_000,
    load: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match: Record<string, any> = { isLatest: true, vehicle: { $nin: ["", null] } }
      if (branch) match.branch = branch
      if (q) match.vehicle = { $regex: q, $options: "i" }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqMatch: Record<string, any> = {
        "items.0": { $exists: true },
        $or: [{ status: { $in: ["pending", "approved", "appointment"] } }, { status: { $exists: false } }],
      }
      if (branch) reqMatch.branch = branch

      // สถานะรอบเปลี่ยนรายเส้น — ตัวเดียวกับที่แอปคนขับและแท็บ "ยางถึงกำหนดเปลี่ยน" ใช้
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dueMatch: Record<string, any> = { isSpare: { $ne: true } }
      if (branch) dueMatch.branch = branch

      const [tires, activeReqs, dueRows] = await Promise.all([
        db.collection("tire_change")
          .find(match)
          .project({ branch: 1, vehicle: 1, tirePosition: 1, changeIn: 1 })
          .toArray(),
        db.collection("tire_change_request")
          .find(reqMatch)
          .project({ branch: 1, plate: 1, status: 1 })
          .toArray(),
        db.collection("tire_distance")
          .find(dueMatch)
          .project({ branch: 1, plate: 1, level: 1, usedPct: 1, snoozedUntil: 1 })
          .toArray(),
      ])
      return buildFleetBase(tires, activeReqs, dueRows)
    },
  })

  // vehicle master join (type / fleet)
  const plates = fleetPlates(base)
  const masters = plates.length > 0
    ? await db.collection("vehicle_master")
        .find({ plate: { $in: plates } })
        .project({ plate: 1, vehicleType: 1, fleet: 1, plant: 1 })
        .toArray()
    : []

  return NextResponse.json(finishFleet(base, masters))
}
