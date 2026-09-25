/**
 * ปิด/ปฏิเสธคำขอเปลี่ยนยางอัตโนมัติ จากข้อมูลจริงใน ATMS (tire_change) + อายุคำขอ
 *
 * ปัญหาเดิม: คำขอที่ admin อนุมัติ/นัดหมายไว้แล้ว แต่ไม่มีใครกดปิดงานให้ (ลืม/ตกหล่น)
 * ทั้งที่ ATMS มีบันทึกอยู่แล้วว่าเปลี่ยนยางเส้นนั้นจริง — ค้างเป็นงานเปิดอยู่ในระบบเรื่อย ๆ
 * และคำขอที่ไม่มีใครตัดสินใจเลยเป็นเดือน ๆ ก็ควรถูกเคลียร์ไม่ให้กองเป็นขยะในคิว
 *
 * กติกา (เรียงตามลำดับ สำคัญมาก — ห้ามสลับ):
 *   1. ปิดงานอัตโนมัติก่อน ถ้า ATMS ยืนยันว่าเปลี่ยนยางตำแหน่งนี้ไปแล้วจริง (ไม่สนว่าอนุมัติ/นัดหรือยัง)
 *   2. ปฏิเสธอัตโนมัติทีหลัง สำหรับเส้นที่เหลือค้างเกิน 30 วัน — ทำหลังข้อ 1 เสมอ
 *      เพื่อไม่ให้เส้นที่เพิ่งถูก ATMS ยืนยันว่าเปลี่ยนแล้วโดนปฏิเสธซ้อนโดยไม่ได้ตั้งใจ
 */

import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { itemAppointment, rollupRequestStatus } from "@/lib/tire-request-status"

const DB        = process.env.MONGO_DB ?? "master_data"
const REQ_COLL  = "tire_change_request"
const CHG_COLL  = "tire_change"

const REJECT_AFTER_DAYS = 30
const REJECT_AFTER_MS   = REJECT_AFTER_DAYS * 86_400_000

const ATMS_ACTOR         = "ระบบ (ATMS)"
const AUTO_REJECT_ACTOR  = "ระบบ"
const AUTO_REJECT_REASON = `ระบบ: คำขอค้างเกิน ${REJECT_AFTER_DAYS} วัน`

