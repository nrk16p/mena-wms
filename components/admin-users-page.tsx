"use client"

// หน้า superadmin /admin/users — ผู้ใช้และสิทธิ์
// (spec: docs/superpowers/specs/2026-10-07-department-access-design.md)
//   • สิทธิ์ตั้งต้นมาจากแผนก HR (lib/access-policy.ts) · ตั้งทับรายคนรายส่วนงานได้
//   • override เก็บเฉพาะค่าที่ต่างจากแผนก (API ตัดค่าที่เท่ากันทิ้ง) · มีผลกับผู้ใช้ภายใน 5 นาที
//   • ผู้ใช้โผล่ในรายชื่อหลังเข้า WMS ครั้งแรก (jwt callback บันทึก wms_users)
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Ban, Eye, History, Info, Pencil, RefreshCw, Save, Search, ShieldCheck, Users, X,
} from "lucide-react"
import {
  SECTIONS, SECTION_LABELS, LEVEL_LABELS, accessFor, type Level, type Overrides, type Section,
} from "@/lib/access-policy"
import {
  describeChange, diffOverrides, siteLabel, type AccessLogEntry, type AdminUserRow,
} from "@/lib/access-admin"
import { swalError, swalToast } from "@/lib/swal"
import { UserAvatar } from "@/components/user-avatar"

// ป้ายย่อหัวคอลัมน์ในตาราง (ชื่อเต็มอยู่ใน tooltip)
const SHORT: Record<Section, string> = {
  sku: "SKU", pr: "PR", ap: "AP", "price-compare": "เทียบราคา", vendor: "Vendor", "safety-stock": "SS",
  deadstock: "ค้างคลัง", tire: "ยาง", repair: "อู่นอก", "driver-handover": "ส่งมอบ", "ai-mixer": "AI",
}

const LEVEL_STYLE: Record<Level, { fg: string; bg: string }> = {
  edit: { fg: "#1B8C4B", bg: "#EAF6EE" },
  view: { fg: "#1D4ED8", bg: "#EFF6FF" },
  none: { fg: "#B8C4BC", bg: "transparent" },
}

const NO_DEPT = "__none__"

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

