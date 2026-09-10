# Vendor RFQ (ฟอร์มขอราคาอู่ผ่านลิงก์) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Procurement creates a per-vendor public link from /vendors; the vendor fills labour and parts prices on two separate mobile pages without login; procurement reviews, confirms with a price-validity window, and exports Excel.

**Architecture:** Pure logic in `lib/rfq-core.ts` (no imports except repair-type-master + bkk-time), Mongo layer in `lib/rfq.ts`, session-guarded APIs under `/api/rfq/*`, public token APIs under `/api/q/*`, vendor pages under `/q/[token]` rendered outside the app sidebar. Catalog is imported once from the xlsx into `rfq_job_catalog` + `rfq_part_catalog`.

**Tech Stack:** Next.js 16 App Router (params are Promises), MongoDB driver 7, next-auth session (`getServerSession(authOptions)`), exceljs (dynamic import), tsx assert scripts (no test framework), Playwright MCP for visual check.

**Spec:** `docs/superpowers/specs/2026-09-10-vendor-rfq-design.md`

## Global Constraints

- DB name = `process.env.MONGO_DB ?? "master_data"`; client via `import clientPromise from "@/lib/mongo"`.
- Dates "YYYY-MM-DD" in Thai time via `bkkToday()`; ISO timestamps via `toBkkIso(new Date())` from `@/lib/bkk-time`. Never module-level "today" constants in `"use client"` files.
- Session helper pattern (copy verbatim in every `/api/rfq` route):
  ```ts
  async function me() {
    const s = await getServerSession(authOptions)
    return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
  }
  ```
- Admin gate for confirm/cancel: `canApproveVendor(email)` from `@/lib/roles`.
- Public routes `/q/*` and `/api/q/*` bypass middleware; token = access. Wrong token → 404.
- Public pages must never expose: other vendors, old prices, ราคากลาง, createdBy, confirm block.
- UI font style object `mitr = { fontFamily: "'Mitr', sans-serif" }` (from `@/components/vendor-shared`); toasts via `swalToast`/`swalError` from `@/lib/swal` (procurement pages only; vendor pages use inline status text).
- Vendor pages: mobile-first, inputs `inputMode="decimal"`, tap targets ≥ 44px, no exceljs/pdf imports.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PQXzbREh7TXUjJkeM7pH3q
  ```
- Run `npx tsc --noEmit -p .` and `npx eslint <files>` before every commit.
- Excel catalog source: `/Users/menatransport_02/Documents/project/ฟอร์มขอราคา_งานช่างมาตรฐาน_MixerL-S.xlsx` — sheets whose name starts with `S\d+ ` or `SVC ` (13 sheets). Row 8 = labour header (`ลำดับ | รหัสงาน | ชื่องาน | ขอบเขตงานที่รวมในราคา | เกณฑ์แบ่งระดับ… | ชม.อ้างอิง L | ชม.อ้างอิง S | …`), rows 9.. until a row whose col A starts with `ส่วนที่ 2`; then the next row with col A = `ลำดับ` is the parts header (`ลำดับ | รหัสอะไหล่ | รายการอะไหล่ | ใช้กับ | หน่วย | …`), parts rows until end. Expected totals: 99 jobs (28/15/10/7/7/4/4/4/5/4/4/3/4) and 843 parts.

---

## File map

| File | Responsibility |
|---|---|
| `lib/rfq-core.ts` | types, `SHEET_OF_CODE`, `sheetsForVendor`, `newToken`, `effectiveStatus`, `canVendorWrite`, `progress`, `validateAnswer`, `validatePartAnswer`, `applySameAsL`, `partKey`, status transition table |
| `lib/rfq.ts` | Mongo: catalog read, invite CRUD, log write/read, public token lookup |
| `lib/rfq-xlsx.ts` | Excel export (exceljs, server side) |
| `scripts/import-rfq-catalog.ts` | xlsx → `rfq_job_catalog` + `rfq_part_catalog` |
| `scripts/check-rfq-core.ts` | asserts for core |
| `scripts/check-rfq-api.sh` | curl flow against dev server |
| `app/api/rfq/route.ts` | POST create invites, GET list |
| `app/api/rfq/catalog/route.ts` | GET latest catalog summary (sheets + counts) |
| `app/api/rfq/[id]/route.ts` | GET full, PATCH actions |
| `app/api/rfq/[id]/log/route.ts` | GET log |
| `app/api/rfq/[id]/xlsx/route.ts` | GET Excel |
| `app/api/q/[token]/route.ts` | public GET, PATCH |
| `app/api/q/[token]/submit/route.ts` | public POST submit |
| `app/rfq/page.tsx` + `components/rfq-list-page.tsx` | procurement list |
| `app/rfq/[id]/page.tsx` + `components/rfq-review-page.tsx` | review + confirm/return/cancel/extend + tabs |
| `app/q/[token]/page.tsx` + `components/rfq-vendor-hub.tsx` | identity + hub + submit |
| `app/q/[token]/labour/page.tsx` + `components/rfq-vendor-labour.tsx` | labour wizard |
| `app/q/[token]/parts/page.tsx` + `components/rfq-vendor-parts.tsx` | parts wizard |
| `components/rfq-vendor-shared.tsx` | `useInvite(token)` hook, autosave, shared styles |
| `components/rfq-create-modal.tsx` | create-links modal used from /vendors |
| `components/vendor-matrix-page.tsx` | add row checkboxes + "ขอราคา" button |
| `components/app-shell.tsx` | bypass shell for `/q/` |
| `middleware.ts` | bypass auth for `/q/` and `/api/q/` |
| `lib/nav.ts` | add `/rfq` |

---

### Task 1: Core types, sheet mapping, token, status logic

**Files:**
- Create: `lib/rfq-core.ts`
- Test: `scripts/check-rfq-core.ts`

**Interfaces:**
- Produces (used by every later task):
  ```ts
  export type RfqSection = "labour" | "parts"
  export type RfqStatus = "สร้างแล้ว" | "กำลังกรอก" | "ส่งแล้ว" | "ยืนยันแล้ว" | "ส่งกลับแก้" | "ยกเลิก"
  export type RfqJob = { sheet: string; sheetTitle: string; seq: number; jobCode: string; name: string; scope: string; tierCriteria: string; refHoursL: number | null; refHoursS: number | null; version: number; active: boolean }
  export type RfqPart = { sheet: string; sheetTitle: string; seq: number; sku: string; name: string; useWith: string; unit: string; version: number; active: boolean }
  export type Tier = { rate?: number; hours?: number; light?: number; mid?: number; heavy?: number }
  export type RfqAnswer = { mode: "hourly" | "lump" | "skip"; L: Tier; S: Tier; sameAsL: boolean; warrantyMonths?: number; note: string; at: string }
  export type RfqPartAnswer = { skip: boolean; priceL?: number; priceS?: number; sameAsL: boolean; brand: string; warrantyMonths?: number; leadDays?: number; note: string; at: string }
  export type RfqContact = { name: string; phone: string; email: string; confirmedVendor: boolean; at: string }
  export type RfqConfirm = { by: string; email: string; at: string; validFrom: string; validTo: string; note: string }
  export type RfqInvite = { _id?: string; token: string; vendor: string; sheets: string[]; sections: RfqSection[]; catalogVersion: number; title: string; deadline: string; status: RfqStatus; contact: RfqContact | null; openedAt: string | null; items: Record<string, RfqAnswer>; parts: Record<string, RfqPartAnswer>; submittedAt: string | null; submitNote: string; confirm: RfqConfirm | null; returnNote: string; createdBy: { name: string; email: string }; createdAt: string; updatedAt: string }
  export type RfqLogAction = "create" | "open" | "contact" | "submit" | "confirm" | "return" | "cancel" | "extend"
  export type RfqLogEntry = { inviteId: string; action: RfqLogAction; from?: string; to?: string; by: string; byEmail: string; note?: string; at: Date }
  export const SVC_SHEET = "SVC"
  export const SHEET_OF_CODE: Record<string, string>
  export function sheetsForVendor(codes: string[]): string[]          // sorted by SHEET_ORDER, SVC always last
  export const SHEET_ORDER: string[]                                  // ["S45","S37","S39","S35","S33","S47","S61","S59","S31","S43","S65","S85","SVC"]
  export function newToken(): string                                  // 24 chars base64url
  export type EffectiveStatus = RfqStatus | "หมดอายุ"
  export function effectiveStatus(inv: Pick<RfqInvite,"status"|"deadline">, today: string): EffectiveStatus
  export function canVendorWrite(inv: Pick<RfqInvite,"status"|"deadline">, today: string): boolean
  export function canTransition(from: RfqStatus, action: "submit"|"confirm"|"return"|"cancel"|"extend"): boolean
  export function progress(inv: Pick<RfqInvite,"items"|"parts"|"sheets"|"sections">, jobs: RfqJob[], parts: RfqPart[]): { labour: { done: number; total: number }; parts: { done: number; total: number } }
  export function partKey(sheet: string, sku: string): string        // `${sheet}|${sku}`
  export function applySameAsL(a: RfqAnswer): RfqAnswer               // copies L → S when sameAsL
  export function applyPartSameAsL(a: RfqPartAnswer): RfqPartAnswer
  export function validateAnswer(x: unknown): RfqAnswer | string      // returns cleaned answer or error text
  export function validatePartAnswer(x: unknown): RfqPartAnswer | string
  export function validateContact(x: unknown): Omit<RfqContact,"at"> | string
  export const STATUS_META: Record<EffectiveStatus, { bg: string; fg: string }>
  export function addDays(ymd: string, n: number): string
  export function addMonths(ymd: string, n: number): string
  ```

- [ ] **Step 1: Write the failing test**

`scripts/check-rfq-core.ts`:
```ts
// scripts/check-rfq-core.ts — รัน: npx tsx scripts/check-rfq-core.ts
import assert from "node:assert/strict"
import {
  sheetsForVendor, newToken, effectiveStatus, canVendorWrite, canTransition, progress, partKey,
  applySameAsL, validateAnswer, validatePartAnswer, validateContact, addDays, addMonths, SHEET_ORDER,
  type RfqInvite, type RfqJob, type RfqPart,
} from "../lib/rfq-core"

// จับคู่ช่องที่ติ๊ก → ชีต
assert.deepEqual(sheetsForVendor([]), ["SVC"], "ทุกอู่ได้ SVC เสมอ")
assert.deepEqual(sheetsForVendor(["S45"]), ["S45", "SVC"])
assert.deepEqual(sheetsForVendor(["S49"]), ["S37", "SVC"], "เกียร์อู่นอก → ชีตรวมเบรก-ครัช-เกียร์")
assert.deepEqual(sheetsForVendor(["S37", "S49"]), ["S37", "SVC"], "ไม่ซ้ำ")
assert.deepEqual(sheetsForVendor(["S67"]), ["S65", "SVC"], "PM ตัวไหนก็ได้ชีต PM")
assert.deepEqual(sheetsForVendor(["S41"]), ["SVC"], "ยาง (S41 อู่นอก-T-ปะยาง) ไม่มีชีต")
assert.deepEqual(sheetsForVendor(["S44"]), ["SVC"], "อู่ใน ไม่มีชีต")
assert.deepEqual(sheetsForVendor(["S85", "S45", "S33"]), ["S45", "S33", "S85", "SVC"], "เรียงตาม SHEET_ORDER")
assert.equal(SHEET_ORDER.length, 13)

// token
const t = newToken()
assert.match(t, /^[A-Za-z0-9_-]{24}$/)
assert.notEqual(t, newToken())

// สถานะที่มีผล + สิทธิ์เขียนของอู่
const base = { status: "กำลังกรอก" as const, deadline: "2026-09-20" }
assert.equal(effectiveStatus(base, "2026-09-20"), "กำลังกรอก", "วันปิดรับยังกรอกได้")
assert.equal(effectiveStatus(base, "2026-09-21"), "หมดอายุ")
assert.equal(effectiveStatus({ status: "ส่งแล้ว", deadline: "2026-09-01" }, "2026-09-21"), "ส่งแล้ว", "ส่งแล้วไม่หมดอายุ")
assert.equal(effectiveStatus({ status: "ยืนยันแล้ว", deadline: "2026-09-01" }, "2026-09-21"), "ยืนยันแล้ว")
assert.equal(canVendorWrite(base, "2026-09-20"), true)
assert.equal(canVendorWrite(base, "2026-09-21"), false)
assert.equal(canVendorWrite({ status: "ส่งกลับแก้", deadline: "2026-09-30" }, "2026-09-21"), true)
assert.equal(canVendorWrite({ status: "ส่งแล้ว", deadline: "2026-09-30" }, "2026-09-21"), false)
assert.equal(canVendorWrite({ status: "ยกเลิก", deadline: "2026-09-30" }, "2026-09-21"), false)

// ตารางเปลี่ยนสถานะ
assert.equal(canTransition("กำลังกรอก", "submit"), true)
assert.equal(canTransition("ส่งกลับแก้", "submit"), true)
assert.equal(canTransition("สร้างแล้ว", "submit"), false, "ยังไม่มี contact")
assert.equal(canTransition("ส่งแล้ว", "confirm"), true)
assert.equal(canTransition("กำลังกรอก", "confirm"), false)
assert.equal(canTransition("ส่งแล้ว", "return"), true)
assert.equal(canTransition("ยืนยันแล้ว", "cancel"), false)
assert.equal(canTransition("กำลังกรอก", "cancel"), true)
assert.equal(canTransition("ยืนยันแล้ว", "extend"), false)
assert.equal(canTransition("กำลังกรอก", "extend"), true)

// ความคืบหน้า นับเฉพาะชีตที่ให้
const J = (sheet: string, jobCode: string): RfqJob => ({ sheet, sheetTitle: "", seq: 1, jobCode, name: "", scope: "", tierCriteria: "", refHoursL: 1, refHoursS: 1, version: 1, active: true })
const P = (sheet: string, sku: string): RfqPart => ({ sheet, sheetTitle: "", seq: 1, sku, name: "", useWith: "L+S", unit: "ชิ้น", version: 1, active: true })
const jobs = [J("S45", "A"), J("S45", "B"), J("S37", "C"), J("SVC", "D")]
const parts = [P("S45", "X"), P("S37", "Y")]
const inv = { sheets: ["S45", "SVC"], sections: ["labour", "parts"] as const,
  items: { A: { mode: "skip", L: {}, S: {}, sameAsL: false, note: "", at: "" }, C: { mode: "skip", L: {}, S: {}, sameAsL: false, note: "", at: "" } },
  parts: { [partKey("S45", "X")]: { skip: true, sameAsL: false, brand: "", note: "", at: "" } } } as unknown as Pick<RfqInvite, "items" | "parts" | "sheets" | "sections">
const pg = progress(inv, jobs, parts)
assert.deepEqual(pg.labour, { done: 1, total: 3 }, "C อยู่ชีตที่ไม่ได้ให้ ไม่นับ")
assert.deepEqual(pg.parts, { done: 1, total: 1 })
assert.deepEqual(progress({ ...inv, sections: ["labour"] }, jobs, parts).parts, { done: 0, total: 0 }, "ไม่ให้ส่วนอะไหล่ = 0/0")

// sameAsL
const a = applySameAsL({ mode: "lump", L: { light: 1000, mid: 2000, heavy: 3000 }, S: { light: 5 }, sameAsL: true, note: "", at: "" })
assert.deepEqual(a.S, { light: 1000, mid: 2000, heavy: 3000 })
const b = applySameAsL({ mode: "lump", L: { light: 1000 }, S: { light: 5 }, sameAsL: false, note: "", at: "" })
assert.deepEqual(b.S, { light: 5 })

// validateAnswer
assert.equal(typeof validateAnswer({ mode: "bogus" }), "string")
assert.equal(typeof validateAnswer({ mode: "hourly", L: { rate: -1 } }), "string", "ติดลบไม่รับ")
assert.equal(typeof validateAnswer({ mode: "hourly", L: { rate: 10_000_000 } }), "string", "เกินเพดาน")
const ok = validateAnswer({ mode: "hourly", L: { rate: "450", hours: 2 }, S: {}, sameAsL: true, warrantyMonths: "3", note: " x ".repeat(300) })
assert.notEqual(typeof ok, "string")
if (typeof ok !== "string") {
  assert.equal(ok.L.rate, 450, "string ตัวเลข → number")
  assert.equal(ok.S.rate, 450, "sameAsL ถูก apply ตอน validate")
  assert.equal(ok.warrantyMonths, 3)
  assert.ok(ok.note.length <= 500)
  assert.ok(ok.at)
}
// validatePartAnswer
assert.equal(typeof validatePartAnswer({ priceL: -5 }), "string")
const pk = validatePartAnswer({ skip: false, priceL: 120.5, sameAsL: true, brand: "NOK", leadDays: "7" })
assert.notEqual(typeof pk, "string")
if (typeof pk !== "string") { assert.equal(pk.priceS, 120.5); assert.equal(pk.leadDays, 7) }
// validateContact
assert.equal(typeof validateContact({ name: "ก", phone: "", email: "" }), "string", "ต้องมีเบอร์หรืออีเมล")
assert.equal(typeof validateContact({ name: "", phone: "081", email: "" }), "string")
assert.equal(typeof validateContact({ name: "ก", phone: "081", email: "", confirmedVendor: false }), "string", "ต้องติ๊กยืนยันชื่ออู่")
assert.notEqual(typeof validateContact({ name: "ก", phone: "0812345678", email: "", confirmedVendor: true }), "string")

