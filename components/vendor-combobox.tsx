"use client"

// VendorCombobox — เลือกคู่ค้าจากรายชื่อ AVL (/vendors) เท่านั้น ไม่มีพิมพ์ชื่อใหม่
// ค้นหาแบบเดียวกับช่อง "ค้นหาชื่ออู่" บนหน้า /vendors: พิมพ์แล้วกรองทันที (includes ไม่สนตัวพิมพ์)
// ใช้ในใบเทียบราคา S1–S4 (ผู้ใช้กำหนด 2026-09-10) — ชื่อที่เลือกจึงสะกดตรงกับ AVL เสมอ เทียบย้อนหลังได้
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, X, Check, Search } from "lucide-react"
import { inputCls } from "@/components/garage-combobox"

export type VendorName = { vendor: string; status: "approved" | "rejected" | "pending"; kind: string; jobs: number; lastYm: string }

const STATUS_TH: Record<VendorName["status"], { th: string; cls: string }> = {
  approved: { th: "อนุมัติ",   cls: "bg-emerald-50 text-emerald-700" },
  rejected: { th: "ไม่อนุมัติ", cls: "bg-red-50 text-red-700" },
  pending:  { th: "รอพิจารณา",  cls: "bg-gray-100 text-gray-500" },
}

/** โหลดรายชื่อครั้งเดียวต่อหน้า (module cache) — ช่อง S1–S4 ใช้ชุดเดียวกัน */
let cache: Promise<VendorName[]> | null = null
export function loadVendorNames(): Promise<VendorName[]> {
  if (!cache) {
    cache = fetch("/api/vendors/names").then(async (r) => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "โหลดรายชื่ออู่ไม่สำเร็จ")
      return d.vendors as VendorName[]
    }).catch((e) => { cache = null; throw e })
  }
  return cache
}

export function VendorCombobox({ value, onChange, placeholder, disabled }: {
  value: string
  onChange: (v: VendorName | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [list, setList] = useState<VendorName[]>([])
  const [err, setErr] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadVendorNames().then((v) => { if (!cancelled) setList(v) }).catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const q = text.trim().toLowerCase()
  const filtered = useMemo(() => (q ? list.filter((v) => v.vendor.toLowerCase().includes(q)) : list).slice(0, 80), [list, q])
  // ชื่อที่ค้างในใบเก่าแต่ไม่อยู่ใน AVL — โชว์ให้รู้ แต่เลือกใหม่ได้เฉพาะจากรายชื่อ
  const notInList = !!value && list.length > 0 && !list.some((v) => v.vendor === value)

  return (
    <div ref={boxRef} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={inputCls + " flex items-center justify-between text-left disabled:opacity-60"}>
        <span className={"truncate " + (value ? "text-gray-900 dark:text-white" : "text-gray-400")}>{value || placeholder || "เลือกอู่จาก AVL..."}</span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>
      {notInList && <div className="mt-0.5 text-[10px] text-amber-600">ชื่อนี้ไม่อยู่ในรายชื่ออู่ (/vendors) — เลือกใหม่จากรายชื่อ</div>}
      {open && (
        <div className="absolute z-[60] mt-1 w-full min-w-[300px] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
          <div className="relative p-2">
            <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtered.length === 1) { e.preventDefault(); onChange(filtered[0]); setText(""); setOpen(false) } if (e.key === "Escape") setOpen(false) }}
              placeholder="ค้นหาชื่ออู่"
              className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151a10] py-1.5 pl-7 pr-2.5 text-sm focus:border-[#1B8C4B] focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto pb-1">
            {value && (
              <button type="button" onClick={() => { onChange(null); setText(""); setOpen(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5">
                <X size={12} /> ล้างค่า
              </button>
            )}
            {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
            {!err && !list.length && <div className="px-3 py-2 text-xs text-gray-400">กำลังโหลดรายชื่อ…</div>}
            {!!list.length && !filtered.length && <div className="px-3 py-2 text-xs text-gray-400">ไม่พบ “{text.trim()}” ในรายชื่ออู่ — เพิ่มได้ที่หน้า /vendors เท่านั้น</div>}
            {filtered.map((v) => (
              <button
                key={v.vendor}
                type="button"
                onClick={() => { onChange(v); setText(""); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
              >
                <span className="flex-1 truncate">{v.vendor}</span>
                {v.kind && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-700">{v.kind}</span>}
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STATUS_TH[v.status].cls}`}>{STATUS_TH[v.status].th}</span>
                {value === v.vendor && <Check size={14} className="shrink-0 text-[#1B8C4B]" />}
              </button>
            ))}
            {list.length > 0 && filtered.length === 80 && <div className="px-3 py-1 text-[10px] text-gray-400">แสดง 80 รายการแรก — พิมพ์เพิ่มเพื่อกรอง</div>}
          </div>
        </div>
      )}
    </div>
  )
}