// สถานะรายเส้นที่ยัง "เปิดอยู่" — เท่านั้นที่ auto-close/auto-reject แตะได้
const OPEN_ITEM_STATUSES = new Set(["pending", "approved"])
// เผื่อคำขอเก่าที่ไม่มี status เลย (ถือเป็น pending — ดู route.ts เดิม)
const OPEN_REQUEST_STATUS_OR = [
  { status: { $in: ["pending", "approved", "appointment"] } },
  { status: { $exists: false } },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>

/**
 * รหัสตำแหน่งจากข้อความ — ตัดเอาแค่ตัวอักษร+ตัวเลขนำหน้า (F1, RA5, RB13 ...)
 * ฝั่งคำขอกับฝั่ง ATMS เขียนข้อความตำแหน่งไม่เหมือนกัน ("RA5หลังซ้ายนอก" vs
 * "RA5ล้อหลังคู่หลังซ้ายเส้นนอก") รหัสนำหน้านี้คือจุดร่วมเดียวที่ match กันได้แน่นอน
 */
function positionCodeOf(s: string): string {
  const m = String(s ?? "").match(/^[A-Za-z]+\s*\d+/)
  return m ? m[0].replace(/\s+/g, "").toUpperCase() : ""
}

function itemCode(it: AnyDoc): string {
  return positionCodeOf(String(it.positionCode ?? "")) || positionCodeOf(String(it.tirePosition ?? ""))
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

type ChangeCandidate = {
  vehicle:             string
  code:                string
  serialNo:            string
  changeIn:             Date
  maintenanceRequest:  string
}

export type AutoResolveDetail = {
  requestId:    string
  branch:       string
  plate:        string
  position:     string
  action:       "close" | "reject"
  serialNo?:    string
  atmsSerialNo?: string
  atmsChangeIn?: Date
  atmsJobNo?:   string
  reason?:      string
}

export type AutoResolveSummary = {
  closedItems:      number
  rejectedItems:    number
  requestsTouched:  number
  dryRun:           boolean
  details:          AutoResolveDetail[]
}

export type AutoResolveOptions = {
  /** จำกัดสาขาที่ตรวจ (ไม่ระบุ = ทุกสาขาที่มีคำขอเปิดอยู่) */
  branches?:       string[]
  /** สาขาที่ sync ATMS "สำเร็จ" รอบนี้ — auto-reject (ข้อ 2) ทำได้เฉพาะสาขาในลิสต์นี้เท่านั้น
   *  ป้องกัน sync ที่ล้มเหลว/ข้อมูลเก่าทำให้ auto-close มองไม่เห็นการเปลี่ยนยางจริง แล้วดันไปปฏิเสธ
   *  เส้นที่จริง ๆ ถูกเปลี่ยนไปแล้ว — ไม่ระบุ = ไม่ auto-reject สาขาไหนเลย (ปลอดภัยไว้ก่อน) */
  rejectBranches?: string[]
  /** true = คำนวณทุกอย่างแต่ไม่เขียนลง DB */
  dryRun?:         boolean
  now?:            Date
}

export async function autoResolveTireRequests(opts: AutoResolveOptions = {}): Promise<AutoResolveSummary> {
  const now      = opts.now ?? new Date()
  const dryRun   = opts.dryRun ?? false
  const rejectOk = new Set(opts.rejectBranches ?? [])

  const client  = await clientPromise
  const db      = client.db(DB)
  const reqCol  = db.collection(REQ_COLL)
  const chgCol  = db.collection(CHG_COLL)

  const match: AnyDoc = { "items.0": { $exists: true }, $or: OPEN_REQUEST_STATUS_OR }
  if (opts.branches?.length) match.branch = { $in: opts.branches }

  const requests = await reqCol.find(match).toArray()
  const details: AutoResolveDetail[] = []
  let closedItems     = 0
  let rejectedItems   = 0
  let requestsTouched = 0

  if (!requests.length) {
    return { closedItems, rejectedItems, requestsTouched, dryRun, details }
  }

  // รวมทะเบียนที่ต้องเช็คต่อสาขา แล้วดึง tire_change ทีเดียวต่อสาขา (ไม่ query ซ้ำทีละคำขอ)
  const platesByBranch = new Map<string, Set<string>>()
  for (const doc of requests) {
    const branch = String(doc.branch ?? "").trim()
    const plate  = String(doc.plate ?? "").trim()
    if (!branch || !plate) continue
    if (!platesByBranch.has(branch)) platesByBranch.set(branch, new Set())
    platesByBranch.get(branch)!.add(plate)
  }

  // branch -> ประวัติ ATMS ที่ใช้แข่งได้ (มี serial + ตำแหน่ง + วันเปลี่ยนเข้าจริง)
  const candidatesByBranch = new Map<string, ChangeCandidate[]>()
  for (const [branch, plateSet] of platesByBranch) {
    const rows = await chgCol
      .find({
        branch,
        vehicle:  { $in: [...plateSet] },
        changeIn: { $ne: null },
        serialNo: { $exists: true, $ne: "" },
      })
      .project({ vehicle: 1, tirePosition: 1, serialNo: 1, changeIn: 1, maintenanceRequest: 1 })
      .toArray()

    const candidates: ChangeCandidate[] = []
    for (const row of rows) {
      const changeIn = asDate(row.changeIn)
      const code     = positionCodeOf(String(row.tirePosition ?? ""))
      const serialNo = String(row.serialNo ?? "").trim()
      if (!changeIn || !code || !serialNo) continue
      candidates.push({
        vehicle: String(row.vehicle ?? "").trim(),
        code, serialNo, changeIn,
        maintenanceRequest: String(row.maintenanceRequest ?? "").trim(),
      })
    }
    candidatesByBranch.set(branch, candidates)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bulkOps: any[] = []

  for (const doc of requests) {
    const branch      = String(doc.branch ?? "").trim()
    const plate       = String(doc.plate ?? "").trim()
    const reqCreated  = asDate(doc.createdAt) ?? new Date(0)
    const items: AnyDoc[] = Array.isArray(doc.items) ? doc.items : []
    if (!items.length) continue

    const candidates = (candidatesByBranch.get(branch) ?? []).filter((c) => c.vehicle === plate)
    let touched = false

    // ── ขั้นที่ 1: ปิดงานอัตโนมัติเมื่อ ATMS ยืนยันว่าเปลี่ยนจริงแล้ว ──────────────
    // ทำก่อนเสมอ และปิดได้ "ไม่ว่าจะอนุมัติ/นัดหมายไปถึงไหน" — ตราบใด ATMS มีบันทึกเปลี่ยนเข้า
    // ที่ตำแหน่งเดียวกัน serial ไม่ตรงกับที่คำขอนี้ยื่นไว้ (แปลว่าเปลี่ยนเส้นเก่าออกไปแล้วจริง)
    // และเกิดขึ้นหลังจากยื่นคำขอ (กันจับ ATMS record เก่าที่มีอยู่ก่อนยื่นคำขอมาปิดงานผิดตัว)
    const afterClose: AnyDoc[] = items.map((it) => {
      const status = String(it.status ?? "pending")
      if (!OPEN_ITEM_STATUSES.has(status)) return it

      const code = itemCode(it)
      if (!code) return it

      const itemCreated = asDate(it.createdAt) ?? reqCreated
      const itemSerial  = String(it.serialNo ?? "").trim()

      const winner = candidates
        .filter((c) =>
          c.code === code &&
          (!itemSerial || c.serialNo !== itemSerial) &&
          c.changeIn.getTime() > itemCreated.getTime()
        )
        .sort((a, b) => a.changeIn.getTime() - b.changeIn.getTime())[0]

      if (!winner) return it

      touched = true
      closedItems++
      const wasPending = status === "pending"
      const next: AnyDoc = {
        ...it,
        status:       "done",
        doneBy:       ATMS_ACTOR,
        doneAt:       now,
        autoClosed:   true,
        atmsSerialNo: winner.serialNo,
        atmsChangeIn: winner.changeIn,
        atmsJobNo:    winner.maintenanceRequest,
      }
      if (!it.jobNo && winner.maintenanceRequest) next.jobNo = winner.maintenanceRequest
      // เส้นที่ยังไม่เคยถูกอนุมัติ (pending) ให้ปั๊ม approvedBy/At ไปด้วย — รายงานที่อ่าน
      // สองฟิลด์นี้เพื่อสรุปว่า "ใครอนุมัติ" จะได้ไม่เจอเส้น done ที่ไม่มีคนอนุมัติค้างอยู่
      if (wasPending) { next.approvedBy = ATMS_ACTOR; next.approvedAt = now }

      details.push({
        requestId: String(doc._id), branch, plate,
        position:  String(it.positionCode || it.tirePosition || code),
        action:    "close",
        serialNo:  itemSerial || undefined,
        atmsSerialNo: winner.serialNo,
        atmsChangeIn: winner.changeIn,
        atmsJobNo:    winner.maintenanceRequest || undefined,
      })
      return next
    })

    // ── ขั้นที่ 2: ปฏิเสธอัตโนมัติเมื่อค้างเกิน 30 วัน (เฉพาะสาขาที่ sync สำเร็จรอบนี้) ──
    // ทำจาก afterClose เสมอ (ไม่ใช่ items ดั้งเดิม) เพื่อไม่ให้เส้นที่เพิ่งปิดในขั้นที่ 1
    // หลุดมาโดนปฏิเสธซ้อน — และข้ามเส้นที่มีวันนัดวันนี้/อนาคตอยู่แล้ว (ยังรอถึงวันนัดตามปกติ)
    const canReject = rejectOk.has(branch)
    const afterReject: AnyDoc[] = !canReject ? afterClose : afterClose.map((it) => {
      const status = String(it.status ?? "pending")
      if (!OPEN_ITEM_STATUSES.has(status)) return it

      const itemCreated = asDate(it.createdAt) ?? reqCreated
      if (now.getTime() - itemCreated.getTime() <= REJECT_AFTER_MS) return it

      const appt = itemAppointment(afterClose, it, doc.appointmentDate)
      const apptDate = appt ? asDate(appt) : null
      if (apptDate) {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        if (apptDate.getTime() >= todayStart.getTime()) return it // ยังรอถึงวันนัด — ไม่แตะ
      }

      touched = true
      rejectedItems++
      const next: AnyDoc = {
        ...it,
        status:          "rejected",
        rejectedBy:      AUTO_REJECT_ACTOR,
        rejectedAt:      now,
        rejectReason:    AUTO_REJECT_REASON,
        autoRejected:    true,
        appointmentDate: null,
      }
      details.push({
        requestId: String(doc._id), branch, plate,
        position:  String(it.positionCode || it.tirePosition || itemCode(it)),
        action:    "reject",
        serialNo:  String(it.serialNo ?? "").trim() || undefined,
        reason:    AUTO_REJECT_REASON,
      })
      return next
    })

    if (!touched) continue
    requestsTouched++

    const newStatus = rollupRequestStatus(afterReject, doc.appointmentDate)
    const reqSet: AnyDoc = { items: afterReject, status: newStatus, updatedAt: now }
    // ปิดครบทุกเส้นแล้วค่อยปั๊ม doneBy/doneAt ระดับใบ — เหมือน action "done" รายเส้นเดิม
    // (ดู app/api/tire-change-request/[id]/items/[itemId]/route.ts) ให้รายงานอ่านฟิลด์เดิมได้
    if (newStatus === "done") { reqSet.doneBy = ATMS_ACTOR; reqSet.doneAt = now }

    // เขียนทับ items ทั้งก้อน จึงต้องกันชนกับคนที่แก้ใบนี้อยู่พร้อมกัน (อนุมัติ/เพิ่มเส้นใหม่) —
    // ถ้า updatedAt เปลี่ยนไปแล้วระหว่างรอบนี้ ข้ามใบนั้นไป รอบถัดไปค่อยตรวจใหม่จากข้อมูลล่าสุด
    const filter: AnyDoc = { _id: doc._id as ObjectId, updatedAt: doc.updatedAt ?? { $exists: false } }
    bulkOps.push({ updateOne: { filter, update: { $set: reqSet } } })
  }

  if (!dryRun && bulkOps.length > 0) {
    await reqCol.bulkWrite(bulkOps, { ordered: false })
  }

  return { closedItems, rejectedItems, requestsTouched, dryRun, details }
}
