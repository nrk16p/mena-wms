"use client"
// หน้าหลักของเจ้าหนี้ — รอบโอนถัดไป · ค้น DD/เบอร์รถ/ทะเบียน · กรอง · คัดลอกเลข DD
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Download, Search, SlidersHorizontal, X } from "lucide-react"
import {
  VP_STATUS_LABEL, vpBillMonths, vpFilterBills, vpMonthLabel, vpThaiDate,
  type VpBill, type VpFilter, type VpStatus,
} from "@/lib/vendor-portal"
import { BillCard } from "./bill-card"
import { FilterSheet } from "./filter-sheet"
import { VP_FONT, baht, copyText, weekdayOf } from "./ui"
import { downloadVpExcel } from "./export-excel"

type Data = {
  vendor: { name: string; username: string }
  today: string
  windowStart: string
  bills: VpBill[]
  next: { date: string; count: number; amount: number } | null
}

const QUICK: (VpStatus | "all")[] = ["all", "processing", "scheduled", "paid"]

export function VendorPortalPage() {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<VpFilter>({ sort: "recent" })
  const [sheet, setSheet] = useState(false)
  const [toast, setToast] = useState("")
  const [exporting, setExporting] = useState(false)

  const toLogin = useCallback(() => router.replace("/vendor-portal/login"), [router])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor-portal/bills", { cache: "no-store" })
      if (res.status === 401) { toLogin(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d?.error ?? "โหลดข้อมูลไม่สำเร็จ"); return }
      setData(d as Data)
      setError("")
    } catch {
      setError("เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่")
    }
  }, [toLogin])
  // โหลดครั้งแรกตอนเปิดหน้า — setState เกิดหลัง await เท่านั้น (กฎ lint มองไม่ออก)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 1800)
  }, [])
  const onCopy = useCallback(async (text: string, label: string) => {
    const ok = await copyText(text)
    showToast(ok ? label : "คัดลอกไม่สำเร็จ")
    return ok
  }, [showToast])

  const logout = async () => {
    await fetch("/api/vendor-portal/logout", { method: "POST" }).catch(() => null)
    toLogin()
  }

  const bills = useMemo(() => data?.bills ?? [], [data])
  const months = useMemo(() => vpBillMonths(bills), [bills])
  const shown = useMemo(() => vpFilterBills(bills, { ...filter, q }), [bills, filter, q])
  const total = useMemo(() => shown.reduce((n, b) => n + b.amount, 0), [shown])

  const exportExcel = async () => {
    if (!data || exporting) return
    setExporting(true)
    try {
      const r = await downloadVpExcel(shown, data.vendor.username, data.today)
      if (r.ok) showToast(`ดาวน์โหลด Excel ${shown.length} ใบแล้ว`)
      else if (r.unauthorized) toLogin()
      else showToast(r.error)
    } catch {
      showToast("ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setExporting(false)
    }
  }

  const countOf = (s: VpStatus | "all") => (s === "all" ? bills.length : bills.filter((b) => b.status === s).length)
  const activeGroups = (filter.statuses?.length ? 1 : 0) + (filter.months?.length || filter.from || filter.to ? 1 : 0) + ((filter.sort ?? "recent") !== "recent" ? 1 : 0)
  const quick: VpStatus | "all" | null = !filter.statuses?.length ? "all" : filter.statuses.length === 1 ? filter.statuses[0] : null

  // จัดกลุ่มตามเดือนเฉพาะตอนเรียงตามวันรับของ (เรียงแบบอื่นแล้วหัวเดือนจะสลับไปมา)
  const groups = useMemo(() => {
    if ((filter.sort ?? "recent") !== "recent") return [{ month: "", bills: shown }]
    const out: { month: string; bills: VpBill[] }[] = []
    for (const b of shown) {
      const m = b.receivedAt.slice(0, 7)
      if (out.at(-1)?.month !== m) out.push({ month: m, bills: [] })
      out.at(-1)!.bills.push(b)
    }
    return out
  }, [shown, filter.sort])

  return (
    <div className="h-full overflow-y-auto bg-slate-50 text-slate-900" style={VP_FONT}>
      <div className="mx-auto max-w-xl pb-24">
        <header className="sticky top-0 z-20 bg-[#1E3A5F] px-3 pb-2.5 pt-2.5 text-white sm:rounded-b-2xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-semibold">{data?.vendor.name ?? "ติดตามการจ่ายเงิน"}</span>
            <button onClick={logout} className="h-8 flex-none rounded-lg px-2 text-white/85 hover:bg-white/10">ออกจากระบบ</button>
          </div>
          <div className="flex gap-2">
            <label className="flex h-11 flex-1 items-center gap-2 rounded-xl bg-white px-3 text-slate-900">
              <Search className="h-[18px] w-[18px] flex-none text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้น DD / เบอร์รถ / ทะเบียน"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" enterKeyHint="search" />
              {q && <button onClick={() => setQ("")} aria-label="ล้างคำค้น" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500"><X className="h-[18px] w-[18px]" /></button>}
            </label>
            <button onClick={() => setSheet(true)} aria-label="กรองรายการ"
              className="relative grid h-11 w-11 flex-none place-items-center rounded-xl bg-white text-[#1E3A5F]">
              <SlidersHorizontal className="h-[18px] w-[18px]" />
              {activeGroups > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-900">{activeGroups}</span>}
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-3 mt-3 flex items-center justify-between rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            {error}<button onClick={load} className="font-semibold underline">ลองใหม่</button>
          </div>
        )}

        {!data && !error && (
          <div className="space-y-2 px-3 pt-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-white" />)}</div>
        )}

        {data && (
          <>
            {data.next && !q && (
              <div className="mx-3 mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <div className="text-xs text-emerald-800">
                  <div className="font-medium">รอบโอนถัดไป · {weekdayOf(data.next.date)} {vpThaiDate(data.next.date)}</div>
                  <div>{data.next.count} ใบ</div>
                </div>
                <div className="text-lg font-bold text-emerald-900 tabular-nums">{baht(data.next.amount)}</div>
              </div>
            )}

            <div className="flex gap-1.5 overflow-x-auto px-3 pb-1 pt-2.5 [scrollbar-width:none]">
              {QUICK.map((s) => (
                <button key={s} onClick={() => setFilter({ ...filter, statuses: s === "all" ? [] : [s] })}
                  className={`h-[34px] whitespace-nowrap rounded-full border px-3 text-[12.5px] font-medium ${quick === s ? "border-[#1E3A5F] bg-[#1E3A5F] text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                  {s === "all" ? "ทั้งหมด" : VP_STATUS_LABEL[s]} {countOf(s)}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-2 text-[12.5px] text-slate-600">
              <span><b className="text-slate-900">{shown.length} ใบ</b> · {baht(total)}</span>
              {shown.length > 0 && (
                <div className="ml-auto flex gap-1.5">
                  <button onClick={() => onCopy(shown.map((b) => b.depositCode).join("\n"), `คัดลอกเลข DD ${shown.length} ใบแล้ว`)}
                    className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-[#1E3A5F] bg-white px-2.5 text-xs font-semibold text-[#1E3A5F]">
                    <Copy className="h-[15px] w-[15px]" />คัดลอก DD {shown.length === bills.length ? "ทั้งหมด" : `${shown.length} ใบ`}
                  </button>
                  <button onClick={exportExcel} disabled={exporting}
                    className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-2.5 text-xs font-semibold text-white disabled:opacity-60">
                    <Download className="h-[15px] w-[15px]" />{exporting ? "กำลังเตรียม…" : "Excel"}
                  </button>
                </div>
              )}
            </div>

            {bills.length === 0 && (
              <p className="px-6 py-14 text-center text-sm text-slate-500">ยังไม่มีบิลในช่วง 6 เดือนที่ผ่านมา</p>
            )}
            {bills.length > 0 && shown.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-slate-500">
                ไม่เจอบิลที่ตรงกับที่ค้น
                <div><button onClick={() => { setQ(""); setFilter({ sort: "recent" }) }} className="mt-2 h-10 px-3 font-semibold text-[#1E3A5F] underline">ล้างการค้นหาและตัวกรอง</button></div>
              </div>
            )}

            {groups.map((g) => (
              <section key={g.month || "flat"} className="space-y-2 px-3">
                {g.month && (
                  <div className="flex justify-between px-1 pb-0.5 pt-2 text-xs font-semibold text-slate-500">
                    <span>{vpMonthLabel(g.month, true)}</span>
                    <span>{g.bills.length} ใบ · {baht(g.bills.reduce((n, b) => n + b.amount, 0))}</span>
                  </div>
                )}
                {g.bills.map((b) => (
                  <BillCard key={b.depositCode} bill={b} today={data.today} query={q} onCopy={onCopy} onUnauthorized={toLogin} />
                ))}
              </section>
            ))}

            <p className="px-6 pt-6 text-center text-xs leading-relaxed text-slate-400">
              ข้อมูลรับของตั้งแต่ {vpThaiDate(data.windowStart)} และบิลเก่าที่ยังรอโอน · สงสัยเรื่องบิล ติดต่อฝ่ายจัดซื้อ
            </p>
          </>
        )}
      </div>

      {sheet && data && (
        <FilterSheet bills={bills} months={months} value={filter}
          onApply={(f) => { setFilter(f); setSheet(false) }} onClose={() => setSheet(false)} />
      )}

      <div role="status" aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg transition-opacity duration-200 ${toast ? "opacity-100" : "opacity-0"}`}>
        <Check className="h-4 w-4 text-emerald-400" />{toast}
      </div>
    </div>
  )
}
