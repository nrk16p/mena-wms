// lib/access-policy.ts — สิทธิ์ตามแผนก (spec: docs/superpowers/specs/2026-10-07-department-access-design.md)
//
// ตรรกะล้วน ไม่แตะ DB/React — ใช้ร่วมกันทั้ง middleware (edge), server และ browser
//   • สิทธิ์ต่อส่วนงานมี 3 ระดับ: none (ไม่เห็น) · view (ดูอย่างเดียว) · edit (แก้ได้)
//   • ที่มา: แผนกจาก HR → department_id (DEPT_POLICY_BY_ID) ก่อน · ไม่มี id ค่อยเทียบชื่อ (DEPT_POLICY)
//     · ไม่อยู่ในตาราง/ไม่มีข้อมูล → ทั่วไป
//     (ชื่อแผนกเปลี่ยนได้ตลอด — HR เปลี่ยนชื่อชุดใหญ่ 2026-10-25 จนสิทธิ์หลุด จึงยึด id เป็นหลัก)
//   • IT / admin / superadmin → edit ทุกส่วน · superadmin ตั้งทับรายคนได้ (overrides)
//   • ผู้ตรวจสอบภายนอก (lib/external-auditors.ts) → เท่าจัดซื้อแต่ดูอย่างเดียว · หมดอายุ = ไม่เห็นอะไรเลย
import { isAdmin, isSuperAdmin } from "./roles"
import { auditorActive, isExternalAuditor } from "./external-auditors"

export const SECTIONS = [
  "sku", "pr", "ap", "price-compare", "vendor", "safety-stock", "deadstock",
  "tire", "repair", "driver-handover", "ai-mixer", "store-withdraw", "store-queue", "store-audit", "core-return",
] as const
export type Section = (typeof SECTIONS)[number]
export type Level = "none" | "view" | "edit"
export type Access = Record<Section, Level>

export const SECTION_LABELS: Record<Section, string> = {
  sku: "จัดการ SKU", pr: "ติดตาม PR / คำขอเปิด PO", ap: "เจ้าหนี้ (AP)", "price-compare": "ใบเทียบราคา",
  vendor: "Vendor List / ใบขอราคาอู่", "safety-stock": "Safety Stock", deadstock: "ของค้างคลัง",
  tire: "จัดการยาง", repair: "อู่นอก & อะไหล่ลงคัน", "driver-handover": "ส่งมอบรถ พจส.ใหม่", "ai-mixer": "AI รถโม่ (ทดสอบ)",
  "store-withdraw": "เบิกอะไหล่ (ยื่นคำขอ)", "store-queue": "คิวงานสโตร์",
  "store-audit": "ตรวจสอบย้อนหลังงานเบิก (Audit)",
  "core-return": "ติดตามซากอะไหล่ (ดู/ตามงาน)",
}
export const LEVEL_LABELS: Record<Level, string> = { none: "ไม่เห็น", view: "ดูอย่างเดียว", edit: "แก้ได้" }

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 }
export const atLeast = (have: Level, need: Level) => RANK[have] >= RANK[need]
const isLevel = (v: unknown): v is Level => v === "none" || v === "view" || v === "edit"

const all = (lv: Level): Access => Object.fromEntries(SECTIONS.map((s) => [s, lv])) as Access
const row = (p: Partial<Access>): Access => ({ ...all("none"), ...p })

// ── ตารางสิทธิ์ (อนุมัติ 2026-10-07) ─────────────────────────────────────────────
const GENERAL = row({ sku: "view", pr: "edit" })
const DISPATCH = row({ sku: "view", pr: "edit", tire: "view", repair: "view", "driver-handover": "edit" })
// store-audit ไม่ให้ตามแผนก — ผู้ดูแลกำหนดรายคนที่ /admin/users (ผู้จัดการ/บัญชี)
const OVERSIGHT: Access = { ...all("view"), "ai-mixer": "none", "store-audit": "none" }

