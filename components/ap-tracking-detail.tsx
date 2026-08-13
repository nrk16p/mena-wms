"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { AP_DOC_FIELDS, thaiDate } from "@/lib/ap-tracking"
import type { ApRow } from "@/components/ap-tracking-page"

type DepositItem = { parts_group?: string; item?: string; serial_no?: string; qty?: string; unit_price?: string; total?: string; remark?: string }
type LogEntry = { action?: string; field?: string; detail?: string; by?: string; at?: string }
type Detail = {
  tracking: { log?: LogEntry[] } | null
  items: DepositItem[]
  po: Record<string, unknown> | null
}

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }
const labelOf = (k: string) => AP_DOC_FIELDS.find((f) => f.key === k)?.label ?? k

export function ApTrackingDetail({ row, onClose }: { row: ApRow; onClose: () => void }) {
  const [data, setData]       = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)

  // fetch เมื่อเปิด/เปลี่ยนใบ — ธง alive กัน response ของใบเก่าที่ตอบช้ามาทับ state ของใบใหม่
  // เมื่อผู้ใช้ปิดแล้วเปิดใบอื่นเร็วๆ (การ์ดนี้เปิดครั้งเดียวต่อใบเสมอ เพราะ page mount ใหม่ทุกครั้งที่เปลี่ยนแถว)
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`)
        const d   = await res.json()
        if (alive && res.ok) setData(d)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [row.depositCode])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161a23] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div>
            <div className="text-lg font-bold" style={mitr}>{row.depositCode}</div>
            <div className="text-sm text-gray-500">
              {row.supplier} · {row.warehouse} · รับของ {thaiDate(row.receivedAt)}
              {row.creditTerm && <> · เครดิต {row.creditTerm} · ครบกำหนด {thaiDate(row.dueDate)}</>}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ใบสั่งซื้อ (PO)</h3>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {row.purchaseOrder
              ? <>{row.purchaseOrder} · ยอด PO {row.poTotal.toLocaleString("th-TH")} · กำหนดส่ง {thaiDate(row.poDue)} · {row.poStatus || "—"}</>
              : "ไม่มี PO ผูกกับใบนี้ในระบบ ATMS"}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>รายการสินค้า</h3>
          {loading ? <div className="text-sm text-gray-400">กำลังโหลด…</div> : (
            <div className="overflow-x-auto rounded-lg border dark:border-white/10">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left">รายการ</th>
                    <th className="px-2 py-1.5 text-right">จำนวน</th>
                    <th className="px-2 py-1.5 text-right">ราคา/หน่วย</th>
                    <th className="px-2 py-1.5 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((it, i) => (
                    <tr key={i} className="border-t dark:border-white/10">
                      <td className="px-2 py-1.5">{it.item}</td>
                      <td className="px-2 py-1.5 text-right">{it.qty}</td>
                      <td className="px-2 py-1.5 text-right">{it.unit_price}</td>
                      <td className="px-2 py-1.5 text-right">{it.total}</td>
                    </tr>
                  ))}
                  {(data?.items ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-4 text-center text-gray-400">ไม่มีรายการสินค้าในระบบ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ประวัติการติ๊ก/แก้ไข</h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {(data?.tracking?.log ?? []).slice().reverse().map((l, i) => (
              <li key={i}>
                {thaiDate((l.at ?? "").slice(0, 10))} · {l.action} {l.field && l.field !== "sent" && l.field !== "note" ? labelOf(l.field) : ""} {l.detail ?? ""} · โดย {l.by || "—"}
              </li>
            ))}
            {!loading && (data?.tracking?.log ?? []).length === 0 && <li className="text-gray-400">ยังไม่มีประวัติ</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
