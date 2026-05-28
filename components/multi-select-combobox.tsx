"use client"

import { useState, useRef, useEffect } from "react"
import { Search, X, ChevronDown } from "lucide-react"

type CodeMap = Record<string, { th: string; en: string }>

interface MultiSelectComboboxProps {
  options:   CodeMap
  values:    string[]
  onChange:  (values: string[]) => void
  placeholder?: string
  className?: string
}

export function MultiSelectCombobox({
  options, values, onChange, placeholder = "— ทุกรุ่น / ไม่ระบุ —", className,
}: MultiSelectComboboxProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen]   = useState(false)
  const containerRef      = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

  const available = Object.entries(options).filter(([code]) => !values.includes(code))
  const filtered  = query.trim()
    ? available.filter(([code, v]) =>
        code.toLowerCase().includes(query.toLowerCase()) ||
        v.th.includes(query) ||
        v.en.toLowerCase().includes(query.toLowerCase())
      )
    : available

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

  function add(code: string) {
    onChange([...values, code])
    setQuery("")
    inputRef.current?.focus()
  }

  function remove(code: string) {
    onChange(values.filter((v) => v !== code))
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Tag container + trigger */}
      <div
        onClick={openDropdown}
        className={`min-h-[38px] flex flex-wrap gap-1 items-center cursor-text py-1.5 ${className ?? ""}`}
      >
        {values.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs font-mono"
          >
            {code}
            <span className="hidden sm:inline text-indigo-500 dark:text-indigo-400 text-[10px]">
              {options[code]?.th ? ` ${options[code].th}` : ""}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(code) }}
              className="hover:text-red-500 dark:hover:text-red-400 transition-colors ml-0.5"
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
              if (e.key === "Enter" && filtered.length === 1) { e.preventDefault(); add(filtered[0][0]) }
            }}
            placeholder="ค้นหารุ่นรถ / ทะเบียน..."
            className="flex-1 min-w-[140px] bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder-gray-400"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          values.length === 0 && (
            <span className="flex-1 flex items-center gap-1.5 text-sm text-gray-400">
              <ChevronDown size={13} />
              {placeholder}
            </span>
          )
        )}

        {!open && values.length > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Search size={13} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400 text-center">
              {available.length === 0 ? "เลือกครบทุกรุ่นแล้ว" : "ไม่พบรุ่นรถที่ค้นหา"}
            </p>
          ) : (
            filtered.map(([code, v]) => (
              <button
                key={code}
                type="button"
                onClick={() => add(code)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
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
