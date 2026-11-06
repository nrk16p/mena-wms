"use client"

// ช่องเลือก "กำหนดสรุปยอด" แบบ 24 ชม. — แทน <input type="datetime-local"> ที่ browser/OS บางเครื่องแสดง AM/PM
// กดช่องเดียว → ปฏิทิน (locale th) + เวลา ชั่วโมง 00–23 / นาทีทีละ 5 · ค่าเป็นสตริงเวลาเครื่อง "YYYY-MM-DDTHH:mm"
import { useState } from "react"
import { CalendarDays, ChevronDown } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DUE_MAX_DAYS, parseDue } from "@/lib/store-withdraw/pending"

const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, "0")
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const at = (base: Date, h: number, m: number) => { const d = new Date(base); d.setHours(h, m, 0, 0); return d }
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)
const fmtDue = (d: Date) => `${d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} ${pad(d.getHours())}:${pad(d.getMinutes())} น.`

/** ข้อความผิดของค่าที่กรอก (ใช้ข้อความเดียวกับฝั่งเซิร์ฟเวอร์) · ว่าง = null */
export function dueError(value: string, now = new Date()): string | null {
  if (!value) return null
  const d = new Date(value)
  const r = parseDue(isNaN(d.getTime()) ? "x" : d.toISOString(), now)
  return "error" in r ? r.error : null
}

export function DuePicker({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const cur = value ? new Date(value) : null
  const valid = cur && !isNaN(cur.getTime()) ? cur : null
  const err = dueError(value, now)
  const hh = valid?.getHours() ?? 17
  const mm = valid ? valid.getMinutes() - (valid.getMinutes() % 5) : 0

  const set = (d: Date) => onChange(toLocalInput(d))
  // เลือกวัน: คงเวลาเดิม (ยังไม่เลือก = 17:00)
  const pickDay = (day: Date | undefined) => { if (day) set(at(day, hh, mm)) }
  const setTime = (h: number, m: number) => set(at(valid ?? now, h, m))

  const box = `rounded-md border bg-white text-sm text-gray-900 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:bg-[#0f1117] dark:text-white ${err ? "border-red-400 dark:border-red-500/60" : "border-[#D5DCD8] dark:border-white/10"}`
  const sel = "rounded-md border border-[#D5DCD8] bg-white px-2.5 py-1.5 text-sm tabular-nums text-gray-900 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117] dark:text-white"

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button id={id} type="button" data-testid="due-date" aria-label="เลือกวันและเวลาสรุปยอด"
            className={`${box} flex w-full items-center gap-2 px-3.5 py-2.5 text-left`}>
            <CalendarDays size={16} className="shrink-0 text-gray-500" />
            <span className={`flex-1 truncate ${valid ? "" : "text-gray-400"}`}>{valid ? fmtDue(valid) : "เลือกวันและเวลา"}</span>
            <ChevronDown size={14} className="shrink-0 text-gray-400" />
          </button>
        </PopoverTrigger>
        {/* พื้นขาวทั้งกล่อง (Calendar ตั้งต้นใช้ bg-background สีมิ้นต์ ไม่เต็มความกว้าง → เห็นแถบขาว) · หัวเดือนแสดง พ.ศ. ให้ตรงกับช่อง */}
        <PopoverContent align="start" className="w-auto border-gray-200 bg-white p-0 dark:border-white/10 dark:bg-[#161922]">
          <Calendar mode="single" selected={valid ?? undefined} onSelect={pickDay} defaultMonth={valid ?? now}
            className="mx-auto bg-transparent"
            formatters={{ formatCaption: (d) => d.toLocaleDateString("th-TH", { month: "long", year: "numeric" }) }}
            classNames={{ today: "rounded-md font-semibold text-[#1B8C4B] dark:text-emerald-300" }}
            disabled={[{ before: at(now, 0, 0) }, { after: new Date(now.getTime() + DUE_MAX_DAYS * DAY) }]} />
          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2.5 dark:border-white/10">
            <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
              <span>เวลา</span>
              <select aria-label="ชั่วโมง" data-testid="due-hour" className={sel} value={hh} onChange={(e) => setTime(Number(e.target.value), mm)}>
                {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
              </select>
              <span>:</span>
              <select aria-label="นาที" data-testid="due-minute" className={sel} value={mm} onChange={(e) => setTime(hh, Number(e.target.value))}>
                {MINUTES.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
              </select>
              <span>น.</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} disabled={!valid}
              className="rounded-md bg-[#1B8C4B] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50">ตกลง</button>
          </div>
        </PopoverContent>
      </Popover>
      {err && <p className="mt-1.5 text-xs text-red-600" role="alert">{err}</p>}
    </div>
  )
}
