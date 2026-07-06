"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Layers, Plus, Pencil, Trash2, X } from "lucide-react"
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@/lib/permission-constants"

type Group = { id: string; name: string; access: string[]; memberCount: number }

function GroupForm({ initial, onCancel, onSaved }: {
  initial?: Group
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName]     = useState(initial?.name ?? "")
  const [access, setAccess] = useState<string[]>(initial?.access ?? [])
  const [busy, setBusy]     = useState(false)

  function toggle(key: string) {
    setAccess((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  async function submit() {
    if (!name.trim()) { alert("ต้องระบุชื่อกลุ่ม"); return }
    setBusy(true)
    try {
      const r = await fetch("/api/admin/groups", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initial ? { id: initial.id, name, access } : { name, access }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      onSaved()
    } catch (e) {
      alert(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[#1B8C4B]/40 bg-[#f0fdf4]/50 dark:bg-[#1B8C4B]/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900 dark:text-white">{initial ? `แก้ไขกลุ่ม: ${initial.name}` : "สร้างกลุ่มใหม่"}</p>
        <button onClick={onCancel} className="text-gray-400 hover:text-red-500"><X size={15} /></button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="ชื่อกลุ่ม เช่น ทีมจัดซื้อ"
        className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-1.5 text-sm text-gray-900 dark:text-white"
      />
      <div className="flex flex-wrap gap-2">
        {SECTION_KEYS.map((key: SectionKey) => (
          <label
            key={key}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              access.includes(key)
                ? "border-[#1B8C4B] bg-[#1B8C4B] text-white"
                : "border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] text-gray-600 dark:text-gray-400 hover:border-[#1B8C4B]/50"
            }`}
          >
            <input type="checkbox" className="hidden" checked={access.includes(key)} onChange={() => toggle(key)} />
            {SECTION_LABELS[key]}
          </label>
        ))}
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-[#1B8C4B] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50"
      >
        {busy ? "กำลังบันทึก..." : "บันทึกกลุ่ม"}
      </button>
    </div>
  )
}

export default function AdminGroupsPage() {
  const [groups, setGroups]   = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<Group | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/admin/groups")
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(g: Group) {
    if (!confirm(`ลบกลุ่ม "${g.name}" ?`)) return
    const r = await fetch("/api/admin/groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: g.id }),
    })
    if (!r.ok) { alert((await r.json()).error); return }
    load()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2.5 mb-1">
        <Layers size={18} className="text-[#1B8C4B]" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">กลุ่มสิทธิ์</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        กำหนดว่าแต่ละกลุ่มเห็นเมนูส่วนไหนได้บ้าง — ผู้ใช้ที่ยังไม่กำหนดกลุ่มจะเห็นทุกส่วนยกเว้นรายงาน ATMS •{" "}
        <Link href="/admin/users" className="text-[#1B8C4B] hover:underline">จัดการผู้ใช้</Link>
      </p>

      <div className="mb-5">
        {creating ? (
          <GroupForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />
        ) : (
          <button
            onClick={() => { setCreating(true); setEditing(null) }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"
          >
            <Plus size={14} /> สร้างกลุ่มใหม่
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">กำลังโหลด...</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) =>
            editing?.id === g.id ? (
              <GroupForm key={g.id} initial={g} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
            ) : (
              <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-white text-sm">
                    {g.name}
                    <span className="ml-2 text-xs font-normal text-gray-400">{g.memberCount} คน</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.access.length === 0 && <span className="text-xs text-gray-400">— ไม่มีสิทธิ์ (เห็นเฉพาะหน้าหลัก) —</span>}
                    {g.access.map((k) => (
                      <span key={k} className="rounded-md bg-[#f0fdf4] dark:bg-[#1B8C4B]/10 px-2 py-0.5 text-[11px] font-medium text-[#0F6A3C] dark:text-[#1B8C4B]">
                        {SECTION_LABELS[k as SectionKey] ?? k}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => { setEditing(g); setCreating(false) }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(g)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )}
          {groups.length === 0 && !creating && (
            <p className="text-sm text-gray-400">ยังไม่มีกลุ่ม — สร้างกลุ่มแรกได้เลย</p>
          )}
        </div>
      )}
    </div>
  )
}
