// สรุปยางรายคันของ GET /api/tire-fleet — แยกเป็น 2 ชั้นเพื่อแคชได้โดยผลไม่เพี้ยนตามเวลา
//
//   buildFleetBase  = ส่วนที่ไม่ขึ้นกับเวลา (นับเส้น / หัว-หาง / ระดับรอบเปลี่ยน / คำขอค้าง) → เก็บแคช
//                     ก้อนเล็ก (ไม่เก็บ _id / ชื่อตำแหน่งยาง) และ JSON-safe (Runtime Cache เก็บเป็น JSON)
//   finishFleet     = คิดสดทุก request: อายุยาง (tireAge เทียบวันนี้) + เส้นที่พักแจ้งเตือนหมดหรือยัง
//                     + join vehicle_master (ดึงสดทุกครั้ง — มีคนเขียนนอกระบบยาง)
//
// ผลต้องตรงกับโค้ดเดิมทุกตัวอักษร — ดู scripts/check-tire-fleet-summary.ts (เทียบกับสำเนาโค้ดเดิม)
import { tireAge, isTrailerPosition } from "@/lib/tire"

type DueLevel = "over" | "due" | "warn" | "ok" | "unknown"
type DueCounts = Record<DueLevel, number> & { maxPct: number }

export type FleetBase = {
  // รถตามลำดับที่เจอครั้งแรก (ลำดับนี้มีผลกับ sort ที่เสมอกัน) · changeIn = ms ต่อเส้น, null = ไม่มี/อ่านไม่ได้
  groups: { branch: string; plate: string; head: number; trailer: number; changeIn: (number | null)[] }[]
  // branch|plate → นับเส้นที่ไม่เคยพัก + เส้นที่มีวันพัก [หมดพัก ms, ระดับ, %] ไว้ตัดสินตอน request
  due: [string, DueCounts, [number, DueLevel, number | null][]][]
  // branch|plate → จำนวนคำขอที่ค้าง
  requests: [string, number][]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/** key แคช — ทุก query param ที่เปลี่ยนผล */
export function tireFleetKey(branch: string, q: string): string {
  return `tire-fleet:${JSON.stringify([branch, q])}`
}

const DUE_LEVELS = ["over", "due", "warn", "ok"]

export function buildFleetBase(tires: Row[], activeReqs: Row[], dueRows: Row[]): FleetBase {
  const groups = new Map<string, FleetBase["groups"][number]>()
  for (const t of tires) {
    const key = `${t.branch}|${t.vehicle}`
    let g = groups.get(key)
    if (!g) { g = { branch: t.branch, plate: t.vehicle, head: 0, trailer: 0, changeIn: [] }; groups.set(key, g) }
    if (isTrailerPosition(String(t.tirePosition ?? ""))) g.trailer++
    else g.head++
    // tireAge คืน null เมื่อไม่มีวันที่ หรือวันที่อ่านไม่ได้ → เก็บเป็น null ทั้งสองแบบ
    const ms = t.changeIn ? new Date(t.changeIn).getTime() : NaN
    g.changeIn.push(Number.isNaN(ms) ? null : ms)
  }

  const due = new Map<string, FleetBase["due"][number]>()
  for (const r of dueRows) {
    const key = `${r.branch}|${r.plate}`
    let d = due.get(key)
    if (!d) { d = [key, { over: 0, due: 0, warn: 0, ok: 0, unknown: 0, maxPct: 0 }, []]; due.set(key, d) }
    const raw = String(r.level ?? "unknown")
    const level = (DUE_LEVELS.includes(raw) ? raw : "unknown") as DueLevel
    const pct = Number(r.usedPct)
    const until = r.snoozedUntil ? new Date(r.snoozedUntil).getTime() : NaN
    if (Number.isNaN(until)) {
      // ไม่มีวันพัก (หรืออ่านไม่ได้) = ไม่มีวันถูกนับเป็นพัก → รวมไว้ล่วงหน้าได้เลย
      d[1][level]++
      if (pct > d[1].maxPct) d[1].maxPct = pct
    } else {
      d[2].push([until, level, Number.isNaN(pct) ? null : pct])
    }
  }

  const requests = new Map<string, number>()
  for (const r of activeReqs) {
    const key = `${r.branch}|${r.plate}`
    requests.set(key, (requests.get(key) ?? 0) + 1)
  }

  return { groups: [...groups.values()], due: [...due.values()], requests: [...requests] }
}

/** ทะเบียนที่ต้องไปดึง vehicle_master (ลำดับเดียวกับโค้ดเดิม = คิวรีเดิมทุกตัวอักษร) */
export function fleetPlates(base: FleetBase): string[] {
  return [...new Set(base.groups.map((g) => g.plate))]
}

// ห้ามแก้ object ใน base — ก้อนเดียวกันถูกใช้ซ้ำหลาย request
export function finishFleet(base: FleetBase, masters: Row[]) {
  // เส้นที่พักแจ้งเตือนไว้และยังไม่ครบกำหนด นับเป็นปกติ (ไม่เอา % มาคิดสูงสุดของคัน)
  const nowMs = Date.now()
  const dueByPlate = new Map<string, DueCounts>()
  for (const [key, c, snoozes] of base.due) {
    const d: DueCounts = { over: c.over, due: c.due, warn: c.warn, ok: c.ok, unknown: c.unknown, maxPct: c.maxPct }
    for (const [until, level, pct] of snoozes) {
      if (until > nowMs) { d.ok++; continue }
      d[level]++
      if (pct !== null && pct > d.maxPct) d.maxPct = pct
    }
    dueByPlate.set(key, d)
  }
  const reqCount = new Map(base.requests)
  const masterMap = new Map(masters.map((m) => [m.plate, m]))

  const items = base.groups.map((g) => {
    // อายุยางคิดสดเทียบวันนี้ — เส้นเก่าสุดของคันเป็นตัวโชว์
    const age = { danger: 0, warn: 0, normal: 0, unknown: 0 }
    let oldestDays = -1
    let oldestAgeText: string | null = null
    for (const ms of g.changeIn) {
      const a = ms === null ? null : tireAge(new Date(ms))
      if (!a || ms === null) { age.unknown++; continue }
      age[a.level]++
      const days = (Date.now() - ms) / 86400000
      if (days > oldestDays) { oldestDays = days; oldestAgeText = a.text }
    }

    const m = masterMap.get(g.plate)
    // ทะเบียนถือเป็น "หาง" เมื่อยางทุกเส้นเป็นตำแหน่งหาง หรือประเภทรถระบุว่าเป็นหาง
    const isTrailerPlate =
      (g.trailer > 0 && g.head === 0) ||
      String(m?.vehicleType ?? "").includes("หาง")
    const d = dueByPlate.get(`${g.branch}|${g.plate}`)
    return {
      branch:         g.branch,
      plate:          g.plate,
      unit:           isTrailerPlate ? "trailer" as const : "head" as const,
      vehicleType:    m?.vehicleType ?? "",
      fleet:          m?.fleet ?? "",
      plant:          m?.plant ?? "",
      tireCount:      g.changeIn.length,
      danger:         age.danger,
      warn:           age.warn,
      normal:         age.normal,
      unknown:        age.unknown,
      oldestAgeText,
      // สรุปรอบเปลี่ยนรายคัน — null = ยังไม่มีแถวใน tire_distance (ทะเบียนที่ตัดออก / cron ยังไม่รัน)
      due: d ? {
        over: d.over, due: d.due, warn: d.warn, ok: d.ok, unknown: d.unknown,
        maxPct: d.maxPct,
      } : null,
      activeRequests: reqCount.get(`${g.branch}|${g.plate}`) ?? 0,
    }
  })

  // รถที่มีคำขอค้าง / ยางเกินรอบ ขึ้นก่อน — เรียงด้วยเกณฑ์รอบเปลี่ยนก่อน แล้วค่อยตกไปที่อายุยาง
  items.sort((a, b) =>
    b.activeRequests - a.activeRequests ||
    (b.due?.over ?? 0) - (a.due?.over ?? 0) ||
    (b.due?.due  ?? 0) - (a.due?.due  ?? 0) ||
    (b.due?.warn ?? 0) - (a.due?.warn ?? 0) ||
    b.danger - a.danger ||
    b.warn - a.warn ||
    a.plate.localeCompare(b.plate, "th")
  )

  return { items, total: items.length }
}
