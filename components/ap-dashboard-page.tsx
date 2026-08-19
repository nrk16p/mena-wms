"use client"

// แดชบอร์ดเจ้าหนี้สำหรับผู้จัดการ — คำถามที่หน้านี้ตอบ: "งานกองอยู่ที่คลังไหน ขั้นไหน เท่าไหร่"
// อ่านจาก /api/ap-tracking/dashboard (aggregate แล้ว) เปิดได้ทุกเดือนพร้อมกันโดยไม่หนักฐาน
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { swalError } from "@/lib/swal"
import { AP_STAGES, apStageMeta, thaiDate, type ApStage } from "@/lib/ap-tracking"
import { CARD, NUM, baht, bahtShort, mitr } from "@/components/ap-style"

type Entry = { ym: string; warehouse: string; stage: ApStage; n: number; amount: number }

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  return `${TH_MONTHS[(m || 1) - 1]} ${((y || 0) + 543) % 100}`
}
const nfmt = (v: number) => v.toLocaleString("th-TH")

export function ApDashboardPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [dataAsOf, setDataAsOf] = useState("")
  const [loading, setLoading] = useState(true)
  const [ym, setYm] = useState("")            // "" = ทุกเดือน

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/ap-tracking/dashboard", { cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setEntries(d.entries ?? [])
      setDataAsOf(d.dataAsOf ?? "")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ")
    } finally { setLoading(false) }
  }, [])
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const months = useMemo(() => [...new Set(entries.map((e) => e.ym))].sort().reverse(), [entries])
  const view = useMemo(() => (ym ? entries.filter((e) => e.ym === ym) : entries), [entries, ym])

  // KPI ต่อขั้น + ตารางคลัง × ขั้น (เรียงคลังตามยอดเงินรวม — คลังใหญ่คือที่ผู้จัดการดูก่อน)
  const byStage = useMemo(() => {
    const out = Object.fromEntries(AP_STAGES.map((st) => [st.key, { n: 0, amount: 0 }])) as Record<ApStage, { n: number; amount: number }>
    for (const e of view) { out[e.stage].n += e.n; out[e.stage].amount += e.amount }
    return out
  }, [view])
  type WhRow = Record<ApStage, { n: number; amount: number }> & { total: { n: number; amount: number } }
  const byWh = useMemo(() => {
    const m = new Map<string, WhRow>()
    for (const e of view) {
      let row = m.get(e.warehouse)
      if (!row) {
        row = Object.assign(
          Object.fromEntries(AP_STAGES.map((st) => [st.key, { n: 0, amount: 0 }])),
          { total: { n: 0, amount: 0 } },
        ) as WhRow
        m.set(e.warehouse, row)
      }
      row[e.stage].n += e.n; row[e.stage].amount += e.amount
      row.total.n += e.n; row.total.amount += e.amount
    }
    return [...m.entries()].sort((a, b) => b[1].total.amount - a[1].total.amount)
  }, [view])
  const grand = useMemo(() => byWh.reduce((acc, [, r]) => ({ n: acc.n + r.total.n, amount: acc.amount + r.total.amount }), { n: 0, amount: 0 }), [byWh])

  // แนวโน้มรายเดือน (ทุกเดือนเสมอ ไม่สนตัวกรอง — เส้นเรื่องของกราฟคือ "แต่ละเดือนคืบไปแค่ไหน")
  type MonthRow = Record<ApStage, number> & { total: number }
  const byMonth = useMemo(() => {
    const m = new Map<string, MonthRow>()
    for (const e of entries) {
      let row = m.get(e.ym)
      if (!row) {
        row = Object.assign(Object.fromEntries(AP_STAGES.map((st) => [st.key, 0])), { total: 0 }) as MonthRow
        m.set(e.ym, row)
      }
      row[e.stage] += e.amount; row.total += e.amount
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])
  const maxMonth = Math.max(1, ...byMonth.map(([, r]) => r.total))

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/ap-tracking" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="กลับหน้าติดตามเจ้าหนี้">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-bold tracking-tight text-[#14271C] dark:text-white" style={mitr}>แดชบอร์ดเจ้าหนี้</h1>
          </div>
          <div className="text-[11px] text-gray-400">
            {dataAsOf ? `ข้อมูล ATMS ล่าสุด ${thaiDate(dataAsOf)}` : loading ? "กำลังโหลด…" : ""}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={ym} onChange={(e) => setYm(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5">
            <option value="">ทุกเดือน</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button onClick={load} aria-label="รีเฟรช"
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI ต่อขั้นของงาน — ตัวเลขชุดเดียวกับแท็บหน้าหลัก (apStage ตัวเดียวกัน) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {AP_STAGES.map((st) => {
          const v = byStage[st.key]
          return (
            <div key={st.key} className={`${CARD} p-3`} title={st.hint}>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}
              </div>
              <div className={`mt-1 text-xl font-bold ${NUM}`}>
                {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-gray-100 dark:bg-white/10" /> : nfmt(v.n)}
              </div>
              <div className={`text-xs text-gray-400 ${NUM}`}>{loading ? "" : bahtShort(v.amount)}</div>
            </div>
          )
        })}
      </div>

      {/* คลัง × ขั้นของงาน — หัวใจของหน้า: งานกองอยู่ที่ไหน */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">คลังสินค้า{ym ? ` · ${monthLabel(ym)}` : " · ทุกเดือน"}</th>
              {AP_STAGES.map((st) => (
                <th key={st.key} className="px-3 py-2.5 text-right font-medium">
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${st.dot}`} />{st.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-medium">รวม</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
                <td colSpan={AP_STAGES.length + 2} className="px-3 py-3">
                  <div className="h-4 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                </td>
              </tr>
            ))}
            {!loading && byWh.map(([wh, row]) => (
              <tr key={wh} className="border-t border-gray-100 hover:bg-gray-50/60 dark:border-white/5 dark:hover:bg-white/5">
                <td className="px-3 py-2.5 font-medium">{wh}</td>
                {AP_STAGES.map((st) => {
                  const v = row[st.key]
                  // ขั้นที่ "ยังไม่จบ" (รอประกบ/ตีกลับ) คือของที่ผู้จัดการต้องไล่ — เน้นด้วยสีตัวเลข
                  const hot = (st.key === "wait" || st.key === "rejected") && v.n > 0
                  return (
                    <td key={st.key} className={`px-3 py-2.5 text-right ${NUM}`} title={v.n ? baht(v.amount) : undefined}>
                      {v.n === 0 ? <span className="text-gray-300 dark:text-gray-600">—</span> : (
                        <>
                          <div className={hot ? "font-semibold text-rose-600 dark:text-rose-400" : ""}>{nfmt(v.n)}</div>
                          <div className="text-[10px] text-gray-400">{bahtShort(v.amount)}</div>
                        </>
                      )}
                    </td>
                  )
                })}
                <td className={`px-3 py-2.5 text-right font-semibold ${NUM}`} title={baht(row.total.amount)}>
                  <div>{nfmt(row.total.n)}</div>
                  <div className="text-[10px] font-normal text-gray-400">{bahtShort(row.total.amount)}</div>
                </td>
              </tr>
            ))}
            {!loading && byWh.length > 0 && (
              <tr className="border-t-2 border-gray-200 bg-gray-50/60 dark:border-white/10 dark:bg-white/5">
                <td className="px-3 py-2.5 font-bold" style={mitr}>รวมทุกคลัง</td>
                {AP_STAGES.map((st) => (
                  <td key={st.key} className={`px-3 py-2.5 text-right font-medium ${NUM}`}>
                    <div>{nfmt(byStage[st.key].n)}</div>
                    <div className="text-[10px] font-normal text-gray-400">{bahtShort(byStage[st.key].amount)}</div>
                  </td>
                ))}
                <td className={`px-3 py-2.5 text-right font-bold ${NUM}`}>
                  <div>{nfmt(grand.n)}</div>
                  <div className="text-[10px] font-normal text-gray-400">{bahtShort(grand.amount)}</div>
                </td>
              </tr>
            )}
            {!loading && byWh.length === 0 && (
              <tr><td colSpan={AP_STAGES.length + 2} className="px-3 py-16 text-center text-gray-400">ไม่มีข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* แนวโน้มรายเดือน — แถบซ้อนตามยอดเงิน เห็นทันทีว่าเดือนไหนงานยังไม่จบเยอะ */}
      {!loading && byMonth.length > 0 && (
        <div className={`${CARD} space-y-2 p-4`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-bold" style={mitr}>ยอดเงินรายเดือน แยกตามขั้นของงาน</h2>
            <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-gray-500 dark:text-gray-400">
              {AP_STAGES.map((st) => (
                <span key={st.key} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}</span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {byMonth.map(([m, row]) => (
              <div key={m} className="flex items-center gap-2">
                <button onClick={() => setYm(ym === m ? "" : m)}
                  className={`w-14 shrink-0 text-left text-xs ${ym === m ? "font-bold text-[#14271C] dark:text-white" : "text-gray-500 hover:underline dark:text-gray-400"}`}>
                  {monthLabel(m)}
                </button>
                <div className="flex h-4 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-white/5">
                  {AP_STAGES.map((st) => {
                    const w = (row[st.key] / maxMonth) * 100
                    return w > 0 ? (
                      <div key={st.key} className={apStageMeta(st.key).dot} style={{ width: `${w}%` }}
                        title={`${st.label} ${bahtShort(row[st.key])}`} />
                    ) : null
                  })}
                </div>
                <span className={`w-16 shrink-0 text-right text-[11px] text-gray-400 ${NUM}`}>{bahtShort(row.total)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">กดชื่อเดือนเพื่อกรองตารางด้านบนเป็นเดือนนั้น · กดซ้ำเพื่อดูทุกเดือน</p>
        </div>
      )}
    </div>
  )
}
