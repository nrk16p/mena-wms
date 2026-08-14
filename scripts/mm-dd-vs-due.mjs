// เทียบวันรับของจริง (deposit_header.received_at) กับกำหนดส่งสินค้าใน PO
// ขอบเขต: PO ที่เปิดจาก PR เดือน ก.ค. 2026 (ไม่รวมยกเลิก)
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
const uri = src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)[0]
const client = new MongoClient(uri)
await client.connect()
const atms = client.db("atms")

const parseDMY = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "").trim())
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null
}
const chunk = (arr, fn, size = 500) => Promise.all(
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => fn(arr.slice(i * size, i * size + size)))
).then(r => r.flat())

const prs = await atms.collection("purchase_requests")
  .find({ "ใบขอสั่งซื้อ (PR)": /PR2607/ }).project({ "ใบขอสั่งซื้อ (PR)": 1 }).toArray()
const prCodes = prs.map(p => p["ใบขอสั่งซื้อ (PR)"])

const pos = await chunk(prCodes, (ck) =>
  atms.collection("purchase_orders").find({ "ใบขอสั่งซื้อ (PR)": { $in: ck } })
    .project({ "รหัส": 1, "วันที่": 1, "กำหนดส่งสินค้า": 1, "สถานะการรับสินค้า": 1 }).toArray()
)
const activePos = pos.filter(p => !String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก"))
const poCodes = activePos.map(p => p["รหัส"])

const dds = await chunk(poCodes, (ck) =>
  atms.collection("deposit_header").find({ purchase_order: { $in: ck } })
    .project({ purchase_order: 1, received_at: 1 }).toArray()
)
const lastDdByPo = new Map()  // ใช้ DD ล่าสุด = รับครบ
const firstDdByPo = new Map()
for (const d of dds) {
  const dt = parseDMY(d.received_at)
  if (!dt) continue
  const f = firstDdByPo.get(d.purchase_order); if (!f || dt < f) firstDdByPo.set(d.purchase_order, dt)
  const l = lastDdByPo.get(d.purchase_order); if (!l || dt > l) lastDdByPo.set(d.purchase_order, dt)
}

let hasDue = 0, noDue = 0, received = 0
let early = 0, onDate = 0, late = 0
const lateDays = [], allDiffs = []
const lateBuckets = { d1_3: 0, d4_7: 0, gt7: 0 }
for (const p of activePos) {
  const due = parseDMY(p["กำหนดส่งสินค้า"])
  if (!due) { noDue++; continue }
  hasDue++
  const dd = firstDdByPo.get(p["รหัส"])
  if (!dd) continue
  received++
  const diff = Math.round((dd - due) / 86400000)  // + = สาย
  allDiffs.push(diff)
  if (diff < 0) early++
  else if (diff === 0) onDate++
  else {
    late++
    lateDays.push(diff)
    if (diff <= 3) lateBuckets.d1_3++
    else if (diff <= 7) lateBuckets.d4_7++
    else lateBuckets.gt7++
  }
}
lateDays.sort((a, b) => a - b)
const avgLate = lateDays.reduce((s, d) => s + d, 0) / (lateDays.length || 1)
const medLate = lateDays[Math.floor(lateDays.length / 2)] ?? 0
const pct = (n) => (n / received * 100).toFixed(1)

console.log(`PO จาก PR ก.ค. (ไม่รวมยกเลิก): ${activePos.length} · มีกำหนดส่ง ${hasDue} · ไม่มีกำหนดส่ง ${noDue}`)
console.log(`PO ที่รับของแล้วและมีกำหนดส่ง: ${received}`)
console.log(`  รับก่อนกำหนด : ${early} (${pct(early)}%)`)
console.log(`  ตรงวันกำหนด  : ${onDate} (${pct(onDate)}%)`)
console.log(`  รับช้ากว่ากำหนด: ${late} (${pct(late)}%) — เฉลี่ยช้า ${avgLate.toFixed(1)} วัน · มัธยฐาน ${medLate} วัน`)
console.log(`  ช้า 1-3 วัน ${lateBuckets.d1_3} · 4-7 วัน ${lateBuckets.d4_7} · >7 วัน ${lateBuckets.gt7}`)
console.log(`ตรงหรือเร็วกว่ากำหนดรวม: ${early + onDate} (${pct(early + onDate)}%)`)

// เผื่ออยากรู้: วัดแบบ "รับครบ" (DD ล่าสุด) ต่างจาก DD แรกแค่ไหน
let lateLast = 0, recvLast = 0
for (const p of activePos) {
  const due = parseDMY(p["กำหนดส่งสินค้า"])
  const dd = lastDdByPo.get(p["รหัส"])
  if (!due || !dd) continue
  recvLast++
  if (dd > due) lateLast++
}
console.log(`\n(วัดจาก DD ล่าสุด/รับครบ: ช้า ${lateLast}/${recvLast} = ${(lateLast / recvLast * 100).toFixed(1)}%)`)
await client.close()
