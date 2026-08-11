import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { fetchAtmsBoard, normKey } from "@/lib/atms-board"
import { DONE_STATUSES, JOB_TYPE_PARTS } from "@/lib/repair-external"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// สถานะที่ถือว่างานจบแล้ว (ไม่ต้องเตือนให้ปิด) — รวม "รถเสร็จ(ไม่มี PR)" ที่ยังนับเป็น active ในหน้า list
const FINISHED = [...DONE_STATUSES, "รถเสร็จ(ไม่มี PR)"]

// GET /api/repair-external/atms-board
// เทียบข้อมูล 3 ทาง: รถจอดจริง (fleet) × งานอู่นอกเปิดใน ATMS (open-jobs) × งานอู่นอกเปิดใน WMS
export async function GET() {
  try {
    const [board, client] = await Promise.all([fetchAtmsBoard(), clientPromise])
    const wms = await client.db(DB).collection(COLL)
      .find(
        { status: { $nin: DONE_STATUSES }, jobType: { $ne: JOB_TYPE_PARTS } },
        { projection: { plate: 1, fleetNo: 1, mrNo: 1, status: 1, receivedDate: 1, dueDate: 1, garage: 1, prCode: 1, poCode: 1 } },
      )
      .toArray()

    const wmsByPlate = new Map<string, (typeof wms)[number]>()
    const wmsByNum   = new Map<string, (typeof wms)[number]>()
    for (const w of wms) {
      if (normKey(w.plate))   wmsByPlate.set(normKey(w.plate), w)
      if (normKey(w.fleetNo)) wmsByNum.set(normKey(w.fleetNo), w)
    }
    const findWms = (plate: string, num: string) =>
      wmsByPlate.get(normKey(plate)) ?? (normKey(num) ? wmsByNum.get(normKey(num)) : undefined)

    const jobByPlate    = new Map(board.jobs.map((j) => [normKey(j.plate), j]))
    const parkedByPlate = new Map(board.parked.map((p) => [normKey(p.plate), p]))
    const parkedByNum   = new Map(board.parked.map((p) => [normKey(p.trucknum), p]))
    const findParked = (plate: string, num: string) =>
      parkedByPlate.get(normKey(plate)) ?? (normKey(num) ? parkedByNum.get(normKey(num)) : undefined)

    // ── รถค้างซ่อมอู่นอก "ตัวจริง" = จอดอยู่จริง ∧ มีงานอู่นอกเปิดใน ATMS (ชุดเดียวกับหน้า Pending Maintenance)
    const pending = board.parked
      .map((p) => {
        const job = jobByPlate.get(normKey(p.plate))
        if (!job) return null
        const w = findWms(p.plate, p.trucknum)
        return {
          plate: p.plate, trucknum: p.trucknum, days: p.days, since: p.since,
          subStatus: p.subStatus, plant: p.plant,
          mrCode: job.mrCode, mrId: job.mrId, step: job.step, stepAt: job.stepAt,
          vendor: job.vendor, severity: job.severity, prAmount: job.prAmount, expectedDone: job.expectedDone,
          wms: w
            ? {
                id: String(w._id), status: w.status, mrNo: w.mrNo ?? "",
                mrMatch: !normKey(w.mrNo) ? "empty" : normKey(w.mrNo) === normKey(job.mrCode) ? "match" : "mismatch",
              }
            : null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.days - a!.days))

    // ── 🔴 WMS ยัง "รอรถเข้า" แต่รถจอดจริงแล้ว
    const waitingButParked = wms
      .filter((w) => w.status === "รอรถเข้า")
      .map((w) => {
        const p = findParked(w.plate, w.fleetNo)
        return p ? { id: String(w._id), plate: w.plate, fleetNo: w.fleetNo, days: p.days, since: p.since, plant: p.plant } : null
      })
      .filter(Boolean)

    // ── 🟢 WMS ว่ายังซ่อมอยู่ (เลยขั้นรอรถเข้า และยังไม่จบ) แต่รถไม่อยู่ในรายการรถจอดแล้ว
    const openNotParked = wms
      .filter((w) => w.status !== "รอรถเข้า" && !FINISHED.includes(w.status) && !findParked(w.plate, w.fleetNo))
      .map((w) => {
        const job = jobByPlate.get(normKey(w.plate))
        return {
          id: String(w._id), plate: w.plate, fleetNo: w.fleetNo, status: w.status,
          receivedDate: w.receivedDate ?? "", dueDate: w.dueDate ?? "",
          atmsStep: job?.step ?? "", // ถ้า ATMS ว่าเสร็จสิ้นด้วย ยิ่งชัดว่าควรปิด
        }
      })

    // ── 🧾 WMS ไม่มี PR แต่ ATMS มี purchase_links ให้เติม (ทุกคันที่จับคู่ได้ ไม่จำกัดว่าต้องจอดอยู่)
    const prFill = wms
      .filter((w) => !FINISHED.includes(w.status) && !String(w.prCode ?? "").trim())
      .map((w) => {
        const job = jobByPlate.get(normKey(w.plate))
        if (!job || !job.prCodes.length) return null
        return {
          id: String(w._id), plate: w.plate, fleetNo: w.fleetNo ?? "", status: w.status,
          mrCode: job.mrCode, prCodes: job.prCodes, poCodes: job.poCodes,
          poEmpty: !String(w.poCode ?? "").trim(),
          // MR ใน WMS ไม่ตรงกับ MR ปัจจุบันของ ATMS = อาจเป็นคนละรอบซ่อม — PR ที่เติมต้องตรวจก่อน
          mrConflict: !!normKey(w.mrNo) && normKey(w.mrNo) !== normKey(job.mrCode),
          wmsMr: w.mrNo ?? "",
        }
      })
      .filter(Boolean)

    // ── ข้อมูลราย "คัน" สำหรับ chip ในตาราง — key ทั้งทะเบียนและเบอร์รถ
    const byKey: Record<string, { parkedDays: number | null; since: string; step: string; stepAt: string; vendor: string; mrCode: string; mrId: number }> = {}
    const put = (key: string, plate: string) => {
      if (!key || byKey[key]) return
      const p = parkedByPlate.get(normKey(plate))
      const j = jobByPlate.get(normKey(plate))
      if (!p && !j) return
      byKey[key] = {
        parkedDays: p ? p.days : null, since: p?.since ?? "",
        step: j?.step ?? "", stepAt: j?.stepAt ?? "", vendor: j?.vendor ?? "", mrCode: j?.mrCode ?? "", mrId: j?.mrId ?? 0,
      }
    }
    for (const p of board.parked) { put(normKey(p.plate), p.plate); put(normKey(p.trucknum), p.plate) }
    for (const j of board.jobs)   { put(normKey(j.plate), j.plate) }

    return NextResponse.json({
      ok: true,
      fetchedAt: board.fetchedAt,
      pending,
      missing: pending.filter((p) => !p!.wms),
      waitingButParked,
      openNotParked,
      prFill,
      byKey,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}
