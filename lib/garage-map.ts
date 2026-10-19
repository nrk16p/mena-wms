// lib/garage-map.ts
// ชั้นคุย MongoDB ของหน้า "หาอู่ใกล้ที่สุด" — ตรรกะล้วนอยู่ใน garage-geo.ts
import clientPromise from "@/lib/mongo"
import geoSeed from "@/data/garage-geo.json"
import pinSeed from "@/data/garage-pins.json"
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

/** พิกัดหน้าอู่จริงจากแผนที่ My Maps "ร้านซ่อม" ของฝ่ายยานยนต์ (ดึง 19/10/2569)
 *  จับคู่กับชื่อใน AVL แบบยืนยันแล้วเท่านั้น — กฎจับคู่ด้วย "คำแก่น" ให้ผลมั่ว
 *  (เคยได้ "ช่างกี้ พระราม 2" ไปชนกับ "แพล้น พระรามเก้า") จึงเอาเฉพาะชื่อที่ตรงกันจริง */
type PinRow = { lat: number; lng: number; pinName: string; note: string; source: string }
const PINS = pinSeed as unknown as Record<string, PinRow>
const PIN_BY_KEY = new Map(Object.entries(PINS).map(([name, v]) => [garageKey(name), v]))
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
function pickGeo(doc: ApprovalDoc | null, seed: SeedRow | undefined, pin: PinRow | undefined): GarageGeo | null {
  const lat = Number(doc?.location?.lat), lng = Number(doc?.location?.lng)
  if (lat && lng) return { lat, lng, precision: "หน้าอู่", source: "ยืนยันในระบบแล้ว" }
  // หมุดจาก My Maps คนปักเองหน้างาน แม่นกว่าที่อยู่จดทะเบียนที่แปลงเป็นพิกัดระดับตำบล
  if (pin) return { lat: pin.lat, lng: pin.lng, precision: "หน้าอู่", source: pin.source }
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
    const pin  = PIN_BY_KEY.get(k)
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
      geo: pickGeo(doc, seed, pin),
      address: pickAddress(doc, seed),
      distanceKm: null,
      roadKm: null,
      roadMin: null,
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

/**
 * ยิงตามลิงก์ย่อ maps.app.goo.gl เพื่อเอาพิกัดจาก url ปลายทาง (ทำฝั่งเซิร์ฟเวอร์ เลี่ยง CORS)
 *
 * ⚠ ต้องอ่าน Location จาก 302 ตรง ๆ และต้องไม่ส่ง User-Agent ของเบราว์เซอร์:
 * ถ้า Google เห็นว่าเป็นเบราว์เซอร์ มันจะตอบ 200 เป็นหน้า JS ที่ไม่มีพิกัดอยู่เลย
 * แต่ถ้าเป็น client ธรรมดา (curl) จะได้ 302 ที่มี /@lat,lng และ !3d!4d มาเต็ม ๆ
 */
export async function resolveShortLink(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "curl/8.4.0" },
    signal: AbortSignal.timeout(8000),
  })
  return r.headers.get("location") || r.url || ""
}

export type RoadLeg = { km: number; min: number }

/**
 * ระยะขับจริง + เวลาขับ จากจุดเดียวไปหลายอู่ในคำขอเดียว (OSRM table service — ฟรี ไม่ต้องใช้คีย์)
 * ใช้กับอู่ชุดแรกเท่านั้น (ค่าเริ่มต้น 20 แห่ง) เพราะ url ยาวตามจำนวนจุด และเซิร์ฟเวอร์สาธารณะมีโควตา
 * ล้มเหลว/ช้า → คืน null ทั้งชุด หน้าจอยังใช้ระยะเส้นตรงต่อได้ ไม่พัง
 */
export async function roadMatrix(
  origin: { lat: number; lng: number },
  dests: { lat: number; lng: number }[],
): Promise<(RoadLeg | null)[]> {
  if (!dests.length) return []
  const coords = [origin, ...dests].map((p) => `${p.lng},${p.lat}`).join(";")
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) })
    if (!r.ok) return dests.map(() => null)
    const j = await r.json() as { code?: string; durations?: number[][]; distances?: number[][] }
    if (j.code !== "Ok" || !j.durations?.[0] || !j.distances?.[0]) return dests.map(() => null)
    const dur = j.durations[0], dis = j.distances[0]
    // ช่องแรกคือจุดตั้งต้นเทียบกับตัวเอง จึงเริ่มอ่านที่ index 1
    return dests.map((_, i) => {
      const sec = dur[i + 1], m = dis[i + 1]
      if (typeof sec !== "number" || typeof m !== "number") return null
      return { km: Math.round((m / 1000) * 10) / 10, min: Math.round(sec / 60) }
    })
  } catch {
    return dests.map(() => null)
  }
}

export function clearGarageCache() { cache = null }
