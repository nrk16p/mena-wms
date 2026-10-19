"use client"

// AtmsCodePicker — ช่อง "รหัสสินค้า ATMS" ในหน้า /sku/new
//
// พิมพ์รหัสหรือชื่อไทย ≥2 ตัว → debounce 250ms → GET /api/sku/atms-lookup?q= (ค้นจากสำเนาในฐาน)
// เลือกจาก dropdown หรือกด Enter/comma กับรหัสที่พิมพ์เต็ม → GET ?code= (อ่านสดจาก ATMS)
// แล้วส่งค่าที่อ่านได้ให้หน้าแม่เอาไปเติมฟอร์ม (onResolved)
//
// ยิง ATMS เฉพาะตอน "เลือกรหัส" ไม่ใช่ตอนพิมพ์ — ATMS login เดียวทั้งระบบ ยิงทีละตัวอักษรทำให้ทรุด
// รูปแบบ dropdown ตาม components/sku-picker.tsx (mousedown-outside close, ไฮไลต์ด้วยลูกศร)
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { AtmsLookupResult, AtmsSkuHit } from "@/app/api/sku/atms-lookup/route"

export function AtmsCodePicker({
  codes, onAdd, onRemove, onResolved, invalid,
}: {
  codes: string[]
  onAdd: (code: string) => void
  onRemove: (code: string) => void
  /** เรียกหลังอ่านข้อมูลรหัสนั้นเสร็จ — null = อ่านไม่ได้/ไม่มีรหัสนี้ */
  onResolved: (code: string, result: AtmsLookupResult | null) => void
  invalid?: boolean
}) {
  const [input, setInput] = useState("")
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<AtmsSkuHit[]>([])
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState("")
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

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); abortRef.current?.abort() }, [])

  function search(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = text.trim()
    if (q.length < 2) {
      abortRef.current?.abort()
      reqIdRef.current++
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
        const res = await fetch(`/api/sku/atms-lookup?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const d = await res.json().catch(() => [])
        if (myId !== reqIdRef.current) return      // ผลลัพธ์เก่าที่มาช้า — ทิ้ง
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

  /** เพิ่มรหัสลงรายการทันที แล้วค่อยอ่านของสดจาก ATMS ตามไป (ไม่ให้คนรอ 2 วิเพื่อเห็น tag ขึ้น) */
  async function add(code: string) {
    const c = code.trim()
    if (!c) return
    if (!codes.includes(c)) onAdd(c)
    setInput(""); setHits([]); setOpen(false)
    setResolving(c)
    try {
      const res = await fetch(`/api/sku/atms-lookup?code=${encodeURIComponent(c)}`)
      const d = await res.json().catch(() => null) as AtmsLookupResult | null
      onResolved(c, d && typeof d === "object" && "found" in d ? d : null)
    } catch {
      onResolved(c, null)
    } finally {
      setResolving("")
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && hits.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => Math.min(i + 1, hits.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); return }
      if (e.key === "Enter") { e.preventDefault(); add(hits[highlight].code); return }
    }
    if ((e.key === "Enter" || e.key === ",") && input.trim()) { e.preventDefault(); add(input) }
    else if (e.key === "Escape") setOpen(false)
  }

  const showDropdown = open && input.trim().length >= 2

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {codes.map((code) => (
          <span key={code} className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-mono">
            {code}
            {resolving === code && <span className="animate-pulse text-[10px]">↻</span>}
            <button type="button" onClick={() => onRemove(code)} className="hover:text-red-500 transition-colors">×</button>
          </span>
        ))}
      </div>
      <div ref={boxRef} className="relative">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setOpen(true); search(e.target.value) }}
            onFocus={() => input.trim().length >= 2 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="ค้นรหัสหรือชื่อสินค้า ATMS"
            className={`flex-1 rounded-lg border bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 placeholder-gray-400 ${invalid ? "border-red-300 dark:border-red-700" : "border-blue-200 dark:border-blue-700/50"}`}
          />
          <button
            type="button"
            onClick={() => add(input)}
            disabled={!input.trim()}
            className="rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            เพิ่ม
          </button>
        </div>
        {showDropdown && (
          <div className="absolute z-[60] mt-1 w-full min-w-[280px] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
            <div className="max-h-56 overflow-y-auto py-1">
              {loading && <div className="px-3 py-2 text-xs text-gray-400">กำลังค้นหา…</div>}
              {!loading && hits.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">
                  ไม่พบในทะเบียนที่ซิงก์ไว้ — ถ้าเป็นรหัสที่เพิ่งเปิดวันนี้ พิมพ์รหัสเต็มแล้วกด Enter ได้เลย
                </div>
              )}
              {!loading && hits.map((h, i) => (
                <button
                  key={h.code}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => add(h.code)}
                  className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 ${i === highlight ? "bg-blue-50 dark:bg-white/5" : ""}`}
                >
                  <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono font-medium text-blue-600 dark:text-blue-400">{h.code}</span>
                  <span className="flex-1 truncate">{h.name}</span>
                  {h.group && <span className="shrink-0 text-[10px] text-gray-400">{h.group}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
