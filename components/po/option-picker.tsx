"use client"
// ช่องกรองแบบพิมพ์แล้วมีรายชื่อขึ้นให้เลือก (ซัพพลายเออร์ / รหัสสินค้า) · เลือกได้หลายตัว ขึ้นเป็นป้ายกดลบได้
// รายชื่อมาจากข้อมูลช่วงวันที่ที่โหลดอยู่ (ไม่ยิง API เพิ่ม) · คีย์บอร์ด: ↑↓ เลือก · Enter ใส่ · Esc ปิด · Backspace ลบป้ายท้าย
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { poMatchOptions, type PoOption } from "@/lib/po-export"

export function PoOptionPicker({
  label, placeholder, options, selected, onChange, unit, emptyText,
}: {
  label: string
  placeholder: string
  options: PoOption[]
  selected: string[]
  onChange: (next: string[]) => void
  unit: string            // "ใบ" / "รายการ" — ต่อท้ายจำนวนในรายชื่อ
  emptyText: string       // ยังไม่มีอะไรให้เลือกในช่วงนี้
}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => poMatchOptions(options, query, selected), [options, query, selected])
  // รายชื่อเปลี่ยนได้เองระหว่างที่รายการสินค้ายังโหลดไม่ครบ — บีบตำแหน่งไฮไลต์ให้อยู่ในรายการเสมอ
  const act = matches.length ? Math.min(Math.max(active, 0), matches.length - 1) : -1
  const subOf = useMemo(() => new Map(options.map((o) => [o.value, o.sub])), [options])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const pick = (v: string) => {
    onChange([...selected, v])
    setQuery(""); setActive(0)
    inputRef.current?.focus()
  }
  const remove = (v: string) => onChange(selected.filter((x) => x !== v))

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (!matches.length) return
      const next = e.key === "ArrowDown" ? Math.min(act + 1, matches.length - 1) : Math.max(act - 1, 0)
      setActive(next)
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (open && act >= 0) pick(matches[act].value)
      return
    }
    if (e.key === "Backspace" && !query && selected.length) remove(selected[selected.length - 1])
  }

  const listId = `${id}-list`
  const showList = open && (matches.length > 0 || query.trim() !== "" || options.length === 0)

  return (
    <div ref={boxRef} className="relative min-w-0">
      <label htmlFor={`${id}-in`} className="mb-1 block text-[11px] font-medium text-[#6B7C72] dark:text-gray-400">{label}</label>
      <div
        onClick={() => { inputRef.current?.focus(); setOpen(true) }}
        className={`flex min-h-[40px] flex-wrap items-center gap-1 rounded-[10px] border bg-white px-2 py-1 dark:bg-[#151a10] ${open ? "border-[#1B8C4B]" : "border-[#EEF2F0] dark:border-white/10"}`}
      >
        {selected.map((v) => (
          <span key={v} title={subOf.get(v) || v}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#EAF6EE] py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-[#1B8C4B] dark:bg-[#1B8C4B]/15">
            <span className="truncate">{v}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(v) }} aria-label={`เอา ${v} ออก`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-[#1B8C4B]/15">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={`${id}-in`}
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false) }}
          onKeyDown={onKey}
          placeholder={selected.length ? "เพิ่มอีก…" : placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && act >= 0 ? `${id}-opt-${act}` : undefined}
          autoComplete="off"
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-[13px] text-[#14271C] outline-none placeholder:text-[#9AA8A0] dark:text-white"
        />
      </div>

      {showList && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-[#EEF2F0] bg-white shadow-lg dark:border-white/10 dark:bg-[#1b202b]">
          {!query.trim() && matches.length > 0 && (
            <p className="border-b border-[#F1F5F2] px-3 py-1.5 text-[11px] text-[#9AA8A0] dark:border-white/5">ที่มีบ่อยในช่วงนี้</p>
          )}
          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {matches.map((o, i) => (
              <li key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={i === act}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o.value) }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] ${i === act ? "bg-[#EAF6EE] dark:bg-[#1B8C4B]/15" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[#14271C] dark:text-gray-100">{o.label}</span>
                  {o.sub && <span className="block truncate text-[11px] text-[#6B7C72] dark:text-gray-400">{o.sub}</span>}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-[#9AA8A0]">{o.count.toLocaleString("th-TH")} {unit}</span>
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className="px-3 py-5 text-center text-[12px] text-[#9AA8A0]">
              {options.length === 0 ? emptyText : `ไม่พบ “${query.trim()}” ในช่วงวันที่นี้`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
