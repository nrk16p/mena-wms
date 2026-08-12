// ส่งมอบรถ พจส.ใหม่ — รวมข้อมูล 3 แหล่ง:
// 1) Google Sheet "Onboarding Mixer" tab ทะเบียนพจส.ใหม่ Mixer  → รายชื่อ พจส.ใหม่ + สถานะ (อ่าน/เขียนกลับ)
// 2) fleet/current (fastapi)      → รถที่จอดอยู่จริง + วันจอด
// 3) repair-board/open-jobs       → สถานะซ่อมปัจจุบัน + วันคาดเสร็จ + อะไหล่
// server-only — API key + service account อยู่ใน env ห้าม import จาก client component
// (types + status meta ฝั่ง client อยู่ใน lib/driver-handover-meta.ts)

import clientPromise from "@/lib/mongo"
import { readRange, batchUpdateValues, colLetter } from "@/lib/google-sheets"
import {
  ACTIVE_STATUSES, EDITABLE_STATUSES,
  type HandoverDriver, type HandoverTruck, type HandoverData,
} from "@/lib/driver-handover-meta"

export type { HandoverDriver, HandoverTruck, HandoverData }

const MONGODBAPI_URL = process.env.ATMS_MONGODBAPI_URL ?? "https://mongodbapi-548129382487.asia-southeast1.run.app/v1"
const FLEET_API_URL = process.env.ATMS_FLEET_API_URL ?? "https://fastapinextjs-548129382487.asia-southeast3.run.app"
const API_KEY = process.env.ATMS_API_KEY ?? ""

const SHEET_ID = process.env.ONBOARDING_SHEET_ID ?? "1xHsFw2NT-SfEqnEwAOa0qnkc20Zndzn4ZZ9qq24sYgE"
const DRIVER_TAB = "ทะเบียนพจส.ใหม่ Mixer"
const DATA_START_ROW = 4 // แถว 1-3 เป็น banner/header

// index คอลัมน์ในชีต (0-based) — อ้างอิง header แถว 3
const COL = {
  yearTh: 0, informDate: 2, rc: 3, trainStart: 4, code: 5, name: 6, phone: 7,
  position: 8, customer: 9, site: 10, status: 11, leaveDate: 12, zone: 13,
  trainer: 15, truckNum: 19, plate: 20, readiness: 32, examScore: 35,
  trainDue: 39, receivedDate: 40,
} as const
const LAST_COL = colLetter(COL.receivedDate) // AO

/* ---------- helpers ---------- */

const CUSTOMER_MAP: Record<string, string> = {
  TN: "T.N. ซีเมนต์", "T.N.": "T.N. ซีเมนต์", "T.N. ซีเมนต์": "T.N. ซีเมนต์",
}

/** เทียบเบอร์รถแบบไม่สนช่องว่าง เช่น "ME 127" = "ME127" */
export const normTruckNum = (s: string) => s.toUpperCase().replace(/\s+/g, "")

/** normalize ลูกค้า+ประเภทของ "คน" ให้ตรงกับ key ฝั่งรถ เช่น (Asia MS, Mixer S) -> "ASIA MS" */
export function driverFleetKey(customer: string, position: string): string {
  if (!customer.trim()) return "❓ไม่ระบุ" // ลูกค้าว่างในชีต — จับคู่รถไม่ได้จนกว่าจะเติม
  let c = customer.trim().toUpperCase().replace(/\s*MS$/i, "").trim()
  c = CUSTOMER_MAP[c] ?? c
  if (/SPARE/i.test(customer) || /SPARE/i.test(position)) return "SPARE"
  const type = /S\s*$/.test(position.trim()) && /mixer/i.test(position) ? "MS" : "ML"
  return `${c} ${type}`
}

/** วันที่ในชีตเป็น dd/mm/yyyy (ค.ศ.) */
export function parseSheetDate(s: string): Date | null {
  const m = (s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  let y = Number(m[3])
  if (y < 100) y += 2000
  if (y > 2400) y -= 543 // เผื่อกรอกเป็น พ.ศ.
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])))
  return isNaN(d.getTime()) ? null : d
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
/** วันนี้ตามเวลาไทย (UTC+7) เป็น Date เที่ยงคืน UTC — ให้ตรงกับ todayIso() ฝั่ง client */
const todayTh = () => new Date(new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10))

