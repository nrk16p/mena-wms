"use client"

import { useEffect, useMemo, useState } from "react"

type MonthRow  = { month: string; count: number; updatedAt?: string }
type RecentRow = { skuPk: number; username: string; addedAt: string }
type SyncLog   = { ok: boolean; error: string | null; syncedAt: string } | null

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

function monthLabel(month: string): string {
  const [y, m] = month.split("-")
  return `${TH_MONTHS[+m - 1]} ${+y + 543 - 2500}` // e.g. "ก.ค. 69"
}

export default function AtmsNewSkuReportPage() {
  const [monthly, setMonthly] = useState<MonthRow[]>([])
  const [recent, setRecent]   = useState<RecentRow[]>([])
  const [lastSync, setLastSync] = useState<SyncLog>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/atms-sku-report")
      .then((r) => r.json())
      .then((d) => {
        setMonthly(d.monthly ?? [])
        setRecent(d.recent ?? [])
        setLastSync(d.lastSync ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const kpi = useMemo(() => {
    if (monthly.length === 0) return { thisMonth: 0, lastMonth: 0, avg12: 0, total: 0 }
    const now = new Date()
    const curKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const prevD   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`
    const byKey   = Object.fromEntries(monthly.map((r) => [r.month, r.count]))
    // 12-month average over completed months (exclude the running month)
    const completed = monthly.filter((r) => r.month < curKey).slice(-12)
    return {
      thisMonth: byKey[curKey] ?? 0,
      lastMonth: byKey[prevKey] ?? 0,
      avg12: completed.length ? Math.round(completed.reduce((s, r) => s + r.count, 0) / completed.length) : 0,
      total: monthly.reduce((s, r) => s + r.count, 0),
    }
  }, [monthly])

  const last24 = useMemo(() => monthly.slice(-24), [monthly])
  const maxBar = Math.max(1, ...last24.map((r) => r.count))

  const byYear = useMemo(() => {
    const years: Record<string, (number | null)[]> = {}
    for (const r of monthly) {
      const [y, m] = r.month.split("-")
      years[y] ??= Array(12).fill(null)
      years[y][+m - 1] = r.count
    }
    return Object.entries(years).sort(([a], [b]) => b.localeCompare(a))
  }, [monthly])

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">รายงาน SKU ใหม่ (ATMS)</h1>
        {lastSync && (
          <p className={`text-xs ${lastSync.ok ? "text-gray-400 dark:text-gray-500" : "text-red-500"}`}>
            {lastSync.ok
              ? `ซิงค์ล่าสุด ${new Date(lastSync.syncedAt).toLocaleString("th-TH")}`
              : `ซิงค์ล้มเหลว: ${lastSync.error}`}
          </p>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        จำนวนรหัสสินค้าที่ถูกเพิ่มใหม่ในระบบ ATMS แยกตามเดือน (จาก activity log)
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">กำลังโหลด...</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { label: "เดือนนี้", value: kpi.thisMonth },
              { label: "เดือนที่แล้ว", value: kpi.lastMonth },
              { label: "เฉลี่ย 12 เดือน", value: kpi.avg12 },
              { label: "สะสมทั้งหมด", value: kpi.total },
            ].map((t) => (
              <div key={t.label} className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">{t.label}</p>
                <p className="text-3xl font-semibold text-gray-900 dark:text-white">{t.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Trend chart — last 24 months */}
          <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-6">
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">แนวโน้ม 24 เดือนล่าสุด</p>
            <div className="flex items-end gap-1 h-40 overflow-x-auto">
              {last24.map((r) => (
                <div key={r.month} className="group flex flex-col items-center flex-1 min-w-6 h-full justify-end">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity leading-none mb-0.5">
                    {r.count}
                  </span>
                  <div
                    className="w-full rounded-t bg-[#1B8C4B]/80 hover:bg-[#1B8C4B] transition-colors"
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Year × month matrix */}
            <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 overflow-x-auto">
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">รายเดือนทุกปี</p>
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
                SKU เพิ่มล่าสุด <span className="font-normal text-gray-400">(จากการซิงค์รายวัน)</span>
              </p>
              {recent.length === 0 ? (
                <p className="text-xs text-gray-400">ยังไม่มีข้อมูล — รอ cron รอบแรก</p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-[#0f1117]">
                      <tr className="text-gray-400 dark:text-gray-600">
                        <th className="text-left font-semibold pb-2">SKU PK</th>
                        <th className="text-left font-semibold pb-2">ผู้เพิ่ม</th>
                        <th className="text-right font-semibold pb-2">เมื่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((r) => (
                        <tr key={r.skuPk} className="border-t border-gray-100 dark:border-white/5">
                          <td className="py-1.5">
                            <a
                              href={`https://www.mena-atms.com/inv/sku/view/id/${r.skuPk}`}
                              target="_blank" rel="noreferrer"
                              className="text-[#1B8C4B] hover:underline font-medium"
                            >
                              {r.skuPk}
                            </a>
                          </td>
                          <td className="py-1.5 text-gray-600 dark:text-gray-400">{r.username}</td>
                          <td className="py-1.5 text-right text-gray-500 dark:text-gray-500 tabular-nums">
                            {new Date(r.addedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
