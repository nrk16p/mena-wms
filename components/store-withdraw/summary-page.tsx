"use client"

// หน้าสรุปการใช้รายคัน (Mobile/PM) — เปิดจากลิงก์บนมือถือ · แยกบล็อกต่อรถ: ทะเบียน + MR + ประเภทการซ่อม + อะไหล่ที่ใช้ + รูปหลักฐาน
// ของที่ไม่ได้ใช้ = คืนสโตร์ (คิดให้) · ร่างเก็บในเครื่อง (localStorage) กันเน็ตหลุด ส่งสำเร็จแล้วลบร่าง
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Minus, Plus, Trash2, Truck } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { isPendingFlow } from "@/lib/store-withdraw/core"
import { issuedOf, lateMinutes, lateText, normPlate } from "@/lib/store-withdraw/pending"
import {
  addableLines, clampQty, draftIsEmpty, draftKey, draftProblems, draftTotals, emptyVehicle, maxForPart, parseDraft, partCounters,
  rowAttachIds, toUsages, vehicleProblem, type Draft, type DraftFile, type DraftVehicle,
} from "@/lib/store-withdraw/summary-draft"
import type { SwKind, SwLine, SwStatus, SwWorkType } from "@/lib/store-withdraw/types"
import { AttachPicker, isUploading, type Picked } from "./attach-picker"
import { MrPicker } from "./mr-picker"
import { StatusChip } from "./status-chip"
import { SummaryView, mrTypeName, type PendingReq } from "./summary-dialog"

/** ใบที่หน้า server ส่งมา (JSON · วันที่เป็นสตริง) */
export type SummaryReq = PendingReq & {
  no: string; status: SwStatus; kind: SwKind; workType?: SwWorkType; plate: string; mrCode: string | null; remark: string
  inventoryName: string; lines: SwLine[]; createdAt: string
}

type UPart = { key: string; lineIndex: number; qty: number; qtyText: string; files: Picked[]; extra: boolean }
type UVehicle = Omit<DraftVehicle, "files" | "parts"> & { files: Picked[]; parts: UPart[] }

const BLOCK_FILES = 10
const PART_FILES = 4
const num = (n: number) => String(Math.round(n * 1e6) / 1e6)
const fmt = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}
const inputCls =
  "w-full min-h-11 rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2.5 text-base sm:text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const ghostBtn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3.5 py-2 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-50 dark:border-white/10 dark:text-gray-200"
const primaryBtn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50"

const doneFiles = (xs: Picked[]): DraftFile[] => xs.filter((x) => x.state === "done" && x.id).map((x) => ({ id: x.id as string, name: x.name, type: x.type }))
const toPicked = (xs: DraftFile[]): Picked[] => xs.map((f) => ({ key: `r-${f.id}`, id: f.id, name: f.name, type: f.type, preview: null, state: "done" }))
const toDraftVehicles = (vs: UVehicle[]): DraftVehicle[] =>
  vs.map((v) => ({ ...v, files: doneFiles(v.files), parts: v.parts.map((p) => ({ key: p.key, lineIndex: p.lineIndex, qty: p.qty, files: doneFiles(p.files) })) }))
const fromDraftVehicles = (vs: DraftVehicle[]): UVehicle[] =>
  vs.map((v) => ({ ...v, files: toPicked(v.files), parts: v.parts.map((p) => ({ key: p.key, lineIndex: p.lineIndex, qty: p.qty, qtyText: num(p.qty), files: toPicked(p.files), extra: p.files.length > 0 })) }))
const uploading = (vs: UVehicle[]) => vs.some((v) => isUploading(v.files) || v.parts.some((p) => isUploading(p.files)))

function waitText(r: SummaryReq): string {
  if (!isPendingFlow(r)) return "ใบนี้ไม่ใช่งาน Mobile/PM แบบสรุปทีหลัง ไม่ต้องสรุปการใช้"
  switch (r.status) {
    case "NEW": case "PREPARING": case "READY": return "สโตร์ยังไม่ได้ส่งของ สรุปได้หลังรับของแล้ว"
    case "SUMMARIZED": return "ส่งสรุปแล้ว รอสโตร์ตัดสต๊อก"
    case "SETTLING": case "SETTLE_FAILED": return "สโตร์กำลังตัดสต๊อกใน ATMS ไม่ต้องสรุปใหม่"
    case "SETTLED": return "ตัดสต๊อกเรียบร้อยแล้ว"
    case "REJECTED": return "ใบนี้ถูกสโตร์ปฏิเสธแล้ว"
    case "CANCELLED": return "ใบนี้ยกเลิกแล้ว"
    default: return "ใบนี้สรุปไม่ได้แล้ว"
  }
}

