// scripts/check-access-admin.ts — รัน: npx tsx scripts/check-access-admin.ts
// ตรรกะล้วนของหน้า /admin/users (lib/access-admin.ts): ตรวจ/ทำความสะอาด override, diff สำหรับประวัติ,
// แถวผู้ใช้ (สิทธิ์ตามแผนก + สิทธิ์จริง), เรียงรายชื่อ, ใครตั้งทับไม่ได้
import assert from "node:assert/strict"
import {
  normalizeOverrides, diffOverrides, describeChange, buildUserRow, sortUsers, overrideBlockedReason,
  parseLogLimit, siteLabel,
} from "../lib/access-admin"
import { sidebarGroups, homeModules } from "../lib/nav"

const SUPER = "narongkorn.a@menatransport.co.th"
const ADMIN = "bunphak.p@menatransport.co.th"

// 1. normalizeOverrides — เก็บเฉพาะข้อยกเว้นจริง (ค่าที่ต่างจากแผนก)
// ยานยนต์: sku=edit, ap=none, tire=edit
{
  const r = normalizeOverrides({ sku: "edit", ap: "view", tire: "none" }, "ยานยนต์")
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.overrides, { ap: "view", tire: "none" }) // sku = ค่าแผนกอยู่แล้ว → ตัดทิ้ง
}
{
  // null / "" / undefined = "ตามแผนก" → ไม่เก็บ
  const r = normalizeOverrides({ sku: null, ap: "", pr: undefined }, "ยานยนต์")
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.overrides, {})
}
{
  // แผนกไม่อยู่ในตาราง → เทียบกับ "ทั่วไป" (sku=view, pr=edit)
  const r = normalizeOverrides({ sku: "view", pr: "none" }, "แผนกที่ไม่มี")
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.overrides, { pr: "none" })
}
{
  // ลำดับ key ตาม SECTIONS เสมอ (ให้ before/after ในประวัติอ่านง่าย)
  const r = normalizeOverrides({ tire: "none", ap: "view" }, "ยานยนต์")
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(Object.keys(r.overrides), ["ap", "tire"])
}
// ส่วนงานไม่รู้จัก / ระดับผิด / ไม่ใช่ object → error
assert.equal(normalizeOverrides({ admin: "edit" }, "ยานยนต์").ok, false)
assert.equal(normalizeOverrides({ foo: "edit" }, "ยานยนต์").ok, false)
assert.equal(normalizeOverrides({ sku: "write" }, "ยานยนต์").ok, false)
assert.equal(normalizeOverrides({ sku: 2 }, "ยานยนต์").ok, false)
assert.equal(normalizeOverrides(null, "ยานยนต์").ok, false)
assert.equal(normalizeOverrides(["sku"], "ยานยนต์").ok, false)
assert.equal(normalizeOverrides("sku", "ยานยนต์").ok, false)
{
  const r = normalizeOverrides({ foo: "edit" }, null)
  assert.ok(!r.ok && r.error.includes("foo"))
}
// prototype key ไม่ผ่าน
assert.equal(normalizeOverrides(JSON.parse('{"__proto__": "edit"}'), "ยานยนต์").ok, false)

// 2. diffOverrides — ต่อส่วนงาน: จากอะไรเป็นอะไร (null = ตามแผนก)
assert.deepEqual(diffOverrides({ ap: "view" }, { ap: "edit", tire: "none" }), [
  { section: "ap", from: "view", to: "edit" },
  { section: "tire", from: null, to: "none" },
])
assert.deepEqual(diffOverrides({ ap: "view", sku: "none" }, {}), [
  { section: "sku", from: "none", to: null },
  { section: "ap", from: "view", to: null },
])
assert.deepEqual(diffOverrides({ ap: "view" }, { ap: "view" }), [])
assert.deepEqual(diffOverrides(null, undefined), [])
// ค่าขยะในเอกสารเก่าไม่ทำให้พัง — ไม่ใช่ระดับ = ตามแผนก
assert.deepEqual(diffOverrides({ ap: "bogus" } as never, {}), [])