// วันที่
assert.equal(addDays("2026-09-10", 14), "2026-09-24")
assert.equal(addDays("2026-12-25", 10), "2027-01-04")
assert.equal(addMonths("2026-09-10", 12), "2027-09-10")
assert.equal(addMonths("2026-01-31", 1), "2026-02-28", "ปลายเดือนไม่ล้น")

console.log("✅ rfq-core: ผ่านทั้งหมด")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/project/master-sku-web && npx tsx scripts/check-rfq-core.ts`
Expected: FAIL — cannot find module `../lib/rfq-core`

- [ ] **Step 3: Write the implementation**

`lib/rfq-core.ts`:
```ts
// lib/rfq-core.ts
// ตรรกะล้วนของฟอร์มขอราคาอู่ (Vendor RFQ) — import ได้แค่ทะเบียนประเภทการซ่อม
// เพื่อให้ทดสอบตรง ๆ ด้วย tsx และให้ฝั่งจอ/ฝั่ง API ใช้กฎชุดเดียวกัน
// spec: docs/superpowers/specs/2026-09-10-vendor-rfq-design.md
import { REPAIR_TYPES, byCode } from "@/lib/repair-type-master"

export type RfqSection = "labour" | "parts"
export type RfqStatus = "สร้างแล้ว" | "กำลังกรอก" | "ส่งแล้ว" | "ยืนยันแล้ว" | "ส่งกลับแก้" | "ยกเลิก"
export type EffectiveStatus = RfqStatus | "หมดอายุ"

export type RfqJob = {
  sheet: string; sheetTitle: string; seq: number; jobCode: string; name: string
  scope: string; tierCriteria: string; refHoursL: number | null; refHoursS: number | null
  version: number; active: boolean
}
export type RfqPart = {
  sheet: string; sheetTitle: string; seq: number; sku: string; name: string
  useWith: string; unit: string; version: number; active: boolean
}
export type Tier = { rate?: number; hours?: number; light?: number; mid?: number; heavy?: number }
export type RfqAnswer = {
  mode: "hourly" | "lump" | "skip"; L: Tier; S: Tier; sameAsL: boolean
  warrantyMonths?: number; note: string; at: string
}
export type RfqPartAnswer = {
  skip: boolean; priceL?: number; priceS?: number; sameAsL: boolean
  brand: string; warrantyMonths?: number; leadDays?: number; note: string; at: string
}
export type RfqContact = { name: string; phone: string; email: string; confirmedVendor: boolean; at: string }
export type RfqConfirm = { by: string; email: string; at: string; validFrom: string; validTo: string; note: string }
export type RfqInvite = {
  _id?: string
  token: string; vendor: string; sheets: string[]; sections: RfqSection[]; catalogVersion: number
  title: string; deadline: string; status: RfqStatus
  contact: RfqContact | null; openedAt: string | null
  items: Record<string, RfqAnswer>; parts: Record<string, RfqPartAnswer>
  submittedAt: string | null; submitNote: string
  confirm: RfqConfirm | null; returnNote: string
  createdBy: { name: string; email: string }; createdAt: string; updatedAt: string
}
export type RfqLogAction = "create" | "open" | "contact" | "submit" | "confirm" | "return" | "cancel" | "extend"
export type RfqLogEntry = {
  inviteId: string; action: RfqLogAction; from?: string; to?: string
  by: string; byEmail: string; note?: string; at: Date
}

// ── ชีต ─────────────────────────────────────────────────────────────────────
export const SVC_SHEET = "SVC"
/** ลำดับชีตตามไฟล์ต้นฉบับ — ใช้เรียงทุกที่ */
export const SHEET_ORDER = ["S45", "S37", "S39", "S35", "S33", "S47", "S61", "S59", "S31", "S43", "S65", "S85", SVC_SHEET]

/** รหัสที่ติ๊กในตารางความสามารถ (อู่นอก) → ชีตในฟอร์ม (spec §2.4)
 *  ทำจากทะเบียนเพื่อไม่ต้องจำเลข: จับด้วยชื่องาน (work) ยกเว้นที่ระบุตรง ๆ */
export const SHEET_OF_CODE: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  const WORK_TO_SHEET: Record<string, string> = {
    "ระบบโม่": "S45", "ระบบเบรกและคลัตช์": "S37", "ระบบเกียร์": "S37", "ระบบแอร์และไฟ": "S39",
    "ระบบช่วงล่าง": "S35", "ระบบเครื่องยนต์": "S33", "ระบบหม้อน้ำและท่อไอเสีย": "S47",
    "ระบบเชื้อเพลิง": "S61", "ระบบลม": "S59", "ระบบหัวเก๋ง": "S31", "ปะผุและทำสี": "S43", "ทำความสะอาด": "S85",
  }
  for (const r of REPAIR_TYPES) {
    if (r.side !== "อู่นอก") continue
    if (r.group === "PM") { out[r.code] = "S65"; continue }
    const s = WORK_TO_SHEET[r.work]
    if (s) out[r.code] = s
  }
  return out
})()

export function sheetsForVendor(codes: string[]): string[] {
  const set = new Set<string>([SVC_SHEET])
  for (const c of codes) { const s = SHEET_OF_CODE[c]; if (s && byCode(c)) set.add(s) }
  return SHEET_ORDER.filter((s) => set.has(s))
}

// ── token ────────────────────────────────────────────────────────────────────
/** 18 ไบต์สุ่ม → base64url 24 ตัว · ใช้ Web Crypto ที่มีทั้ง Node ≥19 และ edge */
export function newToken(): string {
  const bytes = new Uint8Array(18)
  globalThis.crypto.getRandomValues(bytes)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ── สถานะ ────────────────────────────────────────────────────────────────────
const OPEN_STATUSES = new Set<RfqStatus>(["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้"])

export function effectiveStatus(inv: Pick<RfqInvite, "status" | "deadline">, today: string): EffectiveStatus {
  if (OPEN_STATUSES.has(inv.status) && inv.deadline < today) return "หมดอายุ"
  return inv.status
}

export function canVendorWrite(inv: Pick<RfqInvite, "status" | "deadline">, today: string): boolean {
  return OPEN_STATUSES.has(inv.status) && inv.deadline >= today
}

const TRANSITIONS: Record<"submit" | "confirm" | "return" | "cancel" | "extend", Set<RfqStatus>> = {
  submit:  new Set(["กำลังกรอก", "ส่งกลับแก้"]),
  confirm: new Set(["ส่งแล้ว"]),
  return:  new Set(["ส่งแล้ว"]),
  cancel:  new Set(["สร้างแล้ว", "กำลังกรอก", "ส่งแล้ว", "ส่งกลับแก้"]),
  extend:  new Set(["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้"]),
}
export function canTransition(from: RfqStatus, action: keyof typeof TRANSITIONS): boolean {
  return TRANSITIONS[action].has(from)
}

export const STATUS_META: Record<EffectiveStatus, { bg: string; fg: string }> = {
  "สร้างแล้ว":  { bg: "#F4F4F5", fg: "#52525B" },
  "กำลังกรอก":  { bg: "#EFF6FF", fg: "#1D4ED8" },
  "ส่งแล้ว":    { bg: "#FFFBEB", fg: "#92400E" },
  "ยืนยันแล้ว": { bg: "#ECFDF5", fg: "#047857" },
  "ส่งกลับแก้": { bg: "#FFF7ED", fg: "#C2410C" },
  "ยกเลิก":     { bg: "#FEF2F2", fg: "#B91C1C" },
  "หมดอายุ":    { bg: "#F4F4F5", fg: "#9CA3AF" },
}

// ── ความคืบหน้า ──────────────────────────────────────────────────────────────
export function partKey(sheet: string, sku: string): string { return `${sheet}|${sku}` }

export function progress(
  inv: Pick<RfqInvite, "items" | "parts" | "sheets" | "sections">,
  jobs: RfqJob[], parts: RfqPart[]
): { labour: { done: number; total: number }; parts: { done: number; total: number } } {
  const sheets = new Set(inv.sheets)
  const hasL = inv.sections.includes("labour"), hasP = inv.sections.includes("parts")
  const js = hasL ? jobs.filter((j) => sheets.has(j.sheet)) : []
  const ps = hasP ? parts.filter((p) => sheets.has(p.sheet)) : []
  return {
    labour: { done: js.filter((j) => !!inv.items[j.jobCode]).length, total: js.length },
    parts:  { done: ps.filter((p) => !!inv.parts[partKey(p.sheet, p.sku)]).length, total: ps.length },
  }
}

// ── ตรวจค่าที่อู่ส่งมา ─────────────────────────────────────────────────────────
const MAX_NUM = 9_999_999
const NOTE_MAX = 500
const num = (v: unknown): number | undefined | string => {
  if (v === undefined || v === null || v === "") return undefined
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))
  if (!Number.isFinite(n)) return "ตัวเลขไม่ถูกต้อง"
  if (n < 0) return "ตัวเลขต้องไม่ติดลบ"
  if (n > MAX_NUM) return "ตัวเลขเกินเพดาน"
  return Math.round(n * 100) / 100
}
const str = (v: unknown, max = NOTE_MAX) => String(v ?? "").trim().slice(0, max)
const nowIso = () => new Date().toISOString()

function tier(x: unknown): Tier | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const out: Tier = {}
  for (const k of ["rate", "hours", "light", "mid", "heavy"] as const) {
    const n = num(o[k]); if (typeof n === "string") return `${k}: ${n}`
    if (n !== undefined) out[k] = n
  }
  return out
}

export function applySameAsL(a: RfqAnswer): RfqAnswer {
  return a.sameAsL ? { ...a, S: { ...a.L } } : a
}
export function applyPartSameAsL(a: RfqPartAnswer): RfqPartAnswer {
  return a.sameAsL ? { ...a, priceS: a.priceL } : a
}

export function validateAnswer(x: unknown): RfqAnswer | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const mode = o.mode
  if (mode !== "hourly" && mode !== "lump" && mode !== "skip") return "mode ไม่ถูกต้อง"
  const L = tier(o.L); if (typeof L === "string") return `L ${L}`
  const S = tier(o.S); if (typeof S === "string") return `S ${S}`
  const w = num(o.warrantyMonths); if (typeof w === "string") return `รับประกัน: ${w}`
  return applySameAsL({
    mode, L, S, sameAsL: !!o.sameAsL,
    ...(w !== undefined ? { warrantyMonths: w } : {}),
    note: str(o.note), at: nowIso(),
  })
}

export function validatePartAnswer(x: unknown): RfqPartAnswer | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const pl = num(o.priceL); if (typeof pl === "string") return `฿ L: ${pl}`
  const ps = num(o.priceS); if (typeof ps === "string") return `฿ S: ${ps}`
  const w = num(o.warrantyMonths); if (typeof w === "string") return `รับประกัน: ${w}`
  const d = num(o.leadDays); if (typeof d === "string") return `ส่งมอบ: ${d}`
  return applyPartSameAsL({
    skip: !!o.skip, sameAsL: !!o.sameAsL,
    ...(pl !== undefined ? { priceL: pl } : {}), ...(ps !== undefined ? { priceS: ps } : {}),
    brand: str(o.brand, 120),
    ...(w !== undefined ? { warrantyMonths: w } : {}), ...(d !== undefined ? { leadDays: d } : {}),
    note: str(o.note), at: nowIso(),
  })
}

export function validateContact(x: unknown): Omit<RfqContact, "at"> | string {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const name = str(o.name, 120), phone = str(o.phone, 40), email = str(o.email, 120)
  if (!name) return "กรุณากรอกชื่อผู้ติดต่อ"
  if (!phone && !email) return "กรุณากรอกเบอร์โทรหรืออีเมลอย่างน้อย 1 อย่าง"
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "อีเมลไม่ถูกต้อง"
  if (!o.confirmedVendor) return "กรุณาติ๊กยืนยันชื่ออู่"
  return { name, phone, email, confirmedVendor: true }
}

// ── วันที่ (YYYY-MM-DD ล้วน ไม่ยุ่งกับ timezone) ──────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0")
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/check-rfq-core.ts`
Expected: `✅ rfq-core: ผ่านทั้งหมด`. If the S41/S44/S49/S67 asserts fail, check `lib/repair-type-master.ts` for the real codes of ปะยาง (อู่นอก), ระบบโม่ (อู่ใน), ระบบเกียร์ (อู่นอก), any PM (อู่นอก) and fix the test codes, not the mapping.

- [ ] **Step 5: Commit**

```bash
git add lib/rfq-core.ts scripts/check-rfq-core.ts
git commit -m "rfq: core types, sheet mapping, status rules, validators (+check script)"
```

---

### Task 2: Catalog import script

**Files:**
- Create: `scripts/import-rfq-catalog.ts`

**Interfaces:**
- Produces collections `rfq_job_catalog` (RfqJob docs) and `rfq_part_catalog` (RfqPart docs), and `rfq_catalog_meta` `{ _id: "latest", version: number, importedAt: string, jobs: number, parts: number }`.

- [ ] **Step 1: Write the script**

```ts
// scripts/import-rfq-catalog.ts
// นำเข้าแคตตาล็อกงานช่าง + อะไหล่ จากฟอร์ม xlsx → rfq_job_catalog / rfq_part_catalog
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/import-rfq-catalog.ts "<path.xlsx>" [--apply]
// ไม่ใส่ --apply = dry run พิมพ์สรุปต่อชีต · --apply = version+1, upsert ทุกแถว, ที่หายไป active=false
import * as XLSX from "xlsx"
import clientPromise from "../lib/mongo"
import { SHEET_ORDER, type RfqJob, type RfqPart } from "../lib/rfq-core"

const DB = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => String(v ?? "").trim()
const n = (v: unknown): number | null => { const x = Number(v); return v === "" || v == null || !Number.isFinite(x) ? null : x }

