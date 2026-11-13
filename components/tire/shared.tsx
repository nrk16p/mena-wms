"use client"

// ของกลางของหน้ายาง — โทน/ตัวจัดรูปแบบ/ชนิดข้อมูลของคำขอเปลี่ยนยาง + ชิ้นส่วนที่ใช้ซ้ำ
// แยกออกมาเพราะมี 2 หน้าที่อ่านข้อมูลชุดเดียวกัน: แท็บ "คำขอ / อนุมัติ" (จัดกลุ่มตามทะเบียน)
// และแท็บ "คำขอ / อนุมัติ V.2" (1 แถว = 1 ยาง 1 รายการ) — ถ้าปล่อยให้ต่างฝ่ายนิยามเอง
// สี/ป้ายสถานะจะเริ่มเพี้ยนกันเมื่อมีการแก้ข้างเดียว

import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal, type LucideIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Calendar } from "@/components/ui/calendar"
import { BRANCHES } from "@/lib/branch-scope"

// ── สาขา ────────────────────────────────────────────────────────────────────
// รายชื่อสาขาอยู่ที่ lib/branch-scope.ts (ที่เดียว) เพราะฝั่ง server ใช้ตัดสิทธิ์ด้วย

export { BRANCHES }

export const branchLabel = (b: string) => BRANCHES.find((x) => x.value === b)?.label ?? b

export const branchChipCls = (b: string) =>
  b === "saraburi"
    ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
    // ไม่ใช้ส้ม — ส้ม/แดง/เหลืองสงวนไว้บอกระดับยาง (ถึงกำหนด/เกิน/เฝ้าระวัง) ป้ายสาขาจะได้ไม่ถูกอ่านเป็นคำเตือน
    : "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"

// fetch ทั้ง 2 สาขาแล้ว merge (หรือสาขาเดียวตาม filter)
// allowed = สาขาที่ผู้ใช้เห็นได้ (useBranchScope) — กันไม่ให้ filter ว่างไปดึงสาขาที่ไม่มีสิทธิ์
export function branchesFor(filter: string, allowed?: string[]): string[] {
  const list = filter ? [filter] : BRANCHES.map((b) => b.value)
  return allowed ? list.filter((b) => allowed.includes(b)) : list
}

// ── สถานะคำขอ ───────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว", appointment: "รอเปลี่ยน", done: "เปลี่ยนแล้ว", rejected: "ปฏิเสธ",
}

export function statusChip(status: string) {
  switch (status) {
    case "approved":    return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    case "appointment": return "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
    case "done":        return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    case "rejected":    return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
    default:            return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
  }
}

// ── ตัวจัดรูปแบบ ─────────────────────────────────────────────────────────────

export const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

// นัดหมาย ไม่มีการเลือกเวลา — แสดงเฉพาะวันที่
export const fmtDateOnly = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export const fmtNum = (n?: number | null) => (n ?? 0).toLocaleString("th-TH")

// ── ชนิดข้อมูลคำขอ ──────────────────────────────────────────────────────────

export type RequestItem = {
  _id:            string
  tirePosition:   string
  positionCode:   string
  positionName:   string
  serialNo:       string
  product:        string
  reason:         string
  note?:          string
  photoUrl?:      string
  photoUrls?:     string[]
  currentTreadMm: number
  mileageStart:   number
  usedDistance:   number
  remainingPct:   number | null
  bahtPerKm:      number | null
  createdAt:      string
  status?:        string
  rejectReason?:  string
  jobNo?:         string
  appointmentDate?: string   // นัดหมายรายเส้น — แต่ละล้อนัดคนละวันได้
  // ใครทำอะไรกับยางเส้นนี้ — API คืนเอกสารทั้งก้อน ฟิลด์พวกนี้จึงมาพร้อมกันอยู่แล้ว
  approvedBy?:    string
  approvedAt?:    string
  rejectedBy?:    string
  rejectedAt?:    string
  appointmentBy?: string
  appointmentAt?: string
  // ปิดงานรายเส้น — ล้อที่เปลี่ยนเสร็จแล้วปิดได้เลย ไม่ต้องรอเส้นอื่นในใบเดียวกัน
  doneBy?:        string
  doneAt?:        string
}

