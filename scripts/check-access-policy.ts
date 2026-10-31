// scripts/check-access-policy.ts — รัน: npx tsx scripts/check-access-policy.ts
// สิทธิ์ตามแผนก (lib/access-policy.ts): ตารางสิทธิ์, override, ทางเดิน → ส่วนงาน, การตัดสินแต่ละ request
import assert from "node:assert/strict"
import {
  accessFor, sectionForPage, sectionForApi, checkRequest, SECTIONS, type Access,
} from "../lib/access-policy"
import { NAV_GROUPS, sidebarGroups, homeModules } from "../lib/nav"

const SUPER = "narongkorn.a@menatransport.co.th"
const ADMIN = "bunphak.p@menatransport.co.th"
const u = (department: string | null, email = "someone@menatransport.co.th") => accessFor({ department, email })

// 1. ตารางสิทธิ์ตามแผนก (ร่างที่อนุมัติ 2026-10-07)
assert.deepEqual(u("ยานยนต์"), {
  sku: "edit", pr: "edit", ap: "none", "price-compare": "view", vendor: "edit",
  "safety-stock": "view", deadstock: "edit", tire: "edit", repair: "edit", "driver-handover": "view", "ai-mixer": "none",
  "store-withdraw": "edit", "store-queue": "none",
})
assert.equal(u("Procurement")["safety-stock"], "edit")
assert.equal(u("Procurement").ap, "edit")
assert.equal(u("Procurement")["driver-handover"], "none")
assert.equal(u("Accounting").ap, "edit")
assert.equal(u("Accounting")["price-compare"], "view")
assert.equal(u("Accounting").tire, "none")
// การเงิน = บัญชี ทุกส่วน (ผู้ใช้สั่ง 2026-10-07)
assert.deepEqual(u("Finance"), u("Accounting"))
assert.equal(u("Finance").ap, "edit")
assert.equal(u("Finance").sku, "view")
for (const d of ["จัดส่งลาดกระบัง", "จัดส่งสระบุรี", "จัดส่งบางปะกง", "Operation Support", "Safety Management"]) {
  assert.equal(u(d)["driver-handover"], "edit", d)
  assert.equal(u(d).pr, "edit", d)
  assert.equal(u(d).repair, "view", d)
  assert.equal(u(d).ap, "none", d)
}
assert.equal(u("Recruitment - Mass")["driver-handover"], "edit")
assert.equal(u("Recruitment - Mass").pr, "edit")
for (const d of ["Chief-Level", "Compliance", "Company Secretary & Compliance"]) {
  for (const s of SECTIONS) assert.equal(u(d)[s], s === "ai-mixer" ? "none" : "view", `${d} ${s}`)
}
// ชื่อแผนกเทียบแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
assert.equal(u("  procurement ")["safety-stock"], "edit")

// 1b. department_id มาก่อนชื่อ — HR เปลี่ยนชื่อแผนก 2026-10-25 แต่สิทธิ์ต้องไม่หลุด
const byId = (departmentId: number, department: string | null = "ชื่อที่ไม่อยู่ในตาราง") =>
  accessFor({ department, departmentId, email: "someone@menatransport.co.th" })
for (const id of [3, 25, 26, 27]) assert.deepEqual(byId(id), u("ยานยนต์"), `dept ${id}`)
for (const id of [5, 31]) assert.deepEqual(byId(id), u("Procurement"), `dept ${id}`)
for (const id of [8, 11, 15, 19, 20, 28, 29, 30, 32]) assert.deepEqual(byId(id), u("Operation Support"), `dept ${id}`)
assert.deepEqual(byId(17), u("Compliance"))
assert.deepEqual(byId(21), u("Information Technology"))
// id ไม่อยู่ในตาราง → ใช้ชื่อสำรอง · ชื่อเดิมและชื่อใหม่ได้สิทธิ์เท่ากัน
assert.deepEqual(byId(999, "Procurement"), u("Procurement"))
assert.deepEqual(byId(7, "Compensation & Benefits"), u(null))
assert.deepEqual(u("Engineering and Maintenance"), u("ยานยนต์"))
assert.deepEqual(u("Delivery Service"), u("จัดส่งลาดกระบัง"))
assert.deepEqual(u("Store"), u("Procurement"))

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
// หน้า PO (กรองวันที่ + Excel) อยู่ใต้ส่วนงาน PR — คนที่เห็นติดตาม PR เห็นหน้านี้ · "/po" ต้องไม่ชนกับ "/pr"
assert.equal(sectionForPage("/po"), "pr")
assert.equal(sectionForPage("/pos"), null)
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
assert.equal(sectionForApi("/api/po"), "pr")
assert.equal(sectionForApi("/api/po/items"), "pr")
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
    assert.equal(sectionForPage(it.href), it.section ?? g.key, `${it.href} อยู่กลุ่ม ${g.key}`)
  }
}

