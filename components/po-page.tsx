"use client"
// หน้า /po — ใบสั่งซื้อตามช่วงวันที่ (วันที่ PO หรือกำหนดส่ง) · ค้น/กรองสถานะ · ดูรายการสินค้า · Excel 2 ชีต
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ShoppingCart, Search, Download, ChevronDown, ExternalLink, AlertTriangle, X } from "lucide-react"
import { swalError } from "@/lib/swal"
import { atmsPoUrl } from "@/lib/atms-links"
import {
  filterPoRows, poRangeError, poThaiDate, PO_DATE_LABELS, PO_MAX_ROWS, PO_STATUS_LABEL, PO_STATUS_ORDER,
  type PoDateField, type PoItem, type PoRow, type PoStatusKey,
} from "@/lib/po-export"
import { downloadPoExcel } from "@/components/po/export-excel"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }
const baht = (n: number | null) => (n == null ? "—" : n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const qty = (n: number | null) => (n == null ? "—" : n.toLocaleString("th-TH", { maximumFractionDigits: 2 }))
const PAGE = 100

const STATUS_CLS: Record<PoStatusKey, string> = {
  none: "bg-[#FEF3C7] text-[#92600A] dark:bg-amber-900/25 dark:text-amber-300",
  partial: "bg-[#DBEAFE] text-[#1D4ED8] dark:bg-blue-500/15 dark:text-blue-300",
  all: "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300",
  cancel: "bg-[#F1F5F9] text-[#64748B] line-through dark:bg-white/10 dark:text-gray-400",
  other: "bg-[#F1F5F9] text-[#475569] dark:bg-white/10 dark:text-gray-300",
}

// ── วันที่ (Asia/Bangkok) ─────────────────────────────────────────────
const bkkToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
function preset(key: "month" | "prev" | "30d" | "3m"): [string, string] {
  const t = bkkToday()
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1, d = Number(t.slice(8, 10))
  if (key === "prev") return [iso(y, m - 1, 1), iso(y, m, 0)]
  if (key === "30d") return [iso(y, m, d - 29), t]
  if (key === "3m") return [iso(y, m - 2, 1), t]
  return [iso(y, m, 1), t]
}
const PRESETS: { key: "month" | "prev" | "30d" | "3m"; label: string }[] = [
  { key: "month", label: "เดือนนี้" }, { key: "prev", label: "เดือนก่อน" },
  { key: "30d", label: "30 วันล่าสุด" }, { key: "3m", label: "3 เดือน" },
]

type ItemState = { items: PoItem[]; detailId: string } | "loading" | "error"

function StatusBadge({ r }: { r: PoRow }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[r.statusKey]}`} title={r.status}>
      {r.status ? PO_STATUS_LABEL[r.statusKey] === "ไม่ระบุ" ? r.status : PO_STATUS_LABEL[r.statusKey] : "ไม่ระบุ"}
    </span>
  )
}

function Detail({ r, state }: { r: PoRow; state: ItemState | undefined }) {
  const extras = Object.entries(r.extra)
  const facts: [string, string][] = [
    ["ใบขอซื้อ (PR)", r.pr ? `${r.pr}${r.prDate ? ` · ${poThaiDate(r.prDate)}` : ""}` : "—"],
    ["ผู้ขอซื้อ", r.requester || "—"],
    ["คลัง · แผนก", [r.warehouse, r.dept].filter(Boolean).join(" · ") || "—"],
    ["เครดิต", r.apTerm || "—"],
    ["ผู้เปิด PO", r.user || "—"],
    ["ผู้อนุมัติ", r.approver || "—"],
    ["ใบรับของ (DD)", r.dd.length ? r.dd.map((d) => `${d.code}${d.date ? ` (${poThaiDate(d.date)})` : ""}`).join(", ") : "ยังไม่มี"],
    ...extras,
  ]
  const detailId = state && typeof state === "object" ? state.detailId : ""
  return (
    <div className="space-y-3 px-3 py-3 sm:px-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 text-[#6B7C72] dark:text-gray-400">{k}</dt>
            <dd className="min-w-0 break-words text-[#14271C] dark:text-gray-200">{v}</dd>
          </div>
        ))}
      </dl>
      {r.prNote && (
        <p className="rounded-lg bg-[#F6FAF7] px-3 py-2 text-[12px] text-[#4B5F54] dark:bg-white/5 dark:text-gray-300">
          <span className="font-medium text-[#14271C] dark:text-white">หมายเหตุ PR: </span>{r.prNote}
        </p>
      )}
      {state === "loading" || state === undefined ? (
        <div className="h-16 animate-pulse rounded-lg bg-[#F0F4F1] dark:bg-white/5" aria-label="กำลังโหลดรายการสินค้า" />
      ) : state === "error" ? (
        <p className="text-[12px] text-[#DC2626]">โหลดรายการสินค้าไม่สำเร็จ กดที่แถวอีกครั้งเพื่อลองใหม่</p>
      ) : state.items.length === 0 ? (
        <p className="text-[12px] text-[#6B7C72]">ยังไม่มีรายการสินค้าของใบนี้ในระบบ (ระบบดึงจาก ATMS ทุกคืน)</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#EEF2F0] dark:border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F6FAF7] text-left text-[11px] text-[#6B7C72] dark:bg-white/5 dark:text-gray-400">
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">สินค้า</th>
                <th className="px-2 py-1.5 font-medium">กลุ่ม</th>
                <th className="px-2 py-1.5 text-right font-medium">จำนวน</th>
                <th className="px-2 py-1.5 text-right font-medium">ราคา/หน่วย</th>
                <th className="px-2 py-1.5 text-right font-medium">รวม</th>
                <th className="px-2 py-1.5 text-right font-medium">รับแล้ว</th>
                <th className="px-2 py-1.5 text-right font-medium">ค้างรับ</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((it, i) => (
                <tr key={i} className="border-t border-[#F1F5F2] dark:border-white/5">
                  <td className="px-2 py-1.5 text-[#9AA8A0]">{it.seq ?? i + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="block text-[#14271C] dark:text-gray-100">{it.name || "—"}</span>
                    {it.sku && <span className="block text-[11px] text-[#9AA8A0]">{it.sku}</span>}
                    {it.note && <span className="block text-[11px] text-[#B07D12]">{it.note}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-[#4B5F54] dark:text-gray-300">{it.group || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{qty(it.qty)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{baht(it.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{baht(it.total)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{qty(it.received)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${it.outstanding ? "font-medium text-[#B07D12]" : ""}`}>{qty(it.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <a href={atmsPoUrl(r.code, detailId)} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1B8C4B] hover:underline">
        เปิดใบนี้ใน ATMS <ExternalLink size={12} />
      </a>
    </div>
  )
}

