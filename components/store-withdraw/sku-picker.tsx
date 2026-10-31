"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { useLookup } from "./use-lookup"

export type SkuHit = { skuId: number; skuCode: string; skuName: string; stockQty: number | null }

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

export function SkuPicker({ inventoryId, onPick }: { inventoryId?: number; onPick: (s: SkuHit) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const { rows, loading, error, tooShort } = useLookup<SkuHit>("sku", q, { inv: inventoryId })

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        className={inputCls}
        placeholder="ค้นรหัสหรือชื่ออะไหล่ (พิมพ์ 2 ตัวขึ้นไป)"
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
          {!tooShort && !loading && !error && rows.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">ไม่เจออะไหล่ที่ค้น</p>}
          {!loading && rows.map((r) => (
            <button
              key={r.skuId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(r); setQ(""); setOpen(false) }}
              className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-900 dark:text-white">{r.skuName}</span>
                <span className="block truncate text-xs text-gray-500">{r.skuCode}</span>
              </span>
              <span className={`shrink-0 text-xs ${r.stockQty == null ? "text-gray-400" : r.stockQty > 0 ? "text-[#1B8C4B]" : "text-red-600"}`}>
                {r.stockQty == null ? "ไม่ทราบสต๊อก" : `คงเหลือ ${r.stockQty.toLocaleString("th-TH")}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
