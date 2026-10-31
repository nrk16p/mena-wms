// scripts/check-store-withdraw-core.ts
// รัน: STORE_ATMS_CRED_KEY=$(openssl rand -base64 32) npx tsx scripts/check-store-withdraw-core.ts
import assert from "node:assert/strict"
import { nextStatus, queueSort, issueLines, validateLineEdit, returnableQty, formatNo, waitMinutes } from "../lib/store-withdraw/core"
import { encryptSecret, decryptSecret } from "../lib/store-withdraw/crypto"
import type { SwLine, SwRequest } from "../lib/store-withdraw/types"

const eq = assert.deepEqual
const ok = (v: unknown, m?: string) => assert.ok(v, m)

function line(p: Partial<SwLine> = {}): SwLine {
  return { skuId: 1, skuCode: "A", skuName: "น็อต", requestedQty: 2, issuedQty: null, short: false, returnedQty: 0, mrItemId: null, mrItemLabel: null, serialNoId: null, remark: "", ...p }
}
function r(no: string, urgent: boolean, hhmm: string): SwRequest {
  const at = new Date(`2026-10-31T${hhmm}:00+07:00`)
  return { no, kind: "stock", status: "NEW", inventoryId: 1, inventoryName: "", pickToId: 1, pickToName: "", plate: "", mrCode: null, urgent, remark: "", lines: [], requestedBy: { email: "", name: "", via: "web" }, claimedBy: null, rejectReason: null, atms: { gmId: null, done: [], approved: false, code: null, error: null, needCreds: false, lastCheckAt: null, drift: null }, returns: [], createdAt: at, updatedAt: at }
}

eq(nextStatus({ status: "NEW", kind: "stock" }, "claim"), "PREPARING")
eq(nextStatus({ status: "PREPARING", kind: "stock" }, "ready"), "READY")
eq(nextStatus({ status: "READY", kind: "stock" }, "issue"), "ISSUING")
eq(nextStatus({ status: "NEW", kind: "stock" }, "issue"), null)
eq(nextStatus({ status: "NEW", kind: "cutoff" }, "issue"), "ISSUING")
eq(nextStatus({ status: "ISSUE_FAILED", kind: "stock" }, "issue"), "ISSUING")
eq(nextStatus({ status: "ISSUING", kind: "stock" }, "issued"), "ISSUED")
eq(nextStatus({ status: "ISSUING", kind: "stock" }, "issueFailed"), "ISSUE_FAILED")
eq(nextStatus({ status: "ISSUED", kind: "stock" }, "receive"), "RECEIVED")
eq(nextStatus({ status: "ISSUED", kind: "cutoff" }, "receive"), null)
for (const s of ["NEW", "PREPARING", "READY"] as const) eq(nextStatus({ status: s, kind: "stock" }, "reject"), "REJECTED")
eq(nextStatus({ status: "ISSUING", kind: "stock" }, "reject"), null)
eq(nextStatus({ status: "NEW", kind: "stock" }, "cancel"), "CANCELLED")
eq(nextStatus({ status: "PREPARING", kind: "stock" }, "cancel"), null)

eq(queueSort([r("a", false, "10:00"), r("b", true, "10:30"), r("c", false, "09:00")]).map(x => x.no), ["b", "c", "a"])
const inp = [r("a", false, "10:00"), r("b", true, "10:30")]
queueSort(inp); eq(inp.map(x => x.no), ["a", "b"]) // ไม่แก้อาร์เรย์เดิม

eq(issueLines([line(), line({ issuedQty: 0 }), line({ issuedQty: 1 }), line({ requestedQty: 0 })]).map(x => x.index), [0, 2])

eq(validateLineEdit(line({ requestedQty: 2 }), 3), "จ่ายได้ไม่เกินที่ขอ (2)")
eq(validateLineEdit(line({ requestedQty: 2 }), -1), "จำนวนติดลบไม่ได้")
eq(validateLineEdit(line({ requestedQty: 2 }), 2), null)
eq(validateLineEdit(line({ requestedQty: 2 }), 0), null)

eq(returnableQty(line({ issuedQty: 4, returnedQty: 1 }), 2), 1)
eq(returnableQty(line({ issuedQty: 4, returnedQty: 4 }), 2), 0)
eq(returnableQty(line({ issuedQty: null, requestedQty: 3 }), 0), 3)

eq(formatNo("2610", 12), "SW-2610-012")
eq(formatNo("2610", 1234), "SW-2610-1234")

eq(waitMinutes(new Date("2026-10-31T10:00:00Z"), new Date("2026-10-31T10:05:59Z")), 5)
eq(waitMinutes(new Date("2026-10-31T10:10:00Z"), new Date("2026-10-31T10:00:00Z")), 0)

eq(decryptSecret(encryptSecret("pw-ทดสอบ")), "pw-ทดสอบ")
ok(encryptSecret("x") !== encryptSecret("x"))
const tok = encryptSecret("secret")
eq(tok.split(":").length, 4); eq(tok.startsWith("v1:"), true)
const parts = tok.split(":"); const ct = Buffer.from(parts[3], "base64"); ct[0] ^= 1; parts[3] = ct.toString("base64")
assert.throws(() => decryptSecret(parts.join(":")))
assert.throws(() => decryptSecret("garbage"))
const saved = process.env.STORE_ATMS_CRED_KEY
process.env.STORE_ATMS_CRED_KEY = Buffer.alloc(16).toString("base64")
assert.throws(() => encryptSecret("x"), /32/)
delete process.env.STORE_ATMS_CRED_KEY
assert.throws(() => encryptSecret("x"), /ยังไม่ได้ตั้ง STORE_ATMS_CRED_KEY/)
process.env.STORE_ATMS_CRED_KEY = saved

console.log("check-store-withdraw-core: all passed")
