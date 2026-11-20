// lib/store-withdraw/hub-ledger.ts — เช็กว่ายอด hub_stock = ผลรวม hub_moves ทุกคีย์ (คลัง × Sub × SKU) · อ่านอย่างเดียว ไม่เขียน
// ใช้จาก scripts/check-hub-ledger.ts (ผู้ใช้รันกับ DB จริงเอง) และเทสต์ (memory Mongo)
import type { Db } from "mongodb"

export type HubLedgerRow = { inventoryId: number; vendorCode: string; skuId: number; stock: number | null; moves: number }

const LEDGER_MAX_MS = 30_000 // ต่อคำสั่ง — ช้ากว่านี้ให้หยุด ไม่ลากคลัสเตอร์

const keyOf = (r: { inventoryId: number; vendorCode: string; skuId: number }) => `${r.inventoryId}|${r.vendorCode}|${r.skuId}`

/** คืนเฉพาะคีย์ที่ยอดไม่ตรงสมุด (รวมยอดติดลบ และคีย์ที่มีแค่ฝั่งเดียวแต่ไม่เป็น 0) */
export async function hubLedgerMismatches(db: Db): Promise<{ checked: number; mismatches: HubLedgerRow[] }> {
  const sums = await db.collection("hub_moves").aggregate<{ _id: { inventoryId: number; vendorCode: string; skuId: number }; qty: number }>(
    [
      { $project: { _id: 0, inventoryId: 1, vendorCode: 1, skuId: 1, qty: 1 } },
      { $group: { _id: { inventoryId: "$inventoryId", vendorCode: "$vendorCode", skuId: "$skuId" }, qty: { $sum: "$qty" } } },
    ],
    { maxTimeMS: LEDGER_MAX_MS },
  ).toArray()
  const stock = await db.collection("hub_stock")
    .find({}, { projection: { _id: 0, inventoryId: 1, vendorCode: 1, skuId: 1, qty: 1 }, maxTimeMS: LEDGER_MAX_MS })
    .toArray() as unknown as { inventoryId: number; vendorCode: string; skuId: number; qty: number }[]

  const rows = new Map<string, HubLedgerRow>()
  for (const s of sums) rows.set(keyOf(s._id), { ...s._id, stock: null, moves: s.qty })
  for (const s of stock) {
    const k = keyOf(s)
    const r = rows.get(k) ?? { inventoryId: s.inventoryId, vendorCode: s.vendorCode, skuId: s.skuId, stock: null, moves: 0 }
    r.stock = s.qty
    rows.set(k, r)
  }
  const mismatches = [...rows.values()].filter((r) => (r.stock ?? 0) !== r.moves || (r.stock ?? 0) < 0)
  mismatches.sort((a, b) => a.inventoryId - b.inventoryId || a.vendorCode.localeCompare(b.vendorCode) || a.skuId - b.skuId)
  return { checked: rows.size, mismatches }
}