function parseSheet(ws: XLSX.WorkSheet, sheet: string, sheetTitle: string) {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" })
  const jobs: Omit<RfqJob, "version" | "active">[] = []
  const parts: Omit<RfqPart, "version" | "active">[] = []
  let section: 0 | 1 | 2 = 0
  for (const r of rows) {
    const a = s(r[0])
    if (a.startsWith("ส่วนที่ 1")) { section = 1; continue }
    if (a.startsWith("ส่วนที่ 2")) { section = 2; continue }
    if (a === "ลำดับ") continue
    if (!/^\d+$/.test(a)) continue
    if (section === 1 && s(r[1])) {
      jobs.push({ sheet, sheetTitle, seq: +a, jobCode: s(r[1]), name: s(r[2]), scope: s(r[3]),
        tierCriteria: s(r[4]), refHoursL: n(r[5]), refHoursS: n(r[6]) })
    } else if (section === 2 && s(r[1])) {
      parts.push({ sheet, sheetTitle, seq: +a, sku: s(r[1]), name: s(r[2]), useWith: s(r[3]) || "L+S", unit: s(r[4]) })
    }
  }
  return { jobs, parts }
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes("--apply")
  if (!file) { console.error("usage: import-rfq-catalog.ts <xlsx> [--apply]"); process.exit(1) }
  const wb = XLSX.readFile(file)
  const allJobs: Omit<RfqJob, "version" | "active">[] = []
  const allParts: Omit<RfqPart, "version" | "active">[] = []
  for (const name of wb.SheetNames) {
    const m = /^(S\d+|SVC)\s+(.*)$/.exec(name)
    if (!m) continue
    const { jobs, parts } = parseSheet(wb.Sheets[name], m[1], m[2].trim())
    console.log(`${m[1].padEnd(4)} ${m[2].padEnd(30)} งาน ${String(jobs.length).padStart(3)} · อะไหล่ ${String(parts.length).padStart(3)}`)
    allJobs.push(...jobs); allParts.push(...parts)
  }
  const unknownSheets = [...new Set(allJobs.map((j) => j.sheet))].filter((x) => !SHEET_ORDER.includes(x))
  if (unknownSheets.length) throw new Error(`ชีตที่ไม่อยู่ใน SHEET_ORDER: ${unknownSheets.join(", ")}`)
  const dupJobs = allJobs.map((j) => j.jobCode).filter((c, i, arr) => arr.indexOf(c) !== i)
  if (dupJobs.length) throw new Error(`jobCode ซ้ำ: ${[...new Set(dupJobs)].join(", ")}`)
  console.log(`\nรวม งาน ${allJobs.length} · อะไหล่ ${allParts.length}`)
  if (!apply) { console.log("(dry run — ใส่ --apply เพื่อเขียนจริง)"); process.exit(0) }

  const client = await clientPromise
  const db = client.db(DB)
  const meta = db.collection("rfq_catalog_meta")
  const prev = await meta.findOne<{ version: number }>({ _id: "latest" as never })
  const version = (prev?.version ?? 0) + 1
  const jobCol = db.collection<RfqJob>("rfq_job_catalog")
  const partCol = db.collection<RfqPart>("rfq_part_catalog")
  await jobCol.createIndex({ jobCode: 1 }, { unique: true })
  await jobCol.createIndex({ sheet: 1, seq: 1 })
  await partCol.createIndex({ sheet: 1, sku: 1 }, { unique: true })
  await jobCol.bulkWrite(allJobs.map((j) => ({ updateOne: { filter: { jobCode: j.jobCode }, update: { $set: { ...j, version, active: true } }, upsert: true } })))
  await partCol.bulkWrite(allParts.map((p) => ({ updateOne: { filter: { sheet: p.sheet, sku: p.sku }, update: { $set: { ...p, version, active: true } }, upsert: true } })))
  const j0 = await jobCol.updateMany({ version: { $lt: version }, active: true }, { $set: { active: false } })
  const p0 = await partCol.updateMany({ version: { $lt: version }, active: true }, { $set: { active: false } })
  await meta.updateOne({ _id: "latest" as never }, { $set: { version, importedAt: new Date().toISOString(), jobs: allJobs.length, parts: allParts.length } }, { upsert: true })
  console.log(`✅ version ${version} · งาน ${allJobs.length} · อะไหล่ ${allParts.length} · ปิดใช้ของเก่า งาน ${j0.modifiedCount} อะไหล่ ${p0.modifiedCount}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Dry run and check counts**

Run: `node -r dotenv/config node_modules/.bin/tsx scripts/import-rfq-catalog.ts "/Users/menatransport_02/Documents/project/ฟอร์มขอราคา_งานช่างมาตรฐาน_MixerL-S.xlsx"`
Expected: 13 lines, per-sheet jobs 28/15/10/7/7/4/4/4/5/4/4/3/4, total `งาน 99 · อะไหล่ 843`. If parts total differs slightly, print the first parts row per sheet and verify the header offset (col index of `รหัสอะไหล่` must be 1).

- [ ] **Step 3: Apply**

Run the same command with `--apply`. Expected: `✅ version 1 · งาน 99 · อะไหล่ 843`.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-rfq-catalog.ts
git commit -m "rfq: import job + part catalog from xlsx (versioned, idempotent)"
```

---

### Task 3: Mongo layer `lib/rfq.ts`

**Files:**
- Create: `lib/rfq.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  ```ts
  export const INVITE_COLL = "rfq_invites"; export const LOG_COLL = "rfq_log"
  export async function getCatalog(version?: number): Promise<{ version: number; jobs: RfqJob[]; parts: RfqPart[] }>  // version omitted = latest (active only)
  export async function catalogSummary(): Promise<{ version: number; sheets: { sheet: string; title: string; jobs: number; parts: number }[] }>
  export async function createInvites(input: { title: string; deadline: string; invites: { vendor: string; sheets: string[]; sections: RfqSection[] }[] }, by: { name: string; email: string }): Promise<RfqInvite[]>
  export async function listInvites(f: { status?: string; title?: string; q?: string }): Promise<(Omit<RfqInvite,"items"|"parts"> & { answered: { labour: number; parts: number }; total: { labour: number; parts: number }; effective: EffectiveStatus })[]>
  export async function getInvite(id: string): Promise<RfqInvite | null>
  export async function getInviteByToken(token: string): Promise<RfqInvite | null>
  export async function markOpened(token: string): Promise<void>
  export async function saveContact(token: string, c: Omit<RfqContact,"at">): Promise<RfqInvite>
  export async function saveAnswers(token: string, items: Record<string, RfqAnswer>, parts: Record<string, RfqPartAnswer>): Promise<void>
  export async function submitInvite(token: string, submitNote: string): Promise<RfqInvite>
  export async function actOnInvite(id: string, action: "confirm"|"return"|"cancel"|"extend", payload: { validFrom?: string; validTo?: string; note?: string; deadline?: string }, by: { name: string; email: string }): Promise<RfqInvite>   // throws Error("409:<msg>") on bad transition
  export async function listLog(id: string): Promise<RfqLogEntry[]>
  export function serialize(inv: WithId<RfqInvite>): RfqInvite   // _id → string
  ```

- [ ] **Step 1: Write the implementation**

```ts
// lib/rfq.ts — ชั้นคุย MongoDB ของ Vendor RFQ · ตรรกะอยู่ใน rfq-core
import { ObjectId, type WithId, type Document } from "mongodb"
import clientPromise from "@/lib/mongo"
import { bkkToday, toBkkIso } from "@/lib/bkk-time"
import {
  newToken, effectiveStatus, canTransition, canVendorWrite, progress, SVC_SHEET, SHEET_ORDER,
  type RfqInvite, type RfqJob, type RfqPart, type RfqAnswer, type RfqPartAnswer, type RfqContact,
  type RfqLogEntry, type RfqSection, type EffectiveStatus,
} from "@/lib/rfq-core"

const DB = process.env.MONGO_DB ?? "master_data"
export const INVITE_COLL = "rfq_invites"
export const LOG_COLL = "rfq_log"
const JOB_COLL = "rfq_job_catalog"
const PART_COLL = "rfq_part_catalog"
const META_COLL = "rfq_catalog_meta"

async function db() { return (await clientPromise).db(DB) }
async function invites() {
  const col = (await db()).collection<RfqInvite>(INVITE_COLL)
  await col.createIndex({ token: 1 }, { unique: true }).catch(() => {})
  await col.createIndex({ vendor: 1, createdAt: -1 }).catch(() => {})
  await col.createIndex({ status: 1, deadline: 1 }).catch(() => {})
  return col
}

export function serialize(inv: WithId<RfqInvite> | RfqInvite): RfqInvite {
  const { _id, ...rest } = inv as WithId<RfqInvite>
  return { ...rest, _id: _id ? String(_id) : undefined }
}

// ── แคตตาล็อก ────────────────────────────────────────────────────────────────
export async function getCatalog(version?: number) {
  const d = await db()
  const meta = await d.collection(META_COLL).findOne<{ version: number }>({ _id: "latest" as never })
  const v = version ?? meta?.version ?? 0
  const filter = version ? { version: { $lte: v } } : { active: true }   // ใบเก่าเห็นงานรุ่นที่ตัวเองสร้าง (รวมที่ถูกถอดภายหลัง)
  const [jobs, parts] = await Promise.all([
    d.collection<RfqJob>(JOB_COLL).find(filter, { projection: { _id: 0 } }).sort({ sheet: 1, seq: 1 }).toArray(),
    d.collection<RfqPart>(PART_COLL).find(filter, { projection: { _id: 0 } }).sort({ sheet: 1, seq: 1 }).toArray(),
  ])
  const order = (s: string) => SHEET_ORDER.indexOf(s)
  jobs.sort((a, b) => order(a.sheet) - order(b.sheet) || a.seq - b.seq)
  parts.sort((a, b) => order(a.sheet) - order(b.sheet) || a.seq - b.seq)
  return { version: v, jobs, parts }
}

export async function catalogSummary() {
  const { version, jobs, parts } = await getCatalog()
  const m = new Map<string, { sheet: string; title: string; jobs: number; parts: number }>()
  for (const j of jobs) { const x = m.get(j.sheet) ?? { sheet: j.sheet, title: j.sheetTitle, jobs: 0, parts: 0 }; x.jobs++; m.set(j.sheet, x) }
  for (const p of parts) { const x = m.get(p.sheet) ?? { sheet: p.sheet, title: p.sheetTitle, jobs: 0, parts: 0 }; x.parts++; m.set(p.sheet, x) }
  return { version, sheets: SHEET_ORDER.filter((s) => m.has(s)).map((s) => m.get(s)!) }
}

// ── log ──────────────────────────────────────────────────────────────────────
async function writeLog(entries: RfqLogEntry[]) {
  if (!entries.length) return
  try {
    const col = (await db()).collection<RfqLogEntry>(LOG_COLL)
    await col.createIndex({ inviteId: 1, at: -1 }).catch(() => {})
    await col.insertMany(entries, { ordered: false })
  } catch (e) { console.error("[rfq-log] write failed", e) }
}
export async function listLog(id: string): Promise<RfqLogEntry[]> {
  return (await db()).collection<RfqLogEntry>(LOG_COLL).find({ inviteId: id }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(300).toArray()
}

// ── สร้าง / รายการ / อ่าน ────────────────────────────────────────────────────
export async function createInvites(
  input: { title: string; deadline: string; invites: { vendor: string; sheets: string[]; sections: RfqSection[] }[] },
  by: { name: string; email: string }
): Promise<RfqInvite[]> {
  const col = await invites()
  const { version } = await getCatalog()
  const now = toBkkIso(new Date())
  const docs: RfqInvite[] = input.invites.map((i) => ({
    token: newToken(), vendor: i.vendor,
    sheets: SHEET_ORDER.filter((s) => i.sheets.includes(s) || s === SVC_SHEET),
    sections: i.sections.length ? i.sections : ["labour", "parts"],
    catalogVersion: version, title: input.title, deadline: input.deadline, status: "สร้างแล้ว",
    contact: null, openedAt: null, items: {}, parts: {}, submittedAt: null, submitNote: "",
    confirm: null, returnNote: "", createdBy: by, createdAt: now, updatedAt: now,
  }))
  const r = await col.insertMany(docs)
  const out = docs.map((d, i) => ({ ...d, _id: String(r.insertedIds[i]) }))
  await writeLog(out.map((d) => ({ inviteId: d._id!, action: "create" as const, to: "สร้างแล้ว", by: by.name, byEmail: by.email, at: new Date(), note: `${d.sheets.join(" ")} · ${d.sections.join("+")}` })))
  return out
}

export async function listInvites(f: { status?: string; title?: string; q?: string }) {
  const col = await invites()
  const filter: Document = {}
  if (f.title) filter.title = f.title
  if (f.q) { const rx = { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }; filter.$or = [{ vendor: rx }, { title: rx }, { "contact.name": rx }] }
  const rows = await col.find(filter).sort({ createdAt: -1 }).limit(2000).toArray()
  const today = bkkToday()
  const cat = new Map<number, Awaited<ReturnType<typeof getCatalog>>>()
  const out = []
  for (const r of rows) {
    const eff = effectiveStatus(r, today)
    if (f.status && f.status !== eff) continue
    if (!cat.has(r.catalogVersion)) cat.set(r.catalogVersion, await getCatalog(r.catalogVersion))
    const c = cat.get(r.catalogVersion)!
    const pg = progress(r, c.jobs, c.parts)
    const { items: _i, parts: _p, ...rest } = serialize(r)
    void _i; void _p
    out.push({ ...rest, answered: { labour: pg.labour.done, parts: pg.parts.done }, total: { labour: pg.labour.total, parts: pg.parts.total }, effective: eff })
  }
  return out
}

export async function getInvite(id: string): Promise<RfqInvite | null> {
  if (!ObjectId.isValid(id)) return null
  const r = await (await invites()).findOne({ _id: new ObjectId(id) } as Document)
  return r ? serialize(r) : null
}
export async function getInviteByToken(token: string): Promise<RfqInvite | null> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return null
  const r = await (await invites()).findOne({ token })
  return r ? serialize(r) : null
}

// ── ฝั่งอู่ ──────────────────────────────────────────────────────────────────
export async function markOpened(token: string) {
  const col = await invites()
  const r = await col.findOneAndUpdate({ token, openedAt: null }, { $set: { openedAt: toBkkIso(new Date()) } })
  if (r) await writeLog([{ inviteId: String(r._id), action: "open", by: "อู่ (ลิงก์)", byEmail: "", at: new Date() }])
}

export async function saveContact(token: string, c: Omit<RfqContact, "at">): Promise<RfqInvite> {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  const now = toBkkIso(new Date())
  const status = before.status === "สร้างแล้ว" ? "กำลังกรอก" : before.status
  await col.updateOne({ token }, { $set: { contact: { ...c, at: now }, status, updatedAt: now } })
  const log: RfqLogEntry[] = [{ inviteId: String(before._id), action: "contact", by: c.name, byEmail: c.email, at: new Date(), note: c.phone || c.email }]
  if (status !== before.status) log.push({ inviteId: String(before._id), action: "contact", from: before.status, to: status, by: c.name, byEmail: c.email, at: new Date() })
  await writeLog(log)
  return serialize({ ...before, contact: { ...c, at: now }, status, updatedAt: now })
}

export async function saveAnswers(token: string, items: Record<string, RfqAnswer>, parts: Record<string, RfqPartAnswer>) {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  if (!before.contact) throw new Error("409:กรุณากรอกข้อมูลผู้ติดต่อก่อน")
  const $set: Document = { updatedAt: toBkkIso(new Date()) }
  for (const [k, v] of Object.entries(items)) $set[`items.${k}`] = v
  for (const [k, v] of Object.entries(parts)) $set[`parts.${k}`] = v   // key มี "|" ใช้เป็นชื่อฟิลด์ได้ (ห้ามมี "." และ "$")
  await col.updateOne({ token }, { $set })
}

export async function submitInvite(token: string, submitNote: string): Promise<RfqInvite> {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  if (!before.contact || !canTransition(before.status, "submit")) throw new Error("409:ยังส่งไม่ได้ในสถานะนี้")
  const now = toBkkIso(new Date())
  await col.updateOne({ token }, { $set: { status: "ส่งแล้ว", submittedAt: now, submitNote: submitNote.slice(0, 500), updatedAt: now } })
  await writeLog([{ inviteId: String(before._id), action: "submit", from: before.status, to: "ส่งแล้ว", by: before.contact.name, byEmail: before.contact.email, note: submitNote.slice(0, 500), at: new Date() }])
  return serialize({ ...before, status: "ส่งแล้ว", submittedAt: now, submitNote, updatedAt: now })
}

// ── ฝั่งจัดซื้อ ───────────────────────────────────────────────────────────────
export async function actOnInvite(
  id: string, action: "confirm" | "return" | "cancel" | "extend",
  payload: { validFrom?: string; validTo?: string; note?: string; deadline?: string },
  by: { name: string; email: string }
): Promise<RfqInvite> {
  const col = await invites()
  if (!ObjectId.isValid(id)) throw new Error("404:ไม่พบใบ")
  const before = await col.findOne({ _id: new ObjectId(id) } as Document)
  if (!before) throw new Error("404:ไม่พบใบ")
  if (!canTransition(before.status, action)) throw new Error(`409:ทำ "${action}" จากสถานะ ${before.status} ไม่ได้`)
  const now = toBkkIso(new Date())
  const $set: Document = { updatedAt: now }
  let to = before.status
  const note = (payload.note ?? "").trim().slice(0, 500)
  if (action === "confirm") {
    if (!payload.validFrom || !payload.validTo || payload.validTo < payload.validFrom) throw new Error("400:ช่วงวันที่ราคามีผลไม่ถูกต้อง")
    to = "ยืนยันแล้ว"; $set.status = to
    $set.confirm = { by: by.name, email: by.email, at: now, validFrom: payload.validFrom, validTo: payload.validTo, note }
  } else if (action === "return") {
    if (!note) throw new Error("400:กรุณาระบุเหตุผลที่ส่งกลับ")
    to = "ส่งกลับแก้"; $set.status = to; $set.returnNote = note; $set.submittedAt = null
  } else if (action === "cancel") {
    to = "ยกเลิก"; $set.status = to
  } else {
    if (!payload.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(payload.deadline)) throw new Error("400:วันปิดรับไม่ถูกต้อง")
    $set.deadline = payload.deadline
  }
  await col.updateOne({ _id: before._id }, { $set })
  await writeLog([{ inviteId: String(before._id), action, from: before.status, to, by: by.name, byEmail: by.email, note: action === "extend" ? `ปิดรับ ${before.deadline} → ${payload.deadline}` : note || undefined, at: new Date() }])
  return serialize({ ...before, ...$set } as WithId<RfqInvite>)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p . && npx eslint lib/rfq.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/rfq.ts
git commit -m "rfq: Mongo layer — catalog, invites, vendor writes, procurement actions, log"
```

---

### Task 4: Procurement APIs `/api/rfq/*` + middleware + public APIs `/api/q/*`

**Files:**
- Create: `app/api/rfq/route.ts`, `app/api/rfq/catalog/route.ts`, `app/api/rfq/[id]/route.ts`, `app/api/rfq/[id]/log/route.ts`, `app/api/q/[token]/route.ts`, `app/api/q/[token]/submit/route.ts`
- Modify: `middleware.ts` (add bypass right after the `/api/cron/` block)
- Test: `scripts/check-rfq-api.sh`

**Interfaces:**
- Consumes Task 3 functions. Error convention: catch `Error` whose message starts with `NNN:` and return that status with `{ error: msg }`.
- Produces JSON shapes:
  - `POST /api/rfq` → `{ ok: true, invites: [{ id, vendor, token, url }] }` where `url = ${origin}/q/${token}` (origin from `req.nextUrl.origin`).
  - `GET /api/rfq/[id]` → `{ invite: RfqInvite, jobs: RfqJob[], parts: RfqPart[] }` (jobs/parts filtered to `invite.sheets`, catalog of `invite.catalogVersion`).
  - `GET /api/q/[token]` → `{ invite: PublicInvite, jobs, parts, today }` where PublicInvite = RfqInvite minus `confirm`, `createdBy`, `_id`, plus `effective: EffectiveStatus`, `canWrite: boolean`.

- [ ] **Step 1: Shared error helper** — put in `lib/rfq.ts` bottom:

```ts
/** "409:ข้อความ" → { status: 409, error: "ข้อความ" } · อย่างอื่น = 500 */
export function httpError(e: unknown): { status: number; error: string } {
  const m = /^(\d{3}):(.*)$/.exec(e instanceof Error ? e.message : String(e))
  return m ? { status: +m[1], error: m[2] } : { status: 500, error: "บันทึกไม่สำเร็จ" }
}
```

- [ ] **Step 2: Write `app/api/rfq/route.ts`**

```ts
// app/api/rfq/route.ts — สร้างลิงก์หลายอู่ + รายการ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createInvites, listInvites, catalogSummary, httpError } from "@/lib/rfq"
import { SHEET_ORDER, type RfqSection } from "@/lib/rfq-core"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"
const DB = process.env.MONGO_DB ?? "master_data"

async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}

export async function GET(req: NextRequest) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const rows = await listInvites({ status: sp.get("status") ?? "", title: sp.get("title") ?? "", q: sp.get("q") ?? "" })
  return NextResponse.json({ invites: rows })
}

export async function POST(req: NextRequest) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const title = String(body.title ?? "").trim().slice(0, 120)
    const deadline = String(body.deadline ?? "")
    if (!title) return NextResponse.json({ error: "กรุณาตั้งชื่อรอบ" }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return NextResponse.json({ error: "วันปิดรับไม่ถูกต้อง" }, { status: 400 })
    const raw = Array.isArray(body.invites) ? body.invites : []
    if (!raw.length || raw.length > 200) return NextResponse.json({ error: "เลือกอู่ 1–200 ราย" }, { status: 400 })
    const { sheets: known } = await catalogSummary()
    const knownSet = new Set(known.map((s) => s.sheet))
    const vendorsInDb = new Set((await (await clientPromise).db(DB).collection("vendor_approval").find({}, { projection: { vendor: 1 } }).toArray()).map((v) => v.vendor as string))
    const invites = []
    for (const r of raw) {
      const vendor = String(r?.vendor ?? "").trim()
      if (!vendor || !vendorsInDb.has(vendor)) return NextResponse.json({ error: `ไม่พบอู่ใน AVL: ${vendor || "(ว่าง)"}` }, { status: 400 })
      const sheets = (Array.isArray(r.sheets) ? r.sheets : []).map(String).filter((s: string) => knownSet.has(s) && SHEET_ORDER.includes(s))
      const sections = (Array.isArray(r.sections) ? r.sections : ["labour", "parts"]).filter((s: string): s is RfqSection => s === "labour" || s === "parts")
      invites.push({ vendor, sheets, sections })
    }
    const created = await createInvites({ title, deadline, invites }, user)
    const origin = req.nextUrl.origin
    return NextResponse.json({ ok: true, invites: created.map((c) => ({ id: c._id, vendor: c.vendor, token: c.token, url: `${origin}/q/${c.token}` })) })
  } catch (e) { const { status, error } = httpError(e); console.error("[rfq] POST", e); return NextResponse.json({ error }, { status }) }
}
```

- [ ] **Step 3: Write `app/api/rfq/catalog/route.ts`**

```ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { catalogSummary } from "@/lib/rfq"
export const dynamic = "force-dynamic"
export async function GET() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json(await catalogSummary())
}
```

- [ ] **Step 4: Write `app/api/rfq/[id]/route.ts`**

```ts
// app/api/rfq/[id]/route.ts — อ่านใบเต็ม + การกระทำของจัดซื้อ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { canApproveVendor } from "@/lib/roles"
import { getInvite, getCatalog, actOnInvite, httpError } from "@/lib/rfq"

