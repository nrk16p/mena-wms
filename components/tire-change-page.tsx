"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, RefreshCw, History, ChevronLeft, ChevronRight } from "lucide-react"
import Swal from "sweetalert2"
import { swalToast, swalError } from "@/lib/swal"

type TireChange = {
  _id:                string
  branch:             string
  vehicle:            string
  tirePosition:       string
  product:            string
  serialNo:           string
  treadMm:            number
  mileageStart:       number
  mileageEnd:         number
  maintenanceRequest: string
  changeIn:           string | null
  changeOut:          string | null
  isLatest:           boolean
  sellRepairStatus:   string
  updatedAt:          string | null
}

const fmtDate = (s: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const fmtNum = (n: number) => (n ?? 0).toLocaleString("th-TH")

export function TireChangePage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  type CronStatus = { ok: boolean; syncedAt: string | null; error: string | null; count: number } | null

  const [items, setItems]       = useState<TireChange[]>([])
  const [total, setTotal]       = useState(0)
  const [pages, setPages]       = useState(1)
  const [page, setPage]         = useState(1)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [cronStatus, setCronStatus] = useState<CronStatus>(null)
  const [loading, setLoading]   = useState(true)
  const [syncing, setSyncing]   = useState(false)
  const [q, setQ]               = useState("")
  const [latestFilter, setLatestFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ branch, page: String(page), limit: "100" })
    if (q)            qs.set("q", q)
    if (latestFilter) qs.set("latest", latestFilter)
    const res = await fetch(`/api/tire-change?${qs}`)
    const d   = await res.json()
    setItems(Array.isArray(d.items) ? d.items : [])
    setTotal(d.total ?? 0)
    setPages(d.pages ?? 1)
    setSyncedAt(d.syncedAt ?? null)
    setCronStatus(d.cronStatus ?? null)
    setLoading(false)
  }, [branch, q, latestFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, latestFilter])

  async function doSync(phpsessid?: string) {
    setSyncing(true)
    const res = await fetch("/api/tire-change/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch, ...(phpsessid ? { phpsessid } : {}) }),
    })
    setSyncing(false)
    const d = await res.json().catch(() => ({}))

    if (res.status === 401) {
      // session expired — ask for a fresh PHPSESSID and retry once
      const { value, isConfirmed } = await Swal.fire<string>({
        title: "Session หมดอายุ",
        text: "วาง PHPSESSID ใหม่จาก mena-atms.com (DevTools → Cookies)",
        input: "text",
        inputPlaceholder: "PHPSESSID",
        showCancelButton: true,
        confirmButtonText: "Sync",
        cancelButtonText: "ยกเลิก",
        reverseButtons: true,
      })
      if (isConfirmed && value?.trim()) await doSync(value.trim())
      return
    }
    if (!res.ok) {
      swalError(d.error ?? "Sync ไม่สำเร็จ")
      return
    }
    swalToast("success", `Sync สำเร็จ ${(d.count ?? 0).toLocaleString()} รายการ`)
    load()
  }

  const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
  const th  = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
  const td  = "px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap"

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <History size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Change History — {branchLabel}</h1>
        <span className="text-sm text-gray-400">({total.toLocaleString()} รายการ)</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          sync ล่าสุด: {syncedAt ? fmtDate(syncedAt) : "ยังไม่เคย sync"}
        </p>
        {/* Auto-sync status */}
        <div className="flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/4 px-2.5 py-1">
          <span className={`h-1.5 w-1.5 rounded-full ${cronStatus === null ? "bg-gray-300" : cronStatus.ok ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Auto-sync ทุก 6 ชั่วโมง
            {cronStatus?.syncedAt && (
              <> · ล่าสุด {fmtDate(cronStatus.syncedAt)}</>
            )}
            {cronStatus && !cronStatus.ok && (
              <span className="ml-1 text-red-500" title={cronStatus.error ?? ""}>· ⚠ Session หมดอายุ</span>
            )}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / Serial / สินค้า / เลขแจ้งซ่อม..." className={inp + " pl-8"} />
        </div>
        <select value={latestFilter} onChange={(e) => setLatestFilter(e.target.value)} className={inp + " max-w-[160px]"}>
          <option value="">— ทั้งหมด —</option>
          <option value="yes">ล่าสุด (yes)</option>
          <option value="no">ไม่ล่าสุด (no)</option>
        </select>
        <button
          onClick={() => doSync()}
          disabled={syncing}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3.5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "กำลัง Sync..." : "Sync from ATMS"}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>ยานพาหนะ</th>
                <th className={th}>ตำแหน่งยาง</th>
                <th className={th}>สินค้า</th>
                <th className={th}>Serial No</th>
                <th className={th + " text-right"}>มม.</th>
                <th className={th + " text-right"}>ไมล์เริ่มต้น</th>
                <th className={th + " text-right"}>ไมล์สิ้นสุด</th>
                <th className={th}>แจ้งซ่อม / ขอเปลี่ยนยาง</th>
                <th className={th}>เปลี่ยนเข้า</th>
                <th className={th}>เปลี่ยนออก</th>
                <th className={th}>ล่าสุด</th>
                <th className={th}>ส่ง ขาย / ซ่อม</th>
                <th className={th}>แก้ไขเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-sm text-gray-400">
                  ไม่พบรายการ — กด &quot;Sync from ATMS&quot; เพื่อดึงข้อมูล
                </td></tr>
              ) : items.map((t, i) => (
                <tr key={t._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                  <td className={td + " font-mono font-semibold text-gray-900 dark:text-white"}>{t.vehicle || "—"}</td>
                  <td className={td}>{t.tirePosition || "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.product || "—"}</td>
                  <td className={td + " font-mono"}>{t.serialNo || "—"}</td>
                  <td className={td + " text-right"}>{t.treadMm || "—"}</td>
                  <td className={td + " text-right"}>{fmtNum(t.mileageStart)}</td>
                  <td className={td + " text-right"}>{fmtNum(t.mileageEnd)}</td>
                  <td className={td + " font-mono"}>{t.maintenanceRequest || "—"}</td>
                  <td className={td}>{fmtDate(t.changeIn)}</td>
                  <td className={td}>{fmtDate(t.changeOut)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${t.isLatest ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"}`}>
                      {t.isLatest ? "yes" : "no"}
                    </span>
                  </td>
                  <td className={td}>{t.sellRepairStatus || "—"}</td>
                  <td className={td + " text-gray-500 dark:text-gray-400"}>{fmtDate(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-white/8 px-4 py-2.5">
            <span className="text-xs text-gray-400">หน้า {page} / {pages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40"
              >
                <ChevronLeft size={12} /> ก่อนหน้า
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40"
              >
                ถัดไป <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
