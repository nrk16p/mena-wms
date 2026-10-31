"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Plus, PackageMinus, RefreshCw, Undo2 } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { returnableQty } from "@/lib/store-withdraw/core"
import type { SwLine, SwRequest } from "@/lib/store-withdraw/types"
import { StatusChip } from "./status-chip"

type Req = Omit<SwRequest, "createdAt" | "updatedAt" | "returns"> & {
  createdAt: string
  returns: { status: string; lines: { lineIndex: number; qty: number }[] }[]
}

const POLL_MS = 10_000

const fmt = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง")
  return j
}

// ยอดคืนที่ค้างอยู่ (ขอแล้วยังไม่จบ) ต่อบรรทัด — returnedQty นับเฉพาะที่คืนเสร็จ
function pendingOf(r: Req): Map<number, number> {
  const m = new Map<number, number>()
  for (const o of r.returns) {
    if (o.status === "RETURNED") continue // ตรงกับ RETURN_HOLD ใน service.ts (รวม RETURN_FAILED)
    for (const l of o.lines) m.set(l.lineIndex, (m.get(l.lineIndex) ?? 0) + l.qty)
  }
  return m
}

export function MyRequestsPage() {
  const [items, setItems] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyNo, setBusyNo] = useState("")
  const [ret, setRet] = useState<Req | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inflight.current?.abort()
    const ctl = new AbortController()
    inflight.current = ctl
    try {
      const r = await fetch("/api/store-withdraw?mine=1", { signal: ctl.signal })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดรายการไม่สำเร็จ")
      setItems(j.items ?? [])
      setError("")
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "โหลดรายการไม่สำเร็จ")
    } finally {
      if (!ctl.signal.aborted) setLoading(false)
    }
  }, [])

  // poll ทุก 10 วิ เฉพาะตอนแท็บมองเห็นอยู่
  useEffect(() => {
    const start = () => { if (!timer.current) timer.current = setInterval(load, POLL_MS) }
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
    const onVis = () => { if (document.visibilityState === "visible") { load(); start() } else stop() }
    const first = setTimeout(load, 0)
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVis)
    return () => { clearTimeout(first); stop(); inflight.current?.abort(); document.removeEventListener("visibilitychange", onVis) }
  }, [load])

  const cancel = async (r: Req) => {
    const c = await swalConfirm(`ยกเลิกใบ ${r.no}?`, "สโตร์ยังไม่ได้รับงาน ยกเลิกได้เลย")
    if (!c.isConfirmed) return
    setBusyNo(r.no)
    try { await post(`/api/store-withdraw/${r.no}/cancel`); await swalToast("success", "ยกเลิกใบแล้ว"); await load() }
    catch (e) { swalError(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ"); load() }
    finally { setBusyNo("") }
  }

  const receive = async (r: Req) => {
    const c = await swalConfirm(`รับของใบ ${r.no} แล้วใช่ไหม?`, "กดแล้วใบนี้จะปิดเป็น รับแล้ว")
    if (!c.isConfirmed) return
    setBusyNo(r.no)
    try { await post(`/api/store-withdraw/${r.no}/receive`); await swalToast("success", "บันทึกว่ารับของแล้ว"); await load() }
    catch (e) { swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); load() }
    finally { setBusyNo("") }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]"><PackageMinus size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ขอเบิกอะไหล่ของฉัน</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">สถานะอัปเดตเองทุก 10 วินาที</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} aria-label="โหลดใหม่" className="rounded-xl border border-[#E2E8E4] p-2.5 text-gray-600 hover:text-[#1B8C4B] dark:border-white/10"><RefreshCw size={16} /></button>
          <Link href="/store-withdraw/new" className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#157a40]"><Plus size={16} />ขอเบิกใหม่</Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {loading ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />)}</div>
      ) : items.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-12 text-center text-sm text-gray-500 dark:border-white/10">
          ยังไม่เคยยื่นคำขอ กด &quot;ขอเบิกใหม่&quot; ได้เลย
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const busy = busyNo === r.no
            const canReturn = r.status === "ISSUED" || r.status === "RECEIVED"
            return (
              <li key={r.no} className="rounded-2xl border border-[#EEF2F0] bg-white p-4 dark:border-white/10 dark:bg-[#161922]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.no} <span className="font-normal text-gray-500">· {r.plate}</span></p>
                    <p className="text-xs text-gray-500">
                      {r.kind === "cutoff" ? "เบิกตัดยอด" : "เบิกจากสต๊อก"} · {r.inventoryName} · {fmt(r.createdAt)}
                      {r.mrCode && ` · ${r.mrCode}`}{r.urgent && " · รถจอดรออะไหล่"}
                    </p>
                  </div>
                  <StatusChip status={r.status} />
                </div>

                {r.atms?.code && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300">เลข WD: <span className="font-medium">{r.atms.code}</span></p>}
                {r.status === "REJECTED" && r.rejectReason && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">เหตุผลที่สโตร์ปฏิเสธ: {r.rejectReason}</p>
                )}
                {r.status === "ISSUE_FAILED" && <p className="mt-2 text-xs text-red-600">สโตร์กำลังตามเรื่องกับ ATMS อยู่ ไม่ต้องยื่นใหม่</p>}

                <ul className="mt-2 divide-y divide-[#EEF2F0] text-sm dark:divide-white/10">
                  {r.lines.map((l: SwLine) => (
                    <li key={l.skuId} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="min-w-0"><span className="block truncate text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">{l.skuCode}</span></span>
                      <span className="shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                        ขอ {l.requestedQty}{l.issuedQty != null && ` · ได้ ${l.issuedQty}`}{l.short && <span className="text-amber-600"> (ไม่ครบ)</span>}
                        {l.returnedQty > 0 && <span className="block text-gray-500">คืนแล้ว {l.returnedQty}</span>}
                      </span>
                    </li>
                  ))}
                </ul>

                {(r.status === "NEW" || r.status === "ISSUED" || canReturn) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === "NEW" && <button type="button" disabled={busy} onClick={() => cancel(r)} className="rounded-xl border border-red-200 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/30 dark:hover:bg-red-500/10">ยกเลิก</button>}
                    {r.status === "ISSUED" && r.kind === "stock" && <button type="button" disabled={busy} onClick={() => receive(r)} className="rounded-xl bg-[#1B8C4B] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-60">รับแล้ว</button>}
                    {canReturn && <button type="button" disabled={busy} onClick={() => setRet(r)} className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-60 dark:border-white/10 dark:text-gray-200"><Undo2 size={14} />ขอคืน</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {ret && <ReturnDialog req={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); load() }} />}
    </div>
  )
}

