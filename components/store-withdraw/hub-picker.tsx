"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

export type HubHit = { skuId: number; skuCode: string; skuName: string; unit: string; vendorCode: string; vendorName: string; qty: number }

const inputCls =
  "w-full rounded-md border border-[#D5DCD8] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

type Done = { key: string; rows: HubHit[]; error: string }

/** ค้นอะไหล่ที่อยู่ใน Hub (รอหยุดพิมพ์ 300 ms · ≥ 2 ตัว) · ยิงเฉพาะตอนคลังนี้เปิด Hub — ฟอร์มเช็กก่อนแล้วค่อยโชว์ช่องนี้ */
export function HubPicker({ inventoryId, onPick }: { inventoryId?: number; onPick: (h: HubHit) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const term = q.trim()
  const tooShort = term.length < 2
  const key = `${inventoryId ?? ""}|${term}`

  useEffect(() => {
    if (term.length < 2 || !inventoryId) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ inventoryId: String(inventoryId), q: term, limit: "20" })
        const r = await fetch(`/api/store-withdraw/hub/items?${sp}`, { signal: ctl.signal })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง")
        setDone({ key, rows: j.results ?? [], error: "" })
      } catch (e) {
        if (ctl.signal.aborted) return
        setDone({ key, rows: [], error: e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง" })
      }
    }, 300)
    return () => { clearTimeout(t); ctl.abort() }
  }, [term, inventoryId, key])

  const fresh = !tooShort && done?.key === key ? done : null
  const rows = fresh?.rows ?? []
  const error = fresh?.error ?? ""
  const loading = !tooShort && !fresh

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        data-testid="hub-input"
        className={inputCls}
        placeholder="ค้นหารหัสหรือชื่ออะไหล่ใน Hub"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && term.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[#D5DCD8] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
          {tooShort && <p className="px-3 py-2 text-xs text-gray-500">พิมพ์อีกนิดนะ ต้อง 2 ตัวขึ้นไป</p>}
          {!tooShort && loading && <p className="px-3 py-2 text-xs text-gray-500">กำลังค้น…</p>}
          {!tooShort && !loading && error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
          {!tooShort && !loading && !error && rows.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">ไม่เจออะไหล่ใน Hub ที่ค้น</p>}
          {!loading && rows.map((r) => (
            <button
              key={`${r.skuId}-${r.vendorCode}`}
              type="button"
              data-testid="hub-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(r); setQ(""); setOpen(false) }}
              className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-900 dark:text-white">{r.skuName}</span>
                <span className="block truncate text-xs text-gray-500">{r.skuCode} · {r.vendorName}</span>
              </span>
              <span className={`shrink-0 text-xs ${r.qty > 0 ? "text-[#1B8C4B]" : "text-red-600"}`}>
                คงเหลือ Hub {r.qty.toLocaleString("th-TH")}{r.unit ? ` ${r.unit}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
