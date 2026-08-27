import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchAtmsBoard, normKey } from "@/lib/atms-board"
import { DONE_STATUSES, JOB_TYPE_PARTS } from "@/lib/repair-external"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// GET /api/repair-external/garage-load
// "ภาระอู่" จาก Mena-Next — งานซ่อม "อู่นอก" ที่ยังเปิดอยู่ทุกใบ (ไม่ว่ารถจะจอดอยู่ในลิสต์ fleet หรือไม่)
// ต่างจาก /atms-board ที่นับเฉพาะรถจอดจริง ∧ มีงานเปิด — อันนี้ต้องการภาระของอู่ทั้งหมดจึงไม่ตัดด้วย fleet
// การจัดกลุ่มต่ออู่/นับสถานะทำฝั่ง client เพราะข้อมูลแค่หลักร้อยแถว และหน้าเว็บต้องกรอง/เรียงได้สด
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  try {
    const [board, client] = await Promise.all([fetchAtmsBoard(), clientPromise])

    // ใบงานอู่นอกที่ยังไม่ปิดใน WMS — ไว้บอกว่างานฝั่ง Mena-Next มีคู่ในระบบเราหรือยัง
    const wms = await client.db(DB).collection(COLL)
      .find(
        { status: { $nin: DONE_STATUSES }, jobType: { $ne: JOB_TYPE_PARTS } },
        { projection: { plate: 1, fleetNo: 1, status: 1, garage: 1 } },
      )
      .toArray()

    const wmsByPlate = new Map<string, (typeof wms)[number]>()
    const wmsByNum   = new Map<string, (typeof wms)[number]>()
    for (const w of wms) {
      if (normKey(w.plate))   wmsByPlate.set(normKey(w.plate), w)
      if (normKey(w.fleetNo)) wmsByNum.set(normKey(w.fleetNo), w)
    }

    const parkedByPlate = new Map(board.parked.map((p) => [normKey(p.plate), p]))

    const jobs = board.jobs.map((j) => {
      const p = parkedByPlate.get(normKey(j.plate))
      const w = wmsByPlate.get(normKey(j.plate)) ?? (p?.trucknum ? wmsByNum.get(normKey(p.trucknum)) : undefined)
      return {
        plate: j.plate,
        trucknum: p?.trucknum ?? "",
        mrCode: j.mrCode,
        mrId: j.mrId,
        step: j.step,
        stepAt: j.stepAt,
        vendor: j.vendor,
        openedAt: j.openedAt,
        expectedDone: j.expectedDone,
        severity: j.severity,
        prAmount: j.prAmount,
        prCodes: j.prCodes,
        poCodes: j.poCodes,
        // จอดจริงกี่วันตาม fleet/current — null = ไม่อยู่ในรายการรถจอด (อาจกลับมาวิ่งแล้วแต่งานยังไม่ปิด)
        parkedDays: p ? p.days : null,
        plant: p?.plant ?? "",
        wms: w ? { id: String(w._id), status: String(w.status ?? ""), garage: String(w.garage ?? "") } : null,
      }
    })

    return NextResponse.json({ ok: true, fetchedAt: board.fetchedAt, jobs })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}
