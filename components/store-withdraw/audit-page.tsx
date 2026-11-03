"use client"

// ตรวจสอบย้อนหลังงานเบิก: เลือกช่วงวันที่ → ตารางใบ → กดแถวดูไทม์ไลน์ + ไฟล์แนบ + สถานะโซ่ log · Export Excel
import { useCallback, useEffect, useState } from "react"
import { Download, FileText, Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WORK_TYPE_LABEL } from "@/lib/store-withdraw/core"
import type { SwStatus } from "@/lib/store-withdraw/types"
import { StatusChip } from "./status-chip"

type Row = {
  no: string; createdAt: string; workType: string; workTypeLabel: string; status: string; requester: string; plate: string; mr: string | null
  lines: string; wd: string[]; dd: string[]; events: number; attachments: number; chainOk: boolean
}
type Detail = {
  no: string; status: string; workTypeLabel: string; requester: { email: string; name: string; via: string }; plate: string; mrCode: string | null
  ref: { type: string; code: string } | null; createdAt: string
  lines: { skuCode: string; skuName: string; requestedQty: number; issuedQty: number | null; returnedQty: number; mrItemLabel: string | null }[]
  returns: { rid: string; status: string; reason: string | null; lines: { lineIndex: number; qty: number }[]; requestedBy: string; code: string | null; url: string | null }[]
  atms: { type: string; code: string; label: string; url: string | null }[]
  timeline: { seq: number | null; action: string; from: string | null; to: string | null; actor: string; via: string; at: string; note: string | null }[]
  attachments: { id: string; context: string; filename: string; size: number; by: { name: string }; confirmedAt: string; url: string; linkedTo?: { type: string; rid?: string } }[]
  summary?: {
    by: { name: string; email: string }; at: string; note: string
    usages: { lineIndex: number; skuCode: string; skuName: string; plate: string; mrCode: string; mrItemLabel: string; qty: number; attachments: { id: string; filename: string; url: string }[] }[]
    returns: { lineIndex: number; skuName: string; qty: number }[]
  } | null
  chain: { ok: boolean; checked: number; brokenAt?: number }
}

const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
const fmt = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
}
const inputCls = "rounded-xl border border-[#E2E8E4] bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-[#0f1117]"
const STATUSES = ["NEW", "PREPARING", "READY", "ISSUING", "ISSUED", "ISSUE_FAILED", "RECEIVED", "REJECTED", "CANCELLED", "HANDED_OUT", "SUMMARIZED", "SETTLING", "SETTLE_FAILED", "SETTLED"]
const CTX: Record<string, string> = { return: "ขอคืน", reject: "ปฏิเสธ", summary: "สรุปการใช้", receipt: "รับของ", other: "หลักฐานอื่น" }

export function ChainBadge({ ok, brokenAt }: { ok: boolean; brokenAt?: number }) {
  return ok
    ? <span data-testid="chain-ok" className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"><ShieldCheck size={13} />บันทึกครบ ไม่ถูกแก้</span>
    : <span data-testid="chain-bad" className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-300"><ShieldAlert size={13} />{brokenAt ? `พบความผิดปกติที่ลำดับ ${brokenAt}` : "พบความผิดปกติ"}</span>
}

