"use client"

// SkuPicker — ช่อง "รายการ" ในใบเทียบราคา: พิมพ์ชื่อเองได้ตามปกติ หรือค้นรหัสสินค้า ATMS แล้วเลือกจาก dropdown
// พิมพ์ ≥2 ตัวอักษร → debounce 250ms → GET /api/price-compare/sku-search?q= (session guard ฝั่ง API)
// รูปแบบ dropdown ตาม garage-combobox.tsx / vendor-combobox.tsx (mousedown-outside close, positioned list, สีเขียว #1B8C4B)
import { useEffect, useRef, useState, type KeyboardEvent } from "react"

export type SkuHit = { code: string; name: string; group: string; unit: string }

const baseInputCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"

export function SkuPicker({
  value, onChange, onPick, disabled, className, placeholder,
}: {
  value: string
  onChange: (name: string) => void
  onPick: (hit: SkuHit) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<SkuHit[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reqIdRef = useRef(0)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  // เคลียร์ debounce/request ค้างเมื่อ unmount กันเรียก setState หลังปิดหน้า
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); abortRef.current?.abort() }, [])

  function search(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = text.trim()
    if (q.length < 2) {
      abortRef.current?.abort()
      reqIdRef.current++   // ยกเลิกผลลัพธ์ที่ยังค้างอยู่จากคำค้นก่อนหน้าด้วย
      setHits([]); setLoading(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const myId = ++reqIdRef.current
      setLoading(true)
      try {
        const res = await fetch(`/api/price-compare/sku-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const d = await res.json().catch(() => [])
        if (myId !== reqIdRef.current) return   // ผลลัพธ์เก่าที่มาช้า — ทิ้ง
        setHits(Array.isArray(d) ? d : [])
        setHighlight(0)
      } catch (e) {
        if ((e as Error).name === "AbortError") return
        if (myId === reqIdRef.current) setHits([])
      } finally {
        if (myId === reqIdRef.current) setLoading(false)
      }
    }, 250)
  }

  function handleChange(v: string) {
    onChange(v)
    setOpen(true)
    search(v)
  }

  function pick(h: SkuHit) {
    onPick(h)
    setOpen(false)
    setHits([])
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) { if (e.key === "Escape") setOpen(false); return }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => Math.min(i + 1, hits.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); pick(hits[highlight]) }
    else if (e.key === "Escape") setOpen(false)
  }

  const showDropdown = open && !disabled && value.trim().length >= 2

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "ชื่อรายการ หรือค้นรหัสสินค้า ATMS"}
        className={className ? `${baseInputCls} ${className}` : baseInputCls}
      />
      {showDropdown && (
        <div className="absolute z-[60] mt-1 w-full min-w-[280px] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
          <div className="max-h-56 overflow-y-auto py-1">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">กำลังค้นหา…</div>}
            {!loading && hits.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">ไม่พบสินค้า</div>}
            {!loading && hits.map((h, i) => (
              <button
                key={h.code}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(h)}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 ${i === highlight ? "bg-[#F0FDF4] dark:bg-white/5" : ""}`}
              >
                <span className="shrink-0 rounded bg-[#1B8C4B]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#1B8C4B]">{h.code}</span>
                <span className="flex-1 truncate">{h.name}</span>
                {h.group && <span className="shrink-0 text-[10px] text-gray-400">{h.group}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