// 3. describeChange — ข้อความไทยอ่านง่าย
assert.equal(describeChange({ section: "ap", from: null, to: "edit" }), "เจ้าหนี้ (AP): ตามแผนก → แก้ได้")
assert.equal(describeChange({ section: "sku", from: "view", to: null }), "จัดการ SKU: ดูอย่างเดียว → ตามแผนก")

// 4. buildUserRow — สิทธิ์ตามแผนก + สิทธิ์จริง (รวม override) + ธง admin
{
  const row = buildUserRow(
    { email: "x@menatransport.co.th", name: "X", department: "Finance", siteId: 1 },
    { sku: "view", ap: "bogus" },
  )
  assert.equal(row.departmentAccess.sku, "none")
  assert.equal(row.effective.sku, "view")
  assert.equal(row.effective.ap, "edit") // ค่าขยะไม่ถูกใช้
  assert.deepEqual(row.overrides, { sku: "view" }) // ส่งเฉพาะค่าที่ใช้ได้กลับไปให้หน้าเว็บ
  assert.equal(row.isAdmin, false)
  assert.equal(row.isSuperAdmin, false)
}
{
  const row = buildUserRow({ email: SUPER, name: "S", department: "Information Technology" }, null)
  assert.equal(row.isSuperAdmin, true)
  assert.equal(row.isAdmin, true)
  assert.equal(row.effective.ap, "edit")
}
{
  const row = buildUserRow({ email: ADMIN, name: "A", department: "Finance" }, { ap: "none" })
  assert.equal(row.isAdmin, true)
  assert.equal(row.effective.ap, "edit") // admin ได้แก้ได้ทุกส่วนเสมอ
}

// 5. sortUsers — แผนก แล้วชื่อ · ไม่มีแผนกไปท้ายสุด
{
  const sorted = sortUsers([
    { email: "c@x", name: "ข", department: "Procurement" },
    { email: "a@x", name: "ก", department: null },
    { email: "b@x", name: "ก", department: "Procurement" },
    { email: "d@x", name: "ค", department: "Accounting" },
  ])
  assert.deepEqual(sorted.map((u) => u.email), ["d@x", "b@x", "c@x", "a@x"])
}

// 6. overrideBlockedReason — superadmin / admin ตั้งทับไม่ได้ (ได้แก้ได้ทุกส่วนอยู่แล้ว)
assert.ok(overrideBlockedReason(SUPER))
assert.ok(overrideBlockedReason(SUPER.toUpperCase()))
assert.ok(overrideBlockedReason(ADMIN))
assert.equal(overrideBlockedReason("someone@menatransport.co.th"), null)

// 7. parseLogLimit — ค่าเริ่ม 200, จำกัด 1..1000
assert.equal(parseLogLimit(null), 200)
assert.equal(parseLogLimit("50"), 50)
assert.equal(parseLogLimit("0"), 1)
assert.equal(parseLogLimit("99999"), 1000)
assert.equal(parseLogLimit("abc"), 200)

// 8. siteLabel
assert.equal(siteLabel(2), "ศลบ.")
assert.equal(siteLabel(6), "ศบก.")
assert.equal(siteLabel(null), "—")
assert.equal(siteLabel(99), "—")

// 9. เมนู "ผู้ดูแลระบบ" — เห็นเฉพาะ superadmin (ทั้ง sidebar และหน้าหลัก)
assert.ok(!sidebarGroups({ email: ADMIN, isAdmin: true }).some((g) => g.key === "admin"))
assert.ok(!homeModules({ email: SUPER, isAdmin: true }).some((m) => m.key === "admin"))
assert.ok(sidebarGroups({ email: SUPER, isAdmin: true, isSuperAdmin: true }).some((g) => g.key === "admin"))
assert.ok(homeModules({ email: SUPER, isAdmin: true, isSuperAdmin: true }).some((m) => m.links.some((l) => l.href === "/admin/users")))

console.log("check-access-admin: OK")