export type TireRequest = {
  _id:             string
  branch:          string
  driverName:      string
  plate:           string
  truckNumber:     string
  currentOdometer: number
  fleet?:          string
  plant?:          string
  status?:         string
  createdAt:       string
  items?:          RequestItem[]
  rejectReason?:   string
  appointmentDate?: string
  requestedBy?:    string
  source?:         string    // "web" | "mobile" | "booking" — มือถือคนขับ / หน้าเว็บ / แอดมินจองเปลี่ยน (อนุมัติในตัว)
  // ใครทำอะไรกับ "ทั้งคำขอ" — คำขอเก่าตัดสินทีเดียวทั้งใบ ก่อนจะมีการอนุมัติรายเส้น
  approvedBy?:     string
  approvedAt?:     string
  rejectedBy?:     string
  rejectedAt?:     string
  appointmentBy?:  string
  appointmentAt?:  string
  doneBy?:         string
  doneAt?:         string
}

export type MrInfo = { mrId: string; status: string; note: string; updatedAt: string } | null

// ── โทน/สไตล์ร่วม (WMS design tokens) ───────────────────────────────────────

export const card = "rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]"
export const inp  = "rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30 placeholder-[#9AA8A0]"
export const thCls = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#9AA8A0] whitespace-nowrap"
export const tdCls = "px-3 py-2 text-[12px] text-[#6B7C72] dark:text-gray-300 whitespace-nowrap"
// แถวหัวตาราง — ทึบสี (ไม่โปร่งแสง) เพื่อให้บังแถวข้อมูลที่เลื่อนลอดใต้ header ตอน sticky
export const theadCls = "sticky top-0 z-10 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#151a10]"
export const btnPrimary = "rounded-[11px] bg-[#1B8C4B] text-white px-3.5 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
export const btnSmall = "rounded-[10px] px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
export const fontThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
export const fontHead = { fontFamily: "'Mitr', sans-serif", fontWeight: 500 }

// ── Stat card — การ์ดสถิติแบบ minimal (กดเพื่อกรองได้ ถ้าส่ง onClick) ──

/**
 * โทนของตัวเลข/ชิป — 5 สีแรกผูกกับสถานะคำขอ (เหลือง=รออนุมัติ ฟ้า=อนุมัติ ม่วง=นัด เขียว=เสร็จ แดง=ปฏิเสธ)
 * `orange` แยกไว้ต่างหากสำหรับ "ของที่ผิดปกติ ต้องมีคนมาแก้" — ไม่ใช่สถานะบนเส้นทางงาน
 */
export type StatTone = "slate" | "amber" | "blue" | "purple" | "green" | "red" | "orange"

const STAT_TONE: Record<StatTone, { dot: string; num: string; active: string }> = {
  slate:  { dot: "bg-[#9AA8A0]",   num: "text-[#14271C] dark:text-white",         active: "border-[#14271C]/25 bg-[#F6FAF7] dark:border-white/25 dark:bg-white/5" },
  amber:  { dot: "bg-amber-500",   num: "text-amber-600 dark:text-amber-400",     active: "border-amber-400/60 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-500/10" },
  blue:   { dot: "bg-blue-500",    num: "text-blue-600 dark:text-blue-400",       active: "border-blue-400/60 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-500/10" },
  purple: { dot: "bg-purple-500",  num: "text-purple-600 dark:text-purple-400",   active: "border-purple-400/60 bg-purple-50 dark:border-purple-400/40 dark:bg-purple-500/10" },
  green:  { dot: "bg-[#1B8C4B]",   num: "text-[#1B8C4B] dark:text-green-400",     active: "border-[#1B8C4B]/50 bg-[#F0FDF4] dark:border-green-400/40 dark:bg-green-500/10" },
  red:    { dot: "bg-red-500",     num: "text-red-600 dark:text-red-400",         active: "border-red-400/60 bg-red-50 dark:border-red-400/40 dark:bg-red-500/10" },
  orange: { dot: "bg-orange-500",  num: "text-orange-600 dark:text-orange-400",   active: "border-orange-400/60 bg-orange-50 dark:border-orange-400/40 dark:bg-orange-500/10" },
}

