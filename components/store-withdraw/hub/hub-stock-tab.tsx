"use client"

// แท็บคงเหลือ: คลัง · Sub · รหัส · ชื่อ · คงเหลือ · ราคา + ค้น
import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { distinctVendors, filterStockRows, showSubColumn, stockLevel, summarizeStock, type StockSort } from "@/lib/store-withdraw/hub-stock-view"
import { hubFetch, inputCls, num, tableWrap, th, thead, tr, type HubRow, type HubVendor } from "./hub-shared"

const LEVEL_CLS = { out: "text-red-700 dark:text-red-300", one: "text-amber-700 dark:text-amber-300", ok: "text-[#1B8C4B]" } as const

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

  const [vendor, setVendor] = useState("")
  const [sort, setSort] = useState<StockSort>("code")
  const subs = useMemo(() => distinctVendors(rows ?? []), [rows])
  const shown = useMemo(() => (rows ? filterStockRows(rows, { q, vendor, names: vendors, sort }) : []), [rows, q, vendor, vendors, sort])
  const sum = useMemo(() => summarizeStock(shown), [shown])
  const subCol = showSubColumn(subs.length, vendor)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="ค้นหา" className={`${inputCls} w-full sm:w-80`} placeholder="ค้นรหัส ชื่ออะไหล่ หรือ Sub" value={q} onChange={(e) => setQ(e.target.value)} />
        {subs.length >= 2 && (
          <select aria-label="กรอง Sub" className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">Sub: ทั้งหมด</option>
            {subs.map((c) => <option key={c} value={c}>{vendors[c] ?? c}</option>)}
          </select>
        )}
        <label className="flex min-h-10 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={sort === "qtyAsc"} onChange={(e) => setSort(e.target.checked ? "qtyAsc" : "code")} />
          เรียงตามคงเหลือ น้อย→มาก
        </label>
      </div>
      {rows && shown.length > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {num(sum.count)} รายการ · รวม {num(sum.qty)} หน่วย
          {sum.low > 0 && <span className="ml-2 font-medium text-amber-700 dark:text-amber-300">ใกล้หมด {num(sum.low)} รายการ</span>}
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {!rows && !error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังโหลด…</p>}
      {rows && shown.length === 0 && <p className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10">{rows.length > 0 ? "ไม่เจอที่ค้น ลองเปลี่ยนคำค้นหรือ Sub" : "ยังไม่มีอะไหล่ Hub ในคลังนี้"}</p>}
      {shown.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr>{subCol && <th className={th}>Sub</th>}<th className={th}>รหัส</th><th className={th}>ชื่อ</th><th className={`${th} text-right`}>คงเหลือ</th><th className={th}>หน่วย</th><th className={`${th} text-right`}>ราคา</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.vendorCode}|${r.skuId}`} className={`${tr} ${r.active ? "" : "opacity-50"}`}>
                  {subCol && <td className={th}>{vendors[r.vendorCode] ?? r.vendorCode}</td>}
                  <td className={th}>{r.skuCode}</td>
                  <td className={th}>{r.skuName}</td>
                  <td className={`${th} text-right font-medium ${LEVEL_CLS[stockLevel(r.qty)]}`}>
                    {stockLevel(r.qty) === "out" && <span className="mr-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-300">หมด</span>}
                    {stockLevel(r.qty) === "one" && <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">เหลือ 1</span>}
                    {num(r.qty)}
                  </td>
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
