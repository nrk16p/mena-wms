"use client"
// ชิ้นส่วนกลางหน้า admin /vendors/onboarding — ป้ายสถานะ, กล่อง modal, ปุ่ม
// สีป้ายเลือกจาก "ต่อไปต้องมีใครทำอะไร" (แนวเดียวกับ hr-service chip tokens):
//   ฟ้า = งานใหม่ ฝ่ายจัดซื้อต้องหยิบ · teal = กำลังทำ · เหลือง = รอ vendor · ม่วง = รอรีวิว · ชมพู = รออนุมัติ
//   เขียว = จบผ่าน · แดง = จบไม่ผ่าน · เทา = ปิด/ยกเลิก
import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { STATUS_LABEL, DOC_STATUS_LABEL, type DocStatus, type OnboardingStatus, type OnboardingSummary } from "@/lib/vendor-onboarding/types"

export const fontThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
export const fontHead = { fontFamily: "'Mitr', sans-serif" }

export type AnyStatus = OnboardingSummary["status"]

export const LEGACY_LABEL: Record<"legacy_pending" | "legacy_approved" | "legacy_rejected", string> = {
  legacy_pending: "แบบเก่า · รอตรวจ",
  legacy_approved: "แบบเก่า · อนุมัติ",
  legacy_rejected: "แบบเก่า · ไม่ผ่าน",
}
export const LEGACY_STATUSES = Object.keys(LEGACY_LABEL) as (keyof typeof LEGACY_LABEL)[]

export function statusLabel(s: AnyStatus): string {
  return s in LEGACY_LABEL ? LEGACY_LABEL[s as keyof typeof LEGACY_LABEL] : STATUS_LABEL[s as OnboardingStatus]
}

type Tone = { chip: string; dot: string }
const T = {
  new:    { chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30", dot: "bg-sky-600" },
  live:   { chip: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-200 dark:ring-teal-400/30", dot: "bg-teal-600" },
  wait:   { chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/30", dot: "bg-amber-500" },
  violet: { chip: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/30", dot: "bg-violet-600" },
  pink:   { chip: "bg-pink-50 text-pink-800 ring-pink-200 dark:bg-pink-500/15 dark:text-pink-200 dark:ring-pink-400/30", dot: "bg-pink-600" },
  ok:     { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30", dot: "bg-emerald-600" },
  bad:    { chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-400/30", dot: "bg-red-600" },
  done:   { chip: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/8 dark:text-gray-300 dark:ring-white/15", dot: "bg-gray-400" },
} satisfies Record<string, Tone>

export const STATUS_TONE: Record<AnyStatus, Tone> = {
  submitted: T.new,
  checking: T.live,
  need_docs: T.wait,
  pending_review: T.violet,
  pending_approval: T.pink,
  approved: T.ok,
  rejected: T.bad,
  cancelled: T.done,
  legacy_pending: T.done,
  legacy_approved: T.done,
  legacy_rejected: T.done,
}

export function StatusPill({ status }: { status: AnyStatus }) {
  const t = STATUS_TONE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${t.chip}`} style={fontThai}>
      <span aria-hidden className={`size-1.5 rounded-full ${t.dot}`} />
      {statusLabel(status)}
    </span>
  )
}

export const DOC_TONE: Record<DocStatus, Tone> = { missing: T.done, waiting: T.wait, passed: T.ok, redo: T.bad }

export function DocChip({ status }: { status: DocStatus }) {
  const t = DOC_TONE[status]
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${t.chip}`}>{DOC_STATUS_LABEL[status]}</span>
}

// ── ปุ่ม ─────────────────────────────────────────────────────────────────────
const btnBase = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-[#151a10]"
export const btn = {
  primary: `${btnBase} bg-[#1B8C4B] text-white hover:bg-[#0F6A3C]`,
  ghost: `${btnBase} border border-[#E2E8E4] bg-white text-[#14271C] hover:border-[#1B8C4B]/40 hover:bg-[#F6FAF7] dark:border-white/10 dark:bg-transparent dark:text-gray-100 dark:hover:bg-white/5`,
  danger: `${btnBase} border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-400/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/10`,
}
export const inputCls = "w-full rounded-lg border border-[#E2E8E4] bg-white px-3 py-2 text-sm text-[#14271C] placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/20 dark:border-white/10 dark:bg-[#0f1117] dark:text-white"

// ── modal ────────────────────────────────────────────────────────────────────
// กองของ modal ที่เปิดอยู่ — Esc ปิดเฉพาะใบบนสุด (เปิด modal ซ้อนจาก modal ได้)
const modalStack: object[] = []

export function ModalShell({ title, subtitle, onClose, footer, width = "820px", children }: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: string
  children: ReactNode
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    const token = {}
    modalStack.push(token)
    const prevFocus = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return
      // popover ของ radix / sweetalert จัดการ Esc เอง
      if (document.querySelector(".swal2-container")) return
      if (e.key === "Escape") { e.stopPropagation(); close.current(); return }
      if (e.key === "Tab" && dialog.current) {
        const f = dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener("keydown", onKey)
    dialog.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener("keydown", onKey)
      modalStack.splice(modalStack.indexOf(token), 1)
      prevFocus?.focus?.({ preventScroll: true })
    }
  }, [])

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-6" style={fontThai}>
      <button type="button" aria-label="ปิดหน้าต่าง" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-[18px] border border-[#E2E8E4] bg-[#F6F8F7] shadow-2xl outline-none dark:border-white/10 dark:bg-[#10140d]"
      >
        <header className="flex flex-none items-start gap-4 border-b border-[#E2E8E4] bg-white px-5 py-3.5 dark:border-white/10 dark:bg-[#151a10]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-[17px] font-semibold leading-snug text-[#14271C] dark:text-white" style={fontHead}>{title}</h2>
            {subtitle && <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray-500 dark:text-gray-400">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="flex size-9 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 dark:hover:bg-white/10 dark:hover:text-white">
            <X size={19} aria-hidden />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && (
          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-[#E2E8E4] bg-white px-5 py-3 dark:border-white/10 dark:bg-[#151a10]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function Panel({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#E8EEEA] bg-white p-4 dark:border-white/8 dark:bg-[#151a10]">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-[13.5px] font-semibold text-[#14271C] dark:text-white">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Dl({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 border-b border-dashed border-[#EEF2F0] py-2 text-[13px] last:border-b-0 dark:border-white/8">
          <dt className="w-28 flex-none text-gray-500 dark:text-gray-400">{k}</dt>
          <dd className="m-0 min-w-0 flex-1 whitespace-pre-line break-words text-[#14271C] dark:text-gray-100">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  )
}
