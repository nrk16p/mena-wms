"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Users, Save, Check } from "lucide-react"
import { SUPERADMIN_EMAIL } from "@/lib/permission-constants"

type AppUser = {
  email: string; name: string; image: string
  group_id: string | null; group_name: string | null
  last_seen: string; created_at: string
}
type Group = { id: string; name: string; access: string[]; memberCount: number }

export default function AdminUsersPage() {
  const [users, setUsers]   = useState<AppUser[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({}) // email -> group id ("" = unassigned)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/admin/groups").then((r) => r.json()),
    ])
      .then(([u, g]) => {
        setUsers(u.users ?? [])
        setGroups(g.groups ?? [])
        setDrafts({})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function save(email: string) {
    const groupId = drafts[email] ?? ""
    setSaving(email)
    try {
      const r = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, group_id: groupId || null }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      const groupName = groups.find((g) => g.id === groupId)?.name ?? null
      setUsers((prev) => prev.map((u) => u.email === email ? { ...u, group_id: groupId || null, group_name: groupName } : u))
      setDrafts((prev) => { const d = { ...prev }; delete d[email]; return d })
      setSavedAt((prev) => ({ ...prev, [email]: Date.now() }))
    } catch (e) {
      alert(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSaving(null)
    }
  }

  const sorted = [...users].sort((a, b) => {
    const aUn = a.group_id ? 1 : 0
    const bUn = b.group_id ? 1 : 0
    if (aUn !== bUn) return aUn - bUn // unassigned first
    return (b.last_seen ?? "").localeCompare(a.last_seen ?? "")
  })

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2.5 mb-1">
        <Users size={18} className="text-[#1B8C4B]" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">จัดการผู้ใช้</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        ผู้ใช้ถูกบันทึกอัตโนมัติเมื่อ login ด้วย Google — กำหนดกลุ่มสิทธิ์ได้ที่นี่ •{" "}
        <Link href="/admin/groups" className="text-[#1B8C4B] hover:underline">จัดการกลุ่มสิทธิ์</Link>
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">กำลังโหลด...</p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 dark:text-gray-600 border-b border-gray-100 dark:border-white/5">
                <th className="font-semibold px-4 py-3">ผู้ใช้</th>
                <th className="font-semibold px-4 py-3">เข้าใช้ล่าสุด</th>
                <th className="font-semibold px-4 py-3">กลุ่มสิทธิ์</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const isSuper = u.email === SUPERADMIN_EMAIL
                const draft   = drafts[u.email]
                const dirty   = draft !== undefined && draft !== (u.group_id ?? "")
                return (
                  <tr key={u.email} className="border-b border-gray-50 dark:border-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {u.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.image} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B8C4B] text-[11px] font-bold text-white">
                            {u.name?.[0]?.toUpperCase() ?? "?"}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{u.name || "-"}</p>
                          <p className="text-xs text-gray-400 truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {u.last_seen ? new Date(u.last_seen).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      {isSuper ? (
                        <span className="inline-flex rounded-md bg-[#1B8C4B] px-2 py-0.5 text-xs font-bold text-white">Superadmin</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={draft ?? u.group_id ?? ""}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [u.email]: e.target.value }))}
                            className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-2 py-1 text-xs text-gray-900 dark:text-white"
                          >
                            <option value="">— ยังไม่กำหนด (ค่าเริ่มต้น) —</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                          {!u.group_id && draft === undefined && (
                            <span className="rounded-md bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">Unassigned</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!isSuper && dirty && (
                        <button
                          onClick={() => save(u.email)}
                          disabled={saving === u.email}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#1B8C4B] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50"
                        >
                          <Save size={11} /> {saving === u.email ? "..." : "บันทึก"}
                        </button>
                      )}
                      {!dirty && savedAt[u.email] && Date.now() - savedAt[u.email] < 5000 && (
                        <span className="inline-flex items-center gap-1 text-xs text-[#1B8C4B]"><Check size={12} /> บันทึกแล้ว</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">ยังไม่มีผู้ใช้ — จะปรากฏหลังมีการ login ครั้งแรก</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
