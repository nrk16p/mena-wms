// scripts/check-vendor-core.ts
// รัน: npx tsx scripts/check-vendor-core.ts   (repo ไม่มี test framework — assert ตามแพตเทิร์น check-deadstock-core.ts)
import assert from "node:assert/strict"
import { byCode } from "../lib/repair-type-master"
import {
  isRealVendor, serviceTypeFromGroup, seedServiceTypeFromName, monthsBetweenYm,
  median, tierOf, resolveServiceType, buildVendorPayload, TIER_RULE, UNCLASSIFIED,
  AUTO_APPROVE_RULE, autoApproveCandidates, historyByWork, codesByRule,
  type VendorRawRow, type LabourCode, type VendorApproval,
} from "../lib/vendor-core"

// --- isRealVendor: "เงินสด" เป็นวิธีจ่าย ไม่ใช่คู่ค้า ต้องไม่โผล่ใน AVL ---
assert.equal(isRealVendor("บริษัท ทีที แอนด์ บี เซอร์วิส วิศวกรรม จำกัด"), true)
assert.equal(isRealVendor("ณัฐภัทรการยาง"), true)
assert.equal(isRealVendor("เงินสด (ไม่มีVAT)"), false)
assert.equal(isRealVendor("เงินสด (มี VAT)"), false, "เงินสดมี VAT ก็ยังไม่ใช่อู่")
assert.equal(isRealVendor(""), false)
assert.equal(isRealVendor(null), false)

// --- serviceTypeFromGroup: ค่าจริงจาก stockmovement_v5 ---
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบโม่"), "ระบบโม่")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบยาง"), "ระบบยาง")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบเบรค ครัช เกียร์"), "ระบบเบรค-คลัทช์-เกียร์")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบแอร์ ไฟฟ้า"), "ระบบแอร์-ไฟฟ้า")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบเครื่องยนต์"), "ระบบเครื่องยนต์")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบช่วงล่าง"), "ระบบช่วงล่าง")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบบำรุงรักษา"), "ระบบบำรุงรักษา")
assert.equal(serviceTypeFromGroup("ค่าแรง-หัวเก๋ง"), "หัวเก๋ง-ตัวถัง-สี")
assert.equal(serviceTypeFromGroup("ค่าแรง-ระบบหาง"), "ระบบหาง")
assert.equal(serviceTypeFromGroup("ค่าแรง-อุปกรณ์เสริม"), "อุปกรณ์เสริม")
// "ค่าแรง" เปล่า ๆ คือกลุ่มก้อนใหญ่ที่ไม่บอกประเภท ต้องคืน null ไปพึ่ง labour_code_master
assert.equal(serviceTypeFromGroup("ค่าแรง"), null)
assert.equal(serviceTypeFromGroup("ยาง"), null, "ไม่ใช่กลุ่มค่าแรง ไม่ใช่งานซ่อมจากอู่")
assert.equal(serviceTypeFromGroup(""), null)

// --- seedServiceTypeFromName: เดาได้เฉพาะที่ชื่อบอกชัด ---
assert.equal(seedServiceTypeFromName("ค่าซ่อมระบบช่วงล่าง"), "ระบบช่วงล่าง")
assert.equal(seedServiceTypeFromName("ค่าซ่อมระบบเบรค-คลัทช์-เกียร์"), "ระบบเบรค-คลัทช์-เกียร์")
assert.equal(seedServiceTypeFromName("ค่าซ่อมระบบแอร์ -ไฟ"), "ระบบแอร์-ไฟฟ้า")
assert.equal(seedServiceTypeFromName("ค่าบริการทำความสะอาดรถบรรทุก"), "ทำความสะอาด")
assert.equal(seedServiceTypeFromName("ค่าล้างรถ"), "ทำความสะอาด")
assert.equal(seedServiceTypeFromName("ค่าแรงเชื่อม"), "เชื่อม-กลึง-งานโลหะ")
assert.equal(seedServiceTypeFromName("ค่าแรงกลึง"), "เชื่อม-กลึง-งานโลหะ")
assert.equal(seedServiceTypeFromName("ค่าแรงเช็คระยะ"), "ระบบบำรุงรักษา")
// ยอดหลักล้านแต่ชื่อไม่บอกอะไร — ต้องไม่เดา ปล่อยให้คนตัดสิน
assert.equal(seedServiceTypeFromName("ค่าแรงซ่อม"), null, "LB00017 ยอด 3.1 ล้าน ห้ามเดา")
assert.equal(seedServiceTypeFromName("ค่าแรง"), null)
assert.equal(seedServiceTypeFromName("ค่าบริการ"), null)
assert.equal(seedServiceTypeFromName("บิลร้านเครดิต"), null)
assert.equal(seedServiceTypeFromName(""), null)

