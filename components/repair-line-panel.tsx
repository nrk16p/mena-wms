"use client"

/* แผง "ส่งไลน์" ของหน้าอู่นอก — รวมข้อความที่เคยเป็นปุ่มคัดลอกกระจายอยู่บนแถบสถานะ
 * (คัดลอกสรุป / คัดลอกรถเสร็จ(ไม่มี PR) / ตามงาน / ไม่มี PR รายคน) มาไว้ที่เดียว
 * ต่างจากปุ่มเดิมอย่างเดียวคือ "เห็นข้อความก่อนคัดลอก" — ตรรกะข้อความอยู่ที่ผู้เรียก (build())
 * ไม่ได้ย้ายมาไว้ในนี้ ข้อความที่ส่งเข้ากลุ่มไลน์จึงเหมือนเดิมทุกตัวอักษร
 */

import { useCallback, useEffect, useState } from "react"
import { Copy, RefreshCw, X } from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"

/** ผลของการสร้างข้อความ — empty = ไม่มีงานให้ส่ง (ไม่ใช่ error) แสดงเป็นข้อความดี ๆ ไม่ใช่กล่องแดง */
export type LineBuild = { text: string } | { empty: string }

export type LineMessage = {
  key:    string
  emoji:  string
  label:  string
  /** ตัวเลขกำกับ เช่น "17 คัน" */
  meta?:  string
  /** คำอธิบายใต้ชื่อ + tooltip */
  hint?:  string
  /** หัวข้อกลุ่มในรายการซ้าย (ค่าซ้ำติดกันพิมพ์ครั้งเดียว) */
  group?: string
  /** ดึงข้อมูลสดแล้วคืนข้อความ — throw ได้ ผู้ใช้จะเห็นกล่องแดงพร้อมข้อความนั้น */
  build:  () => Promise<LineBuild> | LineBuild
}

export function RepairLinePanel({
  onClose,
  messages,
}: {
  onClose:  () => void
  messages: LineMessage[]
}) {
  const [sel,     setSel]     = useState("")
  const [text,    setText]    = useState("")
  const [empty,   setEmpty]   = useState("")
  const [err,     setErr]     = useState("")
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (key: string) => {
    const msg = messages.find((m) => m.key === key)
    if (!msg) return
    setSel(key); setLoading(true); setErr(""); setEmpty(""); setText("")
    try {
      const out = await msg.build()
      if ("empty" in out) setEmpty(out.empty)
      else setText(out.text)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "สร้างข้อความไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [messages])

  // เปิดแผงมาแล้วเห็นข้อความแรกเลย ไม่ต้องกดอีกครั้ง (รันครั้งเดียวตอน mount)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ตั้งใจเริ่มโหลดข้อความแรกตอนเปิดแผง (ดึงข้อมูล ไม่ใช่ derived state)
    if (messages.length) void run(messages[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจอ่าน messages/run ตอนเปิดครั้งเดียว
  }, [])

  // Esc ปิดแผง — แผงนี้ไม่มีอะไรค้างให้เสียหาย ปิดได้ทันทีไม่ต้องถาม
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function copy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      swalToast("success", "คัดลอกแล้ว — วางในไลน์ได้เลย")
    } catch {
      swalError("คัดลอกไม่สำเร็จ")
    }
  }

  const current = messages.find((m) => m.key === sel)
  const lines   = text ? text.split("\n").length : 0
  const listed  = messages.map((m, i) => ({
    m,
    head: m.group && m.group !== messages[i - 1]?.group ? m.group : "",
  }))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
      <div className="drawer-in flex h-full w-full max-w-[52rem] flex-col border-l border-[#EEF2F0] bg-white shadow-2xl dark:border-white/10 dark:bg-[#151a10]">
        {/* หัวแผง */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-[#EEF2F0] px-4 py-3 dark:border-white/8">
          <div>
            <h2 className="text-[17px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
              📤 ส่งไลน์
            </h2>
            <p className="text-[11.5px] text-[#9AA8A0]">เลือกข้อความ → ดูก่อน → คัดลอกไปวางในกลุ่มไลน์ · ข้อมูลดึงสดตอนกด ไม่ขึ้นกับตัวกรองบนหน้า</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#E2E8E4] p-1.5 text-gray-500 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            title="ปิด (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* ซ้าย: รายการข้อความ */}
          <div className="max-h-[38vh] min-w-0 shrink-0 overflow-y-auto border-b border-[#EEF2F0] p-2.5 md:max-h-none md:w-[17rem] md:border-b-0 md:border-r dark:border-white/8">
            <div className="space-y-1">
              {listed.map(({ m, head }) => {
                const on = m.key === sel
                return (
                  <div key={m.key}>
                    {head && <p className="px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#9AA8A0]">{head}</p>}
                    <button
                      onClick={() => void run(m.key)}
                      title={m.hint}
                      className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition ${on
                        ? "border-[#1B8C4B] bg-[#F0FDF4] dark:border-[#1B8C4B] dark:bg-[#1B8C4B]/15"
                        : "border-[#E2E8E4] hover:bg-[#F6FAF7] dark:border-white/10 dark:hover:bg-white/5"}`}
                    >
                      <span className={`block text-[12.5px] font-semibold ${on ? "text-[#0F6A3C] dark:text-[#4ade80]" : "text-[#37473E] dark:text-gray-200"}`}>
                        {m.emoji} {m.label}
                      </span>
                      {m.meta && <span className="block text-[11px] text-[#9AA8A0]">{m.meta}</span>}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ขวา: ข้อความจริงที่จะวางในไลน์ */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F0] px-3.5 py-2 dark:border-white/8">
              <p className="text-[12.5px] font-semibold text-[#37473E] dark:text-gray-200">
                {current ? `${current.emoji} ${current.label}` : "เลือกข้อความจากรายการซ้าย"}
                {text && <span className="ml-2 font-normal text-[11px] text-[#9AA8A0]">{lines} บรรทัด · {text.length} ตัวอักษร</span>}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => sel && void run(sel)}
                  disabled={loading || !sel}
                  title="ดึงข้อมูลใหม่"
                  className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8E4] px-2 py-1 text-[11.5px] font-medium text-gray-600 transition hover:bg-[#F6FAF7] disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> ดึงใหม่
                </button>
                <button
                  onClick={() => void copy()}
                  disabled={!text || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#157a41] disabled:opacity-40"
                >
                  <Copy size={13} /> คัดลอกข้อความ
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
              {loading ? (
                <p className="text-[12.5px] text-[#9AA8A0]">กำลังดึงข้อมูล…</p>
              ) : err ? (
                <p className="rounded-lg bg-[#FEECEC] px-3 py-2 text-[12.5px] font-medium text-[#DC2626] dark:bg-red-950/25 dark:text-red-300">{err}</p>
              ) : empty ? (
                <p className="rounded-lg bg-[#F0FDF4] px-3 py-2 text-[12.5px] font-medium text-[#0F6A3C] dark:bg-emerald-900/15 dark:text-emerald-300">{empty}</p>
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-[#F6FAF7] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#14271C] dark:bg-white/5 dark:text-gray-100" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                  {text}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
