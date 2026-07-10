"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { PlusCircle, Search, Pencil, Trash2, ChevronLeft, ChevronRight, X, ChevronsUpDown, ArrowUp, ArrowDown, FilterX } from "lucide-react"
import { WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1, SUB_ASSEMBLY_L2 } from "@/lib/codes"
import { COMPONENT_L3 } from "@/lib/codes-l3"
import { swalDeleteConfirm, swalToast } from "@/lib/swal"
import { isAdmin as isAdminEmail } from "@/lib/roles"
import { ImageThumbs } from "@/components/image-thumbs"
import type { SkuImage } from "@/lib/media"

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
  ทะเบียนหรือรุ่นรถ: string
  createdBy?: string
  createdByName?: string
  createdAt?: string
  approvedBy?: string
  approvedAt?: string
  images?: SkuImage[]
}

// "20 มิ.ย. 14:30" — short Thai date + 24h time
function fmtShort(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const date = d.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" })
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })
  return `${date} ${time}`
}

// drop the @domain from an email so "somchai@mena.co.th" → "somchai"
function shortUser(name?: string, email?: string): string {
  if (name) return name
  if (email) return email.split("@")[0]
  return "—"
}

// admin-created SKUs are auto-approved → the creator is the approver
function approverOf(row: SkuRow): { by?: string; at?: string; name?: string } {
  const creatorIsAdmin = isAdminEmail(row.createdBy)
  return {
    by:   row.approvedBy ?? (creatorIsAdmin ? row.createdBy : undefined),
    at:   row.approvedAt ?? (creatorIsAdmin ? row.createdAt : undefined),
    name: row.approvedBy ? undefined : (creatorIsAdmin ? row.createdByName : undefined),
  }
}

// ── Column model — drives header, sorting and per-column filtering ──
type ColKey =
  | "sku" | "wh" | "type" | "name" | "partNo" | "l" | "atms"
  | "price" | "unit" | "brand" | "vehicle" | "grade" | "createdBy" | "approvedBy" | "actions"

type ColDef = {
  key: ColKey
  label: string
  sortable?: boolean
  filter?: "text" | "select"
  align?: "right"
  adminOnly?: boolean
}

const COLUMNS: ColDef[] = [
  { key: "sku",        label: "SKU",        sortable: true, filter: "text" },
  { key: "wh",         label: "คลัง",       sortable: true, filter: "select" },
  { key: "type",       label: "ประเภท",     sortable: true, filter: "select" },
  { key: "name",       label: "ชื่ออะไหล่", sortable: true, filter: "text" },
  { key: "partNo",     label: "เบอร์",      sortable: true, filter: "text" },
  { key: "l",          label: "L1-L2-L3",   sortable: true, filter: "text" },
  { key: "atms",       label: "ATMS",       filter: "text" },
  { key: "price",      label: "ราคา",       sortable: true, align: "right" },
  { key: "unit",       label: "หน่วย",      sortable: true, filter: "select" },
  { key: "brand",      label: "ยี่ห้อ",     sortable: true, filter: "text" },
  { key: "vehicle",    label: "รุ่นรถ",     filter: "text" },
  { key: "grade",      label: "Grade",      sortable: true, filter: "select" },
  { key: "createdBy",  label: "สร้างโดย",   sortable: true, filter: "text" },
  { key: "approvedBy", label: "อนุมัติโดย", sortable: true, filter: "text" },
  { key: "actions",    label: "",           adminOnly: true },
]

