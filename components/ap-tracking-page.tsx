"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Banknote, RefreshCw, Search } from "lucide-react"
import { swalError } from "@/lib/swal"
import {
  AP_DOC_FIELDS, apStatusMeta, thaiDate,
  type ApDocKey, type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

export type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; sentType: string; sentDate: string; note: string
  status: ApStatus; carryover: boolean
  poTotal: number; poDue: string; poStatus: string
}
type Summary = {
  total: number
  byStatus: Record<ApStatus, { n: number; amount: number }>
  overdue: { n: number; amount: number }
  thisThursday: { date: string; n: number; amount: number }
  unsentAging: { notDue: { n: number; amount: number }; due7: { n: number; amount: number }; overdue: { n: number; amount: number } }
  dataAsOf: string
}

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date().toISOString().slice(0, 7)

export function ApTrackingPage() {
  const [rows, setRows]       = useState<ApRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(thisMonth())
  const [warehouse, setWarehouse] = useState("")
  const [fStatus, setFStatus] = useState<ApStatus | "">("")
  const [q, setQ]             = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/ap-tracking?month=${month}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setRows(data.rows); setSummary(data.summary)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `โหลดข้อมูลไม่สำเร็จ: ${msg}` : "โหลดข้อมูลไม่สำเร็จ")
    } finally { setLoading(false) }
  }, [month])

  useEffect(() => { load() }, [load])

  // ติ๊ก/ยกเลิกติ๊กในตาราง — อัปเดตจอทันที แล้วค่อยยิง API (ผิดพลาดค่อยย้อนคืน)
  const toggleDoc = async (row: ApRow, key: ApDocKey) => {
    const next = !row.docs[key]?.checked
    const prev = rows
    setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
      ? { ...r, docs: { ...r.docs, [key]: { checked: next, by: "", at: "" } } } : r))
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs: { [key]: next } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, docs: data.docs, status: data.status } : r))
    } catch (e) {
      setRows(prev)
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    }
  }

  const shown = useMemo(() => {
    let out = rows
    if (fStatus)   out = out.filter((r) => r.status === fStatus)
    if (warehouse) out = out.filter((r) => r.warehouse === warehouse)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      out = out.filter((r) => rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier))
    }
    return out
  }, [rows, fStatus, warehouse, q])

  const warehouses = useMemo(
    () => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort(),
    [rows],
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Banknote className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
        {summary?.dataAsOf && (
          <span className="text-xs text-gray-500 dark:text-gray-400">ข้อมูล ATMS ล่าสุด {thaiDate(summary.dataAsOf)}</span>
        )}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
        </button>
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5" />
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm bg-white dark:bg-white/5">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา DD / PO / ซัพพลายเออร์"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-64 bg-white dark:bg-white/5" />
        </div>
        {fStatus && (
          <button onClick={() => setFStatus("")} className="text-xs text-blue-600 hover:underline">ล้างตัวกรองสถานะ</button>
        )}
        <span className="ml-auto text-sm text-gray-500">{shown.length} ใบ · {baht(shown.reduce((s, r) => s + r.amount, 0))} บาท</span>
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto rounded-xl border dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">DD · วันรับ</th>
              <th className="px-3 py-2 text-left">PO</th>
              <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
              <th className="px-3 py-2 text-right">ยอดเงิน</th>
              <th className="px-3 py-2 text-left">ครบกำหนด</th>
              {AP_DOC_FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2 text-center whitespace-nowrap" title={f.label}>{f.short}</th>
              ))}
              <th className="px-3 py-2 text-left">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const meta = apStatusMeta(r.status)
              return (
                <tr key={r.depositCode}
                  className={`border-t dark:border-white/10 ${r.overdue > 0 ? "bg-rose-50/60 dark:bg-rose-950/20" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-medium">{r.depositCode}</div>
                    <div className="text-xs text-gray-500">
                      {thaiDate(r.receivedAt)}{r.carryover && <span className="ml-1 text-amber-600">ค้างยกมา</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{r.purchaseOrder || "—"}</td>
                  <td className="px-3 py-2 max-w-[260px]">
                    <div className="truncate" title={r.supplier}>{r.supplier}</div>
                    <div className="text-xs text-gray-500">{r.creditTerm || "ยังไม่ตั้งเครดิต"}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{baht(r.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.dueDate ? thaiDate(r.dueDate) : "—"}
                    {r.overdue > 0 && <div className="text-rose-600 font-medium">⏰ เกิน {r.overdue} วัน</div>}
                  </td>
                  {AP_DOC_FIELDS.map((f) => (
                    <td key={f.key} className="px-2 py-2 text-center">
                      <input type="checkbox" checked={Boolean(r.docs[f.key]?.checked)}
                        onChange={() => toggleDoc(r, f.key)}
                        title={r.docs[f.key]?.by ? `${r.docs[f.key]!.by} · ${thaiDate((r.docs[f.key]!.at || "").slice(0, 10))}` : f.label}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
                      {meta.emoji} {meta.value}
                    </span>
                    {r.sentDate && <div className="text-xs text-gray-500 mt-0.5">{r.sentType} {thaiDate(r.sentDate)}</div>}
                  </td>
                </tr>
              )
            })}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">ไม่พบรายการ</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
