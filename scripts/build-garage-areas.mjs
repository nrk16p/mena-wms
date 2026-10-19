// หาจังหวัด/อำเภอให้อู่ที่มีพิกัดแต่ไม่มีที่อยู่ (ส่วนใหญ่คือหมุดร้านซ่อมใน My Map) → data/garage-areas.json
// ใช้: node scripts/build-garage-areas.mjs   (อ่านพิกัดจาก data/map-layers.json ไม่แตะฐานข้อมูล)
// หน้าสรุปรายจังหวัดใช้ไฟล์นี้นับอู่ต่อจังหวัด · Nominatim 1 คำขอ/วินาที มี cache รันซ้ำไม่ยิงซ้ำ
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, "data/garage-areas.json")
const CACHE = path.join(ROOT, "data/.geocode-cache.json")
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {}
const ADDR = JSON.parse(fs.readFileSync(path.join(ROOT, "data/thai-address.json"), "utf8"))
const { shops } = JSON.parse(fs.readFileSync(path.join(ROOT, "data/map-layers.json"), "utf8"))

function fixDistrict(province, district) {
  const prov = ADDR.find((p) => p.p === province)
  if (!prov || prov.a.some((a) => a.n === district)) return district
  const tambon = district.replace(/^(องค์การบริหารส่วนตำบล|เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|ตำบล|แขวง)/, "")
  return prov.a.find((a) => a.t.some((t) => t.n === tambon))?.n ?? ""
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function reverse(lat, lng) {
  const key = `rev|${lat.toFixed(4)},${lng.toFixed(4)}`
  if (!(key in cache)) {
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
  }
  const v = cache[key]
  return { province: v.province, district: fixDistrict(v.province, v.district) }
}

const out = {}
let n = 0
for (const s of shops) {
  const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`
  if (out[k]) continue
  out[k] = await reverse(s.lat, s.lng)
  if (++n % 25 === 0) console.log(n, "/", shops.length)
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n")
console.log("เสร็จ", Object.keys(out).length, "จุด · ไม่รู้จังหวัด", Object.values(out).filter((v) => !v.province).length)
