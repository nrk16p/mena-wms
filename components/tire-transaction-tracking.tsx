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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Swal from "sweetalert2"
import {
  ArrowDown, ArrowUp, CalendarClock, Check, ChevronLeft, ChevronRight, FilePlus2, Flag,
  Inbox, ListFilter, Lock, RefreshCw, Search, X,
} from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AppointmentDialog, PhotoCell, PhotoThumb, STATUS_LABEL,
  branchChipCls, branchLabel, branchesFor, btnSmall, card,
  fmtDate, fmtDateOnly, fmtNum, fontHead, fontThai, inp,
  statusChip,
  type RequestItem, type StatTone, type TireRequest,
} from "@/components/tire-shared"
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
// ไม่แก้ตัวกลางใน tire-shared เพราะแท็บอื่นยังใช้หัวแบบอ่อนอยู่

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
  if (st !== "approved") return "pending"
  if ((r.status ?? "pending") === "done") return "done"
  return apptOf(r, it) ? "appointment" : "approved"
}

type LastAction = { label: string; by: string; at: string }

/** ใครทำอะไรล่าสุดกับเส้นนี้ — อ่านจากฟิลด์ที่ API เขียนไว้ ไม่ได้เดาจากสถานะเปล่า ๆ */
function lastActionOf(r: TireRequest, it: RequestItem, stage: TxStage): LastAction {
  switch (stage) {
    case "done":
      return { label: "ปิดงาน", by: r.doneBy ?? "", at: r.doneAt ?? "" }
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

type SortKey = "age" | "plate" | "position" | "reason" | "tread" | "stage" | "last"
type SortDir = "asc" | "desc"
type SortState = { key: SortKey; dir: SortDir } | null

/** ค่าที่ใช้เทียบเวลาเรียง — ตัวเลขเทียบด้วยตัวเลข ข้อความเทียบตามลำดับพจนานุกรมไทย */
const SORT_VALUE: Record<SortKey, (r: TxRow) => number | string> = {
  age:      (r) => r.ageDays,
  plate:    (r) => r.plate || "",
  position: (r) => r.item.positionCode || r.item.positionName || "",
  reason:   (r) => r.item.reason || "",
  tread:    (r) => r.item.currentTreadMm || 0,
  stage:    (r) => STAGE_STEP[r.stage],
  last:     (r) => timeOf(r.last.at) || 0,
}

type FacetKey = "plate" | "position" | "reason" | "stage"

const FACET_KEYS = ["plate", "position", "reason", "stage"] as const

/**
 * ค่าที่โผล่ในรายการติ๊กของแต่ละคอลัมน์ — ต้องเป็น "ข้อความเดียวกับที่เห็นในเซลล์"
 * ไม่ใช่ค่าดิบในฐานข้อมูล ไม่งั้นผู้ใช้ติ๊กแล้วหาไม่เจอว่าตรงกับแถวไหน
 */
const FACET_VALUE: Record<FacetKey, (r: TxRow) => string> = {
  plate:    (r) => r.plate || "—",
  position: (r) => r.item.positionName || r.item.positionCode || "ไม่ระบุตำแหน่ง",
  reason:   (r) => r.item.reason || "ไม่ระบุสาเหตุ",
  stage:    (r) => STATUS_LABEL[r.stage] ?? r.stage,
}

type FacetState = Record<FacetKey, string[]>
type FacetOption = { value: string; count: number }

/** ค่าเริ่มต้น: ไม่ติ๊กอะไรเลย = ไม่กรอง (ไม่ใช่ติ๊กครบแบบ Excel — ไม่ต้องมาไล่เอาติ๊กออก) */
const NO_FACETS: FacetState = { plate: [], position: [], reason: [], stage: [] }

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

  // เปลี่ยนตัวกรองแล้วกลับหน้า 1 — ปรับ state ตอน render (กฎ react-hooks ห้ามย้ายไปไว้ใน effect)
  // การเรียงไม่นับ: จำนวนแถวเท่าเดิม อยู่หน้าไหนก็ยังมีของ ไม่ต้องเด้งกลับหน้าแรก
  const facetKey = FACET_KEYS.map((k) => k + ":" + facets[k].join(",")).join(";")
  const filterKey = `${q}|${stage}|${stuckOnly}|${blockedOnly}|${perPage}|${facetKey}`
  const [lastKey, setLastKey] = useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setPage(1)
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

  /**
   * อนุมัติ — ยางที่สาเหตุ "รถกินยาง" ต้องปิด MR ก่อน (กติกาเดียวกับหน้ารายละเอียดรถ)
   * เช็ค MR ตอนกด ไม่ใช่โหลดล่วงหน้าทุกแถว — หน้านี้เป็นตารางยาว จะยิงเปล่าเยอะเกินจำเป็น
   */
  async function approve(row: TxRow) {
    if (row.item.reason === "รถกินยาง") {
      const mr = await fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(row.branch)}&plates=${encodeURIComponent(row.plate)}`)
        .then((r) => r.json()).then((d) => d[row.plate] ?? null).catch(() => null)
      if (!mr || mr.status !== "completed") {
        await Swal.fire({
          icon: "warning",
          title: "รอ MR ซ่อมเสร็จก่อน",
          html: `ยางเส้นนี้สาเหตุ <b>รถกินยาง</b><br>ต้องปิด MR ก่อนจึงจะอนุมัติได้ — สร้าง/ปิด MR ได้ที่แท็บ "คำขอ / อนุมัติ"`,
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

  async function reject(row: TxRow) {
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "ปฏิเสธยางเส้นนี้?",
      html: `<code style="font-size:0.8rem;opacity:0.65">${tireLabel(row)}</code>`,
      input: "textarea",
      inputLabel: "เหตุผลการปฏิเสธ (ไม่บังคับ)",
      inputAttributes: { rows: "3" },
      showCancelButton: true,
      confirmButtonText: "ยืนยันปฏิเสธ",
      confirmButtonColor: "#dc2626",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    itemPatch(row, { action: "reject", reason: value ?? "" }, `ปฏิเสธ ${row.item.positionCode || row.item.serialNo} แล้ว`)
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
   * ปิดงาน — เป็นการกระทำระดับ "คำขอ" ไม่ใช่รายเส้น (ฝั่ง API มีแค่แบบนี้)
   * กล่องยืนยันจึงบอกจำนวนเส้นที่จะถูกปิดไปด้วย ผู้ใช้จะได้ไม่คิดว่าปิดแค่แถวที่กด
   */
  async function markDone(row: TxRow) {
    const siblings = (row.request.items ?? []).filter((it) => (it.status ?? "pending") === "approved")
    const result = await swalConfirm(
      "ปิดงานเปลี่ยนยาง?",
      `${row.plate} · ${row.request.driverName} — ปิดทั้งคำขอ ${siblings.length} เส้น (${siblings.map((it) => it.positionCode || "—").join(", ")})`,
    )
    if (!result.isConfirmed) return
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${row.request._id}`, {
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
            placeholder="ค้นหาทะเบียน / คนขับ / ล้อ / Serial / เลข Job..."
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

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-[10px] border border-[#EEF2F0] px-2.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:bg-[#F0FDF4] disabled:opacity-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          style={fontThai}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> รีเฟรช
        </button>
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

      {/* ── ตาราง (จอ ≥md) ── */}
      <div className={card + " hidden overflow-x-auto md:block"}>
        <table className="w-full text-sm">
          <thead>
            <tr className={txTheadCls}>
              <ColHead ctx={headCtx} label="อายุคำขอ" width="w-24"
                sortKey="age" sortLabels={["ใหม่สุดก่อน", "ค้างนานสุดก่อน"]} />
              <ColHead ctx={headCtx} label="ผู้แจ้ง / ทะเบียน" width="w-42"
                sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
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
              <tr><td colSpan={9} className="px-4 py-14 text-center text-sm text-gray-400" style={fontThai}>
                <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-gray-300 dark:text-gray-600" />
                กำลังโหลด...
              </td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={9}>
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
                {/* ── อายุคำขอ: ตัวเลขวันเป็นตัวเด่น วันที่แจ้งเป็นบรรทัดรอง ── */}
                <td className={txTdCls}>
                  <span className={`block text-[17px] leading-none font-bold ${row.stuck ? "text-red-600 dark:text-red-400" : "text-[#14271C] dark:text-white"}`}>
                    {row.ageDays}
                    <span className="ml-1 text-[10px] font-normal text-[#9AA8A0]" style={fontThai}>วัน</span>
                  </span>
                  <span className="mt-1 block text-[10.5px] text-[#9AA8A0]" style={fontThai}>{fmtDateOnly(row.createdAt)}</span>
                </td>

                {/* ── ใครแจ้ง: ทะเบียนเป็นพระเอก แล้วไล่ลงมาเป็นสาขา/เบอร์รถ → คนขับ ── */}
                <td className={txTdCls}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[13.5px] font-bold text-[#14271C] dark:text-white">{row.plate}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${branchChipCls(row.branch)}`} style={fontThai}>
                      {branchLabel(row.branch)}
                    </span>
                   
                  </span>
                   {row.request.truckNumber && (
                      <span className="text-[10.5px] text-[#9AA8A0]" style={fontThai}>เบอร์ {row.request.truckNumber}</span>
                    )}
                  </span>
                  
                  <span
                    className="mt-1 block truncate text-[12px] text-[#6B7C72] dark:text-gray-400"
                    style={fontThai}
                    title={row.request.driverName || undefined}
                  >
                    {row.request.driverName || "ไม่ระบุคนขับ"}
                  </span>
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
                <span className="font-mono text-[14px] font-bold text-[#14271C] dark:text-white">{row.plate}</span>
                {row.blocked && <BlockedBadge />}
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${branchChipCls(row.branch)}`} style={fontThai}>
                  {branchLabel(row.branch)}
                </span>
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

  // ปิดงานเป็นการกระทำระดับคำขอ — ทำได้เมื่อคำขอนั้นถึงขั้นนัดหมายครบแล้ว
  if (row.stage === "appointment" && row.request.status === "appointment") {
    btns.push(
      <button key="done" disabled={acting} onClick={() => markDone(row)}
        className={btnSmall + " inline-flex cursor-pointer items-center gap-1 bg-[#1B8C4B] text-white"} style={fontThai}>
        <Flag size={11} /> ปิดงาน
      </button>,
    )
  }

  // เลข Job แสดงเป็นลิงก์ ATMS อยู่ในคอลัมน์รายการแล้ว — ตรงนี้เหลือแค่ปุ่มแก้
  // (ถ้าเอาตัวเลขมาทำปุ่มแก้ด้วย จะกลายเป็นเลขเดียวกันสองที่ที่กดแล้วไปคนละทาง)
  if ((row.item.status ?? "pending") === "approved" && row.stage !== "done") {
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
      at: r.doneAt ?? "",
      by: r.doneBy ?? "",
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

function TxDetailDialog({ row, acting, onClose, ...actions }: {
  row:    TxRow | null
  acting: boolean
  onClose: () => void
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
                <InfoRow label="เบอร์รถ">{row.request.truckNumber || "—"}</InfoRow>
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
