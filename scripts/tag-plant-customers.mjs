// เติมชื่อลูกค้าให้แพล้นท์ใน data/map-layers.json จากช่อง "บริการ" ในไฟล์ KML ของ My Map
// ใช้: node scripts/tag-plant-customers.mjs <doc.kml>
// จับคู่หมุดด้วยพิกัดที่ใกล้ที่สุดไม่เกิน 100 ม. (ชื่อตรงกันได้ก่อน) เพราะชื่อแพล้นท์ซ้ำกันข้ามลูกค้าได้ เช่น ลาดกระบัง
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, "data/map-layers.json")
const kml = fs.readFileSync(process.argv[2], "utf8")

const folder = [...kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)].map((m) => m[1]).find((f) => /<name>แพล้นท์<\/name>/.test(f))
if (!folder) throw new Error("ไม่เจอโฟลเดอร์ แพล้นท์ ใน KML")

const unesc = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim()
const pins = []
for (const [, pm] of folder.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
  const name = unesc(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "")
  const [lng, lat] = (pm.match(/<coordinates>\s*([^<]+)<\/coordinates>/)?.[1] ?? "").trim().split(",")
  const cust = unesc(pm.match(/<Data name="บริการ">\s*<value>([\s\S]*?)<\/value>/)?.[1] ?? "")
  pins.push({ name, lat: +lat, lng: +lng, cust })
}

const layers = JSON.parse(fs.readFileSync(OUT, "utf8"))
// สาขาซีเจไม่ใช่แพล้นท์ลูกค้า (ปนอยู่ในเลเยอร์เดิม) ตัดออก
const isCJ = (p, c) => c === "CJ" || c === "ซีเจ" || /ซี\.?เจ|CJ /i.test(p.n)
const tally = {}
let miss = 0
layers.plants = layers.plants.filter((p) => {
  // ระยะแบบประมาณ (เมตร) พอสำหรับเทียบจุดที่ห่างกันไม่กี่สิบเมตร
  const dist = (q) => Math.hypot((q.lat - p.lat) * 111320, (q.lng - p.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180))
  const near = pins.filter((q) => dist(q) <= 100).sort((a, b) => (b.name === p.n) - (a.name === p.n) || dist(a) - dist(b))
  const c = near[0]?.cust
  if (c === undefined) miss++
  if (c) p.c = c; else delete p.c
  if (isCJ(p, c)) return false
  tally[c || "(ไม่ระบุ)"] = (tally[c || "(ไม่ระบุ)"] ?? 0) + 1
  return true
})
fs.writeFileSync(OUT, JSON.stringify(layers, null, 1) + "\n")
console.log("แพล้นท์", layers.plants.length, "· หาไม่เจอใน KML", miss)
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "))
