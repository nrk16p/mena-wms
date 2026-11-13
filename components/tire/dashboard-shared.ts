// ชนิดข้อมูล + Slicer ของ Dashboard ยาง — ใช้ร่วมกันระหว่างตัวหน้า กราฟแนวโน้ม และตารางรายเส้น
// (แยกไฟล์ไว้เพื่อให้ทั้ง 3 ส่วนกรองด้วยกติกาเดียวกัน ไม่ต้องนิยามซ้ำ)

import { zoneOf } from "@/components/tire/due-dashboard"
import { branchLabel } from "@/components/tire/shared"
import { DUE_LABEL, SOURCE_LABEL, type DistanceSource, type DueLevel } from "@/lib/tire-due"

// ── ข้อมูลจาก /api/tire-dashboard (ดูรูปแบบที่หัวไฟล์ route) ─────────────────

export type Follow = "a" | "n" | "p" | "w" | "d"

export type Payload = {
  vehicles:  [string, string, string, string, string, string, number][]
  products:  string[]
  positions: string[]
  people:    string[]
  tires: [
    number, number, "h" | "t", DueLevel, number | null, number, number, DistanceSource, string, number, string, number,
    string, Follow, number, string,
  ][]
  freshness?: { atms: { branch: string; syncedAt: string | null }[]; computedAt: string | null; dataThrough: string | null }
}

export type Row = {
  id: string
  branch: string; plate: string; fleetNo: string; vtype: string; fleet: string; plant: string; zone: string
  product: string; unit: "head" | "trailer"; level: DueLevel; usedPct: number | null
  kmUsed: number; spec: number; source: DistanceSource; changeIn: string; position: string; serial: string
  snoozed: boolean; partial: boolean; vehicleReqs: number
  follow: Follow; acceptedBy: string; acceptedAt: string
}

export const NONE = {
  fleet: "ไม่ระบุฟลีท", vtype: "ไม่ระบุประเภท", plant: "ไม่ระบุแพล้นท์", product: "ไม่ระบุรุ่น",
}

/** รับเรื่อง/ยกเลิกที่เพิ่งกดบนหน้านี้ — ทับค่าจาก API จนกว่าจะโหลดใหม่ (null = ยกเลิกรับเรื่อง) */
export type AcceptOverride = Map<string, { by: string; at: string } | null>

export function buildRows(data: Payload | null, overrides: AcceptOverride): Row[] {
  if (!data) return []
  return data.tires.map((t) => {
    const v = data.vehicles[t[0]]
    const plant = v[5] || NONE.plant
    const id = t[12]
    const o = overrides.get(id)
    let follow = t[13]
    let acceptedBy = t[14] >= 0 ? data.people[t[14]] ?? "" : ""
    let acceptedAt = t[15]
    if (o !== undefined) {
      acceptedBy = o?.by ?? ""
      acceptedAt = o?.at ?? ""
      // มีคำขอแล้ว = งานติดตามดูจากคำขอ การรับเรื่องไม่เปลี่ยนขั้น
      if (follow === "a" || follow === "n") follow = o ? "a" : "n"
    }
    return {
      id,
      branch: v[0], plate: v[1], fleetNo: v[2], vtype: v[3] || NONE.vtype, fleet: v[4] || NONE.fleet,
      plant, zone: zoneOf(plant), vehicleReqs: v[6],
      product: data.products[t[1]] || NONE.product,
      unit: t[2] === "t" ? "trailer" : "head", level: t[3], usedPct: t[4], kmUsed: t[5], spec: t[6],
      source: t[7], changeIn: t[8], position: data.positions[t[9]] ?? "", serial: t[10],
      snoozed: (t[11] & 1) > 0, partial: (t[11] & 4) > 0,
      follow, acceptedBy, acceptedAt,
    }
  })
}

// ── สี/ป้าย ────────────────────────────────────────────────────────────────