export function PoPage() {
  const [field, setField] = useState<PoDateField>("po")
  const [[from, to], setRange] = useState<[string, string]>(() => preset("month"))
  const [rows, setRows] = useState<PoRow[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [statuses, setStatuses] = useState<PoStatusKey[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)
  const [itemState, setItemState] = useState<Record<string, ItemState>>({})
  const [exportPct, setExportPct] = useState<number | null>(null)
  const reqId = useRef(0)

  const load = useCallback(async (f: string, t: string, fld: PoDateField) => {
    const id = ++reqId.current
    const bad = poRangeError(f, t)
    setOpen(null); setLimit(PAGE)
    if (bad) { setError(bad); setRows([]); setTotal(0); setLoading(false); return }
    setLoading(true); setError(""); setLoaded(0)
    const all: PoRow[] = []
    for (let page = 0; ; page++) {
      const res = await fetch(`/api/po?from=${f}&to=${t}&field=${fld}&page=${page}`).catch(() => null)
      const d = res ? await res.json().catch(() => ({})) : {}
      if (id !== reqId.current) return
      if (!res || !res.ok) { setError(d?.error ?? "โหลดใบสั่งซื้อไม่สำเร็จ ลองใหม่อีกครั้ง"); setRows([]); setLoading(false); return }
      if (page === 0) setTotal(Number(d.total) || 0)
      all.push(...((d.rows ?? []) as PoRow[]))
      setLoaded(all.length)
      if ((d.rows ?? []).length < (d.pageSize ?? 1) || all.length >= Math.min(Number(d.total) || 0, PO_MAX_ROWS)) break
    }
    setRows(all); setLoading(false)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void load(from, to, field) }, 350)
    return () => clearTimeout(timer)
  }, [from, to, field, load])

  const searched = useMemo(() => filterPoRows(rows, { q }), [rows, q])
  const shown = useMemo(() => filterPoRows(searched, { statuses }), [searched, statuses])
  const counts = useMemo(() => {
    const c = Object.fromEntries(PO_STATUS_ORDER.map((k) => [k, 0])) as Record<PoStatusKey, number>
    for (const r of searched) c[r.statusKey]++
    return c
  }, [searched])
  const shownSum = useMemo(() => shown.reduce((a, r) => a + (r.statusKey === "cancel" ? 0 : r.total ?? 0), 0), [shown])
  const truncated = total > PO_MAX_ROWS

  const toggleStatus = (k: PoStatusKey) => {
    setLimit(PAGE)
    setStatuses((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  }

  const toggleRow = async (code: string) => {
    if (open === code) { setOpen(null); return }
    setOpen(code)
    const cur = itemState[code]
    if (cur && cur !== "error") return
    setItemState((m) => ({ ...m, [code]: "loading" }))
    const res = await fetch(`/api/po/items?codes=${encodeURIComponent(code)}`).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    setItemState((m) => ({
      ...m,
      [code]: res?.ok ? { items: (d.items?.[code] ?? []) as PoItem[], detailId: String(d.detailIds?.[code] ?? "") } : "error",
    }))
  }

  const exportExcel = async () => {
    if (exportPct !== null) return
    setExportPct(0)
    const r = await downloadPoExcel(shown, { from, to, field }, setExportPct)
    setExportPct(null)
    if (!r.ok) swalError(r.error)
  }

  const page = shown.slice(0, limit)
  const inputCls = "rounded-[10px] border border-[#EEF2F0] bg-white px-3 py-2 text-[13px] text-[#14271C] outline-none focus:border-[#1B8C4B] dark:border-white/10 dark:bg-[#151a10] dark:text-white"

  return (
    <div className="w-full px-3 py-5 sm:px-4 sm:py-6" style={sansThai}>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <ShoppingCart size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>ใบสั่งซื้อ (PO)</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">เลือกช่วงวันที่ แล้วดาวน์โหลด Excel ได้ทั้งหัวใบและรายการสินค้า</p>
          </div>
        </div>
        <button
          onClick={exportExcel}
          disabled={loading || !shown.length || exportPct !== null}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#157a40] disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-white/10"
        >
          <Download size={15} />
          {exportPct !== null ? `กำลังเตรียมไฟล์ ${exportPct}%` : `ดาวน์โหลด Excel · ${shown.length.toLocaleString("th-TH")} ใบ`}
        </button>
      </div>

      {/* ตัวกรองวันที่ */}
      <div className="mb-3 rounded-2xl border border-[#EEF2F0] bg-white p-3 dark:border-white/8 dark:bg-[#151a10] sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-[11px] font-medium text-[#6B7C72] dark:text-gray-400">นับจาก</p>
            <div className="inline-flex rounded-[10px] border border-[#EEF2F0] p-0.5 dark:border-white/10" role="group" aria-label="นับวันที่จาก">
              {(["po", "due"] as PoDateField[]).map((k) => (
                <button key={k} onClick={() => setField(k)} aria-pressed={field === k}
                  className={`min-h-[36px] rounded-[8px] px-3 text-[13px] font-medium transition ${field === k ? "bg-[#1B8C4B] text-white" : "text-[#4B5F54] hover:bg-[#F6FAF7] dark:text-gray-300 dark:hover:bg-white/5"}`}>
                  {PO_DATE_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-medium text-[#6B7C72] dark:text-gray-400">ตั้งแต่</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setRange([e.target.value, to])} className={`${inputCls} min-h-[40px]`} />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-medium text-[#6B7C72] dark:text-gray-400">ถึง</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setRange([from, e.target.value])} className={`${inputCls} min-h-[40px]`} />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const [pf, pt] = preset(p.key)
              const active = pf === from && pt === to
              return (
                <button key={p.key} onClick={() => setRange([pf, pt])} aria-pressed={active}
                  className={`min-h-[36px] rounded-full border px-3 text-[12px] font-medium transition ${active ? "border-[#1B8C4B] bg-[#EAF6EE] text-[#1B8C4B] dark:bg-[#1B8C4B]/15" : "border-[#EEF2F0] text-[#4B5F54] hover:border-[#CFE3D6] dark:border-white/10 dark:text-gray-300"}`}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ค้นหา + สถานะ */}
      <div className="sticky top-0 z-20 -mx-3 mb-3 space-y-2 bg-[#F7FBF8]/90 px-3 py-2 backdrop-blur-sm dark:bg-[#0f1411]/90 sm:-mx-4 sm:px-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }}
            placeholder="ค้น PO / PR / DD / ซัพพลายเออร์ / ทะเบียน / เบอร์รถ / หมายเหตุ PR"
            aria-label="ค้นหาใบสั่งซื้อ"
            className={`${inputCls} w-full pl-9 pr-9`}
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="ล้างคำค้น" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#9AA8A0] hover:text-[#14271C]">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PO_STATUS_ORDER.filter((k) => counts[k] > 0 || statuses.includes(k)).map((k) => {
            const on = statuses.includes(k)
            return (
              <button key={k} onClick={() => toggleStatus(k)} aria-pressed={on}
                className={`min-h-[32px] rounded-full border px-3 text-[12px] font-medium transition ${on ? "border-[#1B8C4B] bg-[#1B8C4B] text-white" : "border-[#EEF2F0] bg-white text-[#4B5F54] hover:border-[#CFE3D6] dark:border-white/10 dark:bg-[#151a10] dark:text-gray-300"}`}>
                {PO_STATUS_LABEL[k]} <span className="opacity-75">{counts[k].toLocaleString("th-TH")}</span>
              </button>
            )
          })}
          {statuses.length > 0 && (
            <button onClick={() => setStatuses([])} className="px-2 text-[12px] font-medium text-[#1B8C4B] hover:underline">ทุกสถานะ</button>
          )}
          <span className="ml-auto text-[12px] text-[#6B7C72] dark:text-gray-400" aria-live="polite">
            {loading
              ? `กำลังโหลด${loaded ? ` ${loaded.toLocaleString("th-TH")} / ${Math.min(total, PO_MAX_ROWS).toLocaleString("th-TH")} ใบ` : "…"}`
              : `${shown.length.toLocaleString("th-TH")} ใบ · ${baht(shownSum)} บาท`}
          </span>
        </div>
      </div>

      {truncated && !loading && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-[#F5D58A] bg-[#FEF7E6] px-3 py-2 text-[12px] text-[#92600A] dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          ช่วงนี้มี {total.toLocaleString("th-TH")} ใบ ระบบแสดงได้ {PO_MAX_ROWS.toLocaleString("th-TH")} ใบล่าสุด แบ่งช่วงวันที่ให้สั้นลงจะได้ครบทุกใบ
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 rounded-xl border border-[#F7CFCF] bg-[#FEECEC] px-3 py-2 text-[13px] text-[#B91C1C] dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* รายการ */}
      <div className="overflow-hidden rounded-2xl border border-[#EEF2F0] bg-white dark:border-white/8 dark:bg-[#151a10]">
        <div className="hidden grid-cols-[minmax(130px,1.1fr)_90px_90px_minmax(160px,2fr)_minmax(110px,1fr)_minmax(120px,1fr)_110px_100px_28px] gap-2 border-b border-[#EEF2F0] bg-[#F6FAF7] px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0] dark:border-white/8 dark:bg-[#1a1f16] lg:grid">
          <span>PO</span><span>วันที่ PO</span><span>กำหนดส่ง</span><span>ซัพพลายเออร์</span><span>ทะเบียน · เบอร์รถ</span>
          <span>PR · ผู้ขอซื้อ</span><span className="text-right">ยอดรวม</span><span>สถานะ</span><span />
        </div>
        {loading && !rows.length ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-b border-[#F1F5F2] px-3 py-3 dark:border-white/5"><div className="h-4 animate-pulse rounded bg-[#F0F4F1] dark:bg-white/5" /></div>
          ))
        ) : !shown.length ? (
          <p className="px-4 py-14 text-center text-[13px] text-[#9AA8A0]">
            {error ? "—" : rows.length ? "ไม่พบใบที่ตรงกับคำค้นหรือสถานะที่เลือก" : `ไม่มีใบสั่งซื้อที่${PO_DATE_LABELS[field]}อยู่ในช่วงนี้`}
          </p>
        ) : (
          page.map((r) => {
            const isOpen = open === r.code
            return (
              <article key={r.code} className="border-b border-[#F4F7F5] last:border-b-0 dark:border-white/5">
                <button onClick={() => toggleRow(r.code)} aria-expanded={isOpen}
                  className="block w-full px-3 py-2.5 text-left transition hover:bg-[#F7FBF8] dark:hover:bg-white/[0.03]">
                  {/* จอใหญ่ */}
                  <div className="hidden grid-cols-[minmax(130px,1.1fr)_90px_90px_minmax(160px,2fr)_minmax(110px,1fr)_minmax(120px,1fr)_110px_100px_28px] items-center gap-2 text-[12.5px] lg:grid">
                    <span className="truncate font-semibold text-[#1B8C4B]">{r.code}</span>
                    <span className="text-[#4B5F54] dark:text-gray-300">{poThaiDate(r.date)}</span>
                    <span className="text-[#4B5F54] dark:text-gray-300">{poThaiDate(r.due)}</span>
                    <span className="truncate text-[#14271C] dark:text-gray-100" title={r.supplier}>{r.supplier || "—"}</span>
                    <span className="truncate text-[#4B5F54] dark:text-gray-300">{r.vehicle || "—"}{r.fleetNo && <span className="text-[#9AA8A0]"> · {r.fleetNo}</span>}</span>
                    <span className="truncate text-[#4B5F54] dark:text-gray-300" title={r.requester}>{r.pr || "—"}{r.requester && <span className="block truncate text-[11px] text-[#9AA8A0]">{r.requester}</span>}</span>
                    <span className="text-right font-medium tabular-nums text-[#14271C] dark:text-white">{baht(r.total)}</span>
                    <span><StatusBadge r={r} /></span>
                    <ChevronDown size={16} className={`text-[#9AA8A0] transition ${isOpen ? "rotate-180" : ""}`} />
                  </div>
                  {/* มือถือ */}
                  <div className="lg:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-[#1B8C4B]">{r.code}</span>
                      <span className="font-semibold tabular-nums text-[#14271C] dark:text-white">{baht(r.total)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-[#14271C] dark:text-gray-100">{r.supplier || "—"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6B7C72] dark:text-gray-400">
                      <span>PO {poThaiDate(r.date)}</span>
                      <span>ส่ง {poThaiDate(r.due)}</span>
                      {(r.vehicle || r.fleetNo) && <span>{[r.vehicle, r.fleetNo].filter(Boolean).join(" · ")}</span>}
                      <StatusBadge r={r} />
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-[#EEF2F0] bg-[#FBFDFB] dark:border-white/8 dark:bg-white/[0.02]">
                    <Detail r={r} state={itemState[r.code]} />
                  </div>
                )}
              </article>
            )
          })
        )}
      </div>
      {shown.length > limit && (
        <div className="mt-3 text-center">
          <button onClick={() => setLimit((n) => n + PAGE * 2)}
            className="min-h-[40px] rounded-lg border border-[#1B8C4B] px-4 text-[13px] font-medium text-[#1B8C4B] hover:bg-[#EAF6EE] dark:hover:bg-[#1B8C4B]/10">
            แสดงเพิ่ม (เหลืออีก {(shown.length - limit).toLocaleString("th-TH")} ใบ)
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] text-[#9AA8A0]">
        ข้อมูลจาก ATMS อัปเดตทุกคืน · ยอดรวมด้านบนไม่นับใบที่ยกเลิก · Excel ได้ตามที่กรองอยู่ ชีตแรกเป็นหัวใบ ชีตที่สองเป็นรายการสินค้า
      </p>
    </div>
  )
}