export const dynamic = "force-dynamic"
type Params = { params: Promise<{ id: string }> }
async function me() {
  const s = await getServerSession(authOptions)
  return s?.user ? { name: s.user.name || s.user.email || "", email: s.user.email || "" } : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await me())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const invite = await getInvite(id)
  if (!invite) return NextResponse.json({ error: "not found" }, { status: 404 })
  const cat = await getCatalog(invite.catalogVersion)
  const sheets = new Set(invite.sheets)
  return NextResponse.json({ invite, jobs: cat.jobs.filter((j) => sheets.has(j.sheet)), parts: cat.parts.filter((p) => sheets.has(p.sheet)) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await me()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  if (!["confirm", "return", "cancel", "extend"].includes(action)) return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 })
  if ((action === "confirm" || action === "cancel") && !canApproveVendor(user.email)) {
    return NextResponse.json({ error: "ต้องเป็นแอดมินหรือผู้อนุมัติอู่" }, { status: 403 })
  }
  try {
    const inv = await actOnInvite(id, action as "confirm" | "return" | "cancel" | "extend",
      { validFrom: body.validFrom, validTo: body.validTo, note: body.note, deadline: body.deadline }, user)
    return NextResponse.json({ ok: true, invite: inv })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[rfq] PATCH", e); return NextResponse.json({ error }, { status }) }
}
```

- [ ] **Step 5: Write `app/api/rfq/[id]/log/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { listLog } from "@/lib/rfq"
export const dynamic = "force-dynamic"
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  return NextResponse.json({ log: await listLog(id) })
}
```

- [ ] **Step 6: Write `app/api/q/[token]/route.ts`** (public)

```ts
// app/api/q/[token]/route.ts — ฝั่งอู่ ไม่มี session · token คือสิทธิ์
import { NextRequest, NextResponse } from "next/server"
import { bkkToday } from "@/lib/bkk-time"
import { getInviteByToken, getCatalog, markOpened, saveContact, saveAnswers, httpError } from "@/lib/rfq"
import { effectiveStatus, canVendorWrite, validateContact, validateAnswer, validatePartAnswer, partKey, type RfqAnswer, type RfqPartAnswer, type RfqInvite } from "@/lib/rfq-core"

export const dynamic = "force-dynamic"
type Params = { params: Promise<{ token: string }> }
const MAX_BATCH = 20

function publicView(inv: RfqInvite, today: string) {
  const { confirm: _c, createdBy: _b, _id: _i, ...rest } = inv
  void _c; void _b; void _i
  return { ...rest, effective: effectiveStatus(inv, today), canWrite: canVendorWrite(inv, today),
    priceValidTo: inv.confirm?.validTo ?? null }   // อู่เห็นได้แค่ว่าราคาตัวเองมีผลถึงเมื่อไหร่
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!inv.openedAt) await markOpened(token)
  const cat = await getCatalog(inv.catalogVersion)
  const sheets = new Set(inv.sheets)
  const today = bkkToday()
  return NextResponse.json({
    invite: publicView({ ...inv, openedAt: inv.openedAt ?? today }, today),
    jobs: inv.sections.includes("labour") ? cat.jobs.filter((j) => sheets.has(j.sheet)) : [],
    parts: inv.sections.includes("parts") ? cat.parts.filter((p) => sheets.has(p.sheet)) : [],
    today,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  try {
    if (body.contact !== undefined) {
      const c = validateContact(body.contact)
      if (typeof c === "string") return NextResponse.json({ error: c }, { status: 400 })
      const after = await saveContact(token, c)
      return NextResponse.json({ ok: true, invite: publicView(after, bkkToday()) })
    }
    const items: Record<string, RfqAnswer> = {}
    const parts: Record<string, RfqPartAnswer> = {}
    const cat = await getCatalog(inv.catalogVersion)
    const sheets = new Set(inv.sheets)
    const jobOk = new Set(cat.jobs.filter((j) => sheets.has(j.sheet)).map((j) => j.jobCode))
    const partOk = new Set(cat.parts.filter((p) => sheets.has(p.sheet)).map((p) => partKey(p.sheet, p.sku)))
    let n = 0
    for (const [k, v] of Object.entries((body.items ?? {}) as Record<string, unknown>)) {
      if (!jobOk.has(k)) return NextResponse.json({ error: `ไม่มีงาน ${k} ในใบนี้` }, { status: 400 })
      const a = validateAnswer(v); if (typeof a === "string") return NextResponse.json({ error: `${k}: ${a}` }, { status: 400 })
      items[k] = a; n++
    }
    for (const [k, v] of Object.entries((body.parts ?? {}) as Record<string, unknown>)) {
      if (!partOk.has(k) || /[.$]/.test(k)) return NextResponse.json({ error: `ไม่มีอะไหล่ ${k} ในใบนี้` }, { status: 400 })
      const a = validatePartAnswer(v); if (typeof a === "string") return NextResponse.json({ error: `${k}: ${a}` }, { status: 400 })
      parts[k] = a; n++
    }
    if (!n) return NextResponse.json({ error: "ไม่มีอะไรให้บันทึก" }, { status: 400 })
    if (n > MAX_BATCH) return NextResponse.json({ error: `บันทึกได้ครั้งละไม่เกิน ${MAX_BATCH} รายการ` }, { status: 400 })
    await saveAnswers(token, items, parts)
    return NextResponse.json({ ok: true, saved: n, at: new Date().toISOString() })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[q] PATCH", e); return NextResponse.json({ error }, { status }) }
}
```

- [ ] **Step 7: Write `app/api/q/[token]/submit/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import { submitInvite, httpError } from "@/lib/rfq"
export const dynamic = "force-dynamic"
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  if (body.acknowledgeBlank !== true) return NextResponse.json({ error: "กรุณายืนยันว่างานที่เว้นว่าง = ไม่เสนอราคา" }, { status: 400 })
  try {
    const inv = await submitInvite(token, String(body.submitNote ?? ""))
    return NextResponse.json({ ok: true, status: inv.status, submittedAt: inv.submittedAt })
  } catch (e) { const { status, error } = httpError(e); if (status === 500) console.error("[q] submit", e); return NextResponse.json({ error }, { status }) }
}
```

- [ ] **Step 8: middleware bypass** — in `middleware.ts` after the `/api/cron/` block add:

```ts
  // ฟอร์มขอราคาอู่ (Vendor RFQ): อู่เปิดจากลิงก์ ไม่มี session — token ในเส้นทางคือสิทธิ์ (ตรวจใน route เอง)
  if (pathname.startsWith("/q/") || pathname.startsWith("/api/q/")) {
    return NextResponse.next()
  }
```

- [ ] **Step 9: Write `scripts/check-rfq-api.sh`**

```bash
# scripts/check-rfq-api.sh — รัน: TOKEN=$(npx tsx scripts/mint-session-token.ts) bash scripts/check-rfq-api.sh
# ต้องมี dev server ที่ :3000 และแคตตาล็อกนำเข้าแล้ว · ใช้อู่จริงรายแรกใน vendor_approval
set -e
H="Cookie: next-auth.session-token=$TOKEN"; J="Content-Type: application/json"
B=http://localhost:3000/api/rfq; Q=http://localhost:3000/api/q
VENDOR=$(node -r dotenv/config -e 'require("mongodb").MongoClient.connect(process.env.MONGO_URI).then(async c=>{const v=await c.db(process.env.MONGO_DB||"master_data").collection("vendor_approval").findOne({});console.log(v.vendor);process.exit(0)})')
DL=$(date -v+14d +%F 2>/dev/null || date -d "+14 days" +%F)
echo "== no session → 401"; curl -s -o /dev/null -w "%{http_code}\n" $B | grep -q 401
echo "== catalog"; curl -s -H "$H" $B/catalog | grep -q '"sheet":"S45"'
echo "== create"; NEW=$(curl -s -H "$H" -H "$J" -X POST $B -d "{\"title\":\"ทดสอบ API\",\"deadline\":\"$DL\",\"invites\":[{\"vendor\":\"$VENDOR\",\"sheets\":[\"S45\"],\"sections\":[\"labour\",\"parts\"]}]}")
echo "$NEW" | grep -q '"ok":true'
ID=$(echo "$NEW" | sed -E 's/.*"id":"([a-f0-9]+)".*/\1/'); TK=$(echo "$NEW" | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "id=$ID token=$TK"
echo "== unknown vendor → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X POST $B -d "{\"title\":\"x\",\"deadline\":\"$DL\",\"invites\":[{\"vendor\":\"ไม่มีอู่นี้\",\"sheets\":[]}]}" | grep -q 400
echo "== public GET (no cookie) sets openedAt + SVC always"; G=$(curl -s $Q/$TK); echo "$G" | grep -q '"openedAt":"20'; echo "$G" | grep -q '"sheets":\["S45","SVC"\]'
echo "$G" | grep -q '"createdBy"' && { echo "LEAK createdBy"; exit 1; } || true
echo "== bad token → 404"; curl -s -o /dev/null -w "%{http_code}\n" $Q/AAAAAAAAAAAAAAAAAAAAAAAA | grep -q 404
echo "== items before contact → 409"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q 409
echo "== contact missing phone/email → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"contact":{"name":"ช่างเอ","confirmedVendor":true}}' | grep -q 400
echo "== contact ok → กำลังกรอก"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"contact":{"name":"ช่างเอ","phone":"0812345678","email":"","confirmedVendor":true}}' | grep -q '"status":"กำลังกรอก"'
echo "== items ok"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"hourly","L":{"rate":450,"hours":2},"S":{},"sameAsL":true}}}' | grep -q '"saved":1'
echo "== item not in sheet → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"NOPE":{"mode":"skip"}}}' | grep -q 400
echo "== parts ok"; PK=$(curl -s $Q/$TK | sed -E 's/.*"parts":\[\{"sheet":"S45","sheetTitle":"[^"]*","seq":[0-9]+,"sku":"([^"]+)".*/\1/'); curl -s -H "$J" -X PATCH $Q/$TK -d "{\"parts\":{\"S45|$PK\":{\"priceL\":1200,\"sameAsL\":true,\"brand\":\"OEM\"}}}" | grep -q '"saved":1'
echo "== submit without ack → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X POST $Q/$TK/submit -d '{}' | grep -q 400
echo "== submit"; curl -s -H "$J" -X POST $Q/$TK/submit -d '{"acknowledgeBlank":true,"submitNote":"ครบแล้ว"}' | grep -q '"status":"ส่งแล้ว"'
echo "== write after submit → 409"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q 409
echo "== list shows answered"; curl -s -H "$H" "$B?q=ทดสอบ" | grep -q '"answered":{"labour":1,"parts":1}'
echo "== return (needs note) → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"return"}' | grep -q 400
echo "== return ok"; curl -s -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"return","note":"ขอราคา S ด้วย"}' | grep -q '"status":"ส่งกลับแก้"'
echo "== vendor can write again"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q '"saved":1'
echo "== resubmit"; curl -s -H "$J" -X POST $Q/$TK/submit -d '{"acknowledgeBlank":true}' | grep -q '"status":"ส่งแล้ว"'
echo "== confirm as non-approver → 403"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"confirm","validFrom":"2026-09-10","validTo":"2027-09-10"}' | grep -q 403
echo "== log ≥ 6"; test "$(curl -s -H "$H" $B/$ID/log | grep -o '"action"' | wc -l)" -ge 6
echo "== cancel as non-approver → 403"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"cancel"}' | grep -q 403
echo "check-rfq-api: OK (ใบทดสอบ $ID คงไว้ในสถานะ ส่งแล้ว — ลบเองด้วย mongo ถ้าต้องการ)"
```
Note: confirm/cancel with an approver session is verified in Task 8's browser check (mint-session-token issues a `user` role; to test confirm via curl, temporarily mint with an email from `VENDOR_APPROVER_EMAILS` by editing the script's email locally — do not commit that edit).

- [ ] **Step 10: Run**

```bash
npx tsc --noEmit -p . && npx eslint app/api/rfq app/api/q middleware.ts lib/rfq.ts
npm run dev &   # wait for "Ready"
TOKEN=$(npx tsx scripts/mint-session-token.ts) bash scripts/check-rfq-api.sh
```
Expected: every line prints, ends with `check-rfq-api: OK`.

- [ ] **Step 11: Commit**

```bash
git add app/api/rfq app/api/q middleware.ts lib/rfq.ts scripts/check-rfq-api.sh
git commit -m "rfq: procurement + public token APIs, middleware bypass, API check script"
```

---

### Task 5: Vendor public pages — shared hook, hub, labour page, parts page

**Files:**
- Create: `components/rfq-vendor-shared.tsx`, `components/rfq-vendor-hub.tsx`, `components/rfq-vendor-labour.tsx`, `components/rfq-vendor-parts.tsx`, `app/q/[token]/page.tsx`, `app/q/[token]/labour/page.tsx`, `app/q/[token]/parts/page.tsx`
- Modify: `components/app-shell.tsx` (bypass shell for `/q/`)

**Interfaces:**
- Consumes: `GET/PATCH /api/q/[token]`, `POST /api/q/[token]/submit` (Task 4 shapes), `progress`, `partKey`, `STATUS_META` from rfq-core.
- Produces:
  ```ts
  // components/rfq-vendor-shared.tsx
  export type PublicInvite = Omit<RfqInvite,"confirm"|"createdBy"|"_id"> & { effective: EffectiveStatus; canWrite: boolean; priceValidTo: string | null }
  export function useInvite(token: string): { data: { invite: PublicInvite; jobs: RfqJob[]; parts: RfqPart[]; today: string } | null; loading: boolean; error: string; reload: () => void; setLocal: (fn: (d: Data) => Data) => void }
  export function useAutosave(token: string): { save: (patch: { items?: Record<string, unknown>; parts?: Record<string, unknown> }) => Promise<void>; state: "idle" | "saving" | "saved" | "error"; savedAt: string; errorMsg: string }
  export const V: { page: CSSProperties; card: CSSProperties; input: CSSProperties; btn: CSSProperties; btnPrimary: CSSProperties; label: CSSProperties; muted: CSSProperties }
  export function VendorHeader(props: { invite: PublicInvite; subtitle?: string; backHref?: string }): JSX.Element
  export function SaveBadge(props: { state: "idle"|"saving"|"saved"|"error"; savedAt: string; errorMsg: string; onRetry: () => void }): JSX.Element
  export function StatusNotice(props: { invite: PublicInvite }): JSX.Element | null   // banners: หมดอายุ / ยกเลิก / ส่งกลับแก้ (returnNote) / ส่งแล้ว / ยืนยันแล้ว (priceValidTo)
  ```

- [ ] **Step 1: App shell bypass** — in `components/app-shell.tsx` add after `isPrdPage`:

```tsx
  const isVendorPage = pathname.startsWith("/q/")   // ฟอร์มขอราคาอู่: ไม่มี sidebar/navbar/session guard