export function AuditPage() {
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 6 * 86_400_000)))
  const [to, setTo] = useState(() => ymd(new Date()))
  const [workType, setWorkType] = useState("")
  const [status, setStatus] = useState("")
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<Row[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const qs = useCallback(() => {
    const p = new URLSearchParams({ from, to })
    if (workType) p.set("workType", workType)
    if (status) p.set("status", status)
    if (q.trim()) p.set("q", q.trim())
    return p.toString()
  }, [from, to, workType, status, q])

  const search = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await fetch(`/api/store-withdraw/audit?${qs()}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดรายการไม่สำเร็จ")
      setRows(j.rows as Row[]); setTruncated(!!j.truncated)
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดรายการไม่สำเร็จ"); setRows(null) }
    finally { setLoading(false) }
  }, [qs])

  useEffect(() => { const t = setTimeout(() => { void search() }, 0); return () => clearTimeout(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ตรวจสอบย้อนหลังงานเบิก</h1>
        <p className="text-xs text-gray-500">เลือกช่วงวันที่ (ไม่เกิน 93 วัน) แล้วกดแถวเพื่อดูประวัติทุกขั้น ไฟล์แนบ และเลขใบใน ATMS</p>
      </div>

      <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); void search() }}>
        <label className="text-xs text-gray-500">ตั้งแต่<input type="date" aria-label="ตั้งแต่วันที่" className={`${inputCls} mt-1 w-full`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label className="text-xs text-gray-500">ถึง<input type="date" aria-label="ถึงวันที่" className={`${inputCls} mt-1 w-full`} value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
        <label className="text-xs text-gray-500">ประเภทงาน
          <select aria-label="ประเภทงาน" className={`${inputCls} mt-1 w-full`} value={workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.entries(WORK_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="text-xs text-gray-500">สถานะ
          <select aria-label="สถานะ" className={`${inputCls} mt-1 w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        <label className="text-xs text-gray-500 lg:col-span-1">ค้นหา
          <input aria-label="ค้นหา" className={`${inputCls} mt-1 w-full`} placeholder="เลขใบ ทะเบียน MR WD ผู้ขอ" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={loading} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}ค้นหา
          </button>
          <a href={`/api/store-withdraw/audit/export?${qs()}`} data-testid="export" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2.5 text-sm text-gray-700 hover:text-[#1B8C4B] dark:border-white/10 dark:text-gray-200"><Download size={14} />Export</a>
        </div>
      </form>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {truncated && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">ช่วงนี้มีใบมากกว่า 400 ใบ แสดงเฉพาะ 400 ใบล่าสุด ลดช่วงวันที่ให้แคบลงจะเห็นครบ</p>}

      {rows && rows.length === 0 && <p className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10">ไม่พบใบในช่วงนี้</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-[#EEF2F0] md:block dark:border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F6F8F7] text-xs text-gray-500 dark:bg-white/5"><tr>
                <th className="px-3 py-2">เลขที่ใบ</th><th className="px-3 py-2">ยื่นเมื่อ</th><th className="px-3 py-2">ประเภท</th><th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2">ผู้ขอ / ทะเบียน</th><th className="px-3 py-2">WD / DD</th><th className="px-3 py-2 text-right">เหตุการณ์</th><th className="px-3 py-2 text-right">แนบ</th><th className="px-3 py-2">โซ่ log</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.no} data-testid="audit-row" onClick={() => setOpen(r.no)} className="cursor-pointer border-t border-[#EEF2F0] hover:bg-[#F6F8F7] dark:border-white/10 dark:hover:bg-white/5">
                    <td className="px-3 py-2 font-medium"><button type="button" onClick={() => setOpen(r.no)} className="text-[#1B8C4B] hover:underline">{r.no}</button></td>
                    <td className="px-3 py-2 text-xs text-gray-600">{fmt(r.createdAt)}</td>
                    <td className="px-3 py-2 text-xs">{r.workTypeLabel}</td>
                    <td className="px-3 py-2"><StatusChip status={r.status as SwStatus} /></td>
                    <td className="px-3 py-2 text-xs">{r.requester}<span className="block text-gray-500">{r.plate}{r.mr ? ` · ${r.mr}` : ""}</span></td>
                    <td className="px-3 py-2 text-xs">{[...r.wd, ...r.dd].join(", ") || "-"}</td>
                    <td className="px-3 py-2 text-right text-xs">{r.events}</td>
                    <td className="px-3 py-2 text-right text-xs">{r.attachments}</td>
                    <td className="px-3 py-2"><ChainBadge ok={r.chainOk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.no}>
                <button type="button" data-testid="audit-card" onClick={() => setOpen(r.no)} className="w-full rounded-2xl border border-[#EEF2F0] bg-white p-3 text-left dark:border-white/10 dark:bg-[#161922]">
                  <span className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">{r.no}</span><StatusChip status={r.status as SwStatus} /></span>
                  <span className="mt-0.5 block text-xs text-gray-500">{r.workTypeLabel} · {fmt(r.createdAt)} · {r.requester}{r.plate ? ` · ${r.plate}` : ""}</span>
                  <span className="mt-1 block text-xs text-gray-600 dark:text-gray-300">{[...r.wd, ...r.dd].join(", ")}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">เหตุการณ์ {r.events} · แนบ {r.attachments}<ChainBadge ok={r.chainOk} /></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && <DetailDialog no={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function DetailDialog({ no, onClose }: { no: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  useEffect(() => {
    let live = true
    fetch(`/api/store-withdraw/audit/${encodeURIComponent(no)}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "โหลดรายละเอียดไม่สำเร็จ"); if (live) setD(j as Detail) })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "โหลดรายละเอียดไม่สำเร็จ") })
    return () => { live = false }
  }, [no])
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{no}</DialogTitle></DialogHeader>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        {!d && !err && <p className="text-sm text-gray-500">กำลังโหลด</p>}
        {d && (
          <div className="space-y-4 text-sm" data-testid="audit-detail">
            <div className="flex flex-wrap items-center gap-2">
              <ChainBadge ok={d.chain.ok} brokenAt={d.chain.brokenAt} />
              <span className="text-xs text-gray-500">ตรวจแล้ว {d.chain.checked} รายการ</span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {d.workTypeLabel} · ผู้ขอ {d.requester.name} ({d.requester.via === "api" ? "ผ่าน API" : "เว็บ"}) · ยื่นเมื่อ {fmt(d.createdAt)}
              {d.plate && ` · ${d.plate}`}{d.mrCode && ` · ${d.mrCode}`}{d.ref && ` · อ้างอิง ${d.ref.type.toUpperCase()} ${d.ref.code}`}
            </p>

            {d.atms.length > 0 && (
              <section><h3 className="mb-1 text-xs font-semibold text-gray-500">เลขใบใน ATMS</h3>
                <ul className="flex flex-wrap gap-2">
                  {d.atms.map((a) => (
                    <li key={a.type + a.code} className="rounded-lg bg-[#F6F8F7] px-2.5 py-1 text-xs dark:bg-white/5">
                      {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1B8C4B] underline">{a.type} {a.code}</a> : <b>{a.type} {a.code}</b>}
                      <span className="text-gray-500"> · {a.label}</span>
                    </li>
                  ))}
                </ul></section>
            )}

            <section><h3 className="mb-1 text-xs font-semibold text-gray-500">รายการอะไหล่</h3>
              <ul className="divide-y divide-[#EEF2F0] dark:divide-white/10">
                {d.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                    <span className="min-w-0"><span className="block">{l.skuName}</span><span className="block text-xs text-gray-500">{l.skuCode}{l.mrItemLabel ? ` · ${l.mrItemLabel}` : ""}</span></span>
                    <span className="shrink-0 text-xs text-gray-600">ขอ {l.requestedQty}{l.issuedQty != null && ` · ได้ ${l.issuedQty}`}{l.returnedQty > 0 && ` · คืน ${l.returnedQty}`}</span>
                  </li>
                ))}
              </ul></section>

            {d.returns.length > 0 && (
              <section><h3 className="mb-1 text-xs font-semibold text-gray-500">ขอคืน</h3>
                <ul className="space-y-1">
                  {d.returns.map((r) => (
                    <li key={r.rid} className="text-xs text-gray-700 dark:text-gray-200">{r.rid} · {r.status} · {r.reason ?? "ไม่ระบุเหตุผล"} · คืน {r.lines.map((l) => `#${l.lineIndex + 1}×${l.qty}`).join(", ")}{r.code && ` · DD ${r.code}`}</li>
                  ))}
                </ul></section>
            )}

            {d.summary && (
              <section data-testid="audit-summary"><h3 className="mb-1 text-xs font-semibold text-gray-500">สรุปการใช้ (โดย {d.summary.by.name || d.summary.by.email} · {fmt(d.summary.at)})</h3>
                {d.summary.usages.length === 0 && <p className="text-xs text-gray-600 dark:text-gray-300">ไม่ได้ใช้เลย คืนสโตร์ทั้งหมด</p>}
                <ul className="space-y-1.5">
                  {d.summary.usages.map((u, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{u.plate}</span>
                      <span className="text-gray-600 dark:text-gray-300"> · {u.skuName} ใช้ {u.qty}</span>
                      <span className="block text-gray-500">{u.mrCode} · {u.mrItemLabel}</span>
                      {u.attachments.length > 0 ? (
                        <span className="flex flex-wrap gap-x-2">
                          {u.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-[#1B8C4B] underline">{a.filename}</a>)}
                        </span>
                      ) : <span className="block text-gray-400">ไม่มีรูปผูกกับแถวนี้</span>}
                    </li>
                  ))}
                </ul>
                {d.summary.returns.length > 0 && <p className="mt-1 text-xs text-[#6D4FC2] dark:text-violet-300">คืนสโตร์: {d.summary.returns.map((x) => `${x.skuName} ${x.qty}`).join(" · ")}</p>}
                {d.summary.note && <p className="mt-1 text-xs text-gray-500">หมายเหตุ: {d.summary.note}</p>}
              </section>
            )}

            <section><h3 className="mb-1 text-xs font-semibold text-gray-500">ประวัติทุกขั้น</h3>
              <ol data-testid="timeline" className="space-y-1.5 border-l-2 border-[#E2E8E4] pl-3 dark:border-white/10">
                {d.timeline.map((t, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{t.action}</span>
                    {t.from !== t.to && <span className="text-gray-500"> · {t.from ?? "-"} → {t.to ?? "-"}</span>}
                    <span className="block text-gray-500">{fmt(t.at)} · {t.actor} ({t.via}){t.seq ? ` · ลำดับ ${t.seq}` : ""}</span>
                    {t.note && <span className="block break-words text-gray-700 dark:text-gray-300">{t.note}</span>}
                  </li>
                ))}
              </ol></section>

            <section><h3 className="mb-1 text-xs font-semibold text-gray-500">หลักฐานแนบ ({d.attachments.length})</h3>
              {d.attachments.length === 0 ? <p className="text-xs text-gray-500">ไม่มีไฟล์แนบ</p> : (
                <ul className="space-y-1">
                  {d.attachments.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <FileText size={12} className="self-center text-gray-400" />
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-[#1B8C4B] underline">{a.filename}</a>
                      <span className="text-gray-500">{CTX[a.context] ?? a.context}{a.linkedTo?.rid ? ` ${a.linkedTo.rid}` : ""} · {a.by.name} · {fmt(a.confirmedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11px] text-gray-400">ลิงก์ไฟล์หมดอายุใน 5 นาที เปิดหน้านี้ใหม่เพื่อขอลิงก์ใหม่</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
