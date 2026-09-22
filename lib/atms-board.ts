// ดึงข้อมูลจากระบบภายนอกเพื่อเทียบกับงานอู่นอกใน WMS
// - open-jobs (mongodbapi):   งานซ่อมเปิดใน ATMS + ขั้นตอนปัจจุบัน/อู่/PR
// - fleet/current (fastapi):  รถที่จอดอยู่จริงตอนนี้ + จำนวนวันจอด
// server-only — API key อยู่ใน env ห้าม import จาก client component

import { bkkYear } from "@/lib/bkk-time"

const MONGODBAPI_URL = process.env.ATMS_MONGODBAPI_URL ?? "https://mongodbapi-548129382487.asia-southeast1.run.app/v1"
const FLEET_API_URL  = process.env.ATMS_FLEET_API_URL  ?? "https://fastapinextjs-548129382487.asia-southeast3.run.app"
const API_KEY        = process.env.ATMS_API_KEY ?? ""

export type AtmsOpenJob = {
  plate: string
  mrCode: string
  mrId: number
  step: string          // ขั้นตอนปัจจุบันใน ATMS เช่น รถซ่อม / รออะไหล่ / รถซ่อมเสร็จสิ้น
  stepAt: string        // YYYY-MM-DD ของ event ล่าสุด
  vendor: string        // ชื่ออู่
  openedAt: string      // YYYY-MM-DD วันเปิดงาน
  severity: string      // light | medium | heavy
  prAmount: number
  expectedDone: string  // YYYY-MM-DD วันคาดว่าเสร็จ (จาก ATMS)
  prCodes: string[]     // PR ทั้งหมดของงานนี้ (จาก purchase_links)
  poCodes: string[]     // PO ทั้งหมด (จาก purchase_orders ใต้แต่ละ PR)
}

export type ParkedTruck = {
  plate: string
  trucknum: string      // เบอร์รถ เช่น ME236
  days: number          // จอดมากี่วัน
  since: string         // YYYY-MM-DD เริ่มจอด
  statusName: string    // รถซ่อม | รถจอดอุบัติเหตุ
  subStatus: string     // BA / B / อ ฯลฯ
  plant: string         // ตำแหน่งซ่อม/แพล้นท์
}

/**
 * ขั้นตอน ATMS ที่ไม่นับเป็น "ภาระอู่" แล้ว
 * - รถซ่อมเสร็จสิ้น = จบงาน
 * - รถรอขาย       = ถอดออกจากฟลีท ไม่ใช่งานที่อู่กำลังทำอยู่
 */
export const ATMS_SETTLED_STEPS = ["รถซ่อมเสร็จสิ้น", "รถรอขาย"]
export const isAtmsSettled = (step: string) => ATMS_SETTLED_STEPS.includes(step)

/**
 * ขั้นที่ไม่ใช่ "งานซ่อมอู่นอก" ที่ทีมนี้ดูแล — ไม่ต้องนับในการเทียบ และไม่ต้องทวงให้เปิดใบใน WMS
 * - แย็กโม่ = งานยกโม่ แยกทีม/แยกคิว ไม่ได้อยู่ในสายงานซ่อมอู่นอก (ผู้ใช้สั่ง 21/09/2569)
 */
export const ATMS_SKIP_STEPS = ["แย็กโม่"]
export const isAtmsSkipped = (step: string) => ATMS_SKIP_STEPS.includes(step)

/** ใบงานอู่นอกที่ปิดแล้วใน WMS (รถเสร็จ / เคลมอู่ / ชะลองานซ่อม) ของคันที่ Mena-Next ยังขึ้นว่าจอดซ่อม */
export type ClosedWmsJob = {
  id: string
  mrNo: string
  status: string
  closedAt: string   // YYYY-MM-DD วันที่เปลี่ยนเป็นสถานะปิดงาน (statusSince)
  closedBy: string
}

/** ปิดงานใน WMS ไม่เกินกี่วัน แม้ MR ไม่ตรง ก็นับว่าฝั่งจัดซื้อจบแล้ว รอ Mena-Next อัปเดต */
export const RECENT_CLOSE_DAYS = 2

export type ClosedMatch = ClosedWmsJob & {
  /** mr = MR ตรง · since = ใบไม่มี MR ปิดหลังเริ่มจอด · recent = ปิดไม่เกิน RECENT_CLOSE_DAYS วัน (MR อาจไม่ตรง) */
  matchedBy: "mr" | "since" | "recent"
}

// หลาย MR ในช่องเดียว คั่นด้วย , / ; หรือเว้นวรรค — แยกทั้งสองแบบเพราะบางใบพิมพ์ "KKMR 2609..." มีช่องว่างในเลขเดียว
export const mrListOf = (mrNo: string) => [
  ...mrNo.split(/[,/;\n]+/),
  ...mrNo.split(/[\s,/;]+/),
].map(normKey).filter(Boolean)