function ReturnDialog({ req, onClose, onDone }: { req: Req; onClose: () => void; onDone: () => void }) {
  const pending = pendingOf(req)
  const max = req.lines.map((l, i) => returnableQty(l, pending.get(i) ?? 0))
  const [qty, setQty] = useState<number[]>(() => req.lines.map(() => 0))
  const [busy, setBusy] = useState(false)
  const total = qty.reduce((a, b) => a + b, 0)

  const submit = async () => {
    setBusy(true)
    try {
      await post(`/api/store-withdraw/${req.no}/returns`, { lines: qty.map((q, lineIndex) => ({ lineIndex, qty: q })).filter((x) => x.qty > 0) })
      await swalToast("success", "ส่งคำขอคืนแล้ว รอสโตร์รับคืน")
      onDone()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ขอคืนไม่สำเร็จ")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>ขอคืนอะไหล่ {req.no}</DialogTitle></DialogHeader>
        <ul className="space-y-3">
          {req.lines.map((l, i) => (
            <li key={l.skuId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm"><span className="block truncate text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">คืนได้อีก {max[i]}</span></span>
              <select aria-label={`จำนวนคืน ${l.skuName}`} disabled={max[i] === 0} value={qty[i]} onChange={(e) => setQty((c) => c.map((v, k) => (k === i ? Number(e.target.value) : v)))}
                className="w-24 shrink-0 rounded-[11px] border border-[#E2E8E4] bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-[#0f1117]">
                {Array.from({ length: Math.floor(max[i]) + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" onClick={submit} disabled={busy || total === 0} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">ส่งคำขอคืน</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
