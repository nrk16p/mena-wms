"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Plus, Pencil, Trash2, Check, X, ChevronLeft, Search, Lock } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"

type CodeEntry = {
  _id:    string
  dict:   string
  code:   string
  th:     string
  en:     string
  parent: string | null
  order:  number
  meta:   Record<string, unknown>
}

const DICT_LABEL: Record<string, string> = {
  WAREHOUSE: "คลังสินค้า", EXPENSE_TYPE: "ประเภทค่าใช้จ่าย",
  SYSTEM_L1: "ระบบ L1", SUB_ASSEMBLY_L2: "ชุดประกอบ L2",
  COMPONENT_L3: "ชิ้นส่วน L3", POSITION: "ตำแหน่ง",
  UNIT: "หน่วย", GRADE: "Grade", VEHICLE_TYPE: "รุ่น/ประเภทรถ",
  BRAND: "ยี่ห้อ",
}

const HAS_PARENT: Record<string, boolean> = {
  SUB_ASSEMBLY_L2: true, COMPONENT_L3: true,
}

const PARENT_LABEL: Record<string, string> = {
  SUB_ASSEMBLY_L2: "L1 Code (เช่น ENG)",
  COMPONENT_L3:    "L1:L2 Code (เช่น ENG:OIL)",
}

export default function DictPage() {
  const { dict } = useParams<{ dict: string }>()
  const { data: session } = useSession()
  const canAdmin = session?.user?.role === "admin"

  const [items, setItems]           = useState<CodeEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [filterParent, setFilterParent] = useState("")
  const [search, setSearch]         = useState("")
  const [editId, setEditId]         = useState<string | null>(null)
  const [editTh, setEditTh]         = useState("")
  const [editEn, setEditEn]         = useState("")
  const [editMeta, setEditMeta]     = useState("")
  const [saving, setSaving]         = useState(false)

  // Add form
  const [showAdd, setShowAdd]       = useState(false)
  const [addCode, setAddCode]       = useState("")
  const [addTh, setAddTh]           = useState("")
  const [addEn, setAddEn]           = useState("")
  const [addParent, setAddParent]   = useState("")
  const [addMeta, setAddMeta]       = useState("")
  const [addError, setAddError]     = useState("")
  const [adding, setAdding]         = useState(false)

  const hasParent = HAS_PARENT[dict] ?? false

  const load = useCallback(async () => {
    setLoading(true)
    const qs = filterParent ? `?parent=${encodeURIComponent(filterParent)}` : ""
    const res = await fetch(`/api/codes/${dict}${qs}`)
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [dict, filterParent])

  useEffect(() => { load() }, [load])

  const filtered = search
    ? items.filter((i) =>
        i.code.toLowerCase().includes(search.toLowerCase()) ||
        i.th.includes(search) ||
        (i.en ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : items

  function startEdit(item: CodeEntry) {
    setEditId(item._id)
    setEditTh(item.th)
    setEditEn(item.en ?? "")
    setEditMeta(Object.keys(item.meta ?? {}).length ? JSON.stringify(item.meta, null, 2) : "")
  }

  function cancelEdit() { setEditId(null) }

  async function saveEdit(item: CodeEntry) {
    setSaving(true)
    let meta: Record<string, unknown> = {}
    try { if (editMeta.trim()) meta = JSON.parse(editMeta) } catch {}

    const codeKey = item._id.slice(dict.length + 1)
    const res = await fetch(`/api/codes/${dict}/${encodeURIComponent(codeKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ th: editTh, en: editEn, meta }),
    })
    setSaving(false)
    if (!res.ok) { swalError("บันทึกไม่สำเร็จ"); return }
    setEditId(null)
    swalToast("success", "บันทึกสำเร็จ")
    load()
  }

  async function handleDelete(item: CodeEntry) {
    const result = await swalDeleteConfirm(
      `ลบ code "${item.code}" (${item.th})?\n\nหากเป็น L1 จะลบ L2/L3 ที่เกี่ยวข้องทั้งหมดด้วย`
    )
    if (!result.isConfirmed) return
    const codeKey = item._id.slice(dict.length + 1)
    await fetch(`/api/codes/${dict}/${encodeURIComponent(codeKey)}`, { method: "DELETE" })
    swalToast("success", "ลบ code สำเร็จ")
    load()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError("")
    setAdding(true)

    let meta: Record<string, unknown> = {}
    try { if (addMeta.trim()) meta = JSON.parse(addMeta) } catch { setAddError("Meta ต้องเป็น JSON"); setAdding(false); return }

    const body: Record<string, unknown> = { code: addCode.toUpperCase(), th: addTh, en: addEn, meta }
    if (hasParent && addParent) body.parent = addParent

    const res = await fetch(`/api/codes/${dict}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    setAdding(false)
    if (!res.ok) {
      const d = await res.json()
      const msg = d.error ?? "เกิดข้อผิดพลาด"
      setAddError(msg)
      swalError(msg)
      return
    }

    setAddCode(""); setAddTh(""); setAddEn(""); setAddParent(""); setAddMeta("")
    setShowAdd(false)
    swalToast("success", "เพิ่ม code สำเร็จ")
    load()
  }

  const inputCls  = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"

  const hasMeta = ["EXPENSE_TYPE", "VEHICLE_TYPE", "BRAND"].includes(dict)
  // Code · TH · EN are always shown; the rest are conditional
  const colCount = 3 + (hasParent ? 1 : 0) + (hasMeta ? 1 : 0) + (canAdmin ? 1 : 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Link href="/codes" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {DICT_LABEL[dict] ?? dict}
        </h1>
        <span className="text-sm text-gray-400 dark:text-gray-600">({filtered.length} รายการ)</span>
      </div>
      <p className="text-xs font-mono text-gray-400 dark:text-gray-600 mb-5 ml-6">Collection: master_codes → dict: {dict}</p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา code / ชื่อ..." className={inputCls + " pl-8"} />
        </div>

        {hasParent && (
          <input
            value={filterParent}
            onChange={(e) => setFilterParent(e.target.value)}
            placeholder={PARENT_LABEL[dict] ?? "filter by parent"}
            className={inputCls + " max-w-[180px]"}
          />
        )}

        {canAdmin ? (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3.5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            เพิ่ม code ใหม่
          </button>
        ) : (
          <span className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500">
            <Lock size={12} />
            อ่านอย่างเดียว — แก้ไขได้เฉพาะ admin
          </span>
        )}
      </div>

      {/* Add form */}
      {canAdmin && showAdd && (
        <form onSubmit={handleAdd} className="mb-4 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-3">เพิ่ม code ใหม่ใน {DICT_LABEL[dict] ?? dict}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Code *</label>
              <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="ACS" className={inputCls} required />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">ชื่อ TH *</label>
              <input value={addTh} onChange={(e) => setAddTh(e.target.value)} placeholder="ระบบแอร์รถ" className={inputCls} required />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">ชื่อ EN</label>
              <input value={addEn} onChange={(e) => setAddEn(e.target.value)} placeholder="Air Conditioning" className={inputCls} />
            </div>
            {hasParent && (
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">{PARENT_LABEL[dict]}</label>
                <input value={addParent} onChange={(e) => setAddParent(e.target.value)} placeholder={dict === "SUB_ASSEMBLY_L2" ? "ENG" : "ENG:OIL"} className={inputCls} />
              </div>
            )}
            {hasMeta && (
              <div className="col-span-2 sm:col-span-4">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {dict === "BRAND" ? 'หมวดหมู่ (Meta JSON) — เช่น {"category":"filter"}' : 'Meta (JSON) — เช่น color สำหรับ EXPENSE_TYPE'}
                </label>
                <input value={addMeta} onChange={(e) => setAddMeta(e.target.value)} placeholder={dict === "BRAND" ? '{"category":"chassis"}' : '{"color":"#DEEAF1"}'} className={inputCls} />
              </div>
            )}
          </div>
          {addError && <p className="mt-2 text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2 mt-3">
            <button type="submit" disabled={adding} className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {adding ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setAddError("") }} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Code</th>
                {hasParent && <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Parent</th>}
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ชื่อ TH</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ชื่อ EN</th>
                {hasMeta && <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">{dict === "BRAND" ? "หมวดหมู่" : "Meta"}</th>}
                {canAdmin && <th className="px-3 py-2.5 w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบรายการ</td></tr>
              ) : filtered.map((item, i) => {
                const isEditing = editId === item._id
                return (
                  <tr key={item._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                    <td className="px-3 py-2 font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">{item.code}</td>
                    {hasParent && (
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{item.parent ?? "—"}</td>
                    )}
                    <td className="px-3 py-2 text-gray-900 dark:text-white min-w-[160px]">
                      {isEditing
                        ? <input value={editTh} onChange={(e) => setEditTh(e.target.value)} className={inputCls} autoFocus />
                        : item.th}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 min-w-[160px]">
                      {isEditing
                        ? <input value={editEn} onChange={(e) => setEditEn(e.target.value)} className={inputCls} />
                        : item.en}
                    </td>
                    {hasMeta && (
                      <td className="px-3 py-2 text-gray-400 dark:text-gray-600 text-xs font-mono max-w-[200px] truncate">
                        {isEditing
                          ? <input value={editMeta} onChange={(e) => setEditMeta(e.target.value)} className={inputCls} placeholder={dict === "BRAND" ? '{"category":"filter"}' : '{"color":"#DEEAF1"}'} />
                          : dict === "BRAND"
                            ? String((item.meta as { category?: string })?.category ?? "—")
                            : JSON.stringify(item.meta)
                        }
                      </td>
                    )}
                    {canAdmin && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(item)} disabled={saving} className="text-green-600 dark:text-green-400 hover:opacity-70 disabled:opacity-40">
                              <Check size={14} />
                            </button>
                            <button onClick={cancelEdit} className="text-gray-400 hover:opacity-70">
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(item)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => handleDelete(item)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
