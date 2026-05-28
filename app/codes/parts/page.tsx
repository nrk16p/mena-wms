"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  Search, Plus, Pencil, Check, X, Trash2,
  ChevronDown, ChevronRight, Shield, Eye, RefreshCw,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────
type Entry = {
  _id: string; dict: string; code: string
  th: string; en: string; parent: string | null
  order: number; meta: Record<string, unknown>
}

type TreeL3 = { entry: Entry }
type TreeL2 = { entry: Entry; l3: TreeL3[] }
type TreeL1 = { entry: Entry; l2: TreeL2[] }

// ─── L1 colour palette ───────────────────────────────────────────────────────
const L1_COLOR: Record<string, { bg: string; badge: string; dot: string }> = {
  ENG: { bg: "bg-orange-50 dark:bg-orange-950/40",  badge: "bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300",  dot: "bg-orange-400" },
  COL: { bg: "bg-blue-50 dark:bg-blue-950/40",      badge: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",          dot: "bg-blue-400" },
  FUL: { bg: "bg-yellow-50 dark:bg-yellow-950/40",  badge: "bg-yellow-100 dark:bg-yellow-900/60 text-yellow-700 dark:text-yellow-300",  dot: "bg-yellow-400" },
  TRN: { bg: "bg-purple-50 dark:bg-purple-950/40",  badge: "bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300",  dot: "bg-purple-400" },
  SUS: { bg: "bg-green-50 dark:bg-green-950/40",    badge: "bg-green-100 dark:bg-green-900/60 text-green-700 dark:text-green-300",      dot: "bg-green-400" },
  BRK: { bg: "bg-red-50 dark:bg-red-950/40",        badge: "bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300",              dot: "bg-red-400" },
  STR: { bg: "bg-teal-50 dark:bg-teal-950/40",      badge: "bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300",          dot: "bg-teal-400" },
  ELC: { bg: "bg-amber-50 dark:bg-amber-950/40",    badge: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",      dot: "bg-amber-400" },
  EXH: { bg: "bg-stone-50 dark:bg-stone-950/40",    badge: "bg-stone-100 dark:bg-stone-900/60 text-stone-700 dark:text-stone-300",      dot: "bg-stone-400" },
  TYR: { bg: "bg-lime-50 dark:bg-lime-950/40",      badge: "bg-lime-100 dark:bg-lime-900/60 text-lime-700 dark:text-lime-300",          dot: "bg-lime-400" },
  LUB: { bg: "bg-cyan-50 dark:bg-cyan-950/40",      badge: "bg-cyan-100 dark:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300",          dot: "bg-cyan-400" },
  MXS: { bg: "bg-rose-50 dark:bg-rose-950/40",      badge: "bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300",          dot: "bg-rose-400" },
  REF: { bg: "bg-sky-50 dark:bg-sky-950/40",        badge: "bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300",              dot: "bg-sky-400" },
  ACS: { bg: "bg-indigo-50 dark:bg-indigo-950/40",  badge: "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300",  dot: "bg-indigo-400" },
}
const DEFAULT_COLOR = { bg: "bg-gray-50 dark:bg-white/3", badge: "bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300", dot: "bg-gray-400" }

function c(l1code: string) { return L1_COLOR[l1code] ?? DEFAULT_COLOR }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function matches(entry: Entry, q: string) {
  const lq = q.toLowerCase()
  return (
    entry.code.toLowerCase().includes(lq) ||
    entry.th.includes(q) ||
    entry.en.toLowerCase().includes(lq)
  )
}

function buildTree(l1s: Entry[], l2s: Entry[], l3s: Entry[]): TreeL1[] {
  const l2ByParent = new Map<string, Entry[]>()
  const l3ByParent = new Map<string, Entry[]>()
  for (const e of l2s) { const k = e.parent ?? ""; (l2ByParent.get(k) ?? l2ByParent.set(k, []).get(k)!).push(e) }
  for (const e of l3s) { const k = e.parent ?? ""; (l3ByParent.get(k) ?? l3ByParent.set(k, []).get(k)!).push(e) }

  return l1s.map((l1) => ({
    entry: l1,
    l2: (l2ByParent.get(l1.code) ?? []).map((l2) => ({
      entry: l2,
      l3: (l3ByParent.get(`${l1.code}:${l2.code}`) ?? []).map((l3) => ({ entry: l3 })),
    })),
  }))
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function PartsPage() {
  const [tree, setTree]       = useState<TreeL1[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState("")
  const [l1Filter, setL1Filter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [adminMode, setAdminMode] = useState(false)

  // Edit state
  const [editId, setEditId]   = useState<string | null>(null)
  const [editTh, setEditTh]   = useState("")
  const [editEn, setEditEn]   = useState("")
  const [saving, setSaving]   = useState(false)

  // Add state
  type AddTarget = { level: "l2"; l1: string } | { level: "l3"; l1: string; l2: string } | { level: "l1" } | null
  const [addTarget, setAddTarget] = useState<AddTarget>(null)
  const [addCode, setAddCode]     = useState("")
  const [addTh, setAddTh]         = useState("")
  const [addEn, setAddEn]         = useState("")
  const [addErr, setAddErr]       = useState("")
  const [adding, setAdding]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch("/api/codes/parts-tree")
    const data = await res.json()
    setTree(buildTree(data.l1 ?? [], data.l2 ?? [], data.l3 ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-expand all when searching
  useEffect(() => {
    if (!search) return
    const exp: Record<string, boolean> = {}
    tree.forEach((t1) => {
      const l1match = matches(t1.entry, search)
      t1.l2.forEach((t2) => {
        const l2match = matches(t2.entry, search)
        t2.l3.forEach((t3) => {
          if (l1match || l2match || matches(t3.entry, search)) {
            exp[t1.entry.code] = true
            exp[`${t1.entry.code}:${t2.entry.code}`] = true
          }
        })
        if (l1match || l2match) exp[t1.entry.code] = true
      })
    })
    setExpanded(exp)
  }, [search, tree])

  function toggle(key: string) { setExpanded((p) => ({ ...p, [key]: !p[key] })) }

  // Filtered tree
  const displayed = useMemo(() => {
    let t = tree
    if (l1Filter) t = t.filter((n) => n.entry.code === l1Filter)
    if (!search)  return t
    return t
      .map((t1) => ({
        ...t1,
        l2: t1.l2
          .map((t2) => ({
            ...t2,
            l3: t2.l3.filter((t3) => matches(t3.entry, search) || matches(t2.entry, search) || matches(t1.entry, search)),
          }))
          .filter((t2) => t2.l3.length > 0 || matches(t2.entry, search) || matches(t1.entry, search)),
      }))
      .filter((t1) => t1.l2.length > 0 || matches(t1.entry, search))
  }, [tree, search, l1Filter])

  // ── Edit ────────────────────────────────────────────────────────────────
  function startEdit(e: Entry) { setEditId(e._id); setEditTh(e.th); setEditEn(e.en) }
  function cancelEdit()        { setEditId(null) }

  async function saveEdit(e: Entry) {
    setSaving(true)
    const codeKey = e._id.slice(e.dict.length + 1)
    await fetch(`/api/codes/${e.dict}/${encodeURIComponent(codeKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ th: editTh, en: editEn }),
    })
    setSaving(false)
    setEditId(null)
    load()
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  async function handleDelete(e: Entry) {
    const label = `"${e.code}" (${e.th})`
    const warn  = e.dict === "SYSTEM_L1"       ? `\n⚠️ จะลบ L2 และ L3 ทั้งหมดของ ${e.code} ด้วย` :
                  e.dict === "SUB_ASSEMBLY_L2"  ? `\n⚠️ จะลบ L3 ทั้งหมดของ ${e.parent}:${e.code} ด้วย` : ""
    if (!confirm(`ลบ ${label}?${warn}`)) return
    const codeKey = e._id.slice(e.dict.length + 1)
    await fetch(`/api/codes/${e.dict}/${encodeURIComponent(codeKey)}`, { method: "DELETE" })
    load()
  }

  // ── Add ─────────────────────────────────────────────────────────────────
  function openAdd(target: AddTarget) {
    setAddTarget(target); setAddCode(""); setAddTh(""); setAddEn(""); setAddErr("")
  }
  function closeAdd() { setAddTarget(null) }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addTarget) return
    setAdding(true); setAddErr("")

    let dict = ""; let parent: string | undefined

    if (addTarget.level === "l1")      { dict = "SYSTEM_L1" }
    else if (addTarget.level === "l2") { dict = "SUB_ASSEMBLY_L2"; parent = addTarget.l1 }
    else                               { dict = "COMPONENT_L3";    parent = `${addTarget.l1}:${addTarget.l2}` }

    const res = await fetch(`/api/codes/${dict}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: addCode.toUpperCase(), th: addTh, en: addEn, parent }),
    })
    setAdding(false)
    if (!res.ok) { const d = await res.json(); setAddErr(d.error ?? "Error"); return }
    closeAdd()
    load()
  }

  // ── Shared style shortcuts ───────────────────────────────────────────────
  const inputCls = "rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
  const iconBtn  = (color = "text-gray-400 hover:text-gray-700 dark:hover:text-white") => `transition-colors ${color}`

  // ── Inline add form ──────────────────────────────────────────────────────
  function AddForm({ label }: { label: string }) {
    return (
      <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2 py-2 px-3 bg-gray-50 dark:bg-white/3 rounded-lg border border-dashed border-gray-300 dark:border-white/15 mt-1 mb-1">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">{label}</p>
          <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="Code (เช่น DSC)" className={inputCls + " w-28 uppercase"} required />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1">ชื่อ TH *</p>
          <input value={addTh} onChange={(e) => setAddTh(e.target.value)} placeholder="ชื่อภาษาไทย" className={inputCls + " w-52"} required />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 mb-1">ชื่อ EN</p>
          <input value={addEn} onChange={(e) => setAddEn(e.target.value)} placeholder="English name" className={inputCls + " w-44"} />
        </div>
        {addErr && <p className="w-full text-xs text-red-500">{addErr}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={adding} className="flex items-center gap-1 rounded-md bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50">
            <Check size={12} /> {adding ? "..." : "บันทึก"}
          </button>
          <button type="button" onClick={closeAdd} className="rounded-md border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
            <X size={12} />
          </button>
        </div>
      </form>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Parts Catalog</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            ค้นหาและจัดการ L1 → L2 → L3 ทั้งหมดในที่เดียว
            <span className="ml-2 font-mono text-[11px] text-gray-400">{tree.length} ระบบ · {tree.reduce((a, t) => a + t.l2.length, 0)} L2 · {tree.reduce((a, t) => a + t.l2.reduce((b, u) => b + u.l3.length, 0), 0)} L3</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            <RefreshCw size={12} /> รีเฟรช
          </button>
          <button
            onClick={() => setAdminMode(!adminMode)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${adminMode ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900" : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8"}`}
          >
            {adminMode ? <><Shield size={12} /> Admin Mode</> : <><Eye size={12} /> View Mode</>}
          </button>
        </div>
      </div>

      {/* ── Search + L1 filter ── */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาด้วย code, ชื่อไทย, หรือชื่ออังกฤษ..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* L1 pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setL1Filter(null)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${!l1Filter ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900" : "bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/12"}`}
          >
            ทั้งหมด
          </button>
          {tree.map((t1) => {
            const col = c(t1.entry.code)
            return (
              <button
                key={t1.entry.code}
                onClick={() => setL1Filter(l1Filter === t1.entry.code ? null : t1.entry.code)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${l1Filter === t1.entry.code ? col.badge : "bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/12"}`}
              >
                {t1.entry.code}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Add L1 ── */}
      {adminMode && (
        <div className="mb-3">
          {addTarget?.level === "l1" ? (
            <AddForm label="เพิ่ม L1 ระบบใหม่" />
          ) : (
            <button onClick={() => openAdd({ level: "l1" })} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors">
              <Plus size={13} /> เพิ่มระบบ L1 ใหม่
            </button>
          )}
        </div>
      )}

      {/* ── Tree ── */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">กำลังโหลด...</div>
      ) : displayed.length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-400">ไม่พบรายการที่ค้นหา</div>
      ) : (
        <div className="space-y-2">
          {displayed.map((t1) => {
            const col      = c(t1.entry.code)
            const l1key    = t1.entry.code
            const l1open   = expanded[l1key] ?? (!!search || !!l1Filter)
            const isEditL1 = editId === t1.entry._id

            return (
              <div key={l1key} className={`rounded-xl border border-gray-200 dark:border-white/8 overflow-hidden`}>
                {/* ── L1 row ── */}
                <div className={`flex items-center gap-2 px-4 py-3 ${col.bg} cursor-pointer select-none`} onClick={() => toggle(l1key)}>
                  <span className="text-gray-400 dark:text-gray-500">
                    {l1open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${col.badge}`}>{t1.entry.code}</span>

                  {isEditL1 ? (
                    <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input value={editTh} onChange={(e) => setEditTh(e.target.value)} className={inputCls + " flex-1"} autoFocus />
                      <input value={editEn} onChange={(e) => setEditEn(e.target.value)} className={inputCls + " flex-1"} placeholder="EN" />
                      <button onClick={() => saveEdit(t1.entry)} disabled={saving} className={iconBtn("text-green-600 dark:text-green-400 hover:opacity-70")}><Check size={15} /></button>
                      <button onClick={cancelEdit} className={iconBtn()}><X size={15} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">{t1.entry.th}</span>
                        <span className="ml-2 text-xs text-gray-400 dark:text-gray-600">{t1.entry.en}</span>
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-gray-600 mr-2">{t1.l2.length} L2 · {t1.l2.reduce((a, u) => a + u.l3.length, 0)} L3</span>
                      {adminMode && (
                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => startEdit(t1.entry)} className={iconBtn()}><Pencil size={13} /></button>
                          <button onClick={() => handleDelete(t1.entry)} className={iconBtn("text-gray-400 hover:text-red-500 dark:hover:text-red-400")}><Trash2 size={13} /></button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* ── L2 rows ── */}
                {l1open && (
                  <div className="bg-white dark:bg-[#0f1117]">
                    {t1.l2.map((t2) => {
                      const l2key   = `${l1key}:${t2.entry.code}`
                      const l2open  = expanded[l2key] ?? (!!search)
                      const isEditL2 = editId === t2.entry._id

                      return (
                        <div key={l2key}>
                          {/* L2 header row */}
                          <div
                            className="flex items-center gap-2 pl-8 pr-4 py-2.5 border-t border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/2 cursor-pointer select-none"
                            onClick={() => toggle(l2key)}
                          >
                            <span className="text-gray-300 dark:text-gray-700">
                              {l2open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </span>
                            <div className={`h-2 w-2 shrink-0 rounded-full ${col.dot}`} />
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-400 font-mono">{t2.entry.code}</span>

                            {isEditL2 ? (
                              <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <input value={editTh} onChange={(e) => setEditTh(e.target.value)} className={inputCls + " flex-1"} autoFocus />
                                <input value={editEn} onChange={(e) => setEditEn(e.target.value)} className={inputCls + " flex-1"} placeholder="EN" />
                                <button onClick={() => saveEdit(t2.entry)} disabled={saving} className={iconBtn("text-green-600 dark:text-green-400")}><Check size={14} /></button>
                                <button onClick={cancelEdit} className={iconBtn()}><X size={14} /></button>
                              </div>
                            ) : (
                              <>
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{t2.entry.th}</span>
                                <span className="text-[11px] text-gray-400 dark:text-gray-600 mr-2">{t2.l3.length} L3</span>
                                {adminMode && (
                                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      onClick={() => { openAdd({ level: "l3", l1: t1.entry.code, l2: t2.entry.code }); setExpanded((p) => ({ ...p, [l2key]: true })) }}
                                      className={iconBtn("text-gray-400 hover:text-green-600 dark:hover:text-green-400")}
                                      title="เพิ่ม L3"
                                    >
                                      <Plus size={13} />
                                    </button>
                                    <button onClick={() => startEdit(t2.entry)} className={iconBtn()}><Pencil size={13} /></button>
                                    <button onClick={() => handleDelete(t2.entry)} className={iconBtn("text-gray-400 hover:text-red-500 dark:hover:text-red-400")}><Trash2 size={13} /></button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Add L3 inline form */}
                          {adminMode && addTarget && addTarget.level === "l3" && addTarget.l1 === t1.entry.code && addTarget.l2 === t2.entry.code && (
                            <div className="pl-12 pr-4 pb-2">
                              <AddForm label={`เพิ่ม L3 ใน ${t1.entry.code}:${t2.entry.code}`} />
                            </div>
                          )}

                          {/* L3 rows */}
                          {l2open && (
                            <div>
                              {t2.l3.map((t3) => {
                                const isEditL3 = editId === t3.entry._id
                                const hl = search && matches(t3.entry, search)
                                return (
                                  <div
                                    key={t3.entry._id}
                                    className={`flex items-center gap-2 pl-14 pr-4 py-2 border-t border-gray-100 dark:border-white/5 ${hl ? "bg-yellow-50/60 dark:bg-yellow-900/10" : "hover:bg-gray-50 dark:hover:bg-white/2"}`}
                                  >
                                    <span className="shrink-0 text-[10px] font-bold font-mono text-gray-400 dark:text-gray-600 w-8">{t3.entry.code}</span>

                                    {isEditL3 ? (
                                      <div className="flex flex-1 items-center gap-2">
                                        <input value={editTh} onChange={(e) => setEditTh(e.target.value)} className={inputCls + " flex-1"} autoFocus />
                                        <input value={editEn} onChange={(e) => setEditEn(e.target.value)} className={inputCls + " flex-1"} placeholder="EN" />
                                        <button onClick={() => saveEdit(t3.entry)} disabled={saving} className={iconBtn("text-green-600 dark:text-green-400")}><Check size={13} /></button>
                                        <button onClick={cancelEdit} className={iconBtn()}><X size={13} /></button>
                                      </div>
                                    ) : (
                                      <>
                                        <span className={`flex-1 text-sm ${hl ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{t3.entry.th}</span>
                                        <span className="text-xs text-gray-400 dark:text-gray-600 mr-2 hidden sm:block">{t3.entry.en}</span>
                                        {adminMode && (
                                          <div className="flex items-center gap-2">
                                            <button onClick={() => startEdit(t3.entry)} className={iconBtn()}><Pencil size={12} /></button>
                                            <button onClick={() => handleDelete(t3.entry)} className={iconBtn("text-gray-400 hover:text-red-500 dark:hover:text-red-400")}><Trash2 size={12} /></button>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Add L2 inline form */}
                    {adminMode && (
                      <div className="border-t border-gray-100 dark:border-white/5 pl-8 pr-4 py-2">
                        {addTarget?.level === "l2" && addTarget.l1 === l1key ? (
                          <AddForm label={`เพิ่ม L2 ใน ${l1key}`} />
                        ) : (
                          <button
                            onClick={() => { openAdd({ level: "l2", l1: l1key }); setExpanded((p) => ({ ...p, [l1key]: true })) }}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors py-1"
                          >
                            <Plus size={12} /> เพิ่ม L2 ใน {l1key}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
