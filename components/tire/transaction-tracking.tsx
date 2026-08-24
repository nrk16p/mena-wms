"use client"

// ===========================================================================
// แท็บ "คำขอ / อนุมัติ V.2" — Transaction Tracking
// ===========================================================================
// ต่างจากแท็บ V.1 ที่ 1 แถว = 1 ทะเบียน (ต้องกาง 2 ชั้นถึงจะเห็นยางแต่ละเส้น):
// ที่นี่ **1 แถว = 1 รายการ = ยาง 1 เส้น** ซึ่งเป็นหน่วยที่คนกดอนุมัติ/นัดหมายจริง
// เปิดหน้ามาจึงเห็นเลยว่ามีอะไรเข้าใหม่วันนี้ (เรียงใหม่สุดบน + ป้าย "ใหม่") ค้างอยู่กี่รายการ
// และใครทำอะไรถึงขั้นไหน โดยไม่ต้องกางหาเอง
// แกนของหน้า: ค้นหา/ชิปค้างงาน → ชิปขั้นของงาน → ตาราง → โมดัลรายละเอียด
//
// ข้อมูลมาจาก endpoint เดิม (`/api/tire-change-request`) ทั้งก้อน แล้วกรอง/นับฝั่งหน้าเว็บ
// ตัวเลขบนการ์ดกับชิปจึงตรงกับสิ่งที่กดแล้วจะเห็นเสมอ ไม่ใช่เลขจากคิวรีอีกชุด

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import Swal from "sweetalert2"
import {
  ArrowDown, ArrowUp, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Clock, Copy, FilePlus2, FileSpreadsheet, Flag, Inbox, ListFilter, Lock, RefreshCw, Search, Tag, X,
} from "lucide-react"
import { bkkToday } from "@/lib/bkk-time"
import {
  downloadExcelTable, xlsDate, XLS_DATE_FMT, XLS_DATETIME_FMT, type ExcelCol,
} from "@/lib/excel-table"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { MR_LABEL, MR_NEXT, mrChip, type MrStatus, type MrSummary } from "@/lib/tire-mr"
import { MrTimelineList } from "@/components/mr-timeline"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AppointmentDialog, PhotoCell, PhotoThumb, STATUS_LABEL,
  branchChipCls, branchLabel, branchesFor, btnSmall, card,
  fmtDate, fmtDateOnly, fmtNum, fontHead, fontThai, inp,
  statusChip,
  type RequestItem, type StatTone, type TireRequest,
} from "@/components/tire/shared"
import { AtmsJobLink } from "@/components/atms-job-link"

// ── กติกาของหน้า ────────────────────────────────────────────────────────────

/** คำขอที่ยังไม่ขยับเกินกี่วันถือว่า "ค้าง" — ตัวเลขเดียวที่หน้าใช้ตัดสิน แก้ที่นี่ที่เดียว */
const STUCK_DAYS = 3

/** ดึงคำขอล่าสุดต่อสาขาเท่านี้ — 1 คำขอมีได้หลายเส้น แถวจริงจึงมากกว่านี้ */
const FETCH_LIMIT = 200

const PAGE_SIZES = [20, 50, 100] as const

/** ขั้นของงานของยาง 1 เส้น — อยู่ได้ขั้นเดียวเสมอ เลขบนชิปจึงบวกกันได้ */
type TxStage = "pending" | "approved" | "appointment" | "done" | "rejected"

/** เส้นทางปกติ 4 ขั้น — "ปฏิเสธ" ไม่อยู่บนเส้นนี้ (จบแยก) */
const STAGE_FLOW: { key: TxStage; label: string }[] = [
  { key: "pending",     label: "ขอเปลี่ยน" },
  { key: "approved",    label: "อนุมัติ" },
  { key: "appointment", label: "นัดหมาย" },
  { key: "done",        label: "เปลี่ยนแล้ว" },
]

const STAGE_STEP: Record<TxStage, number> = {
  pending: 1, approved: 2, appointment: 3, done: 4, rejected: 0,
}

const STAGE_CHIPS: { value: TxStage | "all"; label: string; tone: StatTone }[] = [
  { value: "all",         label: "ทั้งหมด",     tone: "slate" },
  { value: "pending",     label: "รออนุมัติ",   tone: "amber" },
  { value: "approved",    label: "อนุมัติแล้ว", tone: "blue" },
  { value: "appointment", label: "นัดหมายแล้ว", tone: "purple" },
  { value: "done",        label: "เสร็จสิ้น",   tone: "green" },
  { value: "rejected",    label: "ปฏิเสธ",      tone: "red" },
]

// ── หน้าตาตาราง ─────────────────────────────────────────────────────────────
// ตารางนี้เป็น "datatable" ทางการ: หัวเข้มกว่าตัวกลาง (thCls/theadCls) และมีเส้นแบ่ง
// คอลัมน์ทุกช่อง เพราะแถวเดียวมี 8 คอลัมน์ที่ต่างชนิดกันมาก ถ้าไม่มีเส้นตั้งกวาดตาแล้วหลง
// ไม่แก้ตัวกลางใน tire/shared เพราะแท็บอื่นยังใช้หัวแบบอ่อนอยู่

const txTheadCls = "sticky top-0 z-20 border-b-2 border-[#1B8C4B]/30 bg-[#E4EFE8] dark:border-[#1B8C4B]/45 dark:bg-[#1B2419]"

const txThCls =
  "border-r border-[#1B8C4B]/15 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#14271C] " +
  "last:border-r-0 dark:border-white/8 dark:text-gray-100"

const txTdCls = "border-r border-[#F1F5F2] px-3 py-2.5 align-top last:border-r-0 dark:border-white/5"

/**
 * ชิปสาเหตุ — เน้นสีเฉพาะ "รถกินยาง" เพราะเป็นสาเหตุเดียวที่มีเงื่อนไขพิเศษ
 * (ต้องปิด MR ก่อนจึงอนุมัติได้ — ดู approve()) สาเหตุอื่นใช้โทนกลางเหมือนกันหมด
 * ผู้ใช้จึงไม่ต้องจำว่าสีไหนหมายถึงอะไร
 */
const reasonChipCls = (reason?: string | null) =>
  reason === "รถกินยาง"
    ? "text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25"
    : "dark:bg-white/5 dark:text-gray-300 dark:ring-white/10"

// ── ตัวช่วยเรื่องวัน ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

const timeOf = (s?: string | null) => {
  if (!s) return NaN
  const t = new Date(s).getTime()
  return isNaN(t) ? NaN : t
}

/** อายุเป็น "วัน" นับแบบวันปฏิทิน — เข้ามาวันนี้ = 0 เมื่อวาน = 1 */
function ageDaysOf(iso?: string | null): number {
  const t = timeOf(iso)
  if (isNaN(t)) return 0
  return Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY_MS))
}

const isToday = (iso?: string | null) => {
  const t = timeOf(iso)
  return !isNaN(t) && startOfDay(t) === startOfDay(Date.now())
}

