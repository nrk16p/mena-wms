// lib/garage-map.ts
// ชั้นคุย MongoDB ของหน้า "หาอู่ใกล้ที่สุด" — ตรรกะล้วนอยู่ใน garage-geo.ts
import clientPromise from "@/lib/mongo"
import geoSeed from "@/data/garage-geo.json"
import { byCode } from "@/lib/repair-type-master"
import { garageKey } from "@/lib/atms-garage"
import type { GarageHit, GarageGeo, GarageAddress, GeoPrecision } from "@/lib/garage-geo"

const DB      = process.env.MONGO_DB ?? "master_data"
const AP_COLL = "vendor_approval"
const RE_COLL = "repair_external"
const TTL_MS  = 10 * 60 * 1000

type SeedRow = {
  full: string; subdistrict: string; district: string; province: string
  lat: number | null; lng: number | null; precision: string | null; source: string
  jpNo: string; jpName: string
}
const SEED = geoSeed as unknown as Record<string, SeedRow>
/** ชื่อในไฟล์ seed สะกดตาม ATMS — เทียบด้วย garageKey เหมือนที่อื่นทั้งระบบ */
const SEED_BY_KEY = new Map(Object.entries(SEED).map(([name, v]) => [garageKey(name), v]))

let cache: { at: number; items: GarageHit[] } | null = null

type ApprovalDoc = {
  vendor: string
  codes?: string[]
  status?: string
  atmsId?: number
  location?: { lat?: number; lng?: number }
  address?: { full?: string; subdistrict?: string; district?: string; province?: string }
}

/** พิกัดที่คนยืนยันแล้วชนะพิกัดจากทะเบียนนิติบุคคลเสมอ */
function pickGeo(doc: ApprovalDoc | null, seed: SeedRow | undefined): GarageGeo | null {
  const lat = Number(doc?.location?.lat), lng = Number(doc?.location?.lng)
  if (lat && lng) return { lat, lng, precision: "หน้าอู่", source: "ยืนยันในระบบแล้ว" }
  if (seed?.lat && seed?.lng) {
    return { lat: seed.lat, lng: seed.lng, precision: (seed.precision as GeoPrecision) ?? "ตำบล", source: seed.source }
  }
  return null
}

function pickAddress(doc: ApprovalDoc | null, seed: SeedRow | undefined): GarageAddress | null {
  const a = doc?.address
  if (a?.province) return { full: a.full ?? "", subdistrict: a.subdistrict ?? "", district: a.district ?? "", province: a.province }
  if (seed?.province) return { full: seed.full, subdistrict: seed.subdistrict, district: seed.district, province: seed.province }
  return null
}

/** อู่ทุกรายที่ค้นหาได้ พร้อมพิกัด/ที่อยู่/ประวัติ — cache 10 นาที (ต้นทางขยับช้า) */
export async function getGarages(refresh = false): Promise<GarageHit[]> {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) return cache.items

  const client = await clientPromise
  const db = client.db(DB)

  const [approvals, atmsSuppliers, jobAgg] = await Promise.all([
    db.collection<ApprovalDoc>(AP_COLL).find({}).toArray(),
    client.db("atms").collection("supplier_master")
      .find({ type: "อู่" }, { projection: { _id: 0, atmsId: 1, name: 1, phone: 1, branch: 1 } }).toArray(),
    db.collection(RE_COLL).aggregate([
      { $match: { garage: { $nin: ["", null] } } },
      { $group: { _id: "$garage", jobs: { $sum: 1 }, lastJob: { $max: "$receivedDate" } } },
    ]).toArray(),
  ])

  const supByKey  = new Map(atmsSuppliers.map((s) => [garageKey(s.name), s]))
  const jobsByKey = new Map(jobAgg.map((j) => [garageKey(j._id as string), j]))

  const items: GarageHit[] = approvals.map((doc) => {
    const k    = garageKey(doc.vendor)
    const seed = SEED_BY_KEY.get(k)
    const sup  = supByKey.get(k)
    const job  = jobsByKey.get(k)
    const codes = Array.isArray(doc.codes) ? doc.codes : []
    return {
      name: String(doc.vendor ?? "").trim(),
      atmsId: Number(doc.atmsId) || (sup?.atmsId as number) || null,
      phone: String(sup?.phone ?? ""),
      branch: String(sup?.branch ?? ""),
      codes,
      works: [...new Set(codes.map((c) => byCode(c)?.work).filter((w): w is string => !!w))],
      status: String(doc.status ?? ""),
      geo: pickGeo(doc, seed),
      address: pickAddress(doc, seed),
      distanceKm: null,
      matchesAll: false,
      jobs: Number(job?.jobs) || 0,
      lastJob: String(job?.lastJob ?? ""),
      poCount: 0,
      poBaht: 0,
    }
  })

  cache = { at: Date.now(), items }
  return items
}

/** ยิงตามลิงก์ย่อ maps.app.goo.gl เพื่อเอาพิกัดจาก url ปลายทาง (ทำฝั่งเซิร์ฟเวอร์ เลี่ยง CORS) */
export async function resolveShortLink(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    signal: AbortSignal.timeout(8000),
  })
  return r.url || ""
}

export function clearGarageCache() { cache = null }