```
and change the first early return to `if (isLoginPage || isPresentationPage || isVendorPage)`. The page itself sets its own scrollable container.

- [ ] **Step 2: Write `components/rfq-vendor-shared.tsx`**

```tsx
"use client"
// ส่วนร่วมของหน้าอู่ (public): โหลดใบ, บันทึกอัตโนมัติ, สไตล์ — มือถือก่อน ไม่มี sidebar
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { STATUS_META, type RfqInvite, type RfqJob, type RfqPart, type EffectiveStatus } from "@/lib/rfq-core"

export type PublicInvite = Omit<RfqInvite, "confirm" | "createdBy" | "_id"> & { effective: EffectiveStatus; canWrite: boolean; priceValidTo: string | null }
export type Data = { invite: PublicInvite; jobs: RfqJob[]; parts: RfqPart[]; today: string }

export const mitr = { fontFamily: "'Mitr', sans-serif" }
export const V = {
  page:  { ...mitr, minHeight: "100vh", background: "#F6FAF7", color: "#14271C", padding: "16px 16px 96px", maxWidth: 720, margin: "0 auto" } as CSSProperties,
  card:  { background: "#fff", border: "1px solid #E4EEE8", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 1px 2px rgba(20,39,28,.04)" } as CSSProperties,
  input: { ...mitr, width: "100%", fontSize: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid #D5E2DA", background: "#fff", minHeight: 44, boxSizing: "border-box" } as CSSProperties,
  btn:   { ...mitr, fontSize: 15, fontWeight: 600, padding: "10px 16px", borderRadius: 10, border: "1px solid #D5E2DA", background: "#fff", cursor: "pointer", minHeight: 44 } as CSSProperties,
  btnPrimary: { ...mitr, fontSize: 16, fontWeight: 600, padding: "12px 18px", borderRadius: 12, border: "none", background: "#1B8C4B", color: "#fff", cursor: "pointer", minHeight: 48, width: "100%" } as CSSProperties,
  label: { fontSize: 12.5, color: "#5B6E63", fontWeight: 600, display: "block", marginBottom: 4 } as CSSProperties,
  muted: { fontSize: 12.5, color: "#7C8B82" } as CSSProperties,
}

export function useInvite(token: string) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await fetch(`/api/q/${token}`, { cache: "no-store" })
      if (r.status === 404) { setError("ไม่พบลิงก์นี้ กรุณาตรวจสอบลิงก์ที่ได้รับ"); return }
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "โหลดไม่สำเร็จ")
      setData(await r.json())
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }, [token])
  useEffect(() => { void load() }, [load])
  const setLocal = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), [])
  return { data, loading, error, reload: load, setLocal }
}

export function useAutosave(token: string) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [savedAt, setSavedAt] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  const queue = useRef<{ items: Record<string, unknown>; parts: Record<string, unknown> }>({ items: {}, parts: {} })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(async () => {
    const q = queue.current; queue.current = { items: {}, parts: {} }
    if (!Object.keys(q.items).length && !Object.keys(q.parts).length) return
    setState("saving")
    try {
      const r = await fetch(`/api/q/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      setState("saved"); setSavedAt(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }))
    } catch (e) {
      // เก็บกลับเข้าคิว ให้ปุ่ม "ลองใหม่" ส่งซ้ำได้
      queue.current = { items: { ...q.items, ...queue.current.items }, parts: { ...q.parts, ...queue.current.parts } }
      setState("error"); setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }, [token])
  // รวมการแก้หลายช่องติดกันเป็นคำขอเดียว (หน่วง 600ms) — แต่ไม่เกิน 20 รายการต่อครั้งตาม API
  const save = useCallback(async (patch: { items?: Record<string, unknown>; parts?: Record<string, unknown> }) => {
    Object.assign(queue.current.items, patch.items ?? {})
    Object.assign(queue.current.parts, patch.parts ?? {})
    if (timer.current) clearTimeout(timer.current)
    const n = Object.keys(queue.current.items).length + Object.keys(queue.current.parts).length
    if (n >= 20) { await flush(); return }
    timer.current = setTimeout(() => void flush(), 600)
  }, [flush])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { save, flush, state, savedAt, errorMsg }
}

export function VendorHeader({ invite, subtitle, backHref }: { invite: PublicInvite; subtitle?: string; backHref?: string }) {
  const m = STATUS_META[invite.effective]
  return (
    <div style={{ marginBottom: 12 }}>
      {backHref && <Link href={backHref} style={{ ...V.muted, textDecoration: "none" }}>‹ กลับหน้าหลัก</Link>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 11, color: "#1B8C4B", fontWeight: 700, letterSpacing: .5 }}>MENA TRANSPORT · ใบขอราคา</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.fg }}>{invite.effective}</span>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0", lineHeight: 1.25 }}>{invite.vendor}</h1>
      <div style={V.muted}>{subtitle ?? invite.title} · ปิดรับ {thDate(invite.deadline)}</div>
    </div>
  )
}

export function SaveBadge({ state, savedAt, errorMsg, onRetry }: { state: "idle" | "saving" | "saved" | "error"; savedAt: string; errorMsg: string; onRetry: () => void }) {
  if (state === "idle") return null
  const c = state === "error" ? "#B91C1C" : state === "saving" ? "#92400E" : "#047857"
  return (
    <div style={{ position: "fixed", left: 16, right: 16, bottom: 12, zIndex: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <span style={{ ...mitr, pointerEvents: "auto", fontSize: 12.5, fontWeight: 600, color: c, background: "#fff", border: `1px solid ${c}33`, borderRadius: 999, padding: "6px 12px", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
        {state === "saving" ? "กำลังบันทึก…" : state === "saved" ? `บันทึกแล้ว ${savedAt}` : <>บันทึกไม่สำเร็จ: {errorMsg} <button onClick={onRetry} style={{ ...V.btn, minHeight: 28, padding: "2px 10px", fontSize: 12, marginLeft: 6 }}>ลองใหม่</button></>}
      </span>
    </div>
  )
}

export function StatusNotice({ invite }: { invite: PublicInvite }) {
  const box = (bg: string, fg: string, text: string) => <div style={{ ...V.card, background: bg, color: fg, borderColor: fg + "33", fontSize: 14 }}>{text}</div>
  switch (invite.effective) {
    case "หมดอายุ":   return box("#F4F4F5", "#52525B", "ลิงก์นี้ปิดรับแล้ว หากต้องการเสนอราคา กรุณาติดต่อฝ่ายจัดซื้อ Mena Transport")
    case "ยกเลิก":    return box("#FEF2F2", "#B91C1C", "ลิงก์นี้ถูกยกเลิกแล้ว")
    case "ส่งแล้ว":   return box("#FFFBEB", "#92400E", `ส่งใบเสนอราคาแล้วเมื่อ ${thDateTime(invite.submittedAt)} · ฝ่ายจัดซื้อกำลังตรวจสอบ แก้ไขไม่ได้จนกว่าจะได้รับแจ้ง`)
    case "ยืนยันแล้ว": return box("#ECFDF5", "#047857", `ฝ่ายจัดซื้อยืนยันใบเสนอราคาแล้ว · ราคามีผลถึง ${thDate(invite.priceValidTo)}`)
    case "ส่งกลับแก้": return box("#FFF7ED", "#C2410C", `ฝ่ายจัดซื้อขอให้แก้ไข: ${invite.returnNote || "—"} · แก้แล้วกดส่งอีกครั้ง`)
    default: return null
  }
}

export const thDate = (ymd: string | null | undefined) => {
  if (!ymd) return "—"
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number)
  const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  return `${d} ${MON[m - 1]} ${String(y + 543).slice(-2)}`
}
export const thDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"

/** ตัวเลขจากช่อง input → number|undefined (ว่าง = ไม่กรอก) */
export const toNum = (s: string): number | undefined => { const t = s.replace(/,/g, "").trim(); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined }
```

- [ ] **Step 3: Write `components/rfq-vendor-hub.tsx`** (identity step + section cards + submit)

```tsx
"use client"
// หน้าหลักของอู่: ยืนยันตัวตนครั้งแรก → การ์ด ค่าแรง / อะไหล่ → ส่งใบเสนอราคา
import { useState } from "react"
import Link from "next/link"
import { progress } from "@/lib/rfq-core"
import { useInvite, V, VendorHeader, StatusNotice, thDate, type PublicInvite } from "@/components/rfq-vendor-shared"

export function RfqVendorHub({ token }: { token: string }) {
  const { data, loading, error, reload, setLocal } = useInvite(token)
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, jobs, parts } = data
  if (!invite.contact && invite.canWrite) return <IdentityStep token={token} invite={invite} onDone={(inv) => setLocal((d) => ({ ...d, invite: inv }))} />
  const pg = progress(invite, jobs, parts)
  return (
    <div style={V.page}>
      <VendorHeader invite={invite} />
      <StatusNotice invite={invite} />
      {invite.contact && <div style={{ ...V.muted, marginBottom: 10 }}>ผู้ติดต่อ: {invite.contact.name} · {invite.contact.phone || invite.contact.email}</div>}
      {invite.sections.includes("labour") && <SectionCard href={`/q/${token}/labour`} title="ค่าแรง" desc="งานช่างมาตรฐาน · เสนอรายชั่วโมงหรือเหมา เบา/กลาง/หนัก" done={pg.labour.done} total={pg.labour.total} color="#1B8C4B" />}
      {invite.sections.includes("parts") && <SectionCard href={`/q/${token}/parts`} title="อะไหล่" desc="ราคาต่อหน่วย Mixer L / S · ยี่ห้อ · รับประกัน · ส่งมอบ" done={pg.parts.done} total={pg.parts.total} color="#1D4ED8" />}
      {invite.canWrite && <SubmitBox token={token} invite={invite} blank={(pg.labour.total - pg.labour.done) + (pg.parts.total - pg.parts.done)} onDone={reload} />}
      <div style={{ ...V.muted, marginTop: 16, textAlign: "center" }}>ระบบชีต: {invite.sheets.join(" · ")} · ปิดรับ {thDate(invite.deadline)}</div>
    </div>
  )
}

function SectionCard({ href, title, desc, done, total, color }: { href: string; title: string; desc: string; done: number; total: number; color: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ ...V.card, borderLeft: `5px solid ${color}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={V.muted}>{desc}</div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: "#EEF3EF", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: color }} /></div>
          <div style={{ ...V.muted, marginTop: 4 }}>กรอกแล้ว {done}/{total} รายการ</div>
        </div>
        <span style={{ fontSize: 22, color }}>›</span>
      </div>
    </Link>
  )
}

