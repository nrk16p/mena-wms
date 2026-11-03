"use client"

// Mobile/PM แบบสรุปทีหลัง: เลื่อนกำหนด · ส่วนแสดงสรุป (ใช้ทั้งหน้าผู้ขอ หน้าสรุปรายคัน และการ์ดคิวสโตร์)
// การกรอกสรุปย้ายไปหน้า /store-withdraw/{no}/summary (components/store-withdraw/summary-page.tsx)
import { useState } from "react"
import { swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DUE_MAX_DAYS, normPlate } from "@/lib/store-withdraw/pending"
import type { SwLine, SwUsage } from "@/lib/store-withdraw/types"
import { UsageFiles } from "./attach-picker"

/** field ของใบ pending หลัง JSON (วันที่เป็นสตริง) */
export type PendingReq = {
  summaryDueAt?: string | null
  summaryExtensions?: number
  summary?: { usages: SwUsage[]; returns: { lineIndex: number; qty: number }[]; note: string; by: { email: string; name: string }; at: string } | null
  settleGroups?: { n: number; plate: string; token: string; mrCodes: string[]; lines: { lineIndex: number; mrItemId: number; qty: number }[]; status: "PENDING" | "DONE"; atms: { gmId: number | null; code: string | null; error: string | null; needCreds: boolean; drift: string | null } }[]
}

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
// "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041" → "อู่ใน-CM-ระบบไฟ"
export const mrTypeName = (label: string) => label.replace(/^\S*MR\S*\d\s+/i, "").replace(/\s*:\s*\d+$/, "")
const num = (n: number) => String(Math.round(n * 1e6) / 1e6)
const pad = (n: number) => String(n).padStart(2, "0")
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง")
  return j
}

// ---------- แสดงสรุป (แยกตามทะเบียน) ----------

export function groupByPlate(usages: SwUsage[]) {
  const m = new Map<string, { plate: string; rows: SwUsage[] }>()
  for (const u of usages) {
    const k = normPlate(u.plate)
    const g = m.get(k) ?? { plate: u.plate, rows: [] }
    g.rows.push(u)
    m.set(k, g)
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, g]) => ({ key, ...g }))
}

export function SummaryView({ req, compact = false }: { req: { no: string; lines: SwLine[] } & PendingReq; compact?: boolean }) {
  const s = req.summary
  if (!s) return null
  const groups = groupByPlate(s.usages)
  const wd = new Map((req.settleGroups ?? []).map((g) => [normPlate(g.plate), g]))
  return (
    <div data-testid="summary-view" className={`mt-2 space-y-2 rounded-xl bg-[#F6F8F7] p-2.5 text-xs dark:bg-white/[0.04] ${compact ? "" : "sm:p-3"}`}>
      {groups.length === 0 && <p className="text-gray-600 dark:text-gray-300">ไม่ได้ใช้เลย คืนสโตร์ทั้งหมด</p>}
      {groups.map((g) => {
        const w = wd.get(g.key)
        return (
          <div key={g.key} data-testid="usage-group" data-plate={g.plate}>
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              {g.plate}
              {w?.atms.code && <span data-testid="group-wd" className="ml-1.5 font-normal text-gray-500">WD {w.atms.code}</span>}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {g.rows.map((u, i) => (
                <li key={i} className="flex justify-between gap-2 text-gray-600 dark:text-gray-300">
                  <span className="min-w-0">
                    <span className="block truncate">{req.lines[u.lineIndex]?.skuName ?? "?"}</span>
                    <span className="block truncate text-[11px] text-[#1B8C4B]">{u.mrCode} · {mrTypeName(u.mrItemLabel)}</span>
                    <UsageFiles no={req.no} ids={u.attachmentIds} />
                  </span>
                  <span className="shrink-0">ใช้ {num(u.qty)}</span>
                </li>
              ))}
            </ul>
            {w?.atms.error && <p className="mt-0.5 text-red-600">{w.atms.error}</p>}
          </div>
        )
      })}
      {s.returns.length > 0 && (
        <div data-testid="leftover">
          <p className="font-semibold text-[#6D4FC2] dark:text-violet-300">เหลือคืนสโตร์</p>
          <ul className="mt-0.5 space-y-0.5">
            {s.returns.map((r) => (
              <li key={r.lineIndex} className="flex justify-between gap-2 text-gray-600 dark:text-gray-300">
                <span className="min-w-0 truncate">{req.lines[r.lineIndex]?.skuName ?? "?"}</span>
                <span className="shrink-0">คืน {num(r.qty)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.note && <p className="text-gray-500">หมายเหตุ: {s.note}</p>}
    </div>
  )
}

// ---------- เลื่อนกำหนดสรุป ----------

export function ExtendDueDialog({ req, onClose, onDone }: { req: { no: string } & PendingReq; onClose: () => void; onDone: () => void }) {
  const [due, setDue] = useState(() => (req.summaryDueAt ? toLocalInput(new Date(req.summaryDueAt)) : ""))
  const [busy, setBusy] = useState(false)
  const [limits] = useState(() => ({ min: toLocalInput(new Date()), max: toLocalInput(new Date(Date.now() + DUE_MAX_DAYS * 86_400_000)) }))
  const submit = async () => {
    const d = new Date(due)
    if (!due || isNaN(d.getTime())) return swalError("เลือกวันและเวลาใหม่ก่อน")
    setBusy(true)
    try {
      await post(`/api/store-withdraw/${req.no}/extend`, { summaryDueAt: d.toISOString() })
      await swalToast("success", "เลื่อนกำหนดสรุปแล้ว")
      onDone()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "เลื่อนกำหนดไม่สำเร็จ")
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>เลื่อนกำหนดสรุป {req.no}</DialogTitle></DialogHeader>
        <label className="block text-xs font-medium text-gray-500" htmlFor="sw-extend">กำหนดสรุปใหม่ (ไม่เกิน {DUE_MAX_DAYS} วันจากวันนี้)</label>
        <input id="sw-extend" type="datetime-local" className={inputCls} value={due} min={limits.min} max={limits.max} onChange={(e) => setDue(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" onClick={submit} disabled={busy || !due} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">บันทึก</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
