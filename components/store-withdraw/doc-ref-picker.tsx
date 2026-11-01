"use client"

// ช่อง "อ้างอิงใบ PO / DD" ของฟอร์มเบิกอะไหล่: สลับ PO | DD แล้วพิมพ์ค้นเลขใบ (รอหยุดพิมพ์ 300 ms ผ่าน useLookup)
import { useState } from "react"
import { Search, X } from "lucide-react"
import { useLookup } from "./use-lookup"
import { DOC_LABEL, type DocHit, type DocKind } from "./doc-ref-types"

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

const money = (n: number | null) => (n == null ? "" : n.toLocaleString("th-TH", { maximumFractionDigits: 2 }))

export function DocRefPicker({ inventoryId, kind, onKind, picked, onPick, onClear, panelOpen, onTogglePanel }: {
  inventoryId?: number
  kind: DocKind
  onKind: (k: DocKind) => void
  picked: DocHit | null
  onPick: (d: DocHit) => void
  onClear: () => void
  panelOpen: boolean
  onTogglePanel: () => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const { rows, loading, error, tooShort } = useLookup<DocHit>(kind, q, { inv: inventoryId })

  const seg = (k: DocKind) => (
    <button type="button" key={k} onClick={() => { if (k !== kind) { setQ(""); onKind(k) } }} aria-pressed={kind === k}
      className={`flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition ${kind === k ? "bg-[#1B8C4B] text-white" : "text-gray-600 hover:bg-[#1B8C4B]/10 dark:text-gray-300"}`}>
      {DOC_LABEL[k]}
    </button>
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div role="group" aria-label="ชนิดใบอ้างอิง" className="flex shrink-0 rounded-xl border border-[#E2E8E4] p-0.5 dark:border-white/10 sm:w-36">
          {(["po", "dd"] as DocKind[]).map(seg)}
        </div>
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            data-testid="docref-input"
            className={inputCls}
            placeholder={kind === "po" ? "พิมพ์เลข PO เช่น LBPO2610" : "พิมพ์เลข DD เช่น LBDD2610"}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && q.trim().length > 0 && (
            <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-[#E2E8E4] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
              {tooShort && <p className="px-3 py-2 text-xs text-gray-500">พิมพ์อีกนิดนะ ต้อง 2 ตัวขึ้นไป</p>}
              {!tooShort && loading && <p className="px-3 py-2 text-xs text-gray-500">กำลังค้น…</p>}
              {!tooShort && !loading && error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
              {!tooShort && !loading && !error && rows.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">ไม่เจอ {DOC_LABEL[kind]} ที่ค้น (ค้นย้อนหลัง 90 วัน)</p>}
              {!loading && rows.map((r) => (
                <button key={r.id} type="button" data-testid="docref-option" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(r); setQ(""); setOpen(false) }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{r.code}</span>
                    {r.total != null && <span className="shrink-0 text-xs text-gray-500">฿{money(r.total)}</span>}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {[r.date, r.supplier, r.status].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {picked && (
        <div data-testid="docref-chip" className="flex items-start justify-between gap-2 rounded-[11px] border border-[#1B8C4B]/40 bg-[#1B8C4B]/5 px-3.5 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-[#14271C] dark:text-white">{DOC_LABEL[picked.kind]} {picked.code}</p>
            <p className="truncate text-xs text-gray-500">{[picked.date, picked.supplier, picked.status, picked.total != null ? `฿${money(picked.total)}` : null].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={onTogglePanel} className="text-xs font-medium text-[#1B8C4B] hover:underline">{panelOpen ? "ซ่อนรายการ" : "ดูรายการ"}</button>
            <button type="button" onClick={onClear} aria-label="ล้างใบอ้างอิง" className="text-gray-500 hover:text-red-600"><X size={16} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
