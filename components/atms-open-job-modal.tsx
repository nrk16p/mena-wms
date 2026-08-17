"use client"

/**
 * เปิด Job บน ATMS จากหน้าอนุมัติยาง
 *
 * ยิงไปที่ FastAPI (ncacdb) → POST /atms/openjob/  (section 1 + items ในครั้งเดียว)
 * payload อ้างอิง routes/atms/openjob.py :: OpenJobRequest
 *
 * ⚠️ ตอนนี้ยัง DRY RUN — กด "เปิด Job" แล้วจะ console.log payload อย่างเดียว
 *    ยังไม่ยิงจริง (ดูจุด TODO ใน handleSubmit)
 */

import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  X, Wrench, Check, AlertTriangle, Code2, Loader2, ChevronLeft, ChevronRight,
  ImageIcon, CalendarClock, ChevronDown, ClipboardList, Flag, ExternalLink,
} from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// ===========================================================================
// Types
// ===========================================================================

/** ยาง 1 เส้นที่ "เลือกได้" ในหน้าเปิด Job — 1 แถว = 1 item ของคำขอ */
export type AtmsJobTire = {
  key: string                 // unique — `${requestId}:${itemId}`
  requestId: string
  itemId: string
  positionCode: string                 // "F1" / "RA3" — ส่งเป็น tire_positions ให้ ATMS ตรง ๆ
  positionName: string
  serialNo: string
  product?: string
  reason: string
  note?: string
  remainingPct?: number | null
  currentTreadMm?: number
  /** เลขไมล์ตอนใส่ยางเส้นนี้ + ระยะใช้งานที่คนแจ้งกรอกมา */
  mileageStart?: number
  usedDistance?: number
  photoUrls?: string[]               // รูปที่คนขับถ่ายตอนแจ้ง
  itemStatus: string                 // pending | approved | rejected
  jobNo?: string
  /** ติดเงื่อนไข (เช่น รถกินยาง ยังไม่ปิด MR) — เลือกไม่ได้ */
  blockedReason?: string | null
}

export type AtmsJobContext = {
  branch: string                    // latkrabang | saraburi
  branchLabel: string
  plate: string
  truckNumber?: string
  driverName?: string
  odometer?: number
  /** สถานะของคำขอ — ใช้ตัดสินว่าตอนนี้อยู่ step ไหนของ timeline */
  requestStatus?: string               // pending | approved | appointment | done
  appointmentDate?: string | null
  requestedAt?: string | null
}

/** MR (ใบซ่อมรถกินยาง) ของทะเบียนนี้ — ต้องปิดก่อนถึงจะเปลี่ยนยางได้ */
export type AtmsJobMr = { status: string } | null

type OptionMap = Record<string, Record<string, string>>

// ===========================================================================
// Constants + helpers
// ===========================================================================

// ใช้เมื่อโหลด options จาก ATMS ไม่ได้ (session หมดอายุ / API ล่ม)
const FALLBACK_BRANCHES: Record<string, string> = {
  "2": "ลาดกระบัง", "3": "สระบุรี", "4": "กรุงเทพฯ", "5": "ขอนแก่น", "7": "DIST",
}
const DEFAULT_BRANCH_ID: Record<string, string> = { latkrabang: "2", saraburi: "3" }

// ประเภทการซ่อม (maintenance_type_id) — ชุดเดียวกับ ATMS ใช้เมื่อโหลด options ไม่ได้
const FALLBACK_MAINTENANCE_TYPES: Record<string, string> = {
  "1": "ระบบหัวเก๋ง",
  "2": "ระบบเครื่องยนต์",
  "3": "ระบบช่วงล่าง",
  "4": "ระบบเบรค ครัทช์",
  "5": "ระบบแอร์ ไฟ",
  "6": "หาง",
  "7": "อุปกรณ์เสริม",
  "8": "วัสดุสิ้นเปลือง",
  "9": "ยาง",
  "10": "ระบบบำรุงรักษา",
  "11": "เครื่องมือช่าง",
  "12": "ปะผุ ทำสี",
  "13": "ระบบโม่",
  "14": "แยคโม่",
  "15": "ปะยาง",
  "16": "ทำความสะอาด",
  "17": "ระบบหม้อน้ำและท่อไอเสีย",
  "18": "ระบบเกียร์",
  "19": "น้ำมันเชื้อเพลิง",
  "20": "เคสอุบัติเหตุ",
  "21": "ต่อภาษี",
  "22": "ปั้มลม - อุปกรณ์เกี่ยวกับปั้มลม",
  "23": "ตรวจสภาพถังก๊าซ NGV ( ประจำปี )",
  "24": "ผ้าใบหลอด / ผ้าใบตูดถัง",
  "25": "ระบบเชื้อเพลิง",
  "26": "ระบบอุปกรณ์ลงอาหารสัตว์",
  "27": "อื่นๆ",
  "28": "PMศูนย์บริการ",
  "29": "PMช่างมีนา",
  "30": "ระบบลม",
  "31": "ตัวถังบอดี้",
}

/** ค่าเริ่มต้นของประเภทการซ่อม — งานจากหน้านี้คือ "ยาง" เสมอ */
const TIRE_TYPE_ID = "9"

const MR_LABEL: Record<string, string> = {
  pending: "รอดำเนินการ", in_progress: "กำลังซ่อม", completed: "ซ่อมเสร็จแล้ว",
}

const STATUS_LABEL: Record<string, string> = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ",
  appointment: "นัดหมายแล้ว", done: "เสร็จสิ้น",
}

const statusChipCls = (s: string) =>
  s === "approved" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
    : s === "rejected" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      : s === "done" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"

const fontThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const fontHead = { fontFamily: "'Mitr', sans-serif", fontWeight: 500 }

const inp = "rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30 placeholder-[#9AA8A0]"
const btnPrimary = "rounded-[11px] bg-[#1B8C4B] text-white px-3.5 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
const btnGhost = "rounded-[11px] border border-gray-200 dark:border-white/10 px-3.5 py-2 text-[13px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
const fieldLabel = "mb-1 block text-[11px] font-medium text-gray-500 dark:text-gray-400"

const pad = (n: number) => String(n).padStart(2, "0")

/** Date → "03/08/2026 16:51" (รูปแบบที่ ATMS ต้องการ) */
function toAtmsDateTime(d?: Date) {
  if (!d || isNaN(d.getTime())) return ""
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Date → "3 ส.ค. 2569 · 16:51 น." สำหรับโชว์บนปุ่ม */
function fmtScheduleLabel(d?: Date) {
  if (!d || isNaN(d.getTime())) return "เลือกวันเวลานัดหมาย"
  const day = d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })
  return `${day} · ${pad(d.getHours())}:${pad(d.getMinutes())} น.`
}

/** ตัดเวลาออก — วันนัดเก็บเป็นต้นวันเสมอ */
function startOfDay(d: Date) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** ปัดเวลาขึ้นเป็นช่วง 5 นาทีถัดไป — ให้ตรงกับตัวเลือกในคอลัมน์นาที */
function roundTo5(d: Date) {
  const out = new Date(d)
  out.setSeconds(0, 0)
  out.setMinutes(Math.ceil(out.getMinutes() / 5) * 5)
  return out
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

/** ด้านกว้าง (px) ของพรีวิวรูปตอน hover */
const HOVER_PREVIEW_SIZE = 280

const fmtNum = (n?: number | null) => (n ?? 0).toLocaleString("th-TH")

/** "03/08/2026 16:51" (รูปแบบ ATMS) → Date */
function parseAtmsDateTime(v: string): Date | null {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), 0, 0)
  return isNaN(d.getTime()) ? null : d
}

/** ISO → "3 ส.ค. 2569" (ใช้บน timeline) */
function fmtDayLabel(s?: string | null) {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })
}

const remainingCls = (pct?: number | null) =>
  pct === null || pct === undefined ? "bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-gray-400"
    : pct <= 15 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      : pct <= 35 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"

