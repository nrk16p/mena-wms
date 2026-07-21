"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, Plus, Pencil, Trash2, X, Check, Factory } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"

type Garage = { _id: string; name: string; count?: number }

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

export function GarageMasterPage() {
  const [rows, setRows]       = useState<Garage[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [newName, setNewName] = useState("")
  const [adding, setAdding]   = useState(false)
  const [editId, setEditId]   = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch("/api/garage-master?withCounts=1")
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch {
      swalError("โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const totalUsed = rows.reduce((s, r) => s + (r.count || 0), 0)

  async function add() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      const res = await fetch("/api/garage-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      setNewName("")
      swalToast("success", "เพิ่มอู่แล้ว")
      load()
    } catch {
      swalError("เพิ่มไม่สำเร็จ")
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit() {
    if (!editId || !editName.trim()) return
    try {
      const res = await fetch(`/api/garage-master/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "แก้ไขไม่สำเร็จ")
      setEditId(null)
      swalToast("success", d.cascaded ? `แก้ไขแล้ว · อัปเดต ${d.cascaded} รายการซ่อม` : "แก้ไขแล้ว")
      load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "แก้ไขไม่สำเร็จ")
    }
  }

  async function remove(r: Garage) {
    const ok = await swalDeleteConfirm(
      r.count ? `"${r.name}" ถูกใช้ใน ${r.count} รายการ — ลบออกจาก master? (รายการซ่อมเดิมยังเก็บชื่อไว้)` : `ลบอู่ "${r.name}"?`,
    )
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/garage-master/${r._id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      swalToast("success", "ลบแล้ว")
      load()
    } catch {
      swalError("ลบไม่สำเร็จ")
    }
  }

  return (
    <div className="mx-auto max-w-[820px] px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Factory size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            จัดการอู่ (Master)
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            รายชื่ออู่ที่ใช้ในระบบซ่อม · {rows.length} อู่ · ใช้งานรวม {totalUsed} รายการ
          </p>
        </div>
      </div>

      {/* Add + search */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
            placeholder="ชื่ออู่ใหม่..."
            className={inputCls}
          />
          <button onClick={add} disabled={adding || !newName.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
            <Plus size={16} /> เพิ่มอู่
          </button>
        </div>
        <div className="relative sm:w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาอู่..." className={inputCls + " pl-9"} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <div className="grid grid-cols-[1fr_120px_96px] gap-3 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-white/3 px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">
          <div>ชื่ออู่</div><div className="text-center">ใช้งาน</div><div className="text-center">จัดการ</div>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">{q ? "ไม่พบอู่ตามคำค้น" : "ยังไม่มีอู่ — เพิ่มด้านบนได้เลย"}</div>
        ) : filtered.map((r) => (
          <div key={r._id} className="grid grid-cols-[1fr_120px_96px] items-center gap-3 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-2.5 hover:bg-[#F6FAF7]/60 dark:hover:bg-white/[0.02]">
            {editId === r._id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit() } if (e.key === "Escape") setEditId(null) }}
                className="rounded-lg border border-[#1B8C4B] bg-white dark:bg-[#0f1117] px-2.5 py-1.5 text-sm focus:outline-none"
              />
            ) : (
              <span className="truncate text-sm font-medium text-[#14271C] dark:text-white" title={r.name}>{r.name}</span>
            )}
            <div className="text-center">
              {r.count ? (
                <span className="inline-flex items-center rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 px-2 py-0.5 text-xs font-medium text-[#1B8C4B]">{r.count} รายการ</span>
              ) : (
                <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
              )}
            </div>
            <div className="flex items-center justify-center gap-1">
              {editId === r._id ? (
                <>
                  <button onClick={saveEdit} title="บันทึก" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#1B8C4B] text-white hover:bg-[#0F6A3C]"><Check size={14} /></button>
                  <button onClick={() => setEditId(null)} title="ยกเลิก" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 hover:text-gray-700"><X size={14} /></button>
                </>
              ) : (
                <>
                  <button onClick={() => { setEditId(r._id); setEditName(r.name) }} title="แก้ชื่อ" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#1B8C4B]/10 hover:text-[#1B8C4B]"><Pencil size={14} /></button>
                  <button onClick={() => remove(r)} title="ลบ" className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[#F6FAF7] dark:bg-white/5 text-gray-500 transition hover:bg-[#DC2626]/10 hover:text-[#DC2626]"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