// --- monthsBetweenYm / median ---
assert.equal(monthsBetweenYm("2026-08", "2026-08"), 0)
assert.equal(monthsBetweenYm("2026-02", "2026-08"), 6)
assert.equal(monthsBetweenYm("2025-08", "2026-08"), 12)
assert.equal(monthsBetweenYm("", "2026-08"), 999, "ไม่มีประวัติ = นับว่าเก่ามาก")
assert.equal(median([]), 0)
assert.equal(median([5]), 5)
assert.equal(median([1, 3, 2]), 2)
assert.equal(median([1, 2, 3, 4]), 2.5)

// --- tierOf: เกณฑ์ต้องตรงกับ TIER_RULE ---
assert.equal(tierOf(false, 999, 0), "unapproved", "ยังไม่อนุมัติ ต่อให้ทำเยอะก็ไม่ใช่ตัวหลัก")
assert.equal(tierOf(true, TIER_RULE.minJobs, TIER_RULE.activeMonths), "primary")
assert.equal(tierOf(true, TIER_RULE.minJobs - 1, 0), "backup", "งานน้อยเกิน")
assert.equal(tierOf(true, 100, TIER_RULE.activeMonths + 1), "backup", "หายไปนานเกิน")

// --- resolveServiceType: ลำดับความสำคัญ กลุ่ม > คนตั้ง > seed > ไม่จัดประเภท ---
const LC = (code: string, set: LabourCode["serviceType"], seeded: LabourCode["seeded"]): LabourCode =>
  ({ code, itemName: "x", serviceType: set, seeded, jobs: 0, baht: 0 })
const cm = new Map<string, LabourCode>([
  ["A", LC("A", "ระบบโม่", "ระบบยาง")],
  ["B", LC("B", "", "ระบบยาง")],
  ["C", LC("C", "", null)],
])
assert.equal(resolveServiceType({ group: "ค่าแรง-ระบบหาง", code: "A" }, cm), "ระบบหาง", "กลุ่มชนะเสมอ")
assert.equal(resolveServiceType({ group: "ค่าแรง", code: "A" }, cm), "ระบบโม่", "คนตั้งชนะ seed")
assert.equal(resolveServiceType({ group: "ค่าแรง", code: "B" }, cm), "ระบบยาง", "ไม่มีคนตั้ง ใช้ seed")
assert.equal(resolveServiceType({ group: "ค่าแรง", code: "C" }, cm), UNCLASSIFIED)
assert.equal(resolveServiceType({ group: "ค่าแรง", code: "ไม่รู้จัก" }, cm), UNCLASSIFIED)

// --- buildVendorPayload ---
const R = (vendor: string, group: string, code: string, jobs: number, baht: number, lastYm: string): VendorRawRow =>
  ({ vendor, group, code, itemName: "x", rows: jobs, jobs, baht, lastYm, warehouses: ["คลังลาดกระบัง"] })

const raw: VendorRawRow[] = [
  R("อู่ ก ข", "ค่าแรง-ระบบโม่", "M1", 10, 100_000, "2026-08"),  // ชื่อมีช่องว่าง — กันคีย์แตก
  R("อู่ ก ข", "ค่าแรง-ระบบยาง", "T1", 2, 4_000, "2026-01"),
  R("อู่ ข", "ค่าแรง-ระบบโม่", "M1", 20, 400_000, "2026-08"),     // แพงกว่าต่อครั้ง
  R("อู่ ค", "ค่าแรง-ระบบโม่", "M1", 3, 15_000, "2025-02"),        // งานน้อย + หายไปนาน
  R("เงินสด (ไม่มีVAT)", "ค่าแรง-ระบบโม่", "M1", 99, 999_999, "2026-08"), // ต้องถูกตัดทิ้ง
  R("อู่ ง", "ค่าแรง", "X9", 4, 8_000, "2026-07"),                 // ยังไม่จัดประเภท
]
// ติ๊กด้วยรหัสจากทะเบียนฝ่ายยานยนต์ — S45 = อู่นอก-CM-ระบบโม่
const approvals: VendorApproval[] = [
  { vendor: "อู่ ก ข", codes: ["S45"], status: "approved" },
  { vendor: "อู่ ข", codes: ["S45"], status: "approved" },
  { vendor: "อู่ ค", codes: ["S45"], status: "approved" },
]
const p = buildVendorPayload(raw, [], approvals, "2026-08", "2024-09")

