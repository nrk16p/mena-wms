import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { bkkDate, bkkToday } from "@/lib/bkk-time"
import {
  DONE_STATUSES, JOB_TYPE_PARTS, OWNER_NO_FLEET, REPAIR_CLAIM_DONE_STATUS, REPAIR_DEFER_STATUS,
  REPAIR_DONE_NO_PR_STATUS, REPAIR_DONE_STATUS, REPAIR_STATUSES, isDoneStatus, normalizeStatus, ownerOfFleet,
  type DailySummary,
} from "@/lib/repair-external"

// GET /api/repair-external/daily-summary
// ตัวเลขทุกตัวของ "รายงานสรุปประจำวัน" ที่ส่งกลุ่มไลน์ — นับเฉพาะงานอู่นอกในระบบนี้
// (ไม่ดึงงานอู่ในจาก Mena-Next ตามที่ผู้ใช้กำหนด 21/09/2569)
// ขอบเขตข้อมูล: ใบที่ยังไม่ปิด + ใบที่เพิ่งออกจากคิววันนี้ เท่านั้น ไม่สแกนทั้งคอลเลกชัน
const DB = process.env.MONGO_DB ?? "master_data"

type Row = {
  status?: string; fleet?: string; fleetNo?: string; plate?: string
  prCode?: string; dueDate?: string; createdAt?: Date | string; statusSince?: string
}
const unitOf = (r: Row) => (String(r.fleetNo ?? "").trim() || String(r.plate ?? "").trim() || "-")
/** "TH1979 (สบ.71-2875)" — รายการรถที่ปิด/ชะลอวันนี้ ทีมอ่านทั้งเบอร์รถและทะเบียน */
const unitWithPlate = (r: Row) => {
  const no = String(r.fleetNo ?? "").trim(), plate = String(r.plate ?? "").trim()
  if (no && plate) return `${no} (${plate})`
  return no || plate || "-"
}

export async function GET() {
  const today = bkkToday()
  const db    = (await clientPromise).db(DB)
  const col   = db.collection("repair_external")
  const base  = { jobType: { $ne: JOB_TYPE_PARTS } }
  const proj  = { status: 1, fleet: 1, fleetNo: 1, plate: 1, prCode: 1, dueDate: 1, createdAt: 1, statusSince: 1 }

  const [active, leftToday] = await Promise.all([
    col.find({ ...base, status: { $nin: DONE_STATUSES } }).project(proj).toArray() as Promise<Row[]>,
    // ใบที่ "ออกจากคิว" วันนี้ — ปิดงาน/เคลมอู่/ชะลอ (statusSince ตั้งตอนเปลี่ยนสถานะเท่านั้น)
    col.find({ ...base, status: { $in: DONE_STATUSES }, statusSince: today }).project(proj).toArray() as Promise<Row[]>,
  ])

  const openedBefore = (r: Row) => bkkDate(r.createdAt ?? null) < today
  const closedToday  = leftToday.filter((r) => [REPAIR_DONE_STATUS, REPAIR_CLAIM_DONE_STATUS].includes(String(r.status)))
  const deferToday   = leftToday.filter((r) => String(r.status) === REPAIR_DEFER_STATUS)

  // ค้างต้นวัน = ที่ยังค้างอยู่ตอนนี้ (เปิดก่อนวันนี้) + ที่ออกจากคิวไปวันนี้ (เปิดก่อนวันนี้)
  const startOfDay  = active.filter(openedBefore).length + leftToday.filter(openedBefore).length
  const openedToday = active.filter((r) => bkkDate(r.createdAt ?? null) === today).length
    + leftToday.filter((r) => bkkDate(r.createdAt ?? null) === today).length

  const byStatus = REPAIR_STATUSES
    .filter((s) => !isDoneStatus(s.value))
    // normalize ก่อนเทียบ — ใบที่คีย์ไว้ก่อนเปลี่ยนชื่อสถานะจะได้ถูกนับในขั้นที่ถูกต้อง
    .map((s) => ({ status: s.value, count: active.filter((r) => normalizeStatus(String(r.status ?? "")) === s.value).length }))

  // ไม่มี PR → จัดกลุ่มผู้รับผิดชอบ แล้วแยกฟลีทในแต่ละคน (เรียงมากไปน้อย · กลุ่มไม่ระบุท้ายสุด)
  const noPrRows = active.filter((r) => !String(r.prCode ?? "").trim())
  const owners = new Map<string, Map<string, string[]>>()
  for (const r of noPrRows) {
    const owner = ownerOfFleet(r.fleet)
    const fleet = String(r.fleet ?? "").trim()
    if (!owners.has(owner)) owners.set(owner, new Map())
    const fleets = owners.get(owner)!
    fleets.set(fleet, [...(fleets.get(fleet) ?? []), unitOf(r)])
  }
  const noPr = [...owners.entries()]
    .map(([owner, fleets]) => ({
      owner,
      count: [...fleets.values()].reduce((n, u) => n + u.length, 0),
      fleets: [...fleets.entries()]
        .map(([fleet, units]) => ({ fleet, units }))
        .sort((a, b) => b.units.length - a.units.length || a.fleet.localeCompare(b.fleet, "th")),
    }))
    .sort((a, b) =>
      Number(a.owner === OWNER_NO_FLEET) - Number(b.owner === OWNER_NO_FLEET) ||
      b.count - a.count || a.owner.localeCompare(b.owner, "th"))

  // เร่งติดตาม = ซ่อมเสร็จแล้วแต่เลยวันกำหนดเสร็จ (ผู้ใช้เลือก 21/09/2569 — งานที่ยังซ่อมอยู่
  // ไม่นับ เพราะตามอู่ไปก็ยังไม่จบ) · ค้างนานสุดขึ้นก่อน
  const urgent = active
    .filter((r) => normalizeStatus(String(r.status ?? "")) === REPAIR_DONE_NO_PR_STATUS && r.dueDate && String(r.dueDate) < today)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .map(unitOf)

  const summary: DailySummary = {
    date:          today,
    startOfDay,
    openedToday,
    closedToday:   closedToday.length,
    closedUnits:   closedToday.map(unitWithPlate),
    deferredToday: deferToday.length,
    deferredUnits: deferToday.map(unitWithPlate),
    endOfDay:      active.length,
    byStatus,
    noPr,
    urgent: { units: urgent },
  }
  return NextResponse.json(summary)
}
