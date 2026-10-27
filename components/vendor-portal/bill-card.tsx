"use client"
// การ์ดใบ DD หนึ่งใบ — เลข DD + ปุ่มคัดลอก · รถ · สถานะ · แตะเปิดรายการสินค้า (โหลดตอนเปิดครั้งแรก)
import { useState } from "react"
import { Check, ChevronDown, Copy, Truck } from "lucide-react"
import { VP_STATUS_LABEL, vpDueText, vpThaiDate, type VpBill, type VpItem } from "@/lib/vendor-portal"
import { VP_BADGE, baht } from "./ui"

type Items = { items: VpItem[]; subtotal: number; vat: number; net: number; pending: boolean }

export function BillCard({ bill, today, query, onCopy, onUnauthorized }: {
  bill: VpBill
  today: string
  query: string
  onCopy: (text: string, label: string) => Promise<boolean>
  onUnauthorized: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Items | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const copy = async () => {
    if (await onCopy(bill.depositCode, `คัดลอก ${bill.depositCode} แล้ว`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const loadItems = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/vendor-portal/bills/${encodeURIComponent(bill.depositCode)}/items`)
      if (res.status === 401) { onUnauthorized(); return }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d?.error ?? "โหลดรายการสินค้าไม่สำเร็จ"); return }
      setItems(d as Items)
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง")
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !items && !loading) loadItems()
  }

  const due = vpDueText(bill, today)
  const late = due.startsWith("ครบกำหนด")
  const badge = VP_BADGE[bill.status]
  const car = [bill.fleetNo ? `เบอร์ ${bill.fleetNo}` : "", bill.vehicle ?? ""].filter(Boolean).join(" · ")

  return (
    <article className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[15.5px] font-bold tracking-wide">{bill.depositCode}</span>
        <button onClick={copy} aria-label={`คัดลอกเลข ${bill.depositCode}`}
          className={`grid h-10 w-10 flex-none place-items-center rounded-lg transition ${copied ? "bg-emerald-100 text-emerald-700" : "bg-[#E8F1EC] text-[#046132] hover:bg-[#D5E8DD]"}`}>
          {copied ? <Check className="h-[18px] w-[18px]" /> : <Copy className="h-[18px] w-[18px]" />}
        </button>
        <span className="ml-auto whitespace-nowrap text-[15px] font-bold tabular-nums">{baht(bill.amount)}</span>
      </div>

      <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-slate-600">
        {car
          ? <span className="inline-flex items-center gap-1 font-semibold text-slate-900"><Truck className="h-3.5 w-3.5 text-slate-500" /><Highlight text={car} query={query} /></span>
          : <span>ไม่ระบุรถ</span>}
        <span>รับ {vpThaiDate(bill.receivedAt)}</span>
        {bill.supplierRefNo && <span>ใบแจ้งหนี้ <Highlight text={bill.supplierRefNo} query={query} /></span>}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.box}`}>
          <i className={`h-[7px] w-[7px] rounded-full ${badge.dot}`} />{VP_STATUS_LABEL[bill.status]}
        </span>
        {due && <span className={`text-xs ${late ? "text-amber-700" : "text-slate-600"}`}>{due}</span>}
      </div>

      <button onClick={toggle} aria-expanded={open}
        className="mt-2 flex h-10 w-full items-center justify-between border-t border-dashed border-slate-200 text-[12.5px] font-semibold text-[#046132]">
        <span>รายการสินค้า</span>
        <ChevronDown className={`h-[18px] w-[18px] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="pb-1">
          {loading && <div className="space-y-2 py-1">{[0, 1].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-slate-100" />)}</div>}
          {error && (
            <div className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}<button onClick={loadItems} className="font-semibold underline">ลองใหม่</button>
            </div>
          )}
          {items?.pending && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">รายการสินค้ากำลังอัปเดต ลองดูใหม่ภายหลัง</p>}
          {items && !items.pending && (
            <>
              {items.items.map((it, i) => (
                <div key={`${it.code}-${i}`} className="border-t border-slate-100 py-2 first:border-t-0 first:pt-0.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">{it.name || it.code || "-"}</span>
                    <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums">{it.total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                    {[it.code, it.qty ? `${it.qty} × ${it.unitPrice.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
              <div className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-600 tabular-nums">
                <div className="flex justify-between py-px"><span>รวมก่อน VAT</span><span>{baht(items.subtotal)}</span></div>
                {items.vat > 0 && <div className="flex justify-between py-px"><span>VAT</span><span>{baht(items.vat)}</span></div>}
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900"><span>รวมทั้งสิ้น</span><span>{baht(items.net)}</span></div>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  )
}

/** ไฮไลต์คำที่ค้น (เทียบแบบไม่สนตัวพิมพ์) */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded bg-yellow-200 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}
