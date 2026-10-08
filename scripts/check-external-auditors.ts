// scripts/check-external-auditors.ts — รัน: npx tsx scripts/check-external-auditors.ts
// ช่องทางผู้ตรวจสอบภายนอก (lib/external-auditors.ts) ปิดอยู่ตั้งแต่ 8/10/2569:
// รายชื่อว่าง → ไม่มีใครนอก @menatransport.co.th login ได้ · พนักงานไม่กระทบ
import assert from "node:assert/strict"
import {
  EXTERNAL_AUDITORS, isExternalAuditor, auditorActive, signInAllowed,
} from "../lib/external-auditors"
import { accessFor, SECTIONS, departmentAccess } from "../lib/access-policy"
import { overrideBlockedReason, buildUserRow } from "../lib/access-admin"

const A = "piyarat.w@amtaudit.com"
const now = Date.parse("2026-10-08T12:00:00+07:00")

// 1. รายชื่อว่าง — ไม่มีใครเป็นผู้ตรวจสอบภายนอกอีก
assert.equal(EXTERNAL_AUDITORS.length, 0)
for (const e of ["panthip@amtaudit.com", "jirapinya@amtaudit.com", "pannakan@amtaudit.com", "panida@amtaudit.com", A]) {
  assert.ok(!isExternalAuditor(e), e)
  assert.ok(!auditorActive(e, now), e)
}

// 2. login: พนักงานเหมือนเดิม · amtaudit.com และโดเมนอื่นเข้าไม่ได้ ไม่ว่าจะมี hd หรือไม่
assert.ok(signInAllowed("a@menatransport.co.th", "menatransport.co.th", now))
assert.ok(signInAllowed("a@menatransport.co.th", undefined, now))
assert.ok(!signInAllowed("a@menatransport.co.th", "evil.com", now))
assert.ok(!signInAllowed(A, "amtaudit.com", now), "ผู้ตรวจสอบภายนอก login ไม่ได้แล้ว")
assert.ok(!signInAllowed(A, undefined, now))
assert.ok(!signInAllowed("someone@amtaudit.com", "amtaudit.com", now))
assert.ok(!signInAllowed("a@gmail.com", undefined, now))

// 3. ถึงมี session ค้างอยู่ ก็ไม่ได้สิทธิ์ของผู้ตรวจ — ตกไปตามแผนกจาก HR (ไม่มีแผนก = ทั่วไป)
const acc = accessFor({ email: A, department: "ผู้ตรวจสอบภายนอก (AMT Audit)", now })
assert.deepEqual(acc, departmentAccess(null))
assert.ok(SECTIONS.every((s) => acc[s] !== "edit" || departmentAccess(null)[s] === "edit"))

// 4. หน้า superadmin ตั้งทับได้ตามปกติ (ไม่มีกฎผู้ตรวจล็อกไว้แล้ว)
assert.equal(overrideBlockedReason(A), null)
assert.equal(buildUserRow({ email: A, department: "ผู้ตรวจสอบภายนอก (AMT Audit)" }, { ap: "edit" }).lockedReason, null)
assert.equal(overrideBlockedReason("x@menatransport.co.th"), null)

// 5. พนักงานจัดซื้อไม่กระทบ
assert.deepEqual(accessFor({ department: "Procurement", email: "p@menatransport.co.th" }), departmentAccess("Procurement"))

console.log("check-external-auditors: ok — ช่องทางผู้ตรวจสอบภายนอกปิดแล้ว")
