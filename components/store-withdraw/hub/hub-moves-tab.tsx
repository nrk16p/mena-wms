"use client"

// แท็บความเคลื่อนไหว: กรอง Sub + ช่วงวันที่ + ปุ่ม Excel
import { useCallback, useEffect, useState } from "react"
import { Download, Loader2, Search } from "lucide-react"
import { btnCls, hubFetch, inputCls, num, tableWrap, th, thead, tr, type HubVendor } from "./hub-shared"

const MOVE_LABEL = { receive: "รับเข้า", issue: "จ่ายออก", return: "คืนเข้า", adjust: "ปรับยอด" } as const
type Move = { type: keyof typeof MOVE_LABEL; vendorCode: string; vendorName: string; skuCode: string; qty: number; refNo: string; by: { email: string; name: string }; at: string }
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
const fmt = (iso: string) => new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })

export function HubMovesTab() {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(() => ymd(new Date()))
  const [vendorCode, setVendorCode] = useState("")
  const [vendors, setVendors] = useState<HubVendor[]>([])
  const [rows, setRows] = useState<Move[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const qs = useCallback(() => {
    const p = new URLSearchParams({ from: `${from}T00:00:00+07:00`, to: `${to}T23:59:59+07:00` })
    if (vendorCode) p.set("vendorCode", vendorCode)
    return p.toString()
  }, [from, to, vendorCode])

  const search = useCallback(async () => {
    setLoading(true); setError("")
    try { setRows((await hubFetch<{ rows: Move[] }>(`/api/store-withdraw/hub/moves?${qs()}`)).rows) }
    catch (e) { setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"); setRows(null) }
    finally { setLoading(false) }
  }, [qs])

  useEffect(() => {
    hubFetch<{ rows: HubVendor[] }>("/api/store-withdraw/hub/master?type=vendors").then((j) => setVendors(j.rows)).catch(() => {})
    const t = setTimeout(() => { void search() }, 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
        <label className="text-xs text-gray-500">ตั้งแต่<input type="date" aria-label="ตั้งแต่วันที่" className={`${inputCls} mt-1 block`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label className="text-xs text-gray-500">ถึง<input type="date" aria-label="ถึงวันที่" className={`${inputCls} mt-1 block`} value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
        <label className="text-xs text-gray-500">Sub
          <select aria-label="Sub" className={`${inputCls} mt-1 block`} value={vendorCode} onChange={(e) => setVendorCode(e.target.value)}>
            <option value="">ทุก Sub</option>
            {vendors.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
          </select></label>
        <button type="submit" disabled={loading} className={btnCls}>{loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}ค้นหา</button>
        <a href={`/api/store-withdraw/hub/moves?${qs()}&format=xlsx`} data-testid="export" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2.5 text-sm text-gray-700 hover:text-[#1B8C4B] dark:border-white/10 dark:text-gray-200"><Download size={14} />Excel</a>
      </form>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {rows && rows.length === 0 && <p className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10">ไม่มีความเคลื่อนไหวในช่วงนี้</p>}
      {rows && rows.length >= 2000 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">แสดงได้สูงสุด 2,000 แถว ลดช่วงวันที่ให้แคบลงจะเห็นครบ</p>}
      {rows && rows.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr><th className={th}>วันที่</th><th className={th}>ประเภท</th><th className={th}>Sub</th><th className={th}>รหัส</th><th className={`${th} text-right`}>จำนวน</th><th className={th}>เลขอ้างอิง</th><th className={th}>โดย</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={tr}>
                <td className={th}>{fmt(r.at)}</td><td className={th}>{MOVE_LABEL[r.type]}</td><td className={th}>{r.vendorName}</td><td className={th}>{r.skuCode}</td>
                <td className={`${th} text-right ${r.qty < 0 ? "text-red-600" : "text-[#1B8C4B]"}`}>{r.qty > 0 ? "+" : ""}{num(r.qty)}</td>
                <td className={th}>{r.refNo}</td><td className={th}>{r.by.name || r.by.email}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
