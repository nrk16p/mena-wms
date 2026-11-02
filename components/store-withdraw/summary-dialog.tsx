"use client"

// Mobile/PM แบบสรุปทีหลัง: หน้าต่างสรุปการใช้ · เลื่อนกำหนด · ส่วนแสดงสรุป (ใช้ทั้งหน้าผู้ขอและการ์ดคิวสโตร์)
import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DUE_MAX_DAYS, issuedOf, normPlate } from "@/lib/store-withdraw/pending"
import type { SwLine, SwUsage } from "@/lib/store-withdraw/types"
import { AttachPicker, doneIds, isUploading, type Picked } from "./attach-picker"
import { MrPicker, type MrItem } from "./mr-picker"

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

export function SummaryView({ req, compact = false }: { req: { lines: SwLine[] } & PendingReq; compact?: boolean }) {
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

// ---------- สรุปการใช้ ----------

type Row = { key: number; lineIndex: number; plate: string; mrCode: string; mrItems: MrItem[]; mrItemId: number | null; qty: string }

export function SummaryDialog({ req, onClose, onDone }: { req: { no: string; plate: string; lines: SwLine[] }; onClose: () => void; onDone: () => void }) {
  const lineIdx = req.lines.map((l, i) => ({ l, i })).filter(({ l }) => issuedOf(l) > 0)
  const [seq, setSeq] = useState(lineIdx.length)
  const [rows, setRows] = useState<Row[]>(() => lineIdx.map(({ i }, k) => ({ key: k, lineIndex: i, plate: req.plate, mrCode: "", mrItems: [], mrItemId: null, qty: "" })))
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)

  const patch = (key: number, p: Partial<Row>) => setRows((c) => c.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const add = (lineIndex: number) => { setRows((c) => [...c, { key: seq, lineIndex, plate: req.plate, mrCode: "", mrItems: [], mrItemId: null, qty: "" }]); setSeq((n) => n + 1) }
  const remove = (key: number) => setRows((c) => c.filter((r) => r.key !== key))

  // แถวที่ไม่ได้ใส่จำนวน = ไม่นับ (ใช้ 0 = คืนทั้งหมด) · แถวที่ใส่จำนวนต้องกรอกครบ
  const used = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) { const q = Number(r.qty); if (q > 0) m.set(r.lineIndex, (m.get(r.lineIndex) ?? 0) + q) }
    return m
  }, [rows])
  const rowBad = (r: Row) => {
    if (r.qty.trim() === "") return null
    const q = Number(r.qty)
    if (!Number.isFinite(q) || q <= 0) return "จำนวนต้องมากกว่า 0"
    if (!r.plate.trim()) return "ใส่ทะเบียน/เบอร์รถ"
    if (!r.mrCode) return "เลือก MR"
    if (!r.mrItemId) return r.mrItems.length ? "เลือกประเภทการซ่อม" : "เลือก MR จากรายการที่ค้นเจอ จะได้เลือกประเภทการซ่อม"
    return null
  }
  const over = lineIdx.some(({ l, i }) => (used.get(i) ?? 0) > issuedOf(l) + 1e-9)
  const valid = !over && rows.every((r) => rowBad(r) === null)
  const leftTotal = lineIdx.reduce((a, { l, i }) => a + Math.max(0, issuedOf(l) - (used.get(i) ?? 0)), 0)

  const submit = async () => {
    setBusy(true)
    try {
      const usages = rows.filter((r) => Number(r.qty) > 0).map((r) => {
        const it = r.mrItems.find((m) => m.id === r.mrItemId)!
        return { lineIndex: r.lineIndex, plate: r.plate.trim(), mrCode: r.mrCode, mrItemId: it.id, mrItemLabel: it.label, qty: Number(r.qty) }
      })
      await post(`/api/store-withdraw/${req.no}/summary`, { usages, note: note.trim(), ...(doneIds(files).length ? { attachmentIds: doneIds(files) } : {}) })
      await swalToast("success", leftTotal > 0 ? "ส่งสรุปแล้ว เอาของที่เหลือไปคืนสโตร์ด้วย" : "ส่งสรุปแล้ว รอสโตร์ตัดสต๊อก")
      onDone()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ส่งสรุปไม่สำเร็จ")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>สรุปการใช้ {req.no}</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500">ใส่ว่าใช้กับรถคันไหน MR ไหน ประเภทการซ่อมอะไร ใช้หลายคันก็เพิ่มแถว ที่ไม่ได้ใช้ไม่ต้องใส่ ระบบนับเป็นของคืนสโตร์ให้</p>
        <div className="space-y-4">
          {lineIdx.map(({ l, i }) => {
            const issued = issuedOf(l)
            const u = used.get(i) ?? 0
            const left = issued - u
            return (
              <section key={i} data-testid="summary-line" data-line={i} className="rounded-xl border border-[#EEF2F0] p-3 dark:border-white/10">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm"><span className="block truncate font-medium text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">{l.skuCode} · เบิกไป {num(issued)}</span></p>
                  <span data-testid="left" className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${left < -1e-9 ? "bg-red-100 text-red-700" : left > 1e-9 ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {left < -1e-9 ? `ใช้เกิน ${num(-left)}` : left > 1e-9 ? `เหลือคืน ${num(left)}` : "ใช้ครบ"}
                  </span>
                </div>
                <ul className="mt-2 space-y-2">
                  {rows.filter((r) => r.lineIndex === i).map((r) => {
                    const bad = rowBad(r)
                    return (
                      <li key={r.key} className="space-y-1.5 rounded-lg bg-[#F6F8F7] p-2 dark:bg-white/[0.04]">
                        <div className="grid gap-1.5 sm:grid-cols-[1fr_96px_32px]">
                          <input aria-label="ทะเบียนรถที่ใช้" className={inputCls} placeholder="ทะเบียน/เบอร์รถ" value={r.plate}
                            onChange={(e) => patch(r.key, { plate: e.target.value, mrCode: "", mrItems: [], mrItemId: null })} />
                          <input aria-label="จำนวนที่ใช้" inputMode="decimal" className={inputCls} placeholder="ใช้กี่ชิ้น" value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} />
                          <button type="button" aria-label="ลบแถว" onClick={() => remove(r.key)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                        </div>
                        <MrPicker key={`${r.key}-${normPlate(r.plate)}`} mrCode={r.mrCode} plate={r.plate}
                          onPick={(code, items) => patch(r.key, { mrCode: code, mrItems: items, mrItemId: items.length === 1 ? items[0].id : null })}
                          onClear={() => patch(r.key, { mrCode: "", mrItems: [], mrItemId: null })} />
                        {r.mrItems.length > 0 && (
                          <select aria-label="ประเภทการซ่อม" className={inputCls} value={r.mrItemId ?? ""} onChange={(e) => patch(r.key, { mrItemId: Number(e.target.value) || null })}>
                            <option value="" disabled>เลือกประเภทการซ่อม</option>
                            {r.mrItems.map((m) => <option key={m.id} value={m.id}>{mrTypeName(m.label)}</option>)}
                          </select>
                        )}
                        {bad && <p className="text-xs text-amber-700">{bad}</p>}
                      </li>
                    )
                  })}
                </ul>
                <button type="button" onClick={() => add(i)} className="mt-2 inline-flex items-center gap-1 text-xs text-[#1B8C4B] hover:underline"><Plus size={13} />ใช้กับรถคันอื่นด้วย</button>
              </section>
            )
          })}
        </div>
        <textarea aria-label="หมายเหตุ" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" className={inputCls} />
        <AttachPicker no={req.no} context="summary" items={files} onChange={(f) => setFiles(f)} hint="แนบรูปงานที่ทำหรือของที่เหลือได้ (ไม่บังคับ)" />
        <p data-testid="left-total" className="text-xs text-gray-600 dark:text-gray-300">{leftTotal > 1e-9 ? `ของเหลือรวม ${num(leftTotal)} ชิ้น ต้องเอาไปคืนสโตร์` : "ใช้หมดทุกรายการ ไม่มีของคืน"}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm dark:border-white/10">ปิด</button>
          <button type="button" data-testid="summary-submit" onClick={submit} disabled={busy || !valid || isUploading(files)} className="rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">ส่งสรุป</button>
        </div>
      </DialogContent>
    </Dialog>
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
