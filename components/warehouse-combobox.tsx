"use client"

// ตัวกรองคลังแบบ autocomplete — แทน <select> เดิมของหน้าติดตามเจ้าหนี้
// เหตุที่ต้องพิมพ์ค้นได้: ชื่อคลังมีเป็นสิบและขึ้นต้นคล้ายกัน ("คลัง HR สระบุรี" / "คลัง HR ลาดกระบัง")
// ไล่หาใน dropdown ยาว ๆ ช้ากว่าพิมพ์สองตัวอักษร · โครงตาม brand-combobox แต่รับ options เป็น string[]
import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Search, Warehouse, X } from "lucide-react"

export function WarehouseCombobox({
  options, value, onChange, allLabel = "ทุกคลัง", className = "",
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  allLabel?: string
  className?: string
}) {
  const [query, setQuery]   = useState("")
  const [open, setOpen]     = useState(false)
  const [active, setActive] = useState(0)          // index ที่ไฮไลต์ด้วยคีย์บอร์ด (0 = ตัวเลือก "ทุกคลัง")
  const boxRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLUListElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((w) => w.toLowerCase().includes(q)) : options
  // รายการที่เลื่อนได้จริง = [ทุกคลัง, ...ที่กรองแล้ว] — active ชี้ตำแหน่งในลิสต์รวมนี้
  const items = [allLabel, ...filtered]

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery("") }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const openBox = () => {
    setOpen(true)
    setActive(0)
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const pick = (v: string) => { onChange(v === allLabel ? "" : v); setOpen(false); setQuery("") }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); setQuery(""); return }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = e.key === "ArrowDown" ? Math.min(active + 1, items.length - 1) : Math.max(active - 1, 0)
      setActive(next)
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
      return
    }
    if (e.key === "Enter") { e.preventDefault(); if (items[active] !== undefined) pick(items[active]) }
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button type="button" onClick={() => (open ? setOpen(false) : openBox())}
        aria-haspopup="listbox" aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-sm transition dark:bg-white/5 ${value
          ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
          : "border-gray-200 dark:border-white/10"}`}>
        <Warehouse className={`h-4 w-4 ${value ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`} />
        <span className="max-w-[11rem] truncate">{value || allLabel}</span>
        {value ? (
          // ล้างตัวกรองได้ในคลิกเดียว — ไม่ต้องเปิดลิสต์แล้วไปหา "ทุกคลัง"
          <span role="button" aria-label="ล้างตัวกรองคลัง" onClick={(e) => { e.stopPropagation(); pick(allLabel) }}
            className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30">
            <X className="h-3.5 w-3.5" />
          </span>
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg dark:border-white/10 dark:bg-[#1b202b]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-white/10">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            {/* รีเซ็ตไฮไลต์ทุกครั้งที่คำค้นเปลี่ยน — ไม่งั้นพิมพ์จนเหลือ 2 ตัวแล้ว active
                ค้างที่ตำแหน่งเดิม กด Enter จะได้ตัวผิด (ทำใน handler ไม่ใช่ effect) */}
            <input ref={inputRef} value={query} onKeyDown={onKey}
              onChange={(e) => { setQuery(e.target.value); setActive(e.target.value.trim() ? 1 : 0) }}
              placeholder="พิมพ์ชื่อคลัง…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400" />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1 text-sm">
            {items.map((w, i) => {
              const isAll = i === 0
              const selected = isAll ? !value : value === w
              return (
                <li key={isAll ? "__all" : w} role="option" aria-selected={selected}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(w) }}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-emerald-50 dark:bg-emerald-900/20" : ""} ${isAll ? "border-b border-gray-100 text-gray-500 dark:border-white/10 dark:text-gray-400" : ""}`}>
                  <span className="flex-1 truncate">{w}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-gray-400">ไม่พบคลัง “{query.trim()}”</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