/** คอลัมน์ชั่วโมง/นาทีข้างปฏิทิน — เลื่อนค่าที่เลือกมากลางคอลัมน์ตอนเปิด */
function TimeColumn({ values, active, open, onPick }: {
  values: number[]
  active: number
  open: boolean
  onPick: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const box = ref.current
    const el = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (box && el) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
  }, [open, active])

  return (
    <div ref={ref} className="max-h-62 w-14 overflow-y-auto scroll-smooth p-1.5">
      <div className="flex flex-col gap-1">
        {values.map((v) => {
          const on = v === active
          return (
            <button
              key={v}
              type="button"
              data-active={on}
              onClick={() => onPick(v)}
              className={[
                "shrink-0 rounded-md py-1.5 text-center font-mono text-[12px] transition-colors",
                on ? "bg-[#1B8C4B] text-white" : "text-[#14271C] hover:bg-[#F0FDF4] dark:text-white dark:hover:bg-white/8",
              ].join(" ")}
            >
              {pad(v)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ===========================================================================
// ผังล้อ — เลือกยางจากรูปโครงสร้างรถแทนการไล่อ่านรายการ
// ===========================================================================

const AXLE_ROWS: { label: string; left: string[]; right: string[] }[] = [
  { label: "หน้า 1", left: ["F1"], right: ["F2"] },
  { label: "หน้า 2", left: ["F3"], right: ["F4"] },
  { label: "หลัง 1", left: ["RA1", "RA2"], right: ["RA3", "RA4"] },
  { label: "หลัง 2", left: ["RA5", "RA6"], right: ["RA7", "RA8"] },
  { label: "หาง 1", left: ["RB1", "RB2"], right: ["RB3", "RB4"] },
  { label: "หาง 2", left: ["RB5", "RB6"], right: ["RB7", "RB8"] },
  { label: "หาง 3", left: ["RB9", "RB10"], right: ["RB11", "RB12"] },
]
const SPARE_POSITIONS = ["RB13"]

/** ลำดับล้อจากหน้าสุดไปท้ายสุด — ใช้เรียงการ์ดรายละเอียดใต้ผัง */
const POSITION_ORDER = [
  ...AXLE_ROWS.flatMap((r) => [...r.left, ...r.right]),
  ...SPARE_POSITIONS,
]

/** อนุมัติ + เปิด Job ไปแล้ว → ล็อกไว้ เลือกเปิดซ้ำไม่ได้ */
const isTireLocked = (t: AtmsJobTire) => t.itemStatus === "approved" || Boolean(t.jobNo)

/** กลุ่มย่อยของการ์ด — แบ่งตามสถานะของยางแต่ละเส้น */
const CARD_SECTIONS: { key: string; label: string; match: (t: AtmsJobTire) => boolean }[] = [
  { key: "pending",  label: "รออนุมัติ",     match: (t) => !isTireLocked(t) && t.itemStatus !== "rejected" },
  { key: "approved", label: "เปิด Job แล้ว", match: (t) => isTireLocked(t) },
  { key: "rejected", label: "ปฏิเสธ",        match: (t) => t.itemStatus === "rejected" && !isTireLocked(t) },
]

/** สีเงาบนล้อ: เลือกแล้ว → เขียว / ติด MR → เหลือง / ปฏิเสธ → เทา / อนุมัติแล้ว → ฟ้า */
function wheelTone(t: AtmsJobTire, on: boolean) {
  if (t.itemStatus === "rejected") return "from-gray-500/80"
  if (t.blockedReason) return "from-amber-500/90"
  if (on) return "from-[#1B8C4B]"
  if (t.itemStatus === "approved") return "from-blue-500/90"
  return "from-gray-900/70"
}

function WheelSlot({ tire, pos, on, focus, onPick }: {
  tire?: AtmsJobTire
  pos: string
  on: boolean
  focus: boolean
  onPick: (t: AtmsJobTire) => void
}) {
  // ตำแหน่งที่ไม่ได้อยู่ในคำขอ — วาดเป็นโครงจาง ๆ ให้เห็นรูปทรงเพลา
  if (!tire) {
    return <span className="h-[62px] w-9 rounded-lg border border-dashed border-[#EEF2F0] dark:border-white/8" />
  }
  const lockedTire = isTireLocked(tire)
  const noPick = Boolean(tire.blockedReason) || lockedTire
  return (
    <button
      type="button"
      onClick={() => onPick(tire)}
      disabled={noPick}
      title={`${pos} ${tire.positionName}${
        tire.blockedReason ? ` — ${tire.blockedReason}` : lockedTire ? " — เปิด Job ไปแล้ว" : ""
      }`}
      className={[
        "relative flex h-[62px] w-9 flex-col items-center justify-center overflow-hidden rounded-lg text-white shadow transition-transform duration-100",
        noPick ? "cursor-not-allowed opacity-80" : "active:scale-90",
        on ? "ring-2 ring-[#1B8C4B] ring-offset-2 dark:ring-offset-[#151a10]"
          : focus ? "ring-2 ring-gray-400 ring-offset-2 dark:ring-offset-[#151a10]" : "",
      ].join(" ")}
      style={{ backgroundImage: "url(/images/tire-wheel.png)", backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <span className={`absolute inset-0 bg-gradient-to-b to-transparent ${wheelTone(tire, on)}`} />
      <span className="relative text-[11px] font-black leading-none drop-shadow-md">{pos}</span>
      {tire.remainingPct !== null && tire.remainingPct !== undefined && (
        <span className="relative mt-0.5 text-[9px] font-bold leading-none drop-shadow-md">{tire.remainingPct}%</span>
      )}
      {on && (
        <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#1B8C4B] text-white">
          <Check size={9} strokeWidth={4} />
        </span>
      )}
    </button>
  )
}

function TireSchematic({ tires, selected, focusKey, onPick }: {
  tires: AtmsJobTire[]
  selected: Set<string>
  focusKey: string | null
  onPick: (t: AtmsJobTire) => void
}) {
  const map: Record<string, AtmsJobTire> = {}
  for (const t of tires) map[t.positionCode.toUpperCase()] = t

  const rows = AXLE_ROWS.filter((r) => [...r.left, ...r.right].some((p) => map[p]))
  const spares = SPARE_POSITIONS.filter((p) => map[p])
  // ตำแหน่งแปลก ๆ ที่ไม่มีในผังมาตรฐาน — บอกจำนวนไว้กันคนเข้าใจผิดว่าครบแล้ว
  const known = new Set([...AXLE_ROWS.flatMap((r) => [...r.left, ...r.right]), ...SPARE_POSITIONS])
  const off = tires.filter((t) => !known.has(t.positionCode.toUpperCase()))

  if (rows.length === 0 && spares.length === 0) {
    return <p className="py-10 text-center text-[12px] text-gray-400" style={fontThai}>ตำแหน่งยางไม่ตรงกับผังมาตรฐาน — ดูที่แท็บรายการ</p>
  }

  return (
    <div className="mx-auto flex w-full max-w-[280px] flex-col items-center">
      <div className="mb-1 flex h-7 w-16 items-center justify-center rounded-t-2xl border border-[#EEF2F0] bg-gray-50 dark:border-white/10 dark:bg-white/5">
        <span className="text-[9px] text-gray-400" style={fontThai}>หัวรถ</span>
      </div>

      <div className="flex w-full flex-col items-center gap-3 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex w-full items-center">
            <div className="flex gap-1">
              {row.left.map((p) => (
                <WheelSlot key={p} pos={p} tire={map[p]} on={!!map[p] && selected.has(map[p].key)}
                  focus={!!map[p] && map[p].key === focusKey} onPick={onPick} />
              ))}
            </div>
            <div className="mx-1.5 flex flex-1 items-center">
              <span className="h-1 flex-1 rounded-full bg-gray-200 dark:bg-white/10" />
              <span className="px-1 text-[9px] text-gray-400" style={fontThai}>{row.label}</span>
              <span className="h-1 flex-1 rounded-full bg-gray-200 dark:bg-white/10" />
            </div>
            <div className="flex gap-1">
              {row.right.map((p) => (
                <WheelSlot key={p} pos={p} tire={map[p]} on={!!map[p] && selected.has(map[p].key)}
                  focus={!!map[p] && map[p].key === focusKey} onPick={onPick} />
              ))}
            </div>
          </div>
        ))}

        {spares.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-gray-400" style={fontThai}>อะไหล่</span>
            {spares.map((p) => (
              <WheelSlot key={p} pos={p} tire={map[p]} on={selected.has(map[p].key)}
                focus={map[p].key === focusKey} onPick={onPick} />
            ))}
          </div>
        )}
      </div>

      {off.length > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400" style={fontThai}>
          อีก {off.length} เส้นไม่อยู่ในผัง — ดูที่แท็บรายการ
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-2 text-[10px] text-gray-400" style={fontThai}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#1B8C4B]" /> เลือก</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> เปิด Job แล้ว</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> ติด MR</span>
      </div>
    </div>
  )
}

// ===========================================================================
// Timeline — 4 step ของงานเปลี่ยนยาง 1 คัน
// ===========================================================================

const STEPS = [
  { n: 1, label: "รับคำขอ", Icon: ClipboardList },
  { n: 2, label: "เปิด Job ATMS", Icon: Wrench },
  { n: 3, label: "นัดหมาย", Icon: CalendarClock },
  { n: 4, label: "เปลี่ยนเสร็จ", Icon: Flag },
] as const

/** สถานะคำขอ → step ปัจจุบัน (1-4); ไม่รู้สถานะก็เดาจากว่ามีเลขเคสแล้วหรือยัง */
function stepOf(requestStatus: string | undefined, hasJob: boolean) {
  switch (requestStatus) {
    case "done": return 4
    case "appointment": return 3
    case "approved": return 2
    case "pending": return 1
    default: return hasJob ? 2 : 1
  }
}

function JobTimeline({ step, notes }: { step: number; notes: Record<number, string> }) {
  return (
    <div className="flex items-start gap-1 border-b border-[#EEF2F0] px-5 py-3 dark:border-white/8" style={fontThai}>
      {STEPS.map(({ n, label, Icon }, i) => {
        const done = n < step
        const current = n === step
        return (
          <React.Fragment key={n}>
            {i > 0 && (
              <span className={`mt-4 h-px flex-1 ${n <= step ? "bg-[#1B8C4B]" : "bg-[#EEF2F0] dark:bg-white/10"}`} />
            )}
            <div className="flex w-[86px] shrink-0 flex-col items-center gap-1 text-center">
              <span className={[
                "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                done ? "border-[#1B8C4B] bg-[#1B8C4B] text-white"
                  : current ? "border-[#1B8C4B] bg-[#1B8C4B]/10 text-[#1B8C4B]"
                    : "border-[#EEF2F0] bg-white text-gray-300 dark:border-white/10 dark:bg-[#151a10] dark:text-gray-600",
              ].join(" ")}>
                {done ? <Check size={14} strokeWidth={3} /> : <Icon size={14} />}
              </span>
              <span className={[
                "text-[11px] leading-tight",
                current ? "font-semibold text-[#14271C] dark:text-white" : done ? "text-[#1B8C4B]" : "text-gray-400",
              ].join(" ")}>
                {label}
              </span>
              <span className="text-[10px] leading-tight text-gray-400">{notes[n] || "—"}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ===========================================================================
// Component
// ===========================================================================

export function AtmsOpenJobModal({
  ctx, tires, preselect, mr, onClose, onSubmitted,
  onRejectTire, onEditJob, onAppointment, onDone, onCreateMr, onMrStatus,
}: {
  ctx: AtmsJobContext
  tires: AtmsJobTire[]
  preselect?: string[]
  /** MR ของทะเบียนนี้ (undefined = ยังไม่ได้เช็ค, null = ยังไม่มี MR) */
  mr?: AtmsJobMr | undefined
  onClose: () => void
  /** เรียกหลังเปิด Job สำเร็จ (ตอน dry run ยังไม่ถูกเรียก) */
  onSubmitted?: (jobNo: string, tireKeys: string[]) => void
  // ── งานตาม step — ให้หน้าเรียกใช้ handler เดิมของตัวเอง ─────────────
  onRejectTire?: (tire: AtmsJobTire) => void
  onEditJob?: (tire: AtmsJobTire) => void
  /** บันทึกวันนัดเปลี่ยนยาง (ISO ต้นวัน) */
  onAppointment?: (dateIso: string) => void
  onDone?: () => void
  onCreateMr?: () => void
  onMrStatus?: (next: "in_progress" | "completed") => void
}) {
  /** ใบแจ้งซ่อมที่เปิดค้างอยู่ของรถคันนี้ — มีแล้วจะไม่เปิดใบใหม่ แต่เพิ่มรายการเข้าใบเดิม */
  const existingJob = tires.find((t) => t.jobNo)?.jobNo ?? ""
  const viewTires = tires

  // เลือกได้เฉพาะเส้นที่ยังไม่ถูกปฏิเสธ ไม่ติด MR และยังไม่เคยเปิด Job
  const selectable = useMemo(
    () => viewTires.filter((t) => !t.blockedReason && t.itemStatus !== "rejected" && !isTireLocked(t)),
    [viewTires],
  )

  const [selected, setSelected] = useState<Set<string>>(() => {
    const ok = new Set(tires.filter((t) => !t.blockedReason && t.itemStatus !== "rejected" && !isTireLocked(t)).map((t) => t.key))
    const init = (preselect ?? []).filter((k) => ok.has(k))
    return new Set(init.length ? init : [])
  })

  const [scheduleAt, setScheduleAt] = useState<Date>(() => roundTo5(new Date()))
  const [dateOpen, setDateOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const [month, setMonth] = useState<Date>(() => new Date())
  // วันนัดเปลี่ยนยาง (field ที่โผล่หลังเปิด Job แล้ว)
  const [apptDate, setApptDate] = useState<Date | undefined>(
    () => (ctx.appointmentDate ? new Date(ctx.appointmentDate) : undefined),
  )
  const [apptOpen, setApptOpen] = useState(false)
  const [apptMonth, setApptMonth] = useState<Date>(
    () => (ctx.appointmentDate ? new Date(ctx.appointmentDate) : new Date()),
  )
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH_ID[ctx.branch] ?? "")
  const [driver, setDriver] = useState(ctx.driverName ?? "")
  const [mechanic, setMechanic] = useState("")
  const [informMile, setInformMile] = useState(ctx.odometer ? String(ctx.odometer) : "")
  const [isBroken, setIsBroken] = useState(false)
  // 9 = ยาง — งานจากหน้านี้เป็นการเปลี่ยนยางเสมอ
  const [typeId, setTypeId] = useState(TIRE_TYPE_ID)
  // null = ยังไม่ได้พิมพ์เอง → ใช้ข้อความที่ประกอบจากยางที่เลือก
  const [problemDraft, setProblemDraft] = useState<string | null>(null)

  const [options, setOptions] = useState<OptionMap | null>(null)
  const [optErr, setOptErr] = useState<"session" | "failed" | null>(null)
  // ข้อมูล job ที่ดึงกลับมาจาก ATMS (เมื่อมีเลขเคสแล้ว) — มีเลขเคสตั้งแต่เปิดโมดัล = กำลังโหลดเลย
  const [jobLoading, setJobLoading] = useState(() => Boolean(existingJob))
  const [jobErr, setJobErr] = useState(false)
  const [jobInfo, setJobInfo] = useState<Record<string, string> | null>(null)
  const [optLoading, setOptLoading] = useState(true)
  const [showPayload, setShowPayload] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number; tire: AtmsJobTire } | null>(null)
  // พรีวิวรูปตอนเอาเมาส์ชี้ (fixed — วางตามตำแหน่งของ thumbnail)
  const [hoverImg, setHoverImg] = useState<{ url: string; top: number; left: number } | null>(null)
  // เลขเคสที่กำลังแปลง code → id อยู่
  const [openingCase, setOpeningCase] = useState<string | null>(null)

  // ดูรูปแบบเต็ม — Esc ปิด, ลูกศรซ้าย/ขวา เลื่อนรูป
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setLightbox(null) }
      if (e.key === "ArrowRight") setLightbox((s) => (s ? { ...s, index: (s.index + 1) % s.urls.length } : s))
      if (e.key === "ArrowLeft") setLightbox((s) => (s ? { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length } : s))
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [lightbox])

  // กดล้อไหน เลื่อนการ์ดของเส้นนั้นมาให้เห็น
  useEffect(() => {
    if (!focusKey) return
    const el = cardsRef.current?.querySelector<HTMLElement>(`[data-tire-key="${CSS.escape(focusKey)}"]`)
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusKey])

  // เลื่อนรายการเมื่อไหร่ พรีวิวที่ค้างอยู่จะหลุดตำแหน่ง — ซ่อนทิ้งไปเลย
  useEffect(() => {
    if (!hoverImg) return
    const hide = () => setHoverImg(null)
    window.addEventListener("scroll", hide, true)
    return () => window.removeEventListener("scroll", hide, true)
  }, [hoverImg])

  // ค่า dropdown จริงจาก ATMS — ล้มเหลวก็ยังกรอกต่อได้ (fallback ด้านล่าง)
  useEffect(() => {
    let alive = true
    fetch("/api/atms/openjob/options")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.ok) { setOptions(d as OptionMap) }
        else { setOptErr(d?.error === "atms_session_expired" ? "session" : "failed") }
        setOptLoading(false)
      })
      .catch(() => { if (alive) { setOptErr("failed"); setOptLoading(false) } })
    return () => { alive = false }
  }, [])

  // มีใบแจ้งซ่อมอยู่แล้ว → ดึงข้อมูล job นั้นจาก ATMS มาเติมในฟอร์ม (GET /atms/openjob/{ref})
  useEffect(() => {
    const ref = existingJob
    if (!ref) return
    let alive = true
    fetch(`/api/atms/openjob/${encodeURIComponent(ref)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setJobErr(true); setJobLoading(false); return }

        const f = (d?.fields ?? {}) as Record<string, string>
        const pick = (k: string) => String(f[k] ?? "").trim()

        const at = parseAtmsDateTime(pick("schedule_at"))
        if (at) { setScheduleAt(at); setMonth(at) }
        if (pick("branch_id")) setBranchId(pick("branch_id"))
        if (pick("driver")) setDriver(pick("driver"))
        if (pick("mechanic")) setMechanic(pick("mechanic"))
        if (pick("inform_mile_no")) setInformMile(pick("inform_mile_no").replace(/[^\d]/g, ""))
        if (pick("is_broken")) setIsBroken(pick("is_broken") === "1")
        if (pick("maintenance_type_id")) setTypeId(pick("maintenance_type_id"))

        // อาการมาจากตารางรายการซ่อมของ job (คอลัมน์ภาษาไทย ชื่อไม่คงที่ → หาแบบ contains)
        const first = (Array.isArray(d?.items) ? d.items[0] : null) as Record<string, string> | null
        const problemCol = first && Object.keys(first).find((k) => k.includes("อาการ") || k.includes("รายละเอียด"))
        if (first && problemCol && String(first[problemCol]).trim()) setProblemDraft(String(first[problemCol]).trim())

        setJobInfo((d?.info ?? {}) as Record<string, string>)
        setJobLoading(false)
      })
      .catch(() => { if (alive) { setJobErr(true); setJobLoading(false) } })
    return () => { alive = false }
  }, [existingJob])

  const branchOptions = options?.branch_id ?? FALLBACK_BRANCHES
  const atmsTypes = options?.maintenance_type_id
  const typeOptions = atmsTypes && Object.keys(atmsTypes).length ? atmsTypes : FALLBACK_MAINTENANCE_TYPES

  const chosen = useMemo(() => tires.filter((t) => selected.has(t.key)), [tires, selected])

  // การ์ดใต้ผังล้อ — เรียงตามลำดับล้อ (หน้า → หลัง → หาง → อะไหล่) ตำแหน่งนอกผังไว้ท้ายสุด
  const orderedTires = useMemo(() => {
    const rank = (code: string) => {
      const i = POSITION_ORDER.indexOf(code.toUpperCase())
      return i === -1 ? POSITION_ORDER.length : i
    }
    return [...viewTires].sort((a, b) => rank(a.positionCode) - rank(b.positionCode))
  }, [viewTires])
  const photoCount = useMemo(() => viewTires.reduce((n, t) => n + (t.photoUrls?.length ?? 0), 0), [viewTires])

  // ── step ของ "งานที่กำลังเปิดดู" — แท็บยังไม่เปิด Job = step 1 เสมอ ────
  const jobNos = useMemo(
    () => Array.from(new Set(tires.map((t) => t.jobNo).filter(Boolean))) as string[],
    [tires],
  )
  const step = stepOf(ctx.requestStatus, Boolean(existingJob))
  // มีใบแจ้งซ่อมแล้ว = ฟอร์มเป็นข้อมูลของใบนั้นจาก ATMS อ่านอย่างเดียว (แก้ที่ ATMS)
  const locked = Boolean(existingJob)
  const fieldCls = locked
    ? inp + " bg-gray-100 text-blue-700 dark:bg-white/10 dark:text-blue-300 disabled:opacity-100"
    : inp
  const timelineNotes: Record<number, string> = {
    1: `${viewTires.length} เส้น`,
    2: jobNos.length ? jobNos.join(", ") : "ยังไม่เปิด",
    3: ctx.appointmentDate ? fmtDayLabel(ctx.appointmentDate) : "ยังไม่นัด",
    4: step === 4 ? "ปิดงานแล้ว" : "รอปิดงาน",
  }

  /** เปิดใบแจ้งซ่อมบน ATMS — เลขที่เก็บไว้เป็นเลขเคส ต้องแปลงเป็น id ก่อน */
  async function openAtmsCase(e: React.MouseEvent, code: string) {
    e.preventDefault()
    e.stopPropagation()
    const tabRef = window.open("", "_blank")
    setOpeningCase(code)
    try {
      const res = await fetch(`/api/atms/maintenance-request/by-code/${encodeURIComponent(code)}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.view_url) { tabRef?.close(); return }
      if (tabRef) tabRef.location.href = d.view_url
      else window.open(d.view_url, "_blank", "noreferrer")
    } catch {
      tabRef?.close()
    } finally {
      setOpeningCase(null)
    }
  }

  // อาการเริ่มต้น — ประกอบจากตำแหน่ง + สาเหตุที่เลือก จนกว่าผู้ใช้จะพิมพ์ทับ
  const autoProblem = useMemo(() => {
    if (!chosen.length) return ""
    const codes = chosen.map((t) => t.positionCode).filter(Boolean)
    const reasons = Array.from(new Set(chosen.map((t) => t.reason).filter(Boolean)))
    return `ขอเปลี่ยนยาง ${codes.join(", ")}${reasons.length ? ` — ${reasons.join(" / ")}` : ""}`
  }, [chosen])
  const problemTouched = problemDraft !== null
  const problem = problemDraft ?? autoProblem

  /** เลือกวันจากปฏิทิน — คงเวลาเดิมไว้ */
  function pickDate(d?: Date) {
    if (!d) return
    setScheduleAt((prev) => {
      const next = new Date(d)
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0)
      return next
    })
  }

  /** เลือกชั่วโมง/นาที — คงวันเดิมไว้ */
  function pickTime(h: number, m: number) {
    setScheduleAt((prev) => {
      const next = new Date(prev)
      next.setHours(h, m, 0, 0)
      return next
    })
  }

  /** วางพรีวิวไว้ข้าง thumbnail — ล้นขอบขวาก็สลับไปอยู่ทางซ้าย */
  function showHoverImg(e: { currentTarget: HTMLElement }, url: string) {
    const r = e.currentTarget.getBoundingClientRect()
    const size = HOVER_PREVIEW_SIZE
    const gap = 10
    const edge = 12
    const left = r.right + gap + size > window.innerWidth - edge ? r.left - gap - size : r.right + gap
    const top = Math.max(edge, Math.min(r.top + r.height / 2 - size / 2, window.innerHeight - size - edge))
    setHoverImg({ url, top, left })
  }

  function toggle(t: AtmsJobTire) {
    if (t.blockedReason || isTireLocked(t)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(t.key)) next.delete(t.key)
      else next.add(t.key)
      return next
    })
  }

  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.key))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.key)))

  /**
   * มีใบแจ้งซ่อมอยู่แล้ว → payload เป็น AddItemsRequest (เพิ่มรายการเข้าใบเดิม)
   * ยังไม่มี → OpenJobRequest (เปิดใบใหม่)
   */
  const payload = useMemo(() => {
    const item = {
      maintenance_type_id: typeId,
      problem: problem.trim(),
      has_refer: "0",
      images: [] as string[],
    }
    if (existingJob) {
      return {
        // ต้องแปลงเลขเคส → maintenance_request_id ก่อนยิงจริง (ดู /api/atms/maintenance-request/by-code)
        maintenance_request_code: existingJob,
        tire_positions: chosen.map((t) => t.positionCode).filter(Boolean),
        items: [item],
      }
    }
    return {
      flow: "request tire",
      schedule_at: toAtmsDateTime(scheduleAt),
      branch_id: branchId,
      vehicle: ctx.plate,
      driver: driver.trim(),
      mechanic: mechanic.trim(),
      inform_mile_no: informMile.replace(/[^\d]/g, ""),
      is_broken: isBroken ? "1" : "0",
      tire_positions: chosen.map((t) => t.positionCode).filter(Boolean),
      items: [item],
    }
  }, [existingJob, scheduleAt, branchId, ctx.plate, driver, mechanic, informMile, isBroken, chosen, typeId, problem])

  const missing: string[] = []
  if (!chosen.length) missing.push("เลือกยางอย่างน้อย 1 เส้น")
  if (!typeId) missing.push("ประเภทการซ่อม")
  if (!existingJob) {
    if (!toAtmsDateTime(scheduleAt)) missing.push("วันเวลานัดหมาย")
    if (!branchId) missing.push("สาขา")
  }
  const canSubmit = missing.length === 0 && !submitting && step !== 4

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)

    // ── DRY RUN ────────────────────────────────────────────────────────────
    // ยังไม่ยิงจริงตามที่ตกลงไว้ — ดู payload ที่ console แล้วค่อยเปิดใช้ของจริง
    console.group(
      `%c[ATMS] ${existingJob ? `เพิ่มรายการเข้า Job ${existingJob}` : "เปิด Job"} — DRY RUN (ยังไม่ส่งจริง)`,
      "color:#1B8C4B;font-weight:700",
    )
    console.log("endpoint :", existingJob ? "POST /atms/openjob/item" : "POST /atms/openjob/")
    console.log("context  :", { branch: ctx.branch, plate: ctx.plate, truckNumber: ctx.truckNumber })
    console.log("payload  :", payload)
    console.log("payload (json)\n" + JSON.stringify(payload, null, 2))
    console.table(chosen.map((t) => ({
      ตำแหน่ง: t.positionCode, ชื่อ: t.positionName, serial: t.serialNo,
      สาเหตุ: t.reason, คงเหลือ: t.remainingPct ?? "—",
      requestId: t.requestId, itemId: t.itemId,
    })))
    console.log("หลังได้ maintenance_request_id → PATCH approve พร้อม jobNo ให้ item เหล่านี้:",
      chosen.map((t) => ({ requestId: t.requestId, itemId: t.itemId, positionCode: t.positionCode })))
    console.log("onSubmitted พร้อมรับเลข job:", typeof onSubmitted === "function")
    console.groupEnd()

    // TODO(ของจริง): แทนบล็อกด้านบนด้วย
    //   const res  = await fetch("/api/atms/openjob", { method: "POST", body: JSON.stringify(payload) })
    //   const job  = await res.json()                       // { job: { maintenance_request_id }, items: [...] }
    //   onSubmitted?.(String(job.job.maintenance_request_id), chosen.map((t) => t.key))
    // ──────────────────────────────────────────────────────────────────────

    setSubmitting(false)
    setShowPayload(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !submitting && onClose()}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#151a10]"
      >
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-[#EEF2F0] px-5 py-4 dark:border-white/8">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#1B8C4B]/10 text-[#1B8C4B]">
              <Wrench size={16} />
            </div>
            <div>
              <h3 className="text-[16px] text-[#14271C] dark:text-white" style={fontHead}>
                {step === 1 ? "เปิด Job แจ้งซ่อมบน ATMS" : "จัดการงานเปลี่ยนยาง"}
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500 dark:text-gray-400" style={fontThai}>
                <span className="font-mono text-[13px] font-semibold text-[#14271C] dark:text-white">{ctx.plate}</span>
                <span className="rounded-md bg-gray-100 px-1.5 py-px text-[10px] font-semibold dark:bg-white/10">{ctx.branchLabel}</span>
                {ctx.truckNumber ? <span>เบอร์รถ {ctx.truckNumber}</span> : null}
                {ctx.driverName ? <span>· {ctx.driverName}</span> : null}
                {ctx.odometer ? <span>· ไมล์ {fmtNum(ctx.odometer)}</span> : null}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* ── timeline: งานนี้เดินไปถึงไหนแล้ว ───────────────────────── */}
        <JobTimeline step={step} notes={timelineNotes} />

        {/* ── body ───────────────────────────────────────────────────── */}
        <div className="grid flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[380px_1fr]">
          {/* left: รายการยาง (step 1 เลือกได้ / step อื่นอ่านอย่างเดียว) */}
          <div className="border-b border-[#EEF2F0] p-4 dark:border-white/8 lg:border-b-0 lg:border-r">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#14271C] dark:text-white" style={fontThai}>
                {existingJob ? "ยางของรถคันนี้" : "เลือกยางที่จะเปิด Job"}
              </span>
            </div>

            {/* MR ของรถกินยาง — ต้องปิดก่อนถึงจะเปลี่ยนยางได้ */}
            {viewTires.some((t) => t.reason === "รถกินยาง") && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[11px] border border-amber-200 bg-amber-50/70 px-2.5 py-2 dark:border-amber-900/40 dark:bg-amber-950/20" style={fontThai}>
                <span className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                  รถกินยาง — MR: {mr === undefined ? "กำลังตรวจ..." : mr === null ? "ยังไม่มี" : MR_LABEL[mr.status] ?? mr.status}
                </span>
                {mr === null && onCreateMr && (
                  <button type="button" onClick={onCreateMr} className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:opacity-90">
                    + สร้าง MR
                  </button>
                )}
                {mr?.status === "pending" && onMrStatus && (
                  <button type="button" onClick={() => onMrStatus("in_progress")} className="rounded bg-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:opacity-90">
                    เริ่มซ่อม
                  </button>
                )}
                {mr?.status === "in_progress" && onMrStatus && (
                  <button type="button" onClick={() => onMrStatus("completed")} className="rounded bg-green-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:opacity-90">
                    ซ่อมเสร็จ ✓
                  </button>
                )}
              </div>
            )}

            <p className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-400" style={fontThai}>
              {existingJob
                ? `เส้นที่ติ๊กจะถูกเพิ่มเข้า Job ${existingJob} (ไม่เปิดใบใหม่)`
                : "เลือกเฉพาะเส้นที่ต้องเปลี่ยนจริง"}
              {photoCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-px text-[10px] text-gray-500 dark:bg-white/10 dark:text-gray-400">
                  <ImageIcon size={10} /> {photoCount} รูป
                </span>
              )}
              {selectable.length > 0 && (
                <button type="button" onClick={toggleAll} className="ml-auto text-[11px] text-[#1B8C4B] underline decoration-dotted hover:opacity-80">
                  {allSelected ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
                </button>
              )}
            </p>

            {viewTires.length === 0 ? (
              <p className="rounded-[12px] bg-gray-50 px-3 py-6 text-center text-[12px] text-gray-400 dark:bg-white/4" style={fontThai}>
                ไม่มีรายการยางให้เลือก
              </p>
            ) : (
              <>
                <TireSchematic
                  tires={viewTires}
                  selected={selected}
                  focusKey={focusKey}
                  onPick={(t) => { setFocusKey(t.key); toggle(t) }}
                />

                {/* รายละเอียดทุกเส้น เรียงตามตำแหน่งล้อ — กดที่การ์ดก็เลือกได้เหมือนกดที่ล้อ */}
                <div ref={cardsRef} className="mt-3 flex flex-col gap-3">
                  {CARD_SECTIONS.map((sec) => {
                    const list = orderedTires.filter(sec.match)
                    if (!list.length) return null
                    return (
                      <div key={sec.key} className="flex flex-col gap-1.5">
                        {/* หัวกลุ่มย่อยตามสถานะ */}
                        <div className="flex items-center gap-1.5" style={fontThai}>
                          <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${statusChipCls(sec.key)}`}>{sec.label}</span>
                          <span className="text-[10px] text-gray-400">{list.length} เส้น</span>
                          <span className="h-px flex-1 bg-[#EEF2F0] dark:bg-white/8" />
                        </div>
                        {list.map((t) => {
                    const on = selected.has(t.key)
                    const blocked = Boolean(t.blockedReason)
                    const lockedTire = isTireLocked(t)      // เปิด Job ไปแล้ว = แตะไม่ได้
                    const noPick = blocked || lockedTire
                    const photos = t.photoUrls ?? []
                    return (
                      <div
                        key={t.key}
                        data-tire-key={t.key}
                        role={noPick ? undefined : "button"}
                        tabIndex={noPick ? -1 : 0}
                        aria-pressed={noPick ? undefined : on}
                        aria-disabled={noPick}
                        onClick={() => { setFocusKey(t.key); toggle(t) }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocusKey(t.key); toggle(t) }
                        }}
                        className={[
                          "group rounded-[12px] border p-3 text-left transition-colors focus:outline-none",
                          blocked
                            ? "cursor-not-allowed border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
                            : lockedTire
                              ? "cursor-not-allowed border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20"
                              : on
                                ? "border-[#1B8C4B] bg-[#F0FDF4] dark:border-[#1B8C4B] dark:bg-[#1B8C4B]/12"
                                : "border-[#EEF2F0] bg-white hover:bg-[#F6FAF7] dark:border-white/8 dark:bg-[#151a10] dark:hover:bg-white/4",
                          t.key === focusKey ? "ring-2 ring-gray-300 dark:ring-white/20" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-1.5">
                          {lockedTire ? (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-blue-600 text-white" title="เปิด Job ไปแล้ว">
                              <Check size={11} strokeWidth={3} />
                            </span>
                          ) : (
                            <span className={[
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                              on && !blocked ? "border-[#1B8C4B] bg-[#1B8C4B] text-white" : "border-gray-300 dark:border-white/20",
                            ].join(" ")}>
                              {on && !blocked && <Check size={11} strokeWidth={3} />}
                            </span>
                          )}
                          <span className="font-mono text-[13px] font-bold text-[#14271C] dark:text-white">{t.positionCode || "—"}</span>
                          <span className="truncate text-[11px] text-gray-400" style={fontThai}>{t.positionName}</span>
                          {t.remainingPct !== null && t.remainingPct !== undefined && (
                            <span className={`shrink-0 rounded-md px-1.5 py-px text-[10px] font-semibold ${remainingCls(t.remainingPct)}`}>
                              {t.remainingPct}%
                            </span>
                          )}
                          <span className={`ml-auto shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${statusChipCls(t.itemStatus)}`} style={fontThai}>
                            {STATUS_LABEL[t.itemStatus] ?? t.itemStatus}
                          </span>
                          {/* ปฏิเสธ — โผล่ตอนเอาเมาส์ชี้การ์ด (เส้นที่เปิด Job แล้วปฏิเสธไม่ได้) */}
                          {onRejectTire && t.itemStatus !== "rejected" && !lockedTire && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onRejectTire(t) }}
                              title="ปฏิเสธยางเส้นนี้"
                              className="shrink-0 rounded px-1.5 py-px text-[10px] font-medium text-red-600 opacity-0 transition-opacity hover:bg-red-50 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 dark:text-red-400 dark:hover:bg-red-950/30"
                              style={fontThai}
                            >
                              ปฏิเสธ
                            </button>
                          )}
                        </div>

                        <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                          {t.serialNo || "ไม่มีซีเรียล"}
                          {t.product ? <span className="ml-1.5 font-sans">{t.product}</span> : null}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1" style={fontThai}>
                          <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
                            {t.reason || "—"}
                          </span>
                          {t.currentTreadMm ? <span className="text-[10px] text-gray-400">มิล {t.currentTreadMm} มม.</span> : null}
                          {(() => {
                            const start = t.mileageStart ?? 0
                            const odo = ctx.odometer ?? 0
                            const canCalc = odo > 0 && start > 0 && odo >= start
                            const km = canCalc ? odo - start : (t.usedDistance ?? 0)
                            if (km <= 0) return null
                            return (
                              <span className="text-[10px] text-gray-400">
                                ใช้งาน {fmtNum(km)} กม.
                                {canCalc && (
                                  <>
                                    {" "}({fmtNum(odo)} −{" "}
                                    <a
                                      href={`/tire?tab=history&q=${encodeURIComponent(t.serialNo || ctx.plate)}`}
                                      target="_blank" rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="ดูประวัติเปลี่ยนยางเส้นนี้"
                                      className="underline decoration-dotted underline-offset-2 hover:text-[#1B8C4B]"
                                    >
                                      {fmtNum(start)}
                                    </a>)
                                  </>
                                )}
                              </span>
                            )
                          })()}
                          {t.jobNo && (
                            <a
                              href={`/api/atms/maintenance-request/by-code/${encodeURIComponent(t.jobNo)}?go=1`}
                              target="_blank" rel="noreferrer"
                              onClick={(e) => openAtmsCase(e, t.jobNo!)}
                              title="เปิดใบแจ้งซ่อมบน ATMS"
                              className="inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold text-blue-700 underline decoration-dotted hover:opacity-80 dark:text-blue-300"
                            >
                              {t.jobNo}
                              {openingCase === t.jobNo ? <Loader2 size={9} className="animate-spin" /> : <ExternalLink size={9} />}
                            </a>
                          )}
                        </div>

                        {photos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {photos.map((u, ui) => (
                              <button
                                key={ui}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setHoverImg(null); setLightbox({ urls: photos, index: ui, tire: t }) }}
                                onMouseEnter={(e) => showHoverImg(e, u)}
                                onMouseLeave={() => setHoverImg(null)}
                                className="h-14 w-14 overflow-hidden rounded-[8px] border border-black/5 transition-transform hover:scale-105 dark:border-white/10"
                                title="ชี้เพื่อดูตัวอย่าง · กดเพื่อขยายเต็ม"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={u} alt={`ยาง ${t.positionCode} รูปที่ ${ui + 1}`} loading="lazy"
                                  className="h-full w-full bg-gray-100 object-cover dark:bg-white/5" />
                              </button>
                            ))}
                          </div>
                        )}

                        {t.note && <p className="mt-1.5 text-[10px] text-gray-400" style={fontThai}>หมายเหตุ: {t.note}</p>}
                        {t.blockedReason && (
                          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300" style={fontThai}>
                            <AlertTriangle size={10} /> {t.blockedReason}
                          </p>
                        )}

                        {onEditJob && t.itemStatus === "approved" && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onEditJob(t) }}
                            className="mt-2 text-[11px] text-gray-500 underline decoration-dotted hover:text-[#1B8C4B] dark:text-gray-400" style={fontThai}>
                            {t.jobNo ? "แก้ไขเลขเคส" : "+ ระบุเลขเคส"}
                          </button>
                        )}
                      </div>
                    )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

          </div>

          {/* right: ฟอร์มเปิด Job — หน้าเดียวตลอด งานที่ทำไปแล้วจะเพิ่มเป็น field ต่อท้าย */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[#14271C] dark:text-white" style={fontThai}>ข้อมูลใบแจ้งซ่อม</span>
              {optLoading && <Loader2 size={11} className="animate-spin text-gray-400" />}
              {optErr && (
                <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" style={fontThai}>
                  {optErr === "session"
                    ? "session ATMS หมดอายุ — ใช้ค่าเริ่มต้น (อัปเดต cookie แล้วเปิดใหม่)"
                    : "โหลดค่าจาก ATMS ไม่ได้ — ใช้ค่าเริ่มต้น"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="block">
                <span className={fieldLabel} style={fontThai}>วันเวลาแจ้ง *</span>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" disabled={locked}
                      className={fieldCls + " flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"} style={fontThai}>
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <CalendarClock size={13} className={`shrink-0 ${locked ? "text-blue-500" : "text-[#1B8C4B]"}`} />
                        {fmtScheduleLabel(scheduleAt)}
                      </span>
                      {!locked && <ChevronDown size={13} className="shrink-0 text-gray-400" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0" style={fontThai}>
                    <div className="flex divide-x divide-[#EEF2F0] dark:divide-white/10">
                      <Calendar
                        mode="single"
                        selected={scheduleAt}
                        onSelect={pickDate}
                        month={month}
                        onMonthChange={setMonth}
                      />
                      <div className="flex">
                        <TimeColumn values={HOURS} active={scheduleAt.getHours()} open={dateOpen}
                          onPick={(h) => pickTime(h, scheduleAt.getMinutes())} />
                        <TimeColumn values={MINUTES} active={scheduleAt.getMinutes()} open={dateOpen}
                          onPick={(m) => pickTime(scheduleAt.getHours(), m)} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-[#EEF2F0] px-3 py-2 dark:border-white/10">
                      <button type="button" onClick={() => { const now = roundTo5(new Date()); setScheduleAt(now); setMonth(now) }}
                        className="text-[11px] text-[#1B8C4B] underline decoration-dotted hover:opacity-80">
                        ตอนนี้
                      </button>
                      <button type="button" onClick={() => setDateOpen(false)} className={btnPrimary + " px-3 py-1.5 text-[12px]"}>
                        ตกลง
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <label className="block">
                <span className={fieldLabel} style={fontThai}>สาขา (ATMS) *</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={locked}
                  className={fieldCls + " w-full disabled:cursor-default"}>
                  <option value="">— เลือกสาขา —</option>
                  {Object.entries(branchOptions).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={fieldLabel} style={fontThai}>ทะเบียนรถ</span>
                <input value={ctx.plate} readOnly className={inp + " w-full cursor-default bg-gray-100 font-mono text-blue-700 dark:bg-white/10 dark:text-blue-300"} />
              </label>

              <label className="block">
                <span className={fieldLabel} style={fontThai}>คนขับ</span>
                <input value={driver} onChange={(e) => setDriver(e.target.value)} readOnly={locked}
                  placeholder="ชื่อคนขับ" className={fieldCls + " w-full"} />
              </label>

              <label className="block">
                <span className={fieldLabel} style={fontThai}>ช่างผู้รับผิดชอบ</span>
                <input value={mechanic} onChange={(e) => setMechanic(e.target.value)} readOnly={locked}
                  placeholder="" className={fieldCls + " w-full"} />
              </label>

              <label className="block">
                <span className={fieldLabel} style={fontThai}>เลขไมล์แจ้ง</span>
                <input value={informMile} onChange={(e) => setInformMile(e.target.value.replace(/[^\d,]/g, ""))}
                  readOnly={locked} inputMode="numeric" placeholder="250000" className={fieldCls + " w-full font-mono"} />
              </label>

              <label className="block sm:col-span-2">
                <span className={fieldLabel} style={fontThai}>ประเภทการซ่อม *</span>
                <select value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={locked}
                  className={fieldCls + " w-full disabled:cursor-default"}>
                  <option value="">— เลือกประเภท —</option>
                  {Object.entries(typeOptions).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className={fieldLabel} style={fontThai}>อาการ / รายละเอียด</span>
                <textarea
                  value={problem}
                  onChange={(e) => setProblemDraft(e.target.value)}
                  readOnly={locked}
                  rows={6}
                  className={fieldCls + " w-full resize-y leading-relaxed"}
                  placeholder="ระบุอาการที่แจ้งซ่อม"
                />
              </label>

              <label className={`flex items-center gap-2 sm:col-span-2 ${locked ? "" : "cursor-pointer"}`}>
                <input type="checkbox" checked={isBroken} onChange={(e) => setIsBroken(e.target.checked)}
                  disabled={locked} className="h-3.5 w-3.5 accent-[#1B8C4B] disabled:opacity-100" />
                <span className={`text-[12px] ${locked ? "text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-300"}`} style={fontThai}>
                  รถเสีย / จอดเสีย (is_broken)
                </span>
              </label>
            </div>

            {/* payload preview */}
            <div className="mt-4">
              <button type="button" onClick={() => setShowPayload((s) => !s)}
                className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 underline decoration-dotted hover:text-[#1B8C4B] dark:text-gray-400" style={fontThai}>
                <Code2 size={12} /> {showPayload ? "ซ่อน" : "ดู"} payload ที่จะส่งไป ATMS
              </button>
              {showPayload && (
                <pre className="mt-2 max-h-52 overflow-auto rounded-[12px] bg-[#0f1410] p-3 text-[11px] leading-relaxed text-green-300">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}
            </div>

            {/* ── เปิด Job ไปแล้ว → เพิ่ม field ต่อท้ายในหน้าเดิม ───────────
                มีเส้นที่อนุมัติแล้วแม้จะยังมีคำขอค้างอยู่ ก็นัดหมายได้เลยจากตรงนี้ */}
            {(step >= 2 || jobNos.length > 0) && (
              <div className="mt-4 border-t border-dashed border-[#EEF2F0] pt-4 dark:border-white/10">
                <div className="mb-3 flex items-center gap-2" style={fontThai}>
                  <span className="text-[12px] font-semibold text-[#14271C] dark:text-white">งานที่เปิดไว้แล้ว</span>
                  {jobLoading && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                      <Loader2 size={10} className="animate-spin" /> ดึงข้อมูลจาก ATMS...
                    </span>
                  )}
                  {jobErr && (
                    <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      ดึงข้อมูล job จาก ATMS ไม่ได้
                    </span>
                  )}
                  {!jobLoading && !jobErr && jobInfo && (
                    <span className="rounded bg-green-100 px-1.5 py-px text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                      เติมค่าจาก ATMS แล้ว
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="block">
                    <span className={fieldLabel} style={fontThai}>เลขเคสบน ATMS</span>
                    <div className={inp + " flex w-full flex-wrap items-center gap-2 bg-gray-50 dark:bg-white/5"}>
                      {jobNos.length === 0 ? <span className="text-gray-400">—</span> : jobNos.map((code) => (
                        <a
                          key={code}
                          href={`/api/atms/maintenance-request/by-code/${encodeURIComponent(code)}?go=1`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => openAtmsCase(e, code)}
                          title="เปิดใบแจ้งซ่อมบน ATMS"
                          className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-blue-700 underline decoration-dotted hover:opacity-80 dark:text-blue-300"
                        >
                          {code}
                          {openingCase === code ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                        </a>
                      ))}
                    </div>
                  </div>

                  <div className="block">
                    <span className={fieldLabel} style={fontThai}>สถานะคำขอ</span>
                    <div className={inp + " w-full bg-gray-50 dark:bg-white/5"}>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChipCls(ctx.requestStatus ?? "pending")}`} style={fontThai}>
                        {STATUS_LABEL[ctx.requestStatus ?? "pending"] ?? ctx.requestStatus}
                      </span>
                    </div>
                  </div>

                  {/* นัดหมาย — เลือกวันแล้วกดบันทึกได้เลยในหน้านี้ */}
                  <div className="block sm:col-span-2">
                    <span className={fieldLabel} style={fontThai}>
                      วันนัดเปลี่ยนยาง {ctx.appointmentDate ? "" : "— ยังไม่ได้นัด"}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Popover open={apptOpen} onOpenChange={setApptOpen}>
                        <PopoverTrigger asChild>
                          <button type="button" className={inp + " flex min-w-[190px] flex-1 items-center justify-between gap-2 text-left"} style={fontThai}>
                            <span className="inline-flex items-center gap-1.5 truncate">
                              <CalendarClock size={13} className="shrink-0 text-purple-600" />
                              {apptDate ? fmtDayLabel(apptDate.toISOString()) : "เลือกวันนัด"}
                            </span>
                            <ChevronDown size={13} className="shrink-0 text-gray-400" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-auto p-0" style={fontThai}>
                          <Calendar
                            mode="single"
                            selected={apptDate}
                            onSelect={(d) => { if (d) { setApptDate(d); setApptOpen(false) } }}
                            month={apptMonth}
                            onMonthChange={setApptMonth}
                          />
                        </PopoverContent>
                      </Popover>
                      <button
                        type="button"
                        disabled={!apptDate || !onAppointment}
                        onClick={() => { if (apptDate && onAppointment) onAppointment(startOfDay(apptDate).toISOString()) }}
                        className="inline-flex items-center gap-1.5 rounded-[11px] bg-purple-600 px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={fontThai}
                      >
                        <CalendarClock size={13} /> {ctx.appointmentDate ? "แก้ไขนัดหมาย" : "บันทึกนัดหมาย"}
                      </button>
                    </div>
                  </div>

                  {/* ปิดงาน — โผล่เมื่อมีนัดหมายแล้ว */}
                  {(step >= 3 || ctx.appointmentDate) && (
                    <div className="block sm:col-span-2">
                      <span className={fieldLabel} style={fontThai}>ปิดงาน</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex-1 text-[11px] text-gray-500 dark:text-gray-400" style={fontThai}>
                          {step === 4 ? "งานนี้ปิดแล้ว — ดูย้อนหลังได้ที่แท็บประวัติการเปลี่ยน" : "เปลี่ยนยางเสร็จแล้วกดปิดงานเพื่อจบคำขอนี้"}
                        </span>
                        {step !== 4 && onDone && (
                          <button type="button" onClick={onDone}
                            className="inline-flex items-center gap-1.5 rounded-[11px] bg-green-600 px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90" style={fontThai}>
                            <Flag size={13} /> ปิดงาน — เปลี่ยนเสร็จ
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── footer ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[#EEF2F0] px-5 py-3.5 dark:border-white/8">
          <div className="min-w-0 flex-1" style={fontThai}>
            {step === 1 ? (
              <>
                {chosen.length > 0 ? (
                  <p className="text-[12px] text-[#14271C] dark:text-white">
                    เลือกแล้ว <b className="text-[#1B8C4B]">{chosen.length}</b> เส้น
                    <span className="ml-1.5 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                      {chosen.map((t) => t.positionCode).join(", ")}
                    </span>
                  </p>
                ) : (
                  <p className="text-[12px] text-gray-400">ยังไม่ได้เลือกยาง</p>
                )}
                {missing.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">ต้องระบุ: {missing.join(" · ")}</p>
                )}
              </>
            ) : (
              <p className="text-[12px] text-gray-500 dark:text-gray-400">
                อนุมัติ + เปิด Job ไปแล้ว — ทำงานต่อได้ที่ช่องด้านบน (นัดหมาย / ปิดงาน)
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className={btnGhost} style={fontThai}>
              {step === 4 ? "ปิด" : "ยกเลิก"}
            </button>
            {/* มีใบแล้ว = เพิ่มรายการเข้าใบเดิม ไม่เปิดใบใหม่ */}
            {step !== 4 && (
              <button type="submit" disabled={!canSubmit} className={btnPrimary + " inline-flex items-center gap-1.5"} style={fontThai}>
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
                {existingJob ? `เพิ่มเข้า Job ${existingJob}` : "เปิด Job"}
                {chosen.length > 0 ? ` (${chosen.length} เส้น)` : ""}
              </button>
            )}
          </div>
        </div>

        {step === 1 && (
          <p className="border-t border-dashed border-amber-300/60 bg-amber-50 px-5 py-2 text-center text-[11px] font-medium text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300" style={fontThai}>
            โหมดทดสอบ — กด “เปิด Job” แล้วดู payload ที่ console (ยังไม่ส่งไป ATMS จริง)
          </p>
        )}
      </form>

      {/* ── พรีวิวตอน hover — ไม่รับเมาส์ ไม่บังปุ่มข้างใต้ ─────────── */}
      {hoverImg && !lightbox && (
        <div
          className="pointer-events-none fixed z-55 overflow-hidden rounded-[12px] border border-white/15 bg-[#0f1410] shadow-2xl"
          style={{ top: hoverImg.top, left: hoverImg.left, width: HOVER_PREVIEW_SIZE, height: HOVER_PREVIEW_SIZE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hoverImg.url} alt="" className="h-full w-full object-contain" />
        </div>
      )}

      {/* ── lightbox: รูปยางแบบเต็ม ─────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 p-4"
          onClick={(e) => { e.stopPropagation(); setLightbox(null) }}
        >
          <div className="mb-2 flex items-center gap-2 text-[12px] text-white/80" style={fontThai}>
            <span className="font-mono font-bold text-white">{lightbox.tire.positionCode}</span>
            <span>{lightbox.tire.positionName}</span>
            <span className="font-mono text-white/60">{lightbox.tire.serialNo}</span>
            <span className="rounded bg-white/15 px-1.5 py-px text-[10px]">{lightbox.tire.reason}</span>
          </div>

          <div className="flex max-h-[80vh] items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {lightbox.urls.length > 1 && (
              <button type="button" aria-label="รูปก่อนหน้า"
                onClick={() => setLightbox((s) => (s ? { ...s, index: (s.index - 1 + s.urls.length) % s.urls.length } : s))}
                className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20">
                <ChevronLeft size={18} />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.urls[lightbox.index]}
              alt={`ยาง ${lightbox.tire.positionCode} รูปที่ ${lightbox.index + 1}`}
              className="max-h-[80vh] max-w-[85vw] rounded-[12px] object-contain"
            />
            {lightbox.urls.length > 1 && (
              <button type="button" aria-label="รูปถัดไป"
                onClick={() => setLightbox((s) => (s ? { ...s, index: (s.index + 1) % s.urls.length } : s))}
                className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20">
                <ChevronRight size={18} />
              </button>
            )}
          </div>

          <p className="mt-2 text-[11px] text-white/60" style={fontThai}>
            {lightbox.index + 1} / {lightbox.urls.length} — กดพื้นหลังหรือ Esc เพื่อปิด
          </p>
        </div>
      )}
    </div>
  )
}
