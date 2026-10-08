// ตรวจกติกา "รวมสุทธิ" ของใบ DD กับข้อมูลจริง (อ่านอย่างเดียว)
//   รัน: npx tsx scripts/check-ap-vat.mts [YYYY-MM ...]   (ไม่ใส่ = ก.ย. + ต.ค. 2569)
// เช็ก 3 อย่าง
//   1) apVatFactor ให้ค่าแค่ 1 หรือ 1.07 (ไม่มี PO ที่อัตราอื่น)
//   2) ใบที่รับครบในงวดเดียว → รวมสุทธิ = purchase_orders.รวม พอดี
//   3) PO ที่รับหลายงวด → ผลรวมรวมสุทธิของทุกงวด ไม่เกิน PO.รวม (+ปัดเศษ)
import { MongoClient } from "mongodb"
import fs from "node:fs"
import { apNetAmount, apVatFactor, parseAmount } from "../lib/ap-tracking"

const uri = (process.env.MONGO_URI ?? fs.readFileSync(".env", "utf8").match(/^MONGO_URI=(.*)$/m)?.[1] ?? "")
  .trim().replace(/^"|"$/g, "")
const months = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-09", "2026-10"]
const mRe = months.map((m) => `0?${Number(m.split("-")[1])}/${m.split("-")[0]}`).join("|")

const c = new MongoClient(uri)
await c.connect()
const atms = c.db("atms")
const heads = await atms.collection("deposit_header").find(
  { received_at: { $regex: new RegExp(`^\\d{1,2}/(${mRe})(?:\\s.*)?$`) } },
  { projection: { _id: 0, deposit_code: 1, purchase_order: 1, amount: 1 } }).toArray()
const poCodes = [...new Set(heads.map((h) => String(h.purchase_order ?? "").trim()).filter(Boolean))]
const pos = await atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } },
  { projection: { _id: 0, "รหัส": 1, "รวม": 1 } }).toArray()
const subs = await atms.collection("purchase_order_items").aggregate(
  [{ $match: { po_code: { $in: poCodes } } }, { $group: { _id: "$po_code", sub: { $sum: "$total" } } }]).toArray()
await c.close()

const subBy = new Map(subs.map((r) => [String(r._id), parseAmount(r.sub)]))
const totBy = new Map(pos.map((p) => [String(p["รหัส"]), parseAmount(p["รวม"])]))
const ddPerPo = new Map<string, number>()
for (const h of heads) {
  const po = String(h.purchase_order ?? "").trim()
  if (po) ddPerPo.set(po, (ddPerPo.get(po) ?? 0) + 1)
}

let oddFactor = 0, single = 0, singleOk = 0, multiPo = 0, multiOk = 0, noPo = 0
const bad: string[] = []
for (const code of poCodes) {
  const f = apVatFactor(totBy.get(code) ?? 0, subBy.get(code) ?? 0)
  const raw = (totBy.get(code) ?? 0) / (subBy.get(code) || 1)
  if (f === 1 && Math.abs(raw - 1) > 0.0005) oddFactor++      // อัตราไม่เข้าทั้ง 1.00/1.07 → ถอยเป็น 1
}
const netByPo = new Map<string, number>()
for (const h of heads) {
  const po = String(h.purchase_order ?? "").trim()
  if (!po) { noPo++; continue }
  const net = apNetAmount(parseAmount(h.amount), apVatFactor(totBy.get(po) ?? 0, subBy.get(po) ?? 0) > 1)
  netByPo.set(po, Math.round(((netByPo.get(po) ?? 0) + net) * 100) / 100)
  if ((ddPerPo.get(po) ?? 0) === 1) {
    single++
    if (Math.abs(net - (totBy.get(po) ?? 0)) <= 0.02) singleOk++
    else if (bad.length < 10) bad.push(`${h.deposit_code} net ${net} vs PO ${totBy.get(po)} (รับไม่ครบ/ข้อมูลเพี้ยน)`)
  }
}
for (const [po, n] of ddPerPo) {
  if (n < 2) continue
  multiPo++
  if ((netByPo.get(po) ?? 0) <= (totBy.get(po) ?? 0) + 0.02) multiOk++
  else if (bad.length < 10) bad.push(`${po} ผลรวมงวด ${netByPo.get(po)} > PO ${totBy.get(po)}`)
}
console.log(`เดือน ${months.join(", ")} · DD ${heads.length} ใบ (ไม่มี PO ${noPo}) · PO ${poCodes.length} ใบ`)
console.log(`อัตราไม่เข้าทั้ง 1.00/1.07 (ถอยเป็น 1): ${oddFactor} PO`)
console.log(`รับงวดเดียว: ${singleOk}/${single} ใบ รวมสุทธิ = PO.รวม พอดี`)
console.log(`รับหลายงวด: ${multiOk}/${multiPo} PO ผลรวมทุกงวดไม่เกิน PO.รวม`)
if (bad.length) console.log("ตัวอย่างที่ไม่ตรง:\n  " + bad.join("\n  "))
