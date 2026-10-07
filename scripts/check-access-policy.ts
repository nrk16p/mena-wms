// scripts/check-access-policy.ts — รัน: npx tsx scripts/check-access-policy.ts
// สิทธิ์ตามแผนก (lib/access-policy.ts): ตารางสิทธิ์, override, ทางเดิน → ส่วนงาน, การตัดสินแต่ละ request
import assert from "node:assert/strict"
import {
  accessFor, sectionForPage, sectionForApi, checkRequest, SECTIONS, type Access,
} from "../lib/access-policy"
import { NAV_GROUPS } from "../lib/nav"

const SUPER = "narongkorn.a@menatransport.co.th"
const ADMIN = "bunphak.p@menatransport.co.th"
const u = (department: string | null, email = "someone@menatransport.co.th") => accessFor({ department, email })

// 1. ตารางสิทธิ์ตามแผนก (ร่างที่อนุมัติ 2026-10-07)
assert.deepEqual(u("ยานยนต์"), {
  sku: "edit", pr: "edit", ap: "none", "price-compare": "view", vendor: "edit",
  "safety-stock": "view", deadstock: "view", tire: "edit", repair: "edit", "driver-handover": "view", "ai-mixer": "none",
})
assert.equal(u("Procurement")["safety-stock"], "edit")
assert.equal(u("Procurement").ap, "view")
assert.equal(u("Procurement")["driver-handover"], "none")
assert.equal(u("Accounting").ap, "edit")
assert.equal(u("Accounting")["price-compare"], "view")
assert.equal(u("Accounting").tire, "none")
assert.equal(u("Finance").ap, "edit")
assert.equal(u("Finance").sku, "none")
assert.equal(u("Finance").pr, "view")
for (const d of ["จัดส่งลาดกระบัง", "จัดส่งสระบุรี", "จัดส่งบางปะกง", "Operation Support", "Safety Management"]) {
  assert.equal(u(d)["driver-handover"], "edit", d)
  assert.equal(u(d).pr, "edit", d)
  assert.equal(u(d).repair, "view", d)
  assert.equal(u(d).ap, "none", d)
}
assert.equal(u("Recruitment - Mass")["driver-handover"], "edit")
assert.equal(u("Recruitment - Mass").pr, "none")
for (const d of ["Chief-Level", "Compliance", "Company Secretary & Compliance"]) {
  for (const s of SECTIONS) assert.equal(u(d)[s], s === "ai-mixer" ? "none" : "view", `${d} ${s}`)
}
// ชื่อแผนกเทียบแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
assert.equal(u("  procurement ")["safety-stock"], "edit")

// 2. แผนกที่ไม่อยู่ในตาราง / ไม่มีข้อมูล HR → ทั่วไป
const general = u("Compensation & Benefits")
assert.deepEqual(u(null), general)
assert.equal(general.sku, "view")
assert.equal(general.pr, "edit")
for (const s of SECTIONS) if (s !== "sku" && s !== "pr") assert.equal(general[s], "none", s)

// 3. IT / admin / superadmin → แก้ได้ทุกส่วน
for (const a of [u("Information Technology"), u("Finance", ADMIN), u(null, SUPER)]) {
  for (const s of SECTIONS) assert.equal(a[s], "edit", s)
}

// 4. superadmin ตั้งทับรายคน
const o = accessFor({ department: "Procurement", email: "p@menatransport.co.th", overrides: { ap: "none", tire: "edit" } })
assert.equal(o.ap, "none")
assert.equal(o.tire, "edit")
assert.equal(o.sku, "edit", "ส่วนที่ไม่ได้ตั้งทับ ใช้ตามแผนก")
// override ที่ไม่รู้จัก ไม่ทำให้พัง
assert.equal(accessFor({ department: "Finance", email: "f@x", overrides: { ap: "bogus" as never } }).ap, "edit")

// 5. หน้าเว็บ → ส่วนงาน (ตัดตามท่อนของ path)
assert.equal(sectionForPage("/pr"), "pr")
assert.equal(sectionForPage("/pr/guide"), "pr")
assert.equal(sectionForPage("/price-compare/PC-2610-002"), "price-compare")
assert.equal(sectionForPage("/order-tracking/guide"), "pr")
assert.equal(sectionForPage("/ap-tracking/dashboard"), "ap")
assert.equal(sectionForPage("/tire/latkrabang/stock-tire"), "tire")
assert.equal(sectionForPage("/garages"), "repair")
assert.equal(sectionForPage("/codes/parts"), "sku")
assert.equal(sectionForPage("/admin/users"), "admin")
assert.equal(sectionForPage("/"), null)
assert.equal(sectionForPage("/unauthorized"), null)

