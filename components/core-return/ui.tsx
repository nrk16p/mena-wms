"use client"

// ชิ้นส่วน UI พื้นฐานของหน้าติดตามซาก: ปุ่ม · โครงโหลด · แจ้งผล · หน้าต่างกลางจอ · สถานะว่าง
import { useSyncExternalStore } from "react"
import { CheckCircle2, Loader2, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { BTN, BORDER, CARD_SM, OVERLAY_SHADOW, SKELETON, TOAST, TXT, K } from "./tokens"

type Variant = "primary" | "secondary" | "ghost" | "danger" | "store" | "procure" | "onDark" | "onDarkOutline" | "onDarkText"
type Size = "sm" | "md" | "lg" | "icon"

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />
}

/** ปุ่มมาตรฐาน: loading = ล็อกกันกดซ้ำ + วงหมุน · icon-only ต้องส่ง aria-label */
export function Button({ variant = "primary", size = "md", loading, loadingText, className = "", disabled, children, type = "button", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; loadingText?: string }) {
  const look = loading && variant === "primary" ? BTN.busy : BTN[variant]
  return (
    <button {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`${BTN.base} ${BTN[size]} ${look} ${className}`}>
      {loading && <Spinner />}{loading && loadingText ? loadingText : children}
    </button>
  )
}

/** โครงเทาระหว่างโหลด (ไม่ใช้วงหมุนกลางจอ) */
export function Bar({ w = "w-full", h = "h-3.5", className = "" }: { w?: string; h?: string; className?: string }) {
  return <div className={`${h} ${w} animate-pulse rounded-md ${SKELETON} ${className}`} />
}
export function SkeletonCards({ n = 3, tall = false }: { n?: number; tall?: boolean }) {
  return (
    <div className="space-y-2" role="status" aria-label="กำลังโหลด">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`${CARD_SM} flex flex-col gap-2.5 p-4`}>
          <Bar w="w-3/5" /><Bar w="w-5/6" /><Bar w="w-2/5" />
          {tall && <Bar w="w-28" h="h-9" className="rounded-[10px]" />}
        </div>
      ))}
    </div>
  )
}
export function SkeletonRows({ n = 8 }: { n?: number }) {
  return (
    <div className={`divide-y ${K["divide-cEEF2F0"]}`} role="status" aria-label="กำลังโหลด">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Bar w="w-5" h="h-5" /><Bar w="w-16" h="h-6" className="rounded-full" /><Bar w="w-28" /><Bar w="w-24" /><Bar w="w-1/4" /><Bar w="w-20" className="ml-auto" /><Bar w="w-24" h="h-9" className="rounded-[10px]" />
        </div>
      ))}
    </div>
  )
}

/** สถานะว่างที่บอกทางไปต่อ */
export function EmptyState({ title, hint, onClear, clearLabel = "ล้างตัวกรอง" }: { title: string; hint?: string; onClear?: () => void; clearLabel?: string }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed ${K["border-cC9D3CD"]} bg-white px-5 py-8 text-center`} data-testid="empty-state">
      <p className={`font-bold ${K["text-ink"]}`}>{title}</p>
      {hint && <p className={`text-[13px] ${TXT.muted}`}>{hint}</p>}
      {onClear && <Button variant="secondary" size="sm" className="mt-1.5" onClick={onClear}>{clearLabel}</Button>}
    </div>
  )
}

// ---------- แจ้งผลมุมล่าง (หายเองใน 4 วินาที) ----------
type T = { id: number; kind: "success" | "error"; msg: string }
let toasts: T[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
export function toast(kind: T["kind"], msg: string) {
  const id = ++seq
  toasts = [...toasts, { id, kind, msg }]
  emit()
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit() }, 4000)
}
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }
const EMPTY: T[] = []
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => EMPTY)
  if (!list.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:max-w-md">
      {list.map((t) => (
        <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className={`pointer-events-auto flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm shadow-lg ${TOAST[t.kind]}`}>
          {t.kind === "success" && <CheckCircle2 size={18} aria-hidden className="shrink-0" />}{t.msg}
        </div>
      ))}
    </div>
  )
}

/** หน้าต่างกลางจอ: หัว + ปุ่มปิด 36px · ใช้ Dialog ของระบบ (focus trap / Esc) */
export function Modal({ open, onClose, title, children, width = "sm:max-w-[520px]", testid }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string; testid?: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} data-testid={testid}
        className={`max-h-[92vh] gap-3.5 overflow-y-auto rounded-[18px] ${BORDER} p-5 ${OVERLAY_SHADOW} ${width}`}>
        <div className="flex items-center justify-between">
          <DialogTitle className={`text-lg font-bold ${K["text-ink"]}`}>{title}</DialogTitle>
          <button type="button" aria-label="ปิด" onClick={onClose} className={`flex h-11 w-11 items-center justify-center rounded-[10px] ${K["bg-ground"]} ${K["text-muted"]} ${K["hover:bg-cEEF1EF"]} focus-visible:outline-none focus-visible:ring-2 ${K["focus-visible:ring-primary"]} lg:h-9 lg:w-9`}><X size={16} aria-hidden /></button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}