export const LEVEL_ORDER: DueLevel[] = ["over", "due", "warn", "ok", "unknown"]
export const LEVEL_DOT: Record<DueLevel, string> = {
  over: "bg-red-600", due: "bg-orange-500", warn: "bg-amber-400", ok: "bg-[#1B8C4B]", unknown: "bg-gray-400",
}

// งานติดตาม — ลำดับตามที่ผู้ใช้ไล่งาน · สีขั้นคำขอชุดเดียวกับหน้า คำขอ/อนุมัติ (เหลือง/ม่วง/เขียว)
export const FOLLOW_ORDER: Follow[] = ["a", "n", "p", "w", "d"]
export const FOLLOW_LABEL: Record<Follow, string> = {
  a: "รับเรื่องแล้ว", n: "ยังไม่รับเรื่อง", p: "รออนุมัติ", w: "รอเปลี่ยน", d: "เปลี่ยนแล้ว",
}
export const FOLLOW_DOT: Record<Follow, string> = {
  a: "bg-blue-500", n: "bg-gray-300 dark:bg-gray-600", p: "bg-amber-500", w: "bg-purple-500", d: "bg-[#1B8C4B]",
}
export const FOLLOW_CHIP: Record<Follow, string> = {
  a: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  n: "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400",
  p: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  w: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  d: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
}

// ── Slicer ─────────────────────────────────────────────────────────────────

export type SlicerKey = "branch" | "unit" | "level" | "follow" | "zone" | "plant" | "fleet" | "vtype" | "product" | "source"

export type SlicerDef = {
  key: SlicerKey; label: string; value: (r: Row) => string; display?: (v: string) => string; order?: string[]
}

export const SLICERS: SlicerDef[] = [
  { key: "branch",  label: "สาขา",        value: (r) => r.branch, display: branchLabel },
  { key: "unit",    label: "หัว / หาง",   value: (r) => r.unit, display: (v) => (v === "trailer" ? "หาง (พ่วง)" : "หัว (รถ)"), order: ["head", "trailer"] },
  { key: "level",   label: "สถานะยาง",    value: (r) => r.level, display: (v) => DUE_LABEL[v as DueLevel] ?? v, order: LEVEL_ORDER },
  { key: "follow",  label: "งานติดตาม",   value: (r) => r.follow, display: (v) => FOLLOW_LABEL[v as Follow] ?? v, order: FOLLOW_ORDER },
  { key: "zone",    label: "โซน",         value: (r) => r.zone },
  { key: "plant",   label: "แพล้นท์",     value: (r) => r.plant },
  { key: "fleet",   label: "ฟลีท",        value: (r) => r.fleet },
  { key: "vtype",   label: "ประเภทรถ",    value: (r) => r.vtype },
  { key: "product", label: "รุ่นยาง",     value: (r) => r.product },
  { key: "source",  label: "แหล่งระยะทาง", value: (r) => r.source, display: (v) => (v === "none" ? "ไม่มีข้อมูล" : SOURCE_LABEL[v as DistanceSource] ?? v), order: ["gps", "trip", "none"] },
]
export const SLICER_BY_KEY = Object.fromEntries(SLICERS.map((s) => [s.key, s])) as Record<SlicerKey, SlicerDef>

export type Selection = Partial<Record<SlicerKey, string[]>>

export function matches(r: Row, sel: Selection, skip?: SlicerKey) {
  for (const s of SLICERS) {
    if (s.key === skip) continue
    const picked = sel[s.key]
    if (picked && picked.length > 0 && !picked.includes(s.value(r))) return false
  }
  return true
}

/** ตัวกรองหนึ่งช่องผ่านไหม — ใช้กับข้อมูลที่ไม่ใช่ Row (กราฟ) ที่มีมิติไม่ครบทุกกล่อง */
export const passes = (sel: Selection, k: SlicerKey, v: string) => {
  const picked = sel[k]
  return !picked || picked.length === 0 || picked.includes(v)
}

export const keyOfVehicle = (r: { branch: string; plate: string }) => `${r.branch}|${r.plate}`
