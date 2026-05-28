"use client"

import { useState, useRef, useEffect } from "react"
import { Search, X, ChevronDown } from "lucide-react"

type CodeMap = Record<string, { th: string; en: string }>

interface BrandComboboxProps {
  options: CodeMap
  value: string
  onChange: (value: string) => void
  className?: string
}

export function BrandCombobox({ options, value, onChange, className }: BrandComboboxProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen]   = useState(false)
  const containerRef      = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? Object.entries(options).filter(([code, v]) =>
        code.toLowerCase().includes(query.toLowerCase()) ||
        v.th.includes(query) ||
        v.en.toLowerCase().includes(query.toLowerCase())
      )
    : Object.entries(options)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [])

  function openDropdown() {
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function select(code: string) {
    onChange(code)
    setQuery("")
    setOpen(false)
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange("")
    setQuery("")
    setOpen(false)
  }

  const displayLabel = value ? (options[value]?.th || value) : null
  const displayCode  = value ? value : null

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <div
        onClick={openDropdown}
        className={`flex items-center gap-2 cursor-pointer ${className ?? ""}`}
      >
        {open ? (
          <>
            <Search size={13} className="shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setQuery("") }
                if (e.key === "Enter" && filtered.length === 1) {
                  e.preventDefault()
                  select(filtered[0][0])
                }
              }}
              placeholder="ค้นหายี่ห้อ / code..."
              className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder-gray-400"
              onClick={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <>
            <ChevronDown size={13} className="shrink-0 text-gray-400" />
            {displayLabel ? (
              <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">
                {displayLabel}
                <span className="ml-2 font-mono text-[11px] text-gray-400">{displayCode}</span>
              </span>
            ) : (
              <span className="flex-1 text-sm text-gray-400">— ไม่ระบุ —</span>
            )}
            {value && (
              <button type="button" onClick={clear} className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                <X size={13} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl">
          {/* Clear option */}
          <button
            type="button"
            onClick={() => { onChange(""); setQuery(""); setOpen(false) }}
            className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5"
          >
            — ไม่ระบุ —
          </button>

          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400 text-center">ไม่พบยี่ห้อที่ค้นหา</p>
          ) : (
            filtered.map(([code, v]) => (
              <button
                key={code}
                type="button"
                onClick={() => select(code)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${value === code ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
              >
                <span className="font-mono text-[11px] text-gray-400 w-28 shrink-0">{code}</span>
                <span className="text-gray-900 dark:text-white flex-1">{v.th}</span>
                {v.en && <span className="text-gray-400 text-[11px] shrink-0">{v.en}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
