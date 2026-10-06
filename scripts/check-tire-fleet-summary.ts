// scripts/check-tire-fleet-summary.ts — รัน: npx tsx scripts/check-tire-fleet-summary.ts
// GET /api/tire-fleet แยกเป็น 2 ชั้น: ส่วนที่ไม่ขึ้นกับเวลา (แคชได้) + ส่วนที่คิดสดทุก request (อายุยาง / พักแจ้งเตือน)
// ผลต้องตรงกับโค้ดเดิมทุกตัวอักษร ทั้งตอนแคชเก็บเป็น object ตรง ๆ และตอนผ่าน JSON (Runtime Cache)
import assert from "node:assert/strict"
import { tireAge, isTrailerPosition } from "../lib/tire"
import { buildFleetBase, fleetPlates, finishFleet, tireFleetKey } from "../lib/tire-fleet-summary"

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── สำเนาโค้ดเดิมจาก app/api/tire-fleet/route.ts (ก่อนแคช) ใช้เป็นตัวเทียบ ──
function legacyPlates(tires: any[]) {
  const groups = new Map<string, { plate: string }>()
  for (const t of tires) {
    const key = `${t.branch}|${t.vehicle}`
    if (!groups.has(key)) groups.set(key, { plate: t.vehicle })
  }
  return [...new Set([...groups.values()].map((g) => g.plate))]
}
function legacy(tires: any[], activeReqs: any[], dueRows: any[], masters: any[]) {
  type DueCount = "over" | "due" | "warn" | "ok" | "unknown"
  type DueGroup = Record<DueCount, number> & { maxPct: number }
  const dueByPlate = new Map<string, DueGroup>()
  const nowMs = Date.now()
  for (const r of dueRows) {
    const key = `${r.branch}|${r.plate}`
    let g = dueByPlate.get(key)
    if (!g) { g = { over: 0, due: 0, warn: 0, ok: 0, unknown: 0, maxPct: 0 }; dueByPlate.set(key, g) }
    const snoozed = !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > nowMs
    const raw = snoozed ? "ok" : String(r.level ?? "unknown")
    const level = (["over", "due", "warn", "ok"].includes(raw) ? raw : "unknown") as DueCount
    g[level]++
    if (!snoozed && Number(r.usedPct) > g.maxPct) g.maxPct = Number(r.usedPct)
  }
  type Group = {
    branch: string; plate: string; tireCount: number
    headTires: number; trailerTires: number
    danger: number; warn: number; normal: number; unknown: number
    oldestDays: number; oldestAgeText: string | null
  }
  const groups = new Map<string, Group>()
  for (const t of tires) {
    const key = `${t.branch}|${t.vehicle}`
    let g = groups.get(key)
    if (!g) {
      g = { branch: t.branch, plate: t.vehicle, tireCount: 0, headTires: 0, trailerTires: 0, danger: 0, warn: 0, normal: 0, unknown: 0, oldestDays: -1, oldestAgeText: null }
      groups.set(key, g)
    }
    g.tireCount++
    if (isTrailerPosition(String(t.tirePosition ?? ""))) g.trailerTires++
    else g.headTires++
    const age = tireAge(t.changeIn ?? null)
    if (!age) { g.unknown++; continue }
    g[age.level]++
    const days = t.changeIn ? (Date.now() - new Date(t.changeIn).getTime()) / 86400000 : -1
    if (days > g.oldestDays) { g.oldestDays = days; g.oldestAgeText = age.text }
  }
  const reqCount = new Map<string, number>()
  for (const r of activeReqs) {
    const key = `${r.branch}|${r.plate}`
    reqCount.set(key, (reqCount.get(key) ?? 0) + 1)
  }
  const masterMap = new Map(masters.map((m) => [m.plate, m]))
  const items = [...groups.values()].map((g) => {
    const m = masterMap.get(g.plate)
    const isTrailerPlate =
      (g.trailerTires > 0 && g.headTires === 0) ||
      String(m?.vehicleType ?? "").includes("หาง")
    const d = dueByPlate.get(`${g.branch}|${g.plate}`)
    return {
      branch:         g.branch,
      plate:          g.plate,
      unit:           isTrailerPlate ? "trailer" as const : "head" as const,
      vehicleType:    m?.vehicleType ?? "",
      fleet:          m?.fleet ?? "",
      plant:          m?.plant ?? "",
      tireCount:      g.tireCount,
      danger:         g.danger,
      warn:           g.warn,
      normal:         g.normal,
      unknown:        g.unknown,
      oldestAgeText:  g.oldestAgeText,
      due: d ? {
        over: d.over, due: d.due, warn: d.warn, ok: d.ok, unknown: d.unknown,
        maxPct: d.maxPct,
      } : null,
      activeRequests: reqCount.get(`${g.branch}|${g.plate}`) ?? 0,
    }
  })
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

// ── ข้อมูลสุ่ม (seed คงที่) ครอบเคสแปลก ๆ ที่เจอได้ในข้อมูลจริง ──
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
const NOW = Date.UTC(2026, 9, 6, 5, 30, 0)
const DAY = 86_400_000

const branches = ["latkrabang", "saraburi"]
const plates = ["สบ.71-3569", "สบ.70-5556", "71-8636", "สบ.72-8062", "T-0080", "ขก.1", "สบ.71-0323", "aa", "AB"]
const positions = ["F1ล้อหน้าข้างซ้าย", "RA1 ล้อหลัง", "RB 6 หางคู่ 2 ซ้ายเส้นใน", "หางพ่วง", "", "SP อะไหล่"]
const changeIns = (): unknown => pick([
  new Date(NOW - 2 * DAY), new Date(NOW - 10 * DAY), new Date(NOW - 100 * DAY), new Date(NOW - 400 * DAY),
  new Date(NOW - 800 * DAY), new Date(NOW - 365.25 * DAY), new Date(NOW - 730.5 * DAY + 1), new Date(NOW + 5 * DAY),
  new Date(NOW - Math.floor(rnd() * 1500) * DAY - Math.floor(rnd() * DAY)),
  null, undefined, "", "abc", new Date(0), new Date(NOW - 50 * DAY).toISOString(), "2025-01-15",
])
const levels = ["over", "due", "warn", "ok", "unknown", "weird", undefined, null]
const pcts = (): unknown => pick([0, 15, 79, 80, 99, 100, 135, null, undefined, "88", "x", -5])
const snoozes = (): unknown => pick([
  null, undefined, null, null, new Date(NOW + 3 * DAY), new Date(NOW - 3 * DAY), new Date(NOW + 1),
  new Date(NOW), new Date(NOW + 1000).toISOString(), "abc", "",
])

function dataset(nTires: number, nDue: number, nReq: number) {
  const tires = Array.from({ length: nTires }, () => ({
    branch: pick(branches), vehicle: pick(plates), tirePosition: pick(positions), changeIn: changeIns(),
  }))
  const dueRows = Array.from({ length: nDue }, () => ({
    branch: pick(branches), plate: pick(plates), level: pick(levels), usedPct: pcts(), snoozedUntil: snoozes(),
  }))
  const activeReqs = Array.from({ length: nReq }, () => ({ branch: pick(branches), plate: pick(plates), status: "pending" }))
  const masters = plates.filter(() => rnd() < 0.7).flatMap((p) => {
    const m = { plate: p, vehicleType: pick(["หัวลาก", "หางพ่วง", "โม่", "", undefined]), fleet: pick(["F1", "", undefined]), plant: pick(["P1", undefined]) }
    return rnd() < 0.15 ? [m, { ...m, vehicleType: "หาง" }] : [m]
  })
  return { tires, dueRows, activeReqs, masters }
}

const realNow = Date.now
Date.now = () => NOW
try {
  // 1. key
  assert.ok(tireFleetKey("", "").startsWith("tire-fleet:"))
  assert.equal(tireFleetKey("latkrabang", ""), tireFleetKey("latkrabang", ""))
  const fk = new Set([tireFleetKey("", ""), tireFleetKey("latkrabang", ""), tireFleetKey("saraburi", ""), tireFleetKey("", "สบ"), tireFleetKey("latkrabang", "สบ")])
  assert.equal(fk.size, 5, "branch / q ต่างกันต้องได้ key ต่างกัน")
  assert.notEqual(tireFleetKey("a|b", "c"), tireFleetKey("a", "b|c"))

  // 2. ผลตรงโค้ดเดิม — ทั้ง object ตรง ๆ และหลังผ่าน JSON
  for (let i = 0; i < 300; i++) {
    const { tires, dueRows, activeReqs, masters } = dataset(Math.floor(rnd() * 120), Math.floor(rnd() * 120), Math.floor(rnd() * 15))
    const want = JSON.stringify(legacy(tires, activeReqs, dueRows, masters))
    const base = buildFleetBase(tires, activeReqs, dueRows)
    const viaJson = JSON.parse(JSON.stringify(base))
    assert.deepEqual(fleetPlates(base), legacyPlates(tires), `plates ที่ใช้ค้น vehicle_master ต้องเหมือนเดิม (รอบ ${i})`)
    assert.deepEqual(fleetPlates(viaJson), legacyPlates(tires))
    assert.equal(JSON.stringify(finishFleet(base, masters)), want, `ผลต่างจากเดิม (object, รอบ ${i})`)
    assert.equal(JSON.stringify(finishFleet(viaJson, masters)), want, `ผลต่างจากเดิม (ผ่าน JSON, รอบ ${i})`)
    // คิดซ้ำจากก้อนเดิมต้องได้ผลเดิม — ห้ามแก้ข้อมูลในแคช
    assert.equal(JSON.stringify(finishFleet(base, masters)), want, `ก้อนแคชถูกแก้ระหว่างคิด (รอบ ${i})`)
  }

  // 3. เวลาเดินไป (ก้อนแคชเดิม) → ผลเปลี่ยนตามเวลาเหมือนโค้ดเดิม: พักแจ้งเตือนหมด / อายุยางข้ามเกณฑ์
  {
    const tires = [{ branch: "latkrabang", vehicle: "สบ.1", tirePosition: "F1", changeIn: new Date(NOW - 365.25 * DAY + 60_000) }]
    const dueRows = [{ branch: "latkrabang", plate: "สบ.1", level: "over", usedPct: 120, snoozedUntil: new Date(NOW + 30_000) }]
    const base = JSON.parse(JSON.stringify(buildFleetBase(tires, [], dueRows)))
    for (const at of [NOW, NOW + 30_000, NOW + 61_000, NOW + 40 * DAY]) {
      Date.now = () => at
      assert.equal(JSON.stringify(finishFleet(base, [])), JSON.stringify(legacy(tires, [], dueRows, [])), `เวลา +${at - NOW}ms`)
    }
    Date.now = () => NOW
  }

  // 4. ก้อนแคชไม่ใหญ่เกินจำเป็น — ไม่เก็บ _id / ตำแหน่งยาง (ภาษาไทยยาว)
  {
    const tires = [{ _id: "x".repeat(24), branch: "saraburi", vehicle: "สบ.2", tirePosition: "RB 6 หางคู่ 2 ซ้ายเส้นใน", changeIn: new Date(NOW) }]
    const s = JSON.stringify(buildFleetBase(tires, [], []))
    assert.ok(!s.includes("หางคู่") && !s.includes("xxxx"), "ไม่ควรเก็บตำแหน่งยาง / _id ในแคช")
  }
} finally {
  Date.now = realNow
}

console.log("check-tire-fleet-summary: ok")
