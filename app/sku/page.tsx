"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { PlusCircle, Search, Pencil, Trash2, ChevronLeft, ChevronRight, X } from "lucide-react"
import { WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1, SUB_ASSEMBLY_L2 } from "@/lib/codes"
import { COMPONENT_L3 } from "@/lib/codes-l3"

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
}

const TYPE_COLOR: Record<string, string> = {
  PRT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PM:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  LAB: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  SVC: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  CLN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  TRP: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACC: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const selCls = "text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"

export default function SkuListPage() {
  const [items, setItems]       = useState<SkuRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  // filters
  const [q,       setQ]       = useState("")
  const [wh,      setWh]      = useState("")
  const [type,    setType]    = useState("")
  const [l1,      setL1]      = useState("")
  const [l2,      setL2]      = useState("")
  const [l3,      setL3]      = useState("")
  const [brand,   setBrand]   = useState("")
  const [vehicle, setVehicle] = useState("")

  const limit = 50

  // derived cascading options
  const l2Options = l1 ? Object.entries(SUB_ASSEMBLY_L2[l1] ?? {}) : []
  const l3Options = l1 && l2 ? Object.entries((COMPONENT_L3[l1] ?? {})[l2] ?? {}) : []

  const activeFilters = [wh, type, l1, l2, l3, brand, vehicle].filter(Boolean).length

  function resetFilters() {
    setWh(""); setType(""); setL1(""); setL2(""); setL3("")
    setBrand(""); setVehicle(""); setQ(""); setPage(1)
  }

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
    if (vehicle) params.set("vehicle", vehicle)

    const res  = await window.fetch(`/api/sku?${params}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [page, q, wh, type, l1, l2, l3, brand, vehicle])

  useEffect(() => { load() }, [load])

  async function handleDelete(sku: string) {
    if (!confirm(`ลบ SKU: ${sku} ?`)) return
    setDeleting(sku)
    await window.fetch(`/api/sku/${sku}`, { method: "DELETE" })
    setDeleting(null)
    load()
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">รายการ SKU</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total.toLocaleString()} รายการ</p>
        </div>
        <Link href="/sku/new" className="flex items-center gap-2 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity">
          <PlusCircle size={15} />
          เพิ่ม SKU ใหม่
        </Link>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-3 mb-4 space-y-2.5">
        {/* Row 1: search + warehouse + type */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1) }}
              placeholder="ค้นหา SKU, ชื่ออะไหล่, เบอร์, ATMS..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
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

        {/* Row 2: L1 → L2 → L3 + brand + vehicle */}
        <div className="flex flex-wrap gap-2 items-center">
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

          {/* Brand */}
          <div className="relative">
            <input
              value={brand}
              onChange={(e) => { setBrand(e.target.value); setPage(1) }}
              placeholder="ยี่ห้อ"
              className="w-32 px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
            />
          </div>

          {/* Vehicle — free text: matches รุ่นรถ code or ทะเบียนรถ plate */}
          <input
            value={vehicle}
            onChange={(e) => { setVehicle(e.target.value); setPage(1) }}
            placeholder="รุ่นรถ / ทะเบียนรถ"
            className="w-36 px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
          />

          {/* Clear all */}
          {activeFilters > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-3 py-2 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
            >
              <X size={12} />
              ล้างตัวกรอง ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                {["SKU", "คลัง", "ประเภท", "ชื่ออะไหล่", "เบอร์", "L1-L2-L3", "ATMS", "ราคา", "หน่วย", "ยี่ห้อ", "รุ่นรถ", "Grade", ""].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400 text-sm">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-gray-400 text-sm">ไม่พบรายการ</td></tr>
              ) : items.map((row, i) => (
                <tr key={row.SKU} className={`border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-white/1"}`}>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-900 dark:text-white whitespace-nowrap">{row.SKU}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.คลังสินค้า}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? ""}`}>{row.ประเภทค่าใช้จ่าย}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-900 dark:text-white max-w-[200px] truncate">{row.ชื่ออะไหล่_TH}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">{row.เบอร์อะไหล่}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">{row.ระบบ_L1}-{row.ชุดประกอบ_L2}-{row.ชิ้นส่วน_L3}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {(() => {
                      const codes = Array.isArray(row.รหัสATMS) ? row.รหัสATMS : (row.รหัสATMS ? [row.รหัสATMS] : [])
                      return codes.length > 0
                        ? <div className="flex flex-wrap gap-1">{codes.map((c) => <span key={c} className="inline-block rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{c}</span>)}</div>
                        : <span className="text-gray-300 dark:text-gray-700 text-xs">—</span>
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-900 dark:text-white whitespace-nowrap">{row.ราคาต่อหน่วย > 0 ? row.ราคาต่อหน่วย.toLocaleString() : "—"}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{row.หน่วย}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.ยี่ห้อ || "—"}</td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                    {row.ทะเบียนหรือรุ่นรถ
                      ? <span className="inline-block rounded px-1.5 py-0.5 bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300 font-medium">{row.ทะเบียนหรือรุ่นรถ}</span>
                      : <span className="text-gray-300 dark:text-gray-700">—</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300">{row.Grade}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link href={`/sku/${row.SKU}`} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                        <Pencil size={13} />
                      </Link>
                      <button onClick={() => handleDelete(row.SKU)} disabled={deleting === row.SKU} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-white/8">
            <p className="text-xs text-gray-500 dark:text-gray-400">หน้า {page} / {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
