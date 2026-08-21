"use client"

import { useEffect, useState } from "react"
import { Pencil, X } from "lucide-react"
import { mrChip, type MrLog } from "@/lib/tire-mr"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** หนึ่งบรรทัดพร้อมลำดับจริงในเอกสาร — ฝั่ง API แก้ทับด้วย index นี้ (ไทม์ไลน์แสดงกลับหัว) */
type LogRow = MrLog & { index: number }

/** โหลด logs ของ MR ใบหนึ่ง — เรียงใหม่ → เก่า */
function useMrLogs(mrId: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [logs, setLogs]       = useState<LogRow[]>([])

  // ผู้เรียกทุกที่ mount ใหม่ทุกครั้งที่เปิด (state เริ่มที่ loading อยู่แล้ว) จึงไม่ต้อง reset ใน effect
  useEffect(() => {
    let cancelled = false
    fetch(`/api/tire-mr/${mrId}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? "โหลดไทม์ไลน์ไม่สำเร็จ")
        return d
      })
      .then((d: { logs?: MrLog[] }) => {
        if (cancelled) return
        setLogs(Array.isArray(d.logs) ? d.logs.map((l, index) => ({ ...l, index })).reverse() : [])
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [mrId])

  return { loading, error, logs, setLogs }
}

/**
 * ไทม์ไลน์ MR แบบวางในเนื้อหาได้เลย — ทุกครั้งที่สร้าง/เปลี่ยนสถานะ พร้อมหมายเหตุและคนกด
 * ใช้แบบนี้เมื่ออยู่ในโมดัลอยู่แล้ว (โมดัลซ้อนโมดัลจะโดน focus trap ของชั้นนอกกินคลิกทั้งหมด)
 *
 * `editable` = แก้หมายเหตุของบรรทัดเดิมได้ในที่ — แก้ทับของเดิม ไม่เพิ่มบรรทัดใหม่ในไทม์ไลน์
 * ตั้งใจให้แก้ตรงนี้แทนที่จะเด้ง SweetAlert เพราะกล่องซ้อนโมดัลจะโดน focus trap กินการพิมพ์
 */
export function MrTimelineList({ mrId, compact, editable, onSaved }: {
  mrId: string
  compact?: boolean
  editable?: boolean
  /** แก้เสร็จแล้ว — ให้ผู้เรียกดึงหัวใบใหม่ (หมายเหตุล่าสุดบนหัวใบเปลี่ยนตาม) */
  onSaved?: () => void
}) {
  const { loading, error, logs, setLogs } = useMrLogs(mrId)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [draft, setDraft]         = useState("")
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function startEdit(l: LogRow) {
    setEditIndex(l.index)
    setDraft(l.note ?? "")
    setSaveError(null)
  }

  async function save(index: number) {
    const text = draft.trim()
    if (!text) { setSaveError("กรุณากรอกหมายเหตุ"); return }

    setSaving(true)
    setSaveError(null)
    const res = await fetch(`/api/tire-mr/${mrId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logIndex: index, note: text }),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setSaveError(d.error ?? "บันทึกไม่สำเร็จ"); return }

    setLogs((prev) => prev.map((l) =>
      l.index === index ? { ...l, note: text, editedBy: d.editedBy, editedAt: d.editedAt } : l
    ))
    setEditIndex(null)
    onSaved?.()
  }

  if (loading) return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-gray-400`}>กำลังโหลด...</p>
  if (error)   return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-red-500`}>{error}</p>
  if (logs.length === 0) return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-gray-400`}>ยังไม่มีประวัติ</p>

  return (
    <ol className={compact ? "space-y-2" : "space-y-3"}>
      {logs.map((l) => {
        const { label, cls } = mrChip(l.status)
        const editing = editIndex === l.index
        return (
          <li key={l.index} className="border-l-2 border-[#EEF2F0] pl-3 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${cls}`}>{label}</span>
              <span className="text-[11px] text-gray-400">{fmtDate(l.updatedAt)}</span>
              {l.updatedBy && <span className="text-[11px] text-gray-500 dark:text-gray-400">· {l.updatedBy}</span>}
              {editable && !editing && (
                <button type="button" onClick={() => startEdit(l)}
                  className="ml-auto inline-flex cursor-pointer items-center gap-0.5 text-[11px] text-[#6B7C72] underline decoration-dotted transition-colors hover:text-[#1B8C4B] dark:text-gray-400 dark:hover:text-green-400">
                  <Pencil size={9} /> แก้ไข
                </button>
              )}
            </div>

            {editing ? (
              <div className="mt-1.5">
                <textarea
                  autoFocus
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="อาการ / สิ่งที่ซ่อม / ผู้รับผิดชอบ..."
                  className="w-full rounded-[8px] border border-[#EEF2F0] bg-white px-2 py-1.5 text-[12px] text-[#14271C] outline-none focus:border-[#1B8C4B] dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
                {saveError && <p className="mt-1 text-[11px] text-red-500">{saveError}</p>}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button type="button" disabled={saving} onClick={() => save(l.index)}
                    className="cursor-pointer rounded-[8px] bg-[#1B8C4B] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
                    {saving ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                  <button type="button" disabled={saving} onClick={() => setEditIndex(null)}
                    className="cursor-pointer rounded-[8px] px-2.5 py-1 text-[11px] font-semibold text-[#6B7C72] ring-1 ring-[#EEF2F0] disabled:opacity-50 dark:text-gray-300 dark:ring-white/10">
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <>
                {l.note
                  ? <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#6B7C72] dark:text-gray-300">{l.note}</p>
                  : editable && <p className="mt-1 text-[12px] italic text-gray-400">ยังไม่มีหมายเหตุ</p>}
                {/* แก้ทับของเดิมแล้วเวลาบนบรรทัดยังเป็นเวลาที่สถานะขยับจริง — บอกไว้ว่าเนื้อความถูกแก้ทีหลัง */}
                {l.editedAt && (
                  <p className="mt-0.5 text-[10.5px] text-gray-400">
                    แก้ไขเมื่อ {fmtDate(l.editedAt)}{l.editedBy ? ` · ${l.editedBy}` : ""}
                  </p>
                )}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** ไทม์ไลน์แบบโมดัลเดี่ยว — ใช้ในหน้าที่ไม่มีโมดัลอื่นเปิดค้างอยู่ */
export function MrTimelineDialog({ mrId, plate, onClose }: {
  mrId: string
  plate: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-[16px] border border-[#EEF2F0] bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#151a10]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#14271C] dark:text-white">
            ไทม์ไลน์ MR · <span className="font-mono">{plate}</span>
          </h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10">
            <X size={14} />
          </button>
        </div>
        <MrTimelineList mrId={mrId} />
      </div>
    </div>
  )
}