// บัญชี / การเงิน สิทธิ์เท่ากัน (ผู้ใช้สั่ง 2026-10-07) — ปุ่มตรวจผ่าน (บัญชี) / ยืนยันจ่าย (การเงิน) ยังแยกตามเดิม (lib/roles.ts)
const ACCOUNTING_FINANCE = row({
  sku: "view", pr: "view", ap: "edit", "price-compare": "view", vendor: "view", "safety-stock": "view",
  deadstock: "view", repair: "view",
  // ติดตามซาก: บัญชีรับเข้าคลังซาก + รอบขาย/บันทึกขาย (ปุ่มเขียนเช็ก isAccounting ใน coreReturnCan) · การเงินดูอย่างเดียว (2026-11-05)
  "core-return": "view",
})

const VEHICLE = row({
  // ของค้างคลัง: ยานยนต์แก้ได้ (ผู้ใช้สั่ง 2026-10-07) · Safety Stock ยังดูอย่างเดียว
  sku: "edit", pr: "edit", "price-compare": "view", vendor: "edit", "safety-stock": "view", deadstock: "edit",
  tire: "edit", repair: "edit", "driver-handover": "view",
  "store-withdraw": "edit", // ยื่นคำขอเบิกอะไหล่ · คิวสโตร์ (store-queue) ให้รายคนที่ /admin/users
  // ติดตามซาก: ยานยนต์ดู + คืนซากผ่านสิทธิ์ store-withdraw (coreReturnCan) · ตามงาน (follow-up) เป็นของจัดซื้อ/สโตร์
  "core-return": "view",
})
const PROCUREMENT = row({
  // เจ้าหนี้: จัดซื้อแก้ได้ (ผู้ใช้สั่ง 2026-10-07) — ปุ่มตรวจผ่าน/ยืนยันจ่ายยังจำกัดบัญชี/การเงินตามเดิม (lib/roles.ts)
  sku: "edit", pr: "edit", ap: "edit", "price-compare": "edit", vendor: "edit", "safety-stock": "edit",
  deadstock: "edit", tire: "view", repair: "edit",
  // ติดตามซาก: จัดซื้อเห็นทั้งหมด + บันทึกการตาม (follow-up) ได้ — ไม่ได้เปิดหน้าเบิก/คิวสโตร์อื่นให้ (2026-11-03)
  "core-return": "edit",
})
// สรรหา Mass เห็นติดตาม PR / คำขอเปิด PO ด้วย (ผู้ใช้สั่ง 2026-10-27)
const RECRUITMENT_MASS = row({ pr: "edit", "driver-handover": "edit" })
const IT = all("edit")

// department_id ฝั่ง HR (ncacdb /departments = แผนก ใต้ฝ่าย ตั้งแต่ 2026-10-25)
// แผนกที่แยกออกมาเมื่อ 2026-10-25 ได้สิทธิ์เท่าแผนกเดิมที่คนย้ายมา (ไม่ให้ใครเสียสิทธิ์จากการปรับโครงสร้าง)
const DEPT_POLICY_BY_ID: Record<number, Access> = {
  1: OVERSIGHT,          // ผู้บริหาร
  3: VEHICLE,            // วิศวกรรมและซ่อมบำรุง (เดิม "ยานยนต์")
  25: VEHICLE,           // ควบคุมสภาพยานยนต์ ← แยกจาก 3
  26: VEHICLE,           // บริการยานยนต์ ← แยกจาก 3
  27: VEHICLE,           // บริการและควบคุมสภาพยานยนต์ (สระบุรี) ← แยกจาก 3
  4: ACCOUNTING_FINANCE, // การเงิน
  6: ACCOUNTING_FINANCE, // บัญชี
  5: PROCUREMENT,        // จัดซื้อจัดจ้าง
  31: PROCUREMENT,       // สโตร์ ← แยกจาก 5
  15: DISPATCH,          // บริการจัดส่ง (เดิม "จัดส่งลาดกระบัง")
  19: DISPATCH,          // พัฒนาประสบการณ์ลูกค้า สระบุรี (เดิม "จัดส่งสระบุรี")
  20: DISPATCH,          // พัฒนาประสบการณ์ลูกค้า บางปะกง (เดิม "จัดส่งบางปะกง")
  28: DISPATCH,          // ประสิทธิภาพต้นทุน ← แยกจาก 19
  11: DISPATCH,          // Operation Support
  29: DISPATCH,          // Process Excellence ← แยกจาก 11
  30: DISPATCH,          // อัตราค่าขนส่ง ← แยกจาก 11
  32: DISPATCH,          // เชื้อเพลิง ← แยกจาก 11
  8: DISPATCH,           // บริหารจัดการความปลอดภัย (Safety Management)
  22: RECRUITMENT_MASS,  // สรรหา Mass
  10: OVERSIGHT,         // สำนักเลขาและงานกำกับดูแลการปฎิบัติงาน
  17: OVERSIGHT,         // กํากับการปฏิบัติตามข้อกําหนด (Compliance)
  21: IT,                // เทคโนโลยีสารสนเทศ
}

