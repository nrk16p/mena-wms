"use client"

import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react"
import { AP_STATUSES, apStatusMeta, thaiDate, type ApStatus } from "@/lib/ap-tracking"
import { CARD, NUM, URGENCY, baht, bahtShort, mitr } from "@/components/ap-style"
import type { ApQuickView, ApSummary } from "@/components/ap-types"

// เลื่อนเดือนทีละก้าว — ผู้ใช้ทำงานเป็นรายเดือน การกดลูกศรเร็วกว่าการเปิด date picker ทุกครั้ง
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

// ลำดับก้อนบนแถบเงิน = ลำดับความเร่งด่วน อ่านจากซ้าย (ปลอดภัย) ไปขวา (ต้องจัดการ)
const SEGMENTS = [
  { key: "notDue", urgency: "ok" as const },
  { key: "due7",   urgency: "due7" as const },
  { key: "overdue", urgency: "overdue" as const },
  { key: "noTerm", urgency: "noTerm" as const },
]

export function ApSummaryBar({
  summary, loading, month, onMonth, q, onQ, onRefresh,
  fStatus, onStatus, quick, onQuick, warehouse, onWarehouse, warehouses,
}: {
  summary: ApSummary | null
  loading: boolean
  month: string
  onMonth: (ym: string) => void
  q: string
  onQ: (v: string) => void
  onRefresh: () => void
  fStatus: ApStatus | ""
  onStatus: (v: ApStatus | "") => void
  quick: ApQuickView
  onQuick: (v: ApQuickView) => void
  warehouse: string
  onWarehouse: (v: string) => void
  warehouses: string[]
}) {
  const aging   = summary?.unsentAging
  const unsent  = aging ? aging.notDue.amount + aging.due7.amount + aging.overdue.amount + aging.noTerm.amount : 0
  const unsentN = aging ? aging.notDue.n + aging.due7.n + aging.overdue.n + aging.noTerm.n : 0

  return (
    <div className="space-y-3">
      {/* หัวเรื่อง — ชื่อหน้า วันที่ข้อมูล และเครื่องมือประจำหน้าอยู่บรรทัดเดียว */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
          <div className="text-xs text-gray-400">
            {summary?.dataAsOf ? `ข้อมูล ATMS ล่าสุด ${thaiDate(summary.dataAsOf)}` : " "}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-gray-200/80 dark:border-white/10">
            <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="เดือนก่อนหน้า"
              className="rounded-l-xl px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[9rem] px-2 text-center text-sm font-medium">{monthLabel(month)}</span>
            <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป"
              className="rounded-r-xl px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5"><ChevronRight className="h-4 w-4" /></button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="ค้นหา DD / PO / ซัพพลายเออร์"
              className="w-64 rounded-xl border border-gray-200/80 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/10 dark:bg-white/5" />
          </div>

          <button onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-xl border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
          </button>
        </div>
      </div>

      {/* แถบเงิน — ยอดค้างทั้งก้อน แบ่งตามความเร่งด่วน คลิกก้อนไหนก็กรองด้วยความเร่งด่วนนั้น */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ค้างส่งบัญชี</div>
            <div className={`text-3xl font-bold text-[#14271C] dark:text-white ${NUM}`} style={mitr}>
              {summary ? baht(unsent) : "—"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{unsentN.toLocaleString("th-TH")} ใบ</div>
          </div>

          <button onClick={() => onQuick(quick === "urgent" ? "" : "urgent")}
            title="กรองเฉพาะใบที่เกินกำหนดหรือครบกำหนดใน 7 วัน"
            className={`rounded-xl px-3 py-2 text-left transition ${quick === "urgent" ? "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-950/30" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
            <div className="text-xs text-rose-600 dark:text-rose-400">⏰ เกินกำหนดเครดิต</div>
            <div className={`text-lg font-bold text-rose-600 dark:text-rose-400 ${NUM}`}>
              {summary ? baht(summary.overdue.amount) : "—"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{summary?.overdue.n ?? 0} ใบ</div>
          </button>

          <div className="rounded-xl px-3 py-2">
            <div className="text-xs text-emerald-700 dark:text-emerald-400">
              💸 เข้าโอนพฤหัสนี้ {summary ? `(${thaiDate(summary.thisThursday.date)})` : ""}
            </div>
            <div className={`text-lg font-bold text-emerald-700 dark:text-emerald-400 ${NUM}`}>
              {summary ? baht(summary.thisThursday.amount) : "—"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{summary?.thisThursday.n ?? 0} ใบ</div>
          </div>
        </div>

        {/* สัดส่วนยอดค้างตามความเร่งด่วน — ความกว้างของก้อน = สัดส่วนเงินจริง ไม่ใช่จำนวนใบ */}
        {aging && unsent > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              {SEGMENTS.map(({ key, urgency }) => {
                const b = aging[key as keyof typeof aging]
                const pct = (b.amount / unsent) * 100
                if (pct <= 0) return null
                return (
                  <div key={key} style={{ width: `${pct}%` }} className={URGENCY[urgency].bar}
                    title={`${URGENCY[urgency].label} · ${b.n} ใบ · ${baht(b.amount)}`} />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              {SEGMENTS.map(({ key, urgency }) => {
                const b = aging[key as keyof typeof aging]
                return (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${URGENCY[urgency].bar}`} />
                    {URGENCY[urgency].label} {bahtShort(b.amount)}
                    <span className="text-gray-400">· {b.n} ใบ</span>
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ตัวกรอง — สถานะของใบ (ซ้าย) แยกจากมุมมองงานประจำวัน (ขวา) ด้วยเส้นคั่น */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onStatus("")}
          className={`rounded-full border px-3 py-1 text-xs transition ${fStatus === "" ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
          ทั้งหมด {summary ? `· ${summary.counted}` : ""}
        </button>
        {AP_STATUSES.map((st) => {
          const m = apStatusMeta(st), v = summary?.byStatus[st]
          const on = fStatus === st
          return (
            <button key={st} onClick={() => onStatus(on ? "" : st)}
              className={`rounded-full border px-3 py-1 text-xs transition ${on ? `${m.cls} border-transparent ring-2 ring-offset-1 dark:ring-offset-[#0f1115]` : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
              {m.emoji} {st} {v ? <span className={NUM}>· {v.n}</span> : null}
            </button>
          )
        })}

        <span className="mx-1 hidden h-5 w-px bg-gray-200 dark:bg-white/10 sm:block" />

        <button onClick={() => onQuick(quick === "urgent" ? "" : "urgent")}
          className={`rounded-full border px-3 py-1 text-xs transition ${quick === "urgent" ? "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
          ⏰ ต้องรีบ
        </button>
        <button onClick={() => onQuick(quick === "review" ? "" : "review")}
          title="เอกสารครบแล้วแต่บัญชียังไม่ได้ตรวจ"
          className={`rounded-full border px-3 py-1 text-xs transition ${quick === "review" ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300" : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
          🔎 รอบัญชีตรวจ
        </button>

        <select value={warehouse} onChange={(e) => onWarehouse(e.target.value)}
          className="rounded-full border border-gray-200/80 bg-white px-3 py-1 text-xs dark:border-white/10 dark:bg-white/5">
          <option value="">ทุกคลัง</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
    </div>
  )
}
