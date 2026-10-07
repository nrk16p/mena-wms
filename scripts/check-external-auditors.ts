// scripts/check-external-auditors.ts — รัน: npx tsx scripts/check-external-auditors.ts
// ผู้ตรวจสอบภายนอก (lib/external-auditors.ts): 5 อีเมล amtaudit.com · ดูอย่างเดียวเท่าจัดซื้อ · หมดสิทธิ์ 31/10/2569 23:59 เวลาไทย
import assert from "node:assert/strict"
import {
  EXTERNAL_AUDITORS, AUDITOR_EXPIRES_AT, isExternalAuditor, auditorActive, signInAllowed, auditorProfile,
} from "../lib/external-auditors"
import { accessFor, checkRequest, departmentAccess, SECTIONS } from "../lib/access-policy"
import { overrideBlockedReason, buildUserRow } from "../lib/access-admin"
import { deptScope } from "../lib/dept-access"
import { missingEmployeeFields } from "../lib/session-profile"

const A = "panthip@amtaudit.com"
const before = Date.parse("2026-10-31T23:59:00+07:00")
const after = Date.parse("2026-11-01T00:00:00+07:00")

// 1. รายชื่อ 5 คน · ตัวพิมพ์ใหญ่/เว้นวรรคไม่มีผล · คนอื่นในโดเมนเดียวกันไม่ใช่
assert.equal(EXTERNAL_AUDITORS.length, 5)
for (const e of ["panthip@amtaudit.com", "jirapinya@amtaudit.com", "pannakan@amtaudit.com", "panida@amtaudit.com", "Piyarat.w@amtaudit.com"]) {
  assert.ok(isExternalAuditor(e), e)
}
assert.ok(isExternalAuditor("  PIYARAT.W@AMTAUDIT.COM "))
assert.ok(!isExternalAuditor("someone@amtaudit.com"))
assert.ok(!isExternalAuditor("panthip@menatransport.co.th"))
assert.ok(!isExternalAuditor(null))

// 2. หมดอายุสิ้นวัน 31 ต.ค. 2569 เวลาไทย
assert.equal(AUDITOR_EXPIRES_AT, Date.parse("2026-10-31T23:59:59.999+07:00"))
assert.ok(auditorActive(A, before))
assert.ok(!auditorActive(A, after))
assert.ok(!auditorActive("someone@amtaudit.com", before))

// 3. login: พนักงานเหมือนเดิม · ผู้ตรวจในรายชื่อเข้าได้จนหมดอายุ · โดเมน Workspace ต้องตรงอีเมล
assert.ok(signInAllowed("a@menatransport.co.th", "menatransport.co.th", before))
assert.ok(signInAllowed("a@menatransport.co.th", undefined, before))
assert.ok(!signInAllowed("a@menatransport.co.th", "evil.com", before))
assert.ok(!signInAllowed("a@gmail.com", undefined, before))
assert.ok(signInAllowed(A, "amtaudit.com", before))
assert.ok(signInAllowed(A, undefined, before))
assert.ok(!signInAllowed(A, "amtaudit.com", after), "หมดอายุแล้ว login ไม่ได้")
assert.ok(!signInAllowed(A, "menatransport.co.th", before), "hd ต้องตรงโดเมนอีเมลตัวเอง")
assert.ok(!signInAllowed("someone@amtaudit.com", "amtaudit.com", before), "นอกรายชื่อ")

// 4. สิทธิ์: เท่าจัดซื้อแต่ "ดูอย่างเดียว" · override ไม่มีผล · หมดอายุ = ไม่เห็นอะไรเลย
const proc = departmentAccess("Procurement")
const acc = accessFor({ email: A, department: "ผู้ตรวจสอบภายนอก", overrides: { ap: "edit", tire: "edit" }, now: before })
for (const s of SECTIONS) {
  assert.equal(acc[s], proc[s] === "none" ? "none" : "view", s)
}
assert.equal(acc.ap, "view")
assert.equal(acc.tire, "view")
assert.equal(acc["driver-handover"], "none")
const gone = accessFor({ email: A, now: after })
for (const s of SECTIONS) assert.equal(gone[s], "none", s)
// พนักงานไม่กระทบ
assert.deepEqual(accessFor({ department: "Procurement", email: "p@menatransport.co.th" }), proc)

// 5. middleware: อ่านได้ เขียนไม่ได้
assert.deepEqual(checkRequest({ pathname: "/ap-tracking", method: "GET", access: acc, isSuperAdmin: false }), { ok: true })
assert.deepEqual(checkRequest({ pathname: "/api/pr", method: "GET", access: acc, isSuperAdmin: false }), { ok: true })
assert.deepEqual(checkRequest({ pathname: "/api/ap-tracking/LBDD1", method: "PATCH", access: acc, isSuperAdmin: false }),
  { ok: false, api: true, section: "ap", need: "edit" })
assert.deepEqual(checkRequest({ pathname: "/api/sku", method: "POST", access: acc, isSuperAdmin: false }),
  { ok: false, api: true, section: "sku", need: "edit" })
assert.deepEqual(checkRequest({ pathname: "/admin/users", method: "GET", access: acc, isSuperAdmin: false }),
  { ok: false, api: false, section: "admin", need: "superadmin" })

// 6. โปรไฟล์แทน HR: แผนกแสดงในหน้า /admin/users · ติดตามคำสั่งซื้อเห็นทุกแผนกเท่าจัดซื้อ
const p = auditorProfile(A)
assert.match(p.department ?? "", /ผู้ตรวจสอบภายนอก/)
assert.equal(deptScope(p).all, true)
assert.deepEqual(missingEmployeeFields(p), [], "โปรไฟล์ครบ — ไม่โดน session-guard บังคับ logout")

// 7. หน้า superadmin ตั้งทับผู้ตรวจไม่ได้ (สิทธิ์กำหนดในโค้ด)
assert.ok(overrideBlockedReason(A))
assert.equal(overrideBlockedReason("x@menatransport.co.th"), null)
{
  const row = buildUserRow({ email: A, name: "P", department: "ผู้ตรวจสอบภายนอก (AMT Audit)" }, { ap: "edit" })
  assert.ok(row.lockedReason, "หน้า superadmin แสดงเหตุผลที่ตั้งทับไม่ได้")
  assert.equal(row.effective["driver-handover"], "none")
  assert.equal(buildUserRow({ email: "x@menatransport.co.th", department: "Finance" }, null).lockedReason, null)
}

console.log("check-external-auditors: ok")
