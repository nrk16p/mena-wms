// Slide 1 ใหม่ — ตัวเลขเฉพาะ PR ที่เปิดเดือน ก.ค. 2026 (PR2607) เท่านั้น
// มูลค่าเทียบ PR vs PO ใช้ยอดจาก items = ราคาก่อน VAT
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
const baht = (n) => Math.round(n).toLocaleString("en-US")
const chunk = (arr, fn, size = 500) => Promise.all(
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => fn(arr.slice(i * size, i * size + size)))
).then(r => r.flat())

// ── PR เดือน ก.ค. ──
const prs = await atms.collection("purchase_requests")
  .find({ "ใบขอสั่งซื้อ (PR)": /PR2607/ })
  .project({ "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, "รวม": 1 })
  .toArray()
const prCodes = prs.map(p => p["ใบขอสั่งซื้อ (PR)"])
const prDate = new Map(prs.map(p => [p["ใบขอสั่งซื้อ (PR)"], parseDMY(p["วันที่"])]))
console.log(`PR ก.ค.: ${prs.length} ใบ`)

// ── PO ที่เปิดจาก PR ก.ค. (เดือนไหนก็ได้ ไม่รวมยกเลิก) ──
const pos = await chunk(prCodes, (ck) =>
  atms.collection("purchase_orders")
    .find({ "ใบขอสั่งซื้อ (PR)": { $in: ck } })
    .project({ "รหัส": 1, "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, "สถานะการรับสินค้า": 1 })
    .toArray()
)
const activePos = pos.filter(p => !String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก"))
const cancelled = pos.length - activePos.length
const poByPr = new Map()
for (const p of activePos) {
  const pr = p["ใบขอสั่งซื้อ (PR)"]
  if (!poByPr.has(pr)) poByPr.set(pr, [])
  poByPr.get(pr).push(p)
}
const prWithPo = poByPr.size
console.log(`PO จาก PR ก.ค.: ${activePos.length} ใบ (ยกเลิก ${cancelled}) · PR ที่มี PO: ${prWithPo}/${prs.length} (${(prWithPo / prs.length * 100).toFixed(1)}%)`)
console.log(`เฉลี่ย PO ต่อ PR (เฉพาะที่มี PO): ${(activePos.length / prWithPo).toFixed(2)}`)

// ── ระยะเวลาเปิด PO (PR → PO แรกของแต่ละ PR) ──
const gaps = []
for (const [pr, list] of poByPr) {
  const d0 = prDate.get(pr)
  const firstPo = list.map(p => parseDMY(p["วันที่"])).filter(Boolean).sort((a, b) => a - b)[0]
  if (d0 && firstPo && firstPo >= d0) gaps.push((firstPo - d0) / 86400000)
}
gaps.sort((a, b) => a - b)
const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
const medGap = gaps[Math.floor(gaps.length / 2)]
const within3 = gaps.filter(g => g <= 3).length / gaps.length * 100
console.log(`PR→PO แรก (n=${gaps.length}): เฉลี่ย ${avgGap.toFixed(1)} วัน · มัธยฐาน ${medGap} · ≤3วัน ${within3.toFixed(0)}%`)

// ── มูลค่า PR vs PO ก่อน VAT (จาก items) เฉพาะ PR ที่มี PO ──
const prsMatched = [...poByPr.keys()]
const poCodes = activePos.map(p => p["รหัส"])
const prItems = await chunk(prsMatched, (ck) =>
  atms.collection("purchase_request_items").find({ pr_code: { $in: ck } })
    .project({ pr_code: 1, total: 1 }).toArray()
)
const poItems = await chunk(poCodes, (ck) =>
  atms.collection("purchase_order_items").find({ po_code: { $in: ck } })
    .project({ po_code: 1, total: 1 }).toArray()
)
const prSum = new Map()
for (const i of prItems) prSum.set(i.pr_code, (prSum.get(i.pr_code) || 0) + (Number(i.total) || 0))
const poSumByCode = new Map()
for (const i of poItems) poSumByCode.set(i.po_code, (poSumByCode.get(i.po_code) || 0) + (Number(i.total) || 0))

let nUp = 0, nEq = 0, nDown = 0, vPr = 0, vPo = 0, vUp = 0, vDown = 0, compared = 0
for (const [pr, list] of poByPr) {
  const a = prSum.get(pr)
  if (a === undefined) continue
  const b = list.reduce((s, p) => s + (poSumByCode.get(p["รหัส"]) || 0), 0)
  compared++; vPr += a; vPo += b
  const diff = b - a
  if (Math.abs(diff) <= 0.5) nEq++
  else if (diff > 0) { nUp++; vUp += diff }
  else { nDown++; vDown += -diff }
}
console.log(`\nเทียบมูลค่าก่อน VAT (PR ที่มี PO และมี items ทั้งคู่: ${compared})`)
console.log(`  มูลค่า PR รวม ฿${baht(vPr)} → PO รวม ฿${baht(vPo)} (สุทธิ ${vPo >= vPr ? "+" : "-"}฿${baht(Math.abs(vPo - vPr))})`)
console.log(`  PO > PR: ${nUp} ใบ (+฿${baht(vUp)}) · เท่ากัน: ${nEq} ใบ · PO < PR: ${nDown} ใบ (-฿${baht(vDown)})`)

// ── Workload ต่อวัน ──
const prDays = new Set(prs.map(p => p["วันที่"]).filter(Boolean))
const julPos = await atms.collection("purchase_orders")
  .find({ "รหัส": /PO2607/ }).project({ "วันที่": 1, "สถานะการรับสินค้า": 1 }).toArray()
const julPoDays = new Set(julPos.map(p => p["วันที่"]).filter(Boolean))
console.log(`\nWorkload: PR ${prs.length} ใบ / ${prDays.size} วันทำงาน = ${(prs.length / prDays.size).toFixed(1)} ใบ/วัน (ปฏิทิน ${(prs.length / 31).toFixed(1)})`)
console.log(`          PO เปิดในก.ค. ${julPos.length} ใบ / ${julPoDays.size} วัน = ${(julPos.length / julPoDays.size).toFixed(1)} ใบ/วัน (ปฏิทิน ${(julPos.length / 31).toFixed(1)})`)

// ── ระยะเวลารับ DD หลังเปิด PR ──
const dds = await chunk(poCodes, (ck) =>
  atms.collection("deposit_header").find({ purchase_order: { $in: ck } })
    .project({ purchase_order: 1, received_at: 1 }).toArray()
)
const firstDdByPo = new Map()
for (const d of dds) {
  const dt = parseDMY(d.received_at)
  if (!dt) continue
  const cur = firstDdByPo.get(d.purchase_order)
  if (!cur || dt < cur) firstDdByPo.set(d.purchase_order, dt)
}
const ddGaps = []
let prWithDd = 0
for (const [pr, list] of poByPr) {
  const d0 = prDate.get(pr)
  const ddDates = list.map(p => firstDdByPo.get(p["รหัส"])).filter(Boolean)
  if (!d0 || !ddDates.length) continue
  prWithDd++
  const first = ddDates.sort((a, b) => a - b)[0]
  if (first >= d0) ddGaps.push((first - d0) / 86400000)
}
ddGaps.sort((a, b) => a - b)
const avgDd = ddGaps.reduce((s, g) => s + g, 0) / ddGaps.length
const medDd = ddGaps[Math.floor(ddGaps.length / 2)]
console.log(`\nรับ DD: PR ที่มีการรับของแล้ว ${prWithDd}/${prWithPo} (${(prWithDd / prWithPo * 100).toFixed(0)}%)`)
console.log(`  PR → DD แรก (n=${ddGaps.length}): เฉลี่ย ${avgDd.toFixed(1)} วัน · มัธยฐาน ${medDd} วัน · ≤7วัน ${(ddGaps.filter(g => g <= 7).length / ddGaps.length * 100).toFixed(0)}%`)

await client.close()
