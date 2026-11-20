// รัน: npx tsx scripts/check-store-withdraw-ui.ts — เช็ก parseMrRow กับแถวจริงของ ATMS
import assert from "node:assert/strict"
import { parseMrRow } from "../lib/store-withdraw/mr-row"

const a = parseMrRow({ id: 257041, name: "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041", driver: "x", driver_id: 701, mechanic: "y", mechanic_id: 478, accident: null, accident_id: null })
assert.deepEqual(a, { id: 257041, label: "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041", mrCode: "LBMR26100001" })
assert.equal(parseMrRow({ id: 9, name: "SBMR26090012 อู่นอก-ยาง : 9" })?.mrCode, "SBMR26090012")
assert.equal(parseMrRow({ id: 10, name: "ซ่อมทั่วไป : 10" })?.mrCode, null)
assert.equal(parseMrRow({ id: 0, name: "x" }), null)
assert.equal(parseMrRow({ id: 5 }), null)
console.log("ok: parseMrRow")

// ── ฟอร์มกล่อง Hub (lib/store-withdraw/hub-form) ──
import { dropHubLines, formLineKey, hubSummary, overHubStock } from "../lib/store-withdraw/hub-form"
const vend = { vendorCode: "V1", vendorName: "ร้านเอ" }
assert.equal(formLineKey({ skuId: 5, mrItemId: 9 }), "5|9|-")
assert.equal(formLineKey({ skuId: 5, mrItemId: null, hub: vend }), "5|-|V1")
assert.notEqual(formLineKey({ skuId: 5, mrItemId: 9 }), formLineKey({ skuId: 5, mrItemId: 9, hub: vend }))
assert.notEqual(formLineKey({ skuId: 5, hub: vend }), formLineKey({ skuId: 5, hub: { vendorCode: "V2" } }))
const mix = [{ skuId: 1, qty: "1", stockQty: 3 }, { skuId: 1, qty: "2", stockQty: 4, hub: vend }]
assert.deepEqual(dropHubLines(mix), [mix[0]])
assert.deepEqual(hubSummary(mix), { total: 2, hub: 1 })
assert.deepEqual(hubSummary([]), { total: 0, hub: 0 })
assert.equal(overHubStock({ qty: "5", stockQty: 4, hub: vend }), true)
assert.equal(overHubStock({ qty: "4", stockQty: 4, hub: vend }), false)
assert.equal(overHubStock({ qty: "9", stockQty: 4 }), false)          // ไม่ใช่ Hub = ไม่เตือนแบบ Hub
assert.equal(overHubStock({ qty: "9", stockQty: null, hub: vend }), false)
console.log("ok: hub-form")
