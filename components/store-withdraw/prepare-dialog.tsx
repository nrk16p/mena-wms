"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { validateLineEdit } from "@/lib/store-withdraw/core"
import { api, type QItem } from "./queue-types"

type Row = { checked: boolean; qty: string; short: boolean }
type Stock = Record<string, { qty: number; live: boolean }>

export function PrepareDialog({ item, onClose, onReady }: { item: QItem; onClose: () => void; onReady: (no: string) => Promise<void> | void }) {
  const [rows, setRows] = useState<Row[]>(() =>
    item.lines.map((l) => ({ checked: false, qty: String(l.issuedQty ?? l.requestedQty), short: l.short })))
  const [stock, setStock] = useState<Stock>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // สต๊อกสดจาก ATMS — ดึงครั้งเดียวตอนเปิด · พลาด = เงียบ (route ถอยไปใช้สำเนาให้เอง)
  useEffect(() => {
    const ctl = new AbortController()
    const items = item.lines.map((l) => `${l.skuCode}:${l.skuId}`).join(",")
    fetch(`/api/store-withdraw/live-stock?inv=${item.inventoryId}&items=${encodeURIComponent(items)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.stock) setStock(j.stock) })
      .catch(() => {})
    return () => ctl.abort()
  }, [item])

  const set = (i: number, p: Partial<Row>) => setRows((c) => c.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const problems = item.lines.map((l, i) => {
    const raw = rows[i].qty.trim()
    if (raw === "") return "ใส่จำนวนที่จ่าย (จ่ายไม่ได้ให้ใส่ 0 แล้วติ๊กของขาด)"
    const n = Number(raw)
    const bad = validateLineEdit(l, n)
    if (bad) return bad
    if (n < l.requestedQty && !rows[i].short) return "จ่ายน้อยกว่าที่ขอ — ติ๊ก \"ของขาด\" หรือแก้จำนวนให้ครบก่อน"
    return null
  })
  const allHandled = rows.every((r) => r.checked || r.short)
  const canSubmit = !busy && allHandled && problems.every((p) => p === null)

  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      await api(`/api/store-withdraw/${item.no}/lines`, {
        method: "PATCH",
        body: { lines: rows.map((r, index) => ({ index, issuedQty: Number(r.qty), short: r.short })) },
      })
      await onReady(item.no)
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-auto">
        <DialogHeader><DialogTitle>จัดของ {item.no} · {item.plate}</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500 dark:text-gray-400">ติ๊กเมื่อหยิบของแล้ว ถ้าของไม่พอแก้จำนวนแล้วติ๊ก &quot;ของขาด&quot; จ่ายตามที่มีจริง</p>
        <ul className="divide-y divide-[#EEF2F0] dark:divide-white/10">
          {item.lines.map((l, i) => {
            const st = stock[l.skuCode]
            return (
              <li key={l.skuId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <input type="checkbox" aria-label={`หยิบแล้ว ${l.skuName}`} checked={rows[i].checked} onChange={(e) => set(i, { checked: e.target.checked })} className="h-5 w-5 shrink-0 accent-[#1B8C4B]" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm text-gray-900 dark:text-white">{l.skuName}</p>
                  <p className="text-xs text-gray-500">
                    {l.skuCode} · ขอ {l.requestedQty}
                    {st && <span className={st.qty < l.requestedQty ? "text-amber-600" : ""}> · คงเหลือ {st.qty}{st.live ? "" : " (ล่าสุดที่ซิงก์)"}</span>}
                  </p>
                  {problems[i] && <p className="text-xs text-red-600">{problems[i]}</p>}
                </div>
                <input type="number" inputMode="decimal" min={0} max={l.requestedQty} step="any" aria-label={`จำนวนจ่าย ${l.skuName}`} value={rows[i].qty}
                  onChange={(e) => set(i, { qty: e.target.value })}
                  className="w-20 shrink-0 rounded-[11px] border border-[#E2E8E4] bg-white px-2 py-2 text-right text-sm dark:border-white/10 dark:bg-[#0f1117]" />
                <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                  <input type="checkbox" checked={rows[i].short} onChange={(e) => set(i, { short: e.target.checked })} className="h-4 w-4 accent-amber-500" />ของขาด
                </label>
              </li>
            )
          })}
        </ul>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}จัดครบ
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
