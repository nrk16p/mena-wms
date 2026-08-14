// รวมตัวเลขจริงเดือน ก.ค. 2026 สำหรับ MM slide (อ่านอย่างเดียว, bounded ด้วยรหัสเดือน 2607)
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
const uri = src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)[0]
const client = new MongoClient(uri)
await client.connect()
const atms = client.db("atms")
const md = client.db("master_data")

const parseDMY = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim())
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null
}
const baht = (n) => Math.round(n).toLocaleString("en-US")

// ── 1) PO ก.ค. ──
const pos = await atms.collection("purchase_orders")
  .find({ "รหัส": /PO2607/ })
  .project({ "รหัส": 1, "รวม": 1, "วันที่": 1, "สถานะการรับสินค้า": 1, "ใบขอสั่งซื้อ (PR)": 1, "แผนก": 1 })
  .toArray()
const cancelled = pos.filter(p => String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก"))
const activePos = pos.filter(p => !String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก"))
const poValue = activePos.reduce((s, p) => s + (Number(p["รวม"]) || 0), 0)
const received = activePos.filter(p => String(p["สถานะการรับสินค้า"]).includes("ทั้งหมด")).length
console.log(`PO ก.ค.: ทั้งหมด ${pos.length} · ใช้งาน ${activePos.length} · ยกเลิก ${cancelled.length}`)
console.log(`มูลค่า PO (ไม่รวมยกเลิก): ฿${baht(poValue)} · รับของครบแล้ว ${received} ใบ`)

// ── 2) PR ก.ค. + มูลค่า ──
const prs = await atms.collection("purchase_requests")
  .find({ "ใบขอสั่งซื้อ (PR)": /PR2607/ })
  .project({ "ใบขอสั่งซื้อ (PR)": 1, "รวม": 1, "วันที่": 1, "แผนก": 1 })
  .toArray()
const prValue = prs.reduce((s, p) => s + (Number(p["รวม"]) || 0), 0)
console.log(`\nPR ก.ค.: ${prs.length} ใบ · มูลค่า ฿${baht(prValue)}`)
// PR ก.ค. ที่มี PO แล้ว (PO อาจออกเดือนถัดไป — เช็คจาก PO ทุกเดือนที่อ้าง PR2607)
const posOfJulPr = await atms.collection("purchase_orders")
  .find({ "ใบขอสั่งซื้อ (PR)": /PR2607/ })
  .project({ "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, "สถานะการรับสินค้า": 1 })
  .toArray()
const prWithPo = new Set(posOfJulPr.filter(p => !String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก")).map(p => p["ใบขอสั่งซื้อ (PR)"]))
console.log(`PR ก.ค. ที่เปิด PO แล้ว: ${prWithPo.size}/${prs.length} (${(prWithPo.size / prs.length * 100).toFixed(1)}%)`)

// ── 3) Cycle time PR→PO (PO ก.ค. ที่อ้าง PR ใดๆ) ──
const prDates = new Map()
const refPrCodes = [...new Set(activePos.map(p => p["ใบขอสั่งซื้อ (PR)"]).filter(Boolean))]
for (let i = 0; i < refPrCodes.length; i += 500) {
  const chunk = refPrCodes.slice(i, i + 500)
  const rows = await atms.collection("purchase_requests")
    .find({ "ใบขอสั่งซื้อ (PR)": { $in: chunk } })
    .project({ "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1 })
    .toArray()
  for (const r of rows) prDates.set(r["ใบขอสั่งซื้อ (PR)"], parseDMY(r["วันที่"]))
}
const gaps = []
for (const p of activePos) {
  const prD = prDates.get(p["ใบขอสั่งซื้อ (PR)"])
  const poD = parseDMY(p["วันที่"])
  if (prD && poD && poD >= prD) gaps.push((poD - prD) / 86400000)
}
gaps.sort((a, b) => a - b)
const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length
const med = gaps[Math.floor(gaps.length / 2)]
const within3 = gaps.filter(g => g <= 3).length
console.log(`\nCycle PR→PO (n=${gaps.length}): เฉลี่ย ${avg.toFixed(1)} วัน · มัธยฐาน ${med} วัน · ภายใน 3 วัน ${(within3 / gaps.length * 100).toFixed(0)}%`)

// ── 4) แผนก Top 5 ตามมูลค่า PO ──
const byDept = {}
for (const p of activePos) byDept[p["แผนก"] || "—"] = (byDept[p["แผนก"] || "—"] || 0) + (Number(p["รวม"]) || 0)
const topDept = Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log("\nTop 5 แผนก (มูลค่า PO):")
for (const [d, v] of topDept) console.log(`  ${d}: ฿${baht(v)}`)

// ── 5) เทียบราคากลาง: PO items ก.ค. vs price_benchmark ──
const items = await atms.collection("purchase_order_items")
  .find({ po_code: /PO2607/ })
  .project({ po_code: 1, sku: 1, group: 1, unit_price: 1, amount: 1, total: 1 })
  .toArray()
const activeSet = new Set(activePos.map(p => p["รหัส"]))
const actItems = items.filter(i => activeSet.has(i.po_code))
const skus = [...new Set(actItems.map(i => i.sku).filter(Boolean))]
// benchmark ต่อ SKU = weighted median ของ benchmark_price ข้าม supplier (snapshot ล่าสุด)
const benchRows = await atms.collection("price_benchmark")
  .find({ sku: { $in: skus } })
  .project({ sku: 1, snapshot_month: 1, benchmark_price: 1, total_records: 1 })
  .toArray()
const bySku = {}
for (const b of benchRows) {
  ;(bySku[b.sku] ??= []).push(b)
}
const benchOf = {}
for (const [sku, rows] of Object.entries(bySku)) {
  const latest = rows.map(r => r.snapshot_month).sort().at(-1)
  const cur = rows.filter(r => r.snapshot_month === latest)
  const sorted = cur.map(r => ({ p: r.benchmark_price, w: r.total_records || 1 })).sort((a, b) => a.p - b.p)
  const totW = sorted.reduce((s, r) => s + r.w, 0)
  let acc = 0, medP = sorted[0]?.p
  for (const r of sorted) { acc += r.w; if (acc >= totW / 2) { medP = r.p; break } }
  benchOf[sku] = medP
}
let over = 0, overVal = 0, matched = 0, matchedVal = 0
const overByGroup = {}
for (const i of actItems) {
  const b = benchOf[i.sku]
  if (!b || !i.unit_price) continue
  matched++; matchedVal += Number(i.total) || 0
  if (i.unit_price > b) {
    over++
    const excess = (i.unit_price - b) * (Number(i.amount) || 1)
    overVal += excess
    overByGroup[i.group || "—"] = (overByGroup[i.group || "—"] || 0) + excess
  }
}
console.log(`\nเทียบราคากลาง: PO items ก.ค. ${actItems.length} รายการ · เทียบได้ ${matched} (${(matched / actItems.length * 100).toFixed(0)}%)`)
console.log(`ซื้อแพงกว่าราคากลาง ${over} รายการ · ส่วนต่างรวม ฿${baht(overVal)}`)
console.log("Top กลุ่มส่วนต่าง:", Object.entries(overByGroup).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g, v]) => `${g} ฿${baht(v)}`).join(" · "))

// ── 6) repair_external ──
const reps = await md.collection("repair_external")
  .find({})
  .project({ status: 1, jobType: 1, offerPrice: 1, negotiatedPrice: 1, dueDate: 1, receivedDate: 1, completedDate: 1, prCode: 1 })
  .toArray()
const DONE = new Set(["รถเสร็จ", "รถเสร็จ(ไม่มี PR)", "ลงคันเสร็จ"])
const active = reps.filter(r => !DONE.has(r.status))
const done = reps.filter(r => DONE.has(r.status))
const today = new Date().toISOString().slice(0, 10)
const overdue = active.filter(r => r.dueDate && r.dueDate < today).length
let negoSum = 0, negoN = 0
for (const r of reps) {
  const o = Number(r.offerPrice) || 0, ng = Number(r.negotiatedPrice) || 0
  if (o > 0 && ng > 0 && ng < o) { negoSum += o - ng; negoN++ }
}
const doneJul = done.filter(r => (r.completedDate || "").startsWith("2026-07")).length
console.log(`\nซ่อมอู่นอก: ทั้งหมด ${reps.length} · กำลังดำเนินการ ${active.length} · ปิดงานแล้ว ${done.length} (ก.ค. ${doneJul}) · เลยกำหนด ${overdue}`)
console.log(`ต่อรองราคา: ${negoN} งาน ลดได้ ฿${baht(negoSum)}`)
const stCount = {}
for (const r of active) stCount[r.status] = (stCount[r.status] || 0) + 1
console.log("สถานะค้าง:", Object.entries(stCount).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · "))

// ── 7) order_tracking ──
const ots = await md.collection("order_tracking").find({}).project({ status: 1, createdAt: 1, dept: 1 }).toArray()
const otSt = {}
for (const o of ots) otSt[o.status || "—"] = (otSt[o.status || "—"] || 0) + 1
console.log(`\nติดตามคำขอเปิด PO: ${ots.length} เรื่อง ·`, Object.entries(otSt).map(([s, n]) => `${s} ${n}`).join(" · "))

await client.close()