function IdentityStep({ token, invite, onDone }: { token: string; invite: PublicInvite; onDone: (inv: PublicInvite) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("")
  const [ok, setOk] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true); setErr("")
    try {
      const r = await fetch(`/api/q/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact: { name, phone, email, confirmedVendor: ok } }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      onDone(d.invite)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ก่อนเริ่ม กรุณากรอกข้อมูลผู้ติดต่อ" />
      <div style={V.card}>
        <label style={V.label}>ชื่อผู้ติดต่อ *</label>
        <input style={V.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ช่างเอ" autoComplete="name" />
        <label style={{ ...V.label, marginTop: 12 }}>เบอร์โทร</label>
        <input style={V.input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08x-xxx-xxxx" autoComplete="tel" />
        <label style={{ ...V.label, marginTop: 12 }}>อีเมล</label>
        <input style={V.input} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="(กรอกเบอร์โทรหรืออีเมลอย่างน้อย 1 อย่าง)" autoComplete="email" />
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
          <span>ยืนยันว่าเสนอราคาในนาม <b>{invite.vendor}</b></span>
        </label>
        {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button style={{ ...V.btnPrimary, marginTop: 14, opacity: busy ? .6 : 1 }} disabled={busy} onClick={() => void go()}>เริ่มกรอกใบเสนอราคา</button>
      </div>
      <div style={{ ...V.muted, textAlign: "center" }}>ข้อมูลใช้สำหรับติดต่อกลับเรื่องใบเสนอราคานี้เท่านั้น</div>
    </div>
  )
}

function SubmitBox({ token, invite, blank, onDone }: { token: string; invite: PublicInvite; blank: number; onDone: () => void }) {
  const [ack, setAck] = useState(false); const [note, setNote] = useState(invite.submitNote ?? "")
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setErr("")
    try {
      const r = await fetch(`/api/q/${token}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acknowledgeBlank: ack, submitNote: note }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "ส่งไม่สำเร็จ")
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div style={{ ...V.card, marginTop: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>ส่งใบเสนอราคา</div>
      <label style={{ ...V.label, marginTop: 10 }}>หมายเหตุถึงฝ่ายจัดซื้อ (ถ้ามี)</label>
      <textarea style={{ ...V.input, minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
        <span>รายการที่เว้นว่างไว้ ({blank} รายการ) ถือว่า <b>ไม่เสนอราคา</b> และเมื่อส่งแล้วจะแก้ไขไม่ได้จนกว่าฝ่ายจัดซื้อจะเปิดให้แก้</span>
      </label>
      {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <button style={{ ...V.btnPrimary, marginTop: 14, opacity: !ack || busy ? .5 : 1 }} disabled={!ack || busy} onClick={() => void submit()}>ส่งใบเสนอราคา</button>
    </div>
  )
}
```

- [ ] **Step 4: Write `components/rfq-vendor-labour.tsx`** (wizard: one sheet per step, one card per job)

```tsx
"use client"
// หน้าค่าแรง: ชีตละขั้น · การ์ดละงาน · รายชั่วโมง / เหมา / ไม่รับงาน · Mixer L แล้ว S (+ "S เหมือน L")
import { useMemo, useState } from "react"
import { SHEET_ORDER, type RfqAnswer, type RfqJob, type Tier } from "@/lib/rfq-core"
import { useInvite, useAutosave, V, VendorHeader, StatusNotice, SaveBadge, toNum } from "@/components/rfq-vendor-shared"

const EMPTY: RfqAnswer = { mode: "lump", L: {}, S: {}, sameAsL: true, note: "", at: "" }

export function RfqVendorLabour({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  const { save, flush, state, savedAt, errorMsg } = useAutosave(token)
  const [step, setStep] = useState(0)
  const [openScope, setOpenScope] = useState<Record<string, boolean>>({})
  const sheets = useMemo(() => data ? SHEET_ORDER.filter((s) => data.invite.sheets.includes(s) && data.jobs.some((j) => j.sheet === s)) : [], [data])
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, jobs } = data
  const ro = !invite.canWrite
  const sheet = sheets[step]
  const list = jobs.filter((j) => j.sheet === sheet)
  const doneIn = (s: string) => jobs.filter((j) => j.sheet === s && invite.items[j.jobCode]).length
  const totalIn = (s: string) => jobs.filter((j) => j.sheet === s).length

  function update(job: RfqJob, patch: Partial<RfqAnswer>) {
    if (ro) return
    const cur = invite.items[job.jobCode] ?? EMPTY
    let next: RfqAnswer = { ...cur, ...patch }
    if (next.sameAsL) next = { ...next, S: { ...next.L } }
    setLocal((d) => ({ ...d, invite: { ...d.invite, items: { ...d.invite.items, [job.jobCode]: next } } }))
    void save({ items: { [job.jobCode]: next } })
  }

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ค่าแรง — งานช่างมาตรฐาน" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      {/* แถบชีต เลื่อนแนวนอน */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {sheets.map((s, i) => {
          const t = jobs.find((j) => j.sheet === s)?.sheetTitle ?? s
          const on = i === step
          return <button key={s} onClick={() => setStep(i)} style={{ ...V.btn, flexShrink: 0, minHeight: 36, padding: "6px 10px", fontSize: 12.5, background: on ? "#1B8C4B" : "#fff", color: on ? "#fff" : "#14271C", borderColor: on ? "#1B8C4B" : "#D5E2DA" }}>{s} {t} <span style={{ opacity: .8 }}>· {doneIn(s)}/{totalIn(s)}</span></button>
        })}
      </div>
      {sheet && <div style={{ fontSize: 15, fontWeight: 600, margin: "4px 0 10px" }}>{sheet} · {list[0]?.sheetTitle} <span style={V.muted}>กรอกแล้ว {doneIn(sheet)}/{list.length}</span></div>}
      {list.map((job) => {
        const a = invite.items[job.jobCode]
        const mode = a?.mode ?? null
        const border = !a ? "#F3D48A" : a.mode === "skip" ? "#D4D4D8" : "#A7F3D0"
        const so = openScope[job.jobCode]
        return (
          <div key={job.jobCode} style={{ ...V.card, borderLeft: `4px solid ${border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...V.muted, fontVariantNumeric: "tabular-nums" }}>{job.seq}.</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{job.name}</div>
                <div style={V.muted}>{job.jobCode} · ชม.อ้างอิง L {job.refHoursL ?? "—"} / S {job.refHoursS ?? "—"}</div>
              </div>
            </div>
            <button onClick={() => setOpenScope((o) => ({ ...o, [job.jobCode]: !so }))} style={{ ...V.btn, minHeight: 32, padding: "4px 10px", fontSize: 12.5, marginTop: 8, background: "#F6FAF7" }}>{so ? "ซ่อน" : "ดู"}ขอบเขตงาน + เกณฑ์ เบา/กลาง/หนัก</button>
            {so && (
              <div style={{ fontSize: 13, color: "#3F5148", marginTop: 8, whiteSpace: "pre-wrap", background: "#F6FAF7", borderRadius: 10, padding: 10 }}>
                <b>ขอบเขต:</b> {job.scope || "—"}{"\n"}<b>เกณฑ์:</b> {job.tierCriteria || "—"}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {([["hourly", "รายชั่วโมง"], ["lump", "เหมา"], ["skip", "ไม่รับงานนี้"]] as const).map(([m, label]) => (
                <button key={m} disabled={ro} onClick={() => update(job, { mode: m })} style={{ ...V.btn, flex: 1, padding: "8px 4px", fontSize: 13.5, background: mode === m ? (m === "skip" ? "#52525B" : "#1B8C4B") : "#fff", color: mode === m ? "#fff" : "#14271C", borderColor: mode === m ? "transparent" : "#D5E2DA" }}>{label}</button>
              ))}
            </div>
            {a && a.mode !== "skip" && (
              <>
                <TierBlock title="Mixer L (10 ล้อ)" color="#1B8C4B" mode={a.mode} t={a.L} ro={ro} onChange={(L) => update(job, { L })} />
                <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 4px", fontSize: 13.5 }}>
                  <input type="checkbox" checked={a.sameAsL} disabled={ro} onChange={(e) => update(job, { sameAsL: e.target.checked })} style={{ width: 18, height: 18 }} /> Mixer S ราคาเดียวกับ L
                </label>
                {!a.sameAsL && <TierBlock title="Mixer S (6 ล้อ)" color="#1D4ED8" mode={a.mode} t={a.S} ro={ro} onChange={(S) => update(job, { S })} />}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 10 }}>
                  <div><label style={V.label}>รับประกัน (เดือน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a.warrantyMonths ?? ""} onBlur={(e) => update(job, { warrantyMonths: toNum(e.target.value) })} /></div>
                  <div><label style={V.label}>หมายเหตุ</label><input style={V.input} disabled={ro} defaultValue={a.note} maxLength={500} onBlur={(e) => update(job, { note: e.target.value })} /></div>
                </div>
              </>
            )}
          </div>
        )
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ ...V.btn, flex: 1 }} disabled={step === 0} onClick={() => { void flush(); setStep(step - 1); window.scrollTo(0, 0) }}>‹ ชีตก่อนหน้า</button>
        {step < sheets.length - 1
          ? <button style={{ ...V.btnPrimary, flex: 1, width: "auto" }} onClick={() => { void flush(); setStep(step + 1); window.scrollTo(0, 0) }}>ชีตถัดไป ›</button>
          : <a href={`/q/${token}`} style={{ ...V.btnPrimary, flex: 1, width: "auto", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>กลับหน้าหลัก</a>}
      </div>
      <SaveBadge state={state} savedAt={savedAt} errorMsg={errorMsg} onRetry={() => void flush()} />
    </div>
  )
}

function TierBlock({ title, color, mode, t, ro, onChange }: { title: string; color: string; mode: "hourly" | "lump"; t: Tier; ro: boolean; onChange: (t: Tier) => void }) {
  const F = ({ k, label }: { k: keyof Tier; label: string }) => (
    <div><label style={V.label}>{label}</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={t[k] ?? ""} placeholder="฿" onBlur={(e) => onChange({ ...t, [k]: toNum(e.target.value) })} /></div>
  )
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: color + "0D", border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      {mode === "hourly"
        ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><F k="rate" label="อัตรา ฿/ชม." /><F k="hours" label="ชม.มาตรฐาน" /></div>
        : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><F k="light" label="เหมา เบา" /><F k="mid" label="เหมา กลาง" /><F k="heavy" label="เหมา หนัก" /></div>}
    </div>
  )
}
```
Note: `defaultValue` + `onBlur` is deliberate — controlled inputs re-rendering 99 cards on every keystroke lag on low-end phones; the local `setLocal` update on blur keeps progress counts and the badge accurate. Because `defaultValue` is only read on mount, key the card list by `job.jobCode` (already) and never reorder.

- [ ] **Step 5: Write `components/rfq-vendor-parts.tsx`** (compact rows, search within sheet)

```tsx
"use client"
// หน้าอะไหล่: ชีตละขั้น · แถวละรายการ กะทัดรัด · ค้นหาในชีต · "ไม่มีจำหน่าย"
import { useMemo, useState } from "react"
import { SHEET_ORDER, partKey, type RfqPartAnswer, type RfqPart } from "@/lib/rfq-core"
import { useInvite, useAutosave, V, VendorHeader, StatusNotice, SaveBadge, toNum } from "@/components/rfq-vendor-shared"

const EMPTY: RfqPartAnswer = { skip: false, sameAsL: true, brand: "", note: "", at: "" }

export function RfqVendorParts({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  const { save, flush, state, savedAt, errorMsg } = useAutosave(token)
  const [step, setStep] = useState(0)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)   // แถวที่กางช่อง ยี่ห้อ/รับประกัน/ส่งมอบ/หมายเหตุ
  const sheets = useMemo(() => data ? SHEET_ORDER.filter((s) => data.invite.sheets.includes(s) && data.parts.some((p) => p.sheet === s)) : [], [data])
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, parts } = data
  const ro = !invite.canWrite
  const sheet = sheets[step]
  const all = parts.filter((p) => p.sheet === sheet)
  const list = q ? all.filter((p) => (p.name + " " + p.sku).toLowerCase().includes(q.toLowerCase())) : all
  const doneIn = (s: string) => parts.filter((p) => p.sheet === s && invite.parts[partKey(p.sheet, p.sku)]).length

  function update(p: RfqPart, patch: Partial<RfqPartAnswer>) {
    if (ro) return
    const k = partKey(p.sheet, p.sku)
    const cur = invite.parts[k] ?? EMPTY
    let next: RfqPartAnswer = { ...cur, ...patch }
    if (next.sameAsL) next = { ...next, priceS: next.priceL }
    setLocal((d) => ({ ...d, invite: { ...d.invite, parts: { ...d.invite.parts, [k]: next } } }))
    void save({ parts: { [k]: next } })
  }

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="อะไหล่ — ราคาต่อหน่วย" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {sheets.map((s, i) => {
          const t = parts.find((p) => p.sheet === s)?.sheetTitle ?? s
          const on = i === step
          return <button key={s} onClick={() => { setStep(i); setQ("") }} style={{ ...V.btn, flexShrink: 0, minHeight: 36, padding: "6px 10px", fontSize: 12.5, background: on ? "#1D4ED8" : "#fff", color: on ? "#fff" : "#14271C", borderColor: on ? "#1D4ED8" : "#D5E2DA" }}>{s} {t} <span style={{ opacity: .8 }}>· {doneIn(s)}/{parts.filter((p) => p.sheet === s).length}</span></button>
        })}
      </div>
      <input style={{ ...V.input, marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`ค้นหาในชีต ${sheet} (ชื่อหรือรหัส)`} />
      <div style={{ ...V.muted, marginBottom: 6 }}>{list.length} รายการ · กรอกแล้ว {doneIn(sheet)}/{all.length}</div>
      {list.map((p) => {
        const k = partKey(p.sheet, p.sku)
        const a = invite.parts[k]
        const border = !a ? "#F3D48A" : a.skip ? "#D4D4D8" : "#BFDBFE"
        const isOpen = open === k
        return (
          <div key={k} style={{ ...V.card, padding: 10, borderLeft: `4px solid ${border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</div>
                <div style={V.muted}>{p.sku} · {p.unit} · ใช้กับ {p.useWith}</div>
              </div>
              <button disabled={ro} onClick={() => update(p, { skip: !a?.skip })} style={{ ...V.btn, minHeight: 34, padding: "4px 10px", fontSize: 12, background: a?.skip ? "#52525B" : "#fff", color: a?.skip ? "#fff" : "#52525B", flexShrink: 0 }}>{a?.skip ? "ไม่มีจำหน่าย ✓" : "ไม่มีจำหน่าย"}</button>
            </div>
            {!a?.skip && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", marginTop: 8 }}>
                <div><label style={V.label}>฿/หน่วย Mixer L</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.priceL ?? ""} placeholder="฿" onBlur={(e) => update(p, { priceL: toNum(e.target.value) })} /></div>
                <div><label style={V.label}>฿/หน่วย Mixer S</label><input style={{ ...V.input, background: a?.sameAsL !== false ? "#F6FAF7" : "#fff" }} inputMode="decimal" disabled={ro || a?.sameAsL !== false} defaultValue={a?.priceS ?? ""} placeholder={a?.sameAsL !== false ? "= L" : "฿"} onBlur={(e) => update(p, { priceS: toNum(e.target.value) })} /></div>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, paddingBottom: 8 }}><input type="checkbox" checked={a?.sameAsL !== false} disabled={ro} onChange={(e) => update(p, { sameAsL: e.target.checked })} style={{ width: 18, height: 18 }} />S=L</label>
              </div>
            )}
            <button onClick={() => setOpen(isOpen ? null : k)} style={{ ...V.btn, minHeight: 30, padding: "3px 10px", fontSize: 12, marginTop: 8, background: "#F6FAF7" }}>{isOpen ? "ซ่อน" : "เพิ่ม"} ยี่ห้อ / รับประกัน / ส่งมอบ / หมายเหตุ{a?.brand ? ` · ${a.brand}` : ""}</button>
            {isOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}><label style={V.label}>ยี่ห้อ / สเปกที่เสนอ</label><input style={V.input} disabled={ro} defaultValue={a?.brand ?? ""} maxLength={120} onBlur={(e) => update(p, { brand: e.target.value })} /></div>
                <div><label style={V.label}>รับประกัน (เดือน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.warrantyMonths ?? ""} onBlur={(e) => update(p, { warrantyMonths: toNum(e.target.value) })} /></div>
                <div><label style={V.label}>ส่งมอบ (วัน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.leadDays ?? ""} onBlur={(e) => update(p, { leadDays: toNum(e.target.value) })} /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={V.label}>หมายเหตุ</label><input style={V.input} disabled={ro} defaultValue={a?.note ?? ""} maxLength={500} onBlur={(e) => update(p, { note: e.target.value })} /></div>
              </div>
            )}
          </div>
        )
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ ...V.btn, flex: 1 }} disabled={step === 0} onClick={() => { void flush(); setStep(step - 1); setQ(""); window.scrollTo(0, 0) }}>‹ ชีตก่อนหน้า</button>
        {step < sheets.length - 1
          ? <button style={{ ...V.btnPrimary, flex: 1, width: "auto", background: "#1D4ED8" }} onClick={() => { void flush(); setStep(step + 1); setQ(""); window.scrollTo(0, 0) }}>ชีตถัดไป ›</button>
          : <a href={`/q/${token}`} style={{ ...V.btnPrimary, flex: 1, width: "auto", background: "#1D4ED8", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>กลับหน้าหลัก</a>}
      </div>
      <SaveBadge state={state} savedAt={savedAt} errorMsg={errorMsg} onRetry={() => void flush()} />
    </div>
  )
}
```

- [ ] **Step 6: Pages**

`app/q/[token]/page.tsx`:
```tsx
import { RfqVendorHub } from "@/components/rfq-vendor-hub"
export const metadata = { title: "ใบขอราคา — Mena Transport" }
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <div style={{ width: "100%", height: "100%", overflowY: "auto" }}><RfqVendorHub token={token} /></div>
}
```
`app/q/[token]/labour/page.tsx` — same with `RfqVendorLabour`; `app/q/[token]/parts/page.tsx` — same with `RfqVendorParts`.

- [ ] **Step 7: Verify in browser**

```bash
npx tsc --noEmit -p . && npx eslint components/rfq-vendor-*.tsx app/q components/app-shell.tsx
```
With dev server running, create an invite via curl (Task 4 script leaves one in ส่งแล้ว — create a fresh one) and open `http://localhost:3000/q/<token>` in Playwright at viewport 390×844: identity step → hub with two cards → labour page fill one job → badge shows "บันทึกแล้ว" → reload keeps values → parts page → hub shows n/N → submit → notice ส่งแล้ว and inputs disabled. Take screenshots of each into the scratchpad.

- [ ] **Step 8: Commit**

```bash
git add components/rfq-vendor-*.tsx app/q components/app-shell.tsx
git commit -m "rfq: vendor public pages — identity, hub, labour wizard, parts wizard, autosave"
```

---

### Task 6: Procurement list + review pages, nav

**Files:**
- Create: `components/rfq-list-page.tsx`, `components/rfq-review-page.tsx`, `app/rfq/page.tsx`, `app/rfq/[id]/page.tsx`
- Modify: `lib/nav.ts` (vendor group: add item `{ href: "/rfq", label: "ใบขอราคาอู่", icon: FileText, exact: false, desc: "ลิงก์ขอราคา · ตรวจและยืนยันใบเสนอราคา" }` — import `FileText` from lucide-react if not already)

**Interfaces:**
- Consumes `GET /api/rfq`, `GET /api/rfq/[id]`, `PATCH /api/rfq/[id]`, `GET /api/rfq/[id]/log`, `GET /api/rfq/[id]/xlsx` (Task 7), `canApproveVendor`, `STATUS_META`, `addMonths`, `bkkToday`, `progress`.

- [ ] **Step 1: `components/rfq-list-page.tsx`**