/** เวลาแบบ "เมื่อ 2 ชม.ก่อน" — ใช้กับคอลัมน์ล่าสุดเพื่อให้กวาดตาไล่ความสดของงานได้เร็ว */
function agoText(iso?: string | null): string {
  const t = timeOf(iso)
  if (isNaN(t)) return "—"
  const diff = Date.now() - t
  if (diff < 60_000) return "เมื่อสักครู่"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีก่อน`
  if (diff < DAY_MS && isToday(iso)) return `${Math.floor(diff / 3_600_000)} ชม.ก่อน`
  const days = ageDaysOf(iso)
  if (days === 1) return "เมื่อวาน"
  if (days < 8) return `${days} วันก่อน`
  return fmtDateOnly(iso)
}

// ── แปลงคำขอ → แถวรายการ ────────────────────────────────────────────────────

/**
 * วันนัดของยางเส้นนี้ — คำขอเก่าที่นัดไว้ "ระดับคำขอ" ยังใช้วันนั้นได้
 * แต่พอมีเส้นไหนในคำขอเดียวกันนัดรายเส้นแล้ว ต้องไม่ fallback อีก ไม่งั้นเส้นที่ยัง
 * ไม่ได้นัดจะขึ้นวันของคนอื่น (กติกาเดียวกับแท็บ V.1 และฝั่ง API)
 */
function apptOf(r: TireRequest, it: RequestItem): string | null {
  if (it.appointmentDate) return it.appointmentDate
  const perItem = (r.items ?? []).some((x) => x.appointmentDate)
  return perItem ? null : (r.appointmentDate ?? null)
}

function stageOf(r: TireRequest, it: RequestItem): TxStage {
  const st = it.status ?? "pending"
  if (st === "rejected") return "rejected"
  // ปิดงานรายเส้น: ล้อนี้จบแล้วแม้เส้นอื่นในใบเดียวกันจะยังค้างอยู่
  if (st === "done") return "done"
  if (st !== "approved") return "pending"
  // ใบเก่าที่ปิดทั้งใบก่อนจะมีปิดงานรายเส้น — เส้นในใบยังเป็น approved อยู่
  if ((r.status ?? "pending") === "done") return "done"
  return apptOf(r, it) ? "appointment" : "approved"
}

type LastAction = { label: string; by: string; at: string }

/** ใครทำอะไรล่าสุดกับเส้นนี้ — อ่านจากฟิลด์ที่ API เขียนไว้ ไม่ได้เดาจากสถานะเปล่า ๆ */
function lastActionOf(r: TireRequest, it: RequestItem, stage: TxStage): LastAction {
  switch (stage) {
    case "done":
      return { label: "ปิดงาน", by: it.doneBy ?? r.doneBy ?? "", at: it.doneAt ?? r.doneAt ?? "" }
    case "rejected":
      return { label: "ปฏิเสธ", by: it.rejectedBy ?? r.rejectedBy ?? "", at: it.rejectedAt ?? r.rejectedAt ?? "" }
    case "appointment":
      return { label: `นัด ${fmtDateOnly(apptOf(r, it))}`, by: it.appointmentBy ?? r.appointmentBy ?? "", at: it.appointmentAt ?? r.appointmentAt ?? "" }
    case "approved":
      return { label: "อนุมัติ", by: it.approvedBy ?? r.approvedBy ?? "", at: it.approvedAt ?? r.approvedAt ?? "" }
    default:
      return { label: "ยื่นคำขอ", by: r.requestedBy || r.driverName || "", at: it.createdAt || r.createdAt }
  }
}

type TxRow = {
  key:        string
  request:    TireRequest
  item:       RequestItem
  branch:     string
  plate:      string
  stage:      TxStage
  createdAt:  string
  ageDays:    number
  appointment: string | null
  isNew:      boolean        // เข้ามาวันนี้
  stuck:      boolean        // ยังไม่ถึงขั้นนัดหมายและค้างเกิน STUCK_DAYS วัน
  /** ตัดสินรายเส้นได้ไหม — คำขอที่เลยไปขั้นนัดหมาย/ปิดงานแล้ว ฝั่ง API ปฏิเสธ (409) */
  canDecide:  boolean
  /**
   * ติดทางตัน — เส้นนี้ยังไม่ถูกตัดสิน แต่ค้างอยู่ในใบที่นัด/ปิดไปแล้ว จึงกดอนุมัติไม่ได้
   * ทางออกเดียวคือแยกออกไปตั้งเป็นคำขอใบใหม่ (ดูปุ่มในคอลัมน์จัดการ)
   */
  blocked:    boolean
  /** จำนวนเส้นที่ติดทางตันในใบเดียวกัน — แยกออกไปพร้อมกันทีเดียวเป็นใบใหม่ใบเดียว */
  blockedWith: number
  last:       LastAction
  photos:     string[]
}

function toRows(requests: TireRequest[]): TxRow[] {
  const rows: TxRow[] = []
  for (const r of requests) {
    const reqStatus = r.status ?? "pending"
    /**
     * ใบที่ลงวันนัด/ปิดงานไปแล้ว = เส้นที่ยังไม่ถูกตัดสินในใบนี้ตัดสินไม่ได้อีก
     *
     * ต้องตรงกับกติกาฝั่ง API เป๊ะ (PATCH items ปฏิเสธเฉพาะ appointment / done) —
     * ถ้าเผื่อไว้เกิน เช่นใส่ "rejected" ลงไปด้วย จะกลายเป็นซ่อนปุ่มอนุมัติของเส้นที่
     * จริง ๆ กดได้ แล้วผู้ใช้จะเจอทางตันปลอมที่ไม่มีอยู่จริง
     */
    const reqBlocks = reqStatus === "appointment" || reqStatus === "done"
    const blockedWith = reqBlocks
      ? (r.items ?? []).filter((x) => (x.status ?? "pending") === "pending").length
      : 0

    for (const it of r.items ?? []) {
      const stage = stageOf(r, it)
      const createdAt = it.createdAt || r.createdAt
      const ageDays = ageDaysOf(createdAt)
      const appointment = apptOf(r, it)

      rows.push({
        key: `${r._id}|${it._id}`,
        request: r,
        item: it,
        branch: r.branch,
        plate: r.plate,
        stage,
        createdAt,
        ageDays,
        appointment,
        isNew: isToday(createdAt),
        stuck: (stage === "pending" || stage === "approved") && ageDays >= STUCK_DAYS,
        // สองอันนี้ต้องเป็นส่วนเติมเต็มของกันและกัน — เส้นที่รออนุมัติต้อง "กดได้" หรือ
        // "ติดทางตันแล้วมีปุ่มแยกใบ" อย่างใดอย่างหนึ่ง ห้ามหลุดไปเป็นแถวที่ขึ้น "—" เฉย ๆ
        canDecide: stage === "pending" && !reqBlocks,
        blocked:   stage === "pending" && reqBlocks,
        blockedWith: blockedWith,
        last: lastActionOf(r, it, stage),
        photos: it.photoUrls?.length ? it.photoUrls : it.photoUrl ? [it.photoUrl] : [],
      })
    }
  }
  // ใหม่สุดอยู่บน — "มีอะไรเข้ามาวันนี้" ต้องเห็นทันทีที่เปิดหน้า ไม่ต้องเรียงเอง
  return rows.sort((a, b) => (timeOf(b.createdAt) || 0) - (timeOf(a.createdAt) || 0))
}

/**
 * ติ๊กเลือกแถวนี้เพื่อทำรายการพร้อมกันได้ไหม — คืนเหตุผลถ้าไม่ได้ (แสดงเป็น tooltip)
 * ปิดไว้แค่เส้นที่ไม่มีอะไรให้ทำต่อจริง ๆ (ปฏิเสธไปแล้ว / ติดทางตัน) ส่วนเส้นที่เหลือ
 * (รออนุมัติ, อนุมัติแล้ว, นัดหมายแล้ว, ปิดงานแล้ว) เลือกได้เสมอ — แถบรวมจะโชว์เฉพาะปุ่มที่
 * ใช้ได้จริงกับกลุ่มที่เลือกไว้ (ดู canBulkApprove / canBulkReject / canBulkEditJob)
 */
function selectReason(row: TxRow): string {
  if (row.blocked) return "ติดทางตัน — ต้องแยกเป็นคำขอใหม่ก่อน"
  if (row.stage === "rejected") return "ปฏิเสธไปแล้ว — ไม่มีอะไรให้ทำต่อ"
  return ""
}

/** เกณฑ์ของแต่ละปุ่มในแถบรวม — แยกจาก selectReason() เพราะ "เลือกได้" กับ "ทำปุ่มนี้ได้" ไม่ใช่เรื่องเดียวกัน */
const canBulkApprove = (r: TxRow) => r.canDecide
/** ปฏิเสธพร้อมกันได้ทั้งเส้นที่ยังไม่ตัดสินและเส้นที่อนุมัติแล้วแต่ยังไม่ลงวันนัด (ตรงกับ reject() รายแถว) */
const canBulkReject  = (r: TxRow) => r.canDecide || r.stage === "approved"
/** ใส่/แก้เลข Job ได้ตั้งแต่อนุมัติแล้วจนถึงปิดงานแล้ว (ตรงกับเงื่อนไข action "editJob" ฝั่ง API) */
const canBulkEditJob = (r: TxRow) => {
  const st = r.item.status ?? "pending"
  return st === "approved" || st === "done"
}
/** ปิดงานได้เฉพาะเส้นที่นัดหมายแล้ว (stage "appointment" = อนุมัติแล้ว + มีวันนัด ตรงกับเงื่อนไข action "done") */
const canBulkMarkDone = (r: TxRow) => r.stage === "appointment"

const matchesQuery = (row: TxRow, q: string) => {
  if (!q) return true
  const hay = [
    row.plate, row.request.truckNumber, row.request.driverName, row.request.requestedBy,
    row.item.positionCode, row.item.positionName, row.item.serialNo, row.item.product,
    row.item.reason, row.item.jobNo, row.item.note,
  ].join(" ").toLowerCase()
  return hay.includes(q.trim().toLowerCase())
}

// ── เรียง / กรอง รายคอลัมน์ (แบบ Excel) ─────────────────────────────────────

type SortKey = "age" | "plate" | "truck" | "position" | "reason" | "tread" | "stage" | "last"
type SortDir = "asc" | "desc"
type SortState = { key: SortKey; dir: SortDir } | null

/** เบอร์รถที่ยังไม่กรอก ต้องไปกองท้ายสุดเสมอ ไม่ว่าจะเรียงขึ้นหรือลง */
const NO_TRUCK_SORT = "￿"

function truckSortValue(no?: string) {
  const t = (no ?? "").trim()
  if (!t) return NO_TRUCK_SORT
  return /^\d+$/.test(t) ? t.padStart(10, "0") : t
}

/** ค่าที่ใช้เทียบเวลาเรียง — ตัวเลขเทียบด้วยตัวเลข ข้อความเทียบตามลำดับพจนานุกรมไทย */
const SORT_VALUE: Record<SortKey, (r: TxRow) => number | string> = {
  age:      (r) => r.ageDays,
  plate:    (r) => r.plate || "",
  // เบอร์รถส่วนใหญ่เป็นตัวเลขล้วน — เทียบดิบ ๆ แบบข้อความจะได้ 10 มาก่อน 9
  // เติมศูนย์หน้าให้ยาวเท่ากันก่อนเทียบ ส่วนเบอร์ที่มีตัวอักษรปนก็ยังเรียงตามพจนานุกรมได้
  truck:    (r) => truckSortValue(r.request.truckNumber),
  position: (r) => r.item.positionCode || r.item.positionName || "",
  reason:   (r) => r.item.reason || "",
  tread:    (r) => r.item.currentTreadMm || 0,
  stage:    (r) => STAGE_STEP[r.stage],
  last:     (r) => timeOf(r.last.at) || 0,
}

type FacetKey = "plate" | "truck" | "position" | "reason" | "stage"

const FACET_KEYS = ["plate", "truck", "position", "reason", "stage"] as const

/**
 * ค่าที่โผล่ในรายการติ๊กของแต่ละคอลัมน์ — ต้องเป็น "ข้อความเดียวกับที่เห็นในเซลล์"
 * ไม่ใช่ค่าดิบในฐานข้อมูล ไม่งั้นผู้ใช้ติ๊กแล้วหาไม่เจอว่าตรงกับแถวไหน
 */
const FACET_VALUE: Record<FacetKey, (r: TxRow) => string> = {
  plate:    (r) => r.plate || "—",
  truck:    (r) => (r.request.truckNumber || "").trim() || "ไม่ระบุเบอร์รถ",
  position: (r) => r.item.positionName || r.item.positionCode || "ไม่ระบุตำแหน่ง",
  reason:   (r) => r.item.reason || "ไม่ระบุสาเหตุ",
  stage:    (r) => STATUS_LABEL[r.stage] ?? r.stage,
}

type FacetState = Record<FacetKey, string[]>
type FacetOption = { value: string; count: number }

/** ค่าเริ่มต้น: ไม่ติ๊กอะไรเลย = ไม่กรอง (ไม่ใช่ติ๊กครบแบบ Excel — ไม่ต้องมาไล่เอาติ๊กออก) */
const NO_FACETS: FacetState = { plate: [], truck: [], position: [], reason: [], stage: [] }

const hasFacet = (f: FacetState) => FACET_KEYS.some((k) => f[k].length > 0)

/** ผ่านตัวกรองรายคอลัมน์ไหม — ข้ามคอลัมน์ที่ยังไม่ติ๊ก (ติ๊กว่าง = เอาหมด) */
function passFacets(row: TxRow, f: FacetState, skip?: FacetKey) {
  for (const k of FACET_KEYS) {
    if (k === skip || f[k].length === 0) continue
    if (!f[k].includes(FACET_VALUE[k](row))) return false
  }
  return true
}

/** บริบทที่หัวคอลัมน์ทุกช่องใช้ร่วมกัน — ส่งเป็นก้อนเดียวจะได้ไม่ต้องไล่ prop ทีละตัว 8 ครั้ง */
type HeadCtx = {
  sort:    SortState
  onSort:  (key: SortKey, dir: SortDir | null) => void
  facets:  FacetState
  options: Record<FacetKey, FacetOption[]>
  onPick:  (key: FacetKey, values: string[]) => void
}

// ===========================================================================
// ตัวหน้า
// ===========================================================================

// ── หน้าตาไฟล์ Excel ที่ส่งออก ───────────────────────────────────────────────
// เรียงคอลัมน์ตามลำดับที่คนไล่อ่านจริงบนหน้าเว็บ แล้วรวบเป็นกลุ่ม: ใบนี้เก่าแค่ไหน →
// ของรถคันไหน → ยางเส้นไหน → สภาพเป็นยังไง → ตอนนี้ถึงไหนแล้ว
// 5 คอลัมน์แรกถูกตรึงไว้ (freezeCols) — เลื่อนไปขวาสุดก็ยังรู้ว่าแถวนี้ของรถคันไหน

const TX_EXPORT_COLS: ExcelCol[] = [
  { key: "age",         header: "อายุ\n(วัน)",          width: 8,  group: "คำขอ", align: "center", numFmt: "0" },
  { key: "createdAt",   header: "วันที่แจ้ง",             width: 12, group: "คำขอ", align: "center", numFmt: XLS_DATE_FMT },
  { key: "branch",      header: "สาขา",                 width: 11, group: "คำขอ", align: "center" },

  { key: "plate",       header: "ทะเบียน",               width: 13, group: "รถ / ผู้แจ้ง" },
  { key: "truck",       header: "เบอร์รถ",               width: 10, group: "รถ / ผู้แจ้ง", align: "center" },
  { key: "driver",      header: "คนขับ",                 width: 19, group: "รถ / ผู้แจ้ง" },
  { key: "requestedBy", header: "ผู้แจ้ง",                width: 19, group: "รถ / ผู้แจ้ง" },

  { key: "pos",         header: "ตำแหน่ง",               width: 10, group: "ยางที่ขอเปลี่ยน", align: "center" },
  { key: "posName",     header: "ชื่อตำแหน่ง",            width: 16, group: "ยางที่ขอเปลี่ยน" },
  { key: "reason",      header: "สาเหตุ",                width: 15, group: "ยางที่ขอเปลี่ยน" },
  { key: "serial",      header: "Serial",               width: 16, group: "ยางที่ขอเปลี่ยน" },
  { key: "product",     header: "รุ่นยาง",                width: 20, group: "ยางที่ขอเปลี่ยน" },
  { key: "job",         header: "ใบแจ้งซ่อม\nATMS",      width: 16, group: "ยางที่ขอเปลี่ยน", align: "center" },

  { key: "tread",       header: "มิลยาง\n(มม.)",         width: 10, group: "สภาพยาง / ระยะทาง", align: "right", numFmt: "0.0" },
  { key: "pct",         header: "คงเหลือ\n(%)",          width: 10, group: "สภาพยาง / ระยะทาง", align: "right", numFmt: "0" },
  { key: "odo",         header: "ไมล์ตอนขอ\n(กม.)",      width: 14, group: "สภาพยาง / ระยะทาง", align: "right", numFmt: "#,##0" },
  { key: "mileStart",   header: "ไมล์ตอนใส่ยาง\n(กม.)",   width: 15, group: "สภาพยาง / ระยะทาง", align: "right", numFmt: "#,##0" },
  { key: "used",        header: "ระยะใช้งาน\n(กม.)",      width: 14, group: "สภาพยาง / ระยะทาง", align: "right", numFmt: "#,##0" },

  { key: "status",      header: "สถานะ",                width: 13, group: "ตอนนี้ถึงไหนแล้ว", align: "center" },
  { key: "stuck",       header: "งานค้าง",               width: 13, group: "ตอนนี้ถึงไหนแล้ว", align: "center" },
  { key: "blocked",     header: "ทำต่อไม่ได้",            width: 12, group: "ตอนนี้ถึงไหนแล้ว", align: "center" },
  { key: "appt",        header: "วันนัดหมาย",             width: 12, group: "ตอนนี้ถึงไหนแล้ว", align: "center", numFmt: XLS_DATE_FMT },
  { key: "last",        header: "ความเคลื่อนไหว\nล่าสุด",  width: 16, group: "ตอนนี้ถึงไหนแล้ว" },
  { key: "lastAt",      header: "เมื่อ",                  width: 16, group: "ตอนนี้ถึงไหนแล้ว", align: "center", numFmt: XLS_DATETIME_FMT },
  { key: "lastBy",      header: "โดย",                   width: 18, group: "ตอนนี้ถึงไหนแล้ว" },
  { key: "photos",      header: "รูป",                   width: 7,  group: "ตอนนี้ถึงไหนแล้ว", align: "center", numFmt: "0" },
  { key: "note",        header: "หมายเหตุ",              width: 34, group: "ตอนนี้ถึงไหนแล้ว", wrap: true },
]

/** สีตัวอักษรช่องสถานะในไฟล์ — โทนเดียวกับชิปบนหน้าเว็บ อ่านไฟล์แล้วนึกภาพหน้าจอออก */
const STAGE_INK: Record<TxStage, string> = {
  pending:     "FFB45309",
  approved:    "FF1D4ED8",
  appointment: "FF7E22CE",
  done:        "FF15803D",
  rejected:    "FFB91C1C",
}

/** ชื่อคอลัมน์ที่เอาไปเขียนสรุปตัวกรองในไฟล์ */
const FACET_LABEL: Record<FacetKey, string> = {
  plate: "ทะเบียน", truck: "เบอร์รถ", position: "ตำแหน่ง", reason: "สาเหตุ", stage: "สถานะ",
}

/** คีย์ของ MR ในหน่วยความจำ — ทะเบียนเดียวกันอยู่คนละสาขาได้ ต้องแยกใบกัน */
const mrKey = (branch: string, plate: string) => `${branch}|${plate}`

export function TireTransactionTracking({ branchFilter, onChanged }: {
  branchFilter: string
  onChanged: () => void
}) {
  const [requests, setRequests] = useState<TireRequest[]>([])
  const [serverTotal, setServerTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  const [q, setQ] = useState("")
  const [stage, setStage] = useState<TxStage | "all">("all")
  const [stuckOnly, setStuckOnly] = useState(false)
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0])
  const [page, setPage] = useState(1)

  // เรียง/กรองจากหัวคอลัมน์ — เริ่มต้นไม่เรียง (ใหม่สุดอยู่บน) และไม่ติ๊กค่าใดเลย
  const [sort, setSort] = useState<SortState>(null)
  const [facets, setFacets] = useState<FacetState>(NO_FACETS)

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [appointTarget, setAppointTarget] = useState<{ row: TxRow } | null>(null)
  const [exporting, setExporting] = useState(false)

  // ติ๊กเลือกหลายแถวเพื่อทำรายการพร้อมกัน — คีย์เดียวกับ row.key (คงอยู่ข้ามหน้าได้)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // MR ของยางสาเหตุ "รถกินยาง" — key = "สาขา|ทะเบียน" (ทะเบียนซ้ำข้ามสาขาได้)
  // undefined = ยังไม่ได้เช็ค, null = ยังไม่มีใบ
  const [mrMap, setMrMap] = useState<Record<string, MrSummary | null>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      branchesFor(branchFilter).map((b) => {
        const qs = new URLSearchParams({ branch: b, limit: String(FETCH_LIMIT) })
        return fetch(`/api/tire-change-request?${qs}`)
          .then((res) => res.json())
          .then((d) => ({
            items: (Array.isArray(d.items) ? d.items : []) as TireRequest[],
            total: Number(d.total) || 0,
          }))
          .catch(() => ({ items: [] as TireRequest[], total: 0 }))
      })
    )
    setRequests(results.flatMap((r) => r.items))
    setServerTotal(results.reduce((a, r) => a + r.total, 0))
    setLoading(false)
  }, [branchFilter])

  useEffect(() => { load() }, [load])

  const allRows = useMemo(() => toRows(requests), [requests])

  /** ชุดที่ตัวเลขทุกตัวบนหน้านับจาก — คำค้นมีผลกับเลขด้วย เลขบนชิปจึงตรงกับที่กดแล้วเห็น */
  const searched = useMemo(() => allRows.filter((r) => matchesQuery(r, q)), [allRows, q])

  const stageCounts = useMemo(() => {
    const by: Partial<Record<TxStage, number>> = {}
    for (const r of searched) by[r.stage] = (by[r.stage] ?? 0) + 1
    return by
  }, [searched])

  const stuckCount = useMemo(() => searched.filter((r) => r.stuck).length, [searched])
  // ทางตันเป็นบั๊กที่ควรหายไป ไม่ใช่หมวดงานประจำ — ชิปจึงโผล่เฉพาะตอนมีของจริงค้างอยู่
  const blockedCount = useMemo(() => searched.filter((r) => r.blocked).length, [searched])

  /** ผ่านชิปด้านบนแล้ว — ฐานร่วมของทั้งตัวกรองรายคอลัมน์และรายการค่าที่ให้ติ๊ก */
  const chipped = useMemo(() => searched.filter((r) => {
    if (stage !== "all" && r.stage !== stage) return false
    if (stuckOnly && !r.stuck) return false
    if (blockedOnly && !r.blocked) return false
    return true
  }), [searched, stage, stuckOnly, blockedOnly])

  /**
   * ค่าที่ให้ติ๊กในแต่ละคอลัมน์ + จำนวนแถวของค่านั้น
   * นับจากของที่เหลือ "หลังกรองคอลัมน์อื่นแล้ว" แต่ไม่นับตัวเอง (กติกาเดียวกับ Excel) —
   * ค่าที่ติ๊กไว้จึงไม่หายไปจากรายการหลังกดติ๊ก และเลขข้างค่าคือจำนวนที่จะได้จริงถ้าติ๊กเพิ่ม
   */
  const facetOptions = useMemo(() => {
    const out = {} as Record<FacetKey, FacetOption[]>
    for (const k of FACET_KEYS) {
      const tally = new Map<string, number>()
      for (const r of chipped) {
        if (!passFacets(r, facets, k)) continue
        const v = FACET_VALUE[k](r)
        tally.set(v, (tally.get(v) ?? 0) + 1)
      }
      out[k] = [...tally]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "th"))
    }
    return out
  }, [chipped, facets])

  const rows = useMemo(() => {
    const kept = chipped.filter((r) => passFacets(r, facets))
    if (!sort) return kept
    const valueOf = SORT_VALUE[sort.key]
    const sign = sort.dir === "asc" ? 1 : -1
    // sort ของ JS เสถียร — แถวที่ค่าเท่ากันจึงยังเรียงใหม่สุดอยู่บนตามลำดับเดิม
    return [...kept].sort((a, b) => {
      const x = valueOf(a), y = valueOf(b)
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "th")
      return cmp * sign
    })
  }, [chipped, facets, sort])

  const headCtx: HeadCtx = {
    sort,
    facets,
    options: facetOptions,
    onSort: (key, dir) => setSort(dir ? { key, dir } : null),
    onPick: (key, values) => setFacets((f) => ({ ...f, [key]: values })),
  }

  /* ---------------------------------------------------------------- แบ่งหน้า */

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage))
  // หน้าปัจจุบันคำนวณจาก state — ถ้าจำนวนแถวหดจนหน้าเดิมหายไป จะได้ไม่ค้างอยู่หน้าว่าง
  const current = Math.min(page, pageCount)
  const sliceFrom = (current - 1) * perPage
  const pageRows = rows.slice(sliceFrom, sliceFrom + perPage)

  /* ------------------------------------------------------------- ติ๊กเลือกหลายแถว */

  // แถวที่เลือกไว้ — อิงจาก rows (ทุกหน้าที่กรอง/เรียงอยู่ตอนนี้) การเลือกจึงข้ามหน้าได้
  // คีย์ที่หายไปจากชุดข้อมูล (โหลดใหม่/แยกใบ) จะไม่ถูกกรองเข้ามาที่นี่เอง ไม่ต้องคอยเก็บกวาด selected เอง
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected])

  // แบ่งกลุ่มที่เลือกไว้ตามปุ่มที่ทำได้จริง — ใช้ทั้งโชว์/ซ่อนปุ่มและเป็นชุดที่ยิงจริงตอนกด
  const approveTargets = useMemo(() => selectedRows.filter(canBulkApprove), [selectedRows])
  const rejectTargets  = useMemo(() => selectedRows.filter(canBulkReject), [selectedRows])
  const editJobTargets = useMemo(() => selectedRows.filter(canBulkEditJob), [selectedRows])
  const doneTargets    = useMemo(() => selectedRows.filter(canBulkMarkDone), [selectedRows])

  const toggleSelect = (key: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // "เลือกทั้งหมด" หมายถึงทุกแถวที่เลือกได้ในหน้าปัจจุบัน ไม่ใช่ทุกแถวที่กรองอยู่ — ตรงกับที่ตาเห็น
  const pageSelectableKeys = pageRows.filter((r) => !selectReason(r)).map((r) => r.key)
  const allPageSelected = pageSelectableKeys.length > 0 && pageSelectableKeys.every((k) => selected.has(k))
  const somePageSelected = pageSelectableKeys.some((k) => selected.has(k))
  const toggleAllPage = () => setSelected((prev) => {
    const next = new Set(prev)
    const allOn = pageSelectableKeys.length > 0 && pageSelectableKeys.every((k) => next.has(k))
    pageSelectableKeys.forEach((k) => (allOn ? next.delete(k) : next.add(k)))
    return next
  })

  /**
   * โหลดสถานะ MR ของแถว "รถกินยาง" ที่อยู่ในหน้าปัจจุบัน — ยิงรวมทีเดียวต่อสาขา
   * (ไม่ใช่รายแถว) และข้ามทะเบียนที่รู้แล้ว หน้าหนึ่งจึงเพิ่มไม่เกิน 1–2 request
   */
  // คิดรายชื่อที่ "ยังไม่รู้สถานะ" ตอน render — พอโหลดเสร็จคีย์นี้กลายเป็นว่าง effect จึงไม่วนซ้ำ
  const mrMissingKey = [...new Set(
    pageRows
      .filter((r) => r.item.reason === "รถกินยาง")
      .map((r) => mrKey(r.branch, r.plate))
      .filter((k) => !(k in mrMap))
  )].sort().join(",")

  useEffect(() => {
    if (!mrMissingKey) return
    const missing = new Map<string, Set<string>>()   // สาขา → ทะเบียนที่ยังไม่รู้สถานะ
    for (const k of mrMissingKey.split(",")) {
      const [branch, plate] = k.split("|")
      if (!missing.has(branch)) missing.set(branch, new Set())
      missing.get(branch)!.add(plate)
    }

    let cancelled = false
    Promise.all([...missing].map(([branch, plates]) =>
      fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(branch)}&plates=${encodeURIComponent([...plates].join(","))}`)
        .then((r) => r.json())
        .then((d: Record<string, MrSummary>) => ({ branch, plates: [...plates], data: d }))
        .catch(() => ({ branch, plates: [...plates], data: {} as Record<string, MrSummary> }))
    )).then((results) => {
      if (cancelled) return
      setMrMap((prev) => {
        const next = { ...prev }
        for (const { branch, plates, data } of results) {
          for (const p of plates) next[mrKey(branch, p)] = data[p] ?? null
        }
        return next
      })
    })
    return () => { cancelled = true }
  }, [mrMissingKey])

  // เปลี่ยนตัวกรองแล้วกลับหน้า 1 — ปรับ state ตอน render (กฎ react-hooks ห้ามย้ายไปไว้ใน effect)
  // การเรียงไม่นับ: จำนวนแถวเท่าเดิม อยู่หน้าไหนก็ยังมีของ ไม่ต้องเด้งกลับหน้าแรก
  const facetKey = FACET_KEYS.map((k) => k + ":" + facets[k].join(",")).join(";")
  const filterKey = `${q}|${stage}|${stuckOnly}|${blockedOnly}|${perPage}|${facetKey}`
  const [lastKey, setLastKey] = useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setPage(1)
  }

  /* ------------------------------------------------------------- ส่งออก Excel */

  /** บรรทัดใต้หัวเรื่องในไฟล์ — คนเปิดไฟล์ทีหลังต้องรู้ว่าเลขชุดนี้กรองอะไรมา ไม่ใช่ยอดทั้งคลัง */
  function filterSummary() {
    const parts: string[] = []
    if (q) parts.push(`ค้นหา “${q}”`)
    if (stage !== "all") parts.push(`สถานะ ${STAGE_CHIPS.find((c) => c.value === stage)?.label ?? stage}`)
    if (stuckOnly) parts.push(`เฉพาะค้างเกิน ${STUCK_DAYS} วัน`)
    if (blockedOnly) parts.push("เฉพาะที่ทำต่อไม่ได้")
    for (const k of FACET_KEYS) {
      const picked = facets[k]
      if (!picked.length) continue
      parts.push(`${FACET_LABEL[k]}: ${picked.slice(0, 3).join(", ")}${picked.length > 3 ? ` +${picked.length - 3}` : ""}`)
    }
    return parts.length ? `กรอง: ${parts.join(" · ")}` : "ไม่ได้กรอง — ทุกรายการที่โหลดมา"
  }

  /**
   * ส่งออก "ทุกแถวที่กรอง/เรียงอยู่ตอนนี้" ไม่ใช่แค่หน้าที่เปิดอยู่ —
   * คนกดปุ่มนี้หลังคัดของเสร็จแล้ว ถ้าได้แค่ 20 แถวของหน้าปัจจุบันจะเป็นกับดักเงียบ ๆ
   */
  async function exportExcel() {
    if (exporting || rows.length === 0) return
    setExporting(true)
    try {
      const scope = branchFilter ? branchLabel(branchFilter) : "ทุกสาขา"
      // ลิงก์ใบแจ้งซ่อมต้องเป็น URL เต็ม — ไฟล์ถูกเปิดนอกเว็บ พาธสั้น ๆ จะกดไม่ติด
      const origin = typeof window === "undefined" ? "" : window.location.origin

      await downloadExcelTable({
        fileName: `คำขอเปลี่ยนยาง_${scope}_${bkkToday()}.xlsx`,
        sheetName: "คำขอเปลี่ยนยาง",
        title: `คำขอเปลี่ยนยาง — ${scope}`,
        subtitle: `ส่งออก ${fmtNum(rows.length)} รายการ · ${filterSummary()} · เมื่อ ${fmtDate(new Date().toISOString())} โดยระบบ MENA WMS`,
        freezeCols: 5,
        columns: TX_EXPORT_COLS,
        rows: rows.map((r) => ({
          // ติดทางตันมาก่อนงานค้าง — เป็นปัญหาที่ต้องแก้ที่ใบคำขอ ไม่ใช่แค่เตือนว่านาน
          tone: r.blocked ? "warn" : r.stuck ? "danger" : undefined,
          ink: { status: STAGE_INK[r.stage] },
          cells: {
            age:        r.ageDays,
            createdAt:  xlsDate(r.createdAt),
            branch:     branchLabel(r.branch),
            plate:      r.plate,
            truck:      r.request.truckNumber || "",
            driver:     r.request.driverName || "",
            requestedBy: r.request.requestedBy || "",
            pos:        r.item.positionCode || "",
            posName:    r.item.positionName || "",
            reason:     r.item.reason || "",
            serial:     r.item.serialNo || "",
            product:    r.item.product || "",
            job: r.item.jobNo
              ? { text: r.item.jobNo, hyperlink: `${origin}/api/atms/maintenance-request/by-code/${encodeURIComponent(r.item.jobNo)}?go=1` }
              : "",
            // ค่าที่ยังไม่ได้บันทึกปล่อยว่าง ไม่ใส่ 0 — เลข 0 ในไฟล์จะถูกเอาไปเฉลี่ยผิด
            tread:      r.item.currentTreadMm || "",
            pct:        r.item.remainingPct ?? "",
            odo:        r.request.currentOdometer || "",
            mileStart:  r.item.mileageStart || "",
            used:       r.item.usedDistance || "",
            status:     STATUS_LABEL[r.stage] ?? r.stage,
            stuck:      r.stuck ? `ค้าง ${r.ageDays} วัน` : "",
            blocked:    r.blocked ? "ติดทางตัน" : "",
            appt:       xlsDate(r.appointment),
            last:       r.last.label,
            lastAt:     xlsDate(r.last.at, true),
            lastBy:     r.last.by || "",
            photos:     r.photos.length || "",
            note:       r.item.note || "",
          },
        })),
      })
      swalToast("success", `ส่งออก ${fmtNum(rows.length)} รายการแล้ว`)
    } catch {
      swalError("ส่งออกไม่สำเร็จ — ลองใหม่อีกครั้ง")
    } finally {
      setExporting(false)
    }
  }

  const filtered = Boolean(q) || stage !== "all" || stuckOnly || blockedOnly || hasFacet(facets)
  /** ล้างทีเดียวจบ — รวมตัวกรองหัวคอลัมน์กับการเรียงด้วย ไม่ให้เหลืออะไรซ่อนอยู่ */
  function clearFilters() {
    setQ(""); setStage("all"); setStuckOnly(false); setBlockedOnly(false)
    setFacets(NO_FACETS); setSort(null)
  }

  const openRow = openKey ? rows.find((r) => r.key === openKey) ?? allRows.find((r) => r.key === openKey) ?? null : null

  /* ------------------------------------------------------------ การกระทำ */

  async function itemPatch(row: TxRow, body: Record<string, unknown>, msg: string) {
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${row.request._id}/items/${row.item._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "ดำเนินการไม่สำเร็จ"); return }
    swalToast("success", msg)
    load(); onChanged()
  }

  const tireLabel = (row: TxRow) =>
    `${row.item.positionCode} ${row.item.positionName}${row.item.serialNo ? ` · ${row.item.serialNo}` : ""}`

  /** ดึงสถานะ MR ล่าสุดของทะเบียนหนึ่ง แล้วเก็บลง cache ให้ชิปในตารางอัปเดตตาม */
  async function reloadMr(branch: string, plate: string): Promise<MrSummary | null> {
    const mr: MrSummary | null = await fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(branch)}&plates=${encodeURIComponent(plate)}`)
      .then((r) => r.json()).then((d) => d[plate] ?? null).catch(() => null)
    setMrMap((prev) => ({ ...prev, [mrKey(branch, plate)]: mr }))
    return mr
  }

  /**
   * สร้าง MR / เดินสถานะถัดไป — ปุ่มเดียวทำทั้งสามขั้น เพราะขั้นถัดไปมีทางเดียวเสมอ
   * (ยังไม่มีใบ → สร้าง, รอดำเนินการ → เริ่มซ่อม, กำลังซ่อม → ปิดใบ)
   */
  async function mrAdvance(row: TxRow) {
    const key  = mrKey(row.branch, row.plate)
    const mr   = mrMap[key]
    const next = mr ? MR_NEXT[mr.status as MrStatus] : null
    if (mr && !next) return   // ปิดไปแล้ว ไม่มีอะไรให้กดต่อ

    const creating = !mr
    const { value, isConfirmed } = await Swal.fire<string>({
      title: creating ? "โน๊ต MR" : next === "in_progress" ? "เริ่มดำเนินการซ่อม" : "ปิด MR — ซ่อมเสร็จแล้ว",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">ทะเบียน <b>${row.plate}</b> · สาเหตุ <b>รถกินยาง</b>`
        + (creating ? "" : `<br>${MR_LABEL[mr!.status as MrStatus] ?? mr!.status} → <b>${MR_LABEL[next!]}</b>`)
        + `</div>`,
      input: "textarea",
      inputLabel: "หมายเหตุ (ไม่บังคับ)",
      inputAttributes: { rows: "3", placeholder: creating ? "ระบุอาการ / สิ่งที่ต้องซ่อม..." : next === "completed" ? "สรุปงานที่ซ่อม..." : "รายละเอียดการซ่อม / ผู้รับผิดชอบ..." },
      showCancelButton: true,
      confirmButtonText: creating ? "โน๊ต MR" : "ยืนยัน",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return

    setActing(true)
    const res = creating
      ? await fetch("/api/tire-mr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: row.branch, plate: row.plate, requestId: row.request._id, note: value ?? "" }),
        })
      : await fetch(`/api/tire-mr/${mr!.mrId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next, note: value ?? "" }),
        })
    setActing(false)

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      swalError(data.error ?? (creating ? "สร้าง MR ไม่สำเร็จ" : "อัปเดตไม่สำเร็จ"))
      if (res.status === 409) reloadMr(row.branch, row.plate)   // ชนกับคนอื่น — ดึงสถานะจริงมาแสดง
      return
    }
    await reloadMr(row.branch, row.plate)
    swalToast("success", creating ? "สร้าง MR แล้ว" : `อัปเดต MR เป็น "${MR_LABEL[next!]}" แล้ว`)
  }

  /**
   * อนุมัติ — ยางที่สาเหตุ "รถกินยาง" ต้องปิด MR ก่อน (กติกาเดียวกับหน้ารายละเอียดรถ)
   * เช็คสถานะสด ๆ ตอนกดเสมอ ไม่เชื่อ cache ในหน้า เพราะอีกคนอาจเพิ่งปิด/เปิดใบไป
   */
  async function approve(row: TxRow) {
    if (row.item.reason === "รถกินยาง") {
      const mr = await reloadMr(row.branch, row.plate)
      if (!mr || mr.status !== "completed") {
        await Swal.fire({
          icon: "warning",
          title: "รอ MR ซ่อมเสร็จก่อน",
          html: `ยางเส้นนี้สาเหตุ <b>รถกินยาง</b><br>ต้องปิด MR ก่อนจึงจะอนุมัติได้`
            + `<br><br>สถานะ MR ปัจจุบัน: <b>${mr ? MR_LABEL[mr.status as MrStatus] ?? mr.status : "ยังไม่มี MR"}</b>`
            + `<br><span style="font-size:0.8rem;opacity:0.7">กดปุ่ม MR ในคอลัมน์ "สาเหตุ" หรือเปิดรายละเอียดแถวนี้เพื่อจัดการ</span>`,
          confirmButtonText: "รับทราบ",
        })
        return
      }
    }
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "อนุมัติยางเส้นนี้?",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${row.plate} · ${row.request.driverName}<br>${tireLabel(row)}</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "อนุมัติ",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    itemPatch(row, { action: "approve", jobNo: String(jobNo).trim() }, `อนุมัติ ${row.item.positionCode || row.item.serialNo} แล้ว`)
  }

  /** ปฏิเสธ — ใช้ได้ทั้งเส้นที่ยังไม่ตัดสิน และเส้นที่อนุมัติแล้วแต่เปลี่ยนใจ (ดู route.ts)
   *  ไม่ใช้กับเส้นที่ลงวันนัดแล้ว — พ้นขั้นนัดหมายไปแล้วให้ปิดงานหรือแก้ไขนัดแทน ไม่ใช่ยกเลิกทั้งเส้น */
  async function reject(row: TxRow) {
    const wasApproved = row.stage === "approved"
    const { value, isConfirmed } = await Swal.fire<string>({
      title: wasApproved ? "ยกเลิกการอนุมัติยางเส้นนี้?" : "ปฏิเสธยางเส้นนี้?",
      html: `<code style="font-size:0.8rem;opacity:0.65">${tireLabel(row)}</code>`
        + (wasApproved
          ? `<div style="font-size:0.8rem;margin-top:6px;opacity:0.75">เส้นนี้อนุมัติไปแล้ว — ยกเลิกจะเปลี่ยนเป็น "ปฏิเสธ"</div>`
          : ""),
      input: "textarea",
      inputLabel: wasApproved ? "เหตุผลที่ยกเลิก (ไม่บังคับ)" : "เหตุผลการปฏิเสธ (ไม่บังคับ)",
      inputAttributes: { rows: "3" },
      showCancelButton: true,
      confirmButtonText: wasApproved ? "ยืนยันยกเลิกอนุมัติ" : "ยืนยันปฏิเสธ",
      confirmButtonColor: "#dc2626",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    itemPatch(
      row,
      { action: "reject", reason: value ?? "" },
      wasApproved
        ? `ยกเลิกอนุมัติ ${row.item.positionCode || row.item.serialNo} แล้ว`
        : `ปฏิเสธ ${row.item.positionCode || row.item.serialNo} แล้ว`,
    )
  }

  /**
   * ทำรายการหลายแถวพร้อมกัน — ยิงทีละใบผ่าน endpoint เดิม (ไม่เพิ่ม endpoint ใหม่)
   * ทำทีละใบไม่ใช่ Promise.all เพื่อให้ใบที่พลาดไม่ลากใบอื่นในชุดล้มตาม และรู้ได้ว่าสำเร็จกี่ใบ
   */
  async function runBulk(targets: TxRow[], body: Record<string, unknown>, verb: string) {
    setActing(true)
    const failed: string[] = []
    for (const row of targets) {
      const ok = await fetch(`/api/tire-change-request/${row.request._id}/items/${row.item._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((res) => res.ok).catch(() => false)
      if (!ok) failed.push(row.item.positionCode || row.item.serialNo || row.plate)
    }
    setActing(false)
    setSelected(new Set())
    const okCount = targets.length - failed.length
    if (failed.length === 0) {
      swalToast("success", `${verb} ${okCount} รายการแล้ว`)
    } else if (okCount > 0) {
      swalError(`${verb}สำเร็จ ${okCount} จาก ${targets.length} รายการ — ไม่สำเร็จ: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`)
    } else {
      swalError(`${verb}ไม่สำเร็จทั้งหมด`)
    }
    load(); onChanged()
  }

  /** อนุมัติหลายเส้นพร้อมกัน — ใช้เลข Job เดียวกันทุกเส้น, เส้น "รถกินยาง" ที่ยังไม่ปิด MR ถูกข้าม */
  async function bulkApprove() {
    const targets = approveTargets
    if (!targets.length) return

    const checks = await Promise.all(targets.map(async (row) => {
      if (row.item.reason !== "รถกินยาง") return { row, ok: true }
      const mr = await reloadMr(row.branch, row.plate)
      return { row, ok: !!mr && mr.status === "completed" }
    }))
    const ready = checks.filter((c) => c.ok).map((c) => c.row)
    const skipped = checks.length - ready.length

    if (!ready.length) {
      swalError(`ยางที่เลือกทั้งหมดติดเงื่อนไข MR "รถกินยาง" — ต้องปิด MR ก่อนจึงจะอนุมัติได้`)
      return
    }

    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: `อนุมัติ ${ready.length} รายการที่เลือก?`,
      html:
        (skipped ? `<div style="font-size:0.8rem;color:#dc2626;margin-bottom:6px">ข้าม ${skipped} รายการที่ยังไม่ปิด MR (รถกินยาง)</div>` : "")
        + `<div style="font-size:0.82rem;opacity:0.75">ใช้เลข Job เดียวกันทุกรายการที่เลือก</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "อนุมัติทั้งหมด",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    await runBulk(ready, { action: "approve", jobNo: String(jobNo).trim() }, "อนุมัติ")
  }

  /** ปฏิเสธ/ยกเลิกอนุมัติหลายเส้นพร้อมกัน — ใช้เหตุผลเดียวกันทุกเส้น (route.ts รองรับทั้งเส้น pending และ approved) */
  async function bulkReject() {
    const targets = rejectTargets
    if (!targets.length) return
    const anyApproved = targets.some((r) => r.stage === "approved")

    const { value, isConfirmed } = await Swal.fire<string>({
      title: `${anyApproved ? "ปฏิเสธ / ยกเลิกอนุมัติ" : "ปฏิเสธ"} ${targets.length} รายการที่เลือก?`,
      html: anyApproved
        ? `<div style="font-size:0.8rem;opacity:0.75">มีบางรายการที่อนุมัติไปแล้ว — จะเปลี่ยนเป็น "ปฏิเสธ"</div>`
        : "",
      input: "textarea",
      inputLabel: "เหตุผล (ไม่บังคับ, ใช้เหตุผลเดียวกันทุกรายการ)",
      inputAttributes: { rows: "3" },
      showCancelButton: true,
      confirmButtonText: "ยืนยัน",
      confirmButtonColor: "#dc2626",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    await runBulk(targets, { action: "reject", reason: value ?? "" }, "ปฏิเสธ")
  }

  /**
   * ใส่/แก้ไขเลข Job หลายเส้นพร้อมกัน — ใช้เลขเดียวกันทุกเส้นที่เลือก
   * เขียนทับเลขเดิมของเส้นที่มีอยู่แล้วด้วย (นี่คือ "แก้ไข" ไม่ใช่แค่ "เติมช่องว่าง")
   */
  async function bulkEditJob() {
    const targets = editJobTargets
    if (!targets.length) return
    const existing = targets.filter((r) => r.item.jobNo).length

    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: `ระบุเลข Job ${targets.length} รายการที่เลือก?`,
      html:
        (existing ? `<div style="font-size:0.8rem;color:#dc2626;margin-bottom:6px">${existing} รายการมีเลข Job อยู่แล้ว — จะถูกเขียนทับด้วยเลขใหม่</div>` : "")
        + `<div style="font-size:0.82rem;opacity:0.75">ใช้เลข Job เดียวกันทุกรายการที่เลือก</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "บันทึกทั้งหมด",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    await runBulk(targets, { action: "editJob", jobNo: String(jobNo).trim() }, "อัปเดตเลข Job")
  }

  /** ปิดงานหลายเส้นพร้อมกัน — ใช้ได้เฉพาะเส้นที่นัดหมายแล้ว (ดู canBulkMarkDone) */
  async function bulkMarkDone() {
    const targets = doneTargets
    if (!targets.length) return
    const result = await swalConfirm(
      `ปิดงาน ${targets.length} รายการที่เลือก?`,
      "ยืนยันว่าเปลี่ยนยางตามนัดของทุกรายการที่เลือกเรียบร้อยแล้ว",
    )
    if (!result.isConfirmed) return
    await runBulk(targets, { action: "done" }, "ปิดงาน")
  }

  async function editJob(row: TxRow) {
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "แก้ไขเลข Job",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${row.plate}<br>${tireLabel(row)}</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputValue: row.item.jobNo ?? "",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "บันทึก",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    itemPatch(row, { action: "editJob", jobNo: String(jobNo).trim() }, `อัปเดตเลข Job ${row.item.positionCode || row.item.serialNo} แล้ว`)
  }

  function confirmAppointment(dateIso: string) {
    const target = appointTarget
    setAppointTarget(null)
    if (!target) return
    itemPatch(target.row, { action: "appointment", date: dateIso }, "บันทึกนัดหมายแล้ว")
  }

  /**
   * ปิดงาน — ทีละล้อ ปิดได้ทันทีที่เส้นนั้นมีวันนัดแล้ว
   *
   * เดิมเป็นการกระทำระดับ "คำขอ" ปิดทีเดียวทุกเส้น ซึ่งรถที่ทยอยเปลี่ยนทีละล้อใช้ไม่ได้:
   * ใบจะค้างจนกว่าเส้นสุดท้ายจะถูกตัดสินและนัดครบ (เคสจริง T-0003 / สบ.70-6788)
   * ตอนนี้ใบจะขึ้นเป็น "ปิดงาน" เองเมื่อเส้นสุดท้ายในใบถูกปิด
   */
  async function markDone(row: TxRow) {
    const left = (row.request.items ?? []).filter(
      (it) => (it.status ?? "pending") === "approved" && String(it._id) !== String(row.item._id),
    ).length
    const result = await swalConfirm(
      "ปิดงานเปลี่ยนยางเส้นนี้?",
      `${row.plate} · ${row.item.positionCode || row.item.serialNo} — นัด ${fmtDateOnly(row.appointment)}`
      + (left > 0 ? ` (อีก ${left} เส้นในคำขอเดียวกันยังเปิดอยู่ ปิดแยกได้ทีหลัง)` : ""),
    )
    if (!result.isConfirmed) return
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${row.request._id}/items/${row.item._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "done" }),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "ปิดงานไม่สำเร็จ"); return }
    swalToast("success", "ปิดงานแล้ว")
    load(); onChanged()
  }

  /**
   * แยกยางที่ติดทางตันออกเป็นคำขอใบใหม่ — ทางออกเดียวของเส้นที่ค้างในใบที่ปิดไปแล้ว
   *
   * เส้นที่ติดในใบเดียวกันย้ายไปพร้อมกันทีเดียว (ฝั่ง API รวบให้) เพราะนัดหมาย/ปิดงาน
   * เป็นการกระทำระดับใบ — ถ้าแยกเส้นละใบ คนคลังต้องปิดงานหลายรอบไปตลอด
   *
   * ไม่ใช้ swalConfirm() เพราะมันบังคับไอคอนเตือนกับปุ่มแดง ซึ่งอ่านว่า "อันตราย/ลบทิ้ง" —
   * ผิดความจริง ของไม่หายไปไหน แค่ย้ายใบเพื่อให้กดอนุมัติได้
   */
  async function splitOut(row: TxRow) {
    const n = Math.max(1, row.blockedWith)
    const codes = (row.request.items ?? [])
      .filter((it) => (it.status ?? "pending") === "pending")
      .map((it) => it.positionCode || it.serialNo || "—")
      .join(", ")

    const { isConfirmed } = await Swal.fire({
      icon: "question",
      title: "แยกเป็นคำขอใหม่?",
      html:
        `<div style="font-size:0.86rem;line-height:1.65;text-align:left">` +
        `ทะเบียน <b>${row.plate}</b><br>` +
        `ยางที่จะย้าย: <b>${codes}</b> (${n} เส้น)<br><br>` +
        `ยางกลุ่มนี้จะไปอยู่คำขอใบใหม่สถานะ <b>รออนุมัติ</b> แล้วกดอนุมัติหรือปฏิเสธได้ทันที<br>` +
        `ยางที่ปิดงานไปแล้วในใบเดิมไม่เปลี่ยนแปลง` +
        `</div>`,
      showCancelButton: true,
      confirmButtonText: "แยกเป็นคำขอใหม่",
      confirmButtonColor: "#EA580C",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return

    setActing(true)
    const res = await fetch(`/api/tire-change-request/${row.request._id}/items/${row.item._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "split", withSiblings: true }),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "แยกคำขอไม่สำเร็จ"); return }
    const d = await res.json().catch(() => ({}))
    swalToast("success", `แยก ${d.movedCount ?? n} เส้นเป็นคำขอใหม่แล้ว — อนุมัติได้เลย`)
    load(); onChanged()
  }

  const actions = { approve, reject, editJob, markDone, splitOut, appoint: (row: TxRow) => setAppointTarget({ row }) }

  /* ------------------------------------------------------------------- จอ */

  const truncated = serverTotal > requests.length

  return (
    <div>
      {/* ── ค้นหา + ชิปค้างงาน + ล้างตัวกรอง + รีเฟรช ── */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาทะเบียน / เบอร์รถ / คนขับ / ล้อ / Serial / เลข Job..."
            className={inp + " w-full pl-8"}
            style={fontThai}
          />
        </div>

        <Chip on={stuckOnly} tone="red" count={stuckCount} onClick={() => setStuckOnly((v) => !v)}>
          ค้างเกิน {STUCK_DAYS} วัน
        </Chip>

        {/* ทางตันควรเป็นของที่ไม่มีเหลือ — ไม่โชว์ชิป "0" ค้างไว้บน toolbar ให้รก */}
        {blockedCount > 0 && (
          <Chip on={blockedOnly} tone="orange" count={blockedCount} onClick={() => setBlockedOnly((v) => !v)}>
            ทำต่อไม่ได้
          </Chip>
        )}

        {filtered && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full px-3 py-1.5 text-[12px] text-[#9AA8A0] underline-offset-4 transition-colors hover:text-[#14271C] hover:underline dark:hover:text-white"
            style={fontThai}
          >
            ล้างตัวกรอง
          </button>
        )}

        {/* ── มุมขวาบนตาราง: รีเฟรชเป็นปุ่มเงียบ ๆ ส่งออกเป็นปุ่มหลัก ── */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-[10px] border border-[#EEF2F0] px-2.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:bg-[#F0FDF4] disabled:opacity-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            style={fontThai}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> รีเฟรช
          </button>

          {/* เลขบนปุ่มคือจำนวนแถวที่จะได้จริง — กดแล้วไม่ต้องลุ้นว่าไฟล์จะมีแค่หน้าที่เปิดอยู่ไหม */}
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || loading || rows.length === 0}
            title={rows.length ? `ส่งออก ${fmtNum(rows.length)} รายการที่กรองอยู่เป็นไฟล์ Excel` : "ไม่มีรายการให้ส่งออก"}
            className={
              "group inline-flex items-center gap-1.5 rounded-[10px] bg-linear-to-b from-[#22A25B] to-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white " +
              "shadow-[0_1px_2px_rgba(20,39,28,0.18),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all " +
              "hover:from-[#26AF63] hover:to-[#177A41] hover:shadow-[0_3px_10px_rgba(27,140,75,0.32)] " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B8C4B] " +
              "active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
            }
            style={fontThai}
          >
            {exporting
              ? <RefreshCw size={13} className="animate-spin" />
              : <FileSpreadsheet size={13} className="transition-transform group-hover:-translate-y-px" />}
            {exporting ? "กำลังส่งออก..." : "ส่งออก Excel"}
            {!exporting && rows.length > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-px font-mono text-[10.5px] font-bold tabular-nums">
                {fmtNum(rows.length)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── ชิปขั้นของงาน — ตัวเลขคือยอดของทั้งชุดที่โหลดมา ไม่ใช่แค่หน้านี้ ── */}
      <div role="group" aria-label="กรองตามขั้นของงาน" className="mb-3 flex flex-wrap gap-1.5">
        {STAGE_CHIPS.map((c) => (
          <Chip
            key={c.value}
            on={stage === c.value}
            tone={c.tone}
            count={c.value === "all" ? searched.length : stageCounts[c.value as TxStage] ?? 0}
            onClick={() => setStage(c.value)}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      {/* ── แถบทำรายการพร้อมกัน — โผล่เฉพาะตอนมีการติ๊กเลือก ไม่กินที่ตอนใช้งานปกติ ── */}
      {selectedRows.length > 0 && (
        <div className="sticky top-2 z-30 mb-2.5 flex flex-wrap items-center gap-2.5 rounded-2xl border border-[#1B8C4B]/25 bg-[#EAF7EF]/95 px-4 py-2.5 backdrop-blur dark:border-[#1B8C4B]/40 dark:bg-[#132018]/90">
          <span className="text-[13px] font-medium text-[#14271C] dark:text-white" style={fontThai}>
            เลือกไว้ {selectedRows.length} รายการ
          </span>
          {approveTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={bulkApprove}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] bg-green-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={fontThai}>
              <Check size={12} /> อนุมัติที่เลือก ({approveTargets.length})
            </button>
          )}
          {rejectTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={bulkReject}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={fontThai}>
              <X size={12} /> {rejectTargets.every((r) => r.canDecide) ? "ปฏิเสธที่เลือก" : "ปฏิเสธ/ยกเลิกอนุมัติที่เลือก"} ({rejectTargets.length})
            </button>
          )}
          {editJobTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={bulkEditJob}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] border border-[#1B8C4B]/40 bg-white px-3 py-1.5 text-[12px] font-semibold text-[#14271C] transition-colors hover:bg-[#F0FDF4] disabled:opacity-50 dark:border-[#1B8C4B]/40 dark:bg-transparent dark:text-white dark:hover:bg-white/5"
              style={fontThai}>
              <Tag size={12} /> ระบุ/แก้ไขเลข Job ({editJobTargets.length})
            </button>
          )}
          {doneTargets.length > 0 && (
            <button type="button" disabled={acting} onClick={bulkMarkDone}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] bg-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={fontThai}>
              <Flag size={12} /> ปิดงานที่เลือก ({doneTargets.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto cursor-pointer text-[12px] text-[#6B7C72] underline-offset-4 transition-colors hover:text-[#14271C] hover:underline dark:text-gray-400 dark:hover:text-white"
            style={fontThai}
          >
            ล้างการเลือก
          </button>
        </div>
      )}

      {/* ── ตาราง (จอ ≥md) ── */}
      <div className={card + " hidden overflow-x-auto md:block"}>
        <table className="w-full text-sm">
          <thead>
            <tr className={txTheadCls}>
              <th className={txThCls + " w-9"}>
                <input
                  ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAllPage}
                  disabled={pageSelectableKeys.length === 0}
                  title="เลือกทุกแถวที่ทำรายการได้ในหน้านี้"
                  className="h-4 w-4 cursor-pointer accent-[#1B8C4B] disabled:opacity-30"
                />
              </th>
              <ColHead ctx={headCtx} label="อายุคำขอ" width="w-24"
                sortKey="age" sortLabels={["ใหม่สุดก่อน", "ค้างนานสุดก่อน"]} />
              <ColHead ctx={headCtx} label="ผู้แจ้ง / ทะเบียน" width="w-42"
                sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
              <ColHead ctx={headCtx} label="เบอร์รถ" width="w-28"
                sortKey="truck" sortLabels={["เบอร์รถ น้อย → มาก", "เบอร์รถ มาก → น้อย"]} facetKey="truck" />
              <ColHead ctx={headCtx} label="ตำแหน่งยาง" width="w-44"
                sortKey="position" sortLabels={["ตำแหน่ง ก → ฮ", "ตำแหน่ง ฮ → ก"]} facetKey="position" />
              <ColHead ctx={headCtx} label="สาเหตุ" width="w-34"
                sortKey="reason" sortLabels={["สาเหตุ ก → ฮ", "สาเหตุ ฮ → ก"]} facetKey="reason" />
              <ColHead ctx={headCtx} label="มิลยาง / ระยะทาง" width="w-36"
                sortKey="tread" sortLabels={["ดอกยางบางสุดก่อน", "ดอกยางหนาสุดก่อน"]} />
              <th className={txThCls + " w-25"}>รูป</th>
              <ColHead ctx={headCtx} label="สถานะ" width="w-42"
                sortKey="stage" sortLabels={["ขั้นต้น → ขั้นปลาย", "ขั้นปลาย → ขั้นต้น"]} facetKey="stage" />
              <ColHead ctx={headCtx} label="ล่าสุด" width="w-36"
                sortKey="last" sortLabels={["นานแล้วก่อน", "ล่าสุดก่อน"]} />
              <th className={txThCls + " w-51"}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-14 text-center text-sm text-gray-400" style={fontThai}>
                <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-gray-300 dark:text-gray-600" />
                กำลังโหลด...
              </td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={11}>
                <Empty
                  hint={filtered ? "ลองปรับคำค้นหรือล้างตัวกรอง" : "ยังไม่มีคำขอเปลี่ยนยางในระบบ"}
                  onClear={filtered ? clearFilters : undefined}
                />
              </td></tr>
            ) : pageRows.map((row, i) => (
              <tr
                key={row.key}
                onClick={() => setOpenKey(row.key)}
                className={[
                  "cursor-pointer border-b border-gray-100 align-top last:border-0 dark:border-white/5",
                  // แถวติดทางตันใช้ "ธง" ส้ม (แถบซ้าย + พื้น) ไม่ใช่สีสถานะที่ 6 —
                  // ชิปสถานะยังเป็น "รออนุมัติ" ตามจริง เลขบนชิปกรองจึงไม่เพี้ยน
                  row.blocked
                    ? "border-l-[3px] border-l-orange-500 bg-orange-50 hover:bg-orange-100/70 dark:bg-orange-500/8 dark:hover:bg-orange-500/12"
                    : (i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1 " : "") + "hover:bg-[#F0FDF4] dark:hover:bg-white/4",
                ].join(" ")}
              >
                {/* ── ติ๊กเลือกทำรายการพร้อมกัน — ปิดไว้เฉพาะเส้นที่จบทาง/ติดทางตันแล้ว ── */}
                <td className={txTdCls} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.key)}
                    disabled={Boolean(selectReason(row))}
                    onChange={() => toggleSelect(row.key)}
                    title={selectReason(row) || "เลือกเพื่อทำรายการพร้อมกัน"}
                    className="h-4 w-4 cursor-pointer accent-[#1B8C4B] disabled:opacity-30"
                  />
                </td>

                {/* ── อายุคำขอ: ตัวเลขวันเป็นตัวเด่น วันที่แจ้งเป็นบรรทัดรอง ── */}
                <td className={txTdCls}>
                  <span className={`block text-[17px] leading-none font-bold ${row.stuck ? "text-red-600 dark:text-red-400" : "text-[#14271C] dark:text-white"}`}>
                    {row.ageDays}
                    <span className="ml-1 text-[10px] font-normal text-[#9AA8A0]" style={fontThai}>วัน</span>
                  </span>
                  <span className="mt-1 block text-[10.5px] text-[#9AA8A0]" style={fontThai}>{fmtDateOnly(row.createdAt)}</span>
                </td>

                {/* ── ใครแจ้ง: ทะเบียนเป็นพระเอก แล้วสาขา → คนขับ (เบอร์รถแยกไปคอลัมน์ของตัวเอง) ── */}
                <td className={txTdCls}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[13.5px] font-bold text-[#14271C] dark:text-white">{row.plate}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${branchChipCls(row.branch)}`} style={fontThai}>
                      {branchLabel(row.branch)}
                    </span>
                  </span>

                  <span
                    className="mt-1 block truncate text-[12px] text-[#6B7C72] dark:text-gray-400"
                    style={fontThai}
                    title={row.request.driverName || undefined}
                  >
                    {row.request.driverName || "ไม่ระบุคนขับ"}
                  </span>
                </td>

                {/* ── เบอร์รถ: คอลัมน์ของตัวเอง เพราะเป็นเลขที่ต้องคัดลอกไปใช้ต่อบ่อยที่สุด ── */}
                <td className={txTdCls}>
                  <TruckNo value={row.request.truckNumber} />
                </td>

                {/* ── ยางเส้นไหน: ตำแหน่งอ่านก่อน แล้วค่อยเลขอ้างอิง (S/N + ใบแจ้งซ่อม) ── */}
                <td className={txTdCls}>
                  <span className="flex flex-wrap items-baseline gap-1.5">
                    <span className="rounded-md bg-[#F0FDF4] px-1.5 py-0.5 font-mono text-[14px] font-bold text-[#1B8C4B] dark:bg-green-500/10 dark:text-green-400">
                      {row.item.positionCode || "—"}
                    </span>
                    <span className="text-[12.5px] font-medium text-[#14271C] dark:text-gray-200" style={fontThai}>
                      {row.item.positionName || "ไม่ระบุตำแหน่ง"}
                    </span>
                  </span>
                  {/* จำนวนรูปย้ายไปคอลัมน์ "รูป" แล้ว — ไม่ต้องบอกเลขซ้ำอีกที่ */}
                  {(row.item.serialNo || row.item.jobNo) && (
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[#9AA8A0]">
                      {row.item.serialNo && (
                        <span className="font-mono" title={`Serial ${row.item.serialNo}`}>S/N {row.item.serialNo}</span>
                      )}
                      {row.item.jobNo && (
                        // เลข Job ที่คนอนุมัติกรอกไว้ = เลขที่ใบแจ้งซ่อมของ ATMS — กดไปเปิดใบนั้นได้เลย
                        <span onClick={(e) => e.stopPropagation()}>
                          <AtmsJobLink code={row.item.jobNo} className="text-[10.5px]" iconSize={9} />
                        </span>
                      )}
                    </span>
                  )}
                </td>

                {/* ── สาเหตุ: คอลัมน์ของตัวเอง เพราะเป็นตัวที่คนคลังกรองบ่อยที่สุด ── */}
                <td className={txTdCls}>
                  {row.item.reason ? (
                    <span className={`inline-block px-1.5 py-0.5 text-[13.5px] font-medium underline ${reasonChipCls(row.item.reason)}`} style={fontThai}>
                      {row.item.reason}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-gray-300 dark:text-gray-600">—</span>
                  )}
                  {/* รถกินยาง = สาเหตุเดียวที่ต้องปิด MR ก่อนอนุมัติ — สถานะกับปุ่มเดินงานจึงอยู่ติดกับสาเหตุเลย */}
                  {row.item.reason === "รถกินยาง" && (
                    <span className="mt-1 block" onClick={(e) => e.stopPropagation()}>
                      <MrCell mr={mrMap[mrKey(row.branch, row.plate)]} acting={acting} onAdvance={() => mrAdvance(row)} />
                    </span>
                  )}
                </td>

                {/*
                  ── มิลยาง / ใช้งาน ──
                  "มิลยาง" = ดอกยางที่คนขับวัดมาให้ (มม.) เป็นตัวเด่น เพราะเป็นค่าที่คนอนุมัติ
                  ใช้ตัดสินว่าควรเปลี่ยนจริงไหม ส่วนระยะใช้งาน (กม.) เป็นบรรทัดอ้างอิงด้านล่าง
                  หน่วยติดกับตัวเลขทั้งสองบรรทัด — มม. กับ กม. ต่างกันคนละเรื่อง ห้ามให้เดา
                  0 = ยังไม่ได้บันทึก โชว์ "—" ไม่ใช่เลข 0 หลอกตา
                */}
                <td className={txTdCls}>
                  <span className="block text-[13px] font-bold text-[#14271C] dark:text-white">
                    {row.item.currentTreadMm > 0 ? (
                      <>
                        <span className="font-mono">{row.item.currentTreadMm}</span>
                        <span className="ml-0.5 text-[10px] font-normal text-[#9AA8A0]" style={fontThai}>มม.</span>
                      </>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-[#9AA8A0]" style={fontThai}>
                    ใช้งาน {row.item.usedDistance > 0 ? `${fmtNum(row.item.usedDistance)} กม.` : "—"}
                  </span>
                </td>

                {/* รูปที่คนขับถ่ายมาตอนแจ้ง — ชี้เพื่อขยาย กดเพื่อเปิดเต็ม */}
                <td className={txTdCls} onClick={(e) => e.stopPropagation()}>
                  <PhotoCell urls={row.photos} />
                </td>

                <td className={txTdCls}>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(row.stage)}`} style={fontThai}>
                      {STATUS_LABEL[row.stage] ?? row.stage}
                    </span>
                    {row.blocked && <BlockedBadge />}
                  </span>
                  <StageBar stage={row.stage} />
                  {row.blocked && (
                    <span className="mt-1 block text-[10.5px] text-orange-700 dark:text-orange-300" style={fontThai}>
                      อยู่ในใบที่ &quot;{STATUS_LABEL[row.request.status ?? "pending"]}&quot; แล้ว
                    </span>
                  )}
                  {row.appointment && row.stage !== "done" && (
                    <span className="mt-1 block text-[10.5px] text-purple-600 dark:text-purple-300" style={fontThai}>
                      นัด {fmtDateOnly(row.appointment)}
                    </span>
                  )}
                  {row.stuck && (
                    <span className="mt-1 block text-[10.5px] font-medium text-red-600 dark:text-red-400" style={fontThai}>
                      ค้าง {row.ageDays} วัน
                    </span>
                  )}
                </td>

                <td className={txTdCls}>
                  <span className="block text-[11.5px] font-medium text-[#14271C] dark:text-white" style={fontThai}>{row.last.label}</span>
                  <span className="mt-0.5 block text-[10.5px] text-[#9AA8A0]" style={fontThai} title={fmtDate(row.last.at)}>
                    {agoText(row.last.at)}
                  </span>
                  <span className="mt-0.5 block max-w-[130px] truncate text-[10.5px] text-[#6B7C72] dark:text-gray-400" style={fontThai} title={row.last.by}>
                    {row.last.by || "—"}
                  </span>
                </td>

                <td className={txTdCls} onClick={(e) => e.stopPropagation()}>
                  <RowActions row={row} acting={acting} {...actions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── การ์ด (จอ <md) — ไม่ต้องเลื่อนแนวนอน ── */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {loading ? (
          <div className={card + " px-4 py-12 text-center text-sm text-gray-400"} style={fontThai}>กำลังโหลด...</div>
        ) : pageRows.length === 0 ? (
          <div className={card}>
            <Empty
              hint={filtered ? "ลองปรับคำค้นหรือล้างตัวกรอง" : "ยังไม่มีคำขอเปลี่ยนยางในระบบ"}
              onClear={filtered ? clearFilters : undefined}
            />
          </div>
        ) : pageRows.map((row) => (
          <div
            key={row.key}
            onClick={() => setOpenKey(row.key)}
            className={[
              card,
              "cursor-pointer p-3.5 transition-colors",
              row.blocked
                ? "border-l-[3px] border-l-orange-500 bg-orange-50 dark:bg-orange-500/8"
                : "hover:border-[#1B8C4B]/40",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5">
                {!selectReason(row) && (
                  <input
                    type="checkbox"
                    checked={selected.has(row.key)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(row.key)}
                    title="เลือกเพื่อทำรายการพร้อมกัน"
                    className="h-4 w-4 cursor-pointer accent-[#1B8C4B]"
                  />
                )}
                <span className="font-mono text-[14px] font-bold text-[#14271C] dark:text-white">{row.plate}</span>
                {row.blocked && <BlockedBadge />}
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${branchChipCls(row.branch)}`} style={fontThai}>
                  {branchLabel(row.branch)}
                </span>
                {/* บนมือถือไม่มีคอลัมน์ — ติดป้าย "เบอร์" ไว้กันสับสนกับทะเบียนที่อยู่ติดกัน */}
                {row.request.truckNumber && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-[#9AA8A0]" style={fontThai}>
                    เบอร์ <TruckNo value={row.request.truckNumber} className="text-[11.5px]" />
                  </span>
                )}
              </span>
              <span className={`shrink-0 text-[11px] ${row.stuck ? "font-medium text-red-600 dark:text-red-400" : "text-[#9AA8A0]"}`} style={fontThai}>
                {row.ageDays} วัน · {fmtDateOnly(row.createdAt)}
              </span>
            </div>

            <p className="mt-1 flex flex-wrap items-baseline gap-1.5 text-[12.5px]" style={fontThai}>
              <span className="font-mono font-bold text-[#1B8C4B] dark:text-green-400">{row.item.positionCode || "—"}</span>
              <span className="text-[#14271C] dark:text-gray-200">{row.item.positionName || "ไม่ระบุตำแหน่ง"}</span>
              {row.item.serialNo && <span className="font-mono text-[11px] text-[#9AA8A0]">{row.item.serialNo}</span>}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#9AA8A0]" style={fontThai}>
              <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${reasonChipCls(row.item.reason)}`}>
                {row.item.reason || "ไม่ระบุสาเหตุ"}
              </span>
              <span>{row.request.driverName || "ไม่ระบุคนขับ"}</span>
              {row.item.currentTreadMm > 0 && (
                <span>มิลยาง <span className="font-mono font-semibold text-[#14271C] dark:text-white">{row.item.currentTreadMm}</span> มม.</span>
              )}
              {row.item.usedDistance > 0 && (
                <span>ใช้งาน <span className="font-mono font-semibold text-[#14271C] dark:text-white">{fmtNum(row.item.usedDistance)}</span> กม.</span>
              )}
              {row.item.jobNo && (
                <span onClick={(e) => e.stopPropagation()}>
                  <AtmsJobLink code={row.item.jobNo} className="text-[11px]" iconSize={9} />
                </span>
              )}
            </p>

            {row.photos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                {row.photos.map((u, i) => <PhotoThumb key={i} src={u} alt={`รูปยาง ${i + 1}`} size={44} />)}
              </div>
            )}

            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(row.stage)}`} style={fontThai}>
                {STATUS_LABEL[row.stage] ?? row.stage}
              </span>
              <span className="text-[10.5px] text-[#9AA8A0]" style={fontThai}>{row.last.label} · {agoText(row.last.at)}</span>
            </div>
            <StageBar stage={row.stage} />

            <div className="mt-2.5 border-t border-[#EEF2F0] pt-2.5 dark:border-white/8" onClick={(e) => e.stopPropagation()}>
              <RowActions row={row} acting={acting} {...actions} />
            </div>
          </div>
        ))}
      </div>

      {/* ── ท้ายตาราง: จำนวน + แบ่งหน้า ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="text-[12px] text-[#9AA8A0]" style={fontThai}>
          {rows.length ? (
            <>
              แสดง <span className="font-medium text-[#14271C] dark:text-white">{sliceFrom + 1}–{sliceFrom + pageRows.length}</span> จาก {fmtNum(rows.length)} รายการ
              {rows.length !== allRows.length ? ` (ทั้งหมด ${fmtNum(allRows.length)})` : ""}
            </>
          ) : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
          {truncated && (
            <span className="ml-1 text-[#9AA8A0]">
              · โหลดคำขอล่าสุด {fmtNum(requests.length)} จาก {fmtNum(serverTotal)} ใบ
            </span>
          )}
        </p>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-[12px] text-[#9AA8A0]" style={fontThai}>ต่อหน้า</span>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              aria-label="จำนวนรายการต่อหน้า"
              className={inp}
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <Pager current={current} count={pageCount} onGo={setPage} />
        </div>
      </div>

      <TxDetailDialog
        row={openRow}
        acting={acting}
        onClose={() => setOpenKey(null)}
        mr={openRow ? mrMap[mrKey(openRow.branch, openRow.plate)] : undefined}
        mrAdvance={mrAdvance}
        mrReload={(row) => { reloadMr(row.branch, row.plate) }}
        {...actions}
      />

      <AppointmentDialog
        target={appointTarget && {
          plate: appointTarget.row.plate,
          driverName: appointTarget.row.request.driverName,
          appointmentDate: appointTarget.row.appointment,
          subtitle: tireLabel(appointTarget.row),
        }}
        onClose={() => setAppointTarget(null)}
        onConfirm={confirmAppointment}
      />
    </div>
  )
}

// ===========================================================================
// เบอร์รถ — กดคัดลอกได้
// ===========================================================================

/**
 * เบอร์รถเป็นเลขที่คนคลังต้องเอาไปพิมพ์ต่อในระบบอื่น (ATMS / แชทกลุ่ม) มากกว่าจะอ่านผ่านตาเฉย ๆ
 * ทั้งช่องจึงเป็นปุ่มคัดลอก ไม่ใช่ไอคอนจิ๋วข้าง ๆ ที่ต้องเล็งกด
 * กดแล้วสลับเป็นเครื่องหมายถูก 1.5 วิ — เห็นทันทีว่าคัดลอกเบอร์ไหนไปแล้ว ไม่ต้องรอ toast
 */
function TruckNo({ value, className = "text-[13px]" }: { value?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const no = (value ?? "").trim()
  if (!no) return <span className="text-[11.5px] text-gray-300 dark:text-gray-600">—</span>

  async function copy(e: MouseEvent) {
    // แถว/การ์ดที่ครอบอยู่กดแล้วเปิดโมดัล — คัดลอกต้องไม่พาไปเปิดโมดัลด้วย
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(no)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      swalError("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้ใช้คลิปบอร์ด")
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? `คัดลอก ${no} แล้ว` : `คัดลอกเบอร์รถ ${no}`}
      aria-label={`คัดลอกเบอร์รถ ${no}`}
      className={[
        "group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono font-bold transition-colors",
        copied
          ? "border-[#1B8C4B]/40 bg-[#F0FDF4] text-[#1B8C4B] dark:border-green-400/40 dark:bg-green-500/12 dark:text-green-300"
          : "border-[#EEF2F0] text-[#14271C] hover:border-[#1B8C4B]/40 hover:bg-[#F0FDF4] dark:border-white/10 dark:text-white dark:hover:bg-white/5",
        className,
      ].join(" ")}
    >
      <span className="truncate">{no}</span>
      {copied
        ? <Check size={11} className="shrink-0" />
        : <Copy size={11} className="shrink-0 text-[#C3CFC8] transition-colors group-hover:text-[#1B8C4B] dark:text-gray-500" />}
    </button>
  )
}

// ===========================================================================
// หัวคอลัมน์ที่เรียง/กรองได้
// ===========================================================================

/** รายการเรียงในเมนู — ติ๊กอยู่แล้วกดซ้ำ = ยกเลิกการเรียง กลับไปเรียงใหม่สุดบนตามเดิม */
function SortItem({ dir, label, on, onClick }: {
  dir: SortDir
  label: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full cursor-pointer items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[11.5px] transition-colors",
        on
          ? "bg-[#F0FDF4] font-semibold text-[#1B8C4B] dark:bg-green-500/12 dark:text-green-300"
          : "text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5",
      ].join(" ")}
      style={fontThai}
    >
      {dir === "asc" ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {on && <Check size={12} className="shrink-0" />}
    </button>
  )
}

/**
 * หัวคอลัมน์แบบ Google Sheets/Excel — ปุ่มไอคอนเปิดเมนู "เรียง + ติ๊กค่าที่ต้องการ"
 *
 * ต่างจาก Excel หนึ่งข้อ: ช่องติ๊กเริ่มต้นเป็น "ไม่ติ๊กเลย" ซึ่งหมายถึงเอาทุกค่า
 * (Excel เริ่มด้วยติ๊กครบแล้วให้ไล่เอาออก ซึ่งกลายเป็นงานเยอะกว่าตอนอยากดูค่าเดียว)
 * ปุ่มจะเปลี่ยนเป็นสีเขียวพร้อมเลขจำนวนค่าที่ติ๊กไว้ คอลัมน์ที่ถูกกรองจึงเห็นได้จากที่เดียว
 */
function ColHead({ label, width = "", sortKey, sortLabels, facetKey, ctx }: {
  label:       string
  width?:      string
  sortKey?:    SortKey
  /** ป้ายของทิศทางเรียง [น้อย→มาก, มาก→น้อย] — เขียนตามความหมายของคอลัมน์นั้นตรง ๆ */
  sortLabels?: [string, string]
  facetKey?:   FacetKey
  ctx:         HeadCtx
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState("")

  const dir     = sortKey && ctx.sort?.key === sortKey ? ctx.sort.dir : null
  const picked  = facetKey ? ctx.facets[facetKey] : []
  const options = facetKey ? ctx.options[facetKey] : []
  const active  = Boolean(dir) || picked.length > 0

  const needle = find.trim().toLowerCase()
  const shown = needle ? options.filter((o) => o.value.toLowerCase().includes(needle)) : options
  const allPicked = options.length > 0 && picked.length === options.length

  function toggle(value: string) {
    if (!facetKey) return
    ctx.onPick(facetKey, picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value])
  }

  return (
    <th className={`${txThCls} ${width}`}>
      <span className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        {dir === "asc"  && <ArrowUp   size={11} className="shrink-0 text-[#1B8C4B] dark:text-green-400" aria-hidden />}
        {dir === "desc" && <ArrowDown size={11} className="shrink-0 text-[#1B8C4B] dark:text-green-400" aria-hidden />}

        <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFind("") }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`เรียงหรือกรองคอลัมน์ ${label}`}
              title={`เรียง / กรอง — ${label}`}
              className={[
                "ml-auto inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-1 transition-colors",
                active
                  ? "bg-[#1B8C4B] text-white"
                  : "text-[#6B7C72] hover:bg-white hover:text-[#1B8C4B] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-green-400",
              ].join(" ")}
            >
              <ListFilter size={11} strokeWidth={2.5} />
              {picked.length > 0 && <span className="text-[9.5px] font-bold leading-none">{picked.length}</span>}
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-56 rounded-[12px] border-[#EEF2F0] bg-white p-0 shadow-lg dark:border-white/10 dark:bg-[#151a10]"
          >
            {sortKey && (
              <div className="border-b border-[#EEF2F0] p-1 dark:border-white/8">
                <SortItem dir="asc" on={dir === "asc"} label={sortLabels?.[0] ?? "น้อย → มาก"}
                  onClick={() => ctx.onSort(sortKey, dir === "asc" ? null : "asc")} />
                <SortItem dir="desc" on={dir === "desc"} label={sortLabels?.[1] ?? "มาก → น้อย"}
                  onClick={() => ctx.onSort(sortKey, dir === "desc" ? null : "desc")} />
              </div>
            )}

            {facetKey && (
              <>
                {/* ช่องค้นหาในเมนู — คอลัมน์ทะเบียนมีค่าเป็นร้อย ไถหาเองไม่ไหว */}
                <div className="p-1.5">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={find}
                      onChange={(e) => setFind(e.target.value)}
                      placeholder="ค้นหาค่า..."
                      className="w-full rounded-[8px] border border-[#EEF2F0] bg-white py-1 pl-6 pr-2 text-[11.5px] text-[#14271C] placeholder-[#9AA8A0] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/25 dark:border-white/10 dark:bg-[#0f130d] dark:text-white"
                      style={fontThai}
                    />
                  </div>
                </div>

                <div className="max-h-52 overflow-y-auto px-1 pb-1">
                  {options.length > 1 && !needle && (
                    <label className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] font-semibold text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-100 dark:hover:bg-white/5" style={fontThai}>
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={() => facetKey && ctx.onPick(facetKey, allPicked ? [] : options.map((o) => o.value))}
                        className="size-3.5 shrink-0 cursor-pointer accent-[#1B8C4B]"
                      />
                      เลือกทั้งหมด
                    </label>
                  )}

                  {shown.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[11px] text-[#9AA8A0]" style={fontThai}>ไม่พบค่าที่ค้นหา</p>
                  ) : shown.map((o) => (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5"
                      style={fontThai}
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(o.value)}
                        onChange={() => toggle(o.value)}
                        className="size-3.5 shrink-0 cursor-pointer accent-[#1B8C4B]"
                      />
                      <span className="flex-1 truncate" title={o.value}>{o.value}</span>
                      <span className="shrink-0 text-[10px] text-[#9AA8A0]">{o.count}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[#EEF2F0] px-2 py-1.5 dark:border-white/8">
                  <span className="text-[10px] text-[#9AA8A0]" style={fontThai}>ไม่ติ๊ก = แสดงทั้งหมด</span>
                  <button
                    type="button"
                    disabled={picked.length === 0}
                    onClick={() => ctx.onPick(facetKey, [])}
                    className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#1B8C4B] transition-colors hover:bg-[#F0FDF4] disabled:cursor-default disabled:text-[#C9D3CD] disabled:hover:bg-transparent dark:text-green-400 dark:hover:bg-white/10 dark:disabled:text-gray-600"
                    style={fontThai}
                  >
                    ล้าง
                  </button>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      </span>
    </th>
  )
}

// ===========================================================================
// MR ของ "รถกินยาง"
// ===========================================================================

/** ป้ายปุ่มขั้นถัดไป — ขั้นถัดไปมีทางเดียวเสมอ ปุ่มเดียวจึงพอ ไม่ต้องมีเมนูให้เลือกสถานะ */
function mrNextLabel(mr: MrSummary | null | undefined) {
  if (mr === null) return "+ โน๊ต MR"
  if (mr?.status === "pending") return "เริ่มซ่อม"
  if (mr?.status === "in_progress") return "ซ่อมเสร็จ ✓"
  return null
}

const MR_BTN_CLS: Record<string, string> = {
  "+ โน๊ต MR": "bg-blue-600 text-white",
  "เริ่มซ่อม":   "bg-orange-500 text-white",
  "ซ่อมเสร็จ ✓": "bg-green-600 text-white",
}

/** ในตาราง: สถานะ MR + ปุ่มเดินขั้นถัดไป — ขนาดเล็กพอที่จะอยู่ใต้ชิปสาเหตุได้ */
function MrCell({ mr, acting, onAdvance }: {
  mr: MrSummary | null | undefined
  acting: boolean
  onAdvance: () => void
}) {
  if (mr === undefined) {
    return <span className="text-[10.5px] text-[#9AA8A0]" style={fontThai}>กำลังตรวจ MR...</span>
  }
  const next = mrNextLabel(mr)
  const chip = mr && mrChip(mr.status)
  return (
    <span className="flex flex-wrap items-center gap-1">
      {chip && (
        <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${chip.cls}`} style={fontThai}
          title={[mr?.note, mr?.updatedBy].filter(Boolean).join(" · ") || undefined}>
          MR: {chip.label}
        </span>
      )}
      {next && (
        <button
          type="button"
          disabled={acting}
          onClick={onAdvance}
          className={`inline-flex cursor-pointer items-center rounded px-2 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${MR_BTN_CLS[next]}`}
          style={fontThai}
        >
          {next}
        </button>
      )}
    </span>
  )
}

/**
 * ในโมดัลรายละเอียด: กล่องเต็มของ MR — สถานะ + หมายเหตุล่าสุด + ใครอัปเดตเมื่อไร + ปุ่ม
 * ไทม์ไลน์กางอยู่ในกล่องนี้เลย ไม่เปิดโมดัลซ้อน — โมดัลชั้นนอกเป็น Radix ที่ดักโฟกัสและ
 * ปิด pointer-events ของทุกอย่างนอกตัวมัน โมดัลชั้นในจึงกดไม่ได้/ไม่โผล่
 */
function MrPanel({ mr, acting, settled, onAdvance, onSaved }: {
  mr: MrSummary | null | undefined
  acting: boolean
  /** ยางเส้นนี้จบแล้ว (ปิดงาน/ปฏิเสธ) — MR ไม่ได้บล็อกอะไรอีก เหลือไว้ให้อ่านและแก้ประวัติ */
  settled: boolean
  onAdvance: () => void
  /** แก้หมายเหตุในไทม์ไลน์แล้ว — หัวใบต้องดึงใหม่ */
  onSaved: () => void
}) {
  // กางไทม์ไลน์ให้เลยตั้งแต่เปิดโมดัล — คนเปิดแถวรถกินยางมาเพื่อดูว่าซ่อมถึงไหนแล้วอยู่แล้ว
  // ปุ่มเหลือไว้ให้พับเก็บเมื่อ log ยาว
  const [showLogs, setShowLogs] = useState(true)
  const next = mrNextLabel(mr)
  const chip = mr ? mrChip(mr.status) : null
  return (
    <div className="rounded-[12px] border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-400/40 dark:bg-amber-500/10" style={fontThai}>
      <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">
        {settled ? "รถกินยาง — ใบซ่อม (MR) ของทะเบียนนี้" : "รถกินยาง — ต้องปิด MR ก่อนถึงจะอนุมัติเปลี่ยนยางได้"}
      </p>

      {mr === undefined ? (
        <p className="mt-1.5 text-[12px] text-[#6B7C72] dark:text-gray-300">กำลังตรวจสถานะ MR...</p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {chip
              ? <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
              : <span className="text-[12px] text-[#6B7C72] dark:text-gray-300">ยังไม่มี MR สำหรับทะเบียนนี้</span>}
            {mr && (
              <span className="text-[11px] text-[#9AA8A0]">
                {fmtDate(mr.updatedAt)}{mr.updatedBy ? ` · ${mr.updatedBy}` : ""}
              </span>
            )}
          </div>

          {mr?.note && (
            <p className="mt-1.5 whitespace-pre-wrap text-[12px] text-[#6B7C72] dark:text-gray-300">
              หมายเหตุล่าสุด: {mr.note}
            </p>
          )}

          {/* ทางเดียวที่แก้ข้อมูลได้คือแก้บรรทัดเดิมในไทม์ไลน์ — บอกไว้เพราะปุ่มแก้อยู่ในบรรทัดนั้น */}
          {mr && (
            <p className="mt-1.5 text-[11px] text-[#9AA8A0]">
              แก้ไขหมายเหตุของแต่ละสถานะได้ที่ไทม์ไลน์ด้านล่าง — แก้ทับของเดิม ไม่เพิ่มรายการใหม่
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {next && (
              <button type="button" disabled={acting} onClick={onAdvance}
                className={btnSmall + ` inline-flex cursor-pointer items-center gap-1 ${MR_BTN_CLS[next]}`} style={fontThai}>
                {next}
              </button>
            )}
            {mr && (
              <button type="button" onClick={() => setShowLogs((v) => !v)}
                className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-white text-[#6B7C72] ring-1 ring-[#EEF2F0] dark:bg-white/10 dark:text-gray-300 dark:ring-white/10"} style={fontThai}>
                <Clock size={11} /> ไทม์ไลน์{mr.logsCount ? ` (${mr.logsCount})` : ""}
                {showLogs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}
          </div>

          {mr && showLogs && (
            <div className="mt-2.5 rounded-[10px] bg-white/70 p-2.5 dark:bg-black/20">
              {/* mrId เป็น key — เปลี่ยนใบแล้ว list โหลดใหม่เอง ไม่ค้างข้อมูลใบเก่า
                  แก้หมายเหตุได้ในบรรทัดเดิม (editable) — ไม่เด้งกล่องซ้อนโมดัล และไม่เพิ่มบรรทัดใหม่ */}
              <MrTimelineList key={mr.mrId} mrId={mr.mrId} compact editable onSaved={onSaved} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ===========================================================================
// ชิ้นส่วนย่อย
// ===========================================================================

type RowActionProps = {
  row:      TxRow
  acting:   boolean
  approve:  (row: TxRow) => void
  reject:   (row: TxRow) => void
  editJob:  (row: TxRow) => void
  appoint:  (row: TxRow) => void
  markDone: (row: TxRow) => void
  splitOut: (row: TxRow) => void
}

/**
 * ปุ่ม "แยกเป็นคำขอใหม่" — โทนส้มแบบขอบ ไม่ใช่ปุ่มทึบ
 * ปุ่มทึบถูกจองไว้ให้เส้นทางปกติ (อนุมัติ/ปฏิเสธ/นัด/ปิดงาน) แล้ว ปุ่มนี้เป็นทางแก้ของที่ผิดปกติ
 * จึงควรเห็นชัดแต่ไม่แย่งน้ำหนักไปจากงานประจำ
 */
function SplitButton({ row, acting, onClick, full }: {
  row: TxRow
  acting: boolean
  onClick: () => void
  full?: boolean
}) {
  return (
    <button
      type="button"
      disabled={acting}
      onClick={onClick}
      className={[
        "inline-flex cursor-pointer items-center justify-center gap-1 rounded-[10px] border border-orange-400 px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition-colors",
        "hover:bg-orange-50 disabled:opacity-50 dark:border-orange-400/50 dark:text-orange-300 dark:hover:bg-orange-500/10",
        full ? "w-full py-1.5" : "",
      ].join(" ")}
      style={fontThai}
    >
      <FilePlus2 size={11} />
      แยกเป็นคำขอใหม่{row.blockedWith > 1 ? ` (${row.blockedWith} เส้น)` : ""}
    </button>
  )
}

/** ปุ่มของแถว — โผล่เฉพาะการกระทำที่ทำได้จริงในขั้นนั้น กดแล้วต้องไม่เจอ 409 */
function RowActions({ row, acting, approve, reject, editJob, appoint, markDone, splitOut }: RowActionProps) {
  const btns: ReactNode[] = []

  // ติดทางตัน — ทางเดียวที่เดินต่อได้คือแยกออกเป็นใบใหม่ ปุ่มอื่นยิงไปก็ 409
  if (row.blocked) {
    return <SplitButton row={row} acting={acting} onClick={() => splitOut(row)} />
  }

  if (row.canDecide) {
    btns.push(
      <button key="ok" disabled={acting} onClick={() => approve(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-green-600 text-white"} style={fontThai}>
        <Check size={11} /> อนุมัติ
      </button>,
      <button key="no" disabled={acting} onClick={() => reject(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-red-600 text-white"} style={fontThai}>
        <X size={11} /> ปฏิเสธ
      </button>,
    )
  }

  if (row.stage === "approved" || row.stage === "appointment") {
    btns.push(
      <button key="appt" disabled={acting} onClick={() => appoint(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-purple-600 text-white"} style={fontThai}>
        <CalendarClock size={11} /> {row.appointment ? "แก้ไขนัด" : "นัดหมาย"}
      </button>,
    )
  }

  {/* เผื่อกรณีอนุมัติแล้วยังอยากยกเลิก — เฉพาะก่อนลงวันนัด กดครั้งเดียวจบ (เปลี่ยนเป็น "ปฏิเสธ" ทันที) */}
  if (row.stage === "approved") {
    btns.push(
      <button key="cancel" disabled={acting} onClick={() => reject(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-red-600 text-white"} style={fontThai}>
        <X size={11} /> ปฏิเสธ
      </button>,
    )
  }

  // ปิดงานรายเส้น — เงื่อนไขเดียวคือล้อนี้มีวันนัดแล้ว ไม่ต้องรอเส้นอื่นในใบเดียวกัน
  if (row.stage === "appointment") {
    btns.push(
      <button key="done" disabled={acting} onClick={() => markDone(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-[#1B8C4B] text-white"} style={fontThai}>
        <Flag size={11} /> ปิดงาน
      </button>,
    )
  }

  // เลข Job แสดงเป็นลิงก์ ATMS อยู่ในคอลัมน์รายการแล้ว — ตรงนี้เหลือแค่ปุ่มแก้
  // (ถ้าเอาตัวเลขมาทำปุ่มแก้ด้วย จะกลายเป็นเลขเดียวกันสองที่ที่กดแล้วไปคนละทาง)
  //
  // แก้ได้จากตารางเลย ไม่ต้องเปิดรายละเอียด และแก้ได้ต่อแม้ปิดงานแล้ว — เลขใบแจ้งซ่อม ATMS
  // เป็นแค่ตัวเชื่อมไปดูใบที่ ATMS ซึ่งมักถูกออกใหม่หรือพบว่าพิมพ์ผิดหลังงานจบไปแล้ว
  const itemStatus = row.item.status ?? "pending"
  if (itemStatus === "approved" || itemStatus === "done") {
    btns.push(
      <button key="job" disabled={acting} onClick={() => editJob(row)}
        className="cursor-pointer text-[11px] text-[#6B7C72] underline decoration-dotted transition-colors hover:text-[#1B8C4B] dark:text-gray-400 dark:hover:text-green-400"
        style={fontThai}>
        {row.item.jobNo ? "แก้เลข Job" : "+ ระบุเลข Job"}
      </button>,
    )
  }

  if (btns.length === 0) return <span className="text-[12px] text-gray-300 dark:text-gray-600">—</span>
  return <div className="flex flex-wrap items-center gap-1.5">{btns}</div>
}

/**
 * ป้าย "ทำต่อไม่ได้" — ธงบอกว่าแถวนี้ติดทางตัน ไม่ใช่สถานะที่ 6 ของเส้นทางงาน
 * ส้มทึบ: ไม่ชนกับ 5 สีสถานะ (เหลือง/ฟ้า/ม่วง/เขียว/แดง) และไม่ชนกับ indigo ของป้าย "ใหม่"
 */
function BlockedBadge() {
  return (
    <span
      title='ยางเส้นนี้ยังไม่ถูกตัดสิน แต่คำขอทั้งใบถูกปิดไปแล้ว — ต้องแยกออกเป็นคำขอใบใหม่ก่อน'
      className="inline-flex items-center gap-0.5 rounded-md bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
      style={fontThai}
    >
      <Lock size={9} strokeWidth={2.6} />
      ทำต่อไม่ได้
    </span>
  )
}

/** ป้าย "ใหม่" — รายการที่เข้ามาวันนี้ · สีทึบต่างจากชิปสถานะ 5 สี เพื่อไม่ให้อ่านสับสนกัน */


/** แถบ 4 ขั้น — เห็นว่ารายการเดินไปถึงไหนโดยไม่ต้องเปิดดู */
function StageBar({ stage }: { stage: TxStage }) {
  if (stage === "rejected") {
    return (
      <span aria-hidden title="ปฏิเสธ — ไม่ไปต่อ" className="mt-1.5 flex gap-0.5">
        <span className="h-1 flex-1 rounded-full bg-red-500" />
      </span>
    )
  }
  const at = STAGE_STEP[stage]
  return (
    <span aria-hidden className="mt-1.5 flex gap-0.5" title={`ขั้นที่ ${at} จาก ${STAGE_FLOW.length} — ${STAGE_FLOW[at - 1]?.label ?? ""}`}>
      {STAGE_FLOW.map((s, i) => (
        <span key={s.key} className={`h-1 flex-1 rounded-full ${i < at ? "bg-[#1B8C4B]" : "bg-gray-200 dark:bg-white/10"}`} />
      ))}
    </span>
  )
}

const CHIP_ON: Record<StatTone, string> = {
  slate:  "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]",
  amber:  "border-amber-500 bg-amber-500 text-white",
  blue:   "border-blue-500 bg-blue-500 text-white",
  purple: "border-purple-500 bg-purple-500 text-white",
  green:  "border-[#1B8C4B] bg-[#1B8C4B] text-white",
  red:    "border-red-500 bg-red-500 text-white",
  orange: "border-orange-600 bg-orange-600 text-white",
}

function Chip({ children, on, onClick, tone = "slate", count }: {
  children: ReactNode
  on:       boolean
  onClick:  () => void
  tone?:    StatTone
  count?:   number
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={[
        "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
        on ? CHIP_ON[tone] : "border-[#EEF2F0] bg-white text-[#6B7C72] hover:border-[#1B8C4B]/30 hover:text-[#14271C] dark:border-white/10 dark:bg-[#151a10] dark:text-gray-400 dark:hover:text-white",
      ].join(" ")}
      style={fontThai}
    >
      {children}
      {count !== undefined && (
        <span className={`ml-1.5 font-bold ${on ? "opacity-80" : "text-[#14271C] dark:text-white"}`}>{count}</span>
      )}
    </button>
  )
}

function Empty({ hint, onClear }: { hint: string; onClear?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#F0FDF4] text-[#1B8C4B] dark:bg-white/5">
        <Inbox size={20} strokeWidth={1.7} aria-hidden />
      </span>
      <p className="text-[13px] text-gray-400" style={fontThai}>{hint}</p>
      {onClear && (
        <button type="button" onClick={onClear}
          className="rounded-full border border-[#EEF2F0] px-3.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:border-[#1B8C4B]/30 hover:text-[#14271C] dark:border-white/10 dark:text-gray-400 dark:hover:text-white"
          style={fontThai}>
          ล้างตัวกรอง
        </button>
      )}
    </div>
  )
}

/** หน้าต่างเลขหน้า — แสดงหน้าแรก/สุดท้ายเสมอ ความกว้างจึงคงที่ไม่ว่าจะมีกี่หน้า */
function pageWindow(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const around = [current - 1, current, current + 1].filter((n) => n > 1 && n < count)
  const pages = [1, ...around, count]
  const out: (number | "gap")[] = []
  for (const [i, n] of pages.entries()) {
    if (i && n - (pages[i - 1] as number) > 1) out.push("gap")
    out.push(n)
  }
  return out
}

function Pager({ current, count, onGo }: { current: number; count: number; onGo: (page: number) => void }) {
  if (count <= 1) return null

  const step = "flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-[#EEF2F0] text-[#6B7C72] transition-colors hover:border-[#1B8C4B]/30 hover:text-[#14271C] disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:text-gray-400 dark:hover:text-white"

  return (
    <nav aria-label="แบ่งหน้า" className="flex items-center gap-1">
      <button type="button" aria-label="หน้าก่อนหน้า" disabled={current <= 1} onClick={() => onGo(current - 1)} className={step}>
        <ChevronLeft size={15} />
      </button>
      {pageWindow(current, count).map((n, i) => n === "gap" ? (
        <span key={`gap-${i}`} aria-hidden className="px-1 text-[12px] text-[#9AA8A0]">…</span>
      ) : (
        <button
          key={n}
          type="button"
          onClick={() => onGo(n)}
          aria-label={`หน้า ${n}`}
          aria-current={n === current ? "page" : undefined}
          className={[
            "size-8 shrink-0 rounded-[9px] border text-[12px] transition-colors",
            n === current
              ? "border-[#1B8C4B] bg-[#1B8C4B] font-semibold text-white"
              : "border-[#EEF2F0] text-[#6B7C72] hover:border-[#1B8C4B]/30 hover:text-[#14271C] dark:border-white/10 dark:text-gray-400 dark:hover:text-white",
          ].join(" ")}
        >
          {n}
        </button>
      ))}
      <button type="button" aria-label="หน้าถัดไป" disabled={current >= count} onClick={() => onGo(current + 1)} className={step}>
        <ChevronRight size={15} />
      </button>
    </nav>
  )
}

// ===========================================================================
// โมดัลรายละเอียด — เส้นทางสถานะ (ใครทำอะไรถึงขั้นไหนแล้ว) + ข้อมูลยาง + รูป
// ===========================================================================

type TimelineState = "done" | "current" | "todo" | "rejected"
/** `job` แยกจาก `note` เพราะต้อง render เป็นลิงก์ไป ATMS ไม่ใช่ข้อความเปล่า */
type TimelineStep = { key: string; label: string; at: string; by: string; note?: string; job?: string; state: TimelineState }

/**
 * เส้นทางสถานะของยางเส้นนี้ — อ่านจากฟิลด์ที่ API เขียนไว้ตอนกดแต่ละครั้ง
 * (approvedAt/By, appointmentAt/By, doneAt/By) ไม่ได้เดาเวลาจากสถานะปัจจุบัน
 * รายการที่ถูกปฏิเสธจบที่ 2 ขั้น — ไม่ต้องโชว์ขั้นที่ไปต่อไม่ได้แล้ว
 */
function timelineOf(row: TxRow): TimelineStep[] {
  const { request: r, item: it, stage } = row
  const step = STAGE_STEP[stage]

  const asked: TimelineStep = {
    key: "asked",
    label: "ยื่นคำขอเปลี่ยนยาง",
    at: it.createdAt || r.createdAt,
    by: r.requestedBy || r.driverName || "",
    note: r.source === "mobile" ? "จากมือถือคนขับ" : r.source === "web" ? "จากหน้าเว็บ" : undefined,
    state: "done",
  }

  if (stage === "rejected") {
    return [asked, {
      key: "rejected",
      label: "ปฏิเสธ",
      at: it.rejectedAt ?? r.rejectedAt ?? "",
      by: it.rejectedBy ?? r.rejectedBy ?? "",
      note: it.rejectReason || r.rejectReason || undefined,
      state: "rejected",
    }]
  }

  const appt = apptOf(r, it)
  return [
    asked,
    {
      key: "approved",
      label: "อนุมัติ",
      at: it.approvedAt ?? r.approvedAt ?? "",
      by: it.approvedBy ?? r.approvedBy ?? "",
      job: it.jobNo || undefined,
      state: step >= 2 ? "done" : "current",
    },
    {
      key: "appointment",
      label: "นัดหมายเปลี่ยน",
      at: it.appointmentAt ?? r.appointmentAt ?? "",
      by: it.appointmentBy ?? r.appointmentBy ?? "",
      note: appt ? `นัดวันที่ ${fmtDateOnly(appt)}` : undefined,
      state: step >= 3 ? "done" : step === 2 ? "current" : "todo",
    },
    {
      key: "done",
      label: "เปลี่ยนแล้ว (ปิดงาน)",
      // ปิดงานรายเส้นมาก่อน — ฟิลด์ระดับใบเหลือไว้เป็น fallback ของใบเก่าที่ปิดทีเดียวทั้งใบ
      at: it.doneAt ?? r.doneAt ?? "",
      by: it.doneBy ?? r.doneBy ?? "",
      state: step >= 4 ? "done" : step === 3 ? "current" : "todo",
    },
  ]
}

const STEP_DOT: Record<TimelineState, string> = {
  done:     "bg-[#1B8C4B] border-[#1B8C4B]",
  current:  "bg-white border-[#1B8C4B] dark:bg-[#151a10]",
  rejected: "bg-red-500 border-red-500",
  todo:     "bg-gray-200 border-gray-200 dark:bg-white/10 dark:border-white/10",
}

const STEP_TEXT: Record<TimelineState, string> = {
  done:     "text-[#14271C] dark:text-gray-200",
  current:  "font-semibold text-[#1B8C4B] dark:text-green-400",
  rejected: "font-semibold text-red-600 dark:text-red-400",
  todo:     "text-gray-400",
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]" style={fontThai}>
      <span className="shrink-0 text-[#9AA8A0]">{label}</span>
      <span className="text-right text-[#14271C] dark:text-white">{children}</span>
    </div>
  )
}

function TxDetailDialog({ row, acting, onClose, mr, mrAdvance, mrReload, ...actions }: {
  row:    TxRow | null
  acting: boolean
  onClose: () => void
  /** MR ของทะเบียนในแถวนี้ — undefined = ยังไม่ได้เช็ค, null = ยังไม่มีใบ */
  mr: MrSummary | null | undefined
  mrAdvance: (row: TxRow) => void
  /** แก้หมายเหตุในไทม์ไลน์แล้ว — ดึงหัวใบใหม่ให้ชิป/หมายเหตุล่าสุดตรงกับที่เพิ่งแก้ */
  mrReload: (row: TxRow) => void
} & Omit<RowActionProps, "row" | "acting">) {
  /**
   * ปุ่มในโมดัลต้องปิดโมดัลก่อนเสมอ — กล่องกรอก (SweetAlert / ปฏิทินนัดหมาย) เป็นชั้นซ้อน
   * ที่ดักโฟกัสของตัวเอง ถ้าเปิดค้างทับกันสองชั้นจะพิมพ์ในช่องกรอกไม่ได้
   */
  const wrapped: Omit<RowActionProps, "row" | "acting"> = {
    approve:  (r) => { onClose(); actions.approve(r) },
    reject:   (r) => { onClose(); actions.reject(r) },
    editJob:  (r) => { onClose(); actions.editJob(r) },
    appoint:  (r) => { onClose(); actions.appoint(r) },
    markDone: (r) => { onClose(); actions.markDone(r) },
    // แยกใบแล้ว requestId เปลี่ยน — openKey เดิม (`requestId|itemId`) จะหาแถวไม่เจอ
    // ถ้าไม่ปิดโมดัลก่อน ผู้ใช้จะเหลือโมดัลเปล่า ๆ ค้างอยู่
    splitOut: (r) => { onClose(); actions.splitOut(r) },
  }

  // ปุ่ม MR ก็เปิด SweetAlert เหมือนกัน — ต้องปิดโมดัลก่อนด้วยเหตุผลเดียวกับ wrapped ข้างบน
  const onMrAdvance = () => { if (row) { onClose(); mrAdvance(row) } }

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto sm:max-w-2xl"
        /**
         * เปิดมาให้โฟกัสอยู่ที่ตัวกล่อง ไม่ใช่ปุ่มตัวแรกในเนื้อหา
         * ปุ่มตัวแรกมักเป็นรูปถ่าย (รายการที่ยังไม่มีเลข Job จะไม่มีลิงก์อะไรมาก่อนรูป)
         * โฟกัสไปโดนแล้วได้กรอบเขียวคาไว้ที่รูปสุ่ม ๆ เหมือนผู้ใช้เลือกไว้เอง
         * Esc/Tab ยังทำงานปกติ เพราะ Radix ตั้ง tabIndex=-1 ให้กล่องอยู่แล้ว
         */
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const box = e.currentTarget as HTMLElement | null
          box?.focus?.()
        }}
      >
        {row && (
          <>
            <DialogHeader>
              <DialogTitle style={fontHead}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{row.plate}</span>
                  <span className="text-[13px] font-normal text-[#6B7C72] dark:text-gray-400" style={fontThai}>
                    {row.item.positionCode} {row.item.positionName}
                  </span>
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(row.stage)}`} style={fontThai}>
                {STATUS_LABEL[row.stage] ?? row.stage}
              </span>
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${branchChipCls(row.branch)}`} style={fontThai}>
                {branchLabel(row.branch)}
              </span>
              <span className="text-[11.5px] text-[#9AA8A0]" style={fontThai}>
                ยื่นมา {row.ageDays} วัน · {fmtDate(row.createdAt)}
              </span>
            </div>

            {/* MR — วางไว้เหนือเส้นทางสถานะ เพราะเป็นตัวที่บล็อกไม่ให้กดอนุมัติ ต้องเห็นก่อน */}
            {row.item.reason === "รถกินยาง" && (
              <MrPanel
                mr={mr}
                acting={acting}
                settled={row.stage === "done" || row.stage === "rejected"}
                onAdvance={onMrAdvance}
                onSaved={() => mrReload(row)}
              />
            )}

            {/* เส้นทางสถานะ */}
            <div className="rounded-[12px] border border-[#EEF2F0] p-3.5 dark:border-white/8">
              <p className="mb-1 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>เส้นทางสถานะ</p>
              <ol className="flex flex-col gap-2.5">
                {timelineOf(row).map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    <span className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full border-2 ${STEP_DOT[s.state]}`} />
                    <span className="min-w-0 leading-tight">
                      <span className={`block text-[12.5px] ${STEP_TEXT[s.state]}`} style={fontThai}>{s.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[#9AA8A0]" style={fontThai}>
                        {s.at ? fmtDate(s.at) : "—"}
                        {s.by ? ` · ${s.by}` : ""}
                        {s.note ? ` · ${s.note}` : ""}
                        {s.job && <> · <AtmsJobLink code={s.job} className="text-[11px]" iconSize={9} /></>}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/*
              ติดทางตัน — บอกให้ครบว่า "เกิดอะไรขึ้น" + "กดแล้วได้อะไร" แล้ววางปุ่มไว้ในกล่องนี้เลย
              ไม่ใช่ไปรวมกับปุ่มท้ายโมดัล เพราะปุ่มนี้เป็นทางออกของปัญหาที่อธิบายอยู่ตรงนี้
            */}
            {row.blocked && (
              <div className="rounded-[12px] border border-orange-300 bg-orange-50 p-3.5 dark:border-orange-400/40 dark:bg-orange-500/10" style={fontThai}>
                <p className="text-[13px] font-semibold text-orange-800 dark:text-orange-200">
                  ยางเส้นนี้ยังไม่ถูกอนุมัติ แต่คำขอใบนี้ถูกปิดไปแล้ว จึงกดอนุมัติหรือปฏิเสธไม่ได้
                </p>
                <p className="mt-1 text-[12px] text-orange-700 dark:text-orange-300">
                  กดแยกเป็นคำขอใหม่ แล้วยาง{row.blockedWith > 1 ? `ทั้ง ${row.blockedWith} เส้นที่ค้างอยู่` : "เส้นนี้"}จะไปอยู่ใบใหม่สถานะ &quot;รออนุมัติ&quot; —
                  อนุมัติต่อได้ทันที ยางที่ปิดงานไปแล้วในใบเดิมไม่เปลี่ยนแปลง
                </p>
                <div className="mt-2.5">
                  <SplitButton row={row} acting={acting} onClick={() => wrapped.splitOut(row)} full />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 rounded-[12px] bg-[#F6FAF7] p-3.5 dark:bg-white/4">
                <InfoRow label="สาเหตุ">{row.item.reason || "—"}</InfoRow>
                {row.item.jobNo && (
                  <InfoRow label="ใบแจ้งซ่อม ATMS">
                    <AtmsJobLink code={row.item.jobNo} className="text-[12.5px]" iconSize={10} />
                  </InfoRow>
                )}
                <InfoRow label="รุ่นยาง">{row.item.product || "—"}</InfoRow>
                <InfoRow label="Serial"><span className="font-mono">{row.item.serialNo || "—"}</span></InfoRow>
                <InfoRow label="ดอกยางที่วัดได้">{row.item.currentTreadMm > 0 ? `${row.item.currentTreadMm} มม.` : "—"}</InfoRow>
                <InfoRow label="ประสิทธิภาพคงเหลือ">{row.item.remainingPct !== null && row.item.remainingPct !== undefined ? `${row.item.remainingPct}%` : "—"}</InfoRow>
              </div>
              <div className="space-y-1.5 rounded-[12px] bg-[#F6FAF7] p-3.5 dark:bg-white/4">
                <InfoRow label="คนขับ">{row.request.driverName || "—"}</InfoRow>
                <InfoRow label="เบอร์รถ"><TruckNo value={row.request.truckNumber} className="text-[12.5px]" /></InfoRow>
                <InfoRow label="ไมล์ตอนขอ"><span className="font-mono">{fmtNum(row.request.currentOdometer)}</span></InfoRow>
                <InfoRow label="ไมล์ตอนใส่ยาง"><span className="font-mono">{fmtNum(row.item.mileageStart)}</span></InfoRow>
                <InfoRow label="ระยะทางใช้งาน"><span className="font-mono">{row.item.usedDistance > 0 ? `${fmtNum(row.item.usedDistance)} กม.` : "—"}</span></InfoRow>
              </div>
            </div>

            {row.item.note && (
              <p className="rounded-[11px] bg-[#F6FAF7] px-3 py-2 text-[12.5px] text-[#6B7C72] dark:bg-white/4 dark:text-gray-300" style={fontThai}>
                หมายเหตุ: {row.item.note}
              </p>
            )}

            {row.photos.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>
                  รูปถ่าย ({row.photos.length}) — คลิกเพื่อเปิดเต็ม
                </p>
                <div className="flex flex-wrap gap-2">
                  {row.photos.map((u, i) => <PhotoThumb key={i} src={u} alt={`รูปยาง ${i + 1}`} />)}
                </div>
              </div>
            )}

            {/* แถวติดทางตันมีปุ่มอยู่ในกล่องส้มด้านบนแล้ว — ไม่ต้องมีปุ่มเดียวกันซ้ำสองที่ */}
            {!row.blocked && (
              <div className="border-t border-[#EEF2F0] pt-3 dark:border-white/8">
                <RowActions row={row} acting={acting} {...wrapped} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
