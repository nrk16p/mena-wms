// lib/access-admin.ts — ตรรกะล้วนของหน้า superadmin /admin/users
// (spec: docs/superpowers/specs/2026-10-07-department-access-design.md)
//
// ไม่แตะ DB/React — ใช้ร่วมกันทั้ง API (app/api/admin/*) และหน้าเว็บ (components/admin-users-page.tsx)
// ตรวจด้วย scripts/check-access-admin.ts
//   • override เก็บเฉพาะ "ข้อยกเว้นจริง" — ค่าที่เท่ากับสิทธิ์ตามแผนกตัดทิ้ง ว่างทั้งหมด = ลบเอกสาร
//   • superadmin / admin ได้ "แก้ได้" ทุกส่วนเสมอ → ตั้งทับไม่ได้ (กันเข้าใจผิดว่าตั้งแล้วมีผล)
import {
  SECTIONS, SECTION_LABELS, LEVEL_LABELS, accessFor, departmentAccess,
  type Access, type Level, type Overrides, type Section,
} from "./access-policy"
import { isAdmin, isSuperAdmin } from "./roles"
import { SITES } from "./dept-access"

const isLevel = (v: unknown): v is Level => v === "none" || v === "view" || v === "edit"
const isSection = (k: string): k is Section => (SECTIONS as readonly string[]).includes(k)

/** override ที่อ่านจาก DB — กรองค่าขยะทิ้ง เรียง key ตาม SECTIONS */
export function cleanOverrides(raw: unknown): Overrides {
  const out: Overrides = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  for (const s of SECTIONS) {
    if (Object.prototype.hasOwnProperty.call(r, s) && isLevel(r[s])) out[s] = r[s] as Level
  }
  return out
}

export type NormalizeResult = { ok: true; overrides: Overrides } | { ok: false; error: string }

/**
 * ตรวจ body จากหน้าเว็บ → override ที่จะเก็บจริง
 * null / "" / undefined = "ตามแผนก" (ไม่เก็บ) · ค่าที่เท่ากับสิทธิ์ตามแผนกก็ไม่เก็บ
 */
export function normalizeOverrides(input: unknown, department: string | null | undefined): NormalizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "overrides ต้องเป็น object {ส่วนงาน: ระดับ}" }
  }
  const r = input as Record<string, unknown>
  for (const k of Object.keys(r)) {
    if (!isSection(k)) return { ok: false, error: `ไม่รู้จักส่วนงาน "${k}"` }
    const v = r[k]
    if (v === null || v === undefined || v === "") continue
    if (!isLevel(v)) return { ok: false, error: `ระดับสิทธิ์ของ "${k}" ไม่ถูกต้อง (ต้องเป็น none / view / edit)` }
  }
  const dept = departmentAccess(department)
  const out: Overrides = {}
  for (const s of SECTIONS) {
    const v = r[s]
    if (isLevel(v) && v !== dept[s]) out[s] = v
  }
  return { ok: true, overrides: out }
}

export type OverrideChange = { section: Section; from: Level | null; to: Level | null }

/** เปลี่ยนอะไรบ้าง (null = ตามแผนก) — เรียงตาม SECTIONS */
export function diffOverrides(before: unknown, after: unknown): OverrideChange[] {
  const b = cleanOverrides(before)
  const a = cleanOverrides(after)
  const out: OverrideChange[] = []
  for (const s of SECTIONS) {
    const from = b[s] ?? null
    const to = a[s] ?? null
    if (from !== to) out.push({ section: s, from, to })
  }
  return out
}

const lvText = (lv: Level | null) => (lv ? LEVEL_LABELS[lv] : "ตามแผนก")

/** "เจ้าหนี้ (AP): ตามแผนก → แก้ได้" */
export function describeChange(c: OverrideChange): string {
  return `${SECTION_LABELS[c.section]}: ${lvText(c.from)} → ${lvText(c.to)}`
}

// ── แถวผู้ใช้ในหน้า /admin/users ─────────────────────────────────────────────

export type WmsUser = {
  email: string
  name?: string | null
  image?: string | null
  department?: string | null
  siteId?: number | null
  position?: string | null
  employeeId?: string | null
  firstSeenAt?: string | Date | null
  lastSeenAt?: string | Date | null
}

export type AdminUserRow = WmsUser & {
  /** override ที่ตั้งไว้ (เฉพาะค่าที่ใช้ได้) */
  overrides: Overrides
  /** สิทธิ์ตามแผนกอย่างเดียว */
  departmentAccess: Access
  /** สิทธิ์ที่ได้จริง (แผนก + override + admin) */
  effective: Access
  isAdmin: boolean
  isSuperAdmin: boolean
}

export function buildUserRow(u: WmsUser, rawOverrides: unknown): AdminUserRow {
  const overrides = cleanOverrides(rawOverrides)
  return {
    ...u,
    overrides,
    departmentAccess: departmentAccess(u.department),
    effective: accessFor({ department: u.department, email: u.email, overrides }),
    isAdmin: isAdmin(u.email) || isSuperAdmin(u.email),
    isSuperAdmin: isSuperAdmin(u.email),
  }
}

/** เรียงตามแผนก แล้วชื่อ (ภาษาไทย) · ไม่มีแผนกไว้ท้ายสุด */
export function sortUsers<T extends { email: string; name?: string | null; department?: string | null }>(users: T[]): T[] {
  const key = (s: string | null | undefined) => (s ?? "").trim()
  return [...users].sort((a, b) => {
    const da = key(a.department), db = key(b.department)
    if (!da !== !db) return da ? -1 : 1
    return da.localeCompare(db, "th")
      || key(a.name).localeCompare(key(b.name), "th")
      || a.email.localeCompare(b.email)
  })
}

/** เหตุผลที่ตั้งทับผู้ใช้นี้ไม่ได้ (null = ตั้งได้) */
export function overrideBlockedReason(email: string | null | undefined): string | null {
  const e = (email ?? "").toLowerCase()
  if (isSuperAdmin(e)) return "superadmin ได้สิทธิ์แก้ได้ทุกส่วนเสมอ — ตั้งทับไม่ได้"
  if (isAdmin(e)) return "แอดมินระบบได้สิทธิ์แก้ได้ทุกส่วนเสมอ — ตั้งทับไม่มีผล"
  return null
}

/** ?limit= ของประวัติ — ค่าเริ่ม 200, จำกัด 1..1000 */
export function parseLogLimit(v: string | null | undefined): number {
  const n = Number(v ?? 200)
  if (v == null || v === "" || !Number.isFinite(n)) return 200
  return Math.min(Math.max(Math.trunc(n), 1), 1000)
}

const SITE_CODE = new Map(SITES.map((s) => [s.id, s.code]))

/** site_id HR → รหัสสาขา เช่น 2 → "ศลบ." */
export function siteLabel(siteId: number | null | undefined): string {
  return siteId == null ? "—" : SITE_CODE.get(Number(siteId)) ?? "—"
}

export type AccessLogEntry = {
  at: string | Date
  by: string
  target: string
  before: Overrides
  after: Overrides
}