```tsx
"use client"
// รายการลิงก์ขอราคา — สถานะ ความคืบหน้า คัดลอกลิงก์ ต่ออายุ ยกเลิก
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Copy, RefreshCw, CalendarPlus, XCircle } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { canApproveVendor } from "@/lib/roles"
import { STATUS_META, addDays, type EffectiveStatus, type RfqInvite } from "@/lib/rfq-core"
import { mitr, num } from "@/components/vendor-shared"
import { thDate, thDateTime } from "@/components/rfq-vendor-shared"

type Row = Omit<RfqInvite, "items" | "parts"> & { answered: { labour: number; parts: number }; total: { labour: number; parts: number }; effective: EffectiveStatus }
const ALL: EffectiveStatus[] = ["สร้างแล้ว", "กำลังกรอก", "ส่งแล้ว", "ส่งกลับแก้", "ยืนยันแล้ว", "หมดอายุ", "ยกเลิก"]

export function RfqListPage() {
  const { data: session } = useSession()
  const approver = canApproveVendor(session?.user?.email)
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(""); const [st, setSt] = useState<EffectiveStatus | "">(""); const [title, setTitle] = useState("")
  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch("/api/rfq", { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d?.error); setRows(d.invites) }
    catch (e) { swalError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const titles = useMemo(() => [...new Set(rows.map((r) => r.title))], [rows])
  const shown = rows.filter((r) => (!st || r.effective === st) && (!title || r.title === title) && (!q || (r.vendor + r.title + (r.contact?.name ?? "")).toLowerCase().includes(q.toLowerCase())))
  const counts = ALL.map((s) => [s, rows.filter((r) => r.effective === s).length] as const).filter(([, n]) => n)
  const copy = (r: Row) => { void navigator.clipboard.writeText(`${location.origin}/q/${r.token}`); swalToast("success", "คัดลอกลิงก์แล้ว") }
  async function act(r: Row, action: "extend" | "cancel") {
    let body: Record<string, unknown> = { action }
    if (action === "extend") { const d = prompt("วันปิดรับใหม่ (YYYY-MM-DD)", addDays(r.deadline, 7)); if (!d) return; body = { action, deadline: d } }
    if (action === "cancel" && !confirm(`ยกเลิกลิงก์ของ ${r.vendor}?`)) return
    const res = await fetch(`/api/rfq/${r._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalError(d?.error ?? "ไม่สำเร็จ"); return }
    swalToast("success", "บันทึกแล้ว"); void load()
  }
  const pill = (s: EffectiveStatus) => { const m = STATUS_META[s]; return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.fg, whiteSpace: "nowrap" }}>{s}</span> }
  const bar = (done: number, total: number, color: string) => total ? <div title={`${done}/${total}`} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 70, height: 6, borderRadius: 999, background: "#EEF3EF", overflow: "hidden" }}><div style={{ width: `${Math.round(done / total * 100)}%`, height: "100%", background: color }} /></div><span style={{ fontSize: 11.5, color: "#6B7C72" }}>{done}/{total}</span></div> : <span style={{ fontSize: 11.5, color: "#B8C4BC" }}>—</span>
  return (
    <div style={{ ...mitr }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>ใบขอราคาอู่</h1>
        <span style={{ fontSize: 12.5, color: "#6B7C72" }}>สร้างลิงก์ใหม่ได้จากหน้า <Link href="/vendors" style={{ color: "#0E7490" }}>ตารางความสามารถอู่</Link> (เลือกอู่ → ขอราคา)</span>
        <button onClick={() => void load()} style={{ ...mitr, marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}><RefreshCw size={14} /> โหลดใหม่</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={() => setSt("")} style={{ ...mitr, padding: "5px 11px", borderRadius: 999, fontSize: 12, border: !st ? "1px solid #0E7490" : "1px solid #E5E7EB", background: !st ? "#ECFEFF" : "#fff", cursor: "pointer" }}>ทั้งหมด {num(rows.length)}</button>
        {counts.map(([s, n]) => <button key={s} onClick={() => setSt(st === s ? "" : s)} style={{ ...mitr, padding: "5px 11px", borderRadius: 999, fontSize: 12, border: st === s ? "1px solid #0E7490" : "1px solid #E5E7EB", background: STATUS_META[s].bg, color: STATUS_META[s].fg, cursor: "pointer" }}>{s} {n}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาอู่ / รอบ / ผู้ติดต่อ" style={{ ...mitr, padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 260 }} />
        <select value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...mitr, padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}><option value="">ทุกรอบ</option>{titles.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </div>
      <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#F6FAF7", textAlign: "left" }}>{["อู่", "รอบ", "ชีต", "สถานะ", "ค่าแรง", "อะไหล่", "เปิดล่าสุด", "ส่งเมื่อ", "ปิดรับ", "ราคามีผลถึง", ""].map((h) => <th key={h} style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ padding: 20, color: "#9AA8A0" }}>กำลังโหลด…</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={11} style={{ padding: 20, color: "#9AA8A0" }}>ไม่มีรายการ</td></tr>}
            {shown.map((r) => (
              <tr key={r._id} style={{ borderTop: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}><Link href={`/rfq/${r._id}`} style={{ color: "#14271C", textDecoration: "none" }}>{r.vendor}</Link>{r.contact && <div style={{ fontSize: 11, color: "#9AA8A0", fontWeight: 400 }}>{r.contact.name} · {r.contact.phone || r.contact.email}</div>}</td>
                <td style={{ padding: "8px 10px" }}>{r.title}</td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, color: "#6B7C72" }}>{r.sheets.join(" ")}</td>
                <td style={{ padding: "8px 10px" }}>{pill(r.effective)}</td>
                <td style={{ padding: "8px 10px" }}>{r.sections.includes("labour") ? bar(r.answered.labour, r.total.labour, "#1B8C4B") : "—"}</td>
                <td style={{ padding: "8px 10px" }}>{r.sections.includes("parts") ? bar(r.answered.parts, r.total.parts, "#1D4ED8") : "—"}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6B7C72" }}>{thDateTime(r.openedAt)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6B7C72" }}>{thDateTime(r.submittedAt)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{thDate(r.deadline)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.confirm ? thDate(r.confirm.validTo) : "—"}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  <button title="คัดลอกลิงก์" onClick={() => copy(r)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#0E7490" }}><Copy size={15} /></button>
                  {["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้", "หมดอายุ"].includes(r.effective) && <button title="ต่ออายุ" onClick={() => void act(r, "extend")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#92400E" }}><CalendarPlus size={15} /></button>}
                  {approver && r.effective !== "ยืนยันแล้ว" && r.effective !== "ยกเลิก" && <button title="ยกเลิก" onClick={() => void act(r, "cancel")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B91C1C" }}><XCircle size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `components/rfq-review-page.tsx`** (tabs ค่าแรง / อะไหล่, confirm modal, return, log)

```tsx
"use client"
// ตรวจใบเสนอราคา 1 ใบ: หัวใบ · แท็บ ค่าแรง / อะไหล่ (อ่านอย่างเดียว) · ยืนยัน / ส่งกลับแก้ · Excel · ประวัติ
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Download } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { canApproveVendor } from "@/lib/roles"
import { bkkToday } from "@/lib/bkk-time"
import { STATUS_META, SHEET_ORDER, addMonths, partKey, progress, effectiveStatus, type RfqInvite, type RfqJob, type RfqPart, type RfqLogEntry } from "@/lib/rfq-core"
import { mitr } from "@/components/vendor-shared"
import { thDate, thDateTime } from "@/components/rfq-vendor-shared"

type Data = { invite: RfqInvite; jobs: RfqJob[]; parts: RfqPart[] }
const fmt = (n: number | undefined) => n === undefined ? "" : n.toLocaleString("th-TH")
const td = { padding: "6px 8px", borderBottom: "1px solid #F3F4F6", fontSize: 12.5, verticalAlign: "top" as const }
const th = { ...td, fontWeight: 600, background: "#F6FAF7", whiteSpace: "nowrap" as const }

export function RfqReviewPage({ id }: { id: string }) {
  const { data: session } = useSession()
  const approver = canApproveVendor(session?.user?.email)
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<"labour" | "parts">("labour")
  const [log, setLog] = useState<(Omit<RfqLogEntry, "at"> & { at: string })[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const load = useCallback(async () => {
    const r = await fetch(`/api/rfq/${id}`, { cache: "no-store" }); const d = await r.json()
    if (!r.ok) { swalError(d?.error ?? "โหลดไม่สำเร็จ"); return }
    setData(d); setTab(d.invite.sections.includes("labour") ? "labour" : "parts")
  }, [id])
  useEffect(() => { void load() }, [load])
  async function act(body: Record<string, unknown>) {
    const r = await fetch(`/api/rfq/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { swalError(d?.error ?? "ไม่สำเร็จ"); return false }
    swalToast("success", "บันทึกแล้ว"); void load(); setLog(null); return true
  }
  async function openLog() { const r = await fetch(`/api/rfq/${id}/log`); const d = await r.json(); setLog(d.log ?? []) }
  if (!data) return <div style={{ ...mitr, color: "#9AA8A0" }}>กำลังโหลด…</div>
  const { invite: inv, jobs, parts } = data
  const eff = effectiveStatus(inv, bkkToday()); const m = STATUS_META[eff]
  const pg = progress(inv, jobs, parts)
  const sheets = SHEET_ORDER.filter((s) => inv.sheets.includes(s))
  return (
    <div style={mitr}>
      <div style={{ fontSize: 12.5, marginBottom: 6 }}><Link href="/rfq" style={{ color: "#0E7490" }}>‹ ใบขอราคาอู่</Link></div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{inv.vendor}</h1>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.fg }}>{eff}</span>
        <span style={{ fontSize: 12.5, color: "#6B7C72" }}>{inv.title} · ปิดรับ {thDate(inv.deadline)} · ชีต {sheets.join(" ")}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <a href={`/api/rfq/${id}/xlsx`} style={{ ...mitr, display: "inline-flex", gap: 6, alignItems: "center", padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, textDecoration: "none", color: "#14271C" }}><Download size={14} /> Excel</a>
          <button onClick={() => void openLog()} style={{ ...mitr, padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>ประวัติ</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Box title="ผู้ติดต่อ">{inv.contact ? <>{inv.contact.name}<br /><span style={{ color: "#6B7C72" }}>{inv.contact.phone} {inv.contact.email}</span></> : <span style={{ color: "#9AA8A0" }}>ยังไม่เปิดลิงก์</span>}</Box>
        <Box title="ความคืบหน้า">ค่าแรง {pg.labour.done}/{pg.labour.total} · อะไหล่ {pg.parts.done}/{pg.parts.total}<br /><span style={{ color: "#6B7C72" }}>เปิด {thDateTime(inv.openedAt)} · ส่ง {thDateTime(inv.submittedAt)}</span></Box>
        <Box title="การยืนยัน">{inv.confirm ? <>ราคามีผล {thDate(inv.confirm.validFrom)} – {thDate(inv.confirm.validTo)}<br /><span style={{ color: "#6B7C72" }}>โดย {inv.confirm.by} · {thDateTime(inv.confirm.at)}{inv.confirm.note && ` · ${inv.confirm.note}`}</span></> : inv.returnNote ? <span style={{ color: "#C2410C" }}>ส่งกลับแก้: {inv.returnNote}</span> : <span style={{ color: "#9AA8A0" }}>—</span>}</Box>
        {inv.submitNote && <Box title="หมายเหตุจากอู่">{inv.submitNote}</Box>}
      </div>
      {inv.status === "ส่งแล้ว" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {approver && <button onClick={() => setConfirmOpen(true)} style={{ ...mitr, padding: "9px 16px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}>ยืนยันการเสนอราคา</button>}
          <button onClick={() => { const n = prompt("เหตุผลที่ส่งกลับให้อู่แก้ (อู่จะเห็นข้อความนี้)"); if (n?.trim()) void act({ action: "return", note: n }) }} style={{ ...mitr, padding: "9px 16px", borderRadius: 8, border: "1px solid #C2410C", background: "#fff", color: "#C2410C", fontWeight: 600, cursor: "pointer" }}>ส่งกลับแก้</button>
          {!approver && <span style={{ fontSize: 12, color: "#9AA8A0", alignSelf: "center" }}>ยืนยันได้เฉพาะแอดมินและผู้อนุมัติอู่</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {inv.sections.includes("labour") && <Tab on={tab === "labour"} onClick={() => setTab("labour")} label={`ค่าแรง ${pg.labour.done}/${pg.labour.total}`} color="#1B8C4B" />}
        {inv.sections.includes("parts") && <Tab on={tab === "parts"} onClick={() => setTab("parts")} label={`อะไหล่ ${pg.parts.done}/${pg.parts.total}`} color="#1D4ED8" />}
      </div>
      {tab === "labour" && sheets.map((s) => {
        const list = jobs.filter((j) => j.sheet === s); if (!list.length) return null
        return (
          <div key={s} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 12, overflowX: "auto" }}>
            <div style={{ padding: "8px 10px", fontWeight: 600, background: "#F6FAF7", borderBottom: "1px solid #E5E7EB" }}>{s} · {list[0].sheetTitle}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "งาน", "แบบ", "L ฿/ชม.", "L ชม.", "L เบา", "L กลาง", "L หนัก", "S ฿/ชม.", "S ชม.", "S เบา", "S กลาง", "S หนัก", "ประกัน", "หมายเหตุ"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{list.map((j) => { const a = inv.items[j.jobCode]; return (
                <tr key={j.jobCode} style={{ background: !a ? "#FFFBEB" : a.mode === "skip" ? "#FAFAFA" : "#fff" }}>
                  <td style={td}>{j.seq}</td><td style={{ ...td, minWidth: 200 }}>{j.name}<div style={{ fontSize: 11, color: "#9AA8A0" }}>{j.jobCode} · อ้างอิง L {j.refHoursL ?? "—"} / S {j.refHoursS ?? "—"} ชม.</div></td>
                  <td style={td}>{!a ? <span style={{ color: "#92400E" }}>ไม่กรอก</span> : a.mode === "skip" ? "ไม่รับงาน" : a.mode === "hourly" ? "รายชั่วโมง" : "เหมา"}</td>
                  <td style={td}>{fmt(a?.L.rate)}</td><td style={td}>{fmt(a?.L.hours)}</td><td style={td}>{fmt(a?.L.light)}</td><td style={td}>{fmt(a?.L.mid)}</td><td style={td}>{fmt(a?.L.heavy)}</td>
                  <td style={td}>{fmt(a?.S.rate)}</td><td style={td}>{fmt(a?.S.hours)}</td><td style={td}>{fmt(a?.S.light)}</td><td style={td}>{fmt(a?.S.mid)}</td><td style={td}>{fmt(a?.S.heavy)}</td>
                  <td style={td}>{fmt(a?.warrantyMonths)}</td><td style={{ ...td, minWidth: 140 }}>{a?.note}</td>
                </tr>) })}</tbody>
            </table>
          </div>) })}
      {tab === "parts" && sheets.map((s) => {
        const list = parts.filter((p) => p.sheet === s); if (!list.length) return null
        return (
          <div key={s} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 12, overflowX: "auto" }}>
            <div style={{ padding: "8px 10px", fontWeight: 600, background: "#F6FAF7", borderBottom: "1px solid #E5E7EB" }}>{s} · {list[0].sheetTitle}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "รหัส", "รายการ", "ใช้กับ", "หน่วย", "฿ L", "฿ S", "ยี่ห้อ/สเปก", "ประกัน", "ส่งมอบ", "หมายเหตุ"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{list.map((p) => { const a = inv.parts[partKey(p.sheet, p.sku)]; return (
                <tr key={p.sku} style={{ background: !a ? "#FFFBEB" : a.skip ? "#FAFAFA" : "#fff" }}>
                  <td style={td}>{p.seq}</td><td style={td}>{p.sku}</td><td style={{ ...td, minWidth: 200 }}>{p.name}</td><td style={td}>{p.useWith}</td><td style={td}>{p.unit}</td>
                  <td style={td}>{!a ? <span style={{ color: "#92400E" }}>ไม่กรอก</span> : a.skip ? "ไม่มีจำหน่าย" : fmt(a.priceL)}</td><td style={td}>{a && !a.skip ? fmt(a.priceS) : ""}</td>
                  <td style={td}>{a?.brand}</td><td style={td}>{fmt(a?.warrantyMonths)}</td><td style={td}>{fmt(a?.leadDays)}</td><td style={{ ...td, minWidth: 140 }}>{a?.note}</td>
                </tr>) })}</tbody>
            </table>
          </div>) })}
      {log && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>ประวัติ</div>
          {!log.length && <div style={{ color: "#9AA8A0", fontSize: 12.5 }}>ไม่มี</div>}
          {log.map((e, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid #F3F4F6" : "none" }}><span style={{ color: "#6B7C72" }}>{thDateTime(e.at)}</span> · <b>{e.action}</b>{e.from && ` ${e.from} → ${e.to}`} · {e.by}{e.note && <span style={{ color: "#6B7C72" }}> · {e.note}</span>}</div>)}
        </div>
      )}
      {confirmOpen && <ConfirmModal onClose={() => setConfirmOpen(false)} onSubmit={async (v) => { if (await act({ action: "confirm", ...v })) setConfirmOpen(false) }} />}
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 10, fontSize: 13 }}><div style={{ fontSize: 11.5, color: "#9AA8A0", fontWeight: 600, marginBottom: 2 }}>{title}</div>{children}</div>
}
function Tab({ on, onClick, label, color }: { on: boolean; onClick: () => void; label: string; color: string }) {
  return <button onClick={onClick} style={{ ...mitr, padding: "7px 14px", borderRadius: 8, border: `1px solid ${on ? color : "#E5E7EB"}`, background: on ? color : "#fff", color: on ? "#fff" : "#14271C", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{label}</button>
}
function ConfirmModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: { validFrom: string; validTo: string; note: string }) => Promise<void> }) {
  const today = bkkToday()
  const [from, setFrom] = useState(today); const [to, setTo] = useState(addMonths(today, 12)); const [note, setNote] = useState("")
  const inp = { ...mitr, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" as const }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...mitr, background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>ยืนยันการเสนอราคา</div>
        <label style={{ fontSize: 12.5, fontWeight: 600 }}>ราคามีผลตั้งแต่</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
        <label style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, display: "block" }}>ถึง</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
        <label style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, display: "block" }}>หมายเหตุ</label><input value={note} onChange={(e) => setNote(e.target.value)} style={inp} maxLength={500} />
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...mitr, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>ยกเลิก</button>
          <button onClick={() => void onSubmit({ validFrom: from, validTo: to, note })} style={{ ...mitr, padding: "8px 14px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}>ยืนยัน</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Pages + nav**

`app/rfq/page.tsx`: `import { RfqListPage } from "@/components/rfq-list-page"; export default function Page() { return <RfqListPage /> }`
`app/rfq/[id]/page.tsx`: async page like price-compare `[id]` rendering `<RfqReviewPage id={id} />`.
`lib/nav.ts`: add the item to the `vendor` group after "ตารางความสามารถอู่".

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p . && npx eslint components/rfq-list-page.tsx components/rfq-review-page.tsx app/rfq lib/nav.ts`; open `/rfq` and `/rfq/<id>` in the browser (use the local login trick from memory or a minted cookie via Playwright `browser_evaluate` setting `document.cookie`). Confirm modal as approver requires a session for an approver email — mint locally with an approver email (do not commit).

- [ ] **Step 5: Commit**

```bash
git add components/rfq-list-page.tsx components/rfq-review-page.tsx app/rfq lib/nav.ts
git commit -m "rfq: procurement list + review pages (tabs ค่าแรง/อะไหล่, confirm with validity, return, log), nav"
```

---

### Task 7: Excel export `GET /api/rfq/[id]/xlsx`

**Files:**
- Create: `lib/rfq-xlsx.ts`, `app/api/rfq/[id]/xlsx/route.ts`

**Interfaces:**
- Produces `export async function buildRfqWorkbook(inv: RfqInvite, jobs: RfqJob[], parts: RfqPart[]): Promise<Buffer>`.

- [ ] **Step 1: Write `lib/rfq-xlsx.ts`**

```ts
// lib/rfq-xlsx.ts — ใบเสนอราคาอู่ → Excel เลย์เอาต์เดียวกับฟอร์มต้นฉบับ (1 ชีตต่อระบบ)
// เฉพาะฝั่ง server (route) · โหลด exceljs ตอนเรียกเท่านั้น
import { SHEET_ORDER, partKey, type RfqInvite, type RfqJob, type RfqPart } from "@/lib/rfq-core"

const FONT = "Tahoma"
const HEAD = "FF1B8C4B", BAND_L = "FFE4EFE8", BAND_S = "FFDBEAFE", YELLOW = "FFFFF9C4", GRID = "FFE4EEE8"

export async function buildRfqWorkbook(inv: RfqInvite, jobs: RfqJob[], parts: RfqPart[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  wb.creator = "Mena WMS"
  const border = { top: { style: "thin" as const, color: { argb: GRID } }, left: { style: "thin" as const, color: { argb: GRID } }, bottom: { style: "thin" as const, color: { argb: GRID } }, right: { style: "thin" as const, color: { argb: GRID } } }
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } })
  for (const sheet of SHEET_ORDER.filter((s) => inv.sheets.includes(s))) {
    const js = jobs.filter((j) => j.sheet === sheet), ps = parts.filter((p) => p.sheet === sheet)
    if (!js.length && !ps.length) continue
    const title = (js[0] ?? ps[0]).sheetTitle
    const ws = wb.addWorksheet(`${sheet} ${title}`.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"))
    ws.views = [{ state: "frozen", ySplit: 8 }]
    ws.getCell("A1").value = `ใบเสนอราคางานซ่อม — ${sheet} ${title}`; ws.getCell("A1").font = { name: FONT, bold: true, size: 14 }
    ws.getCell("A2").value = `ผู้เสนอราคา (อู่/ร้าน): ${inv.vendor}   ผู้ติดต่อ: ${inv.contact?.name ?? "—"} ${inv.contact?.phone ?? ""} ${inv.contact?.email ?? ""}`
    ws.getCell("A3").value = `รอบ: ${inv.title}   สถานะ: ${inv.status}   ส่งเมื่อ: ${inv.submittedAt ?? "—"}` + (inv.confirm ? `   ราคามีผล ${inv.confirm.validFrom} – ${inv.confirm.validTo}` : "")
    ;[2, 3].forEach((r) => { ws.getCell(`A${r}`).font = { name: FONT, size: 10 } })
    ws.getCell("A5").value = "ส่วนที่ 1 · ค่าแรง — งานช่างมาตรฐาน"; ws.getCell("A5").font = { name: FONT, bold: true, size: 12 }
    // หัว 3 ชั้น: แถว 6 กลุ่ม L/S · แถว 7 รายชั่วโมง/เหมา · แถว 8 ชื่อคอลัมน์ (19 คอลัมน์ตามต้นฉบับ)
    ws.mergeCells("H6:L6"); ws.getCell("H6").value = "Mixer L (10 ล้อ)"; ws.getCell("H6").fill = fill(BAND_L)
    ws.mergeCells("M6:Q6"); ws.getCell("M6").value = "Mixer S (6 ล้อ)"; ws.getCell("M6").fill = fill(BAND_S)
    ws.mergeCells("H7:I7"); ws.getCell("H7").value = "รายชั่วโมง"; ws.mergeCells("J7:L7"); ws.getCell("J7").value = "เหมา (บาท/งาน)"
    ws.mergeCells("M7:N7"); ws.getCell("M7").value = "รายชั่วโมง"; ws.mergeCells("O7:Q7"); ws.getCell("O7").value = "เหมา (บาท/งาน)"
    const H = ["ลำดับ", "รหัสงาน", "ชื่องาน", "ขอบเขตงานที่รวมในราคา", "เกณฑ์แบ่งระดับ เบา / กลาง / หนัก", "ชม.อ้างอิง L", "ชม.อ้างอิง S", "อัตรา ฿/ชม.", "ชม.มาตรฐาน", "เหมา เบา", "เหมา กลาง", "เหมา หนัก", "อัตรา ฿/ชม.", "ชม.มาตรฐาน", "เหมา เบา", "เหมา กลาง", "เหมา หนัก", "รับประกัน (เดือน)", "หมายเหตุ"]
    ws.getRow(8).values = H
    for (let r = 6; r <= 8; r++) ws.getRow(r).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: r === 8 ? { argb: "FFFFFFFF" } : undefined }; if (r === 8) c.fill = fill(HEAD); c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border })
    ws.columns = [6, 14, 30, 40, 40, 10, 10, 10, 10, 11, 11, 11, 10, 10, 11, 11, 11, 10, 24].map((w) => ({ width: w }))
    let row = 9
    for (const j of js) {
      const a = inv.items[j.jobCode]
      const skip = a?.mode === "skip"
      ws.getRow(row).values = [j.seq, j.jobCode, j.name, j.scope, j.tierCriteria, j.refHoursL ?? "", j.refHoursS ?? "",
        a?.L.rate ?? "", a?.L.hours ?? "", a?.L.light ?? "", a?.L.mid ?? "", a?.L.heavy ?? "",
        a?.S.rate ?? "", a?.S.hours ?? "", a?.S.light ?? "", a?.S.mid ?? "", a?.S.heavy ?? "",
        a?.warrantyMonths ?? "", skip ? `ไม่รับงาน${a?.note ? " · " + a.note : ""}` : (a?.note ?? "")]
      ws.getRow(row).eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: FONT, size: 10 }; c.border = border; c.alignment = { vertical: "top", wrapText: col >= 3 && col <= 5 }; if (col >= 8 && col <= 18) { c.numFmt = "#,##0.##"; if (!a) c.fill = fill(YELLOW) } })
      row++
    }
    if (ps.length) {
      row += 2
      ws.getCell(`A${row}`).value = "ส่วนที่ 2 · อะไหล่ (หน่วย: บาท ไม่รวม VAT)"; ws.getCell(`A${row}`).font = { name: FONT, bold: true, size: 12 }; row++
      ws.mergeCells(`F${row}:F${row}`); ws.getCell(`F${row}`).value = "Mixer L"; ws.getCell(`F${row}`).fill = fill(BAND_L)
      ws.getCell(`G${row}`).value = "Mixer S"; ws.getCell(`G${row}`).fill = fill(BAND_S); row++
      ws.getRow(row).values = ["ลำดับ", "รหัสอะไหล่", "รายการอะไหล่", "ใช้กับ", "หน่วย", "฿/หน่วย", "฿/หน่วย", "ยี่ห้อ/สเปกที่เสนอ", "รับประกัน (เดือน)", "ส่งมอบ (วัน)", "หมายเหตุ"]
      ws.getRow(row).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } }; c.fill = fill(HEAD); c.alignment = { horizontal: "center", wrapText: true }; c.border = border }); row++
      for (const p of ps) {
        const a = inv.parts[partKey(p.sheet, p.sku)]
        ws.getRow(row).values = [p.seq, p.sku, p.name, p.useWith, p.unit, a?.skip ? "ไม่มีจำหน่าย" : (a?.priceL ?? ""), a?.skip ? "" : (a?.priceS ?? ""), a?.brand ?? "", a?.warrantyMonths ?? "", a?.leadDays ?? "", a?.note ?? ""]
        ws.getRow(row).eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: FONT, size: 10 }; c.border = border; if (col === 6 || col === 7) { c.numFmt = "#,##0.##"; if (!a) c.fill = fill(YELLOW) } })
        row++
      }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
