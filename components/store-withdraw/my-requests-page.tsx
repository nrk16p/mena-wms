"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CalendarClock, ClipboardCheck, Copy, MessageCircle, Plus, PackageMinus, RefreshCw, Search, Undo2, X } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RETURN_REASONS, WORK_TYPE_LABEL, isPendingFlow, matchesSearch, returnableQty, searchActive, workTypeFromKind } from "@/lib/store-withdraw/core"
import { lateMinutes, lateText } from "@/lib/store-withdraw/pending"
import { DOC_LABEL } from "./doc-ref-types"
import type { SwLine, SwRequest } from "@/lib/store-withdraw/types"
import { AttachButton, AttachChip, AttachPicker, doneIds, isUploading, type Picked } from "./attach-picker"
import { StatusChip } from "./status-chip"
import { ExtendDueDialog, SummaryView, type PendingReq } from "./summary-dialog"

type Req = Omit<SwRequest, "createdAt" | "updatedAt" | "returns" | "summaryDueAt" | "summary" | "settleGroups"> & PendingReq & {
  attachCount?: number
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
  const [ext, setExt] = useState<Req | null>(null)
  const [now, setNow] = useState(() => new Date())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const [q, setQ] = useState("")
  // ค้นย้อนหลัง: deepQ = คำที่ส่งไปค้นที่เซิร์ฟเวอร์ (ว่าง = ใช้รายการที่โหลดไว้) · เก็บใน ref ให้ poll รอบถัดไปรีเฟรชผลค้นด้วย
  const [deepQ, setDeepQ] = useState("")
  const [deepItems, setDeepItems] = useState<Req[]>([])
  const [deepBusy, setDeepBusy] = useState(false)
  const deepRef = useRef("")

  const load = useCallback(async () => {
    inflight.current?.abort()
    const ctl = new AbortController()
    inflight.current = ctl
    try {
      const r = await fetch("/api/store-withdraw?mine=1", { signal: ctl.signal })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดรายการไม่สำเร็จ")
      setItems(j.items ?? [])
      const dq = deepRef.current
      if (dq) {
        const r2 = await fetch(`/api/store-withdraw?mine=1&q=${encodeURIComponent(dq)}`, { signal: ctl.signal })
        const j2 = await r2.json().catch(() => ({}))
        if (r2.ok && deepRef.current === dq) setDeepItems(j2.items ?? [])
      }
      setNow(new Date())
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

  const onSearch = (v: string) => {
    setQ(v)
    if (deepRef.current && v.trim() !== deepRef.current) { deepRef.current = ""; setDeepQ(""); setDeepItems([]) }
  }

  const searchAll = async () => {
    const term = q.trim()
    setDeepBusy(true)
    try {
      const r = await fetch(`/api/store-withdraw?mine=1&q=${encodeURIComponent(term)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "ค้นย้อนหลังไม่สำเร็จ")
      deepRef.current = term
      setDeepQ(term)
      setDeepItems(j.items ?? [])
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ค้นย้อนหลังไม่สำเร็จ")
    } finally { setDeepBusy(false) }
  }

  const filtering = searchActive(q)
  const deepOn = filtering && deepQ !== "" && deepQ === q.trim()
  const shown = !filtering ? items : deepOn ? deepItems : items.filter((r) => matchesSearch(r, q))

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

      {!loading && (items.length > 0 || q !== "") && (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="search" aria-label="ค้นหาใบเบิก" data-testid="search" value={q} onChange={(e) => onSearch(e.target.value)}
              placeholder="ค้นทะเบียน / เบอร์รถ / เลข PR / เลขใบเบิก"
              className="w-full rounded-xl border border-[#E2E8E4] bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117] dark:text-white [&::-webkit-search-cancel-button]:hidden" />
            {q !== "" && (
              <button type="button" aria-label="ล้างคำค้น" data-testid="search-clear" onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:text-gray-700"><X size={16} /></button>
            )}
          </div>
          {filtering && (
            <p data-testid="search-count" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{deepOn ? `เจอ ${shown.length} ใบ จากการค้นย้อนหลัง` : `พบ ${shown.length} จาก ${items.length} ใบ`}</span>
              {!deepOn && (
                <button type="button" data-testid="search-deep" disabled={deepBusy} onClick={searchAll} className="font-medium text-[#1B8C4B] hover:underline disabled:opacity-60">
                  {deepBusy ? "กำลังค้น..." : "ค้นย้อนหลังทั้งหมด"}
                </button>
              )}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />)}</div>
      ) : items.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-12 text-center text-sm text-gray-500 dark:border-white/10">
          ยังไม่เคยยื่นคำขอ กด &quot;ขอเบิกใหม่&quot; ได้เลย
        </div>
      ) : filtering && shown.length === 0 ? (
        <div data-testid="search-empty" className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-12 text-center text-sm text-gray-500 dark:border-white/10">
          ไม่เจอใบที่ตรงกับ &quot;{q.trim()}&quot;{!deepOn && " ลองกด ค้นย้อนหลังทั้งหมด ถ้าใบอาจเก่ากว่านี้"}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => {
            const busy = busyNo === r.no
            const pending = isPendingFlow(r)
            // Mobile/PM ไม่มีขอคืน — ของเหลือกรอกตอนสรุปการใช้
            const canReturn = !pending && (r.status === "ISSUED" || r.status === "RECEIVED")
            const late = lateMinutes(r, now)
            return (
              <li key={r.no} className="rounded-2xl border border-[#EEF2F0] bg-white p-4 dark:border-white/10 dark:bg-[#161922]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.no}{r.plate && <span className="font-normal text-gray-500"> · {r.plate}</span>}</p>
                    <p className="text-xs text-gray-500">
                      <span data-testid="worktype" className="mr-1.5 rounded-full bg-[#1B8C4B]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#14532d] dark:text-emerald-300">{WORK_TYPE_LABEL[r.workType ?? workTypeFromKind(r.kind)]}</span>
                      {r.kind === "cutoff" ? "เบิกตัดยอด" : "เบิกจากสต๊อก"} · {r.inventoryName} · {fmt(r.createdAt)}
                      {r.mrCode && ` · ${r.mrCode}`}
                      {r.ref && <span data-testid="ref"> · อ้างอิง {DOC_LABEL[r.ref.type]} {r.ref.code}</span>}
                      {r.urgent && " · รถจอดรออะไหล่"}
                    </p>
                  </div>
                  <StatusChip status={r.status} />
                </div>

                {r.atms?.code && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300">เลข WD: <span className="font-medium">{r.atms.code}</span></p>}
                {r.status === "REJECTED" && r.rejectReason && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">เหตุผลที่สโตร์ปฏิเสธ: {r.rejectReason}</p>
                )}
                {r.status === "ISSUE_FAILED" && <p className="mt-2 text-xs text-red-600">สโตร์กำลังตามเรื่องกับ ATMS อยู่ ไม่ต้องยื่นใหม่</p>}
                {pending && r.summaryDueAt && (r.status === "NEW" || r.status === "PREPARING" || r.status === "READY" || r.status === "HANDED_OUT") && (
                  <p data-testid="due" data-late={late > 0 ? "1" : "0"} className={`mt-1.5 text-xs ${late > 0 ? "font-medium text-red-600" : "text-gray-600 dark:text-gray-300"}`}>
                    กำหนดสรุปยอด {fmt(r.summaryDueAt)}{(r.summaryExtensions ?? 0) > 0 && ` (เลื่อนแล้ว ${r.summaryExtensions} ครั้ง)`}
                    {late > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">เลยกำหนดสรุป {lateText(late)}</span>}
                  </p>
                )}
                {r.status === "SETTLE_FAILED" && <p className="mt-2 text-xs text-red-600">สโตร์กำลังตามเรื่องกับ ATMS อยู่ ไม่ต้องสรุปใหม่</p>}

                <ul className="mt-2 divide-y divide-[#EEF2F0] text-sm dark:divide-white/10">
                  {r.lines.map((l: SwLine, li) => (
                    <li key={`${l.skuId}-${li}`} className="flex items-start justify-between gap-3 py-1.5">
                      <span className="min-w-0"><span className="block truncate text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">{l.skuCode}</span></span>
                      <span className="shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                        ขอ {l.requestedQty}{l.issuedQty != null && ` · ได้ ${l.issuedQty}`}{l.short && <span className="text-amber-600"> (ไม่ครบ)</span>}
                        {l.returnedQty > 0 && <span className="block text-gray-500">คืนแล้ว {l.returnedQty}</span>}
                      </span>
                    </li>
                  ))}
                </ul>

                {r.summary && <SummaryView req={r} />}
                <AttachChip no={r.no} count={r.attachCount ?? 0} />

                {(r.status === "NEW" || r.status === "ISSUED" || canReturn || (pending && r.status === "HANDED_OUT")) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pending && r.status === "HANDED_OUT" && <Link href={summaryPath(r.no)} data-testid="summary-btn" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#1B8C4B] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#157a40]"><ClipboardCheck size={14} />สรุปการใช้</Link>}
                    {pending && r.status === "HANDED_OUT" && <button type="button" data-testid="extend-btn" disabled={busy} onClick={() => setExt(r)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-60 dark:border-white/10 dark:text-gray-200"><CalendarClock size={14} />เลื่อนกำหนด</button>}
                    {pending && r.status === "HANDED_OUT" && <ShareLink no={r.no} />}
                    {r.status === "NEW" && <button type="button" disabled={busy} onClick={() => cancel(r)} className="rounded-xl border border-red-200 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/30 dark:hover:bg-red-500/10">ยกเลิก</button>}
                    {r.status === "ISSUED" && r.kind === "stock" && <button type="button" disabled={busy} onClick={() => receive(r)} className="rounded-xl bg-[#1B8C4B] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-60">รับแล้ว</button>}
                    {canReturn && <button type="button" disabled={busy} onClick={() => setRet(r)} className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-60 dark:border-white/10 dark:text-gray-200"><Undo2 size={14} />ขอคืน</button>}
                  </div>
                )}
                {r.status !== "CANCELLED" && <div className="mt-2"><AttachButton no={r.no} context={r.status === "ISSUED" ? "receipt" : "other"} onDone={load} /></div>}
              </li>
            )
          })}
        </ul>
      )}

      {ret && <ReturnDialog req={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); load() }} />}
      {ext && <ExtendDueDialog req={ext} onClose={() => setExt(null)} onDone={() => { setExt(null); load() }} />}
    </div>
  )
}

const summaryPath = (no: string) => `/store-withdraw/${encodeURIComponent(no)}/summary`

/** ลิงก์หน้าสรุปการใช้ (เปิดบนมือถือ) · คัดลอก หรือส่งเข้าไลน์ตัวเอง/กลุ่ม แล้วกดเปิดจากมือถือ */
function ShareLink({ no }: { no: string }) {
  const [copied, setCopied] = useState(false)
  const abs = () => `${window.location.origin}${summaryPath(no)}`
  const copy = async () => {
    const url = abs()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt("คัดลอกลิงก์นี้", url)
    }
  }
  const cls = "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] dark:border-white/10 dark:text-gray-200"
  return (
    <>
      <button type="button" data-testid="copy-link" onClick={copy} className={cls}><Copy size={14} />{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</button>
      <a data-testid="line-link" href="#" onClick={(e) => { e.preventDefault(); window.open(`https://line.me/R/msg/text/?${encodeURIComponent(abs())}`, "_blank", "noopener,noreferrer") }} className={cls}>
        <MessageCircle size={14} />ส่งลิงก์เข้าไลน์
      </a>
    </>
  )
}

function ReturnDialog({ req, onClose, onDone }: { req: Req; onClose: () => void; onDone: () => void }) {
  const pending = pendingOf(req)
  const max = req.lines.map((l, i) => returnableQty(l, pending.get(i) ?? 0))
  const [qty, setQty] = useState<number[]>(() => req.lines.map(() => 0))
  const [reasonCode, setReasonCode] = useState("")
  const [reasonNote, setReasonNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<Picked[]>([])
  const claim = reasonCode === "claim"
  const total = qty.reduce((a, b) => a + b, 0)

  const submit = async () => {
    setBusy(true)
    try {
      await post(`/api/store-withdraw/${req.no}/returns`, { reasonCode, reasonNote: reasonNote.trim(), ...(doneIds(files).length ? { attachmentIds: doneIds(files) } : {}), lines: qty.map((q, lineIndex) => ({ lineIndex, qty: q })).filter((x) => x.qty > 0) })
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
            <li key={`${l.skuId}-${i}`} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm"><span className="block truncate text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">คืนได้อีก {max[i]}</span></span>
              <select aria-label={`จำนวนคืน ${l.skuName}`} disabled={max[i] === 0} value={qty[i]} onChange={(e) => setQty((c) => c.map((v, k) => (k === i ? Number(e.target.value) : v)))}
                className="w-24 shrink-0 rounded-[11px] border border-[#E2E8E4] bg-white px-2 py-2 text-sm dark:border-white/10 dark:bg-[#0f1117]">
                {Array.from({ length: Math.floor(max[i]) + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </li>
          ))}
        </ul>
        <fieldset>
          <legend className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">เหตุผลที่ขอคืน<span className="text-red-600"> *ต้องเลือก</span></legend>
          <div className="space-y-1.5">
            {RETURN_REASONS.map((r) => (
              <label key={r.code} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 ${reasonCode === r.code ? "border-[#1B8C4B] bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10"}`}>
                <input type="radio" name="sw-return-reason" value={r.code} checked={reasonCode === r.code} onChange={() => setReasonCode(r.code)} className="mt-1 h-4 w-4 accent-[#1B8C4B]" />
                <span className="min-w-0"><span className="block text-sm font-medium text-gray-900 dark:text-white">{r.label}</span><span className="block text-xs text-gray-500">{r.hint}</span></span>
              </label>
            ))}
          </div>
          <textarea aria-label="หมายเหตุเพิ่มเติม" rows={2} maxLength={300} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)}
            placeholder={reasonCode === "other" ? "พิมพ์เหตุผล (ต้องใส่)" : "หมายเหตุเพิ่มเติม (ไม่บังคับ)"}
            className="mt-2 w-full rounded-[11px] border border-[#E2E8E4] bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117] dark:text-white" />
        </fieldset>
        <AttachPicker no={req.no} context="return" items={files} onChange={(f) => setFiles(f)} required={claim}
          hint={claim ? "แนบรูปของที่ชำรุดหรือไม่ตรงรุ่น หรือใบเอกสาร (รูปหรือ PDF ไม่เกิน 10 MB)" : "แนบรูปประกอบได้ถ้ามี (ไม่บังคับ)"} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" onClick={submit} disabled={busy || total === 0 || !reasonCode || isUploading(files) || (claim && doneIds(files).length === 0) || (reasonCode === "other" && reasonNote.trim().length < 3)} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">ส่งคำขอคืน</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
