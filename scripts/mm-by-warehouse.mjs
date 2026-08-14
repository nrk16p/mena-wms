// แยกตัวชี้วัด PR ก.ค. ตามคลังสินค้า: จำนวน PR, %มี PO, เฉลี่ยวันเปิด PO, เฉลี่ยวันรับของ, %รับแล้ว
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("./check-sku-vehicles.mjs", import.meta.url), "utf8")
const uri = src.match(/mongodb(?:\+srv)?:\/\/[^"']+/)[0]
const client = new MongoClient(uri)
await client.connect()
const atms = client.db("atms")

const parse = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "")); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null }
const chunk = (arr, fn, size = 500) => Promise.all(
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => fn(arr.slice(i * size, i * size + size)))
).then(r => r.flat())

const prs = await atms.collection("purchase_requests")
  .find({ "ใบขอสั่งซื้อ (PR)": /PR2607/ })
  .project({ "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, "คลังสินค้า": 1 })
  .toArray()
const pos = await chunk(prs.map(p => p["ใบขอสั่งซื้อ (PR)"]), ck =>
  atms.collection("purchase_orders").find({ "ใบขอสั่งซื้อ (PR)": { $in: ck } })
    .project({ "รหัส": 1, "ใบขอสั่งซื้อ (PR)": 1, "วันที่": 1, "สถานะการรับสินค้า": 1 }).toArray())
const act = pos.filter(p => !String(p["สถานะการรับสินค้า"] || "").includes("ยกเลิก"))
const dds = await chunk(act.map(p => p["รหัส"]), ck =>
  atms.collection("deposit_header").find({ purchase_order: { $in: ck } })
    .project({ purchase_order: 1, received_at: 1 }).toArray())

const firstDd = new Map()
for (const d of dds) { const dt = parse(d.received_at); if (!dt) continue
  const f = firstDd.get(d.purchase_order); if (!f || dt < f) firstDd.set(d.purchase_order, dt) }

const poByPr = new Map()
for (const p of act) { if (!poByPr.has(p["ใบขอสั่งซื้อ (PR)"])) poByPr.set(p["ใบขอสั่งซื้อ (PR)"], []); poByPr.get(p["ใบขอสั่งซื้อ (PR)"]).push(p) }

const wh = new Map()
for (const pr of prs) {
  const w = pr["คลังสินค้า"] || "ไม่ระบุ"
  if (!wh.has(w)) wh.set(w, { pr: 0, withPo: 0, po: 0, gapPo: [], gapDd: [], withDd: 0 })
  const g = wh.get(w)
  g.pr++
  const list = poByPr.get(pr["ใบขอสั่งซื้อ (PR)"])
  if (!list) continue
  g.withPo++; g.po += list.length
  const d0 = parse(pr["วันที่"])
  const firstPo = list.map(p => parse(p["วันที่"])).filter(Boolean).sort((a, b) => a - b)[0]
  if (d0 && firstPo && firstPo >= d0) g.gapPo.push((firstPo - d0) / 86400000)
  const ddDates = list.map(p => firstDd.get(p["รหัส"])).filter(Boolean).sort((a, b) => a - b)
  if (ddDates.length) { g.withDd++; if (d0 && ddDates[0] >= d0) g.gapDd.push((ddDates[0] - d0) / 86400000) }
}
const avg = (a) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length) : 0
const rows = [...wh.entries()].sort((a, b) => b[1].pr - a[1].pr)
for (const [w, g] of rows) {
  console.log(`${w} | PR ${g.pr} | มีPO ${g.withPo} (${(g.withPo / g.pr * 100).toFixed(1)}%) | PO ${g.po} | เปิดPO ${avg(g.gapPo).toFixed(1)} วัน | รับของ ${avg(g.gapDd).toFixed(1)} วัน | รับแล้ว ${(g.withDd / (g.withPo || 1) * 100).toFixed(0)}%`)
}
await client.close()
