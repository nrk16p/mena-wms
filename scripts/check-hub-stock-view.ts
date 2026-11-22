// รัน: npx tsx scripts/check-hub-stock-view.ts
import assert from "node:assert/strict"
import { distinctVendors, filterStockRows, showSubColumn, stockLevel, summarizeStock } from "../lib/store-withdraw/hub-stock-view"

const rows = [
  { vendorCode: "B", skuCode: "S10", skuName: "ผ้าเบรก", qty: 5 },
  { vendorCode: "A", skuCode: "S2", skuName: "ไส้กรอง", qty: 0 },
  { vendorCode: "A", skuCode: "S1", skuName: "น็อต", qty: 1 },
  { vendorCode: "B", skuCode: "S3", skuName: "สายพาน", qty: 2.5 },
]
const names = { A: "อู่เอ", B: "อู่บี" }
assert.equal(stockLevel(0), "out"); assert.equal(stockLevel(-2), "out"); assert.equal(stockLevel(1), "one"); assert.equal(stockLevel(1.5), "ok")
assert.deepEqual(summarizeStock(rows), { count: 4, qty: 8.5, low: 2 })
assert.equal(summarizeStock([{ ...rows[1], active: false }, rows[2]]).low, 1)   // แถวปิดใช้ไม่นับใกล้หมด
assert.deepEqual(summarizeStock([]), { count: 0, qty: 0, low: 0 })
assert.equal(summarizeStock([{ ...rows[0], qty: -3 }]).qty, 0)
assert.deepEqual(filterStockRows(rows, { q: "", vendor: "", names, sort: "code" }).map((r) => r.skuCode), ["S1", "S2", "S3", "S10"])
assert.deepEqual(filterStockRows(rows, { q: "", vendor: "", names, sort: "qtyAsc" }).map((r) => r.skuCode), ["S2", "S1", "S3", "S10"])
assert.deepEqual(filterStockRows(rows, { q: "", vendor: "A", names, sort: "code" }).map((r) => r.skuCode), ["S1", "S2"])
assert.deepEqual(filterStockRows(rows, { q: "อู่บี", vendor: "", names, sort: "code" }).map((r) => r.skuCode), ["S3", "S10"])
assert.deepEqual(summarizeStock(filterStockRows(rows, { q: "", vendor: "B", names, sort: "code" })), { count: 2, qty: 7.5, low: 0 })
assert.deepEqual(distinctVendors(rows), ["A", "B"])
assert.equal(showSubColumn(2, ""), true); assert.equal(showSubColumn(2, "A"), false); assert.equal(showSubColumn(1, ""), false)
console.log("check-hub-stock-view: ok")
