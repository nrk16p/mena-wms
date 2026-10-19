// lib/garage-map.ts
// ชั้นคุย MongoDB ของหน้า "หาอู่ใกล้ที่สุด" — ตรรกะล้วนอยู่ใน garage-geo.ts
import clientPromise from "@/lib/mongo"
import geoSeed from "@/data/garage-geo.json"
import pinSeed from "@/data/garage-pins.json"
import fleetSeed from "@/data/fleet-garages.json"
import mapLayers from "@/data/map-layers.json"
import garageAreas from "@/data/garage-areas.json"
import { byCode } from "@/lib/repair-type-master"
import { garageKey } from "@/lib/atms-garage"
import { haversineKm } from "@/lib/garage-geo"
import type { GarageHit, GarageGeo, GarageAddress, GeoPrecision, GarageSource } from "@/lib/garage-geo"

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

/** ทะเบียนอู่ของฝ่ายยานยนต์ (ชีต "ประเภทอู่ซ่อม2026") — สร้างด้วย scripts/build-fleet-garages.mjs */
type FleetRow = {
  name: string; zone: string; works: string[]; phone: string; address: string; pending: boolean
  area: { province: string; district: string; subdistrict: string } | null
  geo: { lat: number; lng: number; precision: GeoPrecision } | null
}
const FLEET = fleetSeed as unknown as FleetRow[]

/** หมวดงานในชีตยานยนต์ → รหัสประเภทงานอู่นอกของ AVL ให้ตัวกรองประเภทงานใช้ร่วมกันได้
 *  "นอกสถานที่" กับ "ติดฟิล์ม" ไม่มีรหัสคู่ใน AVL จึงโชว์เป็นป้ายอย่างเดียว */
const FLEET_CODES: Record<string, string[]> = {
  "ช่วงล่าง/เบรค/คลัทซ์": ["S35", "S37"],
  "เครื่องยนต์": ["S33"],
  "ระบบโม่": ["S45"],
  "ตัวถัง/บอดี้": ["S57", "S43"],
  "แอร์": ["S39"],
  "หัวฉีด/ปั้ม": ["S61"],
  "ทำท่อไอเสีย": ["S47"],
}

/** จังหวัด/อำเภอของหมุดร้านซ่อม (reverse geocode ไว้แล้ว — scripts/build-garage-areas.mjs) คีย์ "lat,lng" 4 ตำแหน่ง */
const PIN_AREAS = garageAreas as unknown as Record<string, { province: string; district: string }>

/** หมุดร้านซ่อมทั้งหมดใน My Map (ชุดเดียวกับเลเยอร์ส้มบนแผนที่) */
type ShopPin = { n: string; t: string; lat: number; lng: number }
const SHOPS = (mapLayers as unknown as { shops: ShopPin[] }).shops

/** เบอร์โทรเป็นตัวเลขล้วน ใช้จับว่าเป็นเจ้าเดียวกันข้ามแหล่ง (แม่นกว่าชื่อมาก) */
const phonesOf = (s: string) =>
  [...String(s ?? "").matchAll(/0\d[\d\- ]{7,12}/g)].map((m) => m[0].replace(/\D/g, "")).filter((x) => x.length >= 9 && x.length <= 10)

/** แก่นชื่อ: ตัดคำนำหน้า/คำกลาง ๆ และวงเล็บออก เพื่อเทียบชื่อข้ามแหล่ง */
const coreName = (s: string) =>
  String(s ?? "").replace(/\(.*?\)/g, " ")
    .replace(/บริษัท|ห้างหุ้นส่วนจำกัด|หจก\.?|บจก\.?|จำกัด|นางสาว|นาย|นาง|อู่|ร้าน|ศูนย์|เซอร์วิส|เซอร์วิช|การช่าง|ช่าง|เครดิต|เงินสด|\(รอAdd\)/g, " ")
    .replace(/\s+/g, "").toLowerCase()

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
      source: "avl" as GarageSource,
      sources: ["avl"] as GarageSource[],
      fleetWorks: [],
      onsite: false,
      zone: "",
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

  mergeFleet(items)
  addShopPins(items)
  // อู่ AVL ที่ได้พิกัดจากหมุด My Map แต่ไม่มีที่อยู่ — ใช้จังหวัดของหมุดนั้นแทน ตัวกรองจังหวัดจะได้ไม่ทำอู่หาย
  for (const g of items) if (!g.address && g.geo) g.address = areaOfPin(g.geo)

  cache = { at: Date.now(), items }
  return items
}

