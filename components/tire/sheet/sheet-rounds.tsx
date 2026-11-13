"use client"

/** แท็บรอบอนุมัติ — แทน [template]อนุมัติจองยาง: ช่องเดิม (จากวันที่ ถึงวันที่ PR ผู้จัดทำ ผู้อนุมัติ 1/2) → เปิด PDF */
import { useCallback, useEffect, useState } from "react"
import { FileText, Pencil, Trash2, Plus, X, MessageSquareText } from "lucide-react"
import { swalToast, swalDeleteConfirm } from "@/lib/swal"
import { fmtDate } from "@/lib/tyre-sheet"

type Round = { _id: string; fromDate: string; toDate: string; pr: string; preparer: string; approver1: string; approver2: string; count: number; plates?: string[]; plateNotes?: Record<string, string> }
type PrHint = { pr: string; count: number; from: string; to: string; sizes: string[]; hasRound: boolean }
const EMPTY = { fromDate: "", toDate: "", pr: "", preparer: "", approver1: "", approver2: "" }

export function SheetRounds() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [prHints, setPrHints] = useState<PrHint[]>([])
  const [prFallback, setPrFallback] = useState(false)
  // หมายเหตุรายทะเบียน — เปิดทีละรอบ
  const [noteId, setNoteId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savingNotes, setSavingNotes] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/tyre-sheet/rounds")
    if (res.ok) setRounds(await res.json())
  }, [])
  // เรียกผ่าน setTimeout(0) ตาม lint rule ของ repo: react-hooks/set-state-in-effect
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  // เลข PR ในข้อมูลช่วงวันที่ที่เลือก — กดเลือกได้ ไม่ต้องไปเปิดชีตหา
  useEffect(() => {
    if (!open) return
    const sp = new URLSearchParams({ from: form.fromDate, to: form.toDate })
    const get = (q: string): Promise<PrHint[]> => fetch(`/api/tyre-sheet/rounds/prs?${q}`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    const t = setTimeout(async () => {
      let list = await get(sp.toString())
      // ช่วงที่เลือกไม่มี PR เลย → โชว์ PR ล่าสุดแทน
      const fallback = !list.length && !!(form.fromDate || form.toDate)
      if (fallback) list = await get("")
      setPrHints(list); setPrFallback(fallback)
    }, 0)
    return () => clearTimeout(t)
  }, [open, form.fromDate, form.toDate])

  // ยังไม่ได้เลือกวันที่ หรือช่วงที่เลือกไม่มี PR นี้ → ใช้ช่วงวันที่จองของ PR นั้น
  const pickPr = (h: PrHint) => setForm((f) => {
    const keep = !prFallback && f.fromDate && f.toDate
    return { ...f, pr: h.pr, fromDate: keep ? f.fromDate : h.from, toDate: keep ? f.toDate : h.to }
  })

  const startNew = () => {
    const last = rounds[0]
    setForm({ ...EMPTY, preparer: last?.preparer ?? "", approver1: last?.approver1 ?? "", approver2: last?.approver2 ?? "" })
    setEditId(null); setOpen(true)
  }
  const startEdit = (r: Round) => {
    setForm({ fromDate: r.fromDate, toDate: r.toDate, pr: r.pr, preparer: r.preparer, approver1: r.approver1, approver2: r.approver2 })
    setEditId(r._id); setOpen(true)
  }
  const save = async () => {
    const res = await fetch(editId ? `/api/tyre-sheet/rounds/${editId}` : "/api/tyre-sheet/rounds", {
      method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalToast("error", d.error ?? "บันทึกไม่สำเร็จ"); return }
    swalToast("success", "บันทึกรอบแล้ว")
    setOpen(false); load()
  }
  const pk = (p: string) => p.replace(/\s+/g, "")
  const openNotes = (r: Round) => {
    if (noteId === r._id) { setNoteId(null); return }
    setNotes({ ...(r.plateNotes ?? {}) }); setNoteId(r._id)
  }
  const saveNotes = async (r: Round) => {
    setSavingNotes(true)
    const res = await fetch(`/api/tyre-sheet/rounds/${r._id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plateNotes: notes }),
    }).catch(() => null)
    setSavingNotes(false)
    if (!res?.ok) { swalToast("error", "บันทึกหมายเหตุไม่สำเร็จ"); return }
    swalToast("success", "บันทึกหมายเหตุแล้ว")
    setNoteId(null); load()
  }
  const noteCount = (r: Round) => Object.values(r.plateNotes ?? {}).filter(Boolean).length

  const del = async (r: Round) => {
    const ok = await swalDeleteConfirm(`ลบรอบ ${r.pr} ? (ข้อมูลยางไม่ถูกลบ)`)
    if (!ok.isConfirmed) return
    await fetch(`/api/tyre-sheet/rounds/${r._id}`, { method: "DELETE" })
    load()
  }

  const field = (k: keyof typeof EMPTY, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5" />
    </label>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl">
        เหมือนแท็บ template เดิม: รอบหนึ่งดึงยางที่ <b>วันที่จอง</b> อยู่ในช่วงวันที่ และ <b>PR</b> ตรงกับเลขที่ใส่
        กดปุ่ม PDF เพื่อเปิดใบขออนุมัติ แล้วสั่งพิมพ์หรือบันทึกเป็น PDF จากหน้านั้น ยางที่เคยใช้มาก่อนจะขึ้นทุกรอบที่เคยใช้ไว้ในใบด้วย
      </p>
      {!open && (
        <button onClick={startNew} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">
          <Plus className="w-4 h-4" /> ตั้งรอบใหม่
        </button>
      )}
      {open && (
        <div className="rounded-lg border border-gray-200 dark:border-white/10 p-4 bg-white dark:bg-white/[0.03] space-y-3 max-w-4xl">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{editId ? "แก้รอบอนุมัติ" : "ตั้งรอบอนุมัติใหม่"}</div>
            <button onClick={() => setOpen(false)} aria-label="ปิด" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {field("fromDate", "จากวันที่", "date")}
            {field("toDate", "ถึงวันที่", "date")}
            {field("pr", "PR")}
            {field("preparer", "ผู้จัดทำ")}
            {field("approver1", "ผู้อนุมัติ_1")}
            {field("approver2", "ผู้อนุมัติ_2")}
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {prFallback ? "ช่วงวันที่นี้ไม่มี PR ในข้อมูล · PR ล่าสุด" : form.fromDate || form.toDate ? "PR ที่มีในข้อมูลช่วงวันที่นี้" : "PR ล่าสุดในข้อมูล"} · กดเพื่อใช้เลขนั้น
              {prFallback && " (กดแล้วจะเปลี่ยนวันที่เป็นช่วงของ PR นั้น)"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prHints.map((h) => (
                <button key={h.pr} type="button" onClick={() => pickPr(h)}
                  className={`text-left px-2 py-1 rounded-md border text-xs ${form.pr === h.pr ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10"}`}>
                  <div className="font-semibold">{h.pr}{h.hasRound && <span className="ml-1 font-normal text-amber-600">(มีรอบแล้ว)</span>}</div>
                  <div className="text-gray-500 dark:text-gray-400">{h.count} เส้น · {h.sizes.join(", ") || "-"} · {fmtDate(h.from)}–{fmtDate(h.to)}</div>
                </button>
              ))}
              {!prHints.length && <span className="text-xs text-gray-400">ไม่มี PR ในข้อมูลช่วงนี้</span>}
            </div>
          </div>
          <button onClick={save} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">บันทึก</button>
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-white/5 text-left">
            <tr>
              <th className="px-3 py-2">รอบ</th><th className="px-3 py-2">PR</th><th className="px-3 py-2 text-right">จำนวนเส้น</th>
              <th className="px-3 py-2">ผู้จัดทำ</th><th className="px-3 py-2">ผู้อนุมัติ_1</th><th className="px-3 py-2">ผู้อนุมัติ_2</th><th className="px-3 py-2">หมายเหตุ</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => [
              <tr key={r._id} className="border-t border-gray-100 dark:border-white/10">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</td>
                <td className="px-3 py-2">{r.pr}</td>
                <td className="px-3 py-2 text-right">{r.count}</td>
                <td className="px-3 py-2">{r.preparer}</td>
                <td className="px-3 py-2">{r.approver1}</td>
                <td className="px-3 py-2">{r.approver2}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => openNotes(r)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${noteId === r._id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10"}`}>
                    <MessageSquareText className="w-3.5 h-3.5" />
                    {noteCount(r) ? `${noteCount(r)}/${r.plates?.length ?? 0} คัน` : "ใส่หมายเหตุ"}
                  </button>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <a href={`/tire/saraburi/sheet/print/${r._id}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 text-xs">
                    <FileText className="w-3.5 h-3.5" /> PDF
                  </a>
                  <button onClick={() => startEdit(r)} className="ml-1 p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10" aria-label="แก้"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(r)} className="ml-1 p-1 rounded text-gray-400 hover:text-red-600" aria-label="ลบ"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>,
              noteId === r._id ? (
                <tr key={`${r._id}-notes`} className="bg-gray-50 dark:bg-white/[0.03]">
                  <td colSpan={8} className="px-3 py-3">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">หมายเหตุรายทะเบียน · ขึ้นในกล่องหมายเหตุของหน้ารถคันนั้นใน PDF · เว้นว่างได้</div>
                    <div className="grid gap-2 max-w-3xl">
                      {(r.plates ?? []).map((p) => (
                        <label key={p} className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
                          <span className="pt-1.5 font-medium">{p}</span>
                          <textarea rows={1} value={notes[pk(p)] ?? ""} placeholder="หมายเหตุ"
                            onChange={(e) => setNotes({ ...notes, [pk(p)]: e.target.value })}
                            className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5 field-sizing-content min-h-9" />
                        </label>
                      ))}
                      {!r.plates?.length && <span className="text-xs text-gray-400">รอบนี้ไม่มียางในข้อมูล</span>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => saveNotes(r)} disabled={savingNotes}
                        className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{savingNotes ? "กำลังบันทึก…" : "บันทึกหมายเหตุ"}</button>
                      <button onClick={() => setNoteId(null)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15">ยกเลิก</button>
                    </div>
                  </td>
                </tr>
              ) : null,
            ])}
            {!rounds.length && <tr><td colSpan={8} className="text-center text-gray-400 py-8">ยังไม่มีรอบ กดตั้งรอบใหม่</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
