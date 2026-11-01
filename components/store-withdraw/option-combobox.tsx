"use client"

// ช่องเลือกแบบพิมพ์ค้นได้ (autocomplete) ของฟอร์มเบิกอะไหล่ — ใช้กับ "คลัง" และ "จุดประสงค์"
// เหตุที่ไม่ใช้ <select>: จุดประสงค์มีเกือบ 60 ข้อ ขึ้นต้นคล้ายกัน (CM-… / AC-… / OTH-…) พิมพ์ 2 ตัวหาเร็วกว่าไล่ลิสต์
// ค่าเป็น id (number) หรือ "" ถ้ายังไม่เลือก · ค้นแบบตัดช่องว่าง ไม่สนตัวพิมพ์ใหญ่เล็ก และค้นได้ทุกส่วนของชื่อ
import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown, X } from "lucide-react"

export type ComboOpt = { id: number; name: string }

export function OptionCombobox({
  id, options, value, onChange, placeholder = "เลือก…", searchPlaceholder = "พิมพ์เพื่อค้นหา", className = "", clearable = false,
}: {
  id?: string
  options: ComboOpt[]
  value: number | ""
  onChange: (v: number | "") => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  clearable?: boolean
}) {
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.id === value)
  const q = query.trim().toLowerCase().replace(/\s+/g, " ")
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery("") }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const openBox = () => {
    if (open) return
    setOpen(true)
    // เปิดแล้วไฮไลต์ตัวที่เลือกอยู่ (ถ้ามี) ให้กด Enter ยืนยันเดิมได้ และลิสต์เลื่อนไปหาตัวนั้น
    const at = options.findIndex((o) => o.id === value)
    setActive(at >= 0 ? at : 0)
    if (at >= 0) setTimeout(() => listRef.current?.children[at]?.scrollIntoView({ block: "nearest" }), 0)
  }
  const pick = (o: ComboOpt) => { onChange(o.id); setOpen(false); setQuery("") }
  const clear = () => { onChange(""); setQuery(""); setOpen(false) }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); setQuery(""); return }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) { openBox(); return }
      if (!filtered.length) return
      const next = e.key === "ArrowDown" ? Math.min(active + 1, filtered.length - 1) : Math.max(active - 1, 0)
      setActive(next)
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
      return
    }
    if (e.key === "Enter") {
      if (open) { e.preventDefault(); const o = filtered[active]; if (o) pick(o) }
      return
    }
    if (e.key === "Tab") { setOpen(false); setQuery("") }
  }

  const inputCls =
    "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] py-2.5 pl-3.5 pr-16 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${uid}-o${filtered[active].id}` : undefined}
        className={inputCls}
        // ปิดอยู่แสดงชื่อที่เลือก · เปิดอยู่แสดงสิ่งที่กำลังพิมพ์ค้น
        value={open ? query : selected?.name ?? ""}
        placeholder={open ? searchPlaceholder : placeholder}
        onFocus={openBox}
        onClick={openBox}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true) }}
        onKeyDown={onKey}
      />
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1.5 text-gray-400">
        {clearable && selected && !open && (
          <button type="button" aria-label="ล้างที่เลือก" onClick={clear}
            className="pointer-events-auto rounded p-0.5 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        )}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <ul id={listId} ref={listRef} role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200/80 bg-white py-1 text-sm shadow-lg dark:border-white/10 dark:bg-[#1b202b]">
          {filtered.map((o, i) => {
            const isSel = o.id === value
            return (
              <li key={o.id} id={`${uid}-o${o.id}`} role="option" aria-selected={isSel}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                className={`flex cursor-pointer items-center gap-2 px-3.5 py-2 ${i === active ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                <span className="flex-1">{o.name}</span>
                {isSel && <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
              </li>
            )
          })}
          {filtered.length === 0 && (
            <li className="px-3.5 py-6 text-center text-xs text-gray-400">ไม่พบ “{query.trim()}”</li>
          )}
        </ul>
      )}
    </div>
  )
}
