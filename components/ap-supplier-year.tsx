"use client"

// แท็บ "รายเจ้าหนี้ ปีนี้" — สรุปทั้งปีแถวละเจ้า (กี่ DD กี่ PO ยอดเท่าไหร่ อยู่ขั้นไหนบ้าง ค้างเท่าไหร่)
// อ่านจาก /api/ap-tracking/by-supplier ที่ยุบมาแล้ว (~350 แถว) ไม่ใช่แถวดิบทั้งปี (7MB ชนเพดาน Vercel)
// แต่ละแถวส่งออก Excel "ทุกใบของเจ้านี้ทั้งปี" ได้ — ดึงรายใบผ่าน /api/ap-tracking?year=&supplier=
// ตอนกดเท่านั้น (เจ้าเดียวหลักร้อยแถว) แล้วใช้คอลัมน์ชุดเดียวกับ export อื่นของหน้านี้ (ap-export.ts)
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { AP_GO_LIVE, AP_STAGES, thaiDate, thaiMonthLabel, todayICT, type ApStage, type ApSupplierYearRow } from "@/lib/ap-tracking"
import { NUM, baht, bahtShort } from "@/components/ap-style"
import { AP_FLAT_WIDTHS, apFlatRow } from "@/components/ap-export"
import type { ApRow } from "@/components/ap-types"

type Row = ApSupplierYearRow & { creditTerm: string }

const MIN_YEAR = Number(AP_GO_LIVE.slice(0, 4))
const thaiYear = (y: string) => String(Number(y) + 543)
const nfmt = (v: number) => v.toLocaleString("th-TH")