export function StatCard({ label, value, tone = "slate", caption, sub, active, onClick }: {
  label:    string
  value:    string | number
  tone?:    StatTone
  caption?: string
  /** บรรทัดคำอธิบายใต้ตัวเลข — ใช้เมื่อ caption ถูกใช้บอกหน่วยไปแล้ว */
  sub?:     string
  active?:  boolean
  onClick?: () => void
}) {
  const t = STAT_TONE[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-[14px] border px-3.5 py-2.5 text-left transition-colors",
        onClick ? "cursor-pointer" : "cursor-default",
        active
          ? t.active
          : "border-[#EEF2F0] bg-white dark:border-white/8 dark:bg-[#151a10] " +
            (onClick ? "hover:border-[#1B8C4B]/30 hover:bg-[#F6FAF7] dark:hover:bg-white/4" : ""),
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
        <span className="truncate text-[11px] font-medium text-[#6B7C72] dark:text-gray-400" style={fontThai}>{label}</span>
      </span>
      <span className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[20px] leading-none ${t.num}`} style={fontHead}>{value}</span>
        {caption && <span className="text-[10px] text-[#9AA8A0]" style={fontThai}>{caption}</span>}
      </span>
      {sub && <span className="mt-1 block truncate text-[10px] text-[#9AA8A0]" style={fontThai}>{sub}</span>}
    </button>
  )
}

// ── รูปถ่ายยาง — จิ๋วในตาราง ขยายตอนชี้ กดเพื่อเปิดเต็ม ──

/** ด้านกว้าง (px) ของพรีวิวตอนชี้ */
const PREVIEW_SIZE = 300

/**
 * รูปย่อที่ขยายให้ดูตอนเอาเมาส์ชี้
 *
 * พรีวิวเกาะตำแหน่งของ "รูปย่อ" ไม่ใช่ตำแหน่งเมาส์ — วางไว้ข้างขวา ถ้าจะล้นขอบจอก็
 * สลับไปอยู่ซ้าย และหนีบไม่ให้ล้นบน/ล่าง (ของเดิมวางที่ cursor+16 คงที่ พรีวิวของแถว
 * ท้ายตารางหรือคอลัมน์ขวาสุดจึงหลุดออกนอกจอ)
 *
 * ใช้ object-contain บนพื้นเข้ม — รูปยางเป็นแนวนอนเกือบทั้งหมด ถ้า cover จะถูกครอบตัด
 * จนมองไม่เห็นดอกยางซึ่งเป็นสิ่งเดียวที่คนเปิดดูอยากเห็น
 */
export function PhotoThumb({ src, alt, size = 55 }: { src: string; alt: string; size?: number }) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)

  // เลื่อนหน้าจอแล้วพรีวิวที่ค้างอยู่จะหลุดตำแหน่ง — ซ่อนทิ้งไปเลย
  useEffect(() => {
    if (!box) return
    const hide = () => setBox(null)
    window.addEventListener("scroll", hide, true)
    return () => window.removeEventListener("scroll", hide, true)
  }, [box])

  function show(e: { currentTarget: HTMLElement }) {
    const r = e.currentTarget.getBoundingClientRect()
    const gap = 10
    const edge = 12
    const left = r.right + gap + PREVIEW_SIZE > window.innerWidth - edge ? r.left - gap - PREVIEW_SIZE : r.right + gap
    const top = Math.max(edge, Math.min(r.top + r.height / 2 - PREVIEW_SIZE / 2, window.innerHeight - PREVIEW_SIZE - edge))
    setBox({ top, left })
  }

  /**
   * โฟกัสมี 2 แบบ และมีแค่แบบเดียวที่ควรเด้งพรีวิว
   *
   * ตอนเปิดโมดัลรายละเอียด Radix Dialog จะยิงโฟกัสไปที่ปุ่มตัวแรกในกล่องเองเพื่อดักโฟกัส
   * ซึ่งหลายเคสคือรูปแรกพอดี (รายการที่ยังไม่มีเลข Job ไม่มีลิงก์อะไรมาก่อนรูป) —
   * ผลคือรูปใหญ่เด้งค้างขึ้นมาเองทันทีที่เปิด ทั้งที่ผู้ใช้ไม่ได้ชี้อะไรเลย
   *
   * :focus-visible แยกสองแบบนี้ให้: โฟกัสจากโค้ดไม่เข้าเงื่อนไข แต่การกด Tab มาเข้า —
   * คนใช้คีย์บอร์ดจึงยังดูรูปได้เหมือนเดิม
   */
  function showIfKeyboard(e: { currentTarget: HTMLElement }) {
    try {
      if (!e.currentTarget.matches(":focus-visible")) return
    } catch {
      return // เบราว์เซอร์เก่าที่ไม่รู้จัก :focus-visible — ไม่โชว์ดีกว่าโชว์มั่ว
    }
    show(e)
  }

  return (
    <>
      <button
        type="button"
        title="กดเพื่อเปิดรูปเต็ม"
        onClick={(e) => { e.stopPropagation(); setBox(null); window.open(src, "_blank", "noreferrer") }}
        onMouseEnter={show}
        onMouseLeave={() => setBox(null)}
        onFocus={showIfKeyboard}
        onBlur={() => setBox(null)}
        className="group relative block shrink-0 cursor-zoom-in overflow-hidden rounded-[8px] ring-1 ring-gray-200 transition-all hover:ring-2 hover:ring-[#1B8C4B] dark:ring-white/10"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-110" />
      </button>

      {box && createPortal(
        <div
          className="pointer-events-none fixed z-[60] overflow-hidden rounded-[12px] border border-white/15 bg-[#0f1410] shadow-2xl"
          style={{ top: box.top, left: box.left, width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="h-full w-full object-contain" />
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * กลุ่มรูปของยาง 1 เส้นสำหรับคอลัมน์ในตาราง — โชว์ได้ไม่เกิน `max` รูป
 * ที่เหลือยุบเป็นป้าย "+N" ที่ชี้แล้วขยายได้เหมือนกัน ความกว้างคอลัมน์จึงคงที่
 */
export function PhotoCell({ urls, max = 2 }: { urls: string[]; max?: number }) {
  if (!urls.length) {
    return <span className="text-[11px] text-gray-300 dark:text-gray-600" title="ไม่มีรูป">—</span>
  }
  const shown = urls.slice(0, max)
  const rest  = urls.slice(max)
  return (
    <span className="flex items-center gap-1">
      {shown.map((u, i) => <PhotoThumb key={i} src={u} alt={`รูปยาง ${i + 1}`} />)}
      {rest.length > 0 && (
        <span className="flex items-center">
          {/* รูปที่เหลือยังชี้ดูได้ แค่ซ้อนกันอยู่ใต้ป้ายนับ */}
          <PhotoThumb src={rest[0]} alt={`รูปยาง ${max + 1}`} size={55} />
          {rest.length > 1 && (
            <span className="-ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#14271C]/85 px-1 text-[9px] font-bold text-white dark:bg-white/85 dark:text-[#14271C]">
              +{rest.length - 1}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// ── กล่องนัดหมาย ────────────────────────────────────────────────────────────

// ใช้ร่วมกันทั้งแท็บคำขอ (ส่ง TireRequest) และหน้ารายละเอียดรถ (ส่งข้อมูลย่อจากล้อที่เลือก)
export type AppointmentTarget = {
  plate:            string
  driverName?:      string
  appointmentDate?: string | null
  subtitle?:        string   // ระบุล้อที่กำลังนัด — ว่างไว้ = นัดทั้งคำขอ
}

export function AppointmentDialog({ target, onClose, onConfirm }: {
  target: AppointmentTarget | null
  onClose: () => void
  onConfirm: (dateIso: string) => void
}) {
  const [date, setDate] = useState<Date | undefined>(undefined)

  useEffect(() => {
    if (!target) return
    const existing = target.appointmentDate ? new Date(target.appointmentDate) : null
    const valid = existing && !isNaN(existing.getTime()) ? existing : null
    setDate(valid ?? new Date())
  }, [target])

  function handleConfirm() {
    if (!date) return
    const combined = new Date(date)
    combined.setHours(0, 0, 0, 0)
    onConfirm(combined.toISOString())
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle style={fontHead}>นัดหมายเปลี่ยนยาง</DialogTitle>
        </DialogHeader>
        {target && (
          <>
            <p className="text-[13px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
              ทะเบียน <span className="font-mono font-semibold text-[#14271C] dark:text-white">{target.plate}</span>
              {target.driverName ? ` · ${target.driverName}` : ""}
              {target.subtitle && (
                <span className="mt-0.5 block font-medium text-purple-600 dark:text-purple-300">{target.subtitle}</span>
              )}
            </p>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                className="rounded-lg border border-[#EEF2F0] dark:border-white/10"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" disabled={!date} onClick={handleConfirm} className={btnPrimary + " flex-1"} style={fontThai}>
                บันทึกนัดหมาย
              </button>
              <button type="button" onClick={onClose}
                className="rounded-[11px] border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/8" style={fontThai}>
                ยกเลิก
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── ความสดของข้อมูล — แถบบอก "ตัวเลขบนหน้านี้อัปเดตเมื่อไหร่" ─────────────────
// ข้อมูลยางถ่ายมาเป็นรอบ ไม่ใช่ข้อมูลสด — บอกแค่ 2 อย่างที่คนดูต้องรู้:
// ดึงจาก ATMS ล่าสุดเมื่อไหร่ และคำนวณระยะ GPS ล่าสุดเมื่อไหร่

const TZ = "Asia/Bangkok"

const bkkDayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ })

/** "วันนี้ 11:02 น." / "เมื่อวาน 11:02 น." / "5 พ.ย. 69 · 11:02 น." */
export function fmtStamp(s?: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  const time = d.toLocaleTimeString("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) + " น."
  const now = new Date()
  const key = bkkDayKey(d)
  if (key === bkkDayKey(now)) return `วันนี้ ${time}`
  if (key === bkkDayKey(new Date(now.getTime() - 86400000))) return `เมื่อวาน ${time}`
  return `${d.toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit" })} · ${time}`
}

/** "เมื่อสักครู่" / "25 นาทีที่แล้ว" / "3 ชม. ที่แล้ว" / "2 วันที่แล้ว" */
export function fmtAgo(s: string | null | undefined, nowMs: number): string {
  if (!s) return ""
  const ms = nowMs - new Date(s).getTime()
  if (isNaN(ms)) return ""
  const min = Math.floor(ms / 60000)
  if (min < 1)  return "เมื่อสักครู่"
  if (min < 60) return `${min} นาทีที่แล้ว`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr} ชม. ที่แล้ว`
  return `${Math.floor(hr / 24)} วันที่แล้ว`
}

/** นาฬิกาที่เดินทุกนาที — ให้ "กี่นาทีที่แล้ว" ขยับเองโดยไม่ต้องรีโหลดข้อมูล */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** เวลาที่เก่าสุดในชุด — ถ้าสาขาไหนยังไม่เคยดึงเลย (null) ถือว่าไม่มีข้อมูล */
export function oldestTime(times: (string | null | undefined)[]): string | null {
  if (times.length === 0 || times.some((t) => !t)) return null
  return times.reduce((a, b) => (new Date(b!) < new Date(a!) ? b : a)) ?? null
}

/** แถบเวลาอัปเดต: "ข้อมูลจาก ATMS ล่าสุด: …" / "ข้อมูลระยะทาง GPS ล่าสุด: …" + ปุ่มด้านขวา */
export function FreshnessBar({ items, actions, loading }: {
  items:    { label: string; at: string | null }[]
  actions?: React.ReactNode
  loading?: boolean
}) {
  const now = useMinuteClock()
  return (
    <div className={card + " mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5"} style={fontThai}>
      <dl className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
        {items.map((it, i) => {
          // เกิน 1 วัน = ตัวเลขบนหน้าน่าจะไม่ตรงแล้ว ขึ้นสีแดงให้เห็น
          const stale = !!it.at && now - new Date(it.at).getTime() >= 86400000
          return (
            <div key={it.label} className={"flex items-baseline gap-1.5" + (i > 0 ? " sm:border-l sm:border-[#EEF2F0] sm:pl-6 dark:sm:border-white/10" : "")}>
              <dt className="text-[#6B7C72] dark:text-gray-400">{it.label}:</dt>
              <dd className={`font-semibold tabular-nums ${stale ? "text-red-600 dark:text-red-400" : "text-[#14271C] dark:text-white"}`}>
                {loading ? "—" : fmtStamp(it.at)}
              </dd>
              {!loading && it.at && <dd className="text-[11.5px] text-[#9AA8A0]">({fmtAgo(it.at, now)})</dd>}
            </div>
          )
        })}
      </dl>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}

/** ปุ่มบนแถบความสดของข้อมูล — ขอบบาง ตัวอักษรเข้ม เท่ากันทุกปุ่ม */
export const freshBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-[#E3E9E5] dark:border-white/10 bg-white dark:bg-[#151a10] px-3 " +
  "text-[12px] font-medium text-[#14271C] dark:text-white transition-colors hover:border-[#1B8C4B]/40 hover:bg-[#F0FDF4] dark:hover:bg-white/5 " +
  "disabled:cursor-not-allowed disabled:opacity-50"

// ── ปุ่มจัดการท้ายแถวตาราง — ปุ่มไอคอนขนาดเดียวกัน + เมนู "⋯" รวมคำสั่งรอง ──────

export const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#E3E9E5] dark:border-white/10 bg-white dark:bg-[#151a10] " +
  "text-[#6B7C72] dark:text-gray-300 transition-colors hover:border-[#1B8C4B]/40 hover:bg-[#F0FDF4] hover:text-[#17793F] " +
  "dark:hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/40"

export function IconAction({ icon: Icon, label, onClick, tone = "default" }: {
  icon:    LucideIcon
  label:   string
  onClick: () => void
  tone?:   "default" | "primary"
}) {
  return (
    <button
      type="button" title={label} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={iconBtn + (tone === "primary" ? " border-[#1B8C4B]/35 text-[#17793F] dark:text-green-400" : "")}
    >
      <Icon size={13} />
    </button>
  )
}

export type RowMenuItem = {
  label:    string
  icon?:    LucideIcon
  onSelect: () => void
  danger?:  boolean
  hidden?:  boolean
  /** เส้นคั่นก่อนรายการนี้ */
  divider?: boolean
}

export function RowMenu({ items, label = "จัดการ" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const shown = items.filter((i) => !i.hidden)
  if (shown.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title={label} aria-label={label} onClick={(e) => e.stopPropagation()}
          className={iconBtn + (open ? " border-[#1B8C4B]/40 bg-[#F0FDF4] text-[#17793F]" : "")}>
          <MoreHorizontal size={14} />
        </button>
      </PopoverTrigger>
      {/* portal ยังส่ง event กลับขึ้น React tree — กันคลิกในเมนูไปกาง/หุบแถวข้างหลัง */}
      <PopoverContent align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}
        className="w-auto min-w-[188px] rounded-[12px] border border-[#EEF2F0] bg-white p-1 shadow-[0_8px_24px_-8px_rgba(20,39,28,.25)] dark:border-white/10 dark:bg-[#151a10]">
        <div role="menu" style={fontThai}>
          {shown.map((it) => {
            const Icon = it.icon
            return (
              <React.Fragment key={it.label}>
                {it.divider && <div className="my-1 h-px bg-[#EEF2F0] dark:bg-white/10" />}
                <button type="button" role="menuitem"
                  onClick={() => { setOpen(false); it.onSelect() }}
                  className={[
                    "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] outline-none transition-colors focus-visible:bg-[#F0FDF4] dark:focus-visible:bg-white/5",
                    it.danger
                      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      : "text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5",
                  ].join(" ")}>
                  {Icon && <Icon size={13} className={it.danger ? "" : "text-[#9AA8A0]"} />}
                  {it.label}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
