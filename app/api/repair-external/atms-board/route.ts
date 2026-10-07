import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { NEXT_SKIP_COLL, fetchAtmsBoard, findActiveSkip, findClosedMatch, isAtmsSettled, isAtmsSkipped, latestClosed, normKey, type ClosedMatch, type ClosedWmsJob, type NextSkip } from "@/lib/atms-board"
import { DONE_STATUSES, JOB_TYPE_PARTS, likelySameGarage } from "@/lib/repair-external"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"
import { bkkDate, bkkToday } from "@/lib/bkk-time"
import { garageKey } from "@/lib/atms-garage"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

// สถานะที่ถือว่างานจบแล้ว (ไม่ต้องเตือนให้ปิด) — รวม "รถเสร็จ(ไม่มี PR)" ที่ยังนับเป็น active ในหน้า list
const FINISHED = [...DONE_STATUSES, "รถเสร็จ(ไม่มี PR)"]

// GET /api/repair-external/atms-board
// เทียบข้อมูล 3 ทาง: รถจอดจริง (fleet) × งานอู่นอกเปิดใน ATMS (open-jobs) × งานอู่นอกเปิดใน WMS
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  try {
    // ใบเปิดใน WMS ไม่ขึ้นกับข้อมูล ATMS → อ่านพร้อมกับที่รอ Cloud Run
    const [board, client, wms] = await Promise.all([
      fetchAtmsBoard(),
      clientPromise,
      clientPromise.then((c) => c.db(DB).collection(COLL)
        .find(
          { status: { $nin: DONE_STATUSES }, jobType: { $ne: JOB_TYPE_PARTS } },
          { projection: { plate: 1, fleetNo: 1, mrNo: 1, status: 1, receivedDate: 1, dueDate: 1, garage: 1, garageAtmsId: 1, nextPushAt: 1, nextPushFrom: 1, prCode: 1, poCode: 1 } },
        )
        .toArray()),
    ])
    const db = client.db(DB)

    const wmsByPlate = new Map<string, (typeof wms)[number]>()
    const wmsByNum   = new Map<string, (typeof wms)[number]>()
    for (const w of wms) {
      if (normKey(w.plate))   wmsByPlate.set(normKey(w.plate), w)
      if (normKey(w.fleetNo)) wmsByNum.set(normKey(w.fleetNo), w)
    }
    const findWms = (plate: string, num: string) =>
      wmsByPlate.get(normKey(plate)) ?? (normKey(num) ? wmsByNum.get(normKey(num)) : undefined)

    const jobByPlate    = new Map(board.jobs.map((j) => [normKey(j.plate), j]))
    // งานที่ ATMS ปิดแล้ว (รถซ่อมเสร็จสิ้น / รถรอขาย) ไม่ใช่ภาระอู่ — ไม่ต้องทวงให้เปิดใบใน WMS
    // (ผู้ใช้สั่ง 21/09/2569: TH1979 สถานะ "รถรอขาย" ขึ้นว่าขาดในระบบทั้งที่ไม่ต้องทำอะไรแล้ว)
    // แยกแมปกัน: ตัวเต็มยังใช้บอก step/PR ของคันนั้นได้ แต่ชุดที่ใช้ "นับงานค้าง" ตัดของที่จบแล้วออก
    const openJobByPlate = new Map(board.jobs
      .filter((j) => !isAtmsSettled(j.step) && !isAtmsSkipped(j.step))
      .map((j) => [normKey(j.plate), j]))
    const parkedByPlate = new Map(board.parked.map((p) => [normKey(p.plate), p]))
    const parkedByNum   = new Map(board.parked.map((p) => [normKey(p.trucknum), p]))
    const findParked = (plate: string, num: string) =>
      parkedByPlate.get(normKey(plate)) ?? (normKey(num) ? parkedByNum.get(normKey(num)) : undefined)

    // ── รถค้างซ่อมอู่นอก "ตัวจริง" = จอดอยู่จริง ∧ มีงานอู่นอกเปิดใน ATMS (ชุดเดียวกับหน้า Pending Maintenance)
    const pending = board.parked
      .map((p) => {
        const job = openJobByPlate.get(normKey(p.plate))
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

    // ── ✅ ไม่มีใบเปิดใน WMS แต่ปิดงานไปแล้ว (รอบเดียวกัน หรือจัดซื้อเพิ่งปิดไม่เกิน 2 วัน) — Mena-Next ยังไม่อัปเดตสถานะรถ
    //    แยกออกจาก pending/missing: ไม่ต้องทวงให้สร้างใบ แค่โชว์ให้รู้ว่าใครปิดไปแล้ว
    //    ที่ไม่เข้าเงื่อนไข → ยังขาด แต่แนบ "ใบล่าสุดที่ปิด" ไปให้เห็นว่าเป็นคนละรอบ
    const today  = bkkToday()
    const noWms = pending.filter((p) => !p!.wms)
    const closedFor     = new Map<string, ClosedMatch>()    // key = plate จาก Mena-Next
    const lastClosedFor = new Map<string, ClosedWmsJob>()
    const readSkips = async (): Promise<NextSkip[]> => (await db.collection(NEXT_SKIP_COLL)
      .find({ cancelledAt: null, until: { $gte: today } })
      .toArray())
      .map((d) => ({
        id: String(d._id), plate: String(d.plate ?? ""), trucknum: String(d.trucknum ?? ""), mrCode: String(d.mrCode ?? ""),
        reason: String(d.reason ?? ""), by: String(d.by ?? ""), at: String(d.at ?? ""), until: String(d.until ?? ""),
      }))
    let skipsRead: NextSkip[] | null = null   // อ่านล่วงหน้าพร้อม log คนปิด (เฉพาะเมื่อแน่ใจว่าต้องใช้)
    if (noWms.length) {
      const plates = noWms.map((p) => p!.plate).filter(Boolean)
      const nums   = noWms.map((p) => p!.trucknum).filter(Boolean)
      const mrs    = noWms.map((p) => p!.mrCode).filter(Boolean)
      const closedDocs = await db.collection(COLL)
        .find(
          {
            status: { $in: DONE_STATUSES }, jobType: { $ne: JOB_TYPE_PARTS },
            $or: [{ plate: { $in: plates } }, { fleetNo: { $in: nums } }, { mrNo: { $in: mrs } }],
          },
          { projection: { plate: 1, fleetNo: 1, mrNo: 1, status: 1, statusSince: 1, statusSinceAt: 1, updatedAt: 1, editedBy: 1 } },
        )
        // ปิดวันเดียวกันหลายใบ (เช่นสร้างซ้ำ) → findClosedMatch เก็บใบแรกเมื่อวันเท่ากัน ให้ใบที่ปิดทีหลังสุดขึ้นก่อน
        .sort({ statusSinceAt: -1 })
        .toArray()
      const candsOf = (p: (typeof noWms)[number], closerOf: (id: string, status: string) => string | undefined): ClosedWmsJob[] =>
        closedDocs
          .filter((d) =>
            (normKey(d.plate) && normKey(d.plate) === normKey(p!.plate)) ||
            (normKey(d.fleetNo) && normKey(d.fleetNo) === normKey(p!.trucknum)) ||
            (normKey(d.mrNo) && normKey(d.mrNo) === normKey(p!.mrCode)))
          .map((d) => ({
            id: String(d._id), mrNo: String(d.mrNo ?? ""), status: String(d.status ?? ""),
            closedAt: String(d.statusSince || bkkDate(d.statusSinceAt ?? d.updatedAt)),
            closedBy: closerOf(String(d._id), String(d.status ?? "")) || String(d.editedBy ?? ""),
          }))
      // คันไหนจับคู่ใบปิดได้ไม่ขึ้นกับ "คนปิด" (findClosedMatch ดูแค่ MR/วันปิด) → รู้ก่อนเลยว่าจะยังมีคันขาดไหม
      // ถ้ามี (ต้องอ่านรายการตัดแน่ ๆ) ยิงพร้อมกับ log คนปิด แทนที่จะรอกันทีละคิวรี — จำนวนคิวรีเท่าเดิม
      const closedPlates = new Set(noWms
        .filter((p) => findClosedMatch(p!.mrCode, p!.since, candsOf(p, () => undefined), today))
        .map((p) => p!.plate))
      const needSkips = noWms.some((p) => !closedPlates.has(p!.plate))
      // คนปิดงาน = log ล่าสุดที่เปลี่ยนเป็นสถานะปัจจุบัน (editedBy อาจเป็นคนแก้ช่องอื่นทีหลัง)
      const [closers, skips] = await Promise.all([
        closedDocs.length
          ? db.collection(REPAIR_LOG_COLL)
              .find({ repairId: { $in: closedDocs.map((d) => String(d._id)) }, "statusChange.to": { $in: DONE_STATUSES } })
              .project({ repairId: 1, by: 1, at: 1, "statusChange.to": 1 })
              .sort({ at: -1 })
              .toArray()
          : [],
        needSkips ? readSkips() : null,
      ])
      skipsRead = skips
      const closerOf = (id: string, status: string) =>
        closers.find((l) => String(l.repairId) === id && l.statusChange?.to === status)?.by as string | undefined
      for (const p of noWms) {
        const cands = candsOf(p, closerOf)
        const hit = findClosedMatch(p!.mrCode, p!.since, cands, today)
        if (hit) closedFor.set(p!.plate, hit)
        else {
          const last = latestClosed(cands)
          if (last) lastClosedFor.set(p!.plate, last)
        }
      }
    }
    const closedInWms = pending
      .filter((p) => closedFor.has(p!.plate))
      .map((p) => ({ ...p!, closed: closedFor.get(p!.plate)! }))
    const notClosed = pending.filter((p) => !closedFor.has(p!.plate))

    // ── ⏸ คนกดตัดออกชั่วคราว (แย๊กโม่ / ซ่อมเสร็จ) จากแถว ❌ — ไม่นับทั้งตัวหารและตัวขาด จนพ้นกำหนดหรือ MR เปลี่ยน
    const skippedFor = new Map<string, NextSkip>()   // key = plate จาก Mena-Next
    if (notClosed.some((p) => !p!.wms)) {
      const skips = skipsRead ?? await readSkips()
      for (const p of notClosed) {
        if (p!.wms) continue
        const s = findActiveSkip(p!, skips, today)
        if (s) skippedFor.set(p!.plate, s)
      }
    }
    const skipped = notClosed
      .filter((p) => skippedFor.has(p!.plate))
      .map((p) => ({ ...p!, skip: skippedFor.get(p!.plate)! }))
    const stillPending = notClosed.filter((p) => !skippedFor.has(p!.plate))

    // ── 🔴 WMS ยัง "แจ้งซ่อมอู่นอก" แต่รถจอดจริงแล้ว
    const waitingButParked = wms
      .filter((w) => w.status === "แจ้งซ่อมอู่นอก")
      .map((w) => {
        const p = findParked(w.plate, w.fleetNo)
        return p ? { id: String(w._id), plate: w.plate, fleetNo: w.fleetNo, days: p.days, since: p.since, plant: p.plant } : null
      })
      .filter(Boolean)

    // ── 🟢 WMS ว่ายังซ่อมอยู่ (เลยขั้นแจ้งซ่อมอู่นอก และยังไม่จบ) แต่รถไม่อยู่ในรายการรถจอดแล้ว
    const openNotParked = wms
      .filter((w) => w.status !== "แจ้งซ่อมอู่นอก" && !FINISHED.includes(w.status) && !findParked(w.plate, w.fleetNo))
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

    // ── 🏭 ชื่ออู่ใน WMS ไม่ตรงกับ Mena-Next (ทั้งคู่อ้างชื่อ ATMS ชุดเดียวกัน) — ทุกคันที่จับคู่ได้ ไม่จำกัดว่าต้องจอดอยู่
    //    WMS ยังไม่กรอกอู่ก็นับ (เติมจาก Mena-Next ได้) · Mena-Next ไม่มีชื่ออู่ = เทียบไม่ได้ ข้าม
    // การปรับอู่ตาม Mena-Next ย้ายไปอยู่ที่ /api/garage-sync/tick (open-jobs สด ทุก 2 นาทีขณะมีคนเปิด WMS)
    // ที่นี่ใช้ open-jobs ที่ cache 5 นาที — ถ้าปรับตามจากค่านี้จะดึงอู่เก่ากลับมาทับรอบที่ใช้ค่าสด
    const garageFill = wms
      .filter((w) => !FINISHED.includes(w.status))
      .map((w) => {
        const job = jobByPlate.get(normKey(w.plate))
        if (!job?.vendor || garageKey(w.garage) === garageKey(job.vendor)) return null
        return {
          id: String(w._id), plate: w.plate, fleetNo: w.fleetNo ?? "", status: w.status,
          wmsGarage: String(w.garage ?? ""), wmsLinked: !!w.garageAtmsId, nextGarage: job.vendor,
          // empty = WMS ยังไม่กรอก · spelling = อู่เดียวกันแค่สะกดต่าง · different = น่าจะคนละอู่ (ต้องให้คนตัดสิน)
          kind: !String(w.garage ?? "").trim() ? "empty" : likelySameGarage(String(w.garage), job.vendor) ? "spelling" : "different",
          mrCode: job.mrCode,
          mrConflict: !!normKey(w.mrNo) && normKey(w.mrNo) !== normKey(job.mrCode),
          wmsMr: w.mrNo ?? "",
        }
      })
      .filter(Boolean)
    const openWms = wms.filter((w) => !FINISHED.includes(w.status))
    const garageLinked = { linked: openWms.filter((w) => !!w.garageAtmsId).length, total: openWms.length }

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
      pending: stillPending,
      missing: stillPending
        .filter((p) => !p!.wms)
        .map((p) => (lastClosedFor.has(p!.plate) ? { ...p!, lastClosed: lastClosedFor.get(p!.plate)! } : p)),
      closedInWms,
      skipped,
      waitingButParked,
      openNotParked,
      prFill,
      garageFill,
      garageLinked,
      byKey,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 })
  }
}
