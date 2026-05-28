"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Search, X } from "lucide-react"

type VehicleItem = {
  plate:        string
  fleetNo:      string
  vehicleType:  string
  brand:        string
  model:        string
  fuelType:     string
  year:         string
}

interface VehicleMultiSelectProps {
  values:    string[]        // array of plate strings
  onChange:  (values: string[]) => void
  className?: string
}

export function VehicleMultiSelect({ values, onChange, className }: VehicleMultiSelectProps) {
  const [query,    setQuery]    = useState("")
  const [open,     setOpen]     = useState(false)
  const [results,  setResults]  = useState<VehicleItem[]>([])
  const [selected, setSelected] = useState<VehicleItem[]>([])  // rich data for chips
  const [loading,  setLoading]  = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  // Load rich info for already-selected plates on mount/change
  useEffect(() => {
    if (values.length === 0) { setSelected([]); return }
    const missing = values.filter((p) => !selected.find((s) => s.plate === p))
    if (missing.length === 0) return
    fetch(`/api/vehicles?q=&limit=500`)
      .then((r) => r.json())
      .then((all: VehicleItem[]) => {
        setSelected(values.map((p) => all.find((v) => v.plate === p) ?? { plate: p, fleetNo: "", vehicleType: "", brand: "", model: "", fuelType: "", year: "" }))
      }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values])

  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/vehicles?q=${encodeURIComponent(q)}&limit=50`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data.filter((v: VehicleItem) => !values.includes(v.plate)) : [])
    } catch { setResults([]) }
    setLoading(false)
  }, [values])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => search(query), 200)
    return () => clearTimeout(t)
  }, [query, open, search])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery("")
      }
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  function openDropdown() {
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function add(v: VehicleItem) {
    onChange([...values, v.plate])
    setSelected((p) => [...p, v])
    setQuery("")
    inputRef.current?.focus()
  }

  function remove(plate: string) {
    onChange(values.filter((p) => p !== plate))
    setSelected((p) => p.filter((v) => v.plate !== plate))
  }

  const typeColor = (type: string) => {
    if (type.includes("Mixer"))   return "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
    if (type.includes("หาง") || type.includes("ลากจูง") || type.includes("หัวเบ้า") || type.includes("หัวเบาท์"))
      return "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300"
    return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Tag container */}
      <div
        onClick={openDropdown}
        className={`min-h-[38px] flex flex-wrap gap-1.5 items-center cursor-text py-1.5 ${className ?? ""}`}
      >
        {selected.map((v) => (
          <span
            key={v.plate}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${typeColor(v.vehicleType)}`}
          >
            <span className="font-mono">{v.plate}</span>
            {v.vehicleType && <span className="opacity-60 text-[10px]">{v.vehicleType}</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(v.plate) }}
              className="hover:opacity-70 transition-opacity ml-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); setQuery("") }
              if (e.key === "Enter" && results.length === 1) { e.preventDefault(); add(results[0]) }
            }}
            placeholder="ค้นหาทะเบียน / เลขรถ / ประเภท..."
            className="flex-1 min-w-[180px] bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder-gray-400"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          values.length === 0 && (
            <span className="flex-1 flex items-center gap-1.5 text-sm text-gray-400">
              <Search size={13} />
              ค้นหาทะเบียน / รุ่นรถ...
            </span>
          )
        )}

        {!open && values.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openDropdown() }}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Search size={13} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl">
          {loading ? (
            <p className="px-3 py-3 text-sm text-gray-400 text-center">กำลังค้นหา...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400 text-center">{query ? "ไม่พบยานพาหนะ" : "พิมพ์เพื่อค้นหา"}</p>
          ) : results.map((v) => (
            <button
              key={v.plate}
              type="button"
              onClick={() => add(v)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-50 dark:border-white/3 last:border-0"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-sm text-gray-900 dark:text-white w-28 shrink-0">{v.plate}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${typeColor(v.vehicleType)}`}>{v.vehicleType || "—"}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{v.brand}{v.model ? ` · ${v.model}` : ""}{v.year ? ` (${v.year})` : ""}</span>
                {v.fleetNo && <span className="ml-auto text-[11px] font-mono text-gray-400 shrink-0">#{v.fleetNo}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
