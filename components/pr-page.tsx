"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FileText, Search, RefreshCw, PackageX, Wallet, ClipboardList } from "lucide-react"

type Row = {
  pr_code: string
  date: string
  warehouse: string
  dept: string
  plate: string
  requester: string
  total: number
  note: string
  po_codes: string[]
  po_count: number
  received_status: string[]
  suppliers: string[]
}
type ApiResp = { count: number; total_value: number; no_po: number; rows: Row[] }

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

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/pr", { cache: "no-store" })
      const d   = await res.json()
      setData(d?.rows ? d : { count: 0, total_value: 0, no_po: 0, rows: [] })
    } catch {
      setData({ count: 0, total_value: 0, no_po: 0, rows: [] })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const rows = data?.rows ?? []
  const warehouses = useMemo(() => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])
  const depts      = useMemo(() => [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th")), [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (warehouse && r.warehouse !== warehouse) return false
      if (dept && r.dept !== dept) return false
      if (!kw) return true
      return [r.pr_code, r.plate, r.requester, r.note, r.warehouse, r.dept, ...r.po_codes]
        .join(" ").toLowerCase().includes(kw)
    })
  }, [rows, q, warehouse, dept])

  const sumValue = useMemo(() => filtered.reduce((a, r) => a + (r.total || 0), 0), [filtered])
  const noPo     = useMemo(() => filtered.filter((r) => r.po_count === 0).length, [filtered])

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

      {/* Table */}
      <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10]" style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">
              <th className="px-4 py-2.5">PR</th>
              <th className="px-3 py-2.5">วันที่</th>
              <th className="px-3 py-2.5">คลัง · แผนก</th>
              <th className="px-3 py-2.5">ทะเบียน</th>
              <th className="px-3 py-2.5">ผู้ขอซื้อ</th>
              <th className="px-3 py-2.5 text-right">รวม (บาท)</th>
              <th className="px-3 py-2.5">PO / สถานะรับ</th>
              <th className="px-4 py-2.5">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F2] dark:border-white/5">
                  <td colSpan={8} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-[#F0F4F1] dark:bg-white/5" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-14 text-center text-[13px] text-[#9AA8A0]">ไม่พบ PR ที่อนุมัติแล้วและยังไม่มีการรับของ</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.pr_code} className="border-b border-[#F4F7F5] dark:border-white/5 hover:bg-[#F7FBF8] dark:hover:bg-white/[0.03] align-top">
                <td className="px-4 py-3">
                  <Link href={`/procurement-search?q=${encodeURIComponent(r.pr_code)}`} className="font-semibold text-[#1B8C4B] hover:underline">{r.pr_code}</Link>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{fmtDate(r.date)}</td>
                <td className="px-3 py-3 text-[#4B5F54] dark:text-gray-400">
                  <div className="text-[#14271C] dark:text-gray-200">{r.warehouse || "—"}</div>
                  <div className="text-[11px] text-[#9AA8A0]">{r.dept || "—"}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap font-medium text-[#14271C] dark:text-white">{r.plate || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-[#4B5F54] dark:text-gray-400">{r.requester || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-right font-semibold text-[#14271C] dark:text-white">{baht(r.total || 0)}</td>
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

      <p className="text-[11px] text-[#9AA8A0]">
        * &quot;อนุมัติแล้ว&quot; = คอลัมน์ is approved บน ATMS (✓) · &quot;ไม่มี DD&quot; = ไม่มีใบฝากของ (deposit) อ้างถึง PO ของ PR นี้ ·
        ข้อมูลจาก atms.purchase_requests / purchase_orders / deposit_header (scrape ล่าสุด)
      </p>
    </div>
  )
}
