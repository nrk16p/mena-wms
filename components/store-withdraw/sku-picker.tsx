"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { partsDropdown } from "@/lib/store-withdraw/parts-search"
import { useLookup } from "./use-lookup"
import { useHubLookup, type HubHit } from "./hub-picker"

export type SkuHit = { skuId: number; skuCode: string; skuName: string; stockQty: number | null }

const inputCls =
  "w-full rounded-md border border-[#D5DCD8] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const optCls = "flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10"
const msgCls = "px-3 py-2 text-xs text-gray-500"

/**
 * ช่องค้นอะไหล่ · ส่ง onPickHub มา = ค้นสต๊อกคลังกับ Hub พร้อมกัน (Hub ขึ้นก่อน แยกหัวกลุ่ม)
 * ไม่ส่ง = ค้นสต๊อกอย่างเดียวแบบเดิม (ใช้ในรับเข้า Hub ด้วย)
 */
export function SkuPicker({ inventoryId, onPick, onPickHub }: { inventoryId?: number; onPick: (s: SkuHit) => void; onPickHub?: (h: HubHit) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const stock = useLookup<SkuHit>("sku", q, { inv: inventoryId })
  const hub = useHubLookup(q, inventoryId, !!onPickHub)
  const tooShort = stock.tooShort
  const { groups, empty, loading } = partsDropdown(onPickHub ? hub : null, stock)
  const done = () => { setQ(""); setOpen(false) }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        data-testid="parts-input"
        className={inputCls}
        placeholder={onPickHub ? "ค้นหารหัสหรือชื่ออะไหล่ (สต๊อกคลัง + Hub)" : "ค้นหารหัสหรือชื่ออะไหล่"}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.trim().length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-[#D5DCD8] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
          {tooShort && <p className={msgCls}>พิมพ์อีกนิดนะ ต้อง 2 ตัวขึ้นไป</p>}
          {!tooShort && loading && <p className={msgCls}>กำลังค้น…</p>}
          {!tooShort && empty && <p className={msgCls}>ไม่เจออะไหล่ที่ค้น</p>}
          {!tooShort && groups.map((g) => (
            <div key={g.kind} role="group" aria-label={g.title ?? undefined} data-testid={`parts-group-${g.kind}`}>
              {g.title && <p className="sticky top-0 z-[1] rounded bg-gray-50 px-3 py-1.5 text-[11px] font-semibold text-gray-600 dark:bg-[#1c2029] dark:text-gray-300">{g.title}</p>}
              {g.loading && <p className={msgCls}>กำลังค้น…</p>}
              {!g.loading && g.error && <p className="px-3 py-2 text-xs text-red-600">{g.error}</p>}
              {!g.loading && g.kind === "hub" && g.rows.map((r) => (
                <button key={`${r.skuId}-${r.vendorCode}`} type="button" data-testid="hub-option" className={optCls}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { onPickHub?.(r); done() }}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900 dark:text-white">{r.skuName}</span>
                    <span className="block truncate text-xs text-gray-500">{r.skuCode} · {r.vendorName}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${r.qty > 0 ? "text-[#1B8C4B]" : "text-red-600"}`}>
                    คงเหลือ Hub {r.qty.toLocaleString("th-TH")}{r.unit ? ` ${r.unit}` : ""}
                  </span>
                </button>
              ))}
              {!g.loading && g.kind === "stock" && g.rows.map((r) => (
                <button key={r.skuId} type="button" className={optCls}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(r); done() }}>
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
          ))}
        </div>
      )}
    </div>
  )
}
