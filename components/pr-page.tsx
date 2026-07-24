"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText, Search, RefreshCw, PackageX, Wallet, ClipboardList, X } from "lucide-react"

type Cmp = "ok" | "anomaly" | "no_po"
type VatRule = "incl" | "excl"
type Relation = "eq" | "po7" | "other" | "none"
type Row = {
  pr_code: string
  date: string
  warehouse: string
  dept: string
  plate: string
  requester: string
  total: number
  po_total: number
  po_diff: number
  vat_rule: VatRule
  relation: Relation
  cmp: Cmp
  note: string
  po_codes: string[]
  po_count: number
  received_status: string[]
  suppliers: string[]
  pos: PoDetail[]
}
type PoDetail = { code: string; date: string; supplier: string; total: number; received: string; approver: string }
type ApiResp = { count: number; total_value: number; no_po: number; by_cmp: Record<Cmp, number>; rows: Row[] }

const CMP_META: Record<Cmp, { label: string; cls: string; dot: string }> = {
  ok:      { label: "ถูกต้อง",   cls: "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300",  dot: "#15803D" },
  anomaly: { label: "ผิดปกติ",   cls: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",     dot: "#DC2626" },
  no_po:   { label: "ยังไม่มี PO", cls: "bg-[#FEF3C7] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300", dot: "#B07D12" },
}
const CMP_ORDER: Cmp[] = ["ok", "anomaly", "no_po"]
// กฎที่คาดหวังต่อสาขา (แสดงเป็น hint)
const RULE_LABEL: Record<VatRule, string> = { incl: "คาด PR=PO", excl: "คาด PO=+7%" }

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

// "24/07/2026" → วันที่ไทยสั้น
function fmtDate(d: string) {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return d || "—"
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  return `${+m[1]} ${months[+m[2] - 1]} ${(+m[3] + 543) % 100}`
}

export function PrPage() {
  const [data, setData]       = useState<ApiResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [warehouse, setWarehouse] = useState("")
  const [dept, setDept]       = useState("")
  const [cmpFilter, setCmpFilter] = useState<Cmp | "">("")
  const [page, setPage]       = useState(1)
  const [detail, setDetail]   = useState<Row | null>(null)
  const PAGE_SIZE = 25

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/pr", { cache: "no-store" })
      const d   = await res.json()
      setData(d?.rows ? d : { count: 0, total_value: 0, no_po: 0, by_cmp: { ok: 0, anomaly: 0, no_po: 0 }, rows: [] })
    } catch {
      setData({ count: 0, total_value: 0, no_po: 0, by_cmp: { ok: 0, anomaly: 0, no_po: 0 }, rows: [] })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const rows = data?.rows ?? []
  const warehouses = useMemo(() => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])
  const depts      = useMemo(() => [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])

  // กรองด้วย ค้นหา/คลัง/แผนก ก่อน (ใช้คำนวณตัวเลขสรุปสถานะ)
  const baseFiltered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (warehouse && r.warehouse !== warehouse) return false
      if (dept && r.dept !== dept) return false
      if (!kw) return true
      return [r.pr_code, r.plate, r.requester, r.note, r.warehouse, r.dept, ...r.po_codes]
        .join(" ").toLowerCase().includes(kw)
    })
  }, [rows, q, warehouse, dept])

  const cmpCounts = useMemo(() => {
    const c: Record<Cmp, number> = { ok: 0, anomaly: 0, no_po: 0 }
    for (const r of baseFiltered) c[r.cmp]++
    return c
  }, [baseFiltered])

  // แล้วค่อยกรองตามสถานะสรุปที่เลือก
  const filtered = useMemo(
    () => (cmpFilter ? baseFiltered.filter((r) => r.cmp === cmpFilter) : baseFiltered),
    [baseFiltered, cmpFilter]
  )

  const sumValue = useMemo(() => filtered.reduce((a, r) => a + (r.total || 0), 0), [filtered])
  const noPo     = cmpCounts.no_po

  // pagination — รีเซ็ตหน้าเมื่อค้นหา/กรองเปลี่ยน
  useEffect(() => { setPage(1) }, [q, warehouse, dept, cmpFilter])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage    = Math.min(page, totalPages)
  const pageRows   = useMemo(() => filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE), [filtered, curPage])

  return (
    <div className="max-w-[1100px] mx-auto flex flex-col gap-4" style={sansThai}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>การจัดการ PR</h1>
            <p className="text-[12.5px] text-[#6B7C72] dark:text-gray-400">PR ที่อนุมัติแล้ว แต่ยัง<b>ไม่มีการรับของ (ไม่มี DD)</b></p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#EEF2F0] dark:border-white/10 px-3 py-2 text-[13px] text-[#4B5F54] dark:text-gray-300 hover:bg-[#F6FAF7] dark:hover:bg-white/5"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> รีเฟรช
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <ClipboardList size={16} />, label: "PR รออยู่", value: loading ? "—" : filtered.length.toLocaleString() },
          { icon: <Wallet size={16} />,        label: "มูลค่ารวม (บาท)", value: loading ? "—" : baht(sumValue) },
          { icon: <PackageX size={16} />,      label: "ยังไม่มี PO", value: loading ? "—" : noPo.toLocaleString() },
        ].map((c) => (
          <div key={c.label} className="rounded-[14px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10] p-[14px_16px]" style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
            <div className="flex items-center gap-2 text-[#1B8C4B] mb-1.5">{c.icon}<span className="text-[12px] text-[#6B7C72] dark:text-[#9AA8A0]">{c.label}</span></div>
            <p className="text-[22px] leading-none text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 600 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา PR / ทะเบียน / ผู้ขอซื้อ / PO / หมายเหตุ"
            className="w-full rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] pl-9 pr-3 py-2 text-[13px] text-[#14271C] dark:text-white outline-none focus:border-[#CFE3D6]"
          />
        </div>
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] px-3 py-2 text-[13px] text-[#4B5F54] dark:text-gray-300 max-w-[200px]">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-[10px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] px-3 py-2 text-[13px] text-[#4B5F54] dark:text-gray-300 max-w-[200px]">
          <option value="">ทุกแผนก</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* สรุปสถานะ PR↔PO (คลิกเพื่อกรอง) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-[#9AA8A0]">สถานะ PR↔PO:</span>
        <button
          onClick={() => setCmpFilter("")}
          className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${cmpFilter === "" ? "bg-[#1B8C4B] text-white" : "bg-[#F0F4F1] text-[#4B5F54] dark:bg-white/5 dark:text-gray-300 hover:bg-[#E6EDE8]"}`}
        >
          ทั้งหมด {baseFiltered.length}
        </button>
        {CMP_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setCmpFilter(cmpFilter === k ? "" : k)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition ${CMP_META[k].cls} ${cmpFilter === k ? "ring-2 ring-offset-1 ring-[#14271C]/30 dark:ring-white/30 dark:ring-offset-[#0f1117]" : "opacity-90 hover:opacity-100"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CMP_META[k].dot }} />
            {CMP_META[k].label} {cmpCounts[k]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10]" style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
        <table className="w-full min-w-[1160px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">
              <th className="px-4 py-2.5">PR</th>
              <th className="px-3 py-2.5">วันที่</th>
              <th className="px-3 py-2.5">คลัง · แผนก</th>
              <th className="px-3 py-2.5">ทะเบียน</th>
              <th className="px-3 py-2.5">ผู้ขอซื้อ</th>
              <th className="px-3 py-2.5 text-right">ยอด PR</th>
              <th className="px-3 py-2.5 text-right">ยอด PO</th>
              <th className="px-3 py-2.5">สถานะ PR↔PO</th>
              <th className="px-3 py-2.5">PO / สถานะรับ</th>
              <th className="px-4 py-2.5">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F2] dark:border-white/5">
                  <td colSpan={10} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-[#F0F4F1] dark:bg-white/5" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-14 text-center text-[13px] text-[#9AA8A0]">ไม่พบ PR ที่อนุมัติแล้วและยังไม่มีการรับของ</td></tr>
            ) : pageRows.map((r) => (
              <tr key={r.pr_code} onClick={() => setDetail(r)} className="cursor-pointer border-b border-[#F4F7F5] dark:border-white/5 hover:bg-[#F7FBF8] dark:hover:bg-white/[0.03] align-top">
                <td className="px-4 py-3">
                  <span className="font-semibold text-[#1B8C4B] hover:underline">{r.pr_code}</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{fmtDate(r.date)}</td>
                <td className="px-3 py-3 text-[#4B5F54] dark:text-gray-400">
                  <div className="text-[#14271C] dark:text-gray-200">{r.warehouse || "—"}</div>
                  <div className="text-[11px] text-[#9AA8A0]">{r.dept || "—"}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap font-medium text-[#14271C] dark:text-white">{r.plate || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{r.requester || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-right font-semibold text-[#14271C] dark:text-white">{baht(r.total || 0)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-right text-[#4B5F54] dark:text-gray-300">{r.po_count === 0 ? "—" : baht(r.po_total || 0)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CMP_META[r.cmp].cls}`}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: CMP_META[r.cmp].dot }} />
                    {CMP_META[r.cmp].label}
                  </span>
                  {r.cmp !== "no_po" && (
                    <div className="mt-0.5 text-[10px] text-[#9AA8A0]">
                      {RULE_LABEL[r.vat_rule]}
                      {r.cmp === "anomaly" && <span className="ml-1 text-[#DC2626] dark:text-red-400">· ต่าง {r.po_diff > 0 ? "+" : ""}{baht(r.po_diff)}</span>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.po_count === 0 ? (
                    <span className="inline-flex items-center rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">ยังไม่มี PO</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {r.po_codes.map((po, i) => (
                        <span key={po} className="whitespace-nowrap">
                          <span className="text-[#14271C] dark:text-gray-200">{po}</span>
                          {r.received_status[i] && <span className="ml-1 text-[10px] text-[#9AA8A0]">· {r.received_status[i]}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 max-w-[260px]">
                  <div className="line-clamp-2 text-[11.5px] text-[#6B7C72] dark:text-gray-400" title={r.note}>{r.note || "—"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-[#6B7C72] dark:text-gray-400">
          <span>
            แสดง {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, filtered.length)} จาก {filtered.length.toLocaleString()} รายการ
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={curPage <= 1}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-2.5 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={curPage <= 1}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >ก่อนหน้า</button>
            <span className="px-2 font-medium text-[#14271C] dark:text-white">{curPage} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={curPage >= totalPages}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >ถัดไป</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={curPage >= totalPages}
              className="rounded-[8px] border border-[#EEF2F0] dark:border-white/10 px-2.5 py-1.5 disabled:opacity-40 enabled:hover:bg-[#F6FAF7] dark:enabled:hover:bg-white/5"
            >»</button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-[#9AA8A0]">
        * &quot;อนุมัติแล้ว&quot; = คอลัมน์ is approved บน ATMS (✓) · &quot;ไม่มี DD&quot; = ไม่มีใบฝากของ (deposit) อ้างถึง PO ของ PR นี้ ·
        ข้อมูลจาก atms.purchase_requests / purchase_orders / deposit_header (scrape ล่าสุด)
      </p>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => setDetail(null)}>
          <div
            className="w-full max-w-[720px] rounded-[18px] bg-white dark:bg-[#151a10] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#EEF2F0] dark:border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]"><FileText size={18} /></div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[16px] font-bold text-[#14271C] dark:text-white" style={mitr}>{detail.pr_code}</h2>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CMP_META[detail.cmp].cls}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: CMP_META[detail.cmp].dot }} />{CMP_META[detail.cmp].label}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#9AA8A0]">{fmtDate(detail.date)} · {detail.warehouse || "—"}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1.5 text-[#9AA8A0] hover:bg-[#F0F4F1] dark:hover:bg-white/5"><X size={18} /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
              {/* PR info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-3">
                {[
                  ["แผนก", detail.dept], ["ทะเบียน", detail.plate], ["ผู้ขอซื้อ", detail.requester],
                ].map(([k, v]) => (
                  <div key={k}><div className="text-[10.5px] uppercase text-[#9AA8A0]">{k}</div><div className="text-[#14271C] dark:text-gray-200">{v || "—"}</div></div>
                ))}
              </div>

              {/* comparison */}
              <div className="rounded-[12px] border border-[#EEF2F0] dark:border-white/10 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[#14271C] dark:text-white">เทียบยอด PR ↔ PO</span>
                  <span className="text-[11px] text-[#9AA8A0]">{detail.vat_rule === "incl" ? "สาขา VAT รวมใน PR (คาด PR = PO)" : "สาขา PR ไม่รวม VAT (คาด PO = PR + 7%)"}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ยอด PR</div><div className="text-[15px] font-semibold text-[#14271C] dark:text-white" style={mitr}>{baht(detail.total)}</div></div>
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ยอด PO รวม</div><div className="text-[15px] font-semibold text-[#14271C] dark:text-white" style={mitr}>{detail.po_count ? baht(detail.po_total) : "—"}</div></div>
                  <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 py-2"><div className="text-[10px] text-[#9AA8A0]">ส่วนต่าง</div><div className={`text-[15px] font-semibold ${detail.cmp === "anomaly" ? "text-[#DC2626]" : "text-[#14271C] dark:text-white"}`} style={mitr}>{detail.po_count ? `${detail.po_diff > 0 ? "+" : ""}${baht(detail.po_diff)}` : "—"}</div></div>
                </div>
              </div>

              {/* PO list */}
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-[#14271C] dark:text-white">ใบสั่งซื้อ (PO) · {detail.po_count} รายการ</div>
                {detail.po_count === 0 ? (
                  <div className="rounded-[10px] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">ยังไม่มี PO สำหรับ PR นี้</div>
                ) : (
                  <div className="overflow-x-auto rounded-[10px] border border-[#EEF2F0] dark:border-white/10">
                    <table className="w-full min-w-[520px] text-[12px]">
                      <thead><tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[10px] uppercase text-[#9AA8A0]">
                        <th className="px-3 py-2">PO</th><th className="px-3 py-2">วันที่</th><th className="px-3 py-2">ซัพพลายเออร์</th><th className="px-3 py-2 text-right">ยอด</th><th className="px-3 py-2">สถานะรับ</th>
                      </tr></thead>
                      <tbody>
                        {detail.pos.map((po) => (
                          <tr key={po.code} className="border-b border-[#F4F7F5] dark:border-white/5">
                            <td className="px-3 py-2 font-medium text-[#14271C] dark:text-gray-200">{po.code}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{fmtDate(po.date)}</td>
                            <td className="px-3 py-2 text-[#4B5F54] dark:text-gray-400">{po.supplier || "—"}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-right font-semibold text-[#14271C] dark:text-white">{baht(po.total)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-[11px] text-[#9AA8A0]">{po.received || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* note */}
              {detail.note && (
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-[#14271C] dark:text-white">หมายเหตุ</div>
                  <p className="whitespace-pre-wrap rounded-[10px] bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 text-[12px] text-[#4B5F54] dark:text-gray-300">{detail.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
