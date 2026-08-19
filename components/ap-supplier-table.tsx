"use client"

// มุมมองรายเจ้าหนี้ — ยุบใบ DD ของเดือนที่เปิดอยู่เป็นแถวละเจ้า: กี่ DD กี่ PO อยู่ขั้นไหนเท่าไหร่
// ตอบคำถาม "เจ้านี้เหลืองานค้างแค่ไหน" โดยไม่ต้องกรองชื่อทีละเจ้า · คิดจากแถวที่โหลดมาแล้ว
// (เดือนเดียว ~2,000 ใบ) จึงไม่มีคิวรีเพิ่ม — ขั้นของงานใช้ apStage ตัวเดียวกับแท็บ
import { useMemo } from "react"
import { AP_STAGES, apStage, type ApStage } from "@/lib/ap-tracking"
import { NUM, baht, bahtShort } from "@/components/ap-style"
import type { ApRow } from "@/components/ap-types"

type SupRow = {
  supplier: string
  creditTerm: string
  dd: number
  po: Set<string>
  amount: number
  stages: Record<ApStage, number>
}

export function ApSupplierTable({
  rows, loading, onPick,
}: {
  rows: ApRow[]
  loading: boolean
  // กดแถว = กลับไปมุมมองรายใบพร้อมกรองชื่อเจ้านั้น — เห็นสรุปแล้วเจาะรายใบต่อได้ทันที
  onPick: (supplier: string) => void
}) {
  const sups = useMemo(() => {
    const m = new Map<string, SupRow>()
    for (const r of rows) {
      const name = r.supplier || "(ไม่ระบุเจ้าหนี้)"
      let row = m.get(name)
      if (!row) {
        row = { supplier: name, creditTerm: r.creditTerm, dd: 0, po: new Set(), amount: 0,
          stages: Object.fromEntries(AP_STAGES.map((st) => [st.key, 0])) as Record<ApStage, number> }
        m.set(name, row)
      }
      row.dd++
      if (r.purchaseOrder) row.po.add(r.purchaseOrder)
      row.amount += r.amount
      row.stages[apStage(r)]++
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  }, [rows])

  const total = useMemo(() => ({
    dd: sups.reduce((n, s) => n + s.dd, 0),
    po: sups.reduce((n, s) => n + s.po.size, 0),
    amount: sups.reduce((n, s) => n + s.amount, 0),
    stages: Object.fromEntries(
      AP_STAGES.map((st) => [st.key, sups.reduce((n, s) => n + s.stages[st.key], 0)]),
    ) as Record<ApStage, number>,
  }), [sups])

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
          <tr>
            <th className="px-3 py-2.5 text-left font-medium">เจ้าหนี้ ({sups.length.toLocaleString("th-TH")} ราย)</th>
            <th className="px-3 py-2.5 text-right font-medium">DD</th>
            <th className="px-3 py-2.5 text-right font-medium">PO</th>
            {AP_STAGES.map((st) => (
              <th key={st.key} className="px-3 py-2.5 text-right font-medium">
                <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${st.dot}`} />{st.label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium">ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
            <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
              <td colSpan={AP_STAGES.length + 4} className="px-3 py-3">
                <div className="h-4 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
              </td>
            </tr>
          ))}
          {sups.map((sp) => (
            <tr key={sp.supplier} onClick={() => onPick(sp.supplier)} title="กดเพื่อดูรายใบของเจ้านี้"
              className="cursor-pointer border-t border-gray-100 hover:bg-emerald-50/60 dark:border-white/5 dark:hover:bg-emerald-900/10">
              <td className="max-w-[20rem] px-3 py-2.5">
                <div className="truncate font-medium" title={sp.supplier}>{sp.supplier}</div>
                <div className="text-[11px] text-gray-400">{sp.creditTerm ? `เครดิต ${sp.creditTerm}` : "ยังไม่ตั้งเครดิตเทอม"}</div>
              </td>
              <td className={`px-3 py-2.5 text-right ${NUM}`}>{sp.dd.toLocaleString("th-TH")}</td>
              <td className={`px-3 py-2.5 text-right ${NUM}`}>{sp.po.size.toLocaleString("th-TH")}</td>
              {AP_STAGES.map((st) => {
                const n = sp.stages[st.key]
                // ขั้นที่ยังไม่จบ (รอประกบ/ตีกลับ) = ของที่ต้องตามกับเจ้านี้ — เน้นแดง
                const hot = (st.key === "wait" || st.key === "rejected") && n > 0
                return (
                  <td key={st.key} className={`px-3 py-2.5 text-right ${NUM} ${n === 0 ? "" : hot ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                    {n === 0 ? <span className="text-gray-300 dark:text-gray-600">—</span> : n.toLocaleString("th-TH")}
                  </td>
                )
              })}
              <td className={`px-3 py-2.5 text-right font-medium ${NUM}`} title={baht(sp.amount)}>{bahtShort(sp.amount)}</td>
            </tr>
          ))}
          {!loading && sups.length > 0 && (
            <tr className="border-t-2 border-gray-200 bg-gray-50/60 font-medium dark:border-white/10 dark:bg-white/5">
              <td className="px-3 py-2.5">รวม</td>
              <td className={`px-3 py-2.5 text-right ${NUM}`}>{total.dd.toLocaleString("th-TH")}</td>
              <td className={`px-3 py-2.5 text-right ${NUM}`}>{total.po.toLocaleString("th-TH")}</td>
              {AP_STAGES.map((st) => (
                <td key={st.key} className={`px-3 py-2.5 text-right ${NUM}`}>{total.stages[st.key].toLocaleString("th-TH")}</td>
              ))}
              <td className={`px-3 py-2.5 text-right ${NUM}`} title={baht(total.amount)}>{bahtShort(total.amount)}</td>
            </tr>
          )}
          {!loading && sups.length === 0 && (
            <tr><td colSpan={AP_STAGES.length + 4} className="px-3 py-16 text-center text-gray-400">ไม่มีใบรับของในเดือนนี้</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
