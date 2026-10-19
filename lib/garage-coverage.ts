// lib/garage-coverage.ts
// สรุปความครอบคลุมของอู่รายจังหวัด/อำเภอ เทียบกับจำนวนรถที่ประจำแพล้นท์ในพื้นที่นั้น
// ผู้ใช้ขอ 19/10/2569: "จำนวนอู่ต่อจังหวัด และต่อรถที่มี" — ใช้ดูว่าจังหวัดไหนรถเยอะแต่อู่น้อย ต้องหาอู่เพิ่ม
//
// จำนวนรถ: atms.vehicle_daily (1 แถว/คัน ~600 แถว อ่านทั้งคอลเลกชันได้สบาย) จับกลุ่มตามช่อง "แพล้นท์"
// ที่ตั้งแพล้นท์: data/plant-locations.json (scripts/build-plant-locations.mjs) แพล้นท์ที่ยังไม่รู้ที่ตั้งไปกองที่ "ไม่รู้จังหวัด"
import clientPromise from "@/lib/mongo"
import plantLoc from "@/data/plant-locations.json"
import { getGarages } from "@/lib/garage-map"
import type { GarageSource } from "@/lib/garage-geo"

const PLANTS = (plantLoc as unknown as { plants: Record<string, { province: string; district: string }> }).plants
export const UNKNOWN = "ไม่รู้จังหวัด"

export { COVERAGE_WORKS, doesWork } from "@/lib/garage-coverage-works"
import { COVERAGE_WORKS, doesWork } from "@/lib/garage-coverage-works"

export type CoverageGarage = { name: string; source: GarageSource; phone: string; district: string; works: string[] }
export type CoverageRow = {
  province: string
  district?: string
  trucks: number
  plants: string[]
  garages: number
  bySource: Record<GarageSource, number>
  withPhone: number
  /** จำนวนอู่ที่ทำแต่ละหมวด เรียงตาม COVERAGE_WORKS */
  works: number[]
  /** อู่ต่อรถ 100 คัน — null เมื่อไม่มีรถในพื้นที่ */
  per100: number | null
  /** รถต่ออู่ 1 แห่ง — null เมื่อไม่มีอู่ */
  trucksPerGarage: number | null
  districts?: CoverageRow[]
  list?: CoverageGarage[]
}

function emptyRow(province: string, district?: string): CoverageRow {
  return { province, district, trucks: 0, plants: [], garages: 0, bySource: { avl: 0, fleet: 0, pin: 0 }, withPhone: 0, works: COVERAGE_WORKS.map(() => 0), per100: null, trucksPerGarage: null }
}
function finish(r: CoverageRow) {
  r.per100 = r.trucks ? Math.round((r.garages / r.trucks) * 1000) / 10 : null
  r.trucksPerGarage = r.garages ? Math.round((r.trucks / r.garages) * 10) / 10 : null
}

export async function getCoverage() {
  const [garages, truckAgg] = await Promise.all([
    getGarages(),
    (await clientPromise).db("atms").collection("vehicle_daily")
      .aggregate([{ $group: { _id: "$แพล้นท์", trucks: { $sum: 1 }, asOf: { $max: "$t_date" } } }]).toArray(),
  ])

  const prov = new Map<string, CoverageRow>()
  const dist = new Map<string, CoverageRow>()
  const rowOf = (p: string) => { if (!prov.has(p)) prov.set(p, emptyRow(p)); return prov.get(p)! }
  const distOf = (p: string, d: string) => {
    const k = `${p}|${d}`
    if (!dist.has(k)) dist.set(k, emptyRow(p, d))
    return dist.get(k)!
  }

  let asOf = ""
  let trucksTotal = 0
  for (const t of truckAgg) {
    const plant = String(t._id ?? "").trim()
    const n = Number(t.trucks) || 0
    trucksTotal += n
    if (String(t.asOf ?? "") > asOf) asOf = String(t.asOf)
    const loc = PLANTS[plant]
    const p = loc?.province || UNKNOWN
    const r = rowOf(p); r.trucks += n; if (plant) r.plants.push(plant)
    if (loc?.district) { const d = distOf(p, loc.district); d.trucks += n; d.plants.push(plant) }
  }

  for (const g of garages) {
    const p = g.address?.province || UNKNOWN
    const d = g.address?.district || ""
    const targets = [rowOf(p), ...(d ? [distOf(p, d)] : [])]
    for (const r of targets) {
      r.garages++
      r.bySource[g.source]++
      if (/0\d[\d-]{7,}/.test(g.phone)) r.withPhone++
      COVERAGE_WORKS.forEach((w, i) => { if (doesWork(g, w)) r.works[i]++ })
    }
    const pr = rowOf(p)
    ;(pr.list ??= []).push({
      name: g.name, source: g.source, phone: g.phone, district: d,
      works: COVERAGE_WORKS.filter((w) => doesWork(g, w)).map((w) => w.label),
    })
  }

  for (const r of [...prov.values(), ...dist.values()]) finish(r)
  for (const d of dist.values()) (rowOf(d.province).districts ??= []).push(d)
  for (const r of prov.values()) {
    r.districts?.sort((a, b) => b.trucks - a.trucks || b.garages - a.garages)
    r.list?.sort((a, b) => ["avl", "fleet", "pin"].indexOf(a.source) - ["avl", "fleet", "pin"].indexOf(b.source) || a.name.localeCompare(b.name, "th"))
  }

  // เรียง: จังหวัดที่มีรถแต่ไม่มีอู่ก่อน → รถต่ออู่มากไปน้อย → ที่เหลือตามจำนวนอู่
  const rows = [...prov.values()].sort((a, b) => {
    const gapA = a.trucks > 0 && a.garages === 0, gapB = b.trucks > 0 && b.garages === 0
    if (gapA !== gapB) return gapA ? -1 : 1
    if (a.province === UNKNOWN || b.province === UNKNOWN) return a.province === UNKNOWN ? 1 : -1
    return (b.trucksPerGarage ?? -1) - (a.trucksPerGarage ?? -1) || b.garages - a.garages
  })

  const known = rows.filter((r) => r.province !== UNKNOWN)
  return {
    asOf,
    totals: {
      garages: garages.length,
      trucks: trucksTotal,
      provincesWithGarages: known.filter((r) => r.garages > 0).length,
      gapProvinces: known.filter((r) => r.trucks > 0 && r.garages === 0).map((r) => r.province),
      per100: trucksTotal ? Math.round((garages.length / trucksTotal) * 1000) / 10 : null,
      unknownPlants: (plantLoc as unknown as { unmatched: string[] }).unmatched,
    },
    works: COVERAGE_WORKS.map((w) => w.label),
    rows,
  }
}
