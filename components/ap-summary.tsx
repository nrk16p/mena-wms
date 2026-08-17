"use client"

import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react"
import { AP_STAGES, thaiDate } from "@/lib/ap-tracking"
import { NUM, mitr } from "@/components/ap-style"
import type { ApSummary, ApTab } from "@/components/ap-types"

// เลื่อนเดือนทีละก้าว — ผู้ใช้ทำงานเป็นรายเดือน กดลูกศรเร็วกว่าเปิด date picker ทุกครั้ง
function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  return `${TH_MONTHS[(m || 1) - 1]} ${((y || 0) + 543) % 100}`
}

export function ApHeader({
  summary, loading, month, onMonth, q, onQ, onRefresh,
  tab, onTab, warehouse, onWarehouse, warehouses, totalShown,
}: {
  summary: ApSummary | null
  loading: boolean
  month: string
  onMonth: (ym: string) => void
  q: string
  onQ: (v: string) => void
  onRefresh: () => void
  tab: ApTab
  onTab: (v: ApTab) => void
  warehouse: string
  onWarehouse: (v: string) => void
  warehouses: string[]
  totalShown: number
}) {
  return (
    <div>
      {/* แถบหัวเรื่อง — ชื่อหน้า วันที่ข้อมูล และตัวกรองทั้งหมดอยู่บรรทัดเดียว */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
          <div className="text-[11px] text-gray-400">
            {summary?.dataAsOf ? `ข้อมูล ATMS ล่าสุด ${thaiDate(summary.dataAsOf)}` : " "}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-white/10">
            <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="เดือนก่อนหน้า"
              className="rounded-l-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[8.5rem] px-2 text-center text-sm">{monthLabel(month)}</span>
            <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป"
              className="rounded-r-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5"><ChevronRight className="h-4 w-4" /></button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="ค้นหา DD / PO / เจ้าหนี้"
              className="w-56 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/10 dark:bg-white/5" />
          </div>

          <select value={warehouse} onChange={(e) => onWarehouse(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5">
            <option value="">ทุกคลัง</option>
            {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>

          <button onClick={onRefresh} aria-label="รีเฟรช"
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* แท็บ = ขั้นของงาน · เส้นใต้แบบ underline ไม่ใช่ pill ให้อ่านเป็นแถบเดียวกับตารางข้างล่าง */}
      <div className="flex flex-wrap items-end gap-1 border-b border-gray-200 dark:border-white/10">
        {AP_STAGES.map((s) => {
          const v = summary?.byStage?.[s.key]
          const on = tab === s.key
          return (
            <button key={s.key} onClick={() => onTab(on ? "" : s.key)} title={s.hint}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${on
                ? "border-[#14271C] font-medium text-[#14271C] dark:border-white dark:text-white"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
              <span className={`text-xs ${on ? "text-gray-500 dark:text-gray-300" : "text-gray-400"} ${NUM}`}>
                {v ? v.n.toLocaleString("th-TH") : 0}
              </span>
            </button>
          )
        })}
        <span className={`ml-auto pb-2 pr-1 text-xs text-gray-400 ${NUM}`}>
          {tab ? `${totalShown.toLocaleString("th-TH")} ใบในแท็บนี้` : `ทั้งหมด ${totalShown.toLocaleString("th-TH")} ใบ`}
        </span>
      </div>
    </div>
  )
}