```

- [ ] **Step 2: Route `app/api/rfq/[id]/xlsx/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getInvite, getCatalog } from "@/lib/rfq"
import { buildRfqWorkbook } from "@/lib/rfq-xlsx"
export const dynamic = "force-dynamic"
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const inv = await getInvite(id)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  const cat = await getCatalog(inv.catalogVersion)
  const sheets = new Set(inv.sheets)
  const buf = await buildRfqWorkbook(inv, cat.jobs.filter((j) => sheets.has(j.sheet)), cat.parts.filter((p) => sheets.has(p.sheet)))
  const name = encodeURIComponent(`ใบเสนอราคา_${inv.vendor}_${inv.title}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"))
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${name}` } })
}
```
Check `next.config.*` for `serverExternalPackages` — if `exceljs` is not listed and the build complains about it in a route, add it there.

- [ ] **Step 3: Verify** — `curl -s -H "Cookie: next-auth.session-token=$TOKEN" -o /tmp/rfq.xlsx http://localhost:3000/api/rfq/<id>/xlsx && python3 -c "import openpyxl;wb=openpyxl.load_workbook('/tmp/rfq.xlsx');print(wb.sheetnames);ws=wb.worksheets[0];print(ws['A1'].value, ws['H9'].value)"` — expect the S45 sheet and the rate you saved in Task 4's script (450).

- [ ] **Step 4: Commit**

```bash
git add lib/rfq-xlsx.ts app/api/rfq/[id]/xlsx
git commit -m "rfq: Excel export in original form layout (labour + parts per sheet)"
```

---

### Task 8: Create-links modal on /vendors

**Files:**
- Create: `components/rfq-create-modal.tsx`
- Modify: `components/vendor-matrix-page.tsx` — add a checkbox column before the vendor name (state `picked: Set<string>`), a header checkbox for "select all shown", and a toolbar button `ขอราคา (N)` (disabled when N = 0) that opens the modal with the picked `VendorSummary[]`.

**Interfaces:**
- Consumes `GET /api/rfq/catalog`, `POST /api/rfq`, `sheetsForVendor`, `addDays`, `bkkToday`, `SHEET_ORDER`.
- Produces `export function RfqCreateModal(props: { vendors: { vendor: string; codes: string[] }[]; onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Write `components/rfq-create-modal.tsx`**

```tsx
"use client"
// modal สร้างลิงก์ขอราคา: ชื่อรอบ · วันปิดรับ · ตาราง อู่ × ชีต (ค่าตั้งต้นจากช่องที่ติ๊ก) · ส่วน ค่าแรง/อะไหล่ → ลิงก์รายอู่ + ข้อความ LINE
import { useEffect, useMemo, useState } from "react"
import { Copy, X } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import { sheetsForVendor, addDays, SHEET_ORDER, SVC_SHEET, type RfqSection } from "@/lib/rfq-core"
import { mitr } from "@/components/vendor-shared"
import { thDate } from "@/components/rfq-vendor-shared"

type SheetInfo = { sheet: string; title: string; jobs: number; parts: number }
type Created = { id: string; vendor: string; token: string; url: string }

export function RfqCreateModal({ vendors, onClose }: { vendors: { vendor: string; codes: string[] }[]; onClose: () => void }) {
  const [catalog, setCatalog] = useState<SheetInfo[]>([])
  const [title, setTitle] = useState(`ขอราคางานช่าง Mixer ${new Date().toLocaleDateString("th-TH", { month: "short", year: "2-digit" })}`)
  const [deadline, setDeadline] = useState(addDays(bkkToday(), 14))
  const [sections, setSections] = useState<RfqSection[]>(["labour", "parts"])
  const [sheets, setSheets] = useState<Record<string, Set<string>>>(() => Object.fromEntries(vendors.map((v) => [v.vendor, new Set(sheetsForVendor(v.codes))])))
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Created[] | null>(null)
  useEffect(() => { void fetch("/api/rfq/catalog").then((r) => r.json()).then((d) => setCatalog(d.sheets ?? [])).catch(() => setCatalog([])) }, [])
  const cols = useMemo(() => SHEET_ORDER.filter((s) => catalog.some((c) => c.sheet === s)), [catalog])
  const toggle = (vendor: string, s: string) => setSheets((m) => { const n = new Set(m[vendor]); if (s === SVC_SHEET) return m; if (n.has(s)) n.delete(s); else n.add(s); return { ...m, [vendor]: n } })
  async function create() {
    if (!title.trim()) { swalError("กรุณาตั้งชื่อรอบ"); return }
    if (!sections.length) { swalError("เลือกอย่างน้อย 1 ส่วน (ค่าแรง/อะไหล่)"); return }
    setBusy(true)
    try {
      const r = await fetch("/api/rfq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, deadline, invites: vendors.map((v) => ({ vendor: v.vendor, sheets: [...sheets[v.vendor]], sections })) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "สร้างไม่สำเร็จ")
      setCreated(d.invites)
    } catch (e) { swalError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const lineText = (c: Created) => `เรียน ${c.vendor}\nMena Transport ขอเชิญเสนอราคา ${title}\nกรอกได้ที่ลิงก์นี้ (เปิดจากมือถือได้ ไม่ต้องสมัคร): ${c.url}\nปิดรับ ${thDate(deadline)}\nขอบคุณครับ/ค่ะ — ฝ่ายจัดซื้อ`
  const copy = (t: string) => { void navigator.clipboard.writeText(t); swalToast("success", "คัดลอกแล้ว") }
  const inp = { ...mitr, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...mitr, background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 960, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{created ? `สร้างลิงก์แล้ว ${created.length} อู่` : `ขอราคา — ${vendors.length} อู่`}</div>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {!created ? (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
              <label style={{ flex: 2, minWidth: 220 }}><div style={{ fontSize: 12, fontWeight: 600 }}>ชื่อรอบ</div><input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} maxLength={120} /></label>
              <label><div style={{ fontSize: 12, fontWeight: 600 }}>ปิดรับ</div><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inp} /></label>
              <div><div style={{ fontSize: 12, fontWeight: 600 }}>ส่วนที่ให้เสนอ</div>
                {(["labour", "parts"] as const).map((s) => <label key={s} style={{ marginRight: 12, fontSize: 13 }}><input type="checkbox" checked={sections.includes(s)} onChange={(e) => setSections((c) => e.target.checked ? [...new Set([...c, s])] : c.filter((x) => x !== s))} /> {s === "labour" ? "ค่าแรง" : "อะไหล่"}</label>)}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#6B7C72", marginBottom: 6 }}>ค่าตั้งต้นของชีตมาจากช่องที่ติ๊กในตารางความสามารถ · SVC (งานช่างพื้นฐาน) ให้ทุกอู่ · คลิกช่องเพื่อเพิ่ม/ลด</div>
            <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
                <thead><tr style={{ background: "#F6FAF7" }}><th style={{ padding: 6, textAlign: "left", position: "sticky", left: 0, background: "#F6FAF7" }}>อู่</th>{cols.map((s) => { const c = catalog.find((x) => x.sheet === s)!; return <th key={s} title={`${c.title} · งาน ${c.jobs} · อะไหล่ ${c.parts}`} style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap" }}>{s}</th> })}</tr></thead>
                <tbody>{vendors.map((v) => <tr key={v.vendor} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }}>{v.vendor}</td>
                  {cols.map((s) => { const on = sheets[v.vendor].has(s); return <td key={s} onClick={() => toggle(v.vendor, s)} style={{ padding: 6, textAlign: "center", cursor: s === SVC_SHEET ? "default" : "pointer", background: on ? "#ECFDF5" : "#fff", color: on ? "#047857" : "#D1D5DB", fontWeight: 700 }}>{on ? "✓" : "·"}</td> })}
                </tr>)}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={onClose} style={{ ...inp, background: "#fff", cursor: "pointer" }}>ยกเลิก</button>
              <button disabled={busy} onClick={() => void create()} style={{ ...mitr, padding: "8px 16px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: busy ? .6 : 1 }}>สร้างลิงก์</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => copy(created.map(lineText).join("\n\n"))} style={{ ...mitr, display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 14px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}><Copy size={14} /> คัดลอกข้อความ LINE ทั้งหมด</button>
              <a href="/rfq" style={{ ...inp, textDecoration: "none", color: "#14271C" }}>ไปหน้าใบขอราคาอู่</a>
            </div>
            {created.map((c) => (
              <div key={c.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{c.vendor}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <code style={{ fontSize: 12, background: "#F6FAF7", padding: "4px 8px", borderRadius: 6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.url}</code>
                  <button onClick={() => copy(c.url)} style={{ ...inp, cursor: "pointer" }}>ลิงก์</button>
                  <button onClick={() => copy(lineText(c))} style={{ ...inp, cursor: "pointer" }}>ข้อความ LINE</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `components/vendor-matrix-page.tsx`**

Add state near the other `useState`s:
```tsx
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [rfqOpen, setRfqOpen] = useState(false)
```
Import: `import { RfqCreateModal } from "@/components/rfq-create-modal"` and `import { FileText } from "lucide-react"` (extend the existing lucide import).
Toolbar (next to the Excel button, before it):
```tsx
            <button
              onClick={() => setRfqOpen(true)}
              disabled={!picked.size}
              title="สร้างลิงก์ขอราคาให้อู่ที่เลือก (ติ๊กช่องหน้าชื่ออู่)"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "none", background: picked.size ? "#1B8C4B" : "#E5E7EB", color: picked.size ? "#fff" : "#9CA3AF", fontSize: 13, fontWeight: 600, cursor: picked.size ? "pointer" : "not-allowed" }}
            >
              <FileText size={14} /> ขอราคา{picked.size ? ` (${picked.size})` : ""}
            </button>
```
Table: add a first `<th>` with a checkbox (`checked={rows.length > 0 && rows.every((v) => picked.has(v.vendor))}`, onChange selects/deselects all `rows`) and a first `<td>` per row with `<input type="checkbox" checked={picked.has(v.vendor)} onChange=… />` (stopPropagation not needed; rows have no click handler). Keep the existing sticky-name column styles intact — give the new cell `width: 28`.
At the end of the JSX, alongside `VendorLogDrawer`:
```tsx
      {rfqOpen && <RfqCreateModal vendors={rows.filter((v) => picked.has(v.vendor)).map((v) => ({ vendor: v.vendor, codes: v.codes }))} onClose={() => setRfqOpen(false)} />}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p . && npx eslint components/rfq-create-modal.tsx components/vendor-matrix-page.tsx`; in the browser on `/vendors`: tick 2 vendors → ขอราคา (2) → modal shows sheet defaults matching their ticks → create → links appear → copy works → `/rfq` lists them.

- [ ] **Step 4: Commit**

```bash
git add components/rfq-create-modal.tsx components/vendor-matrix-page.tsx
git commit -m "rfq: create-links modal from /vendors (pick vendors, sheets default from ticks, LINE text)"
```

---

### Task 9: End-to-end check, build, memory note

- [ ] **Step 1:** `npx tsx scripts/check-rfq-core.ts && npx tsc --noEmit -p . && npx eslint . && npx next build` — all pass.
- [ ] **Step 2:** Full browser run at 390px: /vendors → create → open `/q/<token>` → identity → labour (2 jobs) → parts (2 parts, one skip) → submit → /rfq shows ส่งแล้ว → /rfq/[id] tabs show values → return → vendor edits → resubmit → confirm (approver session) → vendor page shows ยืนยันแล้ว + validTo → Excel downloads with values. Screenshots into scratchpad.
- [ ] **Step 3:** Update memory `proj_master_sku_web.md` with a Vendor RFQ bullet (collections, routes, scripts, gotchas found).
- [ ] **Step 4:** Do NOT push — user decides.
