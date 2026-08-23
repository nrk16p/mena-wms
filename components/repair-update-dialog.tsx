"use client"

// ── ฟอร์ม "อัพเดทงาน" ────────────────────────────────────────────────────────
// ทางเดียวที่สถานะของงานอู่นอก/อะไหล่ลงคันจะขยับได้ — ทุกครั้งต้องครบสามอย่าง
//   สถานะ (เลือกสถานะเดิมได้ = ยังค้างขั้นเดิม) + วันคาดพ้นขั้น + ข้อความว่าเกิดอะไรขึ้น
// กติกาตรวจใช้ validateJobUpdate ตัวเดียวกับฝั่ง API (lib/repair-external.ts)

import { useMemo, useState } from "react"
import { CalendarClock, Loader2, MessageSquarePlus, X } from "lucide-react"
import {
  jobTypeOf, statusMeta, statusesFor, stageEtaRequired, validateJobUpdate,
  type RepairField,
} from "@/lib/repair-external"
import { bkkToday } from "@/lib/bkk-time"
import { swalToast } from "@/lib/swal"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr     = { fontFamily: "'Mitr', sans-serif" }

// ข้อความที่พิมพ์ซ้ำ ๆ ทุกวัน — กดเติมได้ ไม่ต้องพิมพ์เอง (ยังแก้ต่อได้)
const QUICK_NOTES = [
  "อู่แจ้งว่ารออะไหล่",
  "รออนุมัติราคา",
  "อู่รับรถแล้ว เริ่มซ่อม",
  "รอคิวช่าง",
  "ซ่อมเสร็จ รอส่งมอบ",
  "ตามแล้ว ยังไม่คืบหน้า",
]

type Row = { _id: string; plate?: string; fleetNo?: string; status?: string; stageEta?: string } & Record<string, unknown>