/** ชีตยานยนต์: ถ้าเป็นเจ้าเดียวกับใน AVL (เบอร์ตรง หรือแก่นชื่อตรง) เติมข้อมูลให้ ไม่งั้นเพิ่มเป็นอู่ใหม่ */
function mergeFleet(items: GarageHit[]) {
  const byPhone = new Map<string, GarageHit>()
  for (const g of items) for (const p of phonesOf(g.phone)) byPhone.set(p, g)
  const byCore = new Map(items.map((g) => [coreName(g.name), g]).filter(([k]) => (k as string).length >= 3) as [string, GarageHit][])

  for (const f of FLEET) {
    const codes = [...new Set(f.works.flatMap((w) => FLEET_CODES[w] ?? []))]
    const hit = phonesOf(f.phone).map((p) => byPhone.get(p)).find(Boolean) ?? byCore.get(coreName(f.name))
    const geo: GarageGeo | null = f.geo ? { lat: f.geo.lat, lng: f.geo.lng, precision: f.geo.precision, source: "ชีตทะเบียนอู่ยานยนต์" } : null
    const address: GarageAddress | null = f.area
      ? { full: f.address, subdistrict: f.area.subdistrict, district: f.area.district, province: f.area.province }
      : null
    if (hit) {
      hit.sources.push("fleet")
      hit.fleetWorks = f.works
      hit.onsite = f.works.includes("นอกสถานที่")
      hit.zone = f.zone
      hit.codes = [...new Set([...hit.codes, ...codes])]
      if (!hit.phone) hit.phone = f.phone
      // พิกัดหน้าอู่จากชีตชนะพิกัดระดับตำบลจากที่อยู่จดทะเบียน
      if (geo && (!hit.geo || (hit.geo.precision !== "หน้าอู่" && geo.precision === "หน้าอู่"))) hit.geo = geo
      if (!hit.address && address) hit.address = address
      continue
    }
    items.push({
      source: "fleet", sources: ["fleet"], fleetWorks: f.works, onsite: f.works.includes("นอกสถานที่"), zone: f.zone,
      name: f.name.replace(/\(รอAdd\)/i, "").trim(),
      atmsId: null, phone: f.phone, branch: "", codes,
      works: [...new Set(codes.map((c) => byCode(c)?.work).filter((w): w is string => !!w))],
      status: f.pending ? "รอเพิ่มเข้าระบบ" : "",
      geo, address,
      distanceKm: null, roadKm: null, roadMin: null, matchesAll: false,
      jobs: 0, lastJob: "", poCount: 0, poBaht: 0,
    })
  }
}

function areaOfPin(s: { lat: number; lng: number }): GarageAddress | null {
  const a = PIN_AREAS[`${s.lat.toFixed(4)},${s.lng.toFixed(4)}`]
  return a?.province ? { full: "", subdistrict: "", district: a.district, province: a.province } : null
}

/** หมุดร้านซ่อมใน My Map ที่ยังไม่ซ้ำกับอู่ไหนเลย → เพิ่มเป็นอู่ระดับ "pin"
 *  ซ้ำ = เบอร์ตรงกัน หรือเป็นหมุดที่จับคู่กับ AVL ไว้แล้ว หรืออยู่ห่างอู่ที่ชื่อคล้ายกันไม่เกิน 300 ม. */
function addShopPins(items: GarageHit[]) {
  const usedPins = new Set(Object.values(PINS).map((p) => p.pinName))
  const phones = new Set(items.flatMap((g) => phonesOf(g.phone)))
  for (const s of SHOPS) {
    if (usedPins.has(s.n)) {
      const owner = items.find((g) => PIN_BY_KEY.get(garageKey(g.name))?.pinName === s.n)
      if (owner && !owner.sources.includes("pin")) owner.sources.push("pin")
      continue
    }
    const ph = phonesOf(`${s.n} ${s.t}`)
    const twin = ph.some((p) => phones.has(p))
      ? items.find((g) => phonesOf(g.phone).some((p) => ph.includes(p)))
      : items.find((g) => g.geo && haversineKm(g.geo, s) < 0.3 && coreName(g.name).length >= 2 && coreName(s.n).includes(coreName(g.name)))
    if (twin) { if (!twin.sources.includes("pin")) twin.sources.push("pin"); continue }
    // ชื่อหมุดมักมีเบอร์ต่อท้าย ตัดออกให้อ่านง่าย เบอร์ไปอยู่ช่องเบอร์แทน
    const name = s.n.replace(/0\d[\d\- ]{7,12}/g, "").replace(/\s+/g, " ").trim() || s.n
    items.push({
      source: "pin", sources: ["pin"], fleetWorks: [], onsite: false, zone: "",
      name, atmsId: null, phone: ph[0] ?? "", branch: "", codes: [], works: [], status: "",
      geo: { lat: s.lat, lng: s.lng, precision: "หน้าอู่", source: "หมุด My Map ยานยนต์" },
      address: areaOfPin(s),
      distanceKm: null, roadKm: null, roadMin: null, matchesAll: false,
      jobs: 0, lastJob: "", poCount: 0, poBaht: 0,
    })
  }
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
