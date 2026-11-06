"use client"

/** แท็บรอบอนุมัติ — แทน [template]อนุมัติจองยาง: ช่องเดิม (จากวันที่ ถึงวันที่ PR ผู้จัดทำ ผู้อนุมัติ 1/2) → เปิด PDF */
import { useCallback, useEffect, useState } from "react"
import { FileText, Pencil, Trash2, Plus, X } from "lucide-react"
import { swalToast, swalDeleteConfirm } from "@/lib/swal"
import { fmtDate } from "@/lib/tyre-sheet"

type Round = { _id: string; fromDate: string; toDate: string; pr: string; preparer: string; approver1: string; approver2: string; count: number }
const EMPTY = { fromDate: "", toDate: "", pr: "", preparer: "", approver1: "", approver2: "" }

export function SheetRounds() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/tyre-sheet/rounds")
    if (res.ok) setRounds(await res.json())
  }, [])
  // เรียกผ่าน setTimeout(0) ตาม lint rule ของ repo: react-hooks/set-state-in-effect
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

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
        กดปุ่ม PDF เพื่อเปิดใบขออนุมัติ แล้วสั่งพิมพ์หรือบันทึกเป็น PDF จากหน้านั้น ยางที่เคยใช้มาก่อนจะขึ้นทุกชีวิตในใบด้วย
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
          <button onClick={save} className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">บันทึก</button>
        </div>
      )}
      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-white/5 text-left">
            <tr>
              <th className="px-3 py-2">รอบ</th><th className="px-3 py-2">PR</th><th className="px-3 py-2 text-right">จำนวนเส้น</th>
              <th className="px-3 py-2">ผู้จัดทำ</th><th className="px-3 py-2">ผู้อนุมัติ_1</th><th className="px-3 py-2">ผู้อนุมัติ_2</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r._id} className="border-t border-gray-100 dark:border-white/10">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</td>
                <td className="px-3 py-2">{r.pr}</td>
                <td className="px-3 py-2 text-right">{r.count}</td>
                <td className="px-3 py-2">{r.preparer}</td>
                <td className="px-3 py-2">{r.approver1}</td>
                <td className="px-3 py-2">{r.approver2}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <a href={`/tire/saraburi/sheet/print/${r._id}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 text-xs">
                    <FileText className="w-3.5 h-3.5" /> PDF
                  </a>
                  <button onClick={() => startEdit(r)} className="ml-1 p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10" aria-label="แก้"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(r)} className="ml-1 p-1 rounded text-gray-400 hover:text-red-600" aria-label="ลบ"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
            {!rounds.length && <tr><td colSpan={7} className="text-center text-gray-400 py-8">ยังไม่มีรอบ กดตั้งรอบใหม่</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