// text used for filtering / string-sorting a given column
function cellText(row: SkuRow, key: ColKey): string {
  switch (key) {
    case "sku":     return row.SKU ?? ""
    case "wh":      return row.คลังสินค้า ?? ""
    case "type":    return row.ประเภทค่าใช้จ่าย ?? ""
    case "name":    return row.ชื่ออะไหล่_TH ?? ""
    case "partNo":  return row.เบอร์อะไหล่ ?? ""
    case "l":       return `${row.ระบบ_L1}-${row.ชุดประกอบ_L2}-${row.ชิ้นส่วน_L3}`
    case "atms":    return (Array.isArray(row.รหัสATMS) ? row.รหัสATMS : (row.รหัสATMS ? [row.รหัสATMS] : [])).join(" ")
    case "price":   return String(row.ราคาต่อหน่วย ?? "")
    case "unit":    return row.หน่วย ?? ""
    case "brand":   return row.ยี่ห้อ ?? ""
    case "vehicle": { const v = row.ทะเบียนหรือรุ่นรถ as unknown; return Array.isArray(v) ? v.join(" ") : String(v ?? "") }
    case "createdBy": return shortUser(row.createdByName, row.createdBy)
    case "approvedBy": { const a = approverOf(row); return shortUser(a.name, a.by) }
    default: return ""
  }
}

// comparable value for sorting — numbers/dates sort numerically, the rest by text
function sortVal(row: SkuRow, key: ColKey): string | number {
  if (key === "price")      return row.ราคาต่อหน่วย ?? 0
  if (key === "createdBy")  return row.createdAt ? new Date(row.createdAt).getTime() : 0
  if (key === "approvedBy") { const a = approverOf(row); return a.at ? new Date(a.at).getTime() : 0 }
  return cellText(row, key).toLowerCase()
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown size={12} className="text-gray-300 dark:text-gray-600 transition-colors group-hover:text-gray-500 dark:group-hover:text-gray-400" />
  return dir === "asc"
    ? <ArrowUp size={12} className="text-gray-900 dark:text-white" />
    : <ArrowDown size={12} className="text-gray-900 dark:text-white" />
}

const TYPE_COLOR: Record<string, string> = {
  PRT: "text-[#1D4ED8] bg-[#DBEAFE]",
  PM:  "text-[#15803D] bg-[#DCFCE7]",
  LAB: "text-[#A16207] bg-[#FEF9C3]",
  SVC: "text-[#C2410C] bg-[#FFEDD5]",
  CLN: "text-[#7C3AED] bg-[#F3E8FF]",
  TRP: "text-[#6B7C72] bg-[#F1F5F1]",
  ACC: "text-[#DC2626] bg-[#FEE2E2]",
}

