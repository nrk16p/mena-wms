"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Banknote, RefreshCw, Search } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, AP_STATUSES, apStatusMeta, nextThursday, thaiDate,
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
  const [sentFor, setSentFor] = useState<ApRow | null>(null)

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

  // บันทึกวันส่งบัญชี — นอกรอบ = โอนทุกวันพฤหัส · ตามรอบ = วันที่ส่งเอกสาร
  const setSent = async (row: ApRow, type: "" | "นอกรอบ" | "ตามรอบ", date: string) => {
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentType: type, sentDate: date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode
        ? { ...r, sentType: data.sentType, sentDate: data.sentDate, status: data.status, overdue: data.sentDate ? 0 : r.overdue } : r))
      setSentFor(null)
      swalToast("success", date ? `ส่งบัญชี ${type} ${thaiDate(date)}` : "ยกเลิกการส่งบัญชีแล้ว")
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    }
  }

  const saveNote = async (row: ApRow, note: string) => {
    if (note === row.note) return
    try {
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "บันทึกไม่สำเร็จ")
      setRows((rs) => rs.map((r) => r.depositCode === row.depositCode ? { ...r, note: data.note } : r))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกหมายเหตุไม่สำเร็จ: ${msg}` : "บันทึกหมายเหตุไม่สำเร็จ")
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

      {/* แถบสรุป — คลิก chip เพื่อกรอง */}
      {summary && (
        <div className="flex flex-wrap gap-2">
          {AP_STATUSES.map((st) => {
            const m = apStatusMeta(st), v = summary.byStatus[st]
            const on = fStatus === st
            return (
              <button key={st} onClick={() => setFStatus(on ? "" : st)}
                className={`rounded-xl border px-3 py-2 text-left transition ${on ? "ring-2 ring-offset-1" : ""} ${m.cls}`}>
                <div className="text-xs">{m.emoji} {st}</div>
                <div className="text-sm font-bold">{v.n} ใบ · {baht(v.amount)}</div>
              </button>
            )
          })}
          <div className="rounded-xl border px-3 py-2 bg-rose-50 dark:bg-rose-950/20">
            <div className="text-xs text-rose-700 dark:text-rose-300">⏰ เกินกำหนดเครดิต</div>
            <div className="text-sm font-bold text-rose-700 dark:text-rose-300">{summary.overdue.n} ใบ · {baht(summary.overdue.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">💸 เข้าโอนพฤหัสนี้ ({thaiDate(summary.thisThursday.date)})</div>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{summary.thisThursday.n} ใบ · {baht(summary.thisThursday.amount)}</div>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <div className="text-xs text-gray-500">ยอดค้างส่งบัญชี (ยังไม่ครบกำหนด / ≤7 วัน / เกิน)</div>
            <div className="text-sm font-bold">
              {baht(summary.unsentAging.notDue.amount)} · {baht(summary.unsentAging.due7.amount)} ·{" "}
              <span className="text-rose-600">{baht(summary.unsentAging.overdue.amount)}</span>
            </div>
          </div>
        </div>
      )}

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
              <th className="px-3 py-2 text-left">ส่งบัญชี</th>
              <th className="px-3 py-2 text-left">หมายเหตุ</th>
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => setSentFor(r)}
                      className={`rounded-lg border px-2 py-1 text-xs ${r.sentDate ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                      {r.sentDate ? `✅ ${r.sentType} ${thaiDate(r.sentDate)}` : "ส่งบัญชี"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <input defaultValue={r.note} placeholder="—"
                      onBlur={(e) => saveNote(r, e.target.value.trim())}
                      className="w-40 rounded border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-gray-300 focus:border-gray-400 focus:bg-white dark:focus:bg-white/10" />
                  </td>
                </tr>
              )
            })}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-10 text-center text-gray-400">ไม่พบรายการ</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSentFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#161a23] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold" style={mitr}>ส่งบัญชี · {sentFor.depositCode}</div>
            <div className="text-xs text-gray-500">{sentFor.supplier} · {baht(sentFor.amount)} บาท</div>

            <div className="space-y-2">
              <div className="text-sm font-medium">💸 นอกรอบ (โอนทุกวันพฤหัส)</div>
              <div className="flex gap-2">
                <button onClick={() => setSent(sentFor, "นอกรอบ", nextThursday(new Date().toISOString().slice(0, 10)))}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  พฤหัสนี้ {thaiDate(nextThursday(new Date().toISOString().slice(0, 10)))}
                </button>
                <button onClick={() => {
                  const thu = nextThursday(new Date().toISOString().slice(0, 10))
                  const [y, m, d] = thu.split("-").map(Number)
                  setSent(sentFor, "นอกรอบ", new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10))
                }}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                  พฤหัสหน้า
                </button>
              </div>

              <div className="text-sm font-medium pt-2">📋 ตามรอบ (วันที่ส่งเอกสาร)</div>
              <input type="date" defaultValue={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && setSent(sentFor, "ตามรอบ", e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-sm bg-white dark:bg-white/5" />
            </div>

            <div className="flex justify-between pt-2">
              {sentFor.sentDate && (
                <button onClick={() => setSent(sentFor, "", "")} className="text-xs text-rose-600 hover:underline">ยกเลิกการส่งบัญชี</button>
              )}
              <button onClick={() => setSentFor(null)} className="ml-auto rounded-lg border px-3 py-1.5 text-sm">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