// 6. API → ส่วนงาน
assert.equal(sectionForApi("/api/tire-stock/bulk"), "tire")
assert.equal(sectionForApi("/api/tire-change-request/abc/items"), "tire")
assert.equal(sectionForApi("/api/pr/items"), "pr")
assert.equal(sectionForApi("/api/price-compare/PC-1/pdf"), "price-compare")
assert.equal(sectionForApi("/api/ap-suppliers"), "ap")
assert.equal(sectionForApi("/api/sku-convert/item"), "sku")
assert.equal(sectionForApi("/api/garage-master/1"), "repair")
assert.equal(sectionForApi("/api/admin/users"), "admin")
assert.equal(sectionForApi("/api/atms/openjob/LBMR1"), null)
assert.equal(sectionForApi("/api/media/presign"), null)

// 7. ตัดสิน request
const ok = { ok: true }
const acc = (d: string | null): Access => u(d)
assert.deepEqual(checkRequest({ pathname: "/ap-tracking", method: "GET", access: acc("Accounting"), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/ap-tracking", method: "GET", access: acc(null), isSuperAdmin: false }),
  { ok: false, api: false, section: "ap", need: "view" })
assert.deepEqual(checkRequest({ pathname: "/api/price-compare", method: "GET", access: acc("Accounting"), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/api/price-compare", method: "POST", access: acc("Accounting"), isSuperAdmin: false }),
  { ok: false, api: true, section: "price-compare", need: "edit" })
assert.deepEqual(checkRequest({ pathname: "/api/sku", method: "POST", access: acc("Finance"), isSuperAdmin: false }),
  { ok: false, api: true, section: "sku", need: "edit" })
// API ที่ใช้ร่วมกัน: อ่านได้ทุกคน · เขียนยังคุมตามเจ้าของ
assert.deepEqual(checkRequest({ pathname: "/api/vehicles", method: "GET", access: acc("Finance"), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/api/vehicles/AB1", method: "PUT", access: acc("Finance"), isSuperAdmin: false }),
  { ok: false, api: true, section: "sku", need: "edit" })
assert.deepEqual(checkRequest({ pathname: "/api/vendors/names", method: "GET", access: acc(null), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/api/vendors", method: "GET", access: acc(null), isSuperAdmin: false }),
  { ok: false, api: true, section: "vendor", need: "view" })
assert.deepEqual(checkRequest({ pathname: "/api/codes/WAREHOUSE", method: "GET", access: acc("Finance"), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/api/sku/X-1", method: "GET", access: acc("Finance"), isSuperAdmin: false }), ok)
assert.deepEqual(checkRequest({ pathname: "/api/atms/openjob/X", method: "POST", access: acc(null), isSuperAdmin: false }), ok)
// HEAD/OPTIONS นับเป็นอ่าน
assert.deepEqual(checkRequest({ pathname: "/api/price-compare", method: "OPTIONS", access: acc("Accounting"), isSuperAdmin: false }), ok)
// admin
assert.deepEqual(checkRequest({ pathname: "/admin/users", method: "GET", access: u(null, ADMIN), isSuperAdmin: false }),
  { ok: false, api: false, section: "admin", need: "superadmin" })
assert.deepEqual(checkRequest({ pathname: "/api/admin/users", method: "GET", access: u(null, ADMIN), isSuperAdmin: false }),
  { ok: false, api: true, section: "admin", need: "superadmin" })
assert.deepEqual(checkRequest({ pathname: "/admin/users", method: "GET", access: u(null, SUPER), isSuperAdmin: true }), ok)
// หน้า/ API ที่ไม่อยู่ในส่วนไหน → ผ่าน
assert.deepEqual(checkRequest({ pathname: "/", method: "GET", access: acc(null), isSuperAdmin: false }), ok)

// 8. เมนูทุกหน้าใน lib/nav.ts ต้องตกส่วนงานเดียวกับกลุ่มของมัน (กันเพิ่มหน้าแล้วลืมแก้ policy)
for (const g of NAV_GROUPS) {
  if (g.key === "overview") continue
  for (const it of g.items) {
    if (it.subheader || it.href === "/" || it.href.startsWith("#")) continue
    assert.equal(sectionForPage(it.href), g.key, `${it.href} อยู่กลุ่ม ${g.key}`)
  }
}

console.log("check-access-policy: ok")
