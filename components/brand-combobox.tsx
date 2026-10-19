"use client"

import { useState, useRef, useEffect } from "react"
import { Search, X, ChevronDown, Plus } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"

type CodeMap = Record<string, { th: string; en: string }>

// หมวดยี่ห้อ — ชุดเดียวกับที่ seed ไว้ใน master_codes (meta.category)
const BRAND_CATEGORIES: { value: string; th: string }[] = [
  { value: "chassis",      th: "ตัวรถ/แชสซี" },
  { value: "battery",      th: "แบตเตอรี่" },
  { value: "bearing",      th: "ลูกปืน" },
  { value: "belt",         th: "สายพาน" },
  { value: "brake",        th: "เบรก" },
  { value: "clutch",       th: "คลัตช์" },
  { value: "driveline",    th: "เพลา/ระบบส่งกำลัง" },
  { value: "electrical",   th: "ไฟฟ้า" },
  { value: "filter",       th: "ไส้กรอง" },
  { value: "hydraulic",    th: "ไฮดรอลิก" },
  { value: "lubricant",    th: "น้ำมันหล่อลื่น" },
  { value: "seal",         th: "ซีล/ปะเก็น" },
  { value: "steering",     th: "พวงมาลัย" },
  { value: "suspension",   th: "ช่วงล่าง" },
  { value: "tire",         th: "ยาง" },
  { value: "transmission", th: "เกียร์" },
  { value: "other",        th: "อื่น ๆ" },
]

// รหัสยี่ห้อ: A–Z 0–9 และ _ เท่านั้น (ให้เข้ากับรหัสที่มีอยู่ เช่น ISUZU, ZOOMLION)
function toBrandCode(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 20)
}

interface BrandComboboxProps {
  options: CodeMap
  value: string
  onChange: (value: string) => void
  className?: string
  /** เรียกเมื่อเพิ่มยี่ห้อใหม่สำเร็จ เพื่อให้หน้าแม่เก็บเข้า options ของตัวเอง */
  onCreated?: (code: string, label: { th: string; en: string }) => void
}

export function BrandCombobox({ options, value, onChange, className, onCreated }: BrandComboboxProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen]   = useState(false)
  const containerRef      = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

  // ฟอร์มเพิ่มยี่ห้อใหม่ — กางอยู่ในดรอปดาวน์ ไม่ต้องออกจากหน้าที่กรอกค้างไว้
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [newCode, setNewCode]   = useState("")
  const [newTh, setNewTh]       = useState("")
  const [newEn, setNewEn]       = useState("")
  const [newCat, setNewCat]     = useState("other")
  const [addError, setAddError] = useState("")

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
        closeAdd()
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
    closeAdd()
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange("")
    setQuery("")
    setOpen(false)
  }

  function closeAdd() {
    setAdding(false)
    setSaving(false)
    setAddError("")
    setNewCode(""); setNewTh(""); setNewEn(""); setNewCat("other")
  }

  function openAdd() {
    // คำที่พิมพ์ค้นหาไว้ ใช้เป็นค่าเริ่มต้นทั้งรหัสและชื่อไทย
    const seed = query.trim()
    setNewCode(toBrandCode(seed))
    setNewTh(seed)
    setNewEn("")
    setNewCat("other")
    setAddError("")
    setAdding(true)
  }

  async function createBrand() {
    const code = toBrandCode(newCode)
    const th   = newTh.trim()
    if (!code)        { setAddError("กรุณาระบุรหัสยี่ห้อ (A–Z, 0–9)"); return }
    if (!th)          { setAddError("กรุณาระบุชื่อยี่ห้อ (ไทย)"); return }
    if (options[code]) { setAddError(`รหัส ${code} มีอยู่แล้ว — ${options[code].th}`); return }

    setSaving(true)
    setAddError("")
    const res = await fetch("/api/codes/BRAND", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, th, en: newEn.trim(), meta: { category: newCat } }),
    }).catch(() => null)

    setSaving(false)

    if (!res || !res.ok) {
      const msg = (await res?.json().catch(() => null))?.error ?? "เพิ่มยี่ห้อไม่สำเร็จ"
      setAddError(String(msg))
      if (!res) swalError("เพิ่มยี่ห้อไม่สำเร็จ — เชื่อมต่อไม่ได้")
      return
    }

    onCreated?.(code, { th, en: newEn.trim() })
    swalToast("success", `เพิ่มยี่ห้อ ${th} แล้ว`)
    closeAdd()
    select(code)
  }

  const displayLabel = value ? (options[value]?.th || value) : null
  const displayCode  = value ? value : null
  const inputCls     = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"

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
                if (e.key === "Escape") { setOpen(false); setQuery(""); closeAdd() }
                if (e.key === "Enter" && filtered.length === 1) {
                  e.preventDefault()
                  select(filtered[0][0])
                }
                if (e.key === "Enter" && filtered.length === 0 && query.trim() && !adding) {
                  e.preventDefault()
                  openAdd()
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
        <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl">
          {adding ? (
            /* ── ฟอร์มเพิ่มยี่ห้อใหม่ ── */
            <div className="p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-900 dark:text-white">เพิ่มยี่ห้อใหม่</p>
                <button type="button" onClick={closeAdd} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <X size={13} />
                </button>
              </div>

              <div>
                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">ชื่อยี่ห้อ (ไทย) *</label>
                <input
                  autoFocus
                  value={newTh}
                  onChange={(e) => setNewTh(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createBrand() } }}
                  placeholder="เช่น เอ็นทีเอ็น"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">รหัส *</label>
                  <input
                    value={newCode}
                    onChange={(e) => setNewCode(toBrandCode(e.target.value))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createBrand() } }}
                    placeholder="NTN"
                    className={inputCls + " font-mono"}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">ชื่ออังกฤษ</label>
                  <input
                    value={newEn}
                    onChange={(e) => setNewEn(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createBrand() } }}
                    placeholder="NTN"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">หมวด</label>
                <select value={newCat} onChange={(e) => setNewCat(e.target.value)} className={inputCls}>
                  {BRAND_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.th}</option>)}
                </select>
              </div>

              {addError && <p className="text-[11px] text-red-500">{addError}</p>}

              <div className="flex gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={createBrand}
                  disabled={saving}
                  className="flex-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? "กำลังบันทึก..." : "บันทึกและเลือก"}
                </button>
                <button
                  type="button"
                  onClick={closeAdd}
                  className="rounded-md border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Clear option */}
              <button
                type="button"
                onClick={() => { onChange(""); setQuery(""); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5"
              >
                — ไม่ระบุ —
              </button>

              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-center">
                  <p className="text-sm text-gray-400">ไม่พบยี่ห้อที่ค้นหา</p>
                  {query.trim() && (
                    <button
                      type="button"
                      onClick={openAdd}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      <Plus size={12} />
                      เพิ่ม &ldquo;{query.trim()}&rdquo; เป็นยี่ห้อใหม่
                    </button>
                  )}
                </div>
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

              {/* ปุ่มเพิ่มยี่ห้อ — มีให้กดเสมอ ไม่ต้องค้นหาให้ไม่เจอก่อน */}
              <button
                type="button"
                onClick={openAdd}
                className="w-full text-left px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 border-t border-gray-100 dark:border-white/5 flex items-center gap-1.5 sticky bottom-0 bg-white dark:bg-[#0f1117]"
              >
                <Plus size={12} />
                เพิ่มยี่ห้อใหม่
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
