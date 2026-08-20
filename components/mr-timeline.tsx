"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { mrChip, type MrLog } from "@/lib/tire-mr"

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** โหลด logs ของ MR ใบหนึ่ง — เรียงใหม่ → เก่า */
function useMrLogs(mrId: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [logs, setLogs]       = useState<MrLog[]>([])

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
        setLogs(Array.isArray(d.logs) ? [...d.logs].reverse() : [])
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [mrId])

  return { loading, error, logs }
}

/**
 * ไทม์ไลน์ MR แบบวางในเนื้อหาได้เลย — ทุกครั้งที่สร้าง/เปลี่ยนสถานะ พร้อมหมายเหตุและคนกด
 * ใช้แบบนี้เมื่ออยู่ในโมดัลอยู่แล้ว (โมดัลซ้อนโมดัลจะโดน focus trap ของชั้นนอกกินคลิกทั้งหมด)
 */
export function MrTimelineList({ mrId, compact }: { mrId: string; compact?: boolean }) {
  const { loading, error, logs } = useMrLogs(mrId)

  if (loading) return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-gray-400`}>กำลังโหลด...</p>
  if (error)   return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-red-500`}>{error}</p>
  if (logs.length === 0) return <p className={`${compact ? "py-2" : "py-8 text-center"} text-[12px] text-gray-400`}>ยังไม่มีประวัติ</p>

  return (
    <ol className={compact ? "space-y-2" : "space-y-3"}>
      {logs.map((l, i) => {
        const { label, cls } = mrChip(l.status)
        return (
          <li key={i} className="border-l-2 border-[#EEF2F0] pl-3 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${cls}`}>{label}</span>
              <span className="text-[11px] text-gray-400">{fmtDate(l.updatedAt)}</span>
              {l.updatedBy && <span className="text-[11px] text-gray-500 dark:text-gray-400">· {l.updatedBy}</span>}
            </div>
            {l.note && <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#6B7C72] dark:text-gray-300">{l.note}</p>}
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
