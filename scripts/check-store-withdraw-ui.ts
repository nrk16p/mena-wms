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

// ── ช่องค้นอะไหล่ช่องเดียว (lib/store-withdraw/parts-search) ──
import { HUB_GROUP_TITLE, STOCK_GROUP_TITLE, partsDropdown } from "../lib/store-withdraw/parts-search"
const src = <T,>(rows: T[], loading = false, error = "") => ({ rows, loading, error })
const kinds = (r: { groups: { kind: string }[] }) => r.groups.map((g) => g.kind)
// ไม่เปิด Hub = กลุ่มเดียว ไม่มีหัว (เหมือนช่องเดิม)
const off = partsDropdown(null, src([1, 2]))
assert.deepEqual(kinds(off), ["stock"]); assert.equal(off.groups[0].title, null); assert.equal(off.empty, false)
assert.equal(partsDropdown(null, src([])).empty, true)
assert.equal(partsDropdown(null, src([], true)).empty, false)            // ยังค้นอยู่ ไม่ใช่ "ไม่เจอ"
assert.equal(partsDropdown(null, src([], false, "พัง")).empty, false)
// เปิด Hub: Hub ขึ้นก่อน มีหัวกลุ่ม
const both = partsDropdown(src(["h"]), src([1]))
assert.deepEqual(kinds(both), ["hub", "stock"])
assert.deepEqual(both.groups.map((g) => g.title), [HUB_GROUP_TITLE, STOCK_GROUP_TITLE])
assert.deepEqual(kinds(partsDropdown(src([]), src([1]))), ["stock"])      // Hub ไม่เจอ = ซ่อนกลุ่ม Hub
assert.deepEqual(kinds(partsDropdown(src(["h"]), src([]))), ["hub"])
assert.deepEqual(kinds(partsDropdown(src([], false, "x"), src([]))), ["hub"])       // Hub error ยังโชว์
assert.equal(partsDropdown(src([]), src([])).empty, true)
assert.equal(partsDropdown(src([]), src([], true)).empty, false)
// เปิด Hub: ฝั่งใดฝั่งหนึ่งยังค้นอยู่ = ยังไม่โชว์แถว (กันแถวกระโดด) โชว์ "กำลังค้น" รวม
const wait1 = partsDropdown(src([], true), src([1]))
assert.deepEqual(kinds(wait1), []); assert.equal(wait1.loading, true); assert.equal(wait1.empty, false)
const wait2 = partsDropdown(src(["h"]), src([1], true))
assert.deepEqual(kinds(wait2), []); assert.equal(wait2.loading, true)
assert.equal(partsDropdown(src(["h"]), src([1])).loading, false)
assert.equal(partsDropdown(null, src([], true)).loading, false)
console.log("ok: parts-search")