// 9. เมนู sidebar / หน้าหลัก ซ่อนส่วนงานที่ "ไม่เห็น"
const fin = u("Finance")
const side = sidebarGroups({ email: "f@menatransport.co.th", access: fin }).map((g) => g.key)
assert.ok(side.includes("ap"), "การเงินเห็นเจ้าหนี้")
assert.ok(side.includes("pr"), "การเงินเห็น PR (ดูอย่างเดียว)")
assert.ok(side.includes("sku"), "การเงินเห็น SKU (ดูอย่างเดียว เท่าบัญชี)")
assert.ok(!side.includes("tire"), "การเงินไม่เห็นยาง")
assert.ok(side.includes("overview"), "หน้าหลักเห็นเสมอ")
const home = homeModules({ email: "f@menatransport.co.th", access: fin }).map((m) => m.key)
assert.ok(home.includes("ap") && !home.includes("tire"))
// ไม่ส่ง access (ยังโหลด session ไม่เสร็จ) → เหมือนเดิม ไม่ซ่อน
assert.ok(sidebarGroups({ email: "x" }).some((g) => g.key === "sku"))

console.log("check-access-policy: ok")

// 99. เบิกอะไหล่หน้าร้านคลัง (store-withdraw): ผู้ขอ = ยานยนต์ · สโตร์ = override รายคน · IT ได้ทั้งคู่
{
  const veh = u("ยานยนต์")
  assert.equal(veh["store-withdraw"], "edit")
  assert.equal(veh["store-queue"], "none")
  const it = u("Information Technology")
  assert.equal(it["store-withdraw"], "edit")
  assert.equal(it["store-queue"], "edit")
  for (const d of ["Procurement", "Accounting", "Delivery Service", "Compensation & Benefits"]) {
    assert.equal(u(d)["store-withdraw"], "none", d)
    assert.equal(u(d)["store-queue"], "none", d)
  }
  const storePerson = accessFor({ department: "Store", email: "s@menatransport.co.th", overrides: { "store-queue": "edit" } })
  assert.equal(storePerson["store-queue"], "edit")
  const run = (pathname: string, method: string, access: Access) => checkRequest({ pathname, method, access, isSuperAdmin: false })
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/issue"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/claim"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/lines"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/ready"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/reject"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/returns/R1/accept"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/queue"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw/atms-link"), "store-queue")
  assert.equal(sectionForApi("/api/store-withdraw"), "store-withdraw")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001"), "store-withdraw")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/cancel"), "store-withdraw")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/receive"), "store-withdraw")
  assert.equal(sectionForApi("/api/store-withdraw/SW-2610-001/returns"), "store-withdraw")
  assert.equal(sectionForApi("/api/store-withdraw/lookup/sku"), "store-withdraw")
  assert.equal(sectionForPage("/store-withdraw"), "store-withdraw")
  assert.equal(sectionForPage("/store-withdraw/queue"), "store-queue")
  assert.equal(run("/api/store-withdraw/SW-2610-001/issue", "POST", veh).ok, false)
  assert.equal(run("/api/store-withdraw/SW-2610-001/issue", "POST", storePerson).ok, true)
  assert.equal(run("/api/store-withdraw", "POST", veh).ok, true)
  assert.equal(run("/api/store-withdraw", "POST", storePerson).ok, false)
  // สโตร์ที่ไม่มีสิทธิ์ยื่นคำขอ ยังอ่านตัวเลือก/ค้นหา/รายละเอียดใบได้
  assert.equal(run("/api/store-withdraw/options", "GET", storePerson).ok, true)
  assert.equal(run("/api/store-withdraw/lookup/sku", "GET", storePerson).ok, true)
  assert.equal(run("/api/store-withdraw/SW-2610-001", "GET", storePerson).ok, true)
  assert.equal(run("/api/store-withdraw/queue", "GET", veh).ok, false)
  assert.equal(run("/store-withdraw/queue", "GET", veh).ok, false)
  // เมนู "คิวงานสโตร์": เห็นเมื่อมีสิทธิ์ store-queue อย่างน้อยดู · คนไม่มีสิทธิ์ไม่เห็น · กลุ่ม none แต่เห็นคิว = ยังเห็นเฉพาะคิว
  const hrefs = (a: Record<string, string>) => sidebarGroups({ access: a as never }).flatMap((g) => g.items.map((i) => i.href))
  const base = { ...veh.access } as Record<string, string>
  assert.equal(hrefs({ ...base, "store-queue": "none" }).includes("/store-withdraw/queue"), false)
  assert.equal(hrefs({ ...base, "store-queue": "view" }).includes("/store-withdraw/queue"), true)
  const onlyQueue = hrefs({ ...base, "store-withdraw": "none", "store-queue": "edit" }).filter((h) => h.startsWith("/store-withdraw"))
  assert.deepEqual(onlyQueue, ["/store-withdraw/queue"])
  assert.equal(sidebarGroups({}).flatMap((g) => g.items).some((i) => i.href === "/store-withdraw/queue"), true)
}
console.log("store-withdraw access: OK")
