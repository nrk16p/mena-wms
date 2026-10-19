// นำเข้าคู่ "หมุดใน My Map ↔ อู่ในทะเบียน" ที่จัดซื้อติ๊กยืนยันกลับมา → data/garage-pins.json
// ใช้: node scripts/garage-pins-import.mjs "<ไฟล์ที่ติ๊กแล้ว.xlsx>" [--write]
// ไม่ใส่ --write = ดูผลก่อน ไม่แตะไฟล์จริง
//
// ไฟล์ต้นฉบับสร้างจากหมุดชุดเดียวกับ data/map-layers.json (ร้านซ่อม 230 จุด จาก My Maps ฝ่ายยานยนต์)
// จึงอ่านพิกัดจากไฟล์นั้น ไม่ต้องเชื่อพิกัดที่พิมพ์กลับมาในไฟล์ Excel
import fs from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"

const ROOT = path.resolve(import.meta.dirname, "..")
const PINS_FILE = path.join(ROOT, "data/garage-pins.json")
const src = process.argv[2]
const WRITE = process.argv.includes("--write")
if (!src) {
  console.error('ต้องบอกไฟล์ที่ติ๊กแล้ว เช่น node scripts/garage-pins-import.mjs "~/Desktop/ติ๊กยืนยันคู่อู่-หมุดแผนที่.xlsx"')
  process.exit(1)
}

const shops = JSON.parse(fs.readFileSync(path.join(ROOT, "data/map-layers.json"), "utf8")).shops
const PIN_BY_NAME = new Map(shops.map((s) => [s.n, s]))
const key = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase()
/** ค่าในเซลล์อาจเป็นลิงก์หรือสูตร จึงต้องดึงข้อความจริงออกมา */
const txt = (c) => {
  const v = c?.value
  if (v == null) return ""
  if (typeof v === "object") return String(v.text ?? v.result ?? "").trim()
  return String(v).trim()
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(src.replace(/^~/, process.env.HOME ?? "~"))

// รายชื่ออู่ที่ถูกต้องอยู่ในชีตเดียวกับไฟล์ที่ส่งไป ใช้ตรวจชื่อที่พิมพ์กลับมาได้เลย
const wsNames = wb.getWorksheet("รายชื่ออู่ในทะเบียน")
const NAME_BY_KEY = new Map()
wsNames?.eachRow((row, n) => { if (n > 1) { const name = txt(row.getCell(1)); if (name) NAME_BY_KEY.set(key(name), name) } })

const out = {}
const problems = []
function add(vendorName, pinName, source, where) {
  const real = NAME_BY_KEY.get(key(vendorName))
  if (!real) { problems.push(`${where}: ไม่พบอู่ชื่อ "${vendorName}" ในทะเบียน`); return }
  const pin = PIN_BY_NAME.get(pinName)
  if (!pin) { problems.push(`${where}: ไม่พบหมุดชื่อ "${pinName}" ในแผนที่`); return }
  const prev = out[real]
  if (prev && prev.pinName !== pin.n) problems.push(`${where}: อู่ "${real}" ถูกยืนยันซ้ำกับหมุดอื่น (เดิม ${prev.pinName})`)
  out[real] = { lat: pin.lat, lng: pin.lng, pinName: pin.n, note: pin.t ?? "", source }
}

const stats = { ยืนยันจากตัวเลือก: 0, พิมพ์ชื่อเอง: 0, ไม่ใช่อู่ในทะเบียน: 0, ต้องโทรถาม: 0, ยังไม่ตอบ: 0 }
const ws = wb.getWorksheet("ติ๊กยืนยันคู่")
ws?.eachRow((row, n) => {
  if (n === 1) return
  const pinName = txt(row.getCell(2))
  const ans = txt(row.getCell(20))
  const typed = txt(row.getCell(21))
  const where = `ติ๊กยืนยันคู่ แถว ${n}`
  const pick = { "1": 7, "2": 13, "3": 17 }
  if (typed) { stats.พิมพ์ชื่อเอง++; add(typed, pinName, "จัดซื้อยืนยัน (My Maps)", where); return }
  const m = /ตัวเลือก\s*([123])/.exec(ans)
  if (m) { stats.ยืนยันจากตัวเลือก++; add(txt(row.getCell(pick[m[1]])), pinName, "จัดซื้อยืนยัน (My Maps)", where); return }
  if (/ไม่ใช่อู่/.test(ans)) stats.ไม่ใช่อู่ในทะเบียน++
  else if (/โทรถาม/.test(ans)) stats.ต้องโทรถาม++
  else stats.ยังไม่ตอบ++
})

let keep = 0, fixed = 0, dropped = 0
const ws2 = wb.getWorksheet("คู่ที่จับได้แล้ว")
ws2?.eachRow((row, n) => {
  if (n === 1) return
  const vendor = txt(row.getCell(2)), pinName = txt(row.getCell(3))
  const ok = txt(row.getCell(7)), corr = txt(row.getCell(8))
  const where = `คู่ที่จับได้แล้ว แถว ${n}`
  if (/ผิด/.test(ok)) {
    if (corr) { fixed++; add(corr, pinName, "จัดซื้อแก้ให้ (My Maps)", where) } else dropped++
    return
  }
  keep++
  add(vendor, pinName, "ชื่อตรงกับ My Maps", where)
})

console.log("ชีตติ๊กยืนยัน:", Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(" | "))
console.log("ชีตคู่ที่จับได้แล้ว: คงเดิม", keep, "| แก้ชื่อ", fixed, "| ตัดออก", dropped)
console.log("รวมอู่ที่ได้พิกัดหน้าอู่", Object.keys(out).length, "ราย")
if (problems.length) { console.log("\nต้องดูก่อน:"); for (const p of problems) console.log(" -", p) }

if (WRITE) {
  fs.writeFileSync(PINS_FILE, JSON.stringify(out, null, 1) + "\n")
  console.log("\nเขียนแล้ว", PINS_FILE, "— รีสตาร์ท dev หรือ deploy แล้วหน้าหาอู่ใกล้ที่สุดจะใช้พิกัดชุดใหม่")
} else {
  console.log("\nยังไม่เขียนของจริง ใส่ --write ถ้าผลถูกแล้ว")
}
