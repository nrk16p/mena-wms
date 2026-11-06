"use client"

// แผงรายการในใบ PO / DD / PR: ติ๊กเลือกบรรทัด · แก้จำนวน · ป้ายค่าแรง/ไม่พบ SKU/ตัดไปแล้ว · ปุ่มนำเข้า
// เตือนอย่างเดียว ไม่บล็อก (ยกเว้นบรรทัดไม่มี SKU ที่ติ๊กไม่ได้ เพราะใบเบิกต้องใช้ sku id จริง)
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { swalError } from "@/lib/swal"
import type { DocDetailResp, DocHit, ImportLine } from "./doc-ref-types"

type Loaded = { key: string; data: DocDetailResp | null; error: string }

const num = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 3 })

export function DocLinesPanel({ doc, inventoryId, onImport }: {
  doc: DocHit
  inventoryId?: number
  onImport: (lines: ImportLine[]) => void
}) {
  const [retry, setRetry] = useState(0)
  const key = `${doc.kind}|${doc.id}|${inventoryId ?? ""}|${retry}`
  const [done, setDone] = useState<Loaded | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    const sp = new URLSearchParams()
    if (inventoryId) sp.set("inv", String(inventoryId))
    fetch(`/api/store-withdraw/lookup/doc/${doc.kind}/${doc.id}?${sp}`, { signal: ctl.signal })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "เปิดรายการในใบไม่สำเร็จ ลองใหม่อีกครั้ง"); return j as DocDetailResp })
      .then((data) => setDone({ key, data, error: "" }))
      .catch((e) => { if (!ctl.signal.aborted) setDone({ key, data: null, error: e instanceof Error ? e.message : "เปิดรายการในใบไม่สำเร็จ ลองใหม่อีกครั้ง" }) })
    return () => ctl.abort()
  }, [doc.kind, doc.id, inventoryId, key])

  const fresh = done?.key === key ? done : null
  if (!fresh) return <p className="flex items-center gap-2 rounded-md border border-dashed border-[#D5DCD8] px-3 py-5 text-sm text-gray-500 dark:border-white/10"><Loader2 size={15} className="animate-spin" />กำลังเปิดรายการในใบ…</p>
  if (!fresh.data) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
        <span>{fresh.error}</span>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium underline"><RefreshCw size={13} />ลองใหม่</button>
      </div>
    )
  }
  // key เปลี่ยน (ใบ/คลังใหม่) = ประกอบใหม่ทั้งแผง state เลือก/จำนวนจึงเริ่มใหม่
  return <Lines key={fresh.key} data={fresh.data} onImport={onImport} />
}

function Lines({ data, onImport }: { data: DocDetailResp; onImport: (l: ImportLine[]) => void }) {
  const { lines, warnings } = data
  const [sel, setSel] = useState<boolean[]>(() => lines.map((l) => l.skuId != null && l.qty > 0))
  const [qty, setQty] = useState<string[]>(() => lines.map((l) => String(l.qty)))
  const picked = useMemo(() => sel.filter(Boolean).length, [sel])

  const doImport = () => {
    const sum = new Map<number, ImportLine>()
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!sel[i] || l.skuId == null) continue
      const q = Number(qty[i])
      if (!(q > 0)) return swalError(`ใส่จำนวนที่จะเบิกของ ${l.skuCode} ให้มากกว่า 0 หรือเอาเครื่องหมายถูกออก`)
      const prev = sum.get(l.skuId)
      if (prev) prev.qty += q
      else sum.set(l.skuId, { skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, qty: q, stockQty: l.stockQty })
    }
    if (sum.size === 0) return swalError("ติ๊กเลือกรายการที่จะนำเข้าก่อน")
    onImport([...sum.values()])
  }

  return (
    <div data-testid="doclines" className="space-y-2.5 rounded-md border border-[#D5DCD8] p-3 dark:border-white/10">
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-px shrink-0" />{w}</li>)}
        </ul>
      )}
      {lines.length === 0 ? (
        <p className="py-3 text-center text-sm text-gray-500">ใบนี้ไม่มีรายการ</p>
      ) : (
        <ul className="divide-y divide-[#EEF2F0] dark:divide-white/10">
          {lines.map((l, i) => {
            const noSku = l.skuId == null
            const isPr = data.doc.kind === "pr"
            const limitQty = isPr ? l.docQty : l.receivedQty
            const over = Number(qty[i]) > limitQty
            return (
              <li key={i} data-testid="docline" className={`py-2.5 ${noSku ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <input type="checkbox" aria-label={`เลือก ${l.skuCode}`} disabled={noSku} checked={!!sel[i]}
                    onChange={(e) => setSel((c) => c.map((v, k) => (k === i ? e.target.checked : v)))}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#1B8C4B]" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-gray-900 dark:text-white">{l.skuName}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span>{l.skuCode}</span>
                      {l.isLabour && <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">ค่าแรง/บริการ</span>}
                      {noSku && <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">ไม่พบ SKU ในคลังนี้</span>}
                      {l.stockQty != null && <span>คงเหลือ {num(l.stockQty)}</span>}
                      {l.alreadyCut > 0 && <span className="text-amber-700 dark:text-amber-300">ตัดไปแล้ว {num(l.alreadyCut)} ({l.cutBy.join(", ")})</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{data.doc.kind === "po" ? `สั่ง ${num(l.docQty)} · รับแล้ว ${num(l.receivedQty)}` : data.doc.kind === "pr" ? `ขอซื้อ ${num(l.docQty)}` : `ในใบ ${num(l.docQty)}`}</p>
                  </div>
                  <input aria-label={`จำนวน ${l.skuCode}`} inputMode="decimal" disabled={noSku} value={qty[i]}
                    onChange={(e) => setQty((c) => c.map((v, k) => (k === i ? e.target.value : v)))}
                    className="w-20 shrink-0 rounded-md border border-[#D5DCD8] bg-white px-2.5 py-2 text-right text-sm text-gray-900 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] disabled:bg-gray-50 dark:border-white/10 dark:bg-[#0f1117] dark:text-white" />
                </div>
                {!noSku && over && (
                  <p data-testid="docline-over" className="ml-[26px] mt-1 text-xs text-orange-600 dark:text-orange-400">เกินจำนวน{isPr ? "ที่ขอ" : "ที่รับ"} ({num(limitQty)}) ใส่ต่อได้ แต่ตรวจอีกทีนะ</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-gray-500">เลือกอยู่ {picked} รายการ</span>
        <button type="button" onClick={doImport} disabled={picked === 0}
          className="rounded-md bg-[#1B8C4B] px-4 py-2 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50">
          นำเข้ารายการที่เลือก
        </button>
      </div>
    </div>
  )
}
