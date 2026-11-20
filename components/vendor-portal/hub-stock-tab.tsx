"use client"
// แท็บ "สต๊อกฝากขาย" ใน vendor-portal — ยอดคงเหลือของอะไหล่ที่ฝากไว้ที่ Hub (เห็นแค่ รหัส/ชื่อ/จำนวน)
import { useMemo, useState } from "react"
import { Search, X } from "lucide-react"
import { BRAND } from "@/lib/vendor-brand"

export type HubRow = { skuCode: string; skuName: string; unit: string; qty: number }

const timeTh = (d: Date) => d.toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })

export function HubStockTab({ rows, fetchedAt, onRefresh, refreshing }: { rows: HubRow[]; fetchedAt: Date | null; onRefresh: () => void; refreshing: boolean }) {
  const [q, setQ] = useState("")
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((r) => r.skuCode.toLowerCase().includes(t) || r.skuName.toLowerCase().includes(t)) : rows
  }, [rows, q])

  return (
    <div className="px-3 pt-3">
      <label className="flex h-11 items-center gap-2 rounded-xl border bg-white px-3" style={{ borderColor: BRAND.field }}>
        <Search className="h-[18px] w-[18px] flex-none text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นรหัส / ชื่ออะไหล่"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" enterKeyHint="search" />
        {q && <button onClick={() => setQ("")} aria-label="ล้างคำค้น" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500"><X className="h-[18px] w-[18px]" /></button>}
      </label>

      <div className="flex items-center justify-between gap-2 px-1 pb-2 pt-2.5 text-[12.5px] text-slate-600">
        <span>อัปเดตล่าสุด {fetchedAt ? timeTh(fetchedAt) : "-"}</span>
        <button onClick={onRefresh} disabled={refreshing} className="h-[34px] rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-60"
          style={{ borderColor: BRAND.green, color: BRAND.green }}>{refreshing ? "กำลังโหลด…" : "โหลดใหม่"}</button>
      </div>

      {rows.length === 0 && <p className="px-6 py-14 text-center text-sm text-slate-500">ตอนนี้ยังไม่มีของฝากขายที่ Hub</p>}
      {rows.length > 0 && shown.length === 0 && <p className="px-6 py-12 text-center text-sm text-slate-500">ไม่เจออะไหล่ที่ตรงกับที่ค้น</p>}

      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.skuCode} className="flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: BRAND.line }}>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold" style={{ color: BRAND.ink }}>{r.skuCode}</div>
              <div className="text-[13px] leading-snug text-slate-600">{r.skuName}</div>
            </div>
            <div className="flex-none text-right">
              <div className="text-lg font-bold tabular-nums" style={{ color: r.qty > 0 ? BRAND.green : BRAND.muted }}>{r.qty.toLocaleString("th-TH")}</div>
              <div className="text-[11px] text-slate-500">{r.unit}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
