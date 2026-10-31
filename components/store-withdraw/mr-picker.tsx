"use client"

import { useState } from "react"
import { Search, X } from "lucide-react"
import { parseMrRow, type MrRow } from "@/lib/store-withdraw/mr-row"
import { useLookup } from "./use-lookup"

export type MrItem = MrRow

type Row = Record<string, unknown>

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

/** ค้น MR (ใบแจ้งซ่อม) แล้วเลือกรายการใน MR · onPick ส่งรายการทุกบรรทัดของ MR เดียวกับที่เลือกกลับไป */
export function MrPicker({ mrCode, onPick, onClear }: {
  mrCode: string
  onPick: (mrCode: string, items: MrItem[]) => void
  onClear: () => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const { rows, loading, error, tooShort } = useLookup<Row>("mr", q)
  const items = rows.map(parseMrRow).filter((x): x is MrItem => x !== null)

  if (mrCode) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[11px] border border-[#1B8C4B]/40 bg-[#1B8C4B]/5 px-3.5 py-2.5 text-sm">
        <span className="font-medium text-[#14271C] dark:text-white">{mrCode}</span>
        <button type="button" onClick={onClear} aria-label="ล้าง MR" className="text-gray-500 hover:text-red-600"><X size={16} /></button>
      </div>
    )
  }

  const pickManual = () => { const c = q.trim(); if (c) { onPick(c, []); setQ(""); setOpen(false) } }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        className={inputCls}
        placeholder="ค้นเลข MR (ไม่ใส่ก็ได้)"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.trim().length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#E2E8E4] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
          {tooShort && <p className="px-3 py-2 text-xs text-gray-500">พิมพ์อีกนิดนะ ต้อง 2 ตัวขึ้นไป</p>}
          {!tooShort && loading && <p className="px-3 py-2 text-xs text-gray-500">กำลังค้น…</p>}
          {!tooShort && !loading && error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
          {!tooShort && !loading && !error && items.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">ไม่เจอ MR ที่ค้น</p>}
          {!loading && items.map((it) => (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const code = it.mrCode || q.trim()
                const same = items.filter((x) => (x.mrCode || q.trim()) === code)
                onPick(code, same)
                setQ(""); setOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10"
            >
              <span className="block truncate text-gray-900 dark:text-white">{it.label}</span>
              {it.mrCode && <span className="block text-xs text-gray-500">{it.mrCode}</span>}
            </button>
          ))}
          {!tooShort && !loading && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pickManual}
              className="mt-1 block w-full rounded-lg border-t border-[#EEF2F0] px-3 py-2 text-left text-xs text-[#1B8C4B] hover:bg-[#1B8C4B]/10 dark:border-white/10">
              ใช้เลข &quot;{q.trim()}&quot; ตามที่พิมพ์
            </button>
          )}
        </div>
      )}
    </div>
  )
}
