// ตรวจยอด "รวมสุทธิ" ของใบ DD ที่ sync มาจาก ATMS — อ่านอย่างเดียว ไม่เขียนอะไร
//   รัน: npx tsx scripts/check-ap-amounts.mts
//
// (แทน scripts/check-ap-vat.mts เดิมที่ตรวจกติกา "เดา VAT จาก factor ของใบ PO" ซึ่งเลิกใช้แล้ว
//  — อัตราภาษีเป็นของแต่ละใบ DD อ่านจากหน้า DD เท่านั้น ผู้ใช้สั่ง 13/10/2026)
//
// ตรวจ 3 อย่าง:
//   1) ครอบคลุม — ใบไหนยังไม่มี amount_net (เติมด้วย backfill_deposit_totals.py ใน api-ncac)
//   2) ความสอดคล้องในตัวเอง — grand_total + vat_amount ต้องเท่ากับ amount_net
//   3) การกระจายของอัตราภาษี + ใบที่ amount (หน้า index) ไม่เท่า grand_total (หน้า DD)
import { MongoClient } from "mongodb"
import { readFileSync } from "node:fs"
import path from "node:path"
import { apGrossOf, apNetOf, apVatOf, apVatRateOf, parseAmount } from "../lib/ap-tracking"

const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
const r2 = (n: number) => Math.round(n * 100) / 100

const c = new MongoClient(uri)
await c.connect()
const col = c.db("atms").collection("deposit_header")
const total = await col.countDocuments({})
const missing = await col.countDocuments({ amount_net: { $exists: false } })
console.log(`ใบ DD ทั้งหมด ${total.toLocaleString()} · ยังไม่มี amount_net ${missing.toLocaleString()}`
  + ` (${((missing / total) * 100).toFixed(1)}%)`)

const rows = await col.find({ amount_net: { $exists: true } }, {
  projection: { _id: 0, deposit_code: 1, amount: 1, amount_net: 1, grand_total: 1, vat_amount: 1, vat_rate: 1 },
}).toArray()

const rate = new Map<string, number>()
const bad: string[] = []
const idxDiff: string[] = []
for (const h of rows) {
  const k = apVatRateOf(h) || "(ไม่มี)"
  rate.set(k, (rate.get(k) ?? 0) + 1)
  if (Math.abs(r2(apGrossOf(h) + apVatOf(h)) - r2(apNetOf(h))) > 0.02) {
    if (bad.length < 10) bad.push(`${h.deposit_code}: ${apGrossOf(h)} + ${apVatOf(h)} ≠ ${apNetOf(h)}`)
  }
  if (Math.abs(r2(parseAmount(h.amount)) - r2(apGrossOf(h))) > 0.02) {
    if (idxDiff.length < 10) idxDiff.push(`${h.deposit_code}: index ${h.amount} vs หน้า DD ${h.grand_total}`)
  }
}
console.log("อัตราภาษีที่พบ:", [...rate].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}% = ${n.toLocaleString()}`).join(" · "))
console.log(bad.length ? `✗ ยอดไม่สอดคล้องในตัวเอง:\n   ${bad.join("\n   ")}` : "✓ grand_total + vat_amount = amount_net ทุกใบที่มีข้อมูล")
console.log(idxDiff.length ? `⚠ amount (หน้า index) ไม่เท่า grand_total (หน้า DD):\n   ${idxDiff.join("\n   ")}` : "✓ amount = grand_total ทุกใบ")
await c.close()