/** ใบที่ปิดล่าสุด (วันเท่ากัน → ตัวแรก ผู้เรียกเรียงใหม่→เก่ามาแล้ว) */
export const latestClosed = (xs: ClosedWmsJob[]): ClosedWmsJob | null =>
  xs.length ? xs.reduce((a, b) => (b.closedAt > a.closedAt ? b : a)) : null

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/**
 * รถจอดซ่อมที่ไม่มีใบเปิดใน WMS — มีใบที่ "ปิดไปแล้ว" ที่ถือว่าจบงานฝั่งจัดซื้อหรือยัง
 * (ผู้ใช้สั่ง 22/09/2569: NL22 จัดซื้อปิดงานแล้ว แต่ Mena-Next ยังไม่อัปเดต → ขึ้นว่าขาดในระบบ)
 * 1. MR ตรงกับงานใน Mena-Next = รอบเดียวกันแน่นอน
 * 2. ใบไม่มี MR → นับเฉพาะที่ปิดตั้งแต่วันเริ่มจอดรอบนี้ (ปิดก่อนหน้านั้นคือรอบซ่อมเก่า)
 * 3. ปิดไม่เกิน RECENT_CLOSE_DAYS วัน (นับจาก today) → จัดซื้อจบแล้ว แม้ MR ไม่ตรง
 *    (ผู้ใช้สั่ง 22/09/2569 เคส TH1380) — UI ต้องเตือน + ให้สร้างใบได้ เผื่อเป็นรถรอบใหม่จริง
 * ไม่เข้าข้อไหน = ยังขาด · closed = ใบที่ปิดแล้วของคันนั้น (จับคู่ทะเบียน/เบอร์รถมาแล้ว) · หลายใบ → ใบที่ปิดล่าสุด
 */
export function findClosedMatch(mrCode: string, parkedSince: string, closed: ClosedWmsJob[], today = ""): ClosedMatch | null {
  const mr = normKey(mrCode)
  const sameMr = latestClosed(mr ? closed.filter((c) => mrListOf(c.mrNo).includes(mr)) : [])
  if (sameMr) return { ...sameMr, matchedBy: "mr" }
  const noMr = latestClosed(closed.filter((c) =>
    !mrListOf(c.mrNo).length && !!parkedSince && !!c.closedAt && c.closedAt >= parkedSince))
  if (noMr) return { ...noMr, matchedBy: "since" }
  const recent = latestClosed(today ? closed.filter((c) =>
    !!c.closedAt && c.closedAt <= today && dayDiff(c.closedAt, today) <= RECENT_CLOSE_DAYS) : [])
  if (recent) return { ...recent, matchedBy: "recent" }
  return null
}

export type AtmsBoardData = {
  jobs: AtmsOpenJob[]       // งานอู่นอกเปิดทั้งหมดใน ATMS
  parked: ParkedTruck[]     // รถจอดจริงตอนนี้
  fetchedAt: string
}

// เทียบทะเบียน/เบอร์รถแบบไม่สนช่องว่างและจุด
export const normKey = (s: string | null | undefined) =>
  (s ?? "").toString().replace(/[\s.]/g, "").trim().toUpperCase()

async function apiGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "X-API-Key": API_KEY },
    // ให้ Next cache ฝั่ง fetch 5 นาที — ข้อมูล ATMS เองก็ cache 5 นาทีอยู่แล้ว
    next: { revalidate: 300 },
  })
  if (!res.ok) throw new Error(`ATMS API ${res.status}: ${url.split("?")[0]}`)
  return res.json()
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchAtmsBoard(): Promise<AtmsBoardData> {
  const [openJobsRaw, fleetRaw] = await Promise.all([
    apiGet(`${MONGODBAPI_URL}/repair-board/open-jobs`) as Promise<any>,
    apiGet(`${FLEET_API_URL}/fleet/current?status_id=2&status_id=4&status_id=5&minimal=true&branch_id=2&branch_id=5`) as Promise<any>,
  ])

  const jobs: AtmsOpenJob[] = (openJobsRaw.items ?? [])
    .filter((i: any) => i.open_maintenance_job?.repair_mode_label === "อู่นอก")
    .map((i: any) => {
      const j = i.open_maintenance_job
      const links: any[] = j.purchase_links ?? []
      return {
        prCodes: links.map((l) => l.pr_code).filter(Boolean),
        poCodes: links.flatMap((l) => l.purchase_orders ?? []).map((p: any) => p.po_code).filter(Boolean),
        plate: i.plate ?? "",
        mrCode: i.mr_code ?? "",
        mrId: Number(i.mr_id) || 0,
        step: j.current_step?.step?.label_th ?? "",
        stepAt: (j.current_step?.event_at ?? "").slice(0, 10),
        vendor: j.vendor_name ?? "",
        openedAt: (j.opened_at ?? "").slice(0, 10),
        severity: j.severity ?? "",
        prAmount: Number(j.pr_amount_total) || 0,
        expectedDone: (j.expected_done_at ?? "").slice(0, 10),
      }
    })

  const parked: ParkedTruck[] = []
  for (const st of fleetRaw.data ?? [])
    for (const b of st.branches ?? [])
      for (const c of b.customers ?? [])
        for (const vt of c.vehicle_types ?? [])
          for (const ot of vt.owner_types ?? [])
            for (const t of ot.trucks ?? [])
              parked.push({
                plate: t.truckplate ?? "",
                trucknum: t.trucknum ?? "",
                days: Number(t.duration_days) || 0,
                since: (t.status_since ?? "").slice(0, 10),
                statusName: st.status_name ?? "",
                subStatus: t.sub_status_name ?? "",
                plant: t.plant_name ?? "",
              })

  return { jobs, parked, fetchedAt: new Date().toISOString() }
}

// Timeline รายคันจาก maintenance-requests (ใช้ใน modal)
export async function fetchAtmsTimeline(plate: string, mrId?: string): Promise<unknown> {
  const year = bkkYear()
  const p = new URLSearchParams({ year: String(year), plate })
  if (mrId) p.set("mr_id", mrId)
  return apiGet(`${MONGODBAPI_URL}/maintenance-requests?${p.toString()}`)
}
