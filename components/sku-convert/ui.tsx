"use client"

// Small menaIT V.2 building blocks for the /sku/convert pages (scoped look lives in app/sku/convert/v2.css).
import { useState, type ReactNode, type Ref } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CodeOption, RowStatus } from "@/lib/sku-convert-types"

// ------------------------------------------------------------------ formatting

const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
const nf3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 })

export const fmtMoney = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "-" : nf2.format(v))
export const fmtQty = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "-" : nf3.format(v))
export const fmtInt = (v: number | null | undefined) => (v == null ? "-" : nf3.format(Math.round(v)))

const bkk = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "numeric", year: "numeric" })

/** ISO string/Date → d/m/พ.ศ. (Asia/Bangkok). */
export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "-"
  const d = typeof iso === "string" ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return "-"
  const p = Object.fromEntries(bkk.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${Number(p.year) + 543}`
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{fmtMoney(value)}</span>
}
export function Qty({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{fmtQty(value)}</span>
}

// ------------------------------------------------------------------ chips

export type Tone = "blue" | "mint" | "sun" | "ink" | "red"
const TONE: Record<Tone, string> = {
  blue: "text-[#1556c9] bg-[#e8f3ff]",
  mint: "text-[#0b8a5e] bg-[#dcfaf0]",
  sun: "text-[#c2570c] bg-[#fff1e0]",
  ink: "text-[#33476b] bg-[#eaf0f8]",
  red: "text-[#b42318] bg-[#fee8e6]",
}

export function Chip({ tone = "blue", dot, children, className, title }: {
  tone?: Tone; dot?: boolean; children: ReactNode; className?: string; title?: string
}) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONE[tone], className)}>
      {dot && <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function StatusChip({ status, entryCount, lockedBy }: { status: RowStatus; entryCount?: number; lockedBy?: string | null }) {
  if (lockedBy) return <Chip tone="sun" dot>🔒 กำลังทำโดย {lockedBy}</Chip>
  if (status === "done") return <Chip tone="mint" dot>✓ ครบ{entryCount ? ` ${entryCount} รหัส` : ""}</Chip>
  if (status === "draft") return <Chip tone="blue" dot>ร่าง{entryCount ? ` ${entryCount} รหัส` : ""}</Chip>
  return <Chip tone="ink" dot>ยังไม่ทำ</Chip>
}

// ------------------------------------------------------------------ stepper

export type StepState = "done" | "todo" | "warn" | "skip"
export interface StepDef { label: string; state: StepState; hint?: string }

export function Stepper({ steps }: { steps: StepDef[] }) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="ขั้นตอนการทำงาน">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={cn(
            "flex min-w-[8.5rem] flex-1 items-center gap-2 rounded-2xl px-3 py-2 text-xs",
            s.state === "done" && "bg-[#dcfaf0] text-[#0b8a5e]",
            s.state === "warn" && "bg-[#fff1e0] text-[#c2570c]",
            s.state === "todo" && "bg-[#eaf0f8] text-[#33476b]",
            s.state === "skip" && "bg-[#f3f6fa] text-[#5b6f8f]",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white",
              s.state === "done" && "bg-[#16b981]", s.state === "warn" && "bg-[#ff8a3d]",
              s.state === "todo" && "bg-[#6b7f9e]", s.state === "skip" && "bg-[#aebbd0]",
            )}
          >
            {s.state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{s.label}</span>
            {s.hint && <span className="block truncate opacity-80">{s.hint}</span>}
          </span>
          <span className="sr-only">{s.state === "done" ? "เสร็จแล้ว" : s.state === "warn" ? "ต้องแก้ไข" : s.state === "skip" ? "ไม่ใช้" : "ยังไม่เสร็จ"}</span>
        </li>
      ))}
    </ol>
  )
}

// ------------------------------------------------------------------ form pieces

export function Field({ label, htmlFor, required, error, hint, className, children }: {
  label: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; className?: string; children: ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="v2-label">
        {label}{required && <span className="ml-0.5 text-[#e5484d]" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-[#b42318]">{error}</p> : hint ? <p className="mt-1 text-xs text-[#5b6f8f]">{hint}</p> : null}
    </div>
  )
}

/** Native select (keyboard-friendly). value = code, label = `CODE  ชื่อไทย`. A value outside the list stays visible so it can be flagged. */
export function CodeSelect({ id, value, options, onChange, placeholder = "— เลือก —", disabled, invalid, selectRef, showCode = true }: {
  id?: string; value: string; options: CodeOption[]; onChange: (code: string) => void; placeholder?: string
  disabled?: boolean; invalid?: boolean; selectRef?: Ref<HTMLSelectElement>; showCode?: boolean
}) {
  const known = !value || options.some((o) => o.code === value)
  return (
    <select
      id={id} ref={selectRef} value={value} disabled={disabled} aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)} className="v2-input"
    >
      <option value="">{placeholder}</option>
      {!known && <option value={value}>{value} (ไม่อยู่ในรายการ)</option>}
      {options.map((o) => (
        <option key={o.code} value={o.code}>{showCode ? `${o.code}  ${o.th}` : o.th}</option>
      ))}
    </select>
  )
}

function Tag({ children, onRemove, label }: { children: ReactNode; onRemove?: () => void; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#e8f3ff] py-0.5 pl-2.5 pr-1 text-xs font-medium text-[#1556c9]">
      <span className="truncate">{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`ลบ ${label}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-[#cfe4fb]">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

/** Free-text tags. Enter / comma / blur adds. The first `lockedCount` tags cannot be removed. */
export function TagInput({ id, values, onChange, placeholder, lockedCount = 0, disabled }: {
  id?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; lockedCount?: number; disabled?: boolean
}) {
  const [text, setText] = useState("")
  function commit() {
    const t = text.trim()
    setText("")
    if (t && !values.includes(t)) onChange([...values, t])
  }
  return (
    <div className={cn("v2-input flex flex-wrap items-center gap-1.5 !py-1.5", disabled && "!bg-[#f1f6fc]")}>
      {values.map((v, i) => (
        <Tag key={v} label={v} onRemove={disabled || i < lockedCount ? undefined : () => onChange(values.filter((x) => x !== v))}>{v}</Tag>
      ))}
      {!disabled && (
        <input
          id={id} value={text} placeholder={values.length ? "" : placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit() }
            else if (e.key === "Backspace" && !text && values.length > lockedCount) onChange(values.slice(0, -1))
          }}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[#8a9bb5]"
        />
      )}
    </div>
  )
}

/** Pick several codes: chips + a select to add one more (keyboard-usable). */
export function MultiCodeSelect({ id, values, options, onChange, placeholder = "+ เพิ่ม", disabled }: {
  id?: string; values: string[]; options: CodeOption[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean
}) {
  const label = (c: string) => options.find((o) => o.code === c)?.th ?? c
  const rest = options.filter((o) => !values.includes(o.code))
  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Tag key={v} label={label(v)} onRemove={disabled ? undefined : () => onChange(values.filter((x) => x !== v))}>
              <span className="font-mono">{v}</span> {label(v) !== v && label(v)}
            </Tag>
          ))}
        </div>
      )}
      {!disabled && (
        <select
          id={id} value="" className="v2-input" aria-label={placeholder}
          onChange={(e) => { if (e.target.value) onChange([...values, e.target.value]) }}
        >
          <option value="">{placeholder}</option>
          {rest.map((o) => <option key={o.code} value={o.code}>{o.code}  {o.th}</option>)}
        </select>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ misc

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("v2-skel", className)} />
}

/** Section heading used inside glass cards. */
export function SectionTitle({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[#0f2748]">{icon}{children}</h2>
      {right}
    </div>
  )
}
