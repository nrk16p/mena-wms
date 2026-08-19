"use client"

import { CalendarRange, ChevronLeft, ChevronRight, CloudDownload, FileDown, RefreshCw, Search } from "lucide-react"
import { AP_STAGES, apRangeOf, thaiDate, type ApRangePreset } from "@/lib/ap-tracking"
import { NUM as NUMCLS } from "@/components/ap-style"
import type { ApCrossHit } from "@/components/ap-types"
import { NUM, mitr } from "@/components/ap-style"
import { WarehouseCombobox } from "@/components/warehouse-combobox"
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

// ปุ่มลัดของแถบวันที่กดส่ง — ป้ายกับช่วงที่คำนวณต้องมาจากที่เดียวกัน (apRangeOf) ไม่งั้นป้ายกับผลลัพธ์เพี้ยนกัน
const SENT_PRESETS: { key: ApRangePreset; label: string }[] = [
  { key: "today", label: "วันนี้" },
  { key: "7d",    label: "7 วันล่าสุด" },
  { key: "month", label: "เดือนนี้" },
]

export function ApHeader({
  summary, loading, month, onMonth, q, onQ, onRefresh,
  tab, onTab, warehouse, onWarehouse, warehouses, totalShown,
  sentView, sentFrom, sentTo, onSentRange, groupSent, onGroupSent, sentDays, today,
  canPull, pulling, pullProgress, onPull,
  crossHits, onGotoHit,
  viewBy, onViewBy,
  payTypeFilter, onPayTypeFilter, onExport,
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
  // แถบ "วันที่จัดซื้อกดส่งบัญชี" — โผล่เฉพาะแท็บที่ใบผ่านการกดส่งมาแล้ว (sent/passed/rejected)
  sentView: boolean
  sentFrom: string
  sentTo: string
  onSentRange: (from: string, to: string) => void
  groupSent: boolean
  onGroupSent: (v: boolean) => void
  sentDays: number
  today: string
  // ปุ่มดึงข้อมูลสดจาก ATMS — โชว์เฉพาะเดือนปัจจุบัน (pipeline ดึง 30 วันล่าสุด
  // กดตอนเปิดเดือนเก่าแล้วข้อมูลเดือนนั้นไม่เปลี่ยน จะเข้าใจผิดว่าระบบพัง)
  canPull: boolean
  pulling: boolean
  pullProgress: number
  onPull: () => void
  // ผลค้นข้ามเดือน (โผล่เมื่อเดือนที่เปิดอยู่หาไม่เจอ) — กดแล้วกระโดดไปเดือนของใบนั้น
  crossHits: ApCrossHit[] | null
  onGotoHit: (hit: ApCrossHit) => void
  // มุมมองตาราง: รายใบ / รายเจ้าหนี้ — สลับที่ปลายแถบแท็บเพราะเป็นแกนการมองของตารางเดียวกัน
  viewBy: "invoice" | "supplier"
  onViewBy: (v: "invoice" | "supplier") => void
  // filter ย่อยของแท็บ "ผ่าน" (ตามรอบ/นอกรอบ) + ส่งออกแถวที่กรองอยู่เป็น Excel
  payTypeFilter: "" | "ตามรอบ" | "นอกรอบ"
  onPayTypeFilter: (v: "" | "ตามรอบ" | "นอกรอบ") => void
  onExport: () => void
}) {
  const rangeOn = Boolean(sentFrom || sentTo)
  // ปุ่มลัดที่ "ตรงกับช่วงที่เลือกอยู่พอดี" ถึงจะขึ้นไฮไลต์ — เลือกวันเองแล้วต้องไม่มีปุ่มไหนติดค้าง
  const activePreset = SENT_PRESETS.find((p) => {
    const r = apRangeOf(p.key, today)
    return r.from === sentFrom && r.to === sentTo
  })?.key
  return (
    <div>
      {/* แถบหัวเรื่อง — ชื่อหน้า วันที่ข้อมูล และตัวกรองทั้งหมดอยู่บรรทัดเดียว */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#14271C] dark:text-white" style={mitr}>ติดตามเจ้าหนี้</h1>
          <div className="text-[11px] text-gray-400">
            {loading && !summary ? "กำลังโหลด…" : summary?.dataAsOf ? `ข้อมูล ATMS ล่าสุด ${thaiDate(summary.dataAsOf)}` : " "}
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
            <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="ค้นหา DD / PO / เจ้าหนี้ / เลขเอกสาร"
              className="w-60 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm dark:border-white/10 dark:bg-white/5" />
            {/* ผลค้นข้ามเดือน — เดือนนี้ไม่เจอแต่ฐานมี · กดรายการ = สลับเดือน + คงคำค้นไว้กรองต่อ */}
            {crossHits !== null && (
              <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg dark:border-white/10 dark:bg-[#1b202b]">
                <div className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-white/10">
                  {crossHits.length ? "ไม่พบในเดือนนี้ — พบในเดือนอื่น:" : "ไม่พบในฐานข้อมูลเลย"}
                </div>
                {crossHits.slice(0, 6).map((h) => (
                  <button key={h.depositCode} onClick={() => onGotoHit(h)}
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                    <span className={`font-medium ${NUMCLS}`}>{h.depositCode}</span>
                    <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {thaiDate(h.receivedAt)}
                    </span>
                    <span className="flex-1 truncate text-gray-500 dark:text-gray-400">{h.supplier}</span>
                  </button>
                ))}
                {crossHits.length > 6 && (
                  <div className="px-3 py-1 text-[10px] text-gray-400">และอีก {crossHits.length - 6} ใบ — พิมพ์ให้เจาะจงขึ้น</div>
                )}
              </div>
            )}
          </div>

          <WarehouseCombobox options={warehouses} value={warehouse} onChange={onWarehouse} />

          {canPull && (
            <button onClick={onPull} disabled={pulling}
              title="ดึงข้อมูล 30 วันล่าสุดจาก ATMS (ใช้เวลา ~12 นาที · ดึงได้ 1 ครั้ง/ชม.)"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/5">
              <CloudDownload className={`h-4 w-4 ${pulling ? "animate-pulse" : ""}`} />
              {pulling ? `กำลังดึง ${Math.round(pullProgress)}%` : "ดึงข้อมูล ATMS"}
            </button>
          )}
          <button onClick={onRefresh} aria-label="รีเฟรช" title="โหลดตารางใหม่จากข้อมูลที่มีอยู่"
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
              {/* ยังไม่ได้ยอดของเดือนใหม่ = ห้ามโชว์ 0 เพราะอ่านผิดว่า "เดือนนี้ไม่มีใบ"
                  โชว์เป็นโครงกำลังโหลดแทน แล้วค่อยแทนที่ด้วยตัวเลขจริง */}
              {loading && !summary ? (
                <span className="inline-block h-3 w-6 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
              ) : (
                <span className={`text-xs ${on ? "text-gray-500 dark:text-gray-300" : "text-gray-400"} ${NUM}`}>
                  {v ? v.n.toLocaleString("th-TH") : 0}
                </span>
              )}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-white/10">
            {([["invoice", "รายใบ"], ["supplier", "รายเจ้าหนี้"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => onViewBy(v)}
                className={`px-2.5 py-1 transition ${viewBy === v
                  ? "bg-[#14271C] text-white dark:bg-white dark:text-[#14271C]"
                  : "hover:bg-gray-50 dark:hover:bg-white/10"}`}>
                {label}
              </button>
            ))}
          </div>
        <span className={`pb-0.5 pr-1 text-xs text-gray-400 ${NUM}`}>
          {/* "ทั้งหมด" เคยหมายถึงเดือนนี้ + ใบค้างยกมา — ตั้งแต่โหลดทีละเดือนแล้วมันคือเดือนนี้ล้วน
              ต้องเขียนให้ตรง ไม่งั้นคนจะนึกว่าใบค้างเดือนก่อนถูกนับรวมอยู่ด้วย */}
          {loading && !summary ? `กำลังโหลด ${monthLabel(month)}…`
            : tab ? `${totalShown.toLocaleString("th-TH")} ใบในแท็บนี้` : `เดือนนี้ ${totalShown.toLocaleString("th-TH")} ใบ`}
        </span>
        </div>
      </div>

      {/* วันที่จัดซื้อกดเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว" — คนละตัวกับวันโอนเงิน (sentDate)
          ใบที่กดส่งก่อนระบบเก็บฟิลด์นี้จะไม่มีวัน จึงตกช่วงเสมอเมื่อตั้งช่วง (ดู inDateRange) */}
      {sentView && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
            <CalendarRange className="h-4 w-4" />วันที่กดส่งบัญชี
          </span>

          <input type="date" value={sentFrom} max={sentTo || undefined} aria-label="ตั้งแต่วันที่กดส่ง"
            onChange={(e) => onSentRange(e.target.value, sentTo)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5" />
          <span className="text-xs text-gray-400">ถึง</span>
          <input type="date" value={sentTo} min={sentFrom || undefined} aria-label="ถึงวันที่กดส่ง"
            onChange={(e) => onSentRange(sentFrom, e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5" />

          {SENT_PRESETS.map((p) => {
            const on = activePreset === p.key
            return (
              <button key={p.key} onClick={() => { const r = apRangeOf(p.key, today); onSentRange(r.from, r.to) }}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${on
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "border-gray-200 hover:bg-white dark:border-white/10 dark:hover:bg-white/10"}`}>
                {p.label}
              </button>
            )
          })}

          {rangeOn && (
            <button onClick={() => onSentRange("", "")} className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-800 dark:hover:text-gray-200">
              ล้างช่วงวันที่
            </button>
          )}

          {/* filter ย่อยเฉพาะแท็บ "ผ่าน" — ใบกดผ่านในเว็บใช้ค่าที่บัญชียืนยัน ใบนำเข้าใช้คำขอจัดซื้อ */}
          {tab === "passed" && (
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3 dark:border-white/10">
              {([["", "ทั้งหมด"], ["ตามรอบ", "📋 ตามรอบ"], ["นอกรอบ", "💸 นอกรอบ"]] as const).map(([v, label]) => (
                <button key={label} onClick={() => onPayTypeFilter(v)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${payTypeFilter === v
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                    : "border-gray-200 hover:bg-white dark:border-white/10 dark:hover:bg-white/10"}`}>
                  {label}
                </button>
              ))}
              <button onClick={onExport} title="ส่งออกแถวที่กรองอยู่เป็นไฟล์ Excel"
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs hover:bg-white dark:border-white/10 dark:hover:bg-white/10">
                <FileDown className="h-3.5 w-3.5" />Excel
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {groupSent && (
              <span className={`text-xs text-gray-400 ${NUM}`}>{sentDays.toLocaleString("th-TH")} วันที่กดส่ง</span>
            )}
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-white/10">
              {[{ v: false, label: "รายการ" }, { v: true, label: "จัดกลุ่มรายวัน" }].map((o) => (
                <button key={o.label} onClick={() => onGroupSent(o.v)}
                  className={`px-2.5 py-1 text-xs transition ${groupSent === o.v
                    ? "bg-[#14271C] text-white dark:bg-white dark:text-[#14271C]"
                    : "hover:bg-gray-50 dark:hover:bg-white/10"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
