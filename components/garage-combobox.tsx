"use client"

// GarageCombobox — เลือก/ค้นหา/เพิ่มอู่ (ย้ายออกจาก repair-external-page.tsx เพื่อให้
// แท็บแผนซ่อม (repair-plan-tab) ใช้ร่วมได้โดยไม่ import วนกลับเข้าหน้าใหญ่)
import { useState, useEffect, useRef } from "react"
import { ChevronDown, X, Check, Plus } from "lucide-react"
import { swalError } from "@/lib/swal"

export type Garage = { _id: string; name: string }

export const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

export function GarageCombobox({
  value, garages, onChange, onCreated, filterMode, placeholder,
}: {
  value: string
  garages: Garage[]
  onChange: (name: string) => void
  onCreated?: (g: Garage) => void
  filterMode?: boolean   // โหมดตัวกรอง: ไม่มีปุ่มเพิ่มอู่ใหม่
  placeholder?: string
}) {
  const [open, setOpen]     = useState(false)
  const [text, setText]     = useState("")
  const [adding, setAdding] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const filtered = garages.filter((g) => g.name.toLowerCase().includes(text.trim().toLowerCase()))
  const exactMatch = garages.some((g) => g.name.toLowerCase() === text.trim().toLowerCase())
  const canCreate = !filterMode && text.trim().length > 0 && !exactMatch

  async function createGarage() {
    const name = text.trim()
    if (!name) return
    setAdding(true)
    try {
      const res = await fetch("/api/garage-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const g = await res.json()
      if (g?._id) onCreated?.(g)
      onChange(g?.name ?? name)
      setText("")
      setOpen(false)
    } catch {
      swalError("เพิ่มอู่ไม่สำเร็จ")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={inputCls + " flex items-center justify-between text-left"}
      >
        <span className={"truncate " + (value ? "text-gray-900 dark:text-white" : "text-gray-400")}>{value || placeholder || "เลือกอู่..."}</span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-[60] mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); createGarage() } }}
              placeholder={filterMode ? "ค้นหาอู่..." : "ค้นหา หรือพิมพ์ชื่ออู่ใหม่..."}
              className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151a10] px-2.5 py-1.5 text-sm focus:border-[#1B8C4B] focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto pb-1">
            {(value || filterMode) && (
              <button type="button" onClick={() => { onChange(""); setText(""); setOpen(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5">
                <X size={12} /> {filterMode ? "ทุกอู่" : "ล้างค่า"}
              </button>
            )}
            {filtered.map((g) => (
              <button
                key={g._id}
                type="button"
                onClick={() => { onChange(g.name); setText(""); setOpen(false) }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
              >
                {g.name}
                {value === g.name && <Check size={14} className="text-[#1B8C4B]" />}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={createGarage}
                disabled={adding}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5 disabled:opacity-60"
              >
                <Plus size={14} /> เพิ่มอู่ “{text.trim()}”
              </button>
            )}
            {!canCreate && filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">ไม่พบอู่</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
