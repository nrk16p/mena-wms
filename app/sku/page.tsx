"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { PlusCircle, Search, Pencil, Trash2, ChevronLeft, ChevronRight, X, Filter } from "lucide-react"
import { WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1, SUB_ASSEMBLY_L2 } from "@/lib/codes"
import { COMPONENT_L3 } from "@/lib/codes-l3"

// ─── Types ────────────────────────────────────────────────────────────────────

type SkuRow = {
  _id: string
  SKU: string
  คลังสินค้า: string
  ประเภทค่าใช้จ่าย: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  เบอร์อะไหล่: string
  ระบบ_L1: string
  ชุดประกอบ_L2: string
  ชิ้นส่วน_L3: string
  ตำแหน่ง: string
  ราคาต่อหน่วย: number
  หน่วย: string
  ยี่ห้อ: string
  Grade: string
  รหัสATMS: string | string[]
  ทะเบียนหรือรุ่นรถ: string | string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  PRT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PM:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  LAB: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  SVC: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  CLN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  TRP: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACC: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const selCls =
  "text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated skeleton row matching the 7-column merged layout */
function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 dark:border-white/5 animate-pulse">
      {/* รายการ */}
      <td className="px-3 py-3">
        <div className="h-3.5 w-48 bg-gray-200 dark:bg-white/8 rounded mb-1.5" />
        <div className="h-2.5 w-32 bg-gray-100 dark:bg-white/5 rounded mb-1" />
        <div className="h-2 w-20 bg-gray-100 dark:bg-white/4 rounded" />
      </td>
      {/* คลัง · ประเภท */}
      <td className="px-3 py-3">
        <div className="h-3 w-12 bg-gray-200 dark:bg-white/8 rounded mb-1.5" />
        <div className="h-4 w-10 bg-gray-100 dark:bg-white/5 rounded" />
      </td>
      {/* หมวดหมู่ */}
      <td className="px-3 py-3">
        <div className="h-3 w-24 bg-gray-200 dark:bg-white/8 rounded" />
      </td>
      {/* เบอร์ · ATMS */}
      <td className="px-3 py-3">
        <div className="h-3 w-20 bg-gray-200 dark:bg-white/8 rounded mb-1.5" />
        <div className="flex gap-1">
          <div className="h-4 w-14 bg-gray-100 dark:bg-white/5 rounded" />
          <div className="h-4 w-14 bg-gray-100 dark:bg-white/5 rounded" />
        </div>
      </td>
      {/* ยี่ห้อ · Grade */}
      <td className="px-3 py-3">
        <div className="h-3 w-16 bg-gray-200 dark:bg-white/8 rounded mb-1.5" />
        <div className="h-4 w-10 bg-gray-100 dark:bg-white/5 rounded" />
      </td>
      {/* ราคา */}
      <td className="px-3 py-3 text-right">
        <div className="h-3.5 w-16 bg-gray-200 dark:bg-white/8 rounded ml-auto" />
      </td>
      {/* Actions placeholder */}
      <td className="px-3 py-3">
        <div className="h-3 w-10 bg-gray-100 dark:bg-white/4 rounded" />
      </td>
    </tr>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SkuListPage() {
  const { data: session }       = useSession()
  const isAdmin                  = session?.user?.role === "admin"

  const [items, setItems]       = useState<SkuRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [brandOptions, setBrandOptions] = useState<string[]>([])

  // filters
  const [q,       setQ]       = useState("")
  const [wh,      setWh]      = useState("")
  const [type,    setType]    = useState("")
  const [l1,      setL1]      = useState("")
  const [l2,      setL2]      = useState("")
  const [l3,      setL3]      = useState("")
  const [brand,   setBrand]   = useState("")
  const [grade,   setGrade]   = useState("")
  const [vehicle, setVehicle] = useState("")
  const [gradeOptions, setGradeOptions] = useState<string[]>([])

  // debounced search value — only triggers load() after 300 ms of no typing
  const [debouncedQ, setDebouncedQ] = useState("")
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(value: string) {
    setQ(value)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setDebouncedQ(value)
      setPage(1)
    }, 300)
  }

  // cleanup on unmount
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }, [])

  const limit = 50

  // derived cascading options
  const l2Options = l1 ? Object.entries(SUB_ASSEMBLY_L2[l1] ?? {}) : []
  const l3Options = l1 && l2 ? Object.entries((COMPONENT_L3[l1] ?? {})[l2] ?? {}) : []

  const activeFilters = [wh, type, l1, l2, l3, brand, grade, vehicle].filter(Boolean).length

  function resetFilters() {
    setWh(""); setType(""); setL1(""); setL2(""); setL3("")
    setBrand(""); setGrade(""); setVehicle(""); setQ(""); setDebouncedQ(""); setPage(1)
  }

  // individual filter removal helpers
  function removeFilter(key: string) {
    if (key === "wh")      { setWh("");      setPage(1) }
    if (key === "type")    { setType("");    setPage(1) }
    if (key === "l1")      { setL1(""); setL2(""); setL3(""); setPage(1) }
    if (key === "l2")      { setL2(""); setL3(""); setPage(1) }
    if (key === "l3")      { setL3("");      setPage(1) }
    if (key === "brand")   { setBrand("");   setPage(1) }
    if (key === "grade")   { setGrade("");   setPage(1) }
    if (key === "vehicle") { setVehicle(""); setPage(1) }
  }

  // Build active filter chips for display
  type FilterChip = { key: string; label: string; value: string }
  const filterChips: FilterChip[] = [
    wh      && { key: "wh",      label: "คลัง",     value: wh },
    type    && { key: "type",    label: "ประเภท",    value: type },
    l1      && { key: "l1",      label: "L1",        value: l1 },
    l2      && { key: "l2",      label: "L2",        value: l2 },
    l3      && { key: "l3",      label: "L3",        value: l3 },
    brand   && { key: "brand",   label: "ยี่ห้อ",    value: brand },
    grade   && { key: "grade",   label: "Grade",     value: grade },
    vehicle && { key: "vehicle", label: "รุ่น/ทะเบียน", value: vehicle },
  ].filter(Boolean) as FilterChip[]

  // Fetch distinct brands/grades that match current filters (excluding each from its own facet)
  useEffect(() => {
    const base = new URLSearchParams({ status: "approved" })
    if (debouncedQ) base.set("q", debouncedQ)
    if (wh)         base.set("wh", wh)
    if (type)       base.set("type", type)
    if (l1)         base.set("l1", l1)
    if (l2)         base.set("l2", l2)
    if (l3)         base.set("l3", l3)

    const brandParams = new URLSearchParams(base)
    brandParams.set("distinct", "brand")
    if (grade) brandParams.set("grade", grade)

    const gradeParams = new URLSearchParams(base)
    gradeParams.set("distinct", "grade")
    if (brand) gradeParams.set("brand", brand)

    Promise.all([
      fetch(`/api/sku?${brandParams}`).then((r) => r.json()),
      fetch(`/api/sku?${gradeParams}`).then((r) => r.json()),
    ]).then(([brands, grades]) => {
      setBrandOptions(Array.isArray(brands) ? brands : [])
      setGradeOptions(Array.isArray(grades) ? grades : [])
    }).catch(() => {})
  }, [debouncedQ, wh, type, l1, l2, l3, brand, grade])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit), status: "approved" })
    if (debouncedQ) params.set("q", debouncedQ)
    if (wh)         params.set("wh", wh)
    if (type)       params.set("type", type)
    if (l1)         params.set("l1", l1)
    if (l2)         params.set("l2", l2)
    if (l3)         params.set("l3", l3)
    if (brand)      params.set("brand", brand)
    if (grade)      params.set("grade", grade)
    if (vehicle)    params.set("vehicle", vehicle)

    const res  = await window.fetch(`/api/sku?${params}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [page, debouncedQ, wh, type, l1, l2, l3, brand, grade, vehicle])

  useEffect(() => { load() }, [load])

  async function handleDelete(sku: string) {
    if (!confirm(`ลบ SKU: ${sku} ?`)) return
    setDeleting(sku)
    await window.fetch(`/api/sku/${sku}`, { method: "DELETE" })
    setDeleting(null)
    load()
  }

  const totalPages = Math.ceil(total / limit)

  // pagination window — show up to 5 page numbers around current page
  function getPageNumbers(): number[] {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const half = 2
    let start = Math.max(1, page - half)
    let end   = Math.min(totalPages, page + half)
    if (end - start < 4) {
      if (start === 1) end = Math.min(totalPages, 5)
      else             start = Math.max(1, totalPages - 4)
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }

  // helpers
  function resolveVehicle(val: string | string[]): { first: string; extra: number } {
    if (!val) return { first: "", extra: 0 }
    if (Array.isArray(val)) return { first: val[0] ?? "", extra: Math.max(0, val.length - 1) }
    return { first: val, extra: 0 }
  }

  const colCount = isAdmin ? 7 : 6

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">รายการ SKU</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total.toLocaleString()} รายการ
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/sku/new"
            className="flex items-center gap-2 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <PlusCircle size={15} />
            เพิ่ม SKU ใหม่
          </Link>
        )}
      </div>

      {/* ── Filter panel ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-3 mb-3 space-y-2.5">
        {/* Panel header */}
        <div className="flex items-center gap-1.5 pb-1 border-b border-gray-100 dark:border-white/6">
          <Filter size={13} className="text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">ตัวกรอง</span>
        </div>

        {/* Row 1: search + warehouse + type */}
        <div className="flex flex-wrap gap-2">
          {/* Search — debounced */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="ค้นหา SKU, ชื่ออะไหล่, เบอร์, ATMS..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">คลังสินค้า</label>
            <select
              value={wh}
              onChange={(e) => { setWh(e.target.value); setPage(1) }}
              className={selCls}
            >
              <option value="">ทั้งหมด</option>
              {Object.entries(WAREHOUSE).map(([k, v]) => (
                <option key={k} value={k}>{k} — {v}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">ประเภทค่าใช้จ่าย</label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1) }}
              className={selCls}
            >
              <option value="">ทั้งหมด</option>
              {Object.entries(EXPENSE_TYPE).map(([k, v]) => (
                <option key={k} value={k}>{k} — {v.th}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: L1 → L2 → L3 + brand + grade + vehicle + clear */}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">ระบบ L1</label>
            <select
              value={l1}
              onChange={(e) => { setL1(e.target.value); setL2(""); setL3(""); setPage(1) }}
              className={selCls}
            >
              <option value="">ทั้งหมด</option>
              {Object.entries(SYSTEM_L1).map(([k, v]) => (
                <option key={k} value={k}>{k} — {v.th}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className={`text-[10px] font-medium pl-0.5 ${!l1 ? "text-gray-300 dark:text-gray-600" : "text-gray-400 dark:text-gray-500"}`}>ชุดประกอบ L2</label>
            <select
              value={l2}
              onChange={(e) => { setL2(e.target.value); setL3(""); setPage(1) }}
              disabled={!l1}
              className={selCls + (!l1 ? " opacity-40 cursor-not-allowed" : "")}
            >
              <option value="">ทั้งหมด</option>
              {l2Options.map(([k, v]) => (
                <option key={k} value={k}>{k} — {v.th}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className={`text-[10px] font-medium pl-0.5 ${!l2 ? "text-gray-300 dark:text-gray-600" : "text-gray-400 dark:text-gray-500"}`}>ชิ้นส่วน L3</label>
            <select
              value={l3}
              onChange={(e) => { setL3(e.target.value); setPage(1) }}
              disabled={!l2}
              className={selCls + (!l2 ? " opacity-40 cursor-not-allowed" : "")}
            >
              <option value="">ทั้งหมด</option>
              {l3Options.map(([k, v]) => (
                <option key={k} value={k}>{k} — {v.th}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">
              ยี่ห้อ{brandOptions.length > 0 ? ` (${brandOptions.length})` : ""}
            </label>
            <select
              value={brandOptions.includes(brand) ? brand : ""}
              onChange={(e) => { setBrand(e.target.value); setPage(1) }}
              className={selCls}
            >
              <option value="">ทั้งหมด</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">
              Grade{gradeOptions.length > 0 ? ` (${gradeOptions.length})` : ""}
            </label>
            <select
              value={gradeOptions.includes(grade) ? grade : ""}
              onChange={(e) => { setGrade(e.target.value); setPage(1) }}
              className={selCls}
            >
              <option value="">ทั้งหมด</option>
              {gradeOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 pl-0.5">รุ่นรถ / ทะเบียน</label>
            <input
              value={vehicle}
              onChange={(e) => { setVehicle(e.target.value); setPage(1) }}
              placeholder="เช่น NQR, 1กก-1234"
              className="w-36 px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
            />
          </div>

          {/* Clear all */}
          {activeFilters > 0 && (
            <button
              onClick={resetFilters}
              className="self-end flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-3 py-2 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
            >
              <X size={12} />
              ล้างทั้งหมด ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* ── Active filter chips strip ────────────────────────────────────────── */}
      {filterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 px-0.5">
          {filterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300"
            >
              <span className="font-medium text-gray-400 dark:text-gray-500">{chip.label}:</span>
              {chip.value}
              <button
                onClick={() => removeFilter(chip.key)}
                aria-label={`ลบตัวกรอง ${chip.label}`}
                className="ml-0.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                {/* col: รายการ */}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap w-[280px]">
                  รายการ
                </th>
                {/* col: คลัง · ประเภท */}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  คลัง · ประเภท
                </th>
                {/* col: หมวดหมู่ */}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  หมวดหมู่
                </th>
                {/* col: เบอร์ · ATMS */}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  เบอร์ · ATMS
                </th>
                {/* col: ยี่ห้อ · Grade */}
                <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  ยี่ห้อ · Grade
                </th>
                {/* col: ราคา */}
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">
                  ราคา
                </th>
                {/* Actions — admin only */}
                {isAdmin && (
                  <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap w-16" />
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Skeleton rows
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : items.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={colCount} className="py-16">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Search size={40} className="text-gray-300 dark:text-gray-700" strokeWidth={1.5} />
                      <p className="text-base font-semibold text-gray-500 dark:text-gray-400">ไม่พบ SKU</p>
                      <p className="text-sm text-gray-400 dark:text-gray-600">ลองปรับตัวกรองหรือคำค้นหา</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((row, i) => {
                  // resolve ATMS codes
                  const atmsCodes = Array.isArray(row.รหัสATMS)
                    ? row.รหัสATMS
                    : row.รหัสATMS
                    ? [row.รหัสATMS]
                    : []
                  const atmsVisible = atmsCodes.slice(0, 2)
                  const atmsExtra   = atmsCodes.length - atmsVisible.length

                  // resolve vehicle
                  const { first: vehicleFirst, extra: vehicleExtra } = resolveVehicle(row.ทะเบียนหรือรุ่นรถ)

                  return (
                    <tr
                      key={row.SKU}
                      className={`border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${
                        i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-white/[0.015]"
                      }`}
                    >
                      {/* ── รายการ ──────────────────────────────────────────── */}
                      <td className="px-3 py-2.5 w-[280px] max-w-[280px]">
                        <p className="font-semibold text-gray-900 dark:text-white truncate leading-snug">
                          {row.ชื่ออะไหล่_TH || "—"}
                        </p>
                        {row.Part_Name_EN && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                            {row.Part_Name_EN}
                          </p>
                        )}
                        <p className="font-mono text-[10px] text-gray-400 dark:text-gray-600 mt-0.5 tracking-wide">
                          {row.SKU}
                        </p>
                      </td>

                      {/* ── คลัง · ประเภท ───────────────────────────────────── */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                          {row.คลังสินค้า || "—"}
                        </p>
                        {row.ประเภทค่าใช้จ่าย && (
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                              TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? "bg-gray-100 text-gray-600 dark:bg-white/8 dark:text-gray-300"
                            }`}
                          >
                            {row.ประเภทค่าใช้จ่าย}
                          </span>
                        )}
                      </td>

                      {/* ── หมวดหมู่ ─────────────────────────────────────────── */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                          {[row.ระบบ_L1, row.ชุดประกอบ_L2, row.ชิ้นส่วน_L3]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </td>

                      {/* ── เบอร์ · ATMS ─────────────────────────────────────── */}
                      <td className="px-3 py-2.5">
                        <p className="font-mono text-xs text-gray-600 dark:text-gray-400 mb-1 whitespace-nowrap">
                          {row.เบอร์อะไหล่ || "—"}
                        </p>
                        {atmsCodes.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {atmsVisible.map((c) => (
                              <span
                                key={c}
                                className="inline-block rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                              >
                                {c}
                              </span>
                            ))}
                            {atmsExtra > 0 && (
                              <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-gray-400">
                                +{atmsExtra}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-700 text-xs">—</span>
                        )}
                      </td>

                      {/* ── ยี่ห้อ · Grade ───────────────────────────────────── */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="text-xs text-gray-700 dark:text-gray-300 mb-1">
                          {row.ยี่ห้อ || "—"}
                        </p>
                        {row.Grade && (
                          <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300">
                            {row.Grade}
                          </span>
                        )}
                        {vehicleFirst && (
                          <span className="ml-1 inline-block rounded px-1.5 py-0.5 bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300 font-medium text-[10px]">
                            {vehicleFirst}
                            {vehicleExtra > 0 && ` +${vehicleExtra}`}
                          </span>
                        )}
                      </td>

                      {/* ── ราคา ─────────────────────────────────────────────── */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {row.ราคาต่อหน่วย > 0 ? (
                          <>
                            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                              {row.ราคาต่อหน่วย.toLocaleString()}
                            </span>
                            {row.หน่วย && (
                              <span className="ml-1 text-[11px] text-gray-400 dark:text-gray-600">
                                {row.หน่วย}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-700">—</span>
                        )}
                      </td>

                      {/* ── Actions (admin) ──────────────────────────────────── */}
                      {isAdmin && (
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/sku/${row.SKU}`}
                              aria-label={`แก้ไข ${row.SKU}`}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
                            >
                              <Pencil size={13} />
                            </Link>
                            <button
                              onClick={() => handleDelete(row.SKU)}
                              disabled={deleting === row.SKU}
                              aria-label={`ลบ ${row.SKU}`}
                              className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-white/8">
            {/* Left: range summary */}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              แสดง{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {((page - 1) * limit + 1).toLocaleString()}–
                {Math.min(page * limit, total).toLocaleString()}
              </span>{" "}
              จาก{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {total.toLocaleString()}
              </span>{" "}
              รายการ
            </p>

            {/* Right: prev + page numbers + next */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="หน้าก่อน"
                className="flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>

              {getPageNumbers().map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  aria-current={n === page ? "page" : undefined}
                  className={`flex items-center justify-center h-7 min-w-[28px] px-1 rounded-md text-xs font-medium transition-colors ${
                    n === page
                      ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 border border-gray-900 dark:border-white"
                      : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8"
                  }`}
                >
                  {n}
                </button>
              ))}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="หน้าถัดไป"
                className="flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
