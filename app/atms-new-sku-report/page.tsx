"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download } from "lucide-react"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"

type MonthRow  = { month: string; count: number }
type WhRow     = { warehouse: string; count: number }
type GroupRow  = { group: string; count: number }
type UserRow   = { username: string; count: number; lastAt: string }
type RecentRow = {
  skuPk: number; username: string; addedAt: string; addedAtText?: string
  code?: string; name?: string; group?: string; warehouse?: string
}
type SyncLog = { ok: boolean; error: string | null; syncedAt: string } | null

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

function monthLabel(month: string): string {
  const [y, m] = month.split("-")
  return `${TH_MONTHS[+m - 1]} ${(+y + 543) % 100}`
}

function pctBadge(cur: number, prev: number) {
  if (prev === 0) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  const up  = pct >= 0
  return (
    <span className={`ml-2 text-xs font-semibold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  )
}

export default function AtmsNewSkuReportPage() {
  const [selWh, setSelWh] = useState<string[]>([])
  const [monthly, setMonthly]     = useState<MonthRow[]>([])
  const [warehouses, setWarehouses] = useState<WhRow[]>([])
  const [topGroups, setTopGroups] = useState<GroupRow[]>([])
  const [topUsers, setTopUsers]   = useState<UserRow[]>([])
  const [recent, setRecent]       = useState<RecentRow[]>([])
  const [lastSync, setLastSync]   = useState<SyncLog>(null)
  const [loading, setLoading]     = useState(true)
  const [savingPng, setSavingPng] = useState(false)
  const slideRef = useRef<HTMLDivElement>(null)

  const load = useCallback((whs: string[]) => {
    setLoading(true)
    fetch(`/api/atms-sku-report${whs.length ? `?warehouse=${encodeURIComponent(whs.join(","))}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setMonthly(d.monthly ?? [])
        setWarehouses(d.warehouses ?? [])
        setTopGroups(d.topGroups ?? [])
        setTopUsers(d.topUsers ?? [])
        setRecent(d.recent ?? [])
        setLastSync(d.lastSync ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(selWh) }, [selWh, load])

  const whSuffix = selWh.length === 0 ? "" : selWh.length === 1 ? ` — ${selWh[0]}` : ` — ${selWh.length} คลัง`

  const now = new Date()
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  const kpi = useMemo(() => {
    const byKey = Object.fromEntries(monthly.map((r) => [r.month, r.count]))
    const prevD    = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevKey  = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`
    const prev2D   = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const prev2Key = `${prev2D.getFullYear()}-${String(prev2D.getMonth() + 1).padStart(2, "0")}`
    const completed = monthly.filter((r) => r.month < curKey).slice(-12)
    // YTD vs same months last year
    const y = now.getFullYear()
    const ytd     = monthly.filter((r) => r.month.startsWith(`${y}-`)).reduce((s, r) => s + r.count, 0)
    const lastYtd = monthly.filter((r) => r.month.startsWith(`${y - 1}-`) && r.month.slice(5) <= curKey.slice(5))
      .reduce((s, r) => s + r.count, 0)
    return {
      thisMonth: byKey[curKey] ?? 0, lastMonth: byKey[prevKey] ?? 0, prev2: byKey[prev2Key] ?? 0,
      avg12: completed.length ? Math.round(completed.reduce((s, r) => s + r.count, 0) / completed.length) : 0,
      total: monthly.reduce((s, r) => s + r.count, 0),
      ytd, lastYtd,
    }
  }, [monthly, curKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const last24 = useMemo(() => monthly.slice(-24), [monthly])
  const maxBar = Math.max(1, ...last24.map((r) => r.count))
  const maxGroup = Math.max(1, ...topGroups.map((r) => r.count))

  const byYear = useMemo(() => {
    const years: Record<string, (number | null)[]> = {}
    for (const r of monthly) {
      const [y, m] = r.month.split("-")
      years[y] ??= Array(12).fill(null)
      years[y][+m - 1] = r.count
    }
    return Object.entries(years).sort(([a], [b]) => b.localeCompare(a))
  }, [monthly])

  const savePng = async () => {
    const el = slideRef.current
    if (!el || savingPng) return
    setSavingPng(true)
    try {
      const { toBlob } = await import("html-to-image")
      const opts = {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        // system fonts only — skipping web-font embedding avoids CORS SecurityError and speeds capture
        skipFonts: true,
      }
      // WebKit/Safari: first capture can come back blank — warm up, then capture
      await toBlob(el, opts)
      const blob = await toBlob(el, opts)
      if (!blob) throw new Error("capture returned empty image")
      // blob + object URL downloads reliably across Chrome/Safari/Firefox
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.download = `atms-new-sku-report-${new Date().toISOString().slice(0, 10)}.png`
      a.href = url
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error("save png failed", e)
      alert(`บันทึก PNG ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingPng(false)
    }
  }

  const slideWhLabel = selWh.length === 0 ? "ทุกคลังสินค้า" : selWh.join(" • ")

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">รายงาน SKU ใหม่ (ATMS)</h1>
        {lastSync && (
          <p className={`text-xs ${lastSync.ok ? "text-gray-400 dark:text-gray-500" : "text-red-500"}`}>
            {lastSync.ok
              ? `ซิงค์ล่าสุด ${new Date(lastSync.syncedAt).toLocaleString("th-TH")}`
              : `ซิงค์ล้มเหลว: ${lastSync.error}`}
          </p>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        จำนวนรหัสสินค้าที่ถูกเพิ่มใหม่ในระบบ ATMS แยกตามเดือน (จาก activity log) •{" "}
        <a href="/atms-new-sku-report/baseline" className="text-[#1B8C4B] hover:underline">นิยามตัวชี้วัด &amp; Baseline</a>
      </p>

      {/* Warehouse filter */}
      <div className="flex flex-wrap items-start gap-2 mb-6">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 pt-2">คลังสินค้า:</label>
        <div className="min-w-72 max-w-xl flex-1">
          <MultiSelectCombobox
            options={Object.fromEntries(warehouses.map((w) => [w.warehouse, { th: `${w.count.toLocaleString()} รายการ`, en: "" }]))}
            values={selWh}
            onChange={setSelWh}
            placeholder="— ทุกคลัง —"
            className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 text-sm"
          />
        </div>
        {selWh.length > 0 && (
          <button onClick={() => setSelWh([])} className="text-xs text-[#1B8C4B] hover:underline pt-2.5">ล้างตัวกรอง</button>
        )}
        {loading && <span className="text-xs text-gray-400 animate-pulse pt-2.5">กำลังโหลด...</span>}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">เดือนนี้</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {kpi.thisMonth.toLocaleString()}
            <span className="text-sm font-normal text-gray-400 ml-1">/ {monthLabel(curKey)}</span>
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">เดือนที่แล้ว</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {kpi.lastMonth.toLocaleString()}{pctBadge(kpi.lastMonth, kpi.prev2)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">เฉลี่ย 12 เดือน</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{kpi.avg12.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">ปีนี้ (YTD)</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {kpi.ytd.toLocaleString()}{pctBadge(kpi.ytd, kpi.lastYtd)}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">ปีที่แล้วช่วงเดียวกัน {kpi.lastYtd.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">สะสมทั้งหมด</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{kpi.total.toLocaleString()}</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">ตั้งแต่ ธ.ค. 2015</p>
        </div>
      </div>

      {/* Trend chart — last 24 months */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-6">
        <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          แนวโน้ม 24 เดือนล่าสุด{whSuffix}
        </p>
        <div className="flex items-end gap-1 h-40 overflow-x-auto">
          {last24.map((r) => (
            <div key={r.month} className="group flex flex-col items-center flex-1 min-w-6 h-full justify-end">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity leading-none mb-0.5">
                {r.count}
              </span>
              <div
                className={`w-full rounded-t transition-colors ${r.month === curKey ? "bg-amber-400/90 hover:bg-amber-400" : "bg-[#1B8C4B]/80 hover:bg-[#1B8C4B]"}`}
                style={{ height: `${Math.max(2, (r.count / maxBar) * 100)}%` }}
                title={`${monthLabel(r.month)}: ${r.count.toLocaleString()}`}
              />
              <span className="mt-1 text-[9px] text-gray-400 dark:text-gray-600 whitespace-nowrap">
                {monthLabel(r.month)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Breakdown cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Top groups */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            กลุ่มสินค้ายอดนิยม{whSuffix}
          </p>
          <div className="space-y-2.5">
            {topGroups.map((g) => (
              <div key={g.group}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="truncate text-gray-700 dark:text-gray-300">{g.group}</span>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums shrink-0 ml-2">{g.count.toLocaleString()}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-white/8">
                  <div className="h-1.5 rounded-full bg-sky-500/70" style={{ width: `${(g.count / maxGroup) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top users */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            ผู้เพิ่ม SKU สูงสุด{whSuffix}
          </p>
          <table className="w-full text-xs">
            <tbody>
              {topUsers.map((u, i) => (
                <tr key={u.username} className={i > 0 ? "border-t border-gray-100 dark:border-white/5" : ""}>
                  <td className="py-1.5 text-gray-400 dark:text-gray-600 w-6">{i + 1}.</td>
                  <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300">{u.username}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-white font-semibold">{u.count.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-gray-400 dark:text-gray-600 whitespace-nowrap pl-2">
                    ล่าสุด {new Date(u.lastAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Year × month matrix */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 overflow-x-auto">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            รายเดือนทุกปี{whSuffix}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 dark:text-gray-600">
                <th className="text-left font-semibold pb-2 pr-2">ปี</th>
                {TH_MONTHS.map((m) => <th key={m} className="text-right font-semibold pb-2 px-1">{m}</th>)}
                <th className="text-right font-semibold pb-2 pl-2">รวม</th>
              </tr>
            </thead>
            <tbody>
              {byYear.map(([year, months]) => (
                <tr key={year} className="border-t border-gray-100 dark:border-white/5">
                  <td className="py-1.5 pr-2 font-semibold text-gray-700 dark:text-gray-300">{year}</td>
                  {months.map((c, i) => (
                    <td key={i} className="py-1.5 px-1 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                      {c === null ? "–" : c.toLocaleString()}
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right font-semibold text-gray-900 dark:text-white tabular-nums">
                    {months.reduce<number>((s, c) => s + (c ?? 0), 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent additions */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            SKU เพิ่มล่าสุด{whSuffix} <span className="font-normal text-gray-400">(100 รายการ)</span>
          </p>
          {recent.length === 0 ? (
            <p className="text-xs text-gray-400">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-[#0f1117]">
                  <tr className="text-gray-400 dark:text-gray-600">
                    <th className="text-left font-semibold pb-2">รหัสสินค้า</th>
                    <th className="text-left font-semibold pb-2">ชื่อ</th>
                    <th className="text-left font-semibold pb-2">กลุ่ม</th>
                    <th className="text-left font-semibold pb-2">คลัง</th>
                    <th className="text-left font-semibold pb-2">ผู้เพิ่ม</th>
                    <th className="text-right font-semibold pb-2">เมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.skuPk} className="border-t border-gray-100 dark:border-white/5 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <a
                          href={`https://www.mena-atms.com/inv/sku/view/id/${r.skuPk}`}
                          target="_blank" rel="noreferrer"
                          className="text-[#1B8C4B] hover:underline font-medium"
                        >
                          {r.code || `#${r.skuPk}`}
                        </a>
                      </td>
                      <td className="py-1.5 pr-2 text-gray-700 dark:text-gray-300 max-w-48 truncate" title={r.name}>{r.name ?? "–"}</td>
                      <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-500 whitespace-nowrap">{r.group ?? "–"}</td>
                      <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-500 whitespace-nowrap">{r.warehouse ?? "–"}</td>
                      <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.username}</td>
                      <td className="py-1.5 text-right text-gray-500 dark:text-gray-500 tabular-nums whitespace-nowrap">
                        {r.addedAtText ?? new Date(r.addedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Presentation slide (16:9 PNG export) ── */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            สไลด์สำหรับรายงาน (16:9)
            <span className="ml-2 font-normal text-xs text-gray-400">อัปเดตตามตัวกรองคลังสินค้าด้านบน</span>
          </p>
          <button
            onClick={savePng}
            disabled={savingPng || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50 transition-colors"
          >
            <Download size={14} />
            {savingPng ? "กำลังบันทึก..." : "Export PNG"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/8">
          {/* fixed 1280×720 → PNG 2560×1440; light theme only, matches report decks */}
          <div ref={slideRef} className="w-[1280px] aspect-video shrink-0 bg-white p-10 flex flex-col">
            {/* Slide header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-4xl font-bold text-gray-900 leading-tight">รายงาน SKU ใหม่ในระบบ ATMS</h2>
                <p className="text-lg text-gray-500 mt-2">{slideWhLabel}</p>
              </div>
              <div className="flex gap-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-7 py-4 text-center">
                  <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">เฉลี่ย 12 เดือน</p>
                  <p className="text-4xl font-bold text-gray-900 tabular-nums">{kpi.avg12.toLocaleString()}</p>
                  <p className="text-sm text-gray-400">SKU / เดือน</p>
                </div>
                <div className="rounded-xl border border-[#1B8C4B]/30 bg-[#f0fdf4] px-7 py-4 text-center">
                  <p className="text-sm font-semibold uppercase tracking-wider text-[#1B8C4B]">สะสมทั้งหมด</p>
                  <p className="text-4xl font-bold text-[#0F6A3C] tabular-nums">{kpi.total.toLocaleString()}</p>
                  <p className="text-sm text-gray-400">ตั้งแต่ ธ.ค. 2015</p>
                </div>
              </div>
            </div>

            {/* Slide body */}
            <div className="flex-1 grid grid-cols-5 gap-6 min-h-0">
              {/* Year × month matrix */}
              <div className="col-span-3 flex flex-col min-h-0">
                <p className="text-xl font-bold text-gray-800 mb-3">รายเดือนทุกปี</p>
                <table className="w-full text-[15px] leading-tight">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-200">
                      <th className="text-left font-semibold py-1.5 pr-1">ปี</th>
                      {TH_MONTHS.map((m) => <th key={m} className="text-right font-semibold py-1.5 px-0.5">{m}</th>)}
                      <th className="text-right font-semibold py-1.5 pl-1">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byYear.map(([year, months]) => (
                      <tr key={year} className="border-b border-gray-100">
                        <td className="py-1.5 pr-1 font-semibold text-gray-700">{year}</td>
                        {months.map((c, i) => (
                          <td key={i} className="py-1.5 px-0.5 text-right text-gray-600 tabular-nums">
                            {c === null ? "–" : c.toLocaleString()}
                          </td>
                        ))}
                        <td className="py-1.5 pl-1 text-right font-bold text-gray-900 tabular-nums">
                          {months.reduce<number>((s, c) => s + (c ?? 0), 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Top groups */}
              <div className="col-span-2 flex flex-col min-h-0">
                <p className="text-xl font-bold text-gray-800 mb-3">กลุ่มสินค้ายอดนิยม</p>
                <div className="space-y-4">
                  {topGroups.map((g) => (
                    <div key={g.group}>
                      <div className="flex justify-between text-[15px] mb-1">
                        <span className="truncate text-gray-700">{g.group}</span>
                        <span className="text-gray-500 tabular-nums shrink-0 ml-2">{g.count.toLocaleString()}</span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-gray-100">
                        <div className="h-3 rounded-full bg-[#1B8C4B]/75" style={{ width: `${(g.count / maxGroup) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Slide footer */}
            <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-4">
              <p className="text-sm text-gray-400">ที่มา: ATMS activity log (การเพิ่มรหัสสินค้า) • Mena WMS</p>
              <p className="text-sm text-gray-400">
                สร้างเมื่อ {now.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
