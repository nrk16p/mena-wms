"use client"

// แท็บคงเหลือ: คลัง · Sub · รหัส · ชื่อ · คงเหลือ · ราคา + ค้น
import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { hubFetch, inputCls, num, tableWrap, th, thead, tr, type HubRow, type HubVendor } from "./hub-shared"

export function HubStockTab({ inventoryId }: { inventoryId: number | null }) {
  const [rows, setRows] = useState<HubRow[] | null>(null)
  const [vendors, setVendors] = useState<Record<string, string>>({})
  const [q, setQ] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!inventoryId) return
    let dead = false
    Promise.all([
      hubFetch<{ rows: HubRow[] }>(`/api/store-withdraw/hub/stock?inventoryId=${inventoryId}`),
      hubFetch<{ rows: HubVendor[] }>("/api/store-withdraw/hub/master?type=vendors"),
    ]).then(([s, v]) => { if (dead) return; setRows(s.rows); setVendors(Object.fromEntries(v.rows.map((x) => [x.code, x.name]))) })
      .catch((e) => { if (!dead) setError(e instanceof Error ? e.message : "โหลดยอดไม่สำเร็จ") })
    return () => { dead = true }
  }, [inventoryId])

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!rows) return []
    return k ? rows.filter((r) => `${r.skuCode} ${r.skuName} ${r.vendorCode} ${vendors[r.vendorCode] ?? ""}`.toLowerCase().includes(k)) : rows
  }, [rows, q, vendors])

  return (
    <div className="space-y-3">
      <input aria-label="ค้นหา" className={`${inputCls} w-full sm:w-80`} placeholder="ค้นรหัส ชื่ออะไหล่ หรือ Sub" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {!rows && !error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังโหลด…</p>}
      {rows && shown.length === 0 && <p className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10">ยังไม่มีอะไหล่ Hub ในคลังนี้</p>}
      {shown.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr><th className={th}>Sub</th><th className={th}>รหัส</th><th className={th}>ชื่อ</th><th className={`${th} text-right`}>คงเหลือ</th><th className={th}>หน่วย</th><th className={`${th} text-right`}>ราคา</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.vendorCode}|${r.skuId}`} className={`${tr} ${r.active ? "" : "opacity-50"}`}>
                  <td className={th}>{vendors[r.vendorCode] ?? r.vendorCode}</td>
                  <td className={th}>{r.skuCode}</td>
                  <td className={th}>{r.skuName}</td>
                  <td className={`${th} text-right font-medium ${r.qty > 0 ? "text-[#1B8C4B]" : "text-red-600"}`}>{num(r.qty)}</td>
                  <td className={th}>{r.unit}</td>
                  <td className={`${th} text-right`}>{r.price == null ? "-" : num(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