export function ApSupplierYearPanel({
  warehouse, q, onPick,
}: {
  warehouse: string
  q: string
  // กดชื่อเจ้า = กลับไปมุมมองรายใบพร้อมกรองชื่อเจ้านั้น (เหมือนตารางรายเจ้าหนี้รายเดือน)
  onPick: (supplier: string) => void
}) {
  const [year, setYear] = useState(() => todayICT().slice(0, 4))
  const [rows, setRows] = useState<Row[]>([])
  const [dataAsOf, setDataAsOf] = useState("")
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState("")   // ชื่อเจ้าที่กำลังดึงรายใบอยู่ ("" = ไม่มี)

  // ยกเลิกคำขอเก่าเมื่อเปลี่ยนปี/คลังถี่ ๆ — คิวรีนี้สแกน deposit_header ทั้งปี ไม่ควรวิ่งซ้อนกัน
  const abortRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    try {
      const params = new URLSearchParams({ year })
      if (warehouse) params.set("warehouse", warehouse)
      const res = await fetch(`/api/ap-tracking/by-supplier?${params}`, { signal: ac.signal, cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      setRows(d.rows ?? []); setDataAsOf(d.dataAsOf ?? "")
    } catch (e) {
      if (ac.signal.aborted) return
      swalError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ")
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }, [year, warehouse])
  // เรียกผ่าน setTimeout(0) แบบเดียวกับ ap-dashboard-page — repo มี lint rule react-hooks/set-state-in-effect
  // (โหลดใหม่ทุกครั้งที่ปี/คลังเปลี่ยน · คำค้นกรองฝั่ง client ไม่ต้องยิงใหม่)
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => () => abortRef.current?.abort(), [])

  // คำค้นของหน้า (ช่องเดียวกับมุมมองรายใบ) กรองชื่อเจ้าฝั่ง client — แถวมีแค่หลักร้อย ไม่ต้องยิงใหม่
  const shown = useMemo(() => {
    if (!q) return rows
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    return rows.filter((r) => rx.test(r.supplier))
  }, [rows, q])

  const total = useMemo(() => ({
    dd: shown.reduce((n, r) => n + r.dd, 0),
    po: shown.reduce((n, r) => n + r.po, 0),
    amount: shown.reduce((n, r) => n + r.amount, 0),
    unpaid: shown.reduce((n, r) => n + r.unpaidAmount, 0),
    stages: Object.fromEntries(AP_STAGES.map((st) => [st.key, shown.reduce((n, r) => n + r.stages[st.key].n, 0)])) as Record<ApStage, number>,
  }), [shown])

  // Excel ของเจ้าเดียวทั้งปี: ชีต "รวม" + ชีตรายเดือน (ตามวันที่รับของ) คอลัมน์เดียวกับ export รายเดือน
  const exportSupplier = async (name: string) => {
    if (exporting) return
    setExporting(name)
    try {
      const params = new URLSearchParams({ year, supplier: name })
      if (warehouse) params.set("warehouse", warehouse)
      const res = await fetch(`/api/ap-tracking?${params}`, { cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "ดึงรายใบไม่สำเร็จ")
      const all = (d.rows ?? []) as ApRow[]
      if (!all.length) { swalToast("info", "เจ้านี้ไม่มีใบในปีที่เลือก"); return }
      if (d.summary?.truncated) swalToast("warning", `ข้อมูลถูกตัดที่ ${nfmt(d.summary.limit)} แถว — ไฟล์ยังไม่ครบทั้งปี`)

      const XLSX = await import("xlsx")
      const wb = XLSX.utils.book_new()
      const addSheet = (xs: ApRow[], sheet: string) => {
        const ws = XLSX.utils.json_to_sheet(xs.map(apFlatRow))
        ws["!cols"] = AP_FLAT_WIDTHS
        XLSX.utils.book_append_sheet(wb, ws, sheet)
      }
      addSheet(all, "รวม")
      const byMonth = new Map<string, ApRow[]>()
      for (const r of all) {
        const k = r.receivedAt.slice(0, 7) || "ไม่ระบุเดือน"
        byMonth.set(k, [...(byMonth.get(k) ?? []), r])
      }
      // เดือนเก่าก่อน — ไฟล์รายปีอ่านไล่ตามปฏิทิน (ต่างจาก export รายเดือนที่เอาเดือนล่าสุดไว้หน้า)
      for (const k of [...byMonth.keys()].sort()) addSheet(byMonth.get(k)!, thaiMonthLabel(k))
      // ชื่อไฟล์: ตัดอักขระที่ระบบไฟล์ไม่รับ (/ \ : * ? " < > |) ออกจากชื่อเจ้า
      const safe = name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60)
      XLSX.writeFile(wb, `เจ้าหนี้_${safe}_${thaiYear(year)}.xlsx`)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ")
    } finally { setExporting("") }
  }

  // Excel ของตารางสรุปนี้เอง (แถวละเจ้า ตามที่กรองอยู่)
  const exportSummary = async () => {
    const XLSX = await import("xlsx")
    const data = shown.map((r) => ({
      "เจ้าหนี้": r.supplier,
      "เครดิตเทอม": r.creditTerm,
      "DD": r.dd,
      "PO": r.po,
      ...Object.fromEntries(AP_STAGES.map((st) => [st.label, r.stages[st.key].n])),
      "ยอดเงินรวม": r.amount,
      "ยอดยังไม่จ่าย": r.unpaidAmount,
      "จำนวนเดือนที่มีใบ": r.months,
      "ใบแรก": r.firstReceivedAt,
      "ใบล่าสุด": r.lastReceivedAt,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws["!cols"] = [34, 10, 7, 7, ...AP_STAGES.map(() => 11), 14, 14, 10, 11, 11].map((w) => ({ wch: w }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `รายเจ้าหนี้ ${thaiYear(year)}`)
    XLSX.writeFile(wb, `สรุปรายเจ้าหนี้_${thaiYear(year)}${warehouse ? `_${warehouse}` : ""}.xlsx`)
  }

  const thisYear = Number(todayICT().slice(0, 4))
  const y = Number(year)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-white/10">
          <button onClick={() => setYear(String(y - 1))} disabled={y <= MIN_YEAR} aria-label="ปีก่อนหน้า"
            className="rounded-l-lg px-2 py-1.5 hover:bg-gray-50 disabled:opacity-30 dark:hover:bg-white/5"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[6rem] px-2 text-center text-sm">ปี {thaiYear(year)}</span>
          <button onClick={() => setYear(String(y + 1))} disabled={y >= thisYear} aria-label="ปีถัดไป"
            className="rounded-r-lg px-2 py-1.5 hover:bg-gray-50 disabled:opacity-30 dark:hover:bg-white/5"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <span className={`text-xs text-gray-400 ${NUM}`}>
          {loading ? "กำลังโหลดทั้งปี…" : `${nfmt(shown.length)} เจ้า · ${nfmt(total.dd)} ใบ · ${baht(total.amount)} บาท${dataAsOf ? ` · ข้อมูล ATMS ล่าสุด ${thaiDate(dataAsOf)}` : ""}`}
        </span>
        <button onClick={exportSummary} disabled={loading || shown.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5">
          <FileDown className="h-4 w-4" />Excel ตารางสรุป
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">เจ้าหนี้ ({nfmt(shown.length)} ราย)</th>
              <th className="px-3 py-2.5 text-right font-medium">DD</th>
              <th className="px-3 py-2.5 text-right font-medium">PO</th>
              {AP_STAGES.map((st) => (
                <th key={st.key} className="px-3 py-2.5 text-right font-medium" title={st.hint}>
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${st.dot}`} />{st.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-medium">ยอดรวม</th>
              <th className="px-3 py-2.5 text-right font-medium" title="ทุกขั้นที่ยังไม่มีหลักฐานจ่ายเงิน (เลข PV)">ยังไม่จ่าย</th>
              <th className="px-3 py-2.5 text-right font-medium">ใบล่าสุด</th>
              <th className="px-3 py-2.5 text-center font-medium" title="ส่งออกทุกใบของเจ้านี้ทั้งปีเป็น Excel">Excel</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
                <td colSpan={AP_STAGES.length + 7} className="px-3 py-3">
                  <div className="h-4 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                </td>
              </tr>
            ))}
            {shown.map((sp) => (
              <tr key={sp.supplier} className="border-t border-gray-100 hover:bg-emerald-50/60 dark:border-white/5 dark:hover:bg-emerald-900/10">
                <td className="max-w-[20rem] px-3 py-2.5">
                  <button onClick={() => onPick(sp.supplier)} title="กดเพื่อดูรายใบของเจ้านี้"
                    className="block w-full truncate text-left font-medium hover:underline">{sp.supplier}</button>
                  <div className="text-[11px] text-gray-400">
                    {sp.creditTerm ? `เครดิต ${sp.creditTerm}` : "ยังไม่ตั้งเครดิตเทอม"} · มีใบ {nfmt(sp.months)} เดือน
                  </div>
                </td>
                <td className={`px-3 py-2.5 text-right ${NUM}`}>{nfmt(sp.dd)}</td>
                <td className={`px-3 py-2.5 text-right ${NUM}`}>{nfmt(sp.po)}</td>
                {AP_STAGES.map((st) => {
                  const n = sp.stages[st.key].n
                  const hot = (st.key === "wait" || st.key === "rejected") && n > 0
                  return (
                    <td key={st.key} title={n ? `${baht(sp.stages[st.key].amount)} บาท` : undefined}
                      className={`px-3 py-2.5 text-right ${NUM} ${n === 0 ? "" : hot ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                      {n === 0 ? <span className="text-gray-300 dark:text-gray-600">—</span> : nfmt(n)}
                    </td>
                  )
                })}
                <td className={`px-3 py-2.5 text-right font-medium ${NUM}`} title={baht(sp.amount)}>{bahtShort(sp.amount)}</td>
                <td className={`px-3 py-2.5 text-right ${NUM} ${sp.unpaidAmount > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-400"}`} title={baht(sp.unpaidAmount)}>
                  {sp.unpaidAmount > 0 ? bahtShort(sp.unpaidAmount) : "—"}
                </td>
                <td className={`px-3 py-2.5 text-right text-xs text-gray-500 ${NUM}`}>{sp.lastReceivedAt ? thaiDate(sp.lastReceivedAt) : "—"}</td>
                <td className="px-3 py-2.5 text-center">
                  <button onClick={() => void exportSupplier(sp.supplier)} disabled={Boolean(exporting)}
                    title={`ส่งออกทุกใบของ ${sp.supplier} ปี ${thaiYear(year)}`} aria-label="ส่งออก Excel"
                    className="rounded-md border border-gray-200 p-1.5 hover:bg-emerald-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-emerald-900/20">
                    <FileDown className={`h-4 w-4 ${exporting === sp.supplier ? "animate-pulse text-emerald-600" : ""}`} />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length > 0 && (
              <tr className="border-t-2 border-gray-200 bg-gray-50/60 font-medium dark:border-white/10 dark:bg-white/5">
                <td className="px-3 py-2.5">รวม</td>
                <td className={`px-3 py-2.5 text-right ${NUM}`}>{nfmt(total.dd)}</td>
                <td className={`px-3 py-2.5 text-right ${NUM}`}>{nfmt(total.po)}</td>
                {AP_STAGES.map((st) => (
                  <td key={st.key} className={`px-3 py-2.5 text-right ${NUM}`}>{nfmt(total.stages[st.key])}</td>
                ))}
                <td className={`px-3 py-2.5 text-right ${NUM}`} title={baht(total.amount)}>{bahtShort(total.amount)}</td>
                <td className={`px-3 py-2.5 text-right ${NUM}`} title={baht(total.unpaid)}>{bahtShort(total.unpaid)}</td>
                <td colSpan={2} />
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={AP_STAGES.length + 7} className="px-3 py-16 text-center text-gray-400">
                {q ? "ไม่มีเจ้าหนี้ที่ตรงกับคำค้น" : `ยังไม่มีใบรับของในปี ${thaiYear(year)}`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