assert.ok(!p.vendors.some((v) => v.vendor.startsWith("เงินสด")), "เงินสดต้องไม่อยู่ในรายชื่ออู่")
assert.ok(!p.byService.some((r) => r.vendor.startsWith("เงินสด")))
assert.equal(p.vendors.length, 4, "อู่ ก ข / ข / ค / ง")

const mo = p.byService.filter((r) => r.serviceType === "ระบบโม่")
assert.equal(mo.length, 3)
// ชื่ออู่ที่มีช่องว่างต้องไม่ถูกหั่น
assert.ok(mo.some((r) => r.vendor === "อู่ ก ข"), "ชื่ออู่ที่มีช่องว่างต้องคงรูป")
const kx = mo.find((r) => r.vendor === "อู่ ก ข")!
const kh = mo.find((r) => r.vendor === "อู่ ข")!
const kc = mo.find((r) => r.vendor === "อู่ ค")!
assert.equal(kx.avg, 10_000)
assert.equal(kh.avg, 20_000)
assert.equal(kc.avg, 5_000)
// ค่ากลางคิดจากราคาเฉลี่ยรายอู่ (5,000 / 10,000 / 20,000) → มัธยฐาน 10,000
assert.equal(p.services.find((s) => s.serviceType === "ระบบโม่")!.medianAvg, 10_000)
assert.equal(kx.vsMedian, 0)
assert.equal(kh.vsMedian, 100, "แพงกว่าค่ากลางเท่าตัว")
assert.equal(kc.vsMedian, -50)
// ป้ายแนะนำ
assert.equal(kx.tier, "primary")
assert.equal(kh.tier, "primary")
assert.equal(kc.tier, "backup", "งาน 3 ครั้ง + ทำล่าสุด ก.พ. 68 → สำรอง")
// ตัวหลักต้องมาก่อนสำรองในลำดับ
assert.ok(mo.indexOf(kc) > mo.indexOf(kx), "ตัวหลักต้องขึ้นก่อนสำรอง")

// ติ๊กเป็นรายคู่ (อู่ × รหัสงาน) — ติ๊กระบบโม่ไม่ได้แปลว่าทำระบบยางได้
const tyre = p.byService.find((r) => r.serviceType === "ระบบยาง" && r.vendor === "อู่ ก ข")!
assert.equal(tyre.approved, false, "ติ๊กเฉพาะ S45 (ระบบโม่) ระบบยางต้องยังไม่ผ่าน")
assert.equal(tyre.tier, "unapproved")

// ติ๊ก S75 (อู่นอก-T-ปะยาง) แล้ว "ระบบยาง" ฝั่งจัดซื้อต้องนับว่าผ่าน
// เพราะ WORKS_OF_SERVICE จับ "ระบบยาง" → 5 งานย่อยของหมวดยาง
const p3 = buildVendorPayload(raw, [], [{ vendor: "อู่ ก ข", codes: ["S75"], status: "approved" }], "2026-08", "2024-09")
const tyre3 = p3.byService.find((r) => r.serviceType === "ระบบยาง" && r.vendor === "อู่ ก ข")!
assert.equal(tyre3.approved, true, "ติ๊กงานย่อยของหมวดยาง = ทำระบบยางได้")
// รหัสที่ไม่มีในทะเบียนต้องไม่ทำให้พัง และต้องไม่นับว่าผ่าน
const p4 = buildVendorPayload(raw, [], [{ vendor: "อู่ ก ข", codes: ["S999"], status: "approved" }], "2026-08", "2024-09")
assert.equal(p4.byService.find((r) => r.serviceType === "ระบบโม่" && r.vendor === "อู่ ก ข")!.approved, false)

// งานที่ยังไม่จัดประเภท ต้องถูกนับเป็นงานค้างให้คนไปตั้งค่า
assert.equal(p.unclassified.codes, 1)
assert.equal(p.unclassified.jobs, 4)
assert.equal(p.unclassified.baht, 8_000)
assert.ok(p.byService.some((r) => r.serviceType === UNCLASSIFIED && r.vendor === "อู่ ง"))

// ตั้งค่ารหัส X9 แล้ว งานค้างต้องหายไปและถูกจัดเข้าประเภทที่ตั้ง
const p2 = buildVendorPayload(raw, [LC("X9", "ระบบเครื่องยนต์", null)], approvals, "2026-08", "2024-09")
assert.equal(p2.unclassified.codes, 0)
assert.ok(p2.byService.some((r) => r.serviceType === "ระบบเครื่องยนต์" && r.vendor === "อู่ ง"))

