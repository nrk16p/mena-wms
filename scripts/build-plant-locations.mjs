// หาที่ตั้ง (พิกัด + จังหวัด/อำเภอ) ของแต่ละแพล้นท์ใน ATMS → data/plant-locations.json
// ใช้: MONGO_URI=... node scripts/build-plant-locations.mjs
//
// ชื่อแพล้นท์ใน ATMS (atms.vehicle_daily.แพล้นท์) กับชื่อหมุดแพล้นท์ใน My Map ยานยนต์เขียนไม่เหมือนกันทุกตัว
// จึงเทียบด้วยชื่อที่ตัดช่องว่าง/คำว่าแพล้นท์ออก แล้วค่อยหาจังหวัด/อำเภอจากพิกัดด้วย Nominatim reverse
// (1 คำขอต่อวินาที เก็บ cache ไว้ใน data/.geocode-cache.json รันซ้ำไม่ยิงซ้ำ)
// แพล้นท์ที่จับคู่ไม่ได้ เขียนไว้ใน unmatched ให้คนเติมพิกัดเองในไฟล์ manual
import fs from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, "data/plant-locations.json")
const CACHE = path.join(ROOT, "data/.geocode-cache.json")
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { manual: {} }
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "data/map-layers.json"), "utf8")).plants

const norm = (s) => String(s ?? "").replace(/แพล้นท์|แพล้นต์|แพล้น|plant/gi, "").replace(/[\s.\-_()]/g, "").toLowerCase()

const client = new MongoClient(process.env.MONGO_URI)
await client.connect()
// vehicle_daily = 1 แถวต่อคัน (~600 แถว) — group ทั้งคอลเลกชันได้สบาย
const names = (await client.db("atms").collection("vehicle_daily").distinct("แพล้นท์")).map((x) => String(x ?? "").trim()).filter(Boolean)
await client.close()

const byNorm = new Map(pins.map((p) => [norm(p.n), p]))
function matchPin(name) {
  const k = norm(name)
  if (byNorm.has(k)) return byNorm.get(k)
  // ชื่อหนึ่งอยู่ในอีกชื่อ — เลือกตัวที่ชื่อยาวใกล้เคียงที่สุด
  const c = pins.filter((p) => { const n = norm(p.n); return k.length >= 3 && (n.includes(k) || k.includes(n)) && n.length >= 3 })
  c.sort((a, b) => Math.abs(norm(a.n).length - k.length) - Math.abs(norm(b.n).length - k.length))
  return c[0] ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function reverse(lat, lng) {
  const key = `rev|${lat.toFixed(4)},${lng.toFixed(4)}`
  if (key in cache) return cache[key]
  await sleep(1100)
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=th&zoom=12&lat=${lat}&lon=${lng}`,
    { headers: { "User-Agent": "mena-wms-garage-map/1.0 (internal fleet tool)" } })
  const a = (await r.json().catch(() => ({}))).address ?? {}
  let province = String(a.province || a.state || "").replace(/^จังหวัด/, "")
  let district = String(a.county || a.city_district || a.district || a.city || a.town || "").replace(/^(อำเภอ|เขต)/, "")
  if (!province && /กรุงเทพ/.test(a.city ?? "")) province = "กรุงเทพมหานคร"
  if (province === "กรุงเทพมหานคร" && /^กรุงเทพ/.test(district)) district = String(a.suburb || "").replace(/^เขต/, "")
  cache[key] = { province, district }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1))
  return cache[key]
}

// Nominatim บางจุดคืนชื่อ อบต./ตำบล หรืออำเภอผิดจังหวัด มาแทนอำเภอ — แก้กลับเป็นอำเภอจริงจากรายชื่อเขตปกครอง
const ADDR = JSON.parse(fs.readFileSync(path.join(ROOT, "data/thai-address.json"), "utf8"))
function fixDistrict(plant, province, district) {
  const prov = ADDR.find((p) => p.p === province)
  if (!prov) return district
  if (prov.a.some((a) => a.n === district)) return district
  const tambon = district.replace(/^(องค์การบริหารส่วนตำบล|เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|ตำบล|แขวง)/, "")
  const byTambon = prov.a.find((a) => a.t.some((t) => t.n === tambon))
  if (byTambon) return byTambon.n
  const byName = prov.a.find((a) => plant.includes(a.n))
  return byName ? byName.n : ""
}

const plants = {}
const unmatched = []
for (const name of names.sort((a, b) => a.localeCompare(b, "th"))) {
  const manual = prev.manual?.[name]
  const pin = manual ? { n: "(กรอกเอง)", lat: manual.lat, lng: manual.lng } : matchPin(name)
  if (!pin) { unmatched.push(name); continue }
  const area = await reverse(pin.lat, pin.lng)
  plants[name] = { lat: pin.lat, lng: pin.lng, pin: pin.n, province: area.province, district: fixDistrict(name, area.province, area.district) }
}
fs.writeFileSync(OUT, JSON.stringify({
  note: "สร้างด้วย scripts/build-plant-locations.mjs · manual = พิกัดที่คนเติมเองให้แพล้นท์ที่จับคู่ไม่ได้ {ชื่อ: {lat,lng}}",
  manual: prev.manual ?? {},
  plants,
  unmatched,
}, null, 1) + "\n")
console.log("แพล้นท์ใน ATMS", names.length, "· รู้ที่ตั้ง", Object.keys(plants).length, "· จับคู่ไม่ได้", unmatched.length)
console.log("ไม่ได้:", unmatched.join(" | "))
