// แปลงทะเบียนอู่ของฝ่ายยานยนต์ (data/fleet-garages.tsv) → data/fleet-garages.json ให้หน้าหาอู่ใช้
// ใช้: node scripts/build-fleet-garages.mjs
//
// พิกัดในชีตมี 3 แบบปนกัน: องศาลิปดา (13°37'38.3"N 100°26'11.9"E) · ทศนิยม · Plus Code แบบย่อ (XX53+CG ตำบล…)
// Plus Code แบบย่อต้องมีจุดอ้างอิง จึงหาพิกัดตำบล/อำเภอที่เขียนต่อท้ายก่อน แล้วค่อยกู้รหัสเต็ม
// แถวที่ไม่มีพิกัดเลย ใช้กึ่งกลางตำบลจากที่อยู่ และติดป้ายว่าแม่นแค่ระดับตำบล
// Nominatim: 1 คำขอต่อวินาที และเก็บผลไว้ใน cache ไฟล์ จะรันซ้ำกี่รอบก็ไม่ยิงซ้ำ
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const SRC = path.join(ROOT, "data/fleet-garages.tsv")
const OUT = path.join(ROOT, "data/fleet-garages.json")
const CACHE = path.join(ROOT, "data/.geocode-cache.json")
const ADDR = JSON.parse(fs.readFileSync(path.join(ROOT, "data/thai-address.json"), "utf8"))
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {}

const WORKS = ["ช่วงล่าง/เบรค/คลัทซ์", "เครื่องยนต์", "ระบบโม่", "ตัวถัง/บอดี้", "นอกสถานที่", "แอร์", "หัวฉีด/ปั้ม", "ติดฟิลม์", "ทำท่อไอเสีย"]

// ── Open Location Code (Plus Code) — ถอดรหัสเต็ม + กู้รหัสย่อจากจุดอ้างอิง ──
const ALPHA = "23456789CFGHJMPQRVWX"
function olcDecode(code) {
  const c = code.replace("+", "").toUpperCase()
  let lat = -90, lng = -180, res = 20
  for (let i = 0; i < Math.min(c.length, 10); i += 2) {
    lat += ALPHA.indexOf(c[i]) * res
    lng += ALPHA.indexOf(c[i + 1]) * res
    if (i < 8) res /= 20
  }
  // ความกว้างของช่องสุดท้ายที่ถอดได้ ใช้หาจุดกึ่งกลาง
  const pairs = Math.min(c.length, 10) / 2
  const size = 20 / Math.pow(20, pairs - 1)
  return { lat: lat + size / 2, lng: lng + size / 2 }
}
function olcRecover(short, ref) {
  const s = short.toUpperCase()
  const padLen = 8 - s.indexOf("+") // ตัวอักษรที่หายไปข้างหน้า
  const res = Math.pow(20, 2 - padLen / 2)
  const half = res / 2
  const rLat = Math.floor((ref.lat + 90) / res) * res - 90
  const rLng = Math.floor((ref.lng + 180) / res) * res - 180
  // เอาหัวรหัสของจุดอ้างอิงมาต่อหน้า
  let prefix = "", lat = rLat + 90, lng = rLng + 180, r = 20
  for (let i = 0; i < padLen / 2; i++) {
    prefix += ALPHA[Math.floor(lat / r)] + ALPHA[Math.floor(lng / r)]
    lat %= r; lng %= r; r /= 20
  }
  const p = olcDecode(prefix + s)
  // ถ้าห่างจุดอ้างอิงเกินครึ่งช่อง ให้ขยับไปช่องข้าง ๆ (ตามสเปก recoverNearest)
  if (ref.lat + half < p.lat && p.lat - res >= -90) p.lat -= res
  else if (ref.lat - half > p.lat && p.lat + res <= 90) p.lat += res
  if (ref.lng + half < p.lng) p.lng -= res
  else if (ref.lng - half > p.lng) p.lng += res
  return p
}

