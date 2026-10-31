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