/** วันเวลาแบบสั้น (เวลาไทย) */
function fmtAt(at: string | Date | null | undefined): string {
  if (!at) return "—"
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function LevelIcon({ level, size = 13 }: { level: Level; size?: number }) {
  if (level === "edit") return <Pencil size={size} />
  if (level === "view") return <Eye size={size} />
  return <span style={{ fontSize: size, lineHeight: 1 }}>—</span>
}

/** ช่องสิทธิ์ 1 ส่วนงาน — ตั้งทับ = กรอบส้ม + จุด */
function LevelCell({ level, overridden, section, deptLevel }: { level: Level; overridden: boolean; section: Section; deptLevel: Level }) {
  const s = LEVEL_STYLE[level]
  const title = `${SECTION_LABELS[section]}: ${LEVEL_LABELS[level]}` +
    (overridden ? ` · ตั้งทับ (ตามแผนก = ${LEVEL_LABELS[deptLevel]})` : "")
  return (
    <span
      title={title}
      className="relative inline-flex h-[24px] w-[24px] items-center justify-center rounded-md"
      style={{ color: s.fg, background: s.bg, boxShadow: overridden ? "inset 0 0 0 1.5px #D97706" : undefined }}
    >
      <LevelIcon level={level} />
      {overridden && <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full bg-[#D97706]" />}
    </span>
  )
}

function RoleBadge({ u }: { u: Pick<AdminUserRow, "isAdmin" | "isSuperAdmin"> }) {
  if (u.isSuperAdmin) {
    return <span className="rounded-full bg-[#1B8C4B] px-2 py-0.5 text-[10.5px] font-bold text-white">superadmin</span>
  }
  if (u.isAdmin) {
    return <span className="rounded-full bg-[#EAF6EE] px-2 py-0.5 text-[10.5px] font-bold text-[#1B8C4B] ring-1 ring-[#A7D9B8]">แอดมิน</span>
  }
  return null
}

export function AdminUsersPage() {
  const [tab, setTab] = useState<"users" | "log">("users")
  const [users, setUsers] = useState<AdminUserRow[] | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [q, setQ] = useState("")
  const [dept, setDept] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [log, setLog] = useState<AccessLogEntry[] | null>(null)
  const [logError, setLogError] = useState("")

  // promise chain ตาม lint rule ของ repo (react-hooks/set-state-in-effect) — setState หลัง await เท่านั้น
  const loadUsers = useCallback(() => {
    return fetch("/api/admin/users")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d?.error ?? "โหลดรายชื่อผู้ใช้ไม่สำเร็จ")
        return (d.users ?? []) as AdminUserRow[]
      })
      .then((rows) => { setUsers(rows); setError("") })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRefreshing(false))
  }, [])

  const loadLog = useCallback(() => {
    return fetch("/api/admin/access-log?limit=200")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d?.error ?? "โหลดประวัติไม่สำเร็จ")
        return (d.entries ?? []) as AccessLogEntry[]
      })
      .then((rows) => { setLog(rows); setLogError("") })
      .catch((e) => setLogError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const refresh = () => {
    setRefreshing(true)
    loadUsers()
    if (log !== null) loadLog()
  }

  const openLogTab = () => {
    setTab("log")
    if (log === null) loadLog()
  }

  const nameOf = useMemo(() => {
    const m = new Map((users ?? []).map((u) => [u.email.toLowerCase(), u.name || u.email]))
    return (email: string) => m.get(email.toLowerCase()) ?? email
  }, [users])

  const departments = useMemo(() => {
    const set = new Set<string>()
    let hasNone = false
    for (const u of users ?? []) {
      const d = (u.department ?? "").trim()
      if (d) set.add(d); else hasNone = true
    }
    return { list: [...set].sort((a, b) => a.localeCompare(b, "th")), hasNone }
  }, [users])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (users ?? []).filter((u) => {
      const d = (u.department ?? "").trim()
      if (dept === NO_DEPT ? d !== "" : dept && d !== dept) return false
      if (!needle) return true
      return [u.name, u.email, u.department, u.position].some((v) => (v ?? "").toLowerCase().includes(needle))
    })
  }, [users, q, dept])

  const overrideCount = useMemo(
    () => (users ?? []).filter((u) => Object.keys(u.overrides).length > 0).length,
    [users],
  )

  const selectedUser = users?.find((u) => u.email === selected) ?? null

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <ShieldCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            ผู้ใช้และสิทธิ์
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            สิทธิ์มาจากแผนกใน HR อัตโนมัติ — ตั้งทับรายคนได้ · มีผลภายใน 5 นาที
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:border-[#1B8C4B] hover:text-[#1B8C4B] disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> รีเฟรช
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-[#EEF2F0] dark:border-white/8">
        {([
          ["users", "ผู้ใช้", Users, users ? `${users.length}` : ""],
          ["log", "ประวัติการเปลี่ยนสิทธิ์", History, ""],
        ] as const).map(([key, label, Icon, badge]) => (
          <button
            key={key}
            onClick={() => (key === "log" ? openLogTab() : setTab("users"))}
            className={
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition " +
              (tab === key
                ? "border-[#1B8C4B] text-[#1B8C4B]"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200")
            }
          >
            <Icon size={15} /> {label}
            {badge && <span className="rounded-full bg-[#F1F5F2] dark:bg-white/10 px-1.5 text-[11px] text-gray-500">{badge}</span>}
          </button>
        ))}
      </div>

      {tab === "users" ? (
        <>
          <Legend overrideCount={overrideCount} />

          {/* ค้นหา + กรองแผนก */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / อีเมล / แผนก..." className={inputCls + " pl-9"} />
            </div>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className={inputCls + " sm:w-[260px]"}>
              <option value="">ทุกแผนก</option>
              {departments.list.map((d) => <option key={d} value={d}>{d}</option>)}
              {departments.hasNone && <option value={NO_DEPT}>(ไม่มีข้อมูลแผนก)</option>}
            </select>
          </div>

          <UsersTable users={users} filtered={filtered} error={error} onPick={setSelected} />
        </>
      ) : (
        <LogList log={log} error={logError} nameOf={nameOf} />
      )}

      {selectedUser && (
        <AccessDrawer
          key={selectedUser.email}
          user={selectedUser}
          onClose={() => setSelected(null)}
          onSaved={(row) => {
            setUsers((prev) => prev?.map((u) => (u.email === row.email ? row : u)) ?? prev)
            setSelected(null)
            loadUsers()
            if (log !== null) loadLog()
          }}
        />
      )}
    </div>
  )
}

function Legend({ overrideCount }: { overrideCount: number }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-white/3 px-3.5 py-2.5 text-xs text-gray-600 dark:text-gray-300">
      {(["edit", "view", "none"] as Level[]).map((lv) => (
        <span key={lv} className="inline-flex items-center gap-1.5">
          <LevelCell level={lv} overridden={false} section="sku" deptLevel={lv} />
          <b className="font-semibold">{LEVEL_LABELS[lv]}</b>
          <span className="text-gray-400">
            {lv === "edit" ? "เปิดหน้า + บันทึก/แก้ไขได้" : lv === "view" ? "เปิดดูได้ บันทึกไม่ได้" : "ซ่อนเมนู + เปิดหน้าไม่ได้"}
          </span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <LevelCell level="view" overridden section="sku" deptLevel="edit" />
        <b className="font-semibold">ตั้งทับ</b>
        <span className="text-gray-400">ต่างจากสิทธิ์ตามแผนก ({overrideCount} คน)</span>
      </span>
      <span className="inline-flex basis-full items-center gap-1.5 text-gray-400">
        <Info size={13} /> ผู้ใช้จะขึ้นในรายชื่อหลังเข้า WMS ครั้งแรกหลังเปิดใช้ระบบสิทธิ์นี้ · แผนก/สาขา/ตำแหน่งอัปเดตจาก HR ทุกครั้งที่ใช้งาน
      </span>
    </div>
  )
}

function UsersTable({
  users, filtered, error, onPick,
}: {
  users: AdminUserRow[] | null
  filtered: AdminUserRow[]
  error: string
  onPick: (email: string) => void
}) {
  const th = "px-2.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0] whitespace-nowrap"
  return (
    <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
      <table className="w-full border-collapse text-sm">
        <thead className="border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-white/3">
          <tr>
            <th className={th + " pl-4"}>ชื่อ</th>
            <th className={th}>อีเมล</th>
            <th className={th}>แผนก</th>
            <th className={th}>สาขา</th>
            <th className={th}>ตำแหน่ง</th>
            <th className={th}>ใช้ล่าสุด</th>
            {SECTIONS.map((s) => (
              <th key={s} title={SECTION_LABELS[s]} className={th + " px-0.5 text-center normal-case"}>{SHORT[s]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {error ? (
            <tr><td colSpan={6 + SECTIONS.length} className="px-4 py-12 text-center text-sm text-[#B91C1C]">{error}</td></tr>
          ) : users === null ? (
            <tr><td colSpan={6 + SECTIONS.length} className="px-4 py-12 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
          ) : filtered.length === 0 ? (
            <tr><td colSpan={6 + SECTIONS.length} className="px-4 py-12 text-center text-sm text-gray-400">
              {users.length === 0 ? "ยังไม่มีผู้ใช้ — รายชื่อจะขึ้นหลังผู้ใช้เข้า WMS ครั้งแรก" : "ไม่พบผู้ใช้ตามเงื่อนไข"}
            </td></tr>
          ) : filtered.map((u) => (
            <tr
              key={u.email}
              onClick={() => onPick(u.email)}
              className="cursor-pointer border-b border-[#F1F5F2] dark:border-white/5 hover:bg-[#F6FAF7]/80 dark:hover:bg-white/[0.03]"
            >
              <td className="py-2 pl-4 pr-2.5">
                <div className="flex items-center gap-2">
                  <UserAvatar src={u.image} name={u.name} size={26} />
                  <span className="max-w-[200px] truncate font-medium text-[#14271C] dark:text-white" title={u.name ?? ""}>{u.name || "—"}</span>
                  <RoleBadge u={u} />
                </div>
              </td>
              <td className="px-2.5 py-2 text-xs text-gray-500 dark:text-gray-400">{u.email}</td>
              <td className="px-2.5 py-2 text-xs text-gray-700 dark:text-gray-300">{u.department || <span className="text-gray-300">ไม่มีข้อมูล (ทั่วไป)</span>}</td>
              <td className="px-2.5 py-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{siteLabel(u.siteId)}</td>
              <td className="max-w-[180px] truncate px-2.5 py-2 text-xs text-gray-600 dark:text-gray-400" title={u.position ?? ""}>{u.position || "—"}</td>
              <td className="px-2.5 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtAt(u.lastSeenAt)}</td>
              {SECTIONS.map((s) => (
                <td key={s} className="px-0.5 py-2 text-center">
                  <LevelCell level={u.effective[s]} overridden={s in u.overrides && !u.isAdmin} section={s} deptLevel={u.departmentAccess[s]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CHOICES: { value: "" | Level; label: string }[] = [
  { value: "", label: "ตามแผนก" },
  { value: "none", label: LEVEL_LABELS.none },
  { value: "view", label: LEVEL_LABELS.view },
  { value: "edit", label: LEVEL_LABELS.edit },
]

function AccessDrawer({
  user, onClose, onSaved,
}: {
  user: AdminUserRow
  onClose: () => void
  onSaved: (row: AdminUserRow) => void
}) {
  const [draft, setDraft] = useState<Overrides>(user.overrides)
  const [saving, setSaving] = useState(false)
  const readOnly = user.isAdmin || user.isSuperAdmin || Boolean(user.lockedReason)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [onClose])

  // ตัวอย่างสิทธิ์ที่จะได้จริงหลังบันทึก
  const preview = accessFor({ department: user.department, email: user.email, overrides: draft })
  const dirty = diffOverrides(user.overrides, draft).length > 0

  const setLevel = (s: Section, v: "" | Level) => {
    setDraft((d) => {
      const next = { ...d }
      // เลือกค่าเดียวกับแผนก = ตามแผนก (เก็บเฉพาะข้อยกเว้นจริง เหมือนฝั่ง API)
      if (v === "" || v === user.departmentAccess[s]) delete next[s]
      else next[s] = v
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: draft }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? "บันทึกสิทธิ์ไม่สำเร็จ")
      swalToast("success", d.changed ? "บันทึกสิทธิ์แล้ว — มีผลภายใน 5 นาที" : "ไม่มีการเปลี่ยนแปลง")
      onSaved(d.user as AdminUserRow)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกสิทธิ์ไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[60] bg-[rgba(17,24,39,.35)]" />
      <aside
        className="fixed bottom-0 right-0 top-0 z-[61] flex w-[min(520px,100vw)] flex-col bg-white dark:bg-[#0f1117] shadow-[-8px_0_28px_rgba(0,0,0,.12)]"
        style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
      >
        <header className="flex items-start gap-3 border-b border-[#E5E7EB] dark:border-white/10 px-4 py-3.5">
          <UserAvatar src={user.image} name={user.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold text-[#111827] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>{user.name || user.email}</span>
              <RoleBadge u={user} />
            </div>
            <div className="text-xs text-gray-500 break-all">{user.email}</div>
            <div className="mt-0.5 text-xs text-gray-500">
              {user.department || "ไม่มีข้อมูลแผนก (ใช้สิทธิ์ทั่วไป)"} · {siteLabel(user.siteId)}{user.position ? ` · ${user.position}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="rounded p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-4 py-3">
          {readOnly && (
            <div className="mb-3 flex items-start gap-2 rounded-[10px] bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 px-3 py-2 text-xs text-[#14532D] dark:text-[#86EFAC]">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              {user.isSuperAdmin || user.isAdmin
                ? <>{user.isSuperAdmin ? "superadmin" : "แอดมินระบบ"} ได้สิทธิ์ &quot;แก้ได้&quot; ทุกส่วนงานเสมอ — ตั้งทับไม่ได้ (กำหนดในโค้ด lib/roles.ts)</>
                : user.lockedReason}
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 text-sm">
            <div className="pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">ส่วนงาน</div>
            <div className="pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">ตามแผนก</div>
            <div className="pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">ตั้งเป็น</div>
            {SECTIONS.map((s) => {
              const cur = draft[s] ?? ""
              const overridden = cur !== ""
              return (
                <div key={s} className="contents">
                  <div className="flex min-w-0 items-center gap-2 border-t border-[#F1F5F2] dark:border-white/5 py-1.5">
                    <LevelCell level={preview[s]} overridden={overridden && !readOnly} section={s} deptLevel={user.departmentAccess[s]} />
                    <span className="truncate text-[13px] text-[#14271C] dark:text-gray-200" title={SECTION_LABELS[s]}>{SECTION_LABELS[s]}</span>
                  </div>
                  <div className="border-t border-[#F1F5F2] dark:border-white/5 py-1.5 text-xs whitespace-nowrap" style={{ color: user.departmentAccess[s] === "none" ? "#9CA3AF" : LEVEL_STYLE[user.departmentAccess[s]].fg }}>
                    {LEVEL_LABELS[user.departmentAccess[s]]}
                  </div>
                  <div className="border-t border-[#F1F5F2] dark:border-white/5 py-1.5">
                    <select
                      value={readOnly ? "" : cur}
                      disabled={readOnly || saving}
                      onChange={(e) => setLevel(s, e.target.value as "" | Level)}
                      className={
                        "rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] disabled:opacity-60 dark:bg-[#0f1117] " +
                        (overridden && !readOnly
                          ? "border-[#D97706] bg-[#FFFBEB] font-semibold text-[#92400E]"
                          : "border-[#E2E8E4] bg-white text-gray-700 dark:border-white/10 dark:text-gray-200")
                      }
                    >
                      {CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>

          {!readOnly && (
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gray-400">
              <Ban size={12} className="mt-0.5 shrink-0" />
              เลือกค่าเดียวกับแผนก = ตามแผนก (ระบบเก็บเฉพาะข้อยกเว้น) · ถ้าย้ายแผนกใน HR สิทธิ์ตามแผนกจะเปลี่ยนตาม แต่ค่าที่ตั้งทับยังอยู่
            </p>
          )}
        </div>

        {!readOnly && (
          <footer className="flex items-center gap-2 border-t border-[#E5E7EB] dark:border-white/10 px-4 py-3">
            <button
              onClick={() => setDraft({})}
              disabled={saving || Object.keys(draft).length === 0}
              className="rounded-[11px] px-3 py-2 text-xs font-semibold text-gray-500 hover:text-[#B91C1C] disabled:opacity-40"
            >
              คืนค่าตามแผนกทั้งหมด
            </button>
            <div className="flex-1" />
            <button onClick={onClose} disabled={saving} className="rounded-[11px] border border-[#E2E8E4] dark:border-white/10 px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              ยกเลิก
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50"
            >
              <Save size={15} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </footer>
        )}
      </aside>
    </>
  )
}

function LogList({
  log, error, nameOf,
}: {
  log: AccessLogEntry[] | null
  error: string
  nameOf: (email: string) => string
}) {
  if (error) return <p className="py-10 text-center text-sm text-[#B91C1C]">{error}</p>
  if (log === null) return <p className="py-10 text-center text-sm text-gray-400">กำลังโหลด...</p>
  if (log.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีการเปลี่ยนสิทธิ์</p>
  }
  return (
    <div className="overflow-hidden rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
      {log.map((e, i) => {
        const changes = diffOverrides(e.before, e.after)
        return (
          <div key={i} className="flex gap-3 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-3 last:border-b-0">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1B8C4B]" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-[#14271C] dark:text-gray-200">
                <b className="font-semibold">{nameOf(e.by)}</b>
                <span className="text-gray-500"> เปลี่ยนสิทธิ์ของ </span>
                <b className="font-semibold">{nameOf(e.target)}</b>
                <span className="ml-1 text-xs text-gray-400">({e.target})</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {changes.length === 0
                  ? <li className="text-xs text-gray-400">ไม่มีการเปลี่ยนแปลง</li>
                  : changes.map((c) => (
                    <li key={c.section} className="text-xs text-gray-600 dark:text-gray-400">• {describeChange(c)}</li>
                  ))}
              </ul>
              <div className="mt-1 text-[11px] text-gray-400">{fmtAt(e.at)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
