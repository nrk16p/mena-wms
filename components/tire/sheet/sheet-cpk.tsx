"use client"

/**
 * Dashboard CPK — pivot ยางนอกกลุ่มอาการ "ปกติ" แยกตามยี่ห้อ
 * CPK จริง = ราคารวม ÷ ระยะใช้รวม (ถ่วงตามระยะ ไม่ให้เส้นที่วิ่งน้อยดึงค่าเพี้ยน)
 * ใช้ตัวเลขชุดเดียวกับตาราง: ราคา และ "ผลต่างเลขไมล์วันจองยาง" (= บาท/กม. ในชีต)
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Download, ChevronRight, ChevronDown } from "lucide-react"
import * as XLSX from "xlsx"
import { SIZES, fmtDate } from "@/lib/tyre-sheet"

type CpkRow = {
  id: string; size: string | null; bookingDate: string | null; plate: string; position: string; mrNo: string
  oldSerial: string; brand: string; headTail: string; price: number | null; km: number | null
  mileagePrev: number | null; ratedKm: number | null; bpk: number | null
}
type Split = "none" | "size" | "headTail"
type Agg = { n: number; price: number; km: number; rated: number; ratedPrice: number; ratedN: number; bpkSum: number }

const NO_BRAND = "(ไม่ระบุยี่ห้อ)"
const emptyAgg = (): Agg => ({ n: 0, price: 0, km: 0, rated: 0, ratedPrice: 0, ratedN: 0, bpkSum: 0 })
function add(a: Agg, r: CpkRow) {
  a.n++
  a.price += r.price!
  a.km += r.km!
  a.bpkSum += r.price! / r.km!
  if (r.ratedKm && r.ratedKm > 0) { a.rated += r.ratedKm; a.ratedPrice += r.price!; a.ratedN++ }
}
const cpk = (a?: Agg) => (a && a.km > 0 ? a.price / a.km : null)
const cpkRated = (a?: Agg) => (a && a.rated > 0 ? a.ratedPrice / a.rated : null)
const pctRated = (a?: Agg) => (a && a.rated > 0 ? a.km / a.rated : null) // ระยะใช้รวม ÷ ระยะกำหนดรวม (เฉพาะเส้นที่มีระยะกำหนด ใกล้เคียงพอ)

const f0 = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "-" : Math.round(v).toLocaleString("th-TH"))
const f4 = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "-" : v.toFixed(4))
const fPct = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "-" : `${Math.round(v * 100)}%`)

const ymNow = () => new Date().toISOString().slice(0, 7)
const ymStartOfYear = () => `${new Date().getFullYear()}-01`

export function SheetCpk() {
  const [rows, setRows] = useState<CpkRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [from, setFrom] = useState(ymStartOfYear())
  const [to, setTo] = useState(ymNow())
  const [size, setSize] = useState("")
  const [ht, setHt] = useState("")
  const [split, setSplit] = useState<Split>("size")
  const [sortBy, setSortBy] = useState<"n" | "cpk">("n")
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr("")
    try {
      const q = new URLSearchParams({ symptom: "ปกติ" })
      if (from) q.set("from", from)
      if (to) q.set("to", to)
      const res = await fetch(`/api/tyre-sheet/cpk?${q}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `โหลดไม่สำเร็จ (${res.status})`)
      setRows((await res.json()).rows ?? [])
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const htOptions = useMemo(() => [...new Set(rows.map((r) => r.headTail).filter(Boolean))].sort(), [rows])

  // ตัวกรอง + แยกแถวที่ไม่นับ
  const { used, skipped } = useMemo(() => {
    const used: CpkRow[] = []
    const skipped = { noPrice: 0, noKm: 0 }
    for (const r of rows) {
      if (size && r.size !== size) continue
      if (ht && r.headTail !== ht) continue
      if (r.price === null || r.price <= 1) { skipped.noPrice++; continue }
      if (r.km === null || r.km <= 0) { skipped.noKm++; continue }
      used.push(r)
    }
    return { used, skipped }
  }, [rows, size, ht])

  const splitKey = (r: CpkRow) => (split === "size" ? r.size || "-" : split === "headTail" ? r.headTail || "-" : "")
  const splitValues = useMemo(
    () => (split === "none" ? [] : [...new Set(used.map(splitKey))].sort()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [used, split],
  )

  const pivot = useMemo(() => {
    const m = new Map<string, { total: Agg; parts: Map<string, Agg>; rows: CpkRow[] }>()
    const grand = { total: emptyAgg(), parts: new Map<string, Agg>() }
    for (const r of used) {
      const b = r.brand || NO_BRAND
      if (!m.has(b)) m.set(b, { total: emptyAgg(), parts: new Map(), rows: [] })
      const g = m.get(b)!
      add(g.total, r); add(grand.total, r); g.rows.push(r)
      if (split !== "none") {
        const k = splitKey(r)
        if (!g.parts.has(k)) g.parts.set(k, emptyAgg())
        if (!grand.parts.has(k)) grand.parts.set(k, emptyAgg())
        add(g.parts.get(k)!, r); add(grand.parts.get(k)!, r)
      }
    }
    const list = [...m.entries()].map(([brand, v]) => ({ brand, ...v }))
    list.sort((a, b) => sortBy === "cpk" ? (cpk(a.total) ?? 9) - (cpk(b.total) ?? 9) : b.total.n - a.total.n)
    return { list, grand }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [used, split, sortBy])

  // ยี่ห้อที่ CPK ต่ำสุด (นับเฉพาะที่มี ≥ 5 เส้น กันตัวอย่างน้อยหลอกตา)
  const bestBrand = useMemo(() => {
    const ok = pivot.list.filter((g) => g.total.n >= 5)
    return ok.length ? ok.reduce((a, b) => ((cpk(a.total) ?? 9) <= (cpk(b.total) ?? 9) ? a : b)).brand : null
  }, [pivot])
  const maxCpk = Math.max(0, ...pivot.list.map((g) => cpk(g.total) ?? 0))

  const exportXlsx = () => {
    const head = ["ยี่ห้อ", ...splitValues.flatMap((s) => [`${s} เส้น`, `${s} CPK`]), "จำนวนเส้น", "ราคาเฉลี่ย", "ระยะใช้เฉลี่ย (กม.)", "ระยะกำหนดเฉลี่ย (กม.)", "CPK จริง (บาท/กม.)", "CPK เฉลี่ยรายเส้น", "CPK ตามกำหนด", "% ของระยะกำหนด"]
    const line = (name: string, t: Agg, parts: Map<string, Agg>) => [
      name,
      ...splitValues.flatMap((s) => [parts.get(s)?.n ?? 0, cpk(parts.get(s))]),
      t.n, t.price / t.n, t.km / t.n, t.ratedN ? t.rated / t.ratedN : null, cpk(t), t.bpkSum / t.n, cpkRated(t), pctRated(t),
    ]
    const sum = [head, ...pivot.list.map((g) => line(g.brand, g.total, g.parts)), line("รวม", pivot.grand.total, pivot.grand.parts)]
    const detail = [
      ["ยี่ห้อ", "ไซซ์", "หัว/หาง", "วันที่จอง", "ทะเบียน", "ตำแหน่งยาง", "NO.ใบแจ้งซ่อม", "เบอร์ยางเก่า", "ราคา", "ระยะใช้ (กม.)", "ระยะกำหนด", "บาท/กม."],
      ...used.map((r) => [r.brand || NO_BRAND, r.size ?? "", r.headTail, fmtDate(r.bookingDate), r.plate, r.position, r.mrNo, r.oldSerial, r.price, r.km, r.ratedKm, r.price! / r.km!]),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "สรุปตามยี่ห้อ")
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "รายเส้น")
    XLSX.writeFile(wb, `CPK ยางปกติ ตามยี่ห้อ ${from}_${to}.xlsx`)
  }

  const sel = "px-2 py-1.5 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-900 text-sm"
  const th = "px-2 py-2 text-right font-medium whitespace-nowrap"
  const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
  const t = pivot.grand.total

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
        สรุปต้นทุนยางต่อกิโลเมตร (CPK) เฉพาะยางที่เปลี่ยนเพราะใช้หมดตามปกติ (กลุ่มอาการ “ปกติ”) แยกตามยี่ห้อ
        CPK จริงคิดจากราคารวมหารระยะใช้รวมของยี่ห้อนั้น ยิ่งต่ำยิ่งคุ้ม
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">จองตั้งแต่เดือน</span>
          <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={sel} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">ถึงเดือน</span>
          <input type="month" value={to} onChange={(e) => setTo(e.target.value)} className={sel} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">ไซซ์</span>
          <select value={size} onChange={(e) => setSize(e.target.value)} className={sel}>
            <option value="">ทั้งหมด</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">หัว / หาง</span>
          <select value={ht} onChange={(e) => setHt(e.target.value)} className={sel}>
            <option value="">ทั้งหมด</option>{htOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">แตกคอลัมน์ตาม</span>
          <select value={split} onChange={(e) => setSplit(e.target.value as Split)} className={sel}>
            <option value="none">ไม่แตก</option><option value="size">ไซซ์</option><option value="headTail">หัว / หาง</option>
          </select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-gray-600 dark:text-gray-300">เรียงตาม</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "n" | "cpk")} className={sel}>
            <option value="n">จำนวนเส้นมากสุด</option><option value="cpk">CPK ต่ำสุด</option>
          </select></label>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/5">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> โหลดใหม่
        </button>
        <button onClick={exportXlsx} disabled={!used.length} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
          <Download className="w-4 h-4" /> Excel
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl">
        {[
          ["ยางที่นับ", `${f0(t.n)} เส้น`],
          ["ยี่ห้อ", `${pivot.list.length} ยี่ห้อ`],
          ["CPK จริง รวมทุกยี่ห้อ", `${f4(cpk(t))} บาท/กม.`],
          ["ยี่ห้อ CPK ต่ำสุด (≥ 5 เส้น)", bestBrand ? `${bestBrand} · ${f4(cpk(pivot.list.find((g) => g.brand === bestBrand)?.total))}` : "-"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-3 py-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">{k}</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-200">
            {split !== "none" && (
              <tr className="border-b border-gray-200 dark:border-white/10">
                <th />
                {splitValues.map((s) => <th key={s} colSpan={2} className="px-2 py-1 text-center font-semibold border-l border-gray-200 dark:border-white/10">{s}</th>)}
                <th colSpan={7} className="px-2 py-1 text-center font-semibold border-l border-gray-200 dark:border-white/10">รวม</th>
              </tr>
            )}
            <tr>
              <th className="px-2 py-2 text-left font-medium">ยี่ห้อ</th>
              {splitValues.map((s) => (
                <Fragment key={s}>
                  <th className={`${th} border-l border-gray-200 dark:border-white/10`}>เส้น</th>
                  <th className={th}>CPK</th>
                </Fragment>
              ))}
              <th className={`${th} border-l border-gray-200 dark:border-white/10`}>เส้น</th>
              <th className={th}>ราคาเฉลี่ย</th>
              <th className={th}>ระยะใช้เฉลี่ย</th>
              <th className={th} title="ราคารวม ÷ ระยะใช้รวม">CPK จริง</th>
              <th className={th} title="ค่าเฉลี่ยของ บาท/กม. รายเส้น">CPK เฉลี่ยรายเส้น</th>
              <th className={th} title="ราคารวม ÷ ระยะกำหนดรวม">CPK ตามกำหนด</th>
              <th className={th} title="ระยะใช้รวม ÷ ระยะกำหนดรวม">% ระยะกำหนด</th>
            </tr>
          </thead>
          <tbody>
            {pivot.list.map((g) => {
              const isOpen = open === g.brand
              const c = cpk(g.total)
              const few = g.total.n < 5
              return (
                <Fragment key={g.brand}>
                  <tr className={`border-t border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 ${few ? "text-gray-500 dark:text-gray-400" : ""}`}>
                    <td className="px-2 py-1.5 text-left whitespace-nowrap">
                      <button onClick={() => setOpen(isOpen ? null : g.brand)} className="inline-flex items-center gap-1 hover:underline">
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className={g.brand === bestBrand ? "font-semibold text-emerald-700 dark:text-emerald-400" : ""}>{g.brand}</span>
                        {few && <span className="text-[11px] text-amber-600 dark:text-amber-400">ตัวอย่างน้อย</span>}
                      </button>
                    </td>
                    {splitValues.map((s) => {
                      const p = g.parts.get(s)
                      return (
                        <Fragment key={s}>
                          <td className={`${td} border-l border-gray-100 dark:border-white/5`}>{p ? f0(p.n) : ""}</td>
                          <td className={td}>{p ? f4(cpk(p)) : ""}</td>
                        </Fragment>
                      )
                    })}
                    <td className={`${td} border-l border-gray-100 dark:border-white/5`}>{f0(g.total.n)}</td>
                    <td className={td}>{f0(g.total.price / g.total.n)}</td>
                    <td className={td}>{f0(g.total.km / g.total.n)}</td>
                    <td className={`${td} font-semibold`}>
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden md:block w-16 h-1.5 rounded bg-gray-100 dark:bg-white/10 overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${maxCpk && c ? (c / maxCpk) * 100 : 0}%` }} />
                        </div>
                        {f4(c)}
                      </div>
                    </td>
                    <td className={td}>{f4(g.total.bpkSum / g.total.n)}</td>
                    <td className={td}>{f4(cpkRated(g.total))}</td>
                    <td className={td}>{fPct(pctRated(g.total))}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8 + splitValues.length * 2} className="bg-gray-50/70 dark:bg-white/[0.02] px-3 py-2">
                        <div className="max-h-80 overflow-auto">
                          <table className="text-xs min-w-full">
                            <thead className="text-gray-500 dark:text-gray-400">
                              <tr>{["วันที่จอง", "ไซซ์", "หัว/หาง", "ทะเบียน", "ตำแหน่งยาง", "ใบแจ้งซ่อม", "เบอร์ยางเก่า", "ราคา", "ระยะใช้", "ระยะกำหนด", "บาท/กม."].map((h) => <th key={h} className="px-2 py-1 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r) => (
                                <tr key={r.id} className="border-t border-gray-100 dark:border-white/5">
                                  <td className="px-2 py-1 whitespace-nowrap">{fmtDate(r.bookingDate)}</td>
                                  <td className="px-2 py-1">{r.size}</td>
                                  <td className="px-2 py-1">{r.headTail}</td>
                                  <td className="px-2 py-1 whitespace-nowrap">{r.plate}</td>
                                  <td className="px-2 py-1 whitespace-nowrap">{r.position}</td>
                                  <td className="px-2 py-1">{r.mrNo}</td>
                                  <td className="px-2 py-1">{r.oldSerial}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{f0(r.price)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{f0(r.km)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{f0(r.ratedKm)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{f4(r.price! / r.km!)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!pivot.list.length && !loading && (
              <tr><td colSpan={8 + splitValues.length * 2} className="px-3 py-6 text-center text-gray-500">ไม่มียางกลุ่มอาการปกติในช่วงนี้</td></tr>
            )}
          </tbody>
          {pivot.list.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-white/5 font-semibold border-t-2 border-gray-200 dark:border-white/10">
              <tr>
                <td className="px-2 py-2 text-left">รวม</td>
                {splitValues.map((s) => {
                  const p = pivot.grand.parts.get(s)
                  return (
                    <Fragment key={s}>
                      <td className={`${td} border-l border-gray-200 dark:border-white/10`}>{f0(p?.n)}</td>
                      <td className={td}>{f4(cpk(p))}</td>
                    </Fragment>
                  )
                })}
                <td className={`${td} border-l border-gray-200 dark:border-white/10`}>{f0(t.n)}</td>
                <td className={td}>{f0(t.price / t.n)}</td>
                <td className={td}>{f0(t.km / t.n)}</td>
                <td className={td}>{f4(cpk(t))}</td>
                <td className={td}>{f4(t.bpkSum / t.n)}</td>
                <td className={td}>{f4(cpkRated(t))}</td>
                <td className={td}>{fPct(pctRated(t))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 max-w-3xl">
        <p>ไม่นับ {f0(skipped.noPrice)} เส้นที่ราคาว่างหรือใส่ 0/1 ไว้ และ {f0(skipped.noKm)} เส้นที่ไม่มีระยะใช้ (เลขไมล์วันจองว่าง)</p>
        <p>ระยะใช้ = ผลต่างเลขไมล์วันจองยาง ตัวเดียวกับที่ใช้คิดบาท/กม. ในตาราง · ยี่ห้อที่มีไม่ถึง 5 เส้นขึ้นตัวจาง ค่ายังแกว่งได้มาก · กดชื่อยี่ห้อเพื่อดูรายเส้น</p>
      </div>
    </div>
  )
}