// สรุปรายอู่: ประเภทที่เคยทำเรียงตามยอดเงิน
const vkx = p.vendors.find((v) => v.vendor === "อู่ ก ข")!
assert.equal(vkx.didTypes[0].serviceType, "ระบบโม่")
assert.equal(vkx.jobs, 12)
assert.equal(vkx.baht, 104_000)
assert.equal(vkx.status, "approved")
assert.deepEqual(vkx.codes, ["S45"])

// --- autoApproveCandidates: อนุมัติอัตโนมัติเมื่อใช้บ่อยพอ + ยังใช้อยู่ ---
assert.deepEqual(AUTO_APPROVE_RULE, { minJobs: 20, activeMonths: 12 }, "เกณฑ์ที่ผู้ใช้ตกลง 10/09/2026")
const V = (vendor: string, jobs: number, monthsSince: number, status: VendorApproval["status"] = "pending", autoApproved?: boolean) =>
  ({ vendor, jobs, baht: 0, lastYm: "2026-08", monthsSince, status, codes: [], didTypes: [], warehouses: [], autoApproved })
const cands = autoApproveCandidates([
  V("ผ่าน พอดีเกณฑ์", 20, 12),
  V("ผ่าน เยอะ", 500, 0),
  V("งานน้อย", 19, 0),
  V("หายไปนาน", 40, 13),
  V("อนุมัติอยู่แล้ว", 40, 0, "approved"),
  V("คนสั่งไม่อนุมัติ", 40, 0, "rejected"),
  V("คนดึงกลับมารอเอง", 40, 0, "pending", false),
  V("เคยอัตโนมัติแล้วยังรอ", 40, 0, "pending", true),
])
assert.deepEqual(cands.map((c) => c.vendor), ["ผ่าน พอดีเกณฑ์", "ผ่าน เยอะ", "เคยอัตโนมัติแล้วยังรอ"])

// สรุปรายอู่ต้องส่ง autoApproved ติดไปด้วย จอจะได้ติดป้าย "อัตโนมัติ"
const p5 = buildVendorPayload(raw, [], [{ vendor: "อู่ ก ข", codes: [], status: "approved", autoApproved: true }], "2026-08", "2024-09")
assert.equal(p5.vendors.find((v) => v.vendor === "อู่ ก ข")!.autoApproved, true)
assert.equal(p5.vendors.find((v) => v.vendor === "อู่ ง")!.autoApproved, undefined)

// --- codesByRule: ติ๊กช่องที่มีประวัติ ≥20 ครั้ง เฉพาะอู่นอก เพิ่มอย่างเดียว ---
const tyreV = { codes: ["S45"], didTypes: [
  { serviceType: "ระบบยาง" as const, jobs: 48, baht: 0 },
  { serviceType: "ระบบโม่" as const, jobs: 25, baht: 0 },
  { serviceType: "ระบบเครื่องยนต์" as const, jobs: 19, baht: 0 },
] }
const hw = historyByWork(tyreV)
assert.equal(hw.get("ปะยาง"), 48, "ระบบยาง กระจายไปทุกงานย่อยของยาง")
assert.equal(hw.get("ระบบโม่"), 25)
const tick = codesByRule(tyreV)
const tickRows = tick.map((c) => byCode(c)!)
assert.ok(tick.length > 0)
assert.ok(tickRows.every((r) => r.side === "อู่นอก"), "ห้ามติ๊กคอลัมน์อู่ใน")
assert.ok(tickRows.some((r) => r.work === "ปะยาง") && tickRows.some((r) => r.work === "เปลี่ยนยาง"), "ยาง 48 ครั้ง → ติ๊กงานยางทุกตัว")
assert.ok(!tickRows.some((r) => r.work === "ระบบเครื่องยนต์"), "19 ครั้ง ไม่ถึงเกณฑ์")
assert.ok(!tick.includes("S45"), "ที่ติ๊กอยู่แล้วไม่คืนซ้ำ")
assert.deepEqual(codesByRule({ codes: [], didTypes: [] }), [])
assert.deepEqual(codesByRule({ codes: [], didTypes: [{ serviceType: UNCLASSIFIED, jobs: 999, baht: 0 }] }), [], "ยังไม่จัดประเภท ไม่รู้ว่างานอะไร ห้ามติ๊ก")

console.log("✅ vendor-core: ผ่านทั้งหมด")