function parseCoord(s) {
  const dms = [...s.matchAll(/(\d+)°(\d+)'([\d.]+)"/g)]
  if (dms.length >= 2) {
    const v = dms.slice(0, 2).map((m) => +m[1] + m[2] / 60 + m[3] / 3600)
    return { lat: +v[0].toFixed(6), lng: +v[1].toFixed(6), how: "พิกัดในชีต" }
  }
  const dec = s.match(/(\d{1,2}\.\d{3,})\s*,\s*(\d{2,3}\.\d{3,})/)
  if (dec) return { lat: +dec[1], lng: +dec[2], how: "พิกัดในชีต" }
  return null
}

/** แกะ จังหวัด/อำเภอ/ตำบล จากข้อความที่อยู่ไทย โดยเทียบกับรายชื่อเขตปกครองจริง */
function parseArea(text) {
  const t = text.replace(/\s+/g, " ")
  let prov = ADDR.find((p) => t.includes(p.p))
  if (!prov && /อยุธยา/.test(t)) prov = ADDR.find((p) => p.p.includes("อยุธยา"))
  if (!prov) return null
  const amp = prov.a.find((a) => new RegExp(`(อำเภอ|อ\\.|เขต)\\s*${a.n}`).test(t)) ?? prov.a.find((a) => t.includes(a.n))
  const tam = amp?.t.find((x) => new RegExp(`(ตำบล|ต\\.|แขวง)\\s*${x.n}`).test(t)) ?? amp?.t.find((x) => t.includes(x.n))
  return { province: prov.p, district: amp?.n ?? "", subdistrict: tam?.n ?? "" }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function geocodeArea(a) {
  const key = [a.subdistrict, a.district, a.province].join("|")
  if (key in cache) return cache[key]
  const qs = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "th", "accept-language": "th" })
  if (a.district) qs.set("county", a.district)
  if (a.subdistrict) qs.set("city", a.subdistrict)
  qs.set("state", a.province)
  let hit = null
  for (const url of [
    `https://nominatim.openstreetmap.org/search?${qs}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&q=${encodeURIComponent([a.subdistrict && "ตำบล" + a.subdistrict, a.district && "อำเภอ" + a.district, a.province].filter(Boolean).join(" "))}`,
  ]) {
    await sleep(1100)
    const r = await fetch(url, { headers: { "User-Agent": "mena-wms-garage-map/1.0 (internal fleet tool)" } })
    const j = await r.json().catch(() => [])
    if (j[0]) { hit = { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6) }; break }
  }
  cache[key] = hit
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1))
  return hit
}

const rows = fs.readFileSync(SRC, "utf8").split("\n").filter((l) => l && !l.startsWith("#"))
const out = []
let zone = ""
const tally = { พิกัดในชีต: 0, "Plus Code": 0, ตำบล: 0, ไม่มี: 0 }
for (const line of rows) {
  const cells = line.split("\t")
  const [z, name, flags, phone, coord, loc] = Array.from({ length: 6 }, (_, i) => (cells[i] ?? "").trim())
  if (z) zone = z
  if (!name) continue
  if (/ไม่ทำแล้ว/.test(coord + loc)) continue
  const text = `${coord} ${loc}`
  const area = parseArea(text) ?? parseArea(zone)
  let geo = parseCoord(coord) ?? parseCoord(loc)
  if (!geo) {
    const pc = text.match(/\b([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})\b/i)
    if (pc && area) {
      const ref = await geocodeArea(area)
      if (ref) {
        const full = pc[1].indexOf("+") === 8
        const p = full ? olcDecode(pc[1]) : olcRecover(pc[1], ref)
        geo = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), how: "Plus Code" }
      }
    }
  }
  let precision = "หน้าอู่"
  if (!geo && area) {
    const c = await geocodeArea(area)
    if (c) { geo = { ...c, how: "ตำบล" }; precision = area.subdistrict ? "ตำบล" : "อำเภอ" }
  }
  tally[geo?.how ?? "ไม่มี"]++
  out.push({
    name, zone,
    works: WORKS.filter((_, i) => flags[i] === "1"),
    unknownWorks: WORKS.filter((_, i) => flags[i] === "?"),
    phone: phone === "-" ? "" : phone,
    address: loc || (geo?.how === "พิกัดในชีต" ? "" : coord),
    area,
    geo: geo ? { lat: geo.lat, lng: geo.lng, precision } : null,
    pending: /รอAdd/i.test(name),
  })
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
console.log("อู่จากชีตยานยนต์", out.length, "ราย ·", Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · "))
for (const g of out.filter((g) => !g.geo)) console.log("  ยังไม่มีพิกัด:", g.name, "|", g.zone)