function mondayOf(d: Date): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() + 6) % 7))
  return r
}

async function apiGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "X-API-Key": API_KEY }, next: { revalidate: 120 } })
  if (!res.ok) throw new Error(`ATMS API ${res.status}: ${url.split("?")[0]}`)
  return res.json()
}

/* ---------- อ่านข้อมูล ---------- */

export async function fetchDrivers(): Promise<HandoverDriver[]> {
  const rows = await readRange(SHEET_ID, `'${DRIVER_TAB}'!A${DATA_START_ROW}:${LAST_COL}`)
  const today = todayTh()
  const out: HandoverDriver[] = []
  rows.forEach((r, i) => {
    const get = (c: number) => (r[c] ?? "").trim()
    const name = get(COL.name)
    const status = get(COL.status)
    if (!name || !status) return
    const keep = (ACTIVE_STATUSES as readonly string[]).includes(status) || status === "รับรถแล้ว"
    if (!keep) return

    const due = parseSheetDate(get(COL.trainDue))
    let readyDate: string | null = null
    let readyEstimated = false // true = ประมาณจากวันเริ่มฝึก+10 (ชีตไม่มีวันครบกำหนดจริง)
    const estimateFromStart = () => {
      const st = parseSheetDate(get(COL.trainStart))
      if (!st) return
      st.setUTCDate(st.getUTCDate() + 10)
      readyDate = iso(st)
      readyEstimated = true
    }
    if (status === "รอรับรถ") {
      // พร้อมตั้งแต่วันครบฝึก (ถ้ามี) ไม่งั้นถือว่าพร้อมแล้ววันนี้
      readyDate = due && due < today ? iso(due) : iso(today)
    } else if (status === "ฝึกงาน" || status === "ฝึกงาน 1-2 วัน") {
      if (due) readyDate = iso(due)
      else estimateFromStart()
    } else if (status === "รอฝึกงาน") {
      estimateFromStart()
    }
    const waitDays = status === "รอรับรถ" && readyDate
      ? Math.max(0, Math.round((today.getTime() - new Date(readyDate).getTime()) / 86400000))
      : 0

    out.push({
      row: DATA_START_ROW + i,
      code: get(COL.code), name, phone: get(COL.phone), position: get(COL.position),
      customer: get(COL.customer), site: get(COL.site), status, zone: get(COL.zone),
      trainer: get(COL.trainer), trainStart: get(COL.trainStart), trainDue: get(COL.trainDue),
      truckNum: get(COL.truckNum), plate: get(COL.plate), readiness: get(COL.readiness),
      examScore: get(COL.examScore), receivedDate: get(COL.receivedDate),
      fleetKey: driverFleetKey(get(COL.customer), get(COL.position)),
      readyDate, readyEstimated, waitDays, truckStatus: null,
    })
  })
  return out
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchTrucks(drivers: HandoverDriver[]): Promise<HandoverTruck[]> {
  const { trucks } = await fetchTrucksWithJobs(drivers)
  return trucks
}

async function fetchTrucksWithJobs(
  drivers: HandoverDriver[]
): Promise<{ trucks: HandoverTruck[]; jobByPlate: Map<string, any> }> {
  const [openJobsRaw, fleetRaw] = await Promise.all([
    apiGet(`${MONGODBAPI_URL}/repair-board/open-jobs`) as Promise<any>,
    apiGet(`${FLEET_API_URL}/fleet/current?status_id=2&status_id=4&status_id=5&minimal=true&branch_id=2&branch_id=5`) as Promise<any>,
  ])

  const jobByPlate = new Map<string, any>()
  for (const it of openJobsRaw.items ?? []) if (it.plate) jobByPlate.set(it.plate, it)

  // รถที่ถูกจองแล้ว: พจส. active + คนรับรถไปแล้วไม่เกิน 14 วัน (กันรถเพิ่งส่งมอบเด้งกลับมาเป็น "ว่าง")
  // เก็บเป็น list เพื่อโชว์เคสจองซ้ำ (เช่น ME127 ถูกจอง 2 คน)
  const today = todayTh()
  const reserved = new Map<string, string[]>()
  for (const d of drivers) {
    if (!d.truckNum) continue
    const active = (ACTIVE_STATUSES as readonly string[]).includes(d.status)
    let recent = false
    if (d.status === "รับรถแล้ว") {
      const rd = parseSheetDate(d.receivedDate)
      recent = !!rd && (today.getTime() - rd.getTime()) / 86400000 <= 14
    }
    if (active || recent) {
      const k = normTruckNum(d.truckNum)
      reserved.set(k, [...(reserved.get(k) ?? []), d.name])
    }
  }
  const out: HandoverTruck[] = []
  for (const st of fleetRaw.data ?? [])
    for (const b of st.branches ?? [])
      for (const c of b.customers ?? [])
        for (const vt of c.vehicle_types ?? [])
          for (const ot of vt.owner_types ?? [])
            for (const t of ot.trucks ?? []) {
              const raw = jobByPlate.get(t.truckplate)
              const j = raw?.open_maintenance_job
              const step: string = j?.current_step?.step?.label_th ?? ""
              const expected: string =
                (j?.expected_done_at ?? j?.open_expectation?.expected_at ?? "").slice(0, 10)

              let partsInfo = ""
              const links: any[] = j?.purchase_links ?? []
              if (links.length) {
                const approved = links.filter((l) => l.is_approved).length
                const pos = links.flatMap((l) => l.purchase_orders ?? [])
                const recv = pos.filter((p: any) => (p.received_status ?? "").includes("ทั้งหมด")).length
                partsInfo = `PR ${approved}/${links.length} อนุมัติ` + (pos.length ? ` · PO ${recv}/${pos.length} รับของครบ` : "")
              }

              const forSale = /รอขาย/.test(t.sub_status_name ?? "") || /รอขาย/.test(step)
              let readyBucket: string
              if (!j || step === "รถซ่อมเสร็จสิ้น") readyBucket = "พร้อมแล้ว"
              else if (!expected) readyBucket = "ไม่มี ETA"
              else {
                const exp = new Date(expected)
                // ETA วันนี้ = ยังไม่เกินกำหนด นับเป็นสัปดาห์ปัจจุบัน
                readyBucket = exp < today ? "เกินกำหนด" : iso(mondayOf(exp))
              }

              const type = vt.vehicle_type_abbr ?? ""
              const customer = c.customer_name ?? ""
              const holders = reserved.get(normTruckNum(t.trucknum ?? "")) ?? []
              out.push({
                trucknum: t.trucknum ?? "", plate: t.truckplate ?? "",
                customer, type, fleetKey: `${customer} ${type}`,
                plant: t.plant_name ?? "", statusName: st.status_name ?? "",
                subStatus: t.sub_status_name ?? "", parkedDays: Number(t.duration_days) || 0,
                since: (t.status_since ?? "").slice(0, 10), forSale,
                job: j ? {
                  mrCode: raw.mr_code ?? "", mrId: Number(raw.mr_id) || 0,
                  step, stepNote: j.current_step?.note ?? "",
                  stepAt: (j.current_step?.event_at ?? "").slice(0, 10),
                  repairMode: j.repair_mode_label ?? "", vendor: j.vendor_name ?? "",
                  expectedDone: expected, severity: j.severity ?? "",
                  prAmount: Number(j.pr_amount_total) || 0, partsInfo,
                } : null,
                readyBucket,
                reservedBy: holders.join(", "),
                reservedDup: holders.length > 1,
              })
            }
  return { trucks: out, jobByPlate }
}

export async function fetchHandoverData(): Promise<HandoverData> {
  const drivers = await fetchDrivers()
  const { trucks, jobByPlate } = await fetchTrucksWithJobs(drivers)

  // สถานะล่าสุดของรถที่จอง — ดูจากลิสต์รถจอดก่อน ไม่เจอค่อยหา open-job ตามทะเบียน
  const truckByNum = new Map(trucks.map((t) => [normTruckNum(t.trucknum), t]))
  for (const d of drivers) {
    if (!d.truckNum) continue
    const t = truckByNum.get(normTruckNum(d.truckNum))
    if (t) {
      d.truckStatus = {
        step: t.job?.step ?? "ไม่มีงานซ่อมเปิด",
        expectedDone: t.job?.expectedDone ?? "",
        parked: true, parkedDays: t.parkedDays,
      }
      continue
    }
    const j = d.plate ? jobByPlate.get(d.plate) : undefined
    const oj = j?.open_maintenance_job
    d.truckStatus = oj
      ? {
          step: oj.current_step?.step?.label_th ?? "มีงานซ่อมเปิด",
          expectedDone: String(oj.expected_done_at ?? oj.open_expectation?.expected_at ?? "").slice(0, 10),
          parked: false, parkedDays: 0,
        }
      : { step: "พร้อมใช้/วิ่งงาน", expectedDone: "", parked: false, parkedDays: 0 }
  }
  return { drivers, trucks, fetchedAt: new Date().toISOString() }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- เขียนกลับชีต ---------- */

/** กันแถวเลื่อน (มีคน insert/sort ชีต): เช็คว่าแถวยังเป็นคนเดิม ไม่ใช่ก็ค้นหาใหม่จากรหัส+ชื่อ */
async function resolveRow(row: number, code: string, name: string): Promise<number> {
  const cur = await readRange(SHEET_ID, `'${DRIVER_TAB}'!A${row}:${LAST_COL}${row}`)
  const r = cur[0] ?? []
  if ((r[COL.code] ?? "").trim() === code.trim() && (r[COL.name] ?? "").trim() === name.trim()) return row
  const all = await readRange(SHEET_ID, `'${DRIVER_TAB}'!A${DATA_START_ROW}:${LAST_COL}`)
  const idx = all.findIndex((x) =>
    (x[COL.name] ?? "").trim() === name.trim() &&
    (code.trim() === "" || (x[COL.code] ?? "").trim() === code.trim()))
  if (idx < 0) throw new Error(`ไม่พบแถวของ ${name} (${code}) ในชีต — ชีตอาจถูกแก้ไข`)
  return DATA_START_ROW + idx
}

async function auditLog(entry: Record<string, unknown>): Promise<void> {
  const client = await clientPromise
  await client.db(process.env.MONGO_DB ?? "master_data").collection("driver_handover_log")
    .insertOne({ ...entry, at: new Date() })
}

const thDate = (d: Date) =>
  `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`

/** ยืนยันรถให้ พจส. — เขียนเบอร์รถ+ทะเบียนลงชีต + log */
export async function assignTruck(input: {
  row: number; code: string; name: string
  trucknum: string; plate: string; by: string; note?: string
}): Promise<{ row: number }> {
  const row = await resolveRow(input.row, input.code, input.name)
  await batchUpdateValues(SHEET_ID, [
    { range: `'${DRIVER_TAB}'!${colLetter(COL.truckNum)}${row}`, values: [[input.trucknum]] },
    { range: `'${DRIVER_TAB}'!${colLetter(COL.plate)}${row}`, values: [[input.plate]] },
  ])
  await auditLog({
    action: "assign_truck", driverCode: input.code, driverName: input.name,
    trucknum: input.trucknum, plate: input.plate, by: input.by, note: input.note ?? "",
  })
  return { row }
}

/** อัปเดตสถานะ พจส. — เขียนสถานะ + วันที่ที่เกี่ยวข้องลงชีต + log */
export async function updateDriverStatus(input: {
  row: number; code: string; name: string
  fromStatus: string; toStatus: string; by: string; note?: string
}): Promise<{ row: number }> {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(input.toStatus))
    throw new Error(`สถานะ "${input.toStatus}" ไม่อยู่ในรายการที่แก้ได้`)
  const row = await resolveRow(input.row, input.code, input.name)
  const today = thDate(todayTh())
  const data: { range: string; values: string[][] }[] = [
    { range: `'${DRIVER_TAB}'!${colLetter(COL.status)}${row}`, values: [[input.toStatus]] },
  ]
  if (["ลาออก", "ปลด", "ยกเลิกฝึกงาน", "สละสิทธิ์"].includes(input.toStatus))
    data.push({ range: `'${DRIVER_TAB}'!${colLetter(COL.leaveDate)}${row}`, values: [[today]] })
  if (input.toStatus === "รับรถแล้ว")
    data.push({ range: `'${DRIVER_TAB}'!${colLetter(COL.receivedDate)}${row}`, values: [[today]] })
  await batchUpdateValues(SHEET_ID, data)
  await auditLog({
    action: "update_status", driverCode: input.code, driverName: input.name,
    fromStatus: input.fromStatus, toStatus: input.toStatus, by: input.by, note: input.note ?? "",
  })
  return { row }
}