const selCls = "text-[13px] border border-[#EEF2F0] dark:border-white/10 rounded-[11px] bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30"

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

  const limit = 50

  // derived cascading options
  const l2Options = l1 ? Object.entries(SUB_ASSEMBLY_L2[l1] ?? {}) : []
  const l3Options = l1 && l2 ? Object.entries((COMPONENT_L3[l1] ?? {})[l2] ?? {}) : []

  const activeFilters = [wh, type, l1, l2, l3, brand, grade, vehicle].filter(Boolean).length

  function resetFilters() {
    setWh(""); setType(""); setL1(""); setL2(""); setL3("")
    setBrand(""); setGrade(""); setVehicle(""); setQ(""); setPage(1)
  }

  // Fetch distinct brands/grades that match current filters (excluding each from its own facet)
  useEffect(() => {
    const base = new URLSearchParams({ status: "approved" })
    if (q)     base.set("q", q)
    if (wh)    base.set("wh", wh)
    if (type)  base.set("type", type)
    if (l1)    base.set("l1", l1)
    if (l2)    base.set("l2", l2)
    if (l3)    base.set("l3", l3)

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
  }, [q, wh, type, l1, l2, l3, brand, grade])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit), status: "approved" })
    if (q)       params.set("q", q)
    if (wh)      params.set("wh", wh)
    if (type)    params.set("type", type)
    if (l1)      params.set("l1", l1)
    if (l2)      params.set("l2", l2)
    if (l3)      params.set("l3", l3)
    if (brand)   params.set("brand", brand)
    if (grade)   params.set("grade", grade)
    if (vehicle) params.set("vehicle", vehicle)

    const res  = await window.fetch(`/api/sku?${params}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [page, q, wh, type, l1, l2, l3, brand, grade, vehicle])

  useEffect(() => { load() }, [load])

  async function handleDelete(sku: string) {
    const result = await swalDeleteConfirm(`ลบ SKU: ${sku}`)
    if (!result.isConfirmed) return
    setDeleting(sku)
    await window.fetch(`/api/sku/${sku}`, { method: "DELETE" })
    setDeleting(null)
    swalToast("success", "ลบ SKU สำเร็จ")
    load()
  }

  const totalPages = Math.ceil(total / limit)

  // ── client-side column sort + filter (operates on the loaded page) ──
  const [sortKey, setSortKey]       = useState<ColKey | null>(null)
  const [sortDir, setSortDir]       = useState<"asc" | "desc">("asc")
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  function toggleSort(key: ColKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc")
      else { setSortKey(null); setSortDir("asc") }   // asc → desc → off
    } else {
      setSortKey(key); setSortDir("asc")
    }
  }

  const colFilterKeys = Object.keys(colFilters).filter((k) => colFilters[k]?.trim())
  function setColFilter(key: ColKey, val: string) {
    setColFilters((f) => ({ ...f, [key]: val }))
  }
  function selectOptions(key: ColKey): string[] {
    return [...new Set(items.map((r) => cellText(r, key)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }

  let displayItems = items.filter((row) =>
    colFilterKeys.every((k) => cellText(row, k as ColKey).toLowerCase().includes(colFilters[k].toLowerCase()))
  )
  if (sortKey) {
    const dir = sortDir === "asc" ? 1 : -1
    displayItems = [...displayItems].sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey)
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }

  const filterCls = "w-full min-w-0 rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] px-1.5 py-1 text-[11px] font-normal normal-case tracking-normal text-gray-700 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:focus:ring-white/30"

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}>รายการ SKU</h1>
          <p className="text-[13px] text-[#6B7C72] mt-0.5" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>{total.toLocaleString()} รายการ</p>
        </div>
        <Link
          href="/sku/new"
          className="flex items-center gap-2 text-white text-[14px] rounded-[13px] px-[22px] py-3"
          style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif", fontWeight: 500, background: "#1B8C4B", boxShadow: "0 5px 12px -3px rgba(27,140,75,.5)" }}
        >
          <PlusCircle size={15} />
          เพิ่ม SKU ใหม่
        </Link>
      </div>

      {/* Filters */}
      <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-3 mb-4 space-y-2.5">
        {/* Row 1: search + warehouse + type */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              placeholder="ค้นหา SKU, ชื่ออะไหล่, เบอร์, ATMS..."
              className="w-full pl-9 pr-3 py-2 text-[13px] border border-[#EEF2F0] dark:border-white/10 rounded-[11px] bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white placeholder-[#9AA8A0] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30"
              style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
            />
          </div>
          <select value={wh} onChange={(e) => { setWh(e.target.value); setPage(1) }} className={selCls}>
            <option value="">คลังทั้งหมด</option>
            {Object.entries(WAREHOUSE).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} className={selCls}>
            <option value="">ประเภทค่าใช้จ่าย</option>
            {Object.entries(EXPENSE_TYPE).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
          </select>
        </div>

        {/* Row 2: vehicle + L1 → L2 → L3 + brand + grade */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Vehicle — leftmost: matches รุ่นรถ / ทะเบียนรถ / engineNo / chassisNo */}
          <input
            value={vehicle}
            onChange={(e) => { setVehicle(e.target.value); setPage(1) }}
            placeholder="รุ่นรถ / ทะเบียนรถ"
            className="w-40 px-3 py-2 text-[13px] border border-[#EEF2F0] dark:border-white/10 rounded-[11px] bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white placeholder-[#9AA8A0] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30"
            style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
          />

          {/* L1 */}
          <select
            value={l1}
            onChange={(e) => { setL1(e.target.value); setL2(""); setL3(""); setPage(1) }}
            className={selCls}
          >
            <option value="">ระบบ L1</option>
            {Object.entries(SYSTEM_L1).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
          </select>

          {/* L2 — only when L1 selected */}
          <select
            value={l2}
            onChange={(e) => { setL2(e.target.value); setL3(""); setPage(1) }}
            disabled={!l1}
            className={selCls + (!l1 ? " opacity-40 cursor-not-allowed" : "")}
          >
            <option value="">ชุดประกอบ L2</option>
            {l2Options.map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
          </select>

          {/* L3 — only when L2 selected */}
          <select
            value={l3}
            onChange={(e) => { setL3(e.target.value); setPage(1) }}
            disabled={!l2}
            className={selCls + (!l2 ? " opacity-40 cursor-not-allowed" : "")}
          >
            <option value="">ชิ้นส่วน L3</option>
            {l3Options.map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
          </select>

          {/* Brand — dynamic from current filtered data */}
          <select
            value={brandOptions.includes(brand) ? brand : ""}
            onChange={(e) => { setBrand(e.target.value); setPage(1) }}
            className={selCls}
          >
            <option value="">ยี่ห้อทั้งหมด {brandOptions.length > 0 ? `(${brandOptions.length})` : ""}</option>
            {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>

          {/* Grade — dynamic from current filtered data */}
          <select
            value={gradeOptions.includes(grade) ? grade : ""}
            onChange={(e) => { setGrade(e.target.value); setPage(1) }}
            className={selCls}
          >
            <option value="">Grade ทั้งหมด {gradeOptions.length > 0 ? `(${gradeOptions.length})` : ""}</option>
            {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          {/* Clear all */}
          {activeFilters > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 rounded-[11px] border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-3 py-2 text-[12px] font-medium hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
              style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
            >
              <X size={12} />
              ล้างตัวกรอง ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] overflow-hidden" style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm [&_td]:border-r [&_td]:border-gray-100 dark:[&_td]:border-white/4 [&_th]:border-r [&_th]:border-gray-200 dark:[&_th]:border-white/8 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <thead>
              {/* sortable header */}
              <tr className="border-b border-[#EEF2F0] dark:border-white/10 bg-[#F6FAF7] dark:bg-white/3">
                {COLUMNS.filter((c) => !c.adminOnly || isAdmin).map((col) => (
                  <th
                    key={col.key}
                    className={`px-2.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#9AA8A0] dark:text-gray-400 whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
                    style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
                  >
                    {col.sortable ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={`group inline-flex items-center gap-1 transition-colors hover:text-gray-900 dark:hover:text-white ${col.align === "right" ? "flex-row-reverse" : ""} ${sortKey === col.key ? "text-gray-900 dark:text-white" : ""}`}
                      >
                        {col.label}
                        <SortIcon active={sortKey === col.key} dir={sortDir} />
                      </button>
                    ) : col.label}
                  </th>
                ))}
              </tr>
              {/* per-column filters */}
              <tr className="border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117]">
                {/* {COLUMNS.filter((c) => !c.adminOnly || isAdmin).map((col) => (
                  <th key={col.key} className="px-1.5 py-1.5 align-middle">
                    {col.filter === "text" && (
                      <input
                        value={colFilters[col.key] ?? ""}
                        onChange={(e) => setColFilter(col.key, e.target.value)}
                        placeholder="กรอง…"
                        className={filterCls}
                      />
                    )}
                    {col.filter === "select" && (
                      <select
                        value={colFilters[col.key] ?? ""}
                        onChange={(e) => setColFilter(col.key, e.target.value)}
                        className={filterCls}
                      >
                        <option value="">ทั้งหมด</option>
                        {selectOptions(col.key).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                    {col.key === "actions" && colFilterKeys.length > 0 && (
                      <button
                        onClick={() => setColFilters({})}
                        title="ล้างตัวกรองคอลัมน์"
                        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors"
                      >
                        <FilterX size={13} />
                      </button>
                    )}
                  </th>
                ))} */}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isAdmin ? 15 : 14} className="px-4 py-10 text-center text-gray-400 text-sm">กำลังโหลด...</td></tr>
              ) : displayItems.length === 0 ? (
                <tr><td colSpan={isAdmin ? 15 : 14} className="px-4 py-10 text-center text-gray-400 text-sm">ไม่พบรายการ</td></tr>
              ) : displayItems.map((row, i) => (
                <tr key={row.SKU} className={`border-b border-[#F4F7F5] dark:border-white/5 hover:bg-[#F7FBF8] dark:hover:bg-white/3 transition-colors`}>
                  <td className="px-2.5 py-2 align-top font-mono text-xs text-gray-900 dark:text-white whitespace-nowrap">
                    {row.SKU}
                    <ImageThumbs images={row.images} />
                  </td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.คลังสินค้า}</td>
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? ""}`}>{row.ประเภทค่าใช้จ่าย}</span>
                  </td>
                  <td className="px-2.5 py-2 max-w-60 align-top">
                    <div className="truncate text-gray-900 dark:text-white">{row.ชื่ออะไหล่_TH}</div>
                  </td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">{row.เบอร์อะไหล่}</td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">{row.ระบบ_L1}-{row.ชุดประกอบ_L2}-{row.ชิ้นส่วน_L3}</td>
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    {(() => {
                      const codes = Array.isArray(row.รหัสATMS) ? row.รหัสATMS : (row.รหัสATMS ? [row.รหัสATMS] : [])
                      return codes.length > 0
                        ? <div className="flex flex-wrap gap-1">{codes.map((c) => <span key={c} className="inline-block rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{c}</span>)}</div>
                        : <span className="text-gray-300 dark:text-gray-700 text-xs">—</span>
                    })()}
                  </td>
                  <td className="px-2.5 py-2 align-top text-right text-gray-900 dark:text-white whitespace-nowrap">{row.ราคาต่อหน่วย > 0 ? row.ราคาต่อหน่วย.toLocaleString() : "—"}</td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400">{row.หน่วย}</td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.ยี่ห้อ || "—"}</td>
                  <td className="px-2.5 py-2 align-top text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs max-w-50 truncate">
                    {row.ทะเบียนหรือรุ่นรถ
                      ? <span className="inline-block rounded px-1.5 py-0.5 bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300 font-medium">{row.ทะเบียนหรือรุ่นรถ}</span>
                      : <span className="text-gray-300 dark:text-gray-700">—</span>
                    }
                  </td>
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300">{row.Grade}</span>
                  </td>

                  {/* สร้างโดย */}
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    {row.createdAt || row.createdBy ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-xs text-gray-700 dark:text-gray-300 max-w-32 truncate">{shortUser(row.createdByName, row.createdBy)}</span>
                        <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-600">{fmtShort(row.createdAt)}</span>
                      </div>
                    ) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                  </td>

                  {/* อนุมัติโดย — admin-created SKUs are auto-approved by their creator */}
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    {(() => {
                      const creatorIsAdmin = isAdminEmail(row.createdBy)
                      const apprBy   = row.approvedBy ?? (creatorIsAdmin ? row.createdBy : undefined)
                      const apprAt   = row.approvedAt ?? (creatorIsAdmin ? row.createdAt : undefined)
                      // when falling back to the creator, prefer their display name
                      const apprName = row.approvedBy ? undefined : (creatorIsAdmin ? row.createdByName : undefined)
                      return apprBy || apprAt ? (
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs text-emerald-600 dark:text-emerald-500 max-w-32 truncate">{shortUser(apprName, apprBy)}</span>
                          <span className="text-[10px] tabular-nums text-emerald-600/60 dark:text-emerald-500/50">{fmtShort(apprAt)}</span>
                        </div>
                      ) : <span className="text-gray-300 dark:text-gray-700">—</span>
                    })()}
                  </td>

                  {isAdmin && (
                    <td className="px-2.5 py-2 align-top whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Link href={`/sku/${row.SKU}`} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                          <Pencil size={13} />
                        </Link>
                        <button onClick={() => handleDelete(row.SKU)} disabled={deleting === row.SKU} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#EEF2F0] dark:border-white/8">
            <p className="text-[12px] text-[#6B7C72]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>หน้า {page} / {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="flex items-center justify-center h-8 w-8 rounded-[10px] border border-[#EEF2F0] dark:border-white/10 disabled:opacity-40 hover:bg-[#F0FDF4] text-[#6B7C72] hover:text-[#1B8C4B] transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="flex items-center justify-center h-8 w-8 rounded-[10px] border border-[#EEF2F0] dark:border-white/10 disabled:opacity-40 hover:bg-[#F0FDF4] text-[#6B7C72] hover:text-[#1B8C4B] transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