export function SummaryPage({ initial }: { initial: SummaryReq }) {
  const [req, setReq] = useState(initial)
  const editable = isPendingFlow(req) && req.status === "HANDED_OUT"
  const lines = req.lines
  const seq = useRef(0)
  const nk = (p: string) => `${p}${Date.now().toString(36)}${seq.current++}`
  const [vehicles, setVehicles] = useState<UVehicle[]>(() => fromDraftVehicles([emptyVehicle("v0", initial.plate)]))
  const [note, setNote] = useState("")
  const [ready, setReady] = useState(false) // กู้ร่างเสร็จแล้ว ค่อยเริ่มบันทึกร่าง (กันร่างว่างทับร่างเดิม)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  // กู้ร่างจากเครื่อง (หลัง mount เท่านั้น — server ไม่มี localStorage)
  useEffect(() => {
    const t = setTimeout(() => {
      setNow(new Date())
      const key = draftKey(initial.no)
      if (!(isPendingFlow(initial) && initial.status === "HANDED_OUT")) {
        try { localStorage.removeItem(key) } catch { /* เครื่องปิด storage */ }
        return
      }
      let raw: string | null = null
      try { raw = localStorage.getItem(key) } catch { /* เครื่องปิด storage */ }
      const d = parseDraft(raw, initial.no, initial.lines)
      if (d && !draftIsEmpty(d)) {
        setVehicles(fromDraftVehicles(d.vehicles.length ? d.vehicles : [emptyVehicle("v0", initial.plate)]))
        setNote(d.note)
        setRestoredAt(d.savedAt || Date.now())
      }
      setReady(true)
    }, 0)
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => { clearTimeout(t); clearInterval(tick) }
  }, [initial])

  const draftVehicles = useMemo(() => toDraftVehicles(vehicles), [vehicles])

  // บันทึกร่างทุกครั้งที่แก้ (ไฟล์ที่ยังอัปโหลดไม่เสร็จไม่ถูกเก็บ)
  useEffect(() => {
    if (!ready || !editable) return
    const d: Draft = { v: 1, no: req.no, vehicles: draftVehicles, note, savedAt: Date.now() }
    try {
      if (draftIsEmpty(d)) localStorage.removeItem(draftKey(req.no))
      else localStorage.setItem(draftKey(req.no), JSON.stringify(d))
    } catch { /* storage เต็ม/ปิด — ยังกรอกต่อได้ แค่ไม่มีร่าง */ }
  }, [ready, editable, req.no, draftVehicles, note])

  const counters = partCounters(lines, draftVehicles)
  const problems = draftProblems(lines, { vehicles: draftVehicles })
  const totals = draftTotals(lines, { vehicles: draftVehicles })
  const anyUploading = uploading(vehicles)
  const late = now ? lateMinutes(req, now) : 0

  const patchV = (vKey: string, p: Partial<UVehicle>) => setVehicles((c) => c.map((v) => (v.key === vKey ? { ...v, ...p } : v)))
  const patchP = (vKey: string, pKey: string, p: Partial<UPart>) =>
    setVehicles((c) => c.map((v) => (v.key === vKey ? { ...v, parts: v.parts.map((x) => (x.key === pKey ? { ...x, ...p } : x)) } : v)))
  const setFilesV = (vKey: string) => (f: (cur: Picked[]) => Picked[]) => setVehicles((c) => c.map((v) => (v.key === vKey ? { ...v, files: f(v.files) } : v)))
  const setFilesP = (vKey: string, pKey: string) => (f: (cur: Picked[]) => Picked[]) =>
    setVehicles((c) => c.map((v) => (v.key === vKey ? { ...v, parts: v.parts.map((x) => (x.key === pKey ? { ...x, files: f(x.files) } : x)) } : v)))

  const addVehicle = () => setVehicles((c) => [...c, { ...emptyVehicle(nk("v")), files: [], parts: [] }])
  const removeVehicle = async (v: UVehicle, i: number) => {
    const hasData = v.parts.length > 0 || v.files.length > 0 || v.mrCode
    if (hasData) {
      const c = await swalConfirm(`เอาคันที่ ${i + 1} ออก?`, "อะไหล่ในคันนี้จะกลับไปเป็นของเหลือ รูปที่แนบแล้วยังเก็บไว้ในใบ")
      if (!c.isConfirmed) return
    }
    setVehicles((c) => c.filter((x) => x.key !== v.key))
  }
  const addPart = (vKey: string, lineIndex: number) => {
    setVehicles((c) => c.map((v) => {
      if (v.key !== vKey || v.parts.some((p) => p.lineIndex === lineIndex)) return v
      const key = nk("p")
      const max = maxForPart(lines, toDraftVehicles(c), vKey, key, lineIndex)
      const qty = clampQty(Math.min(1, max), max)
      return { ...v, parts: [...v.parts, { key, lineIndex, qty, qtyText: num(qty), files: [], extra: false }] }
    }))
  }
  const step = (vKey: string, p: UPart, d: number) => {
    const max = maxForPart(lines, draftVehicles, vKey, p.key, p.lineIndex)
    const qty = clampQty(Math.round((p.qty + d) * 1e6) / 1e6, max)
    patchP(vKey, p.key, { qty, qtyText: num(qty) })
  }
  const typeQty = (vKey: string, p: UPart, text: string) => {
    const max = maxForPart(lines, draftVehicles, vKey, p.key, p.lineIndex)
    patchP(vKey, p.key, { qtyText: text, qty: clampQty(text, max) })
  }

  const clearDraft = async () => {
    const c = await swalConfirm("ล้างที่กรอกไว้ทั้งหมด?", "เริ่มกรอกใหม่ตั้งแต่ต้น รูปที่อัปโหลดแล้วยังอยู่ในใบ")
    if (!c.isConfirmed) return
    try { localStorage.removeItem(draftKey(req.no)) } catch { /* ไม่เป็นไร */ }
    setVehicles(fromDraftVehicles([emptyVehicle(nk("v"), req.plate)]))
    setNote("")
    setRestoredAt(null)
  }

  const reload = async () => {
    try {
      const r = await fetch(`/api/store-withdraw/${encodeURIComponent(req.no)}`)
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.request) setReq(j.request as SummaryReq)
    } catch { /* ค้างหน้าเดิมไว้ */ }
  }

  const submit = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/store-withdraw/${encodeURIComponent(req.no)}/summary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usages: toUsages({ vehicles: draftVehicles }), note: note.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (r.status === 409) void reload()
        throw new Error(j.error || "ส่งสรุปไม่สำเร็จ ลองใหม่อีกครั้ง")
      }
      try { localStorage.removeItem(draftKey(req.no)) } catch { /* ไม่เป็นไร */ }
      setConfirm(false)
      setReq(j.request as SummaryReq)
      await swalToast("success", totals.left > 0 ? "ส่งสรุปแล้ว เอาของที่เหลือไปคืนสโตร์ด้วย" : "ส่งสรุปแล้ว รอสโตร์ตัดสต๊อก")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ส่งสรุปไม่สำเร็จ")
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <header className="space-y-1">
      <Link href="/store-withdraw" className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-gray-500 hover:text-[#1B8C4B]"><ArrowLeft size={16} />ใบเบิกของฉัน</Link>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>สรุปการใช้ {req.no}</h1>
          <p className="text-xs text-gray-500">{req.inventoryName} · ยื่นเมื่อ {fmt(req.createdAt)}{req.remark && ` · ${req.remark}`}</p>
        </div>
        <StatusChip status={req.status} />
      </div>
      {req.summaryDueAt && req.status === "HANDED_OUT" && (
        <p data-testid="due" className={`text-sm ${late > 0 ? "font-medium text-red-600" : "text-gray-600 dark:text-gray-300"}`}>
          กำหนดสรุป {fmt(req.summaryDueAt)}
          {late > 0 && <span className="ml-1.5 whitespace-nowrap rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">เลยกำหนด {lateText(late)}</span>}
        </p>
      )}
    </header>
  )

  if (!editable) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        {header}
        <p data-testid="summary-readonly" className="rounded-xl bg-[#F6F8F7] px-3 py-2.5 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-200">{waitText(req)}</p>
        {req.summary && <SummaryView req={req} />}
        {req.status === "SUMMARIZED" && (req.summary?.returns.length ?? 0) > 0 && <p className="text-sm text-[#6D4FC2] dark:text-violet-300">อย่าลืมเอาของที่เหลือไปคืนสโตร์</p>}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <div className="space-y-4 pb-4">
        {header}

        {restoredAt && (
          <div data-testid="draft-restored" className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
            <span>กู้ที่กรอกค้างไว้กลับมาแล้ว</span>
            <button type="button" onClick={clearDraft} className="min-h-11 px-2 text-sm font-medium underline">เริ่มใหม่</button>
          </div>
        )}

        <section aria-label="อะไหล่ที่เบิกไป" className="rounded-2xl border border-[#EEF2F0] bg-white p-3 dark:border-white/10 dark:bg-[#161922]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">อะไหล่ที่เบิกไป</h2>
          <ul className="mt-1 divide-y divide-[#EEF2F0] dark:divide-white/10">
            {counters.map((c) => {
              const l = lines[c.lineIndex]
              return (
                <li key={c.lineIndex} data-testid="part-counter" data-line={c.lineIndex} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block text-sm text-gray-900 dark:text-white">{l.skuName}</span><span className="block text-xs text-gray-500">{l.skuCode} · เบิก {num(c.issued)}</span></span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block text-gray-700 dark:text-gray-200">ใช้ไปแล้ว <b data-testid="used">{num(c.used)}</b></span>
                    <span data-testid="left" className={`block font-medium ${c.left < -1e-9 ? "text-red-600" : c.left > 1e-9 ? "text-[#6D4FC2] dark:text-violet-300" : "text-emerald-700"}`}>
                      {c.left < -1e-9 ? `ใช้เกิน ${num(-c.left)}` : c.left > 1e-9 ? `เหลือคืน ${num(c.left)}` : "ใช้ครบ"}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        <p className="text-xs text-gray-500">แยกเป็นคัน ใส่ทะเบียน เลือก MR กับประเภทการซ่อม แล้วเพิ่มอะไหล่ที่ใช้กับคันนั้น ถ่ายรูปงานหรือรูปรถแนบไว้ด้วย ของที่ไม่ได้ใส่ ระบบนับเป็นของคืนสโตร์ให้</p>

        {vehicles.map((v, vi) => {
          const dv = draftVehicles[vi]
          const bad = vehicleProblem(dv)
          const addable = addableLines(lines, draftVehicles, v.key)
          return (
            <section key={v.key} data-testid="vehicle-block" className="space-y-3 rounded-2xl border border-[#EEF2F0] bg-white p-3 dark:border-white/10 dark:bg-[#161922]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"><Truck size={16} className="text-[#1B8C4B]" />คันที่ {vi + 1}</h2>
                <button type="button" aria-label={`เอาคันที่ ${vi + 1} ออก`} onClick={() => removeVehicle(v, vi)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-400 hover:text-red-600"><Trash2 size={18} /></button>
              </div>

              <label className="block text-xs font-medium text-gray-500">ทะเบียน / เบอร์รถ
                <input aria-label={`ทะเบียนคันที่ ${vi + 1}`} className={`${inputCls} mt-1`} maxLength={20} placeholder="เช่น 70-1234 หรือ เบอร์ 125" value={v.plate}
                  onChange={(e) => patchV(v.key, { plate: e.target.value, mrCode: "", mrItems: [], mrItemId: null })} />
              </label>

              <div className="text-xs font-medium text-gray-500">
                <span className="mb-1 block">ใบแจ้งซ่อม (MR)</span>
                <MrPicker key={`${v.key}-${normPlate(v.plate)}`} mrCode={v.mrCode} plate={v.plate}
                  onPick={(code, items) => patchV(v.key, { mrCode: code, mrItems: items.map((m) => ({ id: m.id, label: m.label })), mrItemId: items.length === 1 ? items[0].id : null })}
                  onClear={() => patchV(v.key, { mrCode: "", mrItems: [], mrItemId: null })} />
              </div>

              {v.mrItems.length > 0 && (
                <label className="block text-xs font-medium text-gray-500">ประเภทการซ่อม
                  <select aria-label={`ประเภทการซ่อมคันที่ ${vi + 1}`} className={`${inputCls} mt-1`} value={v.mrItemId ?? ""} onChange={(e) => patchV(v.key, { mrItemId: Number(e.target.value) || null })}>
                    <option value="" disabled>เลือกประเภทการซ่อม</option>
                    {v.mrItems.map((m) => <option key={m.id} value={m.id}>{mrTypeName(m.label)}</option>)}
                  </select>
                </label>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">อะไหล่ที่ใช้กับคันนี้</p>
                {v.parts.length === 0 && <p className="text-xs text-gray-400">ยังไม่ได้เพิ่ม</p>}
                <ul className="space-y-2">
                  {v.parts.map((p) => {
                    const l = lines[p.lineIndex]
                    const max = maxForPart(lines, draftVehicles, v.key, p.key, p.lineIndex)
                    return (
                      <li key={p.key} data-testid="usage-row" className="space-y-2 rounded-xl bg-[#F6F8F7] p-2.5 dark:bg-white/[0.04]">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-sm"><span className="block text-gray-900 dark:text-white">{l?.skuName ?? "?"}</span><span className="block text-xs text-gray-500">ใส่ได้ไม่เกิน {num(max)}</span></span>
                          <button type="button" aria-label={`เอา ${l?.skuName ?? ""} ออกจากคันนี้`} onClick={() => setVehicles((c) => c.map((x) => (x.key === v.key ? { ...x, parts: x.parts.filter((y) => y.key !== p.key) } : x)))}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label="ลดจำนวน" disabled={p.qty <= 0} onClick={() => step(v.key, p, -1)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E2E8E4] bg-white text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-[#0f1117] dark:text-gray-200"><Minus size={18} /></button>
                          <input aria-label={`จำนวนที่ใช้ ${l?.skuName ?? ""}`} inputMode="decimal" className={`${inputCls} w-24 text-center`} value={p.qtyText}
                            onChange={(e) => typeQty(v.key, p, e.target.value)} onBlur={() => patchP(v.key, p.key, { qtyText: num(p.qty) })} />
                          <button type="button" aria-label="เพิ่มจำนวน" disabled={p.qty >= max - 1e-9} onClick={() => step(v.key, p, 1)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E2E8E4] bg-white text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-[#0f1117] dark:text-gray-200"><Plus size={18} /></button>
                          <span className="text-xs text-gray-500">{l?.skuCode}</span>
                        </div>
                        {p.extra ? (
                          <AttachPicker no={req.no} context="summary" items={p.files} onChange={setFilesP(v.key, p.key)} max={PART_FILES} label="รูปของชิ้นนี้" hint="ไม่บังคับ ถ้ามีรูปเฉพาะชิ้นนี้" />
                        ) : (
                          <button type="button" onClick={() => patchP(v.key, p.key, { extra: true })} className="min-h-11 text-xs text-[#1B8C4B] underline">แนบรูปเฉพาะชิ้นนี้เพิ่ม</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {addable.length > 0 ? (
                  <select aria-label={`เพิ่มอะไหล่ให้คันที่ ${vi + 1}`} className={inputCls} value="" onChange={(e) => { if (e.target.value !== "") addPart(v.key, Number(e.target.value)) }}>
                    <option value="">+ เพิ่มอะไหล่ที่ใช้กับคันนี้</option>
                    {addable.map((i) => {
                      const c = counters.find((x) => x.lineIndex === i)
                      return <option key={i} value={i}>{lines[i].skuName} (เหลือ {num(c?.left ?? issuedOf(lines[i]))})</option>
                    })}
                  </select>
                ) : v.parts.length === 0 && <p className="text-xs text-gray-500">อะไหล่ถูกแบ่งให้คันอื่นครบแล้ว</p>}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">รูปหลักฐานของคันนี้</p>
                <AttachPicker no={req.no} context="summary" items={v.files} onChange={setFilesV(v.key)} required max={BLOCK_FILES}
                  label="ถ่าย/แนบรูป" hint="รูปงานที่ทำหรือรูปรถ ใช้เป็นหลักฐานของทุกอะไหล่ในคันนี้" />
              </div>

              {bad && <p data-testid="vehicle-problem" className="text-sm text-amber-700">{bad}</p>}
            </section>
          )
        })}

        <button type="button" data-testid="add-vehicle" onClick={addVehicle} className={`${ghostBtn} w-full border-dashed`}><Plus size={16} />เพิ่มรถอีกคัน</button>
        <p className="text-xs text-gray-500">รถคันเดียวกันแต่คนละประเภทการซ่อม ก็กดเพิ่มอีกบล็อกได้ ระบบรวมเป็นใบเบิกเดียวต่อทะเบียนให้</p>

        <label className="block text-xs font-medium text-gray-500">หมายเหตุ (ไม่บังคับ)
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
      </div>

      <div data-testid="summary-bar" className="sticky bottom-0 -mx-4 border-t border-[#EEF2F0] bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-white/10 dark:bg-[#0f1117]/95">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-gray-600 dark:text-gray-300">
            <span className="block">{totals.vehicles} คัน · ใช้ {num(totals.used)} ชิ้น</span>
            <span className={`block ${totals.left > 0 ? "text-[#6D4FC2] dark:text-violet-300" : ""}`}>{totals.left > 0 ? `คืนสโตร์ ${num(totals.left)} ชิ้น` : "ไม่มีของคืน"}</span>
          </p>
          <button type="button" data-testid="summary-submit" className={primaryBtn} disabled={busy || anyUploading || problems.length > 0} onClick={() => setConfirm(true)}>ส่งสรุป</button>
        </div>
        {anyUploading ? <p className="mt-1 text-xs text-gray-500">รอรูปอัปโหลดเสร็จก่อน</p>
          : problems.length > 0 && <p data-testid="summary-problem" className="mt-1 text-xs text-amber-700">{problems[0]}{problems.length > 1 && ` (และอีก ${problems.length - 1} เรื่อง)`}</p>}
      </div>

      {confirm && (
        <Dialog open onOpenChange={(o) => { if (!o && !busy) setConfirm(false) }}>
          <DialogContent className="max-h-[90vh] overflow-auto">
            <DialogHeader><DialogTitle>ตรวจก่อนส่ง</DialogTitle></DialogHeader>
            <div data-testid="summary-recap" className="space-y-3 text-sm">
              {draftVehicles.length === 0 && <p className="text-gray-700 dark:text-gray-200">ไม่ได้ใช้เลย คืนสโตร์ทั้งหมด</p>}
              {draftVehicles.map((v, i) => {
                const it = v.mrItems.find((m) => m.id === v.mrItemId)
                return (
                  <div key={v.key} className="rounded-xl bg-[#F6F8F7] p-2.5 dark:bg-white/[0.04]">
                    <p className="font-semibold text-gray-900 dark:text-white">คันที่ {i + 1} · {v.plate.trim()}</p>
                    <p className="text-xs text-[#1B8C4B]">{v.mrCode}{it && ` · ${mrTypeName(it.label)}`}</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-gray-200">
                      {v.parts.map((p) => (
                        <li key={p.key} className="flex justify-between gap-2"><span className="min-w-0 truncate">{lines[p.lineIndex]?.skuName}</span><span className="shrink-0">ใช้ {num(p.qty)} · รูป {rowAttachIds(v, p).length}</span></li>
                      ))}
                    </ul>
                  </div>
                )
              })}
              <div>
                <p className="font-semibold text-[#6D4FC2] dark:text-violet-300">ของที่ต้องคืนสโตร์</p>
                {totals.leftover.length === 0 ? <p className="text-xs text-gray-600 dark:text-gray-300">ไม่มี ใช้หมดทุกรายการ</p> : (
                  <ul className="mt-0.5 space-y-0.5 text-xs text-gray-700 dark:text-gray-200">
                    {totals.leftover.map((x) => <li key={x.lineIndex} className="flex justify-between gap-2"><span className="min-w-0 truncate">{lines[x.lineIndex]?.skuName}</span><span className="shrink-0">คืน {num(x.qty)}</span></li>)}
                  </ul>
                )}
              </div>
              {note.trim() && <p className="text-xs text-gray-500">หมายเหตุ: {note.trim()}</p>}
              <p className="text-xs text-gray-500">ส่งแล้วแก้ไม่ได้ สโตร์จะตัดสต๊อกตามนี้</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(false)} disabled={busy} className={ghostBtn}>กลับไปแก้</button>
              <button type="button" data-testid="summary-confirm" onClick={submit} disabled={busy} className={primaryBtn}>{busy ? "กำลังส่ง…" : "ยืนยันส่ง"}</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