// สำรองเมื่อโปรไฟล์ไม่มี department_id (เช่นแถว wms_users เก่า) — เก็บทั้งชื่อเดิมและชื่อหลัง 2026-10-25
const DEPT_POLICY: Record<string, Access> = {
  "ยานยนต์": VEHICLE,
  "engineering and maintenance": VEHICLE,
  "condition control": VEHICLE,
  "vehicle services": VEHICLE,
  "vehicle services and condition control": VEHICLE,
  "procurement": PROCUREMENT,
  "store": PROCUREMENT,
  "accounting": ACCOUNTING_FINANCE,
  "finance": ACCOUNTING_FINANCE,
  "จัดส่งลาดกระบัง": DISPATCH,
  "จัดส่งสระบุรี": DISPATCH,
  "จัดส่งบางปะกง": DISPATCH,
  "delivery service": DISPATCH,
  "customer experience (srb)": DISPATCH,
  "customer experience (bpk)": DISPATCH,
  "fleet cost optimization": DISPATCH,
  "operation support": DISPATCH,
  "process excellence": DISPATCH,
  "freight rate": DISPATCH,
  "fuel control": DISPATCH,
  "safety management": DISPATCH,
  "recruitment - mass": RECRUITMENT_MASS,
  "human resources [mass]": RECRUITMENT_MASS,
  "chief-level": OVERSIGHT,
  "compliance": OVERSIGHT,
  "safety standards [compliance]": OVERSIGHT,
  "company secretary & compliance": OVERSIGHT,
  "information technology": IT,
  "it": IT,
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase()

/** สิทธิ์ตามแผนกอย่างเดียว (ยังไม่รวม admin / override) — ใช้แสดงบนหน้า superadmin */
export function departmentAccess(department: string | null | undefined, departmentId?: number | null): Access {
  const byId = departmentId != null ? DEPT_POLICY_BY_ID[Number(departmentId)] : undefined
  return { ...(byId ?? DEPT_POLICY[norm(department)] ?? GENERAL) }
}

export type Overrides = Partial<Record<Section, Level>>

export function accessFor(p: { department?: string | null; departmentId?: number | null; email?: string | null; overrides?: Overrides | null; now?: number }): Access {
  if (isSuperAdmin(p.email) || isAdmin(p.email)) return all("edit")
  if (isExternalAuditor(p.email)) {
    if (!auditorActive(p.email, p.now)) return all("none")
    const proc = departmentAccess("procurement")
    return Object.fromEntries(SECTIONS.map((s) => [s, proc[s] === "none" ? "none" : "view"])) as Access
  }
  const a = departmentAccess(p.department, p.departmentId)
  for (const [s, lv] of Object.entries(p.overrides ?? {})) {
    if ((SECTIONS as readonly string[]).includes(s) && isLevel(lv)) a[s as Section] = lv
  }
  return a
}

// ── ทางเดิน → ส่วนงาน (ตรงกับเมนูใน lib/nav.ts — scripts/check-access-policy.ts ตรวจให้) ──────
const PAGE_PREFIXES: [string, Section | "admin"][] = [
  ["/sku", "sku"], ["/codes", "sku"], ["/vehicles", "sku"], ["/atms-new-sku-report", "sku"],
  ["/pr", "pr"], ["/order-tracking", "pr"], ["/po", "pr"],
  ["/ap-tracking", "ap"],
  ["/price-compare", "price-compare"],
  ["/vendors", "vendor"], ["/rfq", "vendor"],
  ["/safety-stock", "safety-stock"],
  ["/deadstock", "deadstock"],
  ["/tire", "tire"],
  ["/repair-external", "repair"], ["/garages", "repair"],
  ["/driver-handover", "driver-handover"],
  ["/ai-mixer-maintenance", "ai-mixer"],
  ["/store-withdraw", "store-withdraw"], ["/store-withdraw/queue", "store-queue"],
  ["/store-withdraw-link", "store-withdraw"], ["/store-withdraw-link/queue", "store-queue"], // ลิงก์แยก ไม่มี sidebar — สิทธิ์เดียวกับหน้าเดิม
  ["/store-withdraw/audit", "store-audit"],
  ["/store-withdraw/core-return", "core-return"],
  ["/admin", "admin"],
]

const API_PREFIXES: [string, Section | "admin"][] = [
  ["/api/sku", "sku"], ["/api/sku-convert", "sku"], ["/api/codes", "sku"], ["/api/vehicles", "sku"],
  ["/api/atms-sku-report", "sku"],
  ["/api/pr", "pr"], ["/api/order-tracking", "pr"], ["/api/po", "pr"],
  ["/api/ap-tracking", "ap"], ["/api/ap-suppliers", "ap"], ["/api/ap-doc-templates", "ap"],
  ["/api/price-compare", "price-compare"],
  ["/api/vendors", "vendor"], ["/api/rfq", "vendor"],
  ["/api/safety-stock", "safety-stock"],
  ["/api/deadstock", "deadstock"],
  ["/api/tire-change", "tire"], ["/api/tire-change-request", "tire"], ["/api/tire-due", "tire"],
  ["/api/tire-fleet", "tire"], ["/api/tire-master", "tire"], ["/api/tire-mr", "tire"],
  ["/api/tire-spec-master", "tire"], ["/api/tire-stock", "tire"], ["/api/tire-distance", "tire"],
  ["/api/tyre-sheet", "tire"],
  ["/api/repair-external", "repair"], ["/api/garage-master", "repair"], ["/api/garages", "repair"], ["/api/repair-plans", "repair"],
  ["/api/repair-history", "repair"], ["/api/vehicle-daily", "repair"],
  ["/api/driver-handover", "driver-handover"],
  ["/api/ai-mixer-maintenance", "ai-mixer"],
  ["/api/store-withdraw", "store-withdraw"], ["/api/store-withdraw/queue", "store-queue"], ["/api/store-withdraw/search", "store-queue"],
  ["/api/store-withdraw/atms-link", "store-queue"], ["/api/store-withdraw/live-stock", "store-queue"],
  ["/api/store-withdraw/audit", "store-audit"],
  ["/api/core-return", "core-return"],
  ["/api/admin", "admin"],
]

/** งานของสโตร์ที่มีเลขใบอยู่กลางทาง (/api/store-withdraw/:no/claim ฯลฯ) — เทียบ prefix ตรง ๆ ไม่ได้ จึงใช้ pattern */
const STORE_QUEUE_API = [
  /^\/api\/store-withdraw\/[^/]+\/(claim|lines|ready|issue|reject|close-manual|check|settle)$/,
  /^\/api\/store-withdraw\/[^/]+\/returns\/[^/]+\/accept$/,
]

/** แนบไฟล์หลักฐาน: ผู้ขอ (store-withdraw) หรือสโตร์ (store-queue แก้ได้) ก็เขียนได้ — route เช็กซ้ำว่าเป็นเจ้าของใบหรือสโตร์ */
const ATTACH_WRITE = /^\/api\/store-withdraw\/[^/]+\/attachments\/(presign|confirm)$/

/** API ที่หลายส่วนงานเรียกอ่าน (dropdown / รายชื่อ / ค้นหา) — อ่านได้ทุกคนที่ล็อกอิน การเขียนยังคุมตามเจ้าของ */
const SHARED_READ = [
  "/api/vehicles", "/api/vehicle-daily", "/api/codes", "/api/garage-master", "/api/garages", "/api/vendors/names",
  "/api/repair-history", "/api/sku",
]

/** ติดตามคำขอเปิด PO: ทุกคนที่ล็อกอินเปิดเรื่องใหม่ได้ (ผู้ใช้สั่ง 2026-11-06)
 *  เปิดให้แค่ หน้า + อ่านรายการ (API กรองตามแผนกอยู่แล้ว) + ค้น PR + POST สร้างเรื่อง
 *  แก้ไข / ลบ / รับเรื่อง / ความคิดเห็น ยังคุมด้วยสิทธิ์ pr ตามเดิม */
function orderTrackingOpen(pathname: string, api: boolean, read: boolean): boolean {
  if (!api) return pathname === "/order-tracking" || pathname === "/order-tracking/guide"
  if (pathname === "/api/order-tracking") return true // GET รายการ + POST เปิดเรื่องใหม่
  return read && pathname === "/api/order-tracking/pr-lookup"
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/")

function longest(path: string, table: [string, Section | "admin"][]): Section | "admin" | null {
  let best: [string, Section | "admin"] | null = null
  for (const e of table) if (under(path, e[0]) && (!best || e[0].length > best[0].length)) best = e
  return best ? best[1] : null
}

export const sectionForPage = (pathname: string) => longest(pathname, PAGE_PREFIXES)
export const sectionForApi = (pathname: string) =>
  STORE_QUEUE_API.some((r) => r.test(pathname)) ? "store-queue" : longest(pathname, API_PREFIXES)

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type Decision = { ok: true } | { ok: false; api: boolean; section: Section | "admin"; need: Level | "superadmin" }

/** ตัดสิน request ที่ล็อกอินแล้ว (เส้นทาง public / cron / x-api-key ถูกปล่อยผ่านก่อนถึงตรงนี้) */
export function checkRequest(p: { pathname: string; method: string; access: Access; isSuperAdmin: boolean; accounting?: boolean }): Decision {
  const api = p.pathname.startsWith("/api/")
  const section = api ? sectionForApi(p.pathname) : sectionForPage(p.pathname)
  if (!section) return { ok: true }
  if (section === "core-return") {
    const read = !api || READ_METHODS.has(p.method.toUpperCase())
    const action = read ? "read" : coreReturnActionForApi(p.pathname)
    if (action && coreReturnCan(p.access, action, { accounting: p.accounting })) return { ok: true }
    return { ok: false, api, section, need: read ? "view" : "edit" }
  }
  if (section === "admin") return p.isSuperAdmin ? { ok: true } : { ok: false, api, section, need: "superadmin" }
  const read = !api || READ_METHODS.has(p.method.toUpperCase())
  if (orderTrackingOpen(p.pathname, api, read)) return { ok: true }
  if (api && read && SHARED_READ.some((s) => under(p.pathname, s))) return { ok: true }
  // เบิกอะไหล่: คนที่เห็นคิวสโตร์อย่างเดียว (ไม่มีสิทธิ์ยื่นคำขอ) ยังต้องอ่านตัวเลือก/ค้นหา/รายละเอียดใบได้
  if (api && !read && ATTACH_WRITE.test(p.pathname) && atLeast(p.access["store-queue"], "edit")) return { ok: true }
  // ตรวจย้อนหลัง (audit) ต้องมีสิทธิ์ store-audit เท่านั้น ไม่ผ่านทางลัดของคิวสโตร์
  if (api && read && under(p.pathname, "/api/store-withdraw") && !under(p.pathname, "/api/store-withdraw/audit") && atLeast(p.access["store-queue"], "view")) return { ok: true }
  const need: Level = read ? "view" : "edit"
  return atLeast(p.access[section], need) ? { ok: true } : { ok: false, api, section, need }
}

// ── ติดตามซากอะไหล่ (/store-withdraw/core-return · /api/core-return) ─────────────────────────
// สิทธิ์ข้ามส่วนงาน: ดู = มีสิทธิ์ดูเบิกอะไหล่ / คิวสโตร์ / ติดตามซาก อย่างใดอย่างหนึ่ง
//   คืนซาก (return) = ผู้ขอเบิก (store-withdraw แก้ได้) หรือสโตร์ (store-queue แก้ได้)
//   ขายแล้ว / Rebuild เสร็จ = สโตร์เท่านั้น · ตามงาน (follow_up) = จัดซื้อ (core-return แก้ได้) หรือสโตร์
//   รอบขายซาก (round: สร้าง / ขายทั้งรอบ / ยกเลิก) = สโตร์ หรือจัดซื้อ
//   (2026-11-05) S1 ต้องผ่านบัญชีรับเข้าคลังซาก: รับซากกลับจากอู่นอก (pickup) = จัดซื้อ/สโตร์ · ยืนยันส่งต่อ (confirm) = ยานยนต์/สโตร์
//   รับเข้าคลังซาก (receive) / บันทึกขาย / รอบขาย = บัญชี (isAccounting: แผนก HR หรือรายชื่อ) · สโตร์ทำแทนได้ · จัดซื้อยังจัดรอบได้
export type CoreReturnAction = "read" | "return" | "pickup" | "confirm" | "receive" | "sold" | "rebuilt" | "follow_up" | "round"

export function coreReturnCan(a: Access, action: CoreReturnAction, ctx: { accounting?: boolean } = {}): boolean {
  const store = atLeast(a["store-queue"], "edit")
  const acc = !!ctx.accounting
  switch (action) {
    case "read": return acc || atLeast(a["store-withdraw"], "view") || atLeast(a["store-queue"], "view") || atLeast(a["core-return"], "view")
    case "return":
    case "confirm": return store || atLeast(a["store-withdraw"], "edit")
    case "pickup": return store || atLeast(a["core-return"], "edit")
    case "receive":
    case "sold": return store || acc
    case "rebuilt": return store
    case "follow_up":
    case "round": return store || acc || atLeast(a["core-return"], "edit")
  }
}

/** POST /api/core-return/rounds[/:no/(sold|cancel)] → round · POST /api/core-return/:key/(return|sold|rebuilt|follow-up) → action · POST /api/core-return/:key/attachments/(presign|confirm) → return · ทางเขียนอื่นใต้ /api/core-return = ไม่มี (ปฏิเสธ) */
export function coreReturnActionForApi(pathname: string): CoreReturnAction | null {
  if (/^\/api\/core-return\/rounds(\/[^/]+\/(sold|cancel))?$/.test(pathname)) return "round"
  if (pathname.startsWith("/api/core-return/rounds/")) return null
  if (/^\/api\/core-return\/[^/]+\/attachments\/(presign|confirm)$/.test(pathname)) return "return"
  const m = /^\/api\/core-return\/[^/]+\/(return|pickup|confirm|receive|sold|rebuilt|follow-up)$/.exec(pathname)
  return m ? (m[1] === "follow-up" ? "follow_up" : (m[1] as CoreReturnAction)) : null
}