export function RepairUpdateDialog({
  row, onClose, onDone, onFixFields,
}: {
  row: Row
  onClose: () => void
  /** อัพเดทสำเร็จ — ให้หน้าหลักโหลดข้อมูล/ไทม์ไลน์ใหม่ */
  onDone: () => void
  /** ปิดงานไม่ได้เพราะข้อมูลยังไม่ครบ — พาไปกรอกในฟอร์มแก้ไข */
  onFixFields?: (missing: { field: RepairField; label: string }[]) => void
}) {
  const current  = String(row.status ?? "")
  const jobType  = jobTypeOf(row as { jobType?: string })
  const statuses = statusesFor(jobType)

  const [status, setStatus]   = useState(current)
  const [eta, setEta]         = useState(String(row.stageEta ?? ""))
  const [note, setNote]       = useState("")
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [missing, setMissing] = useState<{ field: RepairField; label: string }[]>([])

  // เปลี่ยนไปสถานะใหม่ = วันคาดของขั้นเดิมใช้ต่อไม่ได้ ต้องตั้งใหม่ · กลับมาสถานะเดิมคืนค่าเดิมให้
  function pickStatus(next: string) {
    setStatus(next)
    setEta(next === current ? String(row.stageEta ?? "") : "")
  }

  const problem = useMemo(
    () => validateJobUpdate({ status, stageEta: eta, note, current: row }),
    [status, eta, note, row],
  )
  // ปุ่มบันทึกไม่ถูกปิดเพราะ validate ไม่ผ่านอีกแล้ว — กดแล้วต้องได้เหตุผลเสมอ
  // (ของเดิมปุ่มเทาเฉย ๆ คนใช้เลยไม่มีทางรู้ว่าปิดงานไม่ได้เพราะยังไม่มีรหัส PR)
  const touched  = note.trim().length > 0 || status !== current || eta !== String(row.stageEta ?? "")
  const shownErr = err ? { error: err, missing } : (touched && problem ? problem : null)

  const addDays = (n: number) => new Date(Date.parse(bkkToday()) + n * 86400000).toISOString().slice(0, 10)

  async function submit() {
    if (problem) { setErr(problem.error); setMissing(problem.missing ?? []); return }
    setSaving(true); setErr(null); setMissing([])
    try {
      const res  = await fetch(`/api/repair-external/${row._id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, stageEta: eta, note: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data.error || "อัพเดทไม่สำเร็จ")
        setMissing(data.missing ?? [])
        return
      }
      swalToast("success", data.statusChanged ? `อัพเดทเป็น “${status}” แล้ว` : "บันทึกอัพเดทแล้ว")
      onDone()
      onClose()
    } catch {
      setErr("อัพเดทไม่สำเร็จ — ตรวจการเชื่อมต่อแล้วลองใหม่")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#151a10] sm:rounded-2xl"
        style={sansThai}
      >
        {/* หัว */}
        <div className="flex items-center gap-2.5 border-b border-[#EEF2F0] px-4 py-3 dark:border-white/10">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F3E8FF] text-[#7C3AED] dark:bg-violet-500/15">
            <MessageSquarePlus size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-[#14271C] dark:text-white" style={mitr}>อัพเดทงาน</h2>
            <p className="truncate text-[11.5px] text-[#9AA8A0]">
              {row.fleetNo || row.plate || "—"}{row.fleetNo && row.plate ? ` · ${row.plate}` : ""} · ตอนนี้อยู่ขั้น “{current || "—"}”
            </p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9AA8A0] hover:bg-gray-100 dark:hover:bg-white/5">
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* 1. สถานะ */}
          <div>
            <label className="text-[12.5px] font-bold text-[#37473E] dark:text-gray-300">1 · สถานะตอนนี้ <span className="text-[#DC2626]">*</span></label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {statuses.map((s) => {
                const on   = status === s.value
                const same = s.value === current
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => pickStatus(s.value)}
                    className={`rounded-full border px-2.5 py-1.5 text-[12px] font-semibold transition ${
                      on ? "border-[#1B8C4B] bg-[#1B8C4B] text-white"
                         : "border-[#E2E8E4] text-[#5B7568] hover:bg-[#F6FAF7] dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                    }`}
                  >
                    {s.emoji} {s.value}
                    {same && <span className={`ml-1 text-[10px] font-bold ${on ? "text-white/80" : "text-[#9AA8A0]"}`}>· ยังอยู่ขั้นเดิม</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. วันคาดพ้นขั้น — สถานะปิดงานไม่ต้องตอบ */}
          {stageEtaRequired(status) && (
            <div className="rounded-xl border border-[#E4D5FB] bg-[#FAF5FF] p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
              <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#7C3AED] dark:text-violet-300">
                <CalendarClock size={14} /> 2 · คาดว่าจะพ้นขั้น “{status}” เมื่อไหร่ <span className="text-[#DC2626]">*</span>
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {[{ n: 1, l: "พรุ่งนี้" }, { n: 3, l: "อีก 3 วัน" }, { n: 7, l: "อีก 7 วัน" }].map((p) => (
                  <button
                    key={p.n}
                    type="button"
                    onClick={() => setEta(addDays(p.n))}
                    className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition ${
                      eta === addDays(p.n) ? "border-[#7C3AED] bg-[#EDE9FE] text-[#7C3AED] dark:bg-violet-500/20"
                                           : "border-[#E2E8E4] text-[#5B7568] hover:bg-white dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                    }`}
                  >
                    {p.l}
                  </button>
                ))}
                <input
                  type="date"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                  className="ml-auto rounded-lg border border-[#E2E8E4] bg-white px-2.5 py-1.5 text-[12.5px] text-gray-900 focus:border-[#1B8C4B] focus:outline-none dark:border-white/10 dark:bg-[#0f1117] dark:text-white"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[#7C3AED]/75 dark:text-violet-300/70">
                ผูกกับขั้นนี้เท่านั้น ไม่ใช่วันกำหนดเสร็จของงานทั้งใบ · ค่าเดิมเก็บไว้ในประวัติ
              </p>
            </div>
          )}

          {/* 3. ข้อความ */}
          <div>
            <label className="text-[12.5px] font-bold text-[#37473E] dark:text-gray-300">
              {stageEtaRequired(status) ? "3" : "2"} · เกิดอะไรขึ้น <span className="text-[#DC2626]">*</span>
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_NOTES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setNote((n) => (n.trim() ? `${n.trim()} · ${q}` : q))}
                  className="rounded-lg border border-[#E2E8E4] px-2 py-1 text-[11.5px] text-[#5B7568] transition hover:bg-[#F6FAF7] dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  + {q}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เล่าสั้น ๆ ว่าคืบหน้าถึงไหน / ติดอะไรอยู่"
              className="mt-1.5 w-full resize-y rounded-lg border border-[#E2E8E4] bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-[#1B8C4B] focus:outline-none dark:border-white/10 dark:bg-[#0f1117] dark:text-white"
            />
          </div>

          {/* ทำไมยังบันทึกไม่ได้ — แดง = ที่ server ตีกลับ · เหลือง = เตือนล่วงหน้า */}
          {shownErr && (
            <div className={`rounded-xl border p-3 text-[12.5px] ${
              err ? "border-[#F7CFCF] bg-[#FEECEC] text-[#B42318] dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                  : "border-[#F5D9A6] bg-[#FEF7E7] text-[#B07D12] dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
            }`}>
              {shownErr.error}
              {(shownErr.missing?.length ?? 0) > 0 && onFixFields && (
                <button
                  type="button"
                  onClick={() => { onFixFields(shownErr.missing!); onClose() }}
                  className="mt-2 block rounded-lg bg-[#7C3AED] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#6D28D9]"
                >
                  ไปกรอกข้อมูลที่ขาด ({shownErr.missing!.map((m) => m.label).join(" · ")})
                </button>
              )}
            </div>
          )}
        </div>

        {/* ท้าย */}
        <div className="flex items-center justify-between gap-2 border-t border-[#EEF2F0] px-4 py-3 dark:border-white/10">
          <p className="text-[11px] text-[#9AA8A0]">
            {status === current
              ? `ยังอยู่ขั้น “${current || "—"}”`
              : `${statusMeta(current).emoji} ${current || "—"} → ${statusMeta(status).emoji} ${status}`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-[#E2E8E4] px-3.5 py-2 text-[13px] font-medium text-[#5B7568] hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5">
              ยกเลิก
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
              บันทึกอัพเดท
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
