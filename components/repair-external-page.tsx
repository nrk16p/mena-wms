"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Search, Plus, Pencil, Trash2, X, Wrench, Check, ChevronDown, Flag, History, ArrowRight, Table as TableIcon, Columns3, MessageSquare, Send, CornerDownRight, Copy, Link2, Megaphone, ClipboardList } from "lucide-react"
import { swalDeleteConfirm, swalConfirm, swalToast, swalError } from "@/lib/swal"
import { ImageUpload } from "@/components/image-upload"
import type { SkuImage } from "@/lib/media"
import {
  REPAIR_STATUSES,
  REPAIR_STATUS_VALUES,
  REPAIR_DONE_STATUS,
  PARTS_STATUSES,
  PARTS_DONE_STATUS,
  JOB_TYPE_GARAGE,
  JOB_TYPE_PARTS,
  jobTypeOf,
  isDoneStatus,
  jobStartDate,
  statusesFor,
  doneStatusFor,
  requiredFieldsFor,
  REPAIR_STATUS_SLA_DAYS,
  REPAIR_SLA_NOTE,
  WARRANTY_OPTIONS,
  statusMeta,
  buildRepairSummary,
  type RepairExternal,
  type RepairField,
} from "@/lib/repair-external"
import { bkkToday, bkkDate as bkkDateOf, daysSince } from "@/lib/bkk-time"

type Mode = "active" | "done"
// สถานะที่เลือกได้ในตัวกรอง (ตัดสถานะปิดงานออก) — แยกต่อประเภทงาน
const ACTIVE_STATUSES       = REPAIR_STATUSES.filter((s) => s.value !== REPAIR_DONE_STATUS)
const PARTS_ACTIVE_STATUSES = PARTS_STATUSES.filter((s) => s.value !== PARTS_DONE_STATUS)

// สีทึบต่อสถานะ (progress bar + accent การ์ด kanban)
const BAR_COLORS: Record<string, string> = {
  "รอรถเข้า":         "#9ca3af",
  "รถเข้าอู่ซ่อม":     "#3b82f6",
  "รอใบเสนอราคา":     "#06b6d4",
  "รอ PR":            "#eab308",
  "ซ่อมไม่มีกำหนด":    "#f97316",
  "ซ่อมมีกำหนดเสร็จ":  "#14b8a6",
  "รถเสร็จ(ไม่มี PR)": "#84cc16",
  "รถเสร็จ":          "#22c55e",
  // อะไหล่ลงคัน
  "รอดำเนินการ":      "#9ca3af",
  "สั่งซื้อแล้ว-รอของ": "#f97316",
  "ของถึง-รอลงคัน":   "#14b8a6",
  "ลงคันเสร็จ":       "#22c55e",
}
const barColor = (s: string) => BAR_COLORS[s] ?? "#9ca3af"

// คอลัมน์ตารางโปร่ง (1a): อายุงาน / รถ / อาการ / อู่ / สถานะ·เอกสาร / จัดการ
// 5 คอลัมน์ (ไม่มี "จัดการ" — คลิกแถวเพื่อแก้ไข/ลบจากในฟอร์ม): อายุ | รถ | อาการ+อู่ | สถานะ·เอกสาร | กำหนด
const TABLE_GRID = "110px 1.7fr 2.9fr 2fr 130px"

// จานสีสำหรับสัดส่วนตามฟลีท
const FLEET_PALETTE = ["#1B8C4B", "#3b82f6", "#eab308", "#f97316", "#14b8a6", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#ef4444", "#8b5cf6", "#64748b"]

type Comment = {
  _id: string
  parentId: string | null
  text: string
  by: string
  byEmail: string
  at: string
}

type LogChange = { field: string; label: string; from: string; to: string }
type LogEntry = {
  _id: string
  action: "create" | "update" | "delete"
  by: string
  byEmail: string
  at: string
  statusChange?: { from: string; to: string }
  changes?: LogChange[]
}

type Stats = {
  counts: Record<string, number>
  countsByType?: Record<string, Record<string, number>>
  total: number
  overdue: number
  slaBreached: number
  noPr: number
  avgDays: number
  avgByStatus: Record<string, number>
  agingBuckets: { lt8: number; d8_14: number; gte15: number }
  fleetDist: { fleet: string; count: number }[]
  garageDist?: { garage: string; count: number; lt8: number; d8_14: number; gte15: number; maxDays: number; avgDays: number }[]
  garageDupes?: { names: string[]; total: number }[]
}

// "วันนี้" ตามเวลาไทย — เรียกทุกครั้งที่ render (ค่าคงที่ระดับ module จะค้างเมื่อเปิดหน้าข้ามวัน)
const todayStr = () => bkkToday()

// คัดลอกข้อความไปคลิปบอร์ด + toast (ข้ามค่าว่าง/"—")
async function copyValue(v: string) {
  const val = (v ?? "").trim()
  if (!val || val === "—") return
  try { await navigator.clipboard.writeText(val); swalToast("success", `คัดลอก ${val} แล้ว`) }
  catch { swalError("คัดลอกไม่สำเร็จ") }
}

const fmtDateTime = (s: string) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

// แสดงค่าฟิลด์ใน log ให้อ่านง่าย (ว่าง → "(ว่าง)")
const showVal = (v: string) => (v === "" || v == null ? "(ว่าง)" : v)

// จำนวนวันตั้งแต่วันรับแจ้ง → วันนี้ (นับตามปฏิทินไทย ไม่ใช่ช่วง 24 ชม.)
const ageDays = (s: string): number | null => daysSince(s)

// พิกัดที่รถเสีย → ลิงก์แผนที่ (รับทั้งลิงก์เต็มและ lat,long)
const mapUrl = (v: string): string | null => {
  const t = (v ?? "").trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(t)) return `https://www.google.com/maps?q=${encodeURIComponent(t)}`
  return null
}

// สีตามช่วงอายุงาน (bucket) สำหรับ pill/ตัวเลข
const agingBucket = (days: number): { text: string; bg: string } =>
  days >= 15 ? { text: "#DC2626", bg: "#FEECEC" } :
  days >= 8  ? { text: "#B07D12", bg: "#FEF7E6" } :
               { text: "#1B8C4B", bg: "#ECFDF3" }

// SLA: เหลือกฎเดียว — "รอ PR" ค้างได้ไม่เกิน 24 ชม. นับจากเวลาที่เข้าสถานะ
// รายการใหม่มี statusSinceAt (เวลาเต็ม) → นับชั่วโมงจริง · รายการเก่ามีแต่วันที่ → ประมาณเป็นวัน×24
const slaInfo = (r: RepairExternal): { hours: number; limitH: number; over: boolean } | null => {
  const limitDays = REPAIR_STATUS_SLA_DAYS[r.status]
  if (!limitDays) return null
  let hours: number
  if (r.statusSinceAt) {
    hours = Math.max(0, Math.floor((Date.now() - Date.parse(r.statusSinceAt)) / 3600000))
  } else {
    const d = ageDays(r.statusSince || jobStartDate(r))
    if (d === null) return null
    hours = d * 24
  }
  const limitH = limitDays * 24
  return { hours, limitH, over: hours > limitH }
}

type Garage = { _id: string; name: string }

const EMPTY: Omit<RepairExternal, "_id"> = {
  jobType: JOB_TYPE_GARAGE,
  receivedDate: "", garageInDate: "", dueDate: "", completedDate: "", mrNo: "", symptom: "", plate: "", fleetNo: "",
  driverName: "", driverPhone: "", breakdownLocation: "", cementStatus: "", drivableStatus: "",
  fleet: "", plant: "",
  garage: "", status: REPAIR_STATUS_VALUES[0], waitingQuote: "", prCode: "", poCode: "",
  note: "", repairPrice: 0, warranty: "", quotationDetail: "",
  negotiationScope: "ทั้งหมด", negotiationItem: "",
  offerPrice: 0, negotiatedPrice: 0, offerWarranty: "",
  statusSince: "",
}

const fmtNum = (n: number) =>
  (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// dd/mm/yy (ปีย่อ 2 หลัก) — สำหรับตารางแบบกระชับ
const fmtDateShort = (s: string) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const labelCls = "mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"

// สถานะรายวันล่าสุดของรถ (A/B/BA/...) จาก mena-intelligence performance_vehicle_daily
type DailyStatus = { status: string; label: string; group: string; date: string; streak_days?: number; streak_capped?: boolean; last_bba_date?: string | null; back_to_work_date?: string | null }
// ผลวิเคราะห์ความสอดคล้อง งานซ่อม ↔ สถานะรถรายวันจริง
type JobAlert = { kind: "update_needed" | "waiting_real"; text: string; title: string }
const DAILY_GROUP_CLS: Record<string, string> = {
  working: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  repair:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  idle:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  unknown: "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400",
}

// สถานะงานอู่นอกที่ "รถควรอยู่อู่" — ถ้าสถานะรายวันของรถเป็นกลุ่มทำงาน (A/AX/...) = ข้อมูลขัดแย้ง
// (ไม่รวม "รอรถเข้า" เพราะรถอาจยังวิ่งงานอยู่ก่อนเข้าอู่ · ไม่รวมงานอะไหล่ลงคันเพราะรถวิ่งได้ระหว่างรอของ)
const IN_GARAGE_STATUSES = new Set(["รถเข้าอู่ซ่อม", "รอใบเสนอราคา", "รอ PR", "ซ่อมไม่มีกำหนด", "ซ่อมมีกำหนดเสร็จ"])

// ── ข้อมูลเทียบจาก /api/repair-external/atms-board (ATMS open-jobs × รถจอดจริง × WMS) ──
const atmsKey = (s: string) => (s ?? "").replace(/[\s.]/g, "").trim().toUpperCase()
type AtmsWmsRef  = { id: string; status: string; mrNo: string; mrMatch: "match" | "mismatch" | "empty" }
type AtmsPending = {
  plate: string; trucknum: string; days: number; since: string; subStatus: string; plant: string
  mrCode: string; mrId: number; step: string; stepAt: string; vendor: string; severity: string
  prAmount: number; expectedDone: string; wms: AtmsWmsRef | null
}
type AtmsBoard = {
  ok: boolean
  fetchedAt: string
  pending: AtmsPending[]
  missing: AtmsPending[]
  waitingButParked: { id: string; plate: string; fleetNo: string; days: number; since: string; plant: string }[]
  openNotParked: { id: string; plate: string; fleetNo: string; status: string; receivedDate: string; dueDate: string; atmsStep: string }[]
  prFill: { id: string; plate: string; fleetNo: string; status: string; mrCode: string; prCodes: string[]; poCodes: string[]; poEmpty: boolean; mrConflict: boolean; wmsMr: string }[]
  byKey: Record<string, { parkedDays: number | null; since: string; step: string; stepAt: string; vendor: string; mrCode: string; mrId: number }>
}
// รายการจาก /maintenance-requests (ATMS) — เก็บเฉพาะ field ที่ใช้แสดง timeline
type AtmsTlItem = {
  code?: string
  branch_name?: string
  mechanic_name?: string
  tasks?: { problem?: string; maintenance_type?: string }[]
  purchase_requests?: {
    pr_code?: string; amount?: number; is_approved?: number
    purchase_orders?: { po_code?: string; supplier?: string; received_status?: string }[]
  }[]
  timeline_events?: { kind?: string; source?: string; at?: string; label?: string; action_by?: string; uid?: string }[]
}

export function RepairExternalPage({ mode = "active" }: { mode?: Mode }) {
  const isDone = mode === "done"
  const [rows, setRows]       = useState<RepairExternal[]>([])
  // สถานะรายวันต่อทะเบียน — โหลด batch หลังได้รายการงาน
  const [dailyStatus, setDailyStatus] = useState<Record<string, DailyStatus>>({})
  // กรองเฉพาะรายการสถานะขัดแย้ง (งานซ่อมไม่ปิดแต่รถวิ่งงาน)
  const [conflictOnly, setConflictOnly] = useState(false)
  const [garages, setGarages] = useState<Garage[]>([])
  const [loading, setLoading] = useState(true)

  // ดึงสถานะรายวันของทุกทะเบียนในหน้า (ผ่าน proxy → mena-intelligence, cache 5 นาที) — fail-soft
  useEffect(() => {
    const plates = [...new Set(rows.map((r) => r.plate).filter(Boolean))].slice(0, 100)
    if (!plates.length) { setDailyStatus({}); return }
    fetch(`/api/repair-external/daily-status?plates=${encodeURIComponent(plates.join(","))}`)
      .then((res) => res.json())
      .then((d) => setDailyStatus(d.statuses ?? {}))
      .catch(() => {})
  }, [rows])

  // ── เทียบกับ ATMS + รถจอดจริง (fleet) — โหลดตอนเข้าหน้า cache ฝั่ง server 5 นาที (fail-soft) ──
  const [atms, setAtms]         = useState<AtmsBoard | null>(null)
  const [atmsOpen, setAtmsOpen] = useState(false)
  const loadAtmsBoard = useCallback(() => {
    fetch("/api/repair-external/atms-board")
      .then((res) => res.json())
      .then((d) => { if (d?.ok) setAtms(d) })
      .catch(() => {})
  }, [])
  useEffect(() => { if (!isDone) loadAtmsBoard() }, [isDone, loadAtmsBoard])
  // key เทียบทะเบียน/เบอร์รถ — ตัดช่องว่างและจุด (ให้ตรงกับ normKey ฝั่ง server)
  const atmsOf = (r: RepairExternal) =>
    atms?.byKey[atmsKey(r.plate)] ?? (r.fleetNo ? atms?.byKey[atmsKey(r.fleetNo)] : undefined)

  // ── ยืนยันตรวจเช็คประจำวัน — จดเวลา+ผู้เช็คต่อรายการ badge เขียวเมื่อเช็คแล้ววันนี้ ──
  // วันเวลาไทย (+7) — ใช้ helper กลางจาก lib/bkk-time
  const bkkDate = (iso?: string) => (iso ? bkkDateOf(iso) : bkkToday())
  const checkedToday = (r: RepairExternal) => !!r.lastCheckedAt && bkkDate(r.lastCheckedAt) === bkkDate()
  // สถานะที่ไม่ต้องเช็คประจำวัน — งานแขวนยาว/รอปิดเอกสาร ไม่นับและไม่โชว์ปุ่ม
  const NO_DAILY_CHECK = new Set(["ซ่อมไม่มีกำหนด", "รถเสร็จ(ไม่มี PR)"])
  const needsDailyCheck = (r: RepairExternal) => !isDoneStatus(r.status) && !NO_DAILY_CHECK.has(r.status)
  const [uncheckedOnly, setUncheckedOnly] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  async function confirmCheck(r: RepairExternal) {
    setChecking(r._id)
    try {
      const res = await fetch(`/api/repair-external/${r._id}/check`, { method: "POST" })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || "ยืนยันไม่สำเร็จ")
      const patch = (x: RepairExternal): RepairExternal => ({
        ...x,
        lastCheckedAt: d.lastCheckedAt,
        lastCheckedBy: d.lastCheckedBy,
        dailyChecks: (x.dailyChecks ?? []).some((c) => c.date === d.date)
          ? x.dailyChecks
          : [...(x.dailyChecks ?? []), { date: d.date, by: d.lastCheckedBy, at: d.lastCheckedAt }],
      })
      setRows((rs) => rs.map((x) => (x._id === r._id ? patch(x) : x)))
      setEditRow((er) => (er && er._id === r._id ? patch(er) : er))
      swalToast("success", `✅ เช็คแล้ว — ${r.fleetNo || r.plate}`)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ยืนยันไม่สำเร็จ")
    } finally {
      setChecking(null)
    }
  }

  // filters
  const [q, setQ]               = useState("")
  // deep link: /repair-external?q=<ทะเบียน|เบอร์รถ|MR> — ใช้แชร์ลิงก์ให้ทีมเปิดมาเจอคันนั้นทันที
  useEffect(() => {
    try {
      const uq = new URLSearchParams(window.location.search).get("q")
      if (uq) setQ(uq)
    } catch { /* ignore */ }
  }, [])
  const [fType, setFType]       = useState("")   // "" = ทั้งหมด | อู่นอก | อะไหล่ลงคัน
  const [fStatus, setFStatus]   = useState("")
  const [fGarage, setFGarage]   = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo]     = useState("")

  // modal
  const [open, setOpen]     = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  // เปิดรายการเดิม = ดูรายละเอียดก่อน (อ่านอย่างเดียว) ต้องกด "แก้ไขข้อมูล" ถึงเข้าฟอร์ม
  const [viewOnly, setViewOnly] = useState(false)
  const [form, setForm]     = useState<Omit<RepairExternal, "_id">>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [origStatus, setOrigStatus] = useState("")  // สถานะเดิมของรายการ (ล็อกถ้ารถเสร็จ)
  const [editRow, setEditRow] = useState<RepairExternal | null>(null)  // record ที่กำลังแก้ (ใช้กับปุ่มประวัติ/ลบในฟอร์ม)
  const [formImages, setFormImages] = useState<SkuImage[]>([])
  const [formNegImages, setFormNegImages] = useState<SkuImage[]>([])  // หลักฐานการต่อรอง
  const [formQuotImages, setFormQuotImages] = useState<SkuImage[]>([])  // ใบเสนอราคา (PDF/รูป)
  const [vdRef, setVdRef] = useState("")  // วันที่ข้อมูล fleet/plant (จาก vehicle_daily)

  // comments (drawer)
  const [comments, setComments]   = useState<Comment[]>([])
  const [cmtLoading, setCmtLoading] = useState(false)
  const [cmtText, setCmtText]     = useState("")
  const [replyTo, setReplyTo]     = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [posting, setPosting]     = useState(false)

  // Timeline ATMS ใน modal (โหลดเมื่อกด) — เฉพาะงานอู่นอก
  const [atmsTl, setAtmsTl]               = useState<AtmsTlItem[] | null>(null)
  const [atmsTlLoading, setAtmsTlLoading] = useState(false)
  const [atmsTlErr, setAtmsTlErr]         = useState("")

  // log drawer
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [showFieldLog, setShowFieldLog] = useState(false)  // การแก้ field อื่น — พับไว้ (โฟกัสที่สถานะ)

  // view + สรุปสถานะ
  const [view, setView]   = useState<"table" | "board">("table")
  const [stats, setStats] = useState<Stats>({ counts: {}, total: 0, overdue: 0, slaBreached: 0, noPr: 0, avgDays: 0, avgByStatus: {}, agingBuckets: { lt8: 0, d8_14: 0, gte15: 0 }, fleetDist: [], garageDist: [], garageDupes: [] })
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)

  // ตัวกรอง ฟลีท + ค้างเกิน SLA
  const [fFleet, setFFleet]     = useState("")
  const [slaOnly, setSlaOnly]   = useState(false)
  const [noPrOnly, setNoPrOnly] = useState(false)
  const [fleetOptions, setFleetOptions] = useState<string[]>([])
  // การ์ดสัดส่วน: ดูตามฟลีท หรือ จำนวนรถต่ออู่
  const [distBy, setDistBy] = useState<"fleet" | "garage">("fleet")
  const [showAllGarages, setShowAllGarages] = useState(false)
  const [showDupes, setShowDupes] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set("scope", mode)
    if (q)        p.set("q", q)
    if (fType)      p.set("type", fType)
    if (fStatus)    p.set("status", fStatus)
    if (fGarage)    p.set("garage", fGarage)
    if (fFleet)     p.set("fleet", fFleet)
    if (dateFrom) p.set("dateFrom", dateFrom)
    if (dateTo)   p.set("dateTo", dateTo)
    try {
      const res  = await fetch(`/api/repair-external?${p.toString()}`)
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch {
      swalError("โหลดข้อมูลไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [mode, q, fType, fStatus, fGarage, fFleet, dateFrom, dateTo])

  const loadGarages = useCallback(async () => {
    try {
      const res  = await fetch("/api/garage-master")
      const data = await res.json()
      setGarages(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const res  = await fetch(`/api/repair-external/stats?scope=${mode}${fType ? `&type=${encodeURIComponent(fType)}` : ""}`)
      const data = await res.json()
      setStats(data && typeof data === "object" && data.counts ? data : { counts: {}, total: 0, overdue: 0, slaBreached: 0, noPr: 0, avgDays: 0, avgByStatus: {}, agingBuckets: { lt8: 0, d8_14: 0, gte15: 0 }, fleetDist: [], garageDist: [], garageDupes: [] })
    } catch { /* ignore */ }
  }, [mode, fType])

  const loadFleets = useCallback(async () => {
    try {
      const res  = await fetch("/api/vehicle-daily?fleets=1")
      const data = await res.json()
      setFleetOptions(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadGarages() }, [loadGarages])
  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadFleets() }, [loadFleets])
  // เปิดรายการจากลิงก์แชร์ ?id= (ครั้งเดียวตอนโหลด)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id")
    if (id) openById(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // เติม ฟลีท/แพล้นท์ อัตโนมัติเมื่อทะเบียนเปลี่ยน (พิมพ์เอง/เลือกก็ได้) — debounce
  useEffect(() => {
    if (!open || !form.plate.trim()) return
    const t = setTimeout(() => fillVehicleDaily(form.plate), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.plate])
  // ค้นหาจากเบอร์รถ → เติมทะเบียน/ฟลีท/แพล้นท์ — debounce
  useEffect(() => {
    if (!open || !form.fleetNo.trim()) return
    const t = setTimeout(() => fillByFleetNo(form.fleetNo), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.fleetNo])
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  async function loadComments(id: string) {
    setCmtLoading(true)
    try {
      const res  = await fetch(`/api/repair-external/${id}/comment`)
      const data = await res.json()
      setComments(Array.isArray(data) ? data : [])
    } catch { setComments([]) } finally { setCmtLoading(false) }
  }
  async function postComment(text: string, parentId: string | null) {
    const targetId = editId   // ความคิดเห็นอยู่ในฟอร์มแก้ไขเท่านั้น (drawer แยกถูกถอดออกแล้ว)
    if (!targetId || !text.trim()) return
    setPosting(true)
    try {
      const res = await fetch(`/api/repair-external/${targetId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), parentId }),
      })
      if (!res.ok) throw new Error()
      await loadComments(targetId)
      setCmtText(""); setReplyText(""); setReplyTo(null)
    } catch {
      swalError("ส่งความคิดเห็นไม่สำเร็จ")
    } finally {
      setPosting(false)
    }
  }

  function openAdd() {
    setEditId(null)
    setViewOnly(false)
    setEditRow(null)
    setFormImages([]); setFormNegImages([]); setFormQuotImages([]); setVdRef(""); setOrigStatus("")
    // ประเภทเริ่มต้นตาม tab ที่กรองอยู่ (เปลี่ยนได้ใน step 1)
    const jt = fType === JOB_TYPE_PARTS ? JOB_TYPE_PARTS : JOB_TYPE_GARAGE
    setForm({
      ...EMPTY,
      jobType: jt,
      receivedDate: bkkToday(),
      status: isDone ? doneStatusFor(jt) : statusesFor(jt)[0].value,
    })
    setOpen(true)
  }

  // สร้างรายการใหม่จากงานอู่นอกใน ATMS ที่ยังไม่มีในระบบ — prefill จากข้อมูลจริง (คนตรวจแล้วกดบันทึกเอง)
  function openAddFromAtms(m: AtmsPending) {
    setEditId(null)
    setViewOnly(false)
    setEditRow(null)
    setFormImages([]); setFormNegImages([]); setFormQuotImages([]); setVdRef(""); setOrigStatus("")
    const today = bkkToday()
    setForm({
      ...EMPTY,
      jobType: JOB_TYPE_GARAGE,
      plate: m.plate,
      fleetNo: m.trucknum,
      mrNo: m.mrCode,
      garage: m.vendor,
      plant: m.plant,
      receivedDate: m.since || today,
      garageInDate: m.since || today,   // รถจอดอยู่อู่แล้ว → เข้าอู่ตั้งแต่วันเริ่มจอด
      dueDate: m.expectedDone || "",
      status: "รถเข้าอู่ซ่อม",
    })
    setOpen(true)
  }

  // เปิดแก้ไขรายการพร้อมเติม mrNo จาก ATMS (กรณี WMS ไม่มี MR หรือ MR ไม่ตรง) — คนตรวจแล้วกดบันทึกเอง
  function openEditFillMr(wmsId: string, mrCode: string) {
    const r = rows.find((x) => x._id === wmsId)
    if (!r) { swalError("ไม่พบรายการในหน้านี้ — ลองล้างตัวกรองก่อน"); return }
    openEdit(r, true)
    setForm((f) => ({ ...f, mrNo: mrCode }))
  }

  // เปิดแก้ไขพร้อมเติม PR (และ PO ถ้ายังว่าง) จาก purchase_links ของ ATMS — คนตรวจแล้วกดบันทึกเอง
  function openEditFillPr(p: AtmsBoard["prFill"][number]) {
    const r = rows.find((x) => x._id === p.id)
    if (!r) { swalError("ไม่พบรายการในหน้านี้ — ลองล้างตัวกรองก่อน"); return }
    openEdit(r, true)
    setForm((f) => ({
      ...f,
      prCode: f.prCode?.trim() ? f.prCode : p.prCodes.join(","),
      poCode: f.poCode?.trim() ? f.poCode : p.poCodes.join(","),
      mrNo:   f.mrNo?.trim()   ? f.mrNo   : p.mrCode,
    }))
  }

  // เปลี่ยนประเภทงานในฟอร์ม (เฉพาะตอนสร้างใหม่) — รีเซ็ตสถานะเป็นขั้นแรกของ workflow ประเภทนั้น
  function setJobType(jt: string) {
    setForm((f) => ({ ...f, jobType: jt, status: isDone ? doneStatusFor(jt) : statusesFor(jt)[0].value }))
  }
  function openEdit(r: RepairExternal, startEditing = false) {
    setEditId(r._id)
    setViewOnly(!startEditing)
    setEditRow(r)
    setFormImages(r.images ?? []); setFormNegImages(r.negotiationImages ?? []); setFormQuotImages(r.quotationImages ?? []); setVdRef(""); setOrigStatus(r.status)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = r
    setForm({ ...EMPTY, ...rest })
    setComments([]); setCmtText(""); setReplyTo(null); setReplyText("")
    setAtmsTl(null); setAtmsTlErr("")
    loadComments(r._id)
    loadLog(r)
    setOpen(true)
  }

  // ยกเลิกการแก้ไข: รายการเดิม → ทิ้งที่แก้ค้างไว้ กลับไปหน้ารายละเอียด · รายการใหม่ → ปิด modal
  function cancelEdit() {
    if (!editId || !editRow) { setOpen(false); return }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = editRow
    setForm({ ...EMPTY, ...rest })
    setFormImages(editRow.images ?? []); setFormNegImages(editRow.negotiationImages ?? []); setFormQuotImages(editRow.quotationImages ?? [])
    setViewOnly(true)
  }

  // โหลด timeline ATMS ของคันนี้ (ปีปัจจุบัน + mr_id ถ้ารู้)
  async function loadAtmsTimeline() {
    if (!form.plate.trim()) return
    setAtmsTlLoading(true); setAtmsTlErr("")
    try {
      const a = editRow ? atmsOf(editRow) : undefined
      const p = new URLSearchParams({ plate: form.plate.trim() })
      if (a?.mrId) p.set("mr", String(a.mrId))
      const res = await fetch(`/api/repair-external/atms-timeline?${p.toString()}`)
      const d = await res.json()
      if (!d?.ok) throw new Error(d?.error || "โหลดไม่สำเร็จ")
      setAtmsTl(d.data?.items ?? [])
    } catch (e) {
      setAtmsTlErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAtmsTlLoading(false)
    }
  }

  // เปิดรายการจากลิงก์แชร์ (?id=) — ดึงรายการเดียวแล้วเปิดหน้าแก้ไข
  async function openById(id: string) {
    try {
      const res = await fetch(`/api/repair-external/${id}`)
      if (!res.ok) return
      const r = await res.json()
      if (r?._id) openEdit(r)
    } catch { /* ignore */ }
  }

  // เติม ฟลีท/แพล้นท์ จาก atms.vehicle_daily ตามทะเบียน
  async function fillVehicleDaily(plate: string) {
    if (!plate.trim()) return
    try {
      const res = await fetch(`/api/vehicle-daily?plate=${encodeURIComponent(plate.trim())}`)
      const d   = await res.json()
      if (d && (d.fleet || d.plant)) {
        setForm((f) => ({ ...f, fleet: d.fleet || f.fleet, plant: d.plant || f.plant, ...(d.fleetNo && !f.fleetNo ? { fleetNo: d.fleetNo } : {}) }))
        setVdRef(d.date || "")
      } else {
        setVdRef("")
      }
    } catch { /* ignore */ }
  }

  // ค้นหาจาก "เบอร์รถ" → เติมทะเบียน/ฟลีท/แพล้นท์
  async function fillByFleetNo(fleetNo: string) {
    if (!fleetNo.trim()) return
    try {
      const res = await fetch(`/api/vehicle-daily?fleetNo=${encodeURIComponent(fleetNo.trim())}`)
      const d   = await res.json()
      if (d && (d.plate || d.fleet || d.plant)) {
        setForm((f) => ({ ...f, fleet: d.fleet || f.fleet, plant: d.plant || f.plant, ...(d.plate && !f.plate ? { plate: d.plate } : {}) }))
        setVdRef(d.date || "")
      }
    } catch { /* ignore */ }
  }

  // คัดลอกข้อมูลทั้งคอลัมน์เป็นข้อความพร้อมอีโมจิ (สำหรับส่งกลุ่มไลน์)
  function copyColumnLine(s: { value: string; emoji: string }, colRows: RepairExternal[], avgCol: number) {
    const lines: string[] = []
    lines.push(`${s.emoji} ${s.value} — ${colRows.length} คัน (เฉลี่ย ${avgCol} วัน)`)
    lines.push("━━━━━━━━━━━━━━")
    colRows.forEach((r, i) => {
      const sla = slaInfo(r)
      const age = ageDays(jobStartDate(r))
      lines.push(`${i + 1}. 🚚 ${r.plate || "-"}${r.fleetNo ? ` (${r.fleetNo})` : ""}${r.fleet ? ` · ${r.fleet}` : ""}`)
      if (r.symptom) lines.push(`   🔧 ${r.symptom}`)
      const meta: string[] = []
      if (r.garage) meta.push(`🏭 ${r.garage}`)
      if (age !== null) meta.push(`🕐 ${age} วัน`)
      if (r.dueDate) meta.push(`📅 ${fmtDateShort(r.dueDate)}`)
      if (sla?.over) meta.push(`⏱️ รอ PR ค้าง ${sla.hours} ชม. (เกิน 24 ชม.)`)
      if (meta.length) lines.push(`   ${meta.join("  ")}`)
      const doc: string[] = []
      if (r.prCode) doc.push(`PR ${r.prCode}`)
      else doc.push("⚠ ยังไม่มี PR")
      if (r.poCode) doc.push(`PO ${r.poCode}`)
      if (r.repairPrice > 0) doc.push(`💰 ${fmtNum(r.repairPrice)}`)
      if (doc.length) lines.push(`   ${doc.join("  ")}`)
    })
    const text = lines.join("\n")
    navigator.clipboard?.writeText(text).then(
      () => swalToast("success", `คัดลอก ${s.value} (${colRows.length} คัน) แล้ว`),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
  }

  // คัดลอกสรุปสถานะงาน (สำหรับส่งไลน์)
  function copySummary() {
    if (typeof window === "undefined") return
    const title = fType === JOB_TYPE_PARTS ? "อะไหล่ลงคัน" : fType === JOB_TYPE_GARAGE ? "รถซ่อมอู่นอก" : "อู่นอก + อะไหล่ลงคัน"
    const lines: string[] = [`📋 สถานะงาน — ${title}`, ""]
    let priority: { value: string; emoji: string } | null = null
    let maxAvg = -1
    chipStatuses.forEach((s) => {
      const c = stats.counts[s.value] || 0
      if (!c) return
      const a = stats.avgByStatus[s.value] || 0
      lines.push(`${s.emoji} ${s.value}  ${c} คัน | ⏱️เฉลี่ย ${a} วัน`)
      if (a > maxAvg) { maxAvg = a; priority = s }
    })
    lines.push("", "-------------")
    if (priority) {
      const level = maxAvg >= 10 ? "High" : maxAvg >= 5 ? "Medium" : "Low"
      lines.push(`priority : ${level} (${(priority as { emoji: string }).emoji} ${(priority as { value: string }).value})`)
    }
    lines.push("", `url : ${window.location.origin}/repair-external`)
    const text = lines.join("\n")
    navigator.clipboard?.writeText(text).then(
      () => swalToast("success", "คัดลอกสรุปแล้ว"),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
  }

  // คัดลอกข้อความ "ตามงาน" (ส่งไลน์) — ใช้ข้อมูลรถจอดจริง (fleet) + ATMS ถ้าดึงได้
  // 🔴 = รถจอดจริงแล้วแต่ WMS ยัง "รอรถเข้า" · 🟢 = WMS ว่ายังซ่อมแต่รถไม่จอดแล้ว · 🆕 = งาน ATMS ที่ยังไม่มีในระบบ
  async function copyFollowUpReal(): Promise<boolean> {
    if (typeof window === "undefined") return false
    let b: AtmsBoard
    try {
      const res = await fetch("/api/repair-external/atms-board")
      const d = await res.json()
      if (!d?.ok) return false
      b = d as AtmsBoard
      setAtms(b)
    } catch { return false }

    const fmtThaiDay = (s: string) => {
      const d = new Date(s)
      return isNaN(d.getTime()) ? s : d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
    }
    const total = b.waitingButParked.length + b.openNotParked.length + b.missing.length
    if (!total) { swalToast("success", "สถานะตรงกันหมด ไม่มีงานที่ต้องตามตอนนี้ 🎉"); return true }

    const linkOf = (v: string) => `${window.location.origin}/repair-external?q=${encodeURIComponent(v)}`
    const lines: string[] = [`📢 งานซ่อมอู่นอก ${total} รายการ สถานะในระบบไม่ตรงกับรถจริงครับ (เช็คกับข้อมูลรถจอดจริง ${fmtThaiDay(b.fetchedAt.slice(0, 10))})`]
    let n = 0
    if (b.waitingButParked.length) {
      lines.push("", `🔴 ${b.waitingButParked.length} คันนี้ รถจอดอยู่อู่แล้ว แต่ในระบบยังเขียนว่า "รอรถเข้า"`, "→ ฝากกดเข้าไปเปลี่ยนสถานะให้ตรงหน่อยครับ", "")
      for (const w of [...b.waitingButParked].sort((a, x) => x.days - a.days)) {
        lines.push(`${++n}. ${w.fleetNo || w.plate} — จอดมา ${w.days} วัน${w.days >= 45 ? "‼️" : ""}${w.plant ? ` (${w.plant})` : ""}`)
        lines.push(linkOf(w.fleetNo || w.plate))
      }
    }
    if (b.openNotParked.length) {
      lines.push("", `🟢 ${b.openNotParked.length} คันนี้ ไม่อยู่ในรายการรถจอดซ่อมแล้ว แต่งานยังไม่ได้ปิด`, "→ รบกวนเช็คว่าออกอู่จริงไหม ถ้าซ่อมเสร็จแล้วฝากปิดงานด้วยครับ (ใส่วันเสร็จ = วันที่ออกอู่)", "")
      for (const w of b.openNotParked) {
        const done = w.atmsStep === "รถซ่อมเสร็จสิ้น" ? " (Mena-Next ปิดว่าเสร็จสิ้นแล้ว)" : ""
        lines.push(`${++n}. ${w.fleetNo || w.plate} — สถานะค้างที่ "${w.status}"${done}`)
        lines.push(linkOf(w.fleetNo || w.plate))
      }
    }
    if (b.missing.length) {
      lines.push("", `🆕 ${b.missing.length} คันนี้ จอดซ่อมอู่นอกอยู่จริง แต่ยังไม่มีรายการในระบบเลย`, "→ ฝากเปิดรายการในระบบด้วยครับ (มีปุ่มสร้างอัตโนมัติในแถบเทียบ Mena-Next)", "")
      for (const m of b.missing) {
        lines.push(`${++n}. ${m.trucknum || m.plate} — จอดมา ${m.days} วัน${m.days >= 45 ? "‼️" : ""} ${m.mrCode}${m.vendor ? ` (${m.vendor})` : ""}`)
      }
    }
    lines.push("", "📌 กดลิงก์ → เจอรถคันนั้นเลย → กดที่รายการ → แก้สถานะ → บันทึก จบ", "ขอบคุณครับ 🙏")
    navigator.clipboard?.writeText(lines.join("\n")).then(
      () => swalToast("success", `คัดลอกข้อความตามงาน ${total} รายการแล้ว`),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
    return true
  }

  // fallback เดิม (ใช้เมื่อ API เทียบล่ม) — 🔴 = ค้างสถานะแรกของ workflow · 🟢 = เลยกำหนดเสร็จ
  async function copyFollowUp() {
    if (typeof window === "undefined") return
    if (await copyFollowUpReal()) return
    let list: RepairExternal[] = []
    try {
      const p = new URLSearchParams({ scope: "active" })
      if (fType) p.set("type", fType)
      const res  = await fetch(`/api/repair-external?${p.toString()}`)
      const data = await res.json()
      list = Array.isArray(data) ? data : []
    } catch { swalError("โหลดข้อมูลไม่สำเร็จ"); return }

    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    const fmtThaiDay = (s: string) => {
      const d = new Date(s)
      return isNaN(d.getTime()) ? s : d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
    }
    const red = list
      .filter((r) => r.status === statusesFor(jobTypeOf(r))[0].value)
      .sort((a, b) => (ageDays(jobStartDate(b)) ?? 0) - (ageDays(jobStartDate(a)) ?? 0))
    const green = list
      .filter((r) => !red.includes(r) && r.dueDate && r.dueDate < today)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    if (!red.length && !green.length) { swalToast("success", "ไม่มีงานที่ต้องตามตอนนี้ 🎉"); return }

    const keyOf  = (r: RepairExternal) => r.fleetNo?.trim() || r.plate || "-"
    const linkOf = (r: RepairExternal) => `${window.location.origin}/repair-external?q=${encodeURIComponent(keyOf(r))}`
    const lines: string[] = [`📢 งานซ่อม ${red.length + green.length} คัน สถานะในระบบน่าจะไม่ตรงครับ (${fmtThaiDay(today)})`]
    let n = 0
    if (red.length) {
      const names = [...new Set(red.map((r) => r.status))].join("/")
      lines.push("", `🔴 ${red.length} คันนี้ ในระบบยังเขียนว่า "${names}"`, "→ ถ้ารถเข้าอู่แล้ว ฝากกดเข้าไปเปลี่ยนสถานะให้ตรงหน่อยครับ", "")
      red.forEach((r) => {
        const age = ageDays(jobStartDate(r)) ?? 0
        lines.push(`${++n}. ${keyOf(r)} — จอดมา ${age} วัน${age >= 45 ? "‼️" : ""}${r.symptom ? ` (${r.symptom})` : ""}${r.poCode ? " มี PO แล้ว" : ""}`)
        lines.push(linkOf(r))
      })
    }
    if (green.length) {
      lines.push("", `🟢 ${green.length} คันนี้ เลยกำหนดเสร็จแล้ว แต่งานยังไม่ได้ปิด`, "→ ถ้าซ่อมเสร็จแล้ว ฝากปิดงานด้วยครับ (ใส่วันเสร็จ = วันที่ออกอู่)", "")
      green.forEach((r) => {
        const over = Math.max(1, Math.floor((Date.parse(today) - Date.parse(r.dueDate)) / 86400000))
        lines.push(`${++n}. ${keyOf(r)} — กำหนดเสร็จ ${fmtThaiDay(r.dueDate)} เลยมา ${over} วัน${r.mrNo ? "" : " (ยังไม่มี MR — เช็คด้วยว่าซ่อมจริงไหม)"}`)
        lines.push(linkOf(r))
      })
    }
    lines.push("", "📌 กดลิงก์ → เจอรถคันนั้นเลย → กดที่รายการ → แก้สถานะ → บันทึก จบ", "ขอบคุณครับ 🙏")
    navigator.clipboard?.writeText(lines.join("\n")).then(
      () => swalToast("success", `คัดลอกข้อความตามงาน ${red.length + green.length} คันแล้ว`),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
  }

  function copyShareLink() {
    if (!editId || typeof window === "undefined") return
    const url = `${window.location.origin}/repair-external?id=${editId}`
    navigator.clipboard?.writeText(url).then(
      () => swalToast("success", "คัดลอกลิงก์แชร์แล้ว"),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
  }

  // คัดลอกสรุปส่งกลุ่มไลน์ — ยี่ห้อ/รุ่นไม่ได้เก็บในใบแจ้งซ่อม จึงดึงจากทะเบียนรถตอนกด
  // (หาไม่เจอก็ยังคัดลอกได้ แค่บรรทัดแรกไม่มีสเปครถ)
  async function copyCarSummary() {
    let brand = "", model = ""
    const plate = form.plate.trim()
    if (plate) {
      try {
        const res  = await fetch(`/api/vehicles?q=${encodeURIComponent(plate)}&limit=20`)
        const list = await res.json()
        const hit  = Array.isArray(list)
          ? list.find((v: { plate?: string }) => String(v.plate ?? "").trim() === plate)
          : null
        if (hit) { brand = String(hit.brand ?? ""); model = String(hit.model ?? "") }
      } catch { /* ไม่มีสเปครถก็ยังสรุปได้ */ }
    }
    const text = buildRepairSummary({ ...form, brand, model })
    if (!text) { swalError("ยังไม่มีข้อมูลพอให้สรุป"); return }
    navigator.clipboard?.writeText(text).then(
      () => swalToast("success", "คัดลอกสรุปแล้ว — วางในไลน์ได้เลย"),
      () => swalError("คัดลอกไม่สำเร็จ"),
    )
  }

  async function save() {
    if (!form.plate.trim())  { swalError("กรุณาระบุทะเบียนรถ"); return }
    if (!form.status)        { swalError("กรุณาเลือกสถานะ"); return }
    // บังคับกรอกให้ครบ "เฉพาะตอนปิดงาน" (รถเสร็จ/ลงคันเสร็จ — สถานะกลางไม่มี PR/PO ได้)
    if (form.status === doneStatusFor(jobTypeOf(form))) {
      const missing = requiredFieldsFor(form.status, jobTypeOf(form)).filter((r) => !String(form[r.field] ?? "").trim())
      if (missing.length) {
        swalError(`ปิดงานเป็น “${form.status}” ต้องกรอกให้ครบก่อน:\n${missing.map((m) => `• ${m.label}`).join("\n")}`)
        return
      }
    }
    setSaving(true)
    try {
      const url    = editId ? `/api/repair-external/${editId}` : "/api/repair-external"
      const method = editId ? "PUT" : "POST"
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, images: formImages, negotiationImages: formNegImages, quotationImages: formQuotImages }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "บันทึกไม่สำเร็จ")
      }
      setOpen(false)
      swalToast("success", editId ? "แก้ไขแล้ว" : "เพิ่มรายการแล้ว")
      load(); loadStats(); loadAtmsBoard()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  // ── Kanban: ลากการ์ดเปลี่ยนสถานะ ──
  async function moveStatus(r: RepairExternal, newStatus: string) {
    if (r.status === newStatus) return
    // บังคับข้อมูลครบ "เฉพาะตอนจะปิดงาน" — สถานะกลางเปลี่ยนได้เลยแม้ไม่มี PR/PO
    const missing = newStatus === doneStatusFor(jobTypeOf(r))
      ? requiredFieldsFor(newStatus, jobTypeOf(r)).filter((f) => !String(r[f.field] ?? "").trim())
      : []
    if (missing.length) {
      // เปิดฟอร์ม (หน้าเดียว) ให้กรอกฟิลด์ที่ขาดก่อนปิดงาน
      setEditId(r._id)
      setViewOnly(false)
      setEditRow(r)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, ...rest } = r
      setForm({ ...EMPTY, ...rest, status: newStatus })
      setOpen(true)
      return
    }
    // ไม่ต้องกรอกอะไรเพิ่ม → PUT เปลี่ยนสถานะทันที
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, ...rest } = r
      const res = await fetch(`/api/repair-external/${r._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, status: newStatus }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "เปลี่ยนสถานะไม่สำเร็จ") }
      swalToast("success", `ย้ายเป็น “${newStatus}”`)
      load(); loadStats(); loadAtmsBoard()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "เปลี่ยนสถานะไม่สำเร็จ")
    }
  }

  // ย้อนสถานะกลับ (จาก log drawer) — รถเสร็จแล้วย้อนไม่ได้
  async function revertStatus(record: RepairExternal, toStatus: string) {
    if (isDoneStatus(record.status)) { swalError("รายการที่ปิดงานแล้ว ย้อนสถานะไม่ได้"); return }
    const ok = await swalConfirm("ย้อนสถานะกลับ?", `จาก “${record.status}” → “${toStatus}”`)
    if (!ok.isConfirmed) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, ...rest } = record
      const res = await fetch(`/api/repair-external/${record._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, status: toStatus }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "ย้อนไม่สำเร็จ") }
      swalToast("success", `ย้อนสถานะเป็น “${toStatus}”`)
      setOpen(false)   // ย้อนจากในฟอร์ม — ปิดฟอร์มให้โหลดข้อมูลใหม่
      load(); loadStats(); loadAtmsBoard()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ย้อนไม่สำเร็จ")
    }
  }

  async function remove(r: RepairExternal) {
    const ok = await swalDeleteConfirm(`ลบรายการซ่อมของ ${r.plate || "รถคันนี้"}?`)
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/repair-external/${r._id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      swalToast("success", "ลบแล้ว")
      setOpen(false)   // ลบได้จากในฟอร์มเท่านั้น — ปิดฟอร์มหลังลบ
      load(); loadStats(); loadAtmsBoard()
    } catch {
      swalError("ลบไม่สำเร็จ")
    }
  }

  // โหลดประวัติมาแสดงในฟอร์มแก้ไข (ไม่ใช้ drawer แยกแล้ว)
  async function loadLog(r: RepairExternal) {
    setLogLoading(true)
    setLogEntries([]); setShowFieldLog(false)
    try {
      const res  = await fetch(`/api/repair-external/${r._id}/log`)
      const data = await res.json()
      setLogEntries(Array.isArray(data) ? data : [])
    } catch {
      swalError("โหลดประวัติไม่สำเร็จ")
    } finally {
      setLogLoading(false)
    }
  }

  const hasFilter = q || fType || fStatus || fGarage || fFleet || slaOnly || noPrOnly || conflictOnly || dateFrom || dateTo
  function clearFilters() {
    setQ(""); setFType(""); setFStatus(""); setFGarage(""); setFFleet(""); setSlaOnly(false); setNoPrOnly(false); setConflictOnly(false); setDateFrom(""); setDateTo("")
  }

  // วิเคราะห์ความสอดคล้อง งานซ่อม ↔ สถานะรถรายวันจริง (เฉพาะงานอู่นอกที่ยังไม่ปิด)
  // กติกา:
  //  • "รอรถเข้า" + รถเป็น A ตลอด ไม่เคย B/BA ตั้งแต่รับแจ้ง → รอเข้าซ่อมจริง (info)
  //  • "รอรถเข้า" + รถเป็น B/BA อยู่ → เข้าอู่แล้ว ควรอัพเดทเป็น "รถเข้าอู่ซ่อม"
  //  • งานที่รถควรอยู่อู่ + รถกลับมาวิ่ง (เคย B/BA แล้วเปลี่ยนเป็น A) → ซ่อมเสร็จแล้วยังไม่อัพเดทงาน
  const jobAlertOf = (r: RepairExternal): JobAlert | null => {
    const ds = dailyStatus[r.plate]
    if (!ds || jobTypeOf(r) === JOB_TYPE_PARTS || isDoneStatus(r.status)) return null
    const age = ageDays(jobStartDate(r))
    // เคยเป็น B/BA หลังวันรับแจ้งไหม (YYYY-MM-DD เทียบ string ตรงๆ ได้)
    const everBbaSinceJob = !!ds.last_bba_date && !!r.receivedDate && ds.last_bba_date >= r.receivedDate

    if (r.status === "รอรถเข้า") {
      if (ds.group === "working" && everBbaSinceJob)
        return {
          kind: "update_needed",
          text: `เคยเข้าอู่แล้ว ออกอู่กลับมาวิ่งตั้งแต่ ${ds.back_to_work_date ?? ds.date} — อัพเดทสถานะงาน?`,
          title: `รถอยู่อู่ (B/BA) ถึง ${ds.last_bba_date} แล้วกลับมาวิ่งตั้งแต่ ${ds.back_to_work_date ?? "-"} — งานอาจซ่อมเสร็จแล้ว กรุณาตรวจสอบ/ปิดงาน`,
        }
      if ((ds.streak_days ?? 0) > 0)
        return {
          kind: "update_needed",
          text: `รถเข้าอู่แล้ว (${ds.status} ${ds.streak_days} วัน) — อัพเดทเป็น "รถเข้าอู่ซ่อม"?`,
          title: `สถานะรายวันเป็น ${ds.status} ต่อเนื่อง ${ds.streak_days} วัน แต่งานยังสถานะ "รอรถเข้า"`,
        }
      if (ds.group === "working")
        return {
          kind: "waiting_real",
          text: `รอเข้าซ่อมจริง — รอมา ${age ?? "-"} วัน (รถยังวิ่งงาน)`,
          title: `ตั้งแต่รับแจ้ง ${r.receivedDate || "-"} รถไม่เคยเป็น B/BA — ยังรอคิวเข้าอู่จริง`,
        }
      return null
    }

    if (IN_GARAGE_STATUSES.has(r.status) && ds.group === "working") {
      if (everBbaSinceJob)
        return {
          kind: "update_needed",
          text: `ซ่อมเสร็จแล้ว? ออกอู่กลับมาวิ่งตั้งแต่ ${ds.back_to_work_date ?? ds.date}`,
          title: `รถอยู่อู่ (B/BA) ถึง ${ds.last_bba_date} แล้วกลับมาวิ่งงานตั้งแต่ ${ds.back_to_work_date ?? "-"} — ถ้าซ่อมเสร็จแล้วกรุณาปิดงาน/อัพเดทสถานะ (แนะนำใส่วันเสร็จ = ${ds.back_to_work_date ?? ds.last_bba_date})`,
        }
      // เคย B/BA แต่ "ก่อน" วันรับแจ้ง = รอบซ่อมก่อนหน้า จบไปแล้ว — งานนี้อาจเปิดซ้ำ/เปิดช้า หรือซ่อมเสร็จไปแล้ว
      if (ds.last_bba_date)
        return {
          kind: "update_needed",
          text: `รถออกอู่ตั้งแต่ ${ds.back_to_work_date ?? ds.last_bba_date} (ก่อนวันรับแจ้ง) — งานนี้ซ่อมเสร็จแล้ว?`,
          title: `รถอยู่อู่ (B/BA) ล่าสุดถึง ${ds.last_bba_date} และกลับมาวิ่งตั้งแต่ ${ds.back_to_work_date ?? "-"} ซึ่งก่อนวันรับแจ้ง ${r.receivedDate || "-"} — งานนี้อาจซ่อมเสร็จไปแล้วหรือเปิดงานซ้ำ กรุณาตรวจสอบ/ปิดงาน`,
        }
      return {
        kind: "update_needed",
        text: "รถวิ่งงานตลอด ไม่เคยเข้าอู่ (90 วัน) — ตรวจสอบสถานะงาน",
        title: `งานสถานะ "${r.status}" (รถควรอยู่อู่) แต่รถไม่เคยเป็น B/BA เลยในรอบ 90 วัน — สถานะงานหรือสถานะรายวันอาจลงผิด`,
      }
    }
    return null
  }
  const alertRows = rows.filter((r) => jobAlertOf(r)?.kind === "update_needed")

  // กรองฝั่ง client — ค้างเกิน SLA และ/หรือ รอใบเสนอราคาที่ไม่มี PR
  let displayRows = rows
  if (slaOnly)  displayRows = displayRows.filter((r) => slaInfo(r)?.over)
  if (noPrOnly) displayRows = displayRows.filter((r) => !r.prCode?.trim())
  if (uncheckedOnly) displayRows = displayRows.filter((r) => needsDailyCheck(r) && !checkedToday(r))
  if (conflictOnly) displayRows = displayRows.filter((r) => jobAlertOf(r)?.kind === "update_needed")

  // รถซ้ำในกลุ่มที่ยัง "ไม่เสร็จ" — ซ้ำเมื่อ "ทะเบียน หรือ เบอร์รถ" ตรงกัน (ต้องเหลือคันละ 1 รายการ)
  const { isDup, dupList } = (() => {
    const pCnt: Record<string, number> = {}, fCnt: Record<string, number> = {}
    for (const r of rows) {
      if (isDoneStatus(r.status)) continue
      const p = (r.plate || "").trim();   if (p) pCnt[p] = (pCnt[p] || 0) + 1
      const f = (r.fleetNo || "").trim(); if (f) fCnt[f] = (fCnt[f] || 0) + 1
    }
    const isDup = (r: RepairExternal) => {
      const p = (r.plate || "").trim(), f = (r.fleetNo || "").trim()
      return (!!p && pCnt[p] > 1) || (!!f && fCnt[f] > 1)
    }
    const dupList = Array.from(new Set(
      rows.filter((r) => !isDoneStatus(r.status) && isDup(r))
        .map((r) => (r.plate || r.fleetNo || "").trim()).filter(Boolean)
    ))
    return { isDup, dupList }
  })()

  // ฟิลด์ที่ต้องกรอก "สะสม" ตามสถานะ (รวมสถานะก่อนหน้าที่ข้ามมา) — สำหรับ hint/ไฮไลต์/validate
  const formJobType  = jobTypeOf(form)
  const isParts      = formJobType === JOB_TYPE_PARTS
  const statusLocked = isDoneStatus(origStatus)  // ปิดงานแล้ว เปลี่ยนสถานะไม่ได้
  // บังคับกรอกข้อมูลครบ "เฉพาะตอนจะปิดงาน" — สถานะกลางไม่บังคับ (ไม่มี PR/PO ได้)
  const reqFields    = form.status === doneStatusFor(formJobType) ? requiredFieldsFor(form.status, formJobType) : []
  const reqFieldSet  = new Set(reqFields.map((r) => r.field))
  const missingReq   = reqFields.filter((r) => !String(form[r.field] ?? "").trim())
  const isReq = (f: RepairField) => reqFieldSet.has(f)
  const reqCls = (f: RepairField) =>
    isReq(f) && !String(form[f] ?? "").trim() ? " ring-1 ring-amber-400 border-amber-400" : ""

  // ชุดสถานะของ chips/สรุป ตาม tab ประเภทที่เลือก (ทั้งหมด = อู่นอก + สถานะเฉพาะของอะไหล่ลงคัน)
  const chipStatuses =
    fType === JOB_TYPE_PARTS  ? PARTS_ACTIVE_STATUSES :
    fType === JOB_TYPE_GARAGE ? ACTIVE_STATUSES :
    [...ACTIVE_STATUSES, ...PARTS_ACTIVE_STATUSES.filter((p) => !ACTIVE_STATUSES.some((g) => g.value === p.value))]

  return (
    <div className="w-full px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
            {isDone ? <Flag size={20} /> : <Wrench size={20} />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
              {isDone ? "งานเสร็จ" : "อู่นอก & อะไหล่ลงคัน"}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isDone ? "รายการที่ปิดงานแล้ว (รถเสร็จ / ลงคันเสร็จ)" : "งานซ่อมอู่นอก + สั่งซื้ออะไหล่ลงคัน ที่กำลังดำเนินการ"} · {rows.length} รายการ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isDone && (
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/10 p-0.5">
              <button
                onClick={() => setView("table")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${view === "table" ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              >
                <TableIcon size={14} /> ตาราง
              </button>
              <button
                onClick={() => setView("board")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${view === "board" ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              >
                <Columns3 size={14} /> บอร์ด
              </button>
            </div>
          )}
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] transition-colors"
          >
            <Plus size={16} /> เพิ่มรายการ
          </button>
        </div>
      </div>

      {/* Insight strip (1a) */}
      {!isDone && (() => {
        const ab = stats.agingBuckets
        const abTotal = ab.lt8 + ab.d8_14 + ab.gte15
        const seg = (n: number, color: string) => (n && abTotal ? <div style={{ width: `${(n / abTotal) * 100}%`, background: color }} /> : null)
        const breachedPlates = rows.filter((r) => slaInfo(r)?.over).map((r) => r.plate).filter(Boolean).slice(0, 4)
        return (
          <div className="mb-3 grid gap-3 lg:grid-cols-[220px_210px_235px_1fr]">
            {/* รถทั้งหมด */}
            <div className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">รถทั้งหมด</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-[34px] font-semibold leading-none text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>{stats.total}</span>
                <span className="text-xs text-[#9AA8A0]">คัน</span>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">เฉลี่ยซ่อม {stats.avgDays} วัน/คัน</p>
            </div>
            {/* ค้างเกินกำหนด (SLA) — ตรงกับปุ่มกรอง ⏱️ */}
            <button
              onClick={() => setSlaOnly((v) => !v)}
              title="คลิกเพื่อดูเฉพาะรายการที่ค้างเกินกำหนด"
              className={`rounded-2xl border p-4 text-left transition ${slaOnly ? "border-[#DC2626] ring-2 ring-[#DC2626]/30" : "border-[#F7CFCF] dark:border-red-900/40"} bg-[#FEECEC] dark:bg-red-950/20`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#B4534F] dark:text-red-400">⏱️ ค้างเกินกำหนด</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-[34px] font-semibold leading-none text-[#DC2626]" style={{ fontFamily: "'Mitr', sans-serif" }}>{stats.slaBreached}</span>
                <span className="text-xs text-[#B4534F] dark:text-red-400">คัน</span>
              </div>
              <p className="mt-1.5 truncate text-[11px] text-[#B4534F] dark:text-red-400">
                {breachedPlates.length ? breachedPlates.join(", ") : "ไม่มีรายการค้างเกินกำหนด"}
              </p>
            </button>
            {/* อู่นอก WMS เทียบ Mena-Next (รถจอดซ่อมจริง) — คลิกเพื่อดูรายการที่ขาด */}
            <button
              onClick={() => {
                setAtmsOpen(true)
                setTimeout(() => document.getElementById("atms-compare")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
              }}
              disabled={!atms}
              title={atms ? "คลิกเพื่อดูรายการที่ขาดในแถบเทียบ Mena-Next" : "กำลังโหลดข้อมูล Mena-Next..."}
              className={`rounded-2xl border p-4 text-left transition ${atms && atms.missing.length > 0 ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/40 dark:bg-indigo-900/15" : "border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]"} disabled:cursor-default`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">🔧 อู่นอก WMS / Mena-Next</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                {atms ? (
                  <>
                    <span className="text-[34px] font-semibold leading-none text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>{atms.pending.filter((p) => p.wms).length}</span>
                    <span className="text-[20px] font-semibold leading-none text-[#9AA8A0]" style={{ fontFamily: "'Mitr', sans-serif" }}>/ {atms.pending.length}</span>
                    <span className="text-xs text-[#9AA8A0]">คัน</span>
                  </>
                ) : (
                  <span className="text-[34px] font-semibold leading-none text-gray-300 dark:text-gray-600" style={{ fontFamily: "'Mitr', sans-serif" }}>…</span>
                )}
              </div>
              {atms && (
                atms.missing.length > 0
                  ? <p className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-300">ขาดในระบบ {atms.missing.length} คัน — คลิกดูรายการ</p>
                  : <p className="mt-1.5 text-[11px] text-[#1B8C4B]">ครบทุกคันตามรถจอดซ่อมจริง ✓</p>
              )}
            </button>
            {/* การกระจายตามอายุงาน */}
            <div className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">การกระจายตามวันซ่อม</p>
                <span className="text-xs text-gray-400">รวม {abTotal} คัน · ค้างเกิน SLA {stats.slaBreached}</span>
              </div>
              <div className="mt-2.5 flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                {seg(ab.lt8, "#1B8C4B")}{seg(ab.d8_14, "#E8A317")}{seg(ab.gte15, "#DC2626")}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                {[
                  { c: "#1B8C4B", label: "0–7 วัน", n: ab.lt8 },
                  { c: "#E8A317", label: "8–14 วัน", n: ab.d8_14 },
                  { c: "#DC2626", label: "15+ วัน", n: ab.gte15 },
                ].map((r) => (
                  <span key={r.label} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.c }} />
                    {r.label} <span className="font-semibold text-[#14271C] dark:text-white">{r.n}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* สัดส่วนตามฟลีท */}
      {!isDone && (stats.fleetDist.length > 0 || (stats.garageDist?.length ?? 0) > 0) && (() => {
        const byGarage = distBy === "garage"
        const garages  = stats.garageDist ?? []
        const dupes    = stats.garageDupes ?? []
        const toggle = (
          <div className="inline-flex overflow-hidden rounded-lg border border-[#E2E8E4] dark:border-white/10">
            {([["fleet", "🚚 ฟลีท"], ["garage", "🏭 อู่"]] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setDistBy(v)}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${distBy === v ? "bg-[#14271C] text-white dark:bg-white dark:text-[#14271C]" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )

        /* ── มุมมองอู่: อันดับอู่ที่ถือรถอยู่ + แถบแบ่งตามช่วงวันซ่อม ── */
        if (byGarage) {
          const shown   = showAllGarages ? garages : garages.slice(0, 8)
          const maxCnt  = garages[0]?.count ?? 1
          const trucks  = garages.reduce((a, g) => a + g.count, 0)
          const slowest = [...garages].sort((a, b) => b.maxDays - a.maxDays)[0]
          const seg = (n: number, color: string, label: string) =>
            n ? <div key={label} title={`${label} ${n} คัน`} style={{ flex: n, background: color }} /> : null
          return (
            <div className="mb-3 rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">🏭 อู่ที่ถือรถอยู่ตอนนี้</p>
                  {toggle}
                </div>
                <span className="text-xs text-gray-400">
                  {garages.length} อู่ · {trucks} คัน
                  {slowest && <> · ค้างนานสุด <b className="text-[#DC2626]">{slowest.garage} {slowest.maxDays} วัน</b></>}
                </span>
              </div>

              {/* ชื่ออู่ที่อาจเป็นอู่เดียวกัน — ตัวเลขจะกระจายกันจนดูน้อยกว่าจริง */}
              {dupes.length > 0 && (
                <div className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300">
                  <button onClick={() => setShowDupes((v) => !v)} className="text-left font-semibold">
                    ⚠ พบชื่ออู่ที่น่าจะเป็นอู่เดียวกัน {dupes.length} กลุ่ม — ตัวเลขด้านล่างจึงกระจายกันอยู่ {showDupes ? "▲" : "▼"}
                  </button>
                  {showDupes && (
                    <ul className="mt-1.5 space-y-1">
                      {dupes.map((d) => (
                        <li key={d.names.join("|")} className="text-[11.5px]">
                          รวมกัน <b>{d.total} คัน</b>: {d.names.join("  ·  ")}
                        </li>
                      ))}
                      <li className="pt-0.5 text-[11px] opacity-80">แก้โดยเปิดรายการแล้วเลือกชื่ออู่ให้ตรงกันจากรายการอู่ (หน้า จัดการอู่ / ร้านอะไหล่)</li>
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-3 space-y-1">
                {shown.map((g) => {
                  const active = fGarage === g.garage
                  const worst  = g.gte15 ? "#DC2626" : g.d8_14 ? "#E8A317" : "#1B8C4B"
                  return (
                    <button
                      key={g.garage}
                      onClick={() => setFGarage(active ? "" : g.garage)}
                      title={`${g.garage} — ${g.count} คัน · เฉลี่ย ${g.avgDays} วัน · นานสุด ${g.maxDays} วัน (คลิกเพื่อกรองตาราง)`}
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition ${active ? "bg-[#F0FDF4] ring-1 ring-[#1B8C4B]/30 dark:bg-white/5" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}
                    >
                      <span className="w-7 shrink-0 text-right text-[19px] font-semibold leading-none" style={{ fontFamily: "'Mitr', sans-serif", color: worst }}>{g.count}</span>
                      <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-semibold text-[#14271C] dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{g.garage}</span>
                      <span className="hidden h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10 sm:flex" style={{ width: `${Math.max(12, (g.count / maxCnt) * 100)}%`, maxWidth: 200, minWidth: 24 }}>
                        {seg(g.lt8, "#1B8C4B", "0-7 วัน")}{seg(g.d8_14, "#E8A317", "8-14 วัน")}{seg(g.gte15, "#DC2626", "15+ วัน")}
                      </span>
                      <span className="w-[92px] shrink-0 text-right text-[11.5px] font-semibold" style={{ color: worst }}>นานสุด {g.maxDays} วัน</span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#F1F5F2] dark:border-white/5 pt-2 text-[11px] text-gray-500 dark:text-gray-400">
                {[["#1B8C4B", "0–7 วัน"], ["#E8A317", "8–14 วัน"], ["#DC2626", "15+ วัน"]].map(([c, l]) => (
                  <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
                ))}
                <span className="opacity-70">คลิกแถว = กรองตารางเฉพาะอู่นั้น</span>
                {garages.length > 8 && (
                  <button onClick={() => setShowAllGarages((v) => !v)} className="ml-auto font-medium text-[#1B8C4B] hover:underline">
                    {showAllGarages ? "ย่อเหลือ 8 อันดับแรก" : `ดูอีก ${garages.length - 8} อู่`}
                  </button>
                )}
              </div>
            </div>
          )
        }

        /* ── มุมมองฟลีท (เดิม) ── */
        const fleetTotal = stats.fleetDist.reduce((s2, f) => s2 + f.count, 0)
        return (
          <div className="mb-3 rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9AA8A0]">สัดส่วนตามฟลีท</p>
                {toggle}
              </div>
              <span className="text-xs text-gray-400">{stats.fleetDist.length} ฟลีท · {fleetTotal} คัน</span>
            </div>
            <div className="mt-2.5 flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              {stats.fleetDist.map((f, i) => (f.count && fleetTotal ? (
                <button
                  key={f.fleet}
                  title={`${f.fleet} · ${f.count} คัน`}
                  onClick={() => setFFleet(fFleet === f.fleet ? "" : f.fleet)}
                  className="h-full transition-opacity hover:opacity-80"
                  style={{ width: `${(f.count / fleetTotal) * 100}%`, background: FLEET_PALETTE[i % FLEET_PALETTE.length] }}
                />
              ) : null))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {stats.fleetDist.map((f, i) => {
                const active = fFleet === f.fleet
                return (
                  <button
                    key={f.fleet}
                    onClick={() => setFFleet(active ? "" : f.fleet)}
                    className={`inline-flex items-center gap-1.5 rounded px-1 text-xs transition ${active ? "bg-[#F0FDF4] dark:bg-white/5" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FLEET_PALETTE[i % FLEET_PALETTE.length] }} />
                    <span className={active ? "font-semibold text-[#14271C] dark:text-white" : "text-gray-600 dark:text-gray-300"}>{f.fleet}</span>
                    <span className="font-semibold text-[#14271C] dark:text-white">{f.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Search + filter bar (1a) — แนวตั้ง บนลงล่าง */}
      <div className="mb-3 flex flex-col gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา MR / ทะเบียน / เบอร์รถ / อาการ / PR / PO"
            className={inputCls + " pl-9"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[140px] flex-1">
            <GarageCombobox value={fGarage} garages={garages} onChange={setFGarage} filterMode placeholder="🏭 ทุกอู่" />
          </div>
          <div className="min-w-[140px] flex-1">
            <FilterCombobox value={fFleet} options={stats.fleetDist.map((f) => f.fleet)} onChange={setFFleet} placeholder="🚚 ทุกฟลีท" />
          </div>
          {hasFilter && (
            <button onClick={clearFilters} className="inline-flex shrink-0 items-center gap-1 rounded-[11px] border border-[#E2E8E4] dark:border-white/10 px-3.5 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">
              <X size={13} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {/* Type filter tabs — อู่นอก / อะไหล่ลงคัน */}
      {!isDone && (
        <div className="mb-3 flex w-full flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs font-medium text-[#9AA8A0]">ประเภท:</span>
          {[
            { value: "",              label: "ทั้งหมด",        emoji: "" },
            { value: JOB_TYPE_GARAGE, label: JOB_TYPE_GARAGE,  emoji: "🔧" },
            { value: JOB_TYPE_PARTS,  label: JOB_TYPE_PARTS,   emoji: "🔩" },
          ].map((t) => {
            const active = fType === t.value
            return (
              <button
                key={t.value || "all"}
                onClick={() => { setFType(t.value); setFStatus("") }}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-[#1B8C4B] text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-[#F0FDF4] dark:hover:bg-white/5"}`}
              >
                {t.emoji && <span>{t.emoji}</span>}{t.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Status filter chips — แยกกลุ่มตามประเภทงาน (อู่นอก / อะไหล่ลงคัน) นับแยกประเภทจริง */}
      {!isDone && (() => {
        const cbt = stats.countsByType
        const cnt = (jt: string, status: string) => cbt?.[jt]?.[status] ?? 0
        // แถว chips ของประเภทหนึ่ง — คลิก chip = กรองทั้งประเภท+สถานะ
        const chipRow = (jt: string, emoji: string, list: typeof ACTIVE_STATUSES) => (
          <div className="flex w-full flex-wrap items-center gap-1.5">
            <button
              onClick={() => { setFType(fType === jt && !fStatus ? "" : jt); setFStatus("") }}
              className={`inline-flex w-[120px] items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold transition ${fType === jt && !fStatus ? "bg-[#14271C] text-white" : "text-[#5B7568] dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              title={`ดูเฉพาะ${jt}ทั้งหมด`}
            >
              {emoji} {jt}:
            </button>
            {list.map((s) => {
              const active = fStatus === s.value && fType === jt
              const color  = barColor(s.value)
              return (
                <button
                  key={jt + s.value}
                  onClick={() => {
                    if (active) { setFStatus(""); setFType("") }
                    else { setFStatus(s.value); setFType(jt) }
                  }}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${active ? "text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
                  style={active ? { background: color } : undefined}
                >
                  {!active && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
                  <span>{s.emoji}</span>{s.value}
                  <span className="opacity-70">{cnt(jt, s.value)} คัน</span>
                </button>
              )
            })}
          </div>
        )
        return (
          <div className="mb-4 space-y-2">
            {/* แถวบน: สรุป + ตัวกรองพิเศษ */}
            <div className="flex w-full flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-xs font-medium text-[#9AA8A0]">สถานะ:</span>
              <button
                onClick={copySummary}
                title="คัดลอกสรุปสถานะงาน (ส่งไลน์)"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#E2E8E4] dark:border-white/10 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5"
              >
                <Copy size={12} /> คัดลอกสรุป
              </button>
              <button
                onClick={copyFollowUp}
                title="คัดลอกข้อความตามงาน — รถค้างสถานะรอรถเข้า + งานเลยกำหนดเสร็จ (ส่งไลน์)"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#E2E8E4] dark:border-white/10 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#FDF3DD] hover:text-[#B07D12] dark:hover:bg-white/5"
              >
                <Megaphone size={12} /> ตามงาน
              </button>
              <button
                onClick={() => { setFStatus(""); setFType("") }}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${!fStatus && !fType ? "bg-[#14271C] text-white" : "border border-[#E2E8E4] dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
              >
                ทั้งหมด <span className="opacity-70">{stats.total} คัน</span>
              </button>
              <button
                onClick={() => setSlaOnly((v) => !v)}
                title={REPAIR_SLA_NOTE}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${slaOnly ? "bg-[#DC2626] text-white" : "border border-[#F7CFCF] text-[#DC2626] hover:bg-[#FEECEC] dark:border-red-900/40 dark:hover:bg-red-950/20"}`}
              >
                ⏱️ ค้างเกินกำหนด <span className="opacity-80">{stats.slaBreached} คัน</span>
              </button>
              <button
                onClick={() => setNoPrOnly((v) => !v)}
                title="รายการที่ยังไม่มี PR (ทุกสถานะ)"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${noPrOnly ? "bg-[#B07D12] text-white" : "border border-[#FDE9BE] text-[#B07D12] hover:bg-[#FDF3DD] dark:border-amber-900/40 dark:hover:bg-amber-950/20"}`}
              >
                🔍 ไม่มี PR <span className="opacity-80">{stats.noPr} คัน</span>
              </button>
              <button
                onClick={() => setUncheckedOnly((v) => !v)}
                title="รายการที่ยังไม่ได้กดยืนยันตรวจเช็คในวันนี้"
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition ${uncheckedOnly ? "bg-[#0E7490] text-white" : "border border-[#BEE8F1] text-[#0E7490] hover:bg-[#F0FBFD] dark:border-cyan-900/40 dark:text-cyan-300 dark:hover:bg-cyan-950/20"}`}
              >
                ☑️ ยังไม่เช็ควันนี้ <span className="opacity-80">{rows.filter((r) => needsDailyCheck(r) && !checkedToday(r)).length} คัน</span>
              </button>
            </div>
            {/* แถวอู่นอก + แถวอะไหล่ลงคัน (ซ่อนแถวที่ไม่เกี่ยวเมื่อกรองประเภทอยู่) */}
            {(fType === "" || fType === JOB_TYPE_GARAGE) && chipRow(JOB_TYPE_GARAGE, "🔧", ACTIVE_STATUSES)}
            {(fType === "" || fType === JOB_TYPE_PARTS)  && chipRow(JOB_TYPE_PARTS, "🔩", PARTS_ACTIVE_STATUSES)}
          </div>
        )
      })()}

      {/* คำอธิบาย SLA */}
      {!isDone && (
        <p className="mb-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#9AA8A0]">
          <span className="shrink-0">ⓘ</span>
          <span><b className="font-semibold text-[#5B7568] dark:text-gray-400">เกณฑ์ค้างงาน (SLA):</b> {REPAIR_SLA_NOTE}</span>
        </p>
      )}

      {/* ── เทียบอัตโนมัติกับ ATMS + รถจอดจริง — โฟกัสงานอู่นอกที่ "ขาด" จากระบบ ── */}
      {!isDone && atms && (() => {
        const inWms = atms.pending.filter((p) => p.wms)
        const mrIssues = inWms.filter((p) => p.wms!.mrMatch !== "match" && p.mrCode)
        const prFill = atms.prFill ?? []
        const hasIssue = atms.missing.length > 0 || mrIssues.length > 0 || prFill.length > 0
        return (
          <div id="atms-compare" className={`mb-4 rounded-[12px] border px-4 py-3 text-[13px] ${hasIssue ? "border-indigo-300 bg-indigo-50/70 text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-900/15 dark:text-indigo-200" : "border-[#D8EFE0] bg-[#F0FDF4] text-[#14532D] dark:border-emerald-500/30 dark:bg-emerald-900/10 dark:text-emerald-200"}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-bold">🔎 เทียบ Mena-Next·รถจอดจริง:</span>
              <span>ค้างซ่อมอู่นอกจริง <b>{atms.pending.length}</b> คัน</span>
              <span>· มีในระบบ <b>{inWms.length}</b></span>
              {atms.missing.length > 0
                ? <span className="font-bold text-rose-600 dark:text-rose-300">· ขาด {atms.missing.length} คัน</span>
                : <span>· ครบทุกคัน ✓</span>}
              {mrIssues.length > 0 && <span className="text-amber-700 dark:text-amber-300">· MR ว่าง/ไม่ตรง {mrIssues.length}</span>}
              {prFill.length > 0 && <span className="text-amber-700 dark:text-amber-300">· ไม่มี PR (Mena-Next มีให้เติม) {prFill.length}</span>}
              <span className="text-[11px] opacity-60">อัพเดท {fmtDateTime(atms.fetchedAt)}</span>
              <button
                onClick={() => setAtmsOpen((v) => !v)}
                className="ml-auto shrink-0 rounded-lg border border-current/30 px-3 py-1 text-[12px] font-bold hover:bg-white/50 dark:hover:bg-white/10"
              >
                {atmsOpen ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
              </button>
            </div>

            {atmsOpen && (
              <div className="mt-3 space-y-3 border-t border-current/10 pt-3">
                {/* งานที่ขาด — สร้างได้ทีละคัน (prefill ให้ครบ) */}
                {atms.missing.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-bold text-rose-700 dark:text-rose-300">❌ จอดซ่อมอู่นอกจริง แต่ยังไม่มีรายการในระบบ ({atms.missing.length} คัน)</p>
                    <div className="space-y-1">
                      {atms.missing.map((m) => (
                        <div key={m.mrCode + m.plate} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg bg-white/70 dark:bg-white/5 px-3 py-1.5">
                          <b className="min-w-[52px]">{m.trucknum || "—"}</b>
                          <span>{m.plate}</span>
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">จอด {m.days} วัน</span>
                          <span className="text-[12px] opacity-80">{m.mrCode} · {m.step || "-"}</span>
                          {m.vendor && <span className="text-[12px] opacity-60">🏭 {m.vendor}</span>}
                          <button
                            onClick={() => openAddFromAtms(m)}
                            className="ml-auto shrink-0 rounded-lg bg-[#1B8C4B] px-2.5 py-1 text-[12px] font-bold text-white hover:bg-[#0F6A3C]"
                          >
                            <Plus size={12} className="mr-0.5 inline" /> สร้างรายการ
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* MR ว่าง/ไม่ตรง — เติมจาก ATMS ได้ */}
                {mrIssues.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-bold text-amber-700 dark:text-amber-300">⚠ เลข MR ในระบบว่างหรือไม่ตรงกับ Mena-Next ({mrIssues.length} คัน)</p>
                    <div className="space-y-1">
                      {mrIssues.map((p) => (
                        <div key={p.wms!.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg bg-white/70 dark:bg-white/5 px-3 py-1.5">
                          <b className="min-w-[52px]">{p.trucknum || "—"}</b>
                          <span>{p.plate}</span>
                          <span className="text-[12px] opacity-80">Mena-Next: {p.mrCode}</span>
                          <span className="text-[12px] opacity-60">{p.wms!.mrMatch === "empty" ? "ระบบยังไม่มี MR" : `ระบบใส่ ${p.wms!.mrNo}`}</span>
                          <button
                            onClick={() => openEditFillMr(p.wms!.id, p.mrCode)}
                            className="ml-auto shrink-0 rounded-lg border border-amber-400 px-2.5 py-1 text-[12px] font-bold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
                          >
                            เติม MR
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* ไม่มี PR ในระบบ — ATMS มี purchase_links ให้เติม */}
                {prFill.length > 0 && (
                  <div>
                    <p className="mb-1.5 font-bold text-amber-700 dark:text-amber-300">🧾 ไม่มีเลข PR ในระบบ — Mena-Next มีให้เติม ({prFill.length} คัน)</p>
                    <div className="space-y-1">
                      {prFill.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg bg-white/70 dark:bg-white/5 px-3 py-1.5">
                          <b className="min-w-[52px]">{p.fleetNo || "—"}</b>
                          <span>{p.plate}</span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">{p.status}</span>
                          <span className="text-[12px] opacity-80">PR: {p.prCodes.join(", ")}</span>
                          {p.poCodes.length > 0 && <span className="text-[12px] opacity-60">PO: {p.poCodes.join(", ")}</span>}
                          {p.mrConflict && (
                            <span
                              className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                              title={`MR ในระบบ = ${p.wmsMr} แต่ MR งานค้างปัจจุบันใน Mena-Next = ${p.mrCode} — อาจเป็นคนละรอบซ่อม PR นี้อาจไม่ใช่ของงานในระบบ ตรวจ Timeline ก่อนเติม`}
                            >
                              ⚠ MR คนละใบ ({p.wmsMr}) — ตรวจก่อนเติม
                            </span>
                          )}
                          <button
                            onClick={() => openEditFillPr(p)}
                            className="ml-auto shrink-0 rounded-lg border border-amber-400 px-2.5 py-1 text-[12px] font-bold text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
                          >
                            เติม PR{p.poEmpty && p.poCodes.length > 0 ? "+PO" : ""}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!hasIssue && <p className="opacity-80">รถค้างซ่อมอู่นอกทุกคันมีรายการในระบบครบ และเลข MR/PR ตรงกันทั้งหมด 🎉</p>}
              </div>
            )}
          </div>
        )
      })()}

      {/* เตือนทะเบียนซ้ำ — รถ 1 คันต้องมีรายการที่ยังไม่เสร็จได้แค่ 1 รายการ */}
      {!isDone && dupList.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-300">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>
            <b>พบรถซ้ำ {dupList.length} คัน</b> (ทะเบียนหรือเบอร์รถตรงกัน) — รถ 1 คันควรมีรายการซ่อมที่ยัง<b>ไม่เสร็จ</b>ได้แค่ 1 รายการ กรุณา<b>ลบให้เหลือคันละ 1 รายการ</b>
            <span className="ml-1 opacity-80">({dupList.join(", ")})</span>
          </span>
        </div>
      )}

      {/* งานที่สถานะไม่ตรงกับสถานะรถจริง — แจ้งให้อัพเดท */}
      {!isDone && alertRows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="shrink-0">⚠</span>
          <span className="flex-1">
            <b>พบ {alertRows.length} งานที่สถานะอาจไม่ตรงกับรถจริง</b> — เช่น รถกลับมาวิ่งแล้วแต่ยังไม่ปิดงาน
            หรือรถเข้าอู่แล้วแต่งานยัง &quot;รอรถเข้า&quot; → กรุณาตรวจสอบ/อัพเดทสถานะ
            <span className="ml-1 opacity-80">({[...new Set(alertRows.map((r) => r.plate))].join(", ")})</span>
          </span>
          <button
            onClick={() => setConflictOnly((v) => !v)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-bold transition ${conflictOnly ? "border-amber-500 bg-amber-500 text-white" : "border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"}`}
          >
            {conflictOnly ? "แสดงทั้งหมด" : "ดูเฉพาะรายการขัดแย้ง"}
          </button>
        </div>
      )}

      {/* Roomy table (1a) */}
      {(view === "table" || isDone) && (
        <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
          <div className="min-w-[920px]">
            {/* header */}
            <div className="sticky top-0 z-10 grid gap-3 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16] px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]" style={{ gridTemplateColumns: TABLE_GRID }}>
              <div>อายุงาน</div><div>รถ</div><div>อาการ / รายการอะไหล่ · อู่</div><div>สถานะ · เอกสาร</div><div>📅 กำหนด</div>
            </div>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="grid gap-3 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-3.5" style={{ gridTemplateColumns: TABLE_GRID }}>
                  <div className="h-6 w-10 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                  <div className="space-y-1.5"><div className="h-3.5 w-20 animate-pulse rounded bg-gray-100 dark:bg-white/5" /><div className="h-2.5 w-14 animate-pulse rounded bg-gray-100 dark:bg-white/5" /></div>
                  <div className="space-y-1.5"><div className="h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-white/5" /><div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-white/5" /></div>
                  <div className="h-5 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-white/5" />
                  <div className="h-3 w-16 animate-pulse rounded bg-gray-100 dark:bg-white/5" />
                </div>
              ))
            ) : displayRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]">
                  {hasFilter ? <Search size={22} /> : <Wrench size={22} />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#14271C] dark:text-white">{hasFilter ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีรายการซ่อม"}</p>
                  <p className="mt-0.5 text-xs text-[#9AA8A0]">{hasFilter ? "ลองปรับคำค้นหรือล้างตัวกรอง" : "เริ่มบันทึกงานซ่อมรถที่ส่งอู่ภายนอก"}</p>
                </div>
                {hasFilter ? (
                  <button onClick={clearFilters} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-3.5 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"><X size={14} /> ล้างตัวกรอง</button>
                ) : (
                  <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"><Plus size={15} /> เพิ่มรายการ</button>
                )}
              </div>
            ) : displayRows.map((r) => {
              const sm = statusMeta(r.status)
              const sla = slaInfo(r)
              const days = ageDays(jobStartDate(r))
              const bkt  = days !== null ? agingBucket(days) : null
              const urgent = (days ?? 0) >= 15
              const dueOverdue = !!r.dueDate && r.dueDate < todayStr()
              return (
                <div
                  key={r._id}
                  onClick={() => openEdit(r)}
                  className="group grid cursor-pointer items-start gap-3 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-4 transition-colors hover:bg-[#F6FAF7] dark:hover:bg-white/[0.03]"
                  style={{ gridTemplateColumns: TABLE_GRID, background: urgent ? "#FFFBFB" : undefined }}
                >
                  {/* อายุงาน — ตัวเลขใหญ่ สีตามความช้า */}
                  <div
                    className="flex gap-2.5"
                    title={
                      jobStartDate(r) && jobStartDate(r) !== r.receivedDate
                        ? `นับจากวันที่รถเข้าอู่ ${fmtDateShort(r.garageInDate)} (เก่ากว่าวันรับแจ้ง ${fmtDateShort(r.receivedDate)} — รายการนี้คีย์ย้อนหลัง)`
                        : `นับจากวันรับแจ้ง ${fmtDateShort(r.receivedDate)}`
                    }
                  >
                    <div className="w-1.5 shrink-0 self-stretch rounded-full" style={{ background: bkt?.text ?? "#9ca3af" }} />
                    <div>
                      <div className="text-[26px] font-semibold leading-none" style={{ fontFamily: "'Mitr', sans-serif", color: bkt?.text ?? "#9ca3af" }}>{days ?? "—"}</div>
                      <div className="mt-1 text-[11px] text-[#9AA8A0]">วัน</div>
                      {jobStartDate(r) && jobStartDate(r) !== r.receivedDate && (
                        <div className="mt-0.5 text-[10px] leading-tight text-[#9AA8A0]">จากวันเข้าอู่</div>
                      )}
                    </div>
                  </div>
                  {/* รถ */}
                  <div className="min-w-0">
                    <div className="truncate text-[17px] font-bold text-[#14271C] dark:text-white" title={r.fleetNo || r.plate}>{r.fleetNo || r.plate || "—"}</div>
                    {r.fleetNo && r.plate && <div className="text-[13px] font-medium text-[#5B7568]">{r.plate}</div>}
                    {/* สถานะรายวันล่าสุดของรถ (จาก mena-intelligence) */}
                    {dailyStatus[r.plate] && (
                      <div
                        className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${DAILY_GROUP_CLS[dailyStatus[r.plate].group] ?? DAILY_GROUP_CLS.unknown}`}
                        title={`สถานะรถรายวันล่าสุด ${dailyStatus[r.plate].date} · ค้างซ่อม (B/BA ต่อเนื่อง) ${dailyStatus[r.plate].streak_days ?? 0} วัน · อายุงาน ${days ?? "-"} วัน`}
                      >
                        📊 {dailyStatus[r.plate].status}
                        {dailyStatus[r.plate].label && <span className="font-medium">{dailyStatus[r.plate].label}</span>}
                        {(dailyStatus[r.plate].streak_days ?? 0) > 0 && (
                          <span className="font-semibold">· ค้างซ่อม {dailyStatus[r.plate].streak_days}{dailyStatus[r.plate].streak_capped ? "+" : ""} วัน</span>
                        )}
                        <span className="font-normal opacity-70">· ถึง {dailyStatus[r.plate].date.slice(5)}</span>
                      </div>
                    )}
                    {/* ข้อมูล ATMS + รถจอดจริง (real-time จาก fleet) */}
                    {(() => {
                      const a = atmsOf(r)
                      if (!a || jobTypeOf(r) === JOB_TYPE_PARTS) return null
                      return (
                        <div
                          className="mt-1 inline-flex flex-wrap items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300"
                          title={`Mena-Next: ${a.mrCode || "-"}${a.vendor ? " · อู่ " + a.vendor : ""}${a.stepAt ? " · อัพเดท " + a.stepAt : ""}${a.since ? " · จอดตั้งแต่ " + a.since : ""}`}
                        >
                          🛠 {a.step || "Mena-Next"}
                          {a.parkedDays !== null && <span className="font-semibold">· จอดจริง {a.parkedDays} วัน</span>}
                        </div>
                      )
                    })()}
                    {(() => {
                      const al = jobAlertOf(r)
                      if (!al) return null
                      return al.kind === "update_needed" ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-400 dark:bg-amber-900/30 dark:text-amber-300" title={al.title}>
                          ⚠ {al.text}
                        </div>
                      ) : (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" title={al.title}>
                          ℹ️ {al.text}
                        </div>
                      )
                    })()}
    {/* ป้ายประเภทงาน — ระบุชัดทั้งสองแบบ */}
                    {jobTypeOf(r) === JOB_TYPE_PARTS
                      ? <div className="mt-1 inline-flex items-center gap-1 rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-bold text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300">🔩 อะไหล่ลงคัน</div>
                      : <div className="mt-1 inline-flex items-center gap-1 rounded bg-[#FFF3E8] px-1.5 py-0.5 text-[11px] font-bold text-[#C2410C] dark:bg-orange-900/25 dark:text-orange-300">🔧 อู่นอก</div>}
                    {isDup(r) && <div className="mt-1 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">⚠ ทะเบียนซ้ำ — ต้องลบ</div>}
                    {(r.fleet || r.plant) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.fleet && <span className="rounded bg-[#EAF6EE] px-1.5 py-0.5 text-[11px] font-medium text-[#0F6A3C] dark:bg-[#1B8C4B]/15 dark:text-[#4ade80]" title={`ฟลีท: ${r.fleet}`}>🚚 {r.fleet}</span>}
                        {r.plant && <span className="rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-medium text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300" title={`แพล้นท์: ${r.plant}`}>🏭 {r.plant}</span>}
                      </div>
                    )}
                    {(r.driverName || r.driverPhone) && (
                      <div className="mt-1 text-[12px] text-[#5B7568] dark:text-gray-400">
                        👤 {r.driverName || "—"}
                        {r.driverPhone && <a href={`tel:${r.driverPhone.replace(/[^0-9+]/g, "")}`} onClick={(e) => e.stopPropagation()} className="ml-1.5 font-medium text-[#1B8C4B] hover:underline">📞 {r.driverPhone}</a>}
                      </div>
                    )}
                    {r.mrNo && <div className="mt-1 font-mono text-[11.5px] text-[#9AA8A0]"><CopyText value={r.mrNo} /></div>}
                  </div>
                  {/* อาการ + อู่ (รวมช่องเดียว — พื้นที่กว้าง อ่านสบาย) */}
                  <div className="min-w-0">
                    <div className="line-clamp-3 text-[14px] leading-[1.55] text-[#37473E] dark:text-gray-200" title={r.symptom}>{r.symptom || "—"}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[#5B7568] dark:text-gray-400">🏭 {r.garage || "ยังไม่ระบุอู่"}</span>
                      {r.drivableStatus === "วิ่งไม่ได้" && <span className="rounded bg-[#DC2626] px-2 py-0.5 text-[11px] font-bold text-white">🛑 วิ่งไม่ได้</span>}
                      {r.drivableStatus === "วิ่งได้" && <span className="rounded bg-[#ECFDF3] px-2 py-0.5 text-[11px] font-medium text-[#1B8C4B]">✓ วิ่งได้</span>}
                      {r.cementStatus === "มีปูน" && <span className="rounded bg-[#DC2626] px-2 py-0.5 text-[11px] font-bold text-white">⚠ มีปูน</span>}
                      {r.cementStatus === "ไม่มีปูน" && <span className="rounded bg-[#ECFDF3] px-2 py-0.5 text-[11px] font-medium text-[#1B8C4B]">✓ ไม่มีปูน</span>}
                      {r.breakdownLocation && (mapUrl(r.breakdownLocation)
                        ? <a href={mapUrl(r.breakdownLocation)!} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="rounded bg-[#FEECEC] px-2 py-0.5 text-[11px] font-semibold text-[#DC2626] hover:underline">📍 จุดรถเสีย</a>
                        : <span className="rounded bg-[#FEECEC] px-2 py-0.5 text-[11px] font-medium text-[#DC2626]" title={r.breakdownLocation}>📍 {r.breakdownLocation.slice(0, 30)}{r.breakdownLocation.length > 30 ? "…" : ""}</span>)}
                      {r.repairPrice > 0 && <span className="rounded bg-[#ECFDF3] px-2 py-0.5 text-[12px] font-semibold text-[#1B8C4B]">฿ {fmtNum(r.repairPrice)}</span>}
                      {r.warranty && <span className="rounded bg-[#F1F5F2] px-2 py-0.5 text-[11px] font-medium text-[#5B7568]">🛡 {r.warranty}</span>}
                    </div>
                  </div>
                  {/* สถานะ · เอกสาร — chip ใหญ่ + progress ตามขั้น workflow */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ${sm.cls}`}><span>{sm.emoji}</span>{sm.value}</span>
                      {!!r.waitingQuote && <span className="rounded-lg bg-cyan-100 px-2 py-1 text-[11.5px] font-semibold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">🔍 รอใบเสนอราคา</span>}
                      {sla?.over && <span className="rounded bg-[#FEECEC] px-1.5 py-0.5 text-[11px] font-semibold text-[#DC2626]">⏱️ ค้าง {sla.hours} ชม. (เกิน 24 ชม.)</span>}
                    </div>
                    {(() => {
                      const flow = statusesFor(jobTypeOf(r))
                      const idx  = flow.findIndex((x) => x.value === r.status)
                      return (
                        <div className="mt-1.5 flex max-w-[220px] gap-0.5" title={`ขั้นที่ ${idx + 1} จาก ${flow.length}`}>
                          {flow.map((_, i) => (
                            <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i <= idx ? barColor(r.status) : "#E5E7EB" }} />
                          ))}
                        </div>
                      )
                    })()}
                    {/* ยืนยันตรวจเช็คประจำวัน — กดได้จากตารางเลย ไม่ต้องเปิด modal (ยกเว้นสถานะที่ไม่ต้องเช็ค) */}
                    {!isDone && needsDailyCheck(r) && (
                      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {checkedToday(r) ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[11px] font-semibold text-[#1B8C4B] dark:bg-emerald-900/25 dark:text-emerald-300"
                            title={`ยืนยันโดย ${r.lastCheckedBy || "-"} · ${fmtDateTime(r.lastCheckedAt!)}`}
                          >
                            ✅ เช็คแล้ววันนี้
                          </span>
                        ) : (
                          <button
                            onClick={() => confirmCheck(r)}
                            disabled={checking === r._id}
                            title={r.lastCheckedAt ? `เช็คล่าสุด ${fmtDateTime(r.lastCheckedAt)} โดย ${r.lastCheckedBy || "-"}` : "ยังไม่เคยยืนยันตรวจเช็ค"}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#BEE8F1] dark:border-cyan-900/40 px-2 py-0.5 text-[11px] font-semibold text-[#0E7490] dark:text-cyan-300 transition hover:bg-[#F0FBFD] dark:hover:bg-cyan-950/20 disabled:opacity-50"
                          >
                            {checking === r._id ? "กำลังบันทึก..." : "☑️ ยืนยันเช็ควันนี้"}
                          </button>
                        )}
                      </div>
                    )}
                    {!r.prCode?.trim() && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#FDF3DD] px-1.5 py-0.5 text-[11px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">⚠ ยังไม่มี PR</div>
                    )}
                    {(r.quotationDetail?.trim() || (r.quotationImages?.length ?? 0) > 0) && (
                      <div className="mt-1.5 ml-1 inline-flex items-center gap-1 rounded bg-[#E6F7FB] px-1.5 py-0.5 text-[11px] font-semibold text-[#0E7490] dark:bg-cyan-900/25 dark:text-cyan-300">🧾 มีใบเสนอราคา{(r.quotationImages?.length ?? 0) > 0 ? ` (${r.quotationImages!.length} ไฟล์)` : ""}</div>
                    )}
                    {(r.prCode || r.poCode) && (
                      <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[11.5px] text-[#5B7568]">
                        {r.prCode && <span className="inline-flex items-center gap-1 rounded bg-[#F6FAF7] dark:bg-white/5 px-1.5 py-0.5">PR <CopyText value={r.prCode} /></span>}
                        {r.poCode && r.poCode.split(",").map((po) => po.trim()).filter(Boolean).map((po, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded bg-[#F6FAF7] dark:bg-white/5 px-1.5 py-0.5">PO <CopyText value={po} /></span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* กำหนด */}
                  <div className="min-w-0 text-[12.5px]">
                    {r.dueDate
                      ? <div className={dueOverdue ? "font-bold text-[#DC2626]" : "font-medium text-[#37473E] dark:text-gray-300"}>📅 {fmtDateShort(r.dueDate)}{dueOverdue && <div className="text-[11px] font-semibold">เลยกำหนด!</div>}</div>
                      : <span className="text-[#C6D0CA]">—</span>}
                    {isDone && r.completedDate && <div className="mt-1 text-[12px] font-semibold text-[#1B8C4B]">🏁 {fmtDateShort(r.completedDate)}</div>}
                    {/* ตรวจเช็คประจำวันล่าสุด — เมื่อไหร่ โดยใคร */}
                    {!isDone && r.lastCheckedAt && (
                      <div
                        className={`mt-1.5 text-[11px] leading-snug ${checkedToday(r) ? "text-[#1B8C4B]" : "text-[#9AA8A0]"}`}
                        title={`ตรวจเช็คล่าสุด ${fmtDateTime(r.lastCheckedAt)} โดย ${r.lastCheckedBy || "-"}`}
                      >
                        ☑️ เช็คล่าสุด {fmtDateTime(r.lastCheckedAt)}
                        <div className="truncate">โดย {r.lastCheckedBy || "-"}</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Kanban board — แยกบอร์ดต่อประเภทงาน (workflow คนละชุด) */}
      {view === "board" && !isDone && [
        { type: JOB_TYPE_GARAGE, emoji: "🔧", statuses: ACTIVE_STATUSES },
        { type: JOB_TYPE_PARTS,  emoji: "🔩", statuses: PARTS_ACTIVE_STATUSES },
      ].filter((b) => !fType || fType === b.type).map((b) => {
        const boardRows = displayRows.filter((r) => jobTypeOf(r) === b.type)
        return (
        <div key={b.type} className="mb-5">
          {!fType && (
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
              <span>{b.emoji}</span>{b.type}
              <span className="rounded-full bg-[#F1F5F2] dark:bg-white/10 px-1.5 text-[11px] font-semibold text-[#5B7568] dark:text-gray-300">{boardRows.length}</span>
            </p>
          )}
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3">
            {(() => {
              // สถานะที่มีข้อมูลจริงแต่ไม่อยู่ใน workflow แล้ว (รายการเก่า/นำเข้าผิด) — ต้องมีคอลัมน์ ไม่งั้นการ์ดหายเงียบ
              const known = new Set(b.statuses.map((x) => x.value))
              const extra = [...new Set(boardRows.map((r) => r.status).filter((v) => v && !known.has(v)))]
                .map((v) => statusMeta(v))
              return [...b.statuses, ...extra]
            })().map((s) => {
              const colRows = boardRows.filter((r) => r.status === s.value)
              const isDropDone = s.value === doneStatusFor(b.type)
              const colColor = barColor(s.value)
              const colAges  = colRows.map((r) => ageDays(jobStartDate(r))).filter((n): n is number => n !== null)
              const avgCol   = colAges.length ? Math.round(colAges.reduce((a, b) => a + b, 0) / colAges.length) : 0
              return (
                <div
                  key={s.value}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverStatus !== s.value) setDragOverStatus(s.value) }}
                  onDrop={() => { const r = rows.find((x) => x._id === dragId); if (r && jobTypeOf(r) === b.type) moveStatus(r, s.value); setDragId(null); setDragOverStatus(null) }}
                  className={`flex min-w-[170px] flex-1 flex-col rounded-xl border bg-gray-50/60 dark:bg-white/[0.03] transition ${dragId && dragOverStatus === s.value ? "border-[#1B8C4B] ring-2 ring-[#1B8C4B]/30" : "border-[#EEF2F0] dark:border-white/8"}`}
                >
                  <div className="border-b border-[#EEF2F0] dark:border-white/8 px-3 py-2" style={{ borderTop: `3px solid ${colColor}`, borderTopLeftRadius: 11, borderTopRightRadius: 11 }}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
                        <span>{s.emoji}</span>{s.value}
                      </span>
                      <div className="flex items-center gap-1">
                        {colRows.length > 0 && (
                          <button
                            onClick={() => copyColumnLine(s, colRows, avgCol)}
                            title="คัดลอกทั้งคอลัมน์ (ส่งไลน์)"
                            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-[#1B8C4B]/10 hover:text-[#1B8C4B]"
                          >
                            <Copy size={12} />
                          </button>
                        )}
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold" style={{ background: colColor + "22", color: colColor }}>
                          {colRows.length}
                        </span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] text-gray-400">เฉลี่ย {avgCol} วัน</p>
                  </div>
                  <div className="min-h-[140px] flex-1 space-y-2 p-2">
                    {colRows.map((r) => {
                      const days = ageDays(jobStartDate(r))
                      const bkt  = days !== null ? agingBucket(days) : null
                      const idx  = b.statuses.findIndex((x) => x.value === r.status)
                      const dueOverdue = !!r.dueDate && r.dueDate < todayStr()
                      return (
                      <div
                        key={r._id}
                        draggable
                        onDragStart={() => setDragId(r._id)}
                        onDragEnd={() => { setDragId(null); setDragOverStatus(null) }}
                        onClick={() => openEdit(r)}
                        className={`group cursor-grab rounded-[11px] border bg-white dark:bg-[#0f1117] p-2.5 text-left shadow-sm transition hover:shadow-md active:cursor-grabbing ${dragId === r._id ? "opacity-50" : ""} ${isDup(r) ? "border-red-400 dark:border-red-500/60" : "border-[#EEF2F0] dark:border-white/10"}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="min-w-0 truncate">
                            <span className="text-[15px] font-bold text-[#14271C] dark:text-white">{r.fleetNo || r.plate || "—"}</span>
                            {r.fleetNo && r.plate && <span className="ml-1.5 text-[10px] font-normal text-[#9AA8A0]">{r.plate}</span>}
                          </span>
                          {days !== null && bkt && (
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: bkt.text, background: bkt.bg }}>{days} วัน</span>
                          )}
                        </div>
                        {isDup(r) && <div className="mt-1 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[9.5px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-300">⚠ ทะเบียนซ้ำ — ต้องลบ</div>}
                        {!!r.waitingQuote && <div className="mt-1 inline-flex items-center gap-1 rounded bg-cyan-100 px-1.5 py-0.5 text-[9.5px] font-bold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">🔍 รอใบเสนอราคา</div>}
                        {checkedToday(r) && <div className="mt-1 ml-1 inline-flex items-center gap-1 rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[9.5px] font-bold text-[#1B8C4B] dark:bg-emerald-900/25 dark:text-emerald-300" title={`ยืนยันโดย ${r.lastCheckedBy || "-"}`}>✅ เช็คแล้ว</div>}
                        {dailyStatus[r.plate] && (
                          <div className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold ${DAILY_GROUP_CLS[dailyStatus[r.plate].group] ?? DAILY_GROUP_CLS.unknown}`}
                            title={`${dailyStatus[r.plate].label} · ค้างซ่อม (B/BA) ${dailyStatus[r.plate].streak_days ?? 0} วัน · ถึง ${dailyStatus[r.plate].date}`}>
                            📊 {dailyStatus[r.plate].status}
                            {(dailyStatus[r.plate].streak_days ?? 0) > 0 && <span>· {dailyStatus[r.plate].streak_days}{dailyStatus[r.plate].streak_capped ? "+" : ""}ว</span>}
                          </div>
                        )}
                        <div className="mt-1 line-clamp-2 text-[10.5px] text-[#5B7568] dark:text-gray-400" title={r.symptom}>{r.symptom || "—"}</div>
                        {/* workflow progress */}
                        <div className="mt-2 flex gap-0.5">
                          {b.statuses.map((_, i) => (
                            <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= idx ? colColor : "#E5E7EB" }} />
                          ))}
                        </div>
                        {(r.fleet || r.plant) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.fleet && <span className="rounded bg-[#EAF6EE] px-1.5 py-0.5 text-[9.5px] font-medium text-[#0F6A3C] dark:bg-[#1B8C4B]/15 dark:text-[#4ade80]">🚚 {r.fleet}</span>}
                            {r.plant && <span className="rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[9.5px] font-medium text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300">🏭 {r.plant}</span>}
                          </div>
                        )}
                        {!r.prCode?.trim() && (
                          <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#FDF3DD] px-1.5 py-0.5 text-[10px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300">⚠ ยังไม่มี PR</div>
                        )}
                        <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#9AA8A0]">
                          <span className="truncate">{r.garage || "ยังไม่ระบุอู่"}</span>
                          {r.dueDate && <span className={`shrink-0 ${dueOverdue ? "font-semibold text-[#DC2626]" : ""}`}>📅 {fmtDateShort(r.dueDate)}</span>}
                        </div>
                        {r.repairPrice > 0 && (
                          <div className="mt-1 text-[11px] font-semibold text-[#1B8C4B]">฿ {fmtNum(r.repairPrice)}</div>
                        )}
                      </div>
                      )
                    })}
                    {colRows.length === 0 && (
                      <p className="py-6 text-center text-[11px] text-gray-300 dark:text-gray-600">
                        {isDropDone ? "ลากมาที่นี่เพื่อปิดงาน" : "—"}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </div>
        )
      })}

      {/* Modal — ฟอร์มหน้าเดียว (บนลงล่าง) header/footer ตรึง เนื้อหาเลื่อน */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 backdrop-blur-sm sm:p-4">
          <div className="my-2 flex max-h-[94vh] w-full max-w-3xl flex-col rounded-2xl border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] shadow-xl sm:my-6">
            <div className="flex items-center justify-between border-b border-[#EEF2F0] dark:border-white/8 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[17px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
                  {!editId
                    ? (isParts ? "รายการอะไหล่ลงคัน" : "รายการแจ้งซ่อม")
                    : viewOnly
                      ? (isParts ? "รายละเอียดอะไหล่ลงคัน" : "รายละเอียดรายการแจ้งซ่อม")
                      : (isParts ? "แก้ไขรายการอะไหล่ลงคัน" : "แก้ไขรายการแจ้งซ่อม")}
                </h2>
                {editId && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${isParts ? "bg-[#EEF2FF] text-[#3b5bdb] dark:bg-blue-900/25 dark:text-blue-300" : "bg-[#F1F5F2] dark:bg-white/10 text-[#5B7568] dark:text-gray-300"}`}>
                    {isParts ? "🔩" : "🔧"} {formJobType}
                  </span>
                )}
                {editId && form.plate && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 px-2.5 py-1 text-xs font-medium text-[#1B8C4B]">
                    🚚 {form.plate}{form.fleetNo ? ` · ${form.fleetNo}` : ""}
                  </span>
                )}
                {/* สถานะปัจจุบัน — อัพเดทตามที่เลือกในฟอร์มทันที */}
                {editId && form.status && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta(form.status).cls}`}>
                    {statusMeta(form.status).emoji} {form.status}
                  </span>
                )}
                {/* badge รอใบเสนอราคา — โชว์เฉพาะที่ติ๊กไว้ */}
                {editId && !!form.waitingQuote && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-bold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                    🔍 รอใบเสนอราคา
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {editId && viewOnly && (
                  <button onClick={() => setViewOnly(false)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0F6A3C]">
                    <Pencil size={14} /> แก้ไขข้อมูล
                  </button>
                )}
                {editId && (
                  <button onClick={copyShareLink} title="คัดลอกลิงก์แชร์รายการนี้" className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 transition hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5">
                    <Link2 size={14} /> คัดลอกลิงก์
                  </button>
                )}
                {editId && (
                  <button onClick={copyCarSummary} title="คัดลอกสรุปรายการนี้เป็นข้อความสำหรับส่งกลุ่มไลน์" className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 transition hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5">
                    <ClipboardList size={14} /> คัดลอกสรุปรถ
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* body — ทุก section เรียงบนลงล่างในหน้าเดียว เลื่อนดูได้ */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {viewOnly && editId ? (
                <RepairDetailCard r={form} isParts={isParts} images={formImages} quotImages={formQuotImages} negImages={formNegImages} />
              ) : (<>
              {/* ── หมวด 1: ข้อมูลรถ (เขียว) ── */}
              <section className="overflow-hidden rounded-xl border border-[#D6EFDF] dark:border-[#1B8C4B]/30">
              <p className="flex items-center gap-2 border-b border-[#D6EFDF] dark:border-[#1B8C4B]/30 bg-[#EAF6EE] dark:bg-[#1B8C4B]/15 px-4 py-2.5 text-[15px] font-bold text-[#0F6A3C] dark:text-[#4ade80]" style={{ fontFamily: "'Mitr', sans-serif" }}>🚚 ข้อมูลรถ</p>
              {(
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                  {/* ประเภทงาน — เลือกได้เฉพาะตอนสร้างใหม่ (แก้ไขเปลี่ยนประเภทไม่ได้ เพราะ workflow คนละชุด) */}
                  {!editId && (
                    <div className="sm:col-span-2">
                      <label className={labelCls}>ประเภทงาน</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { value: JOB_TYPE_GARAGE, emoji: "🔧", title: "ซ่อมอู่นอก",     desc: "ส่งรถซ่อมที่อู่ภายนอก" },
                          { value: JOB_TYPE_PARTS,  emoji: "🔩", title: "อะไหล่ลงคัน",    desc: "สั่งซื้ออะไหล่มาลงคัน" },
                        ].map((t) => {
                          const active = formJobType === t.value
                          return (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() => setJobType(t.value)}
                              className={`rounded-xl border-2 px-3 py-3 text-left transition ${active ? "border-[#1B8C4B] bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10 hover:border-[#1B8C4B]/40"}`}
                            >
                              <span className="flex items-center gap-1.5 text-[14px] font-bold text-[#14271C] dark:text-white">{t.emoji} {t.title}{active && <Check size={14} className="text-[#1B8C4B]" />}</span>
                              <span className="mt-0.5 block text-[11px] text-[#9AA8A0]">{t.desc}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label className={labelCls}>ทะเบียนรถ <span className="text-red-500">*</span></label>
                    <PlateCombobox
                      plate={form.plate}
                      onChange={(plate, fleetNo) => setForm((f) => ({ ...f, plate, ...(fleetNo !== undefined ? { fleetNo } : {}) }))}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>เบอร์รถ <span className="text-[10px] font-normal text-gray-400">(auto · พิมพ์เพื่อค้นหาได้)</span></label>
                    <FleetNoCombobox
                      fleetNo={form.fleetNo}
                      onChange={(fleetNo, plate) => setForm((f) => ({ ...f, fleetNo, ...(plate !== undefined ? { plate } : {}) }))}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>วันที่รับแจ้ง</label>
                    <input type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>ฟลีท <span className="text-[10px] font-normal text-gray-400">(auto · ไม่มีเลือกจาก list)</span></label>
                    <input list="fleet-options" value={form.fleet} onChange={(e) => setForm({ ...form, fleet: e.target.value })} className={inputCls + " bg-[#F6FAF7] dark:bg-white/5"} placeholder="ฟลีท — พิมพ์หรือเลือก" />
                    <datalist id="fleet-options">
                      {fleetOptions.map((f) => <option key={f} value={f} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className={labelCls}>แพล้นท์ <span className="text-[10px] font-normal text-gray-400">(auto)</span></label>
                    <input value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })} className={inputCls + " bg-[#F6FAF7] dark:bg-white/5"} placeholder="แพล้นท์" />
                  </div>
                  {vdRef && (
                    <p className="sm:col-span-2 -mt-1 text-[11px] text-[#9AA8A0]">
                      ⓘ ฟลีท/แพล้นท์ อ้างอิงข้อมูลรถ ณ วันที่ <b className="text-[#5B7568] dark:text-gray-400">{vdRef}</b> (atms.vehicle_daily)
                    </p>
                  )}
                  <div>
                    <label className={labelCls}>👤 ชื่อคนขับ</label>
                    <input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} className={inputCls} placeholder="ชื่อ-นามสกุล คนขับ" />
                  </div>
                  <div>
                    <label className={labelCls}>📞 เบอร์โทรคนขับ</label>
                    <input type="tel" value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} className={inputCls} placeholder="เช่น 081-234-5678" />
                  </div>
                  <div>
                    <label className={labelCls}>🚦 สภาพรถ</label>
                    <div className="inline-flex w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 p-0.5">
                      {["วิ่งได้", "วิ่งไม่ได้"].map((ds) => {
                        const active = form.drivableStatus === ds
                        return (
                          <button
                            key={ds}
                            type="button"
                            onClick={() => setForm({ ...form, drivableStatus: active ? "" : ds })}
                            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? (ds === "วิ่งไม่ได้" ? "bg-[#DC2626] text-white" : "bg-[#1B8C4B] text-white") : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
                          >
                            {ds === "วิ่งไม่ได้" ? "🛑 วิ่งไม่ได้" : "✓ วิ่งได้"}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>🥣 ปูนในโม่</label>
                    <div className="inline-flex w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 p-0.5">
                      {["มีปูน", "ไม่มีปูน"].map((cs) => {
                        const active = form.cementStatus === cs
                        return (
                          <button
                            key={cs}
                            type="button"
                            onClick={() => setForm({ ...form, cementStatus: active ? "" : cs })}
                            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? (cs === "มีปูน" ? "bg-[#DC2626] text-white" : "bg-[#1B8C4B] text-white") : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
                          >
                            {cs === "มีปูน" ? "⚠ มีปูน" : "✓ ไม่มีปูน"}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>📍 พิกัดที่รถเสีย <span className="text-[10px] font-normal text-gray-400">(วางลิงก์ Google Maps / lat,long / หรือพิมพ์อธิบาย)</span></label>
                    <input value={form.breakdownLocation} onChange={(e) => setForm({ ...form, breakdownLocation: e.target.value })} className={inputCls} placeholder="เช่น https://maps.app.goo.gl/... หรือ 13.7563,100.5018 หรือ ถ.บางนา-ตราด กม.18" />
                    {mapUrl(form.breakdownLocation) && (
                      <a href={mapUrl(form.breakdownLocation)!} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#1B8C4B] hover:underline">
                        📍 เปิดแผนที่
                      </a>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>ไฟล์แนบ <span className="text-[10px] font-normal text-gray-400">(รูป / เอกสาร)</span></label>
                    <ImageUpload initial={formImages} onChange={setFormImages} />
                  </div>
                </div>
              )}

              </section>

              {/* ── หมวด 2: งานซ่อม (ส้ม) / อะไหล่ (น้ำเงิน) ── */}
              <section className={`mt-5 overflow-hidden rounded-xl border ${isParts ? "border-[#C7D6FB] dark:border-blue-500/30" : "border-[#F8D8C2] dark:border-orange-500/30"}`}>
              <p className={`flex items-center gap-2 border-b px-4 py-2.5 text-[15px] font-bold ${isParts ? "border-[#C7D6FB] dark:border-blue-500/30 bg-[#EEF2FF] dark:bg-blue-500/15 text-[#3b5bdb] dark:text-blue-300" : "border-[#F8D8C2] dark:border-orange-500/30 bg-[#FFF3E8] dark:bg-orange-500/15 text-[#C2410C] dark:text-orange-300"}`} style={{ fontFamily: "'Mitr', sans-serif" }}>{isParts ? "🔩 อะไหล่" : "🔧 งานซ่อม"}</p>
              {(
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>{isParts ? "รายการอะไหล่ที่สั่ง" : "รายละเอียดอาการ"}</label>
                    <textarea value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} rows={3} className={inputCls} placeholder={isParts ? "อะไหล่ที่สั่งซื้อ / จำนวน / สเปก" : "อาการที่พบ / สิ่งที่ต้องซ่อม"} />
                  </div>
                  <div>
                    <label className={labelCls}>{isParts ? "ร้านค้า / ผู้ขาย" : "อู่"}</label>
                    <GarageCombobox value={form.garage} garages={garages} onChange={(name) => setForm({ ...form, garage: name })} onCreated={(g) => { setGarages((prev) => [...prev, g].sort((a, b) => a.name.localeCompare(b.name, "th"))) }} />
                  </div>
                  {!isParts && (
                    <div>
                      <label className={labelCls}>วันที่รถเข้าอู่ซ่อม {isReq("garageInDate") && <span className="text-amber-500">*</span>}</label>
                      <input type="date" value={form.garageInDate} onChange={(e) => setForm({ ...form, garageInDate: e.target.value })} className={inputCls + reqCls("garageInDate")} />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label className={labelCls}>เลขใบแจ้งซ่อม MR</label>
                    <input value={form.mrNo} onChange={(e) => setForm({ ...form, mrNo: e.target.value })} className={inputCls} placeholder="เช่น MR-2568-0001" />
                  </div>
                </div>
              )}

              </section>

              {/* ── หมวด 2.5: ใบเสนอราคา (ฟ้า) — รายละเอียด + แนบ PDF/รูป ── */}
              <section className="mt-5 overflow-hidden rounded-xl border border-[#BEE7F2] dark:border-cyan-500/30">
                <p className="flex items-center gap-2 border-b border-[#BEE7F2] dark:border-cyan-500/30 bg-[#E6F7FB] dark:bg-cyan-500/15 px-4 py-2.5 text-[15px] font-bold text-[#0E7490] dark:text-cyan-300" style={{ fontFamily: "'Mitr', sans-serif" }}>🧾 ใบเสนอราคา</p>
                <div className="space-y-4 p-4">
                  <div>
                    <label className={labelCls}>รายละเอียดใบเสนอราคา</label>
                    <textarea value={form.quotationDetail} onChange={(e) => setForm({ ...form, quotationDetail: e.target.value })} rows={3} className={inputCls} placeholder="เช่น รายการที่เสนอ / ราคา / เงื่อนไข / หมายเหตุจากอู่" />
                  </div>
                  <div>
                    <label className={labelCls}>แนบใบเสนอราคา <span className="text-[10px] font-normal text-gray-400">(PDF หรือรูปภาพ)</span></label>
                    <ImageUpload key={(editId ?? "new") + "-quot"} initial={formQuotImages} onChange={setFormQuotImages} />
                  </div>
                </div>
              </section>

              {/* ── หมวด 3: สถานะ · เอกสาร (ม่วง) ── */}
              <section className="mt-5 overflow-hidden rounded-xl border border-[#E4D5FB] dark:border-violet-500/30">
              <p className="flex items-center gap-2 border-b border-[#E4D5FB] dark:border-violet-500/30 bg-[#F3E8FF] dark:bg-violet-500/15 px-4 py-2.5 text-[15px] font-bold text-[#7C3AED] dark:text-violet-300" style={{ fontFamily: "'Mitr', sans-serif" }}>📋 สถานะ · เอกสาร</p>
              {(
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>สถานะ</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={statusLocked} className={inputCls + (statusLocked ? " cursor-not-allowed opacity-60" : "")}>
                      {statusesFor(formJobType).map((s) => (<option key={s.value} value={s.value}>{s.emoji} {s.value}</option>))}
                    </select>
                    {/* tickbox รอใบเสนอราคา (เฉพาะอู่นอก) — แทนสถานะเดิมที่ถูกถอดจาก workflow */}
                    {!isParts && (
                      <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#BEE8F1] dark:border-cyan-500/30 bg-[#F0FBFD] dark:bg-cyan-500/10 px-3 py-2 text-[13px] font-medium text-[#0E7490] dark:text-cyan-300">
                        <input
                          type="checkbox"
                          checked={!!form.waitingQuote}
                          onChange={(e) => setForm({ ...form, waitingQuote: e.target.checked ? "รอใบเสนอราคา" : "" })}
                          className="h-4 w-4 accent-[#0891B2]"
                        />
                        🔍 รอใบเสนอราคา
                      </label>
                    )}
                    {statusLocked && <p className="mt-1 text-[11px] text-[#9AA8A0]">🔒 ปิดงานแล้ว ({origStatus}) — เปลี่ยน/ย้อนสถานะไม่ได้</p>}
                    {/* ปฏิทินตรวจเช็คประจำวัน — ย้อนหลังตั้งแต่วันรับแจ้ง กดได้เฉพาะช่อง "วันนี้" */}
                    {editId && editRow && needsDailyCheck(editRow) && (() => {
                      const today = bkkDate()
                      const byDate = new Map<string, { by: string; at: string }>()
                      for (const c of editRow.dailyChecks ?? []) byDate.set(c.date, { by: c.by, at: c.at })
                      // รายการที่เช็คก่อนมี dailyChecks — เติมจาก lastCheckedAt
                      if (editRow.lastCheckedAt && !byDate.has(bkkDate(editRow.lastCheckedAt)))
                        byDate.set(bkkDate(editRow.lastCheckedAt), { by: editRow.lastCheckedBy || "", at: editRow.lastCheckedAt })
                      // ไล่วันจากวันรับแจ้ง → วันนี้ (โชว์ล่าสุดไม่เกิน 60 วัน)
                      // receivedDate อาจเป็นวันในอนาคต (คีย์ผิด) — ให้เริ่มไม่เกินวันนี้ ปฏิทินจะได้มีช่องวันนี้เสมอ
                      const rcv = editRow.receivedDate && editRow.receivedDate < today ? editRow.receivedDate : today
                      const startTs = Date.parse(rcv)
                      const days: string[] = []
                      for (let t = isNaN(startTs) ? Date.parse(today) : startTs; ; t += 86400000) {
                        const ds = new Date(t).toISOString().slice(0, 10)
                        if (ds > today) break
                        days.push(ds)
                      }
                      const hidden = Math.max(0, days.length - 60)
                      const shown = days.slice(-60)
                      const doneCnt = days.filter((ds) => byDate.has(ds)).length
                      const fmtD = (ds: string) => new Date(ds).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
                      return (
                        <div className="mt-2 rounded-lg bg-[#F9FCFA] dark:bg-white/[0.02] px-3 py-2.5">
                          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[11.5px] font-semibold text-[#5B7568] dark:text-gray-300">🗓 ตรวจเช็คประจำวัน</span>
                            <span className="text-[11px] text-[#9AA8A0]">เช็คแล้ว {doneCnt}/{days.length} วัน (นับจากวันรับแจ้ง{hidden > 0 ? ` · แสดง 60 วันล่าสุด` : ""})</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {shown.map((ds) => {
                              const c = byDate.get(ds)
                              const isToday = ds === today
                              const base = "flex h-7 w-7 items-center justify-center rounded-md text-[10.5px] font-semibold"
                              if (isToday) {
                                return c ? (
                                  <span key={ds} title={`วันนี้ ${fmtD(ds)} — ✅ เช็คแล้ว โดย ${c.by || "-"}`} className={`${base} bg-[#1B8C4B] text-white ring-2 ring-[#1B8C4B]/40`}>✓</span>
                                ) : (
                                  // ช่องวันนี้ = ปุ่มเดียวที่กดได้
                                  <button
                                    key={ds}
                                    type="button"
                                    onClick={() => confirmCheck(editRow)}
                                    disabled={checking === editRow._id}
                                    title={`วันนี้ ${fmtD(ds)} — กดเพื่อยืนยันว่าตรวจเช็คแล้ว`}
                                    className={`${base} animate-pulse border-2 border-[#0891B2] bg-[#F0FBFD] text-[#0E7490] hover:bg-[#0891B2] hover:text-white dark:bg-cyan-950/30 dark:text-cyan-300 disabled:opacity-50`}
                                  >
                                    {new Date(ds).getDate()}
                                  </button>
                                )
                              }
                              return c ? (
                                <span key={ds} title={`${fmtD(ds)} — ✅ เช็คแล้ว โดย ${c.by || "-"}`} className={`${base} bg-[#ECFDF3] text-[#1B8C4B] dark:bg-emerald-900/25 dark:text-emerald-300`}>✓</span>
                              ) : (
                                <span key={ds} title={`${fmtD(ds)} — ไม่ได้เช็ค`} className={`${base} bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500`}>{new Date(ds).getDate()}</span>
                              )
                            })}
                          </div>
                          <p className="mt-1.5 text-[10.5px] text-[#9AA8A0]">✓ เขียว = เช็คแล้ว · เทา = ไม่ได้เช็ค (ย้อนหลังกดไม่ได้) · กรอบฟ้ากะพริบ = วันนี้ กดยืนยันได้</p>
                        </div>
                      )
                    })()}
                    {missingReq.length > 0 && (
                      <p className="mt-1 rounded-md bg-[#FDF3DD] px-2 py-1 text-[11px] text-[#B07D12]">
                        ⚠ สถานะนี้ต้องกรอกให้ครบก่อนบันทึก: {missingReq.map((m) => m.label).join(", ")}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>รหัส PR {isReq("prCode") && <span className="text-amber-500">*</span>}</label>
                    <input value={form.prCode} onChange={(e) => setForm({ ...form, prCode: e.target.value })} className={inputCls + reqCls("prCode")} placeholder="รหัส PR" />
                  </div>
                  <div>
                    <label className={labelCls}>รหัส PO {isReq("poCode") && <span className="text-amber-500">*</span>} <span className="text-[10px] font-normal text-gray-400">(หลายอันได้)</span></label>
                    <TagInput value={form.poCode} onChange={(v) => setForm({ ...form, poCode: v })} placeholder="พิมพ์รหัส PO แล้วกด Enter" invalid={isReq("poCode") && !form.poCode.trim()} mono />
                  </div>
                  <div>
                    <label className={labelCls}>{isParts ? "กำหนดของถึง" : "วันกำหนดเสร็จ"} {isReq("dueDate") && <span className="text-amber-500">*</span>}</label>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls + reqCls("dueDate")} />
                  </div>
                  <div>
                    <label className={labelCls}>{isParts ? "วันที่ลงคันเสร็จ" : "วันที่ซ่อมเสร็จ"} {isReq("completedDate") && <span className="text-amber-500">*</span>}</label>
                    <input type="date" value={form.completedDate} onChange={(e) => setForm({ ...form, completedDate: e.target.value })} className={inputCls + reqCls("completedDate")} />
                  </div>
                  <div>
                    <label className={labelCls}>{isParts ? "ราคาอะไหล่ (บาท)" : "ราคาซ่อม (บาท)"}</label>
                    <input type="number" min={0} step="0.01" value={form.repairPrice || ""} onChange={(e) => setForm({ ...form, repairPrice: Number(e.target.value) })} className={inputCls} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelCls}>รับประกัน</label>
                    <select value={form.warranty} onChange={(e) => setForm({ ...form, warranty: e.target.value })} className={inputCls}>
                      <option value="">— ไม่ระบุ —</option>
                      {WARRANTY_OPTIONS.map((w) => (<option key={w} value={w}>{w}</option>))}
                      {form.warranty && !WARRANTY_OPTIONS.includes(form.warranty) && (<option value={form.warranty}>{form.warranty}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>หมายเหตุ</label>
                    <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className={inputCls} placeholder="หมายเหตุเพิ่มเติม" />
                  </div>

                  {/* ── การต่อรอง ── */}
                  <div className="sm:col-span-2 rounded-xl border border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] p-3">
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">💬 การต่อรอง</p>
                      <div className="inline-flex rounded-lg border border-[#E2E8E4] dark:border-white/10 p-0.5">
                        {["ทั้งหมด", "ระบุสินค้า/บริการ"].map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => setForm({ ...form, negotiationScope: sc, ...(sc === "ทั้งหมด" ? { negotiationItem: "" } : {}) })}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${form.negotiationScope === sc ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}
                          >
                            {sc}
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.negotiationScope === "ระบุสินค้า/บริการ" && (
                      <div className="mb-3">
                        <label className={labelCls}>ระบุสินค้า / บริการที่ต่อรอง <span className="text-[10px] font-normal text-gray-400">(หลายอันได้)</span></label>
                        <TagInput value={form.negotiationItem} onChange={(v) => setForm({ ...form, negotiationItem: v })} placeholder="พิมพ์สินค้า/บริการ แล้วกด Enter" />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>ราคาเสนอครั้งแรก (บาท)</label>
                        <input type="number" min={0} step="0.01" value={form.offerPrice || ""} onChange={(e) => setForm({ ...form, offerPrice: Number(e.target.value) })} className={inputCls} placeholder="0.00" />
                      </div>
                      <div>
                        <label className={labelCls}>ราคาต่อรอง (บาท)</label>
                        <input type="number" min={0} step="0.01" value={form.negotiatedPrice || ""} onChange={(e) => setForm({ ...form, negotiatedPrice: Number(e.target.value) })} className={inputCls} placeholder="0.00" />
                      </div>
                      <div>
                        <label className={labelCls}>ประกันเสนอครั้งแรก</label>
                        <select value={form.offerWarranty} onChange={(e) => setForm({ ...form, offerWarranty: e.target.value })} className={inputCls}>
                          <option value="">— ไม่ระบุ —</option>
                          {WARRANTY_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                          {form.offerWarranty && !WARRANTY_OPTIONS.includes(form.offerWarranty) && <option value={form.offerWarranty}>{form.offerWarranty}</option>}
                        </select>
                      </div>
                    </div>
                    {form.offerPrice > 0 && form.negotiatedPrice > 0 && form.negotiatedPrice < form.offerPrice && (
                      <p className="mt-2 text-[11px] font-medium text-[#1B8C4B]">✓ ต่อรองลดได้ ฿{fmtNum(form.offerPrice - form.negotiatedPrice)} ({Math.round((1 - form.negotiatedPrice / form.offerPrice) * 100)}%)</p>
                    )}
                    <div className="mt-3">
                      <label className={labelCls}>แนบหลักฐานการต่อรอง <span className="text-[10px] font-normal text-gray-400">(ใบเสนอราคา / แชท / เอกสาร)</span></label>
                      <ImageUpload initial={formNegImages} onChange={setFormNegImages} />
                    </div>
                  </div>
                </div>
              )}

              </section>

              </>)}

              {/* ── หมวด 4: ประวัติ (เทา) — โชว์ในหน้าเลย โฟกัสเส้นทางสถานะ ── */}
              {editId && (
                <section className="mt-5 overflow-hidden rounded-xl border border-[#EEF2F0] dark:border-white/10">
                  <p className="flex items-center gap-2 border-b border-[#EEF2F0] dark:border-white/10 bg-[#F6FAF7] dark:bg-white/5 px-4 py-2.5 text-[15px] font-bold text-[#37473E] dark:text-gray-200" style={{ fontFamily: "'Mitr', sans-serif" }}>🔄 เส้นทางสถานะ · ประวัติการแก้ไข</p>
                  <div className="p-4">

                  {/* ย้อนสถานะกลับ (ปิดงานแล้วย้อนไม่ได้) */}
                  {editRow && !isDoneStatus(editRow.status) && (() => {
                    const lastSC = logEntries.find((e) => e.statusChange && e.action !== "create")
                    const prev = lastSC?.statusChange?.from
                    if (!prev || prev === editRow.status) return null
                    return (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F9FCFA] dark:bg-white/[0.02] px-3 py-2">
                        <span className="text-xs text-[#9AA8A0]">ปัจจุบัน: <b className="text-[#5B7568] dark:text-gray-300">{statusMeta(editRow.status).emoji} {editRow.status}</b></span>
                        <button onClick={() => revertStatus(editRow, prev)} className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5">
                          <ArrowRight size={13} className="rotate-180" /> ย้อนเป็น “{prev}”
                        </button>
                      </div>
                    )
                  })()}

                  {logLoading ? (
                    <p className="py-4 text-center text-sm text-gray-400">กำลังโหลด...</p>
                  ) : logEntries.length === 0 ? (
                    <p className="py-2 text-sm text-gray-400">ยังไม่มีประวัติ — รายการที่นำเข้าจากไฟล์จะเริ่มบันทึกประวัติเมื่อมีการแก้ไขครั้งถัดไป</p>
                  ) : (() => {
                    // เรียงเก่า→ใหม่ + คำนวณ "อยู่ขั้นนี้กี่วัน"
                    const chrono = [...logEntries].reverse()
                    const scs = chrono.filter((e) => e.statusChange)
                    const fieldEntries = logEntries.filter((e) => (e.changes ?? []).some((c) => c.field !== "status"))
                    const dayMs = 86400000
                    return (
                      <>
                        {scs.length === 0 ? (
                          <p className="pb-2 text-sm text-gray-400">ยังไม่มีการเปลี่ยนสถานะที่บันทึกไว้</p>
                        ) : (
                          <ol className="relative ml-1 space-y-5 border-l-2 border-[#EEF2F0] dark:border-white/10 pl-5">
                            {scs.map((e, i) => {
                              const to   = e.statusChange!.to
                              const next = scs[i + 1]
                              const endMs   = next ? Date.parse(next.at) : Date.now()
                              const stayDay = Math.max(0, Math.round((endMs - Date.parse(e.at)) / dayMs))
                              const isCurrent = !next
                              const stayColor = stayDay > 5 ? "#DC2626" : stayDay > 2 ? "#B07D12" : "#1B8C4B"
                              return (
                                <li key={e._id} className="relative">
                                  <span className="absolute -left-[27px] top-0.5 h-4 w-4 rounded-full ring-4 ring-white dark:ring-[#151a10]" style={{ background: barColor(to) }} />
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[13px] font-semibold ${statusMeta(to).cls}`}>
                                      {statusMeta(to).emoji} {showVal(to)}
                                    </span>
                                    {isCurrent && !isDoneStatus(to) && <span className="rounded-full bg-[#14271C] px-2 py-0.5 text-[10px] font-bold text-white dark:bg-white dark:text-[#14271C]">ปัจจุบัน</span>}
                                    <span
                                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                      style={{ color: stayColor, background: stayColor + "1A" }}
                                      title={isCurrent ? "อยู่ขั้นนี้มาแล้ว" : "ใช้เวลาในขั้นนี้"}
                                    >
                                      ⏱ {stayDay} วัน{isCurrent && !isDoneStatus(to) ? " (กำลังดำเนินอยู่)" : ""}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11.5px] text-gray-400">
                                    {e.action === "create" ? "เปิดรายการ" : <>จาก {showVal(e.statusChange!.from)}</>} · {e.by || e.byEmail || "ไม่ระบุผู้ใช้"} · {fmtDateTime(e.at)}
                                  </p>
                                </li>
                              )
                            })}
                          </ol>
                        )}
                        {fieldEntries.length > 0 && (
                          <div className="mt-4">
                            <button type="button" onClick={() => setShowFieldLog((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1B8C4B] hover:underline">
                              <History size={13} /> {showFieldLog ? "ซ่อนการแก้ไขอื่น" : `ดูการแก้ไขอื่น (${fieldEntries.length})`}
                            </button>
                            {showFieldLog && (
                              <ol className="mt-3 space-y-3">
                                {fieldEntries.map((e) => (
                                  <li key={e._id} className="rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2">
                                    <p className="text-[11px] text-gray-400">{e.by || e.byEmail || "ไม่ระบุผู้ใช้"} · {fmtDateTime(e.at)}</p>
                                    <ul className="mt-1 space-y-1">
                                      {(e.changes ?? []).filter((c) => c.field !== "status").map((c) => (
                                        <li key={c.field} className="text-[11.5px]">
                                          <span className="font-medium text-gray-600 dark:text-gray-300">{c.label}: </span>
                                          <span className="text-gray-400 line-through">{showVal(c.from)}</span>
                                          <ArrowRight size={10} className="mx-1 inline text-gray-400" />
                                          <span className="text-gray-700 dark:text-gray-200">{showVal(c.to)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
                </section>
              )}

              {/* ── Timeline ATMS (เฉพาะงานอู่นอก — โหลดเมื่อกด) ── */}
              {editId && jobTypeOf(form) !== JOB_TYPE_PARTS && (
                <section className="mt-5 overflow-hidden rounded-xl border border-[#EEF2F0] dark:border-white/10">
                  <div className="flex items-center justify-between gap-2 border-b border-[#EEF2F0] dark:border-white/10 bg-[#F6FAF7] dark:bg-white/5 px-4 py-2.5">
                    <p className="text-[15px] font-bold text-[#37473E] dark:text-gray-200" style={{ fontFamily: "'Mitr', sans-serif" }}>📜 Timeline Mena-Next (ระบบแจ้งซ่อม)</p>
                    <button
                      type="button"
                      onClick={loadAtmsTimeline}
                      disabled={atmsTlLoading || !form.plate.trim()}
                      className="rounded-lg border border-[#E2E8E4] dark:border-white/10 px-3 py-1 text-[12px] font-bold text-gray-600 dark:text-gray-300 hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5 disabled:opacity-50"
                    >
                      {atmsTlLoading ? "กำลังโหลด..." : atmsTl ? "รีเฟรช" : "โหลด Timeline"}
                    </button>
                  </div>
                  <div className="p-4">
                    {atmsTlErr && <p className="text-sm text-red-500">โหลดไม่สำเร็จ: {atmsTlErr}</p>}
                    {atmsTl === null && !atmsTlErr && !atmsTlLoading && (
                      <p className="text-sm text-gray-400">กด “โหลด Timeline” เพื่อดึงประวัติ MR, PR/PO และ event ทั้งหมดของคันนี้จาก Mena-Next (ปี {new Date(Date.now() + 25200000).getUTCFullYear()})</p>
                    )}
                    {atmsTl !== null && atmsTl.length === 0 && <p className="text-sm text-gray-400">ไม่พบข้อมูลใน Mena-Next สำหรับทะเบียนนี้</p>}
                    {atmsTl !== null && atmsTl.length > 0 && (
                      <div className="space-y-4">
                        {atmsTl.map((it, idx) => (
                          <div key={it.code ?? idx} className="rounded-lg border border-[#EEF2F0] dark:border-white/10 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-[13px]">
                              <b className="text-[#14271C] dark:text-white">{it.code ?? "-"}</b>
                              {it.branch_name && <span className="text-gray-400">· {it.branch_name}</span>}
                              {it.mechanic_name && <span className="text-gray-400">· ช่าง {it.mechanic_name}</span>}
                            </div>
                            {(it.tasks ?? []).length > 0 && (
                              <ul className="mt-1.5 space-y-0.5">
                                {(it.tasks ?? []).map((t, i) => (
                                  <li key={i} className="text-[12.5px] text-gray-700 dark:text-gray-300">🔧 {t.problem ?? "-"}{t.maintenance_type ? <span className="text-gray-400"> ({t.maintenance_type})</span> : null}</li>
                                ))}
                              </ul>
                            )}
                            {(it.purchase_requests ?? []).length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {(it.purchase_requests ?? []).map((pr, i) => (
                                  <span key={i} className="rounded bg-[#FDF3DD] px-1.5 py-0.5 text-[11px] font-semibold text-[#B07D12] dark:bg-amber-900/25 dark:text-amber-300" title={(pr.purchase_orders ?? []).map((po) => `${po.po_code} · ${po.supplier ?? "-"} · ${po.received_status ?? "-"}`).join("\n") || "ยังไม่มี PO"}>
                                    {pr.pr_code}{pr.amount ? ` ฿${(pr.amount).toLocaleString("th-TH")}` : ""}{pr.is_approved ? " ✓" : " (รออนุมัติ)"}
                                    {(pr.purchase_orders ?? []).length > 0 && ` → ${(pr.purchase_orders ?? []).map((po) => po.po_code).join(", ")}`}
                                  </span>
                                ))}
                              </div>
                            )}
                            {(it.timeline_events ?? []).length > 0 && (
                              <ol className="relative ml-1 mt-3 space-y-2.5 border-l-2 border-[#EEF2F0] dark:border-white/10 pl-4">
                                {[...(it.timeline_events ?? [])]
                                  .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
                                  .slice(0, 40)
                                  .map((ev, i) => (
                                    <li key={ev.uid ?? i} className="relative">
                                      <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${ev.source === "wms" ? "bg-[#1B8C4B]" : "bg-indigo-400"}`} />
                                      <p className="text-[12.5px] text-gray-700 dark:text-gray-300">
                                        <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-bold ${ev.source === "wms" ? "bg-[#ECFDF3] text-[#1B8C4B] dark:bg-emerald-900/25 dark:text-emerald-300" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/25 dark:text-indigo-300"}`}>{ev.source === "wms" ? "WMS" : "Mena-Next"}</span>
                                        {ev.label ?? "-"}
                                      </p>
                                      <p className="text-[11px] text-gray-400">{ev.action_by ? `${ev.action_by} · ` : ""}{ev.at ? fmtDateTime(ev.at) : "-"}</p>
                                    </li>
                                  ))}
                              </ol>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── ความคิดเห็น / โน้ต (ฝังในหน้าแก้ไข) ── */}
              {editId && (
                <div className="mt-5 rounded-xl border border-[#EEF2F0] dark:border-white/8 bg-[#F9FCFA] dark:bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <MessageSquare size={15} className="text-[#1B8C4B]" />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">ความคิดเห็น / โน้ต</span>
                    <span className="rounded-full bg-[#F1F5F2] dark:bg-white/10 px-1.5 text-xs font-medium text-[#5B7568] dark:text-gray-300">{comments.length}</span>
                  </div>

                  <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                    {cmtLoading ? (
                      <p className="py-3 text-center text-xs text-gray-400">กำลังโหลด...</p>
                    ) : comments.filter((c) => !c.parentId).length === 0 ? (
                      <p className="py-3 text-center text-xs text-gray-400">ยังไม่มีความคิดเห็น — เริ่มเขียนได้เลย</p>
                    ) : (
                      comments.filter((c) => !c.parentId).map((c) => (
                        <div key={c._id}>
                          <CommentRow c={c} />
                          {comments.filter((r) => r.parentId === c._id).length > 0 && (
                            <div className="ml-4 mt-2 space-y-2 border-l-2 border-[#EEF2F0] dark:border-white/10 pl-3">
                              {comments.filter((r) => r.parentId === c._id).map((rc) => <CommentRow key={rc._id} c={rc} reply />)}
                            </div>
                          )}
                          {replyTo === c._id ? (
                            <div className="ml-4 mt-2 flex items-center gap-2 pl-3">
                              <input autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(replyText, c._id) } }} placeholder="ตอบกลับ..." className="flex-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-2.5 py-1.5 text-sm focus:border-[#1B8C4B] focus:outline-none" />
                              <button type="button" onClick={() => postComment(replyText, c._id)} disabled={posting || !replyText.trim()} className="rounded-lg bg-[#1B8C4B] p-1.5 text-white hover:bg-[#0F6A3C] disabled:opacity-50"><Send size={14} /></button>
                              <button type="button" onClick={() => { setReplyTo(null); setReplyText("") }} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"><X size={14} /></button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setReplyTo(c._id); setReplyText("") }} className="ml-4 mt-1 inline-flex items-center gap-1 pl-3 text-[11px] font-medium text-[#1B8C4B] hover:underline">
                              <CornerDownRight size={11} /> ตอบกลับ
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input value={cmtText} onChange={(e) => setCmtText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(cmtText, null) } }} placeholder="เขียนความคิดเห็น / โน้ตล่าสุด..." className={inputCls} />
                    <button type="button" onClick={() => postComment(cmtText, null)} disabled={posting || !cmtText.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#1B8C4B] px-3 py-2 text-sm font-medium text-white hover:bg-[#0F6A3C] disabled:opacity-50"><Send size={15} /> ส่ง</button>
                  </div>
                </div>
              )}
            </div>

            {/* footer ตรึงล่าง — ลบได้จากที่นี่ที่เดียว (ตารางไม่มีปุ่มลบแล้ว) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F0] dark:border-white/8 px-5 py-3.5">
              <div>
                {editId && editRow && !viewOnly && (
                  <button onClick={() => remove(editRow)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#F3C1C1] dark:border-red-900/40 px-3.5 py-2 text-sm font-medium text-[#DC2626] hover:bg-[#FEECEC] dark:hover:bg-red-950/20">
                    <Trash2 size={15} /> ลบรายการ
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {viewOnly && editId ? (
                  <>
                    <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">ปิด</button>
                    <button onClick={() => setViewOnly(false)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"><Pencil size={15} /> แก้ไขข้อมูล</button>
                  </>
                ) : (
                  <>
                    <button onClick={cancelEdit} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">ยกเลิก</button>
                    <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60"><Check size={16} /> {saving ? "กำลังบันทึก..." : editId ? "บันทึกการแก้ไข" : "บันทึก"}</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}

/* ── ทะเบียนรถ combobox: ค้นหาจาก atms.vehicle_daily (ล่าสุด), เลือกแล้วเติมเบอร์รถให้ ── */
type Vehicle = { plate: string; fleetNo?: string; fleet?: string; vehicleType?: string }

function PlateCombobox({
  plate, onChange,
}: {
  plate: string
  onChange: (plate: string, fleetNo?: string) => void
}) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState(plate)
  const [opts, setOpts]       = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // sync ข้อความในช่องเมื่อค่าจากภายนอกเปลี่ยน (เช่น เปิด modal ใหม่)
  useEffect(() => { setText(plate) }, [plate])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  // ค้นหาแบบ debounce
  useEffect(() => {
    if (!open) return
    const query = text.trim()
    if (!query) { setOpts([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/vehicle-daily?q=${encodeURIComponent(query)}&limit=20`)
        const data = await res.json()
        setOpts(Array.isArray(data) ? data : [])
      } catch { setOpts([]) } finally { setLoading(false) }
    }, 200)
    return () => clearTimeout(t)
  }, [text, open])

  return (
    <div ref={boxRef} className="relative">
      <input
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); onChange(e.target.value) }}
        className={inputCls}
        placeholder="พิมพ์เพื่อค้นหา เช่น สบ 1234"
        autoComplete="off"
      />
      {open && text.trim() && (
        <div className="absolute z-[60] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg py-1">
          {loading && <p className="px-3 py-2 text-xs text-gray-400">กำลังค้นหา...</p>}
          {!loading && opts.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">ไม่พบทะเบียนใน vehicle_daily — ใช้ค่าที่พิมพ์ได้เลย</p>
          )}
          {opts.map((v) => (
            <button
              key={v.plate}
              type="button"
              onClick={() => { onChange(v.plate, v.fleetNo ?? ""); setText(v.plate); setOpen(false) }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
            >
              <span className="font-medium">{v.plate}</span>
              <span className="shrink-0 text-xs text-gray-400">
                {v.fleetNo ? `เบอร์ ${v.fleetNo}` : ""}{v.fleet ? ` · ${v.fleet}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── เบอร์รถ combobox: ค้นหาจาก vehicle_master, เลือกแล้วเติมทะเบียนให้ ── */
function FleetNoCombobox({
  fleetNo, onChange,
}: {
  fleetNo: string
  onChange: (fleetNo: string, plate?: string) => void
}) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState(fleetNo)
  const [opts, setOpts]       = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(fleetNo) }, [fleetNo])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  // ค้นหาแบบ debounce แล้วเหลือเฉพาะที่มีเบอร์รถ
  useEffect(() => {
    if (!open) return
    const query = text.trim()
    if (!query) { setOpts([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/vehicle-daily?q=${encodeURIComponent(query)}&limit=20`)
        const data = await res.json()
        setOpts(Array.isArray(data) ? (data as Vehicle[]).filter((v) => v.fleetNo?.trim()) : [])
      } catch { setOpts([]) } finally { setLoading(false) }
    }, 200)
    return () => clearTimeout(t)
  }, [text, open])

  return (
    <div ref={boxRef} className="relative">
      <input
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); onChange(e.target.value) }}
        className={inputCls + " bg-[#F6FAF7] dark:bg-white/5"}
        placeholder="พิมพ์เพื่อค้นหา เช่น ME042"
        autoComplete="off"
      />
      {!open && text.trim() && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1B8C4B]" />}
      {open && text.trim() && (
        <div className="absolute z-[60] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg py-1">
          {loading && <p className="px-3 py-2 text-xs text-gray-400">กำลังค้นหา...</p>}
          {!loading && opts.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">ไม่พบเบอร์รถใน vehicle_daily — ใช้ค่าที่พิมพ์ได้เลย</p>
          )}
          {opts.map((v) => (
            <button
              key={v.plate}
              type="button"
              onClick={() => { onChange(v.fleetNo ?? "", v.plate); setText(v.fleetNo ?? ""); setOpen(false) }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
            >
              <span className="font-medium">{v.fleetNo}</span>
              <span className="shrink-0 text-xs text-gray-400">
                {v.plate}{v.fleet ? ` · ${v.fleet}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── ข้อความคลิกเพื่อคัดลอก (MR/PR/PO) ── */
function CopyText({ value }: { value: string }) {
  const v = (value ?? "").trim()
  if (!v) return <span className="text-gray-300 dark:text-gray-600">—</span>
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); copyValue(v) }}
      title={`คัดลอก ${v}`}
      className="group inline-flex max-w-full items-center gap-1 truncate rounded transition hover:text-[#1B8C4B] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1B8C4B]"
    >
      <span className="truncate">{v}</span>
      <Copy size={11} className="shrink-0 opacity-0 transition group-hover:opacity-60" />
    </button>
  )
}

/* ── มุมมองอ่านอย่างเดียว: การ์ดสรุปรายละเอียดงานซ่อม (กด "แก้ไขข้อมูล" เพื่อเข้าฟอร์ม) ── */
function DetailField({ label, value, wide, mono }: { label: string; value?: React.ReactNode; wide?: boolean; mono?: boolean }) {
  const empty = value === undefined || value === null || value === "" || value === 0
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-[11px] font-medium text-[#9AA8A0] dark:text-white/40">{label}</p>
      <p className={`mt-0.5 text-[13.5px] ${empty ? "text-[#C6CFC9] dark:text-white/25" : "font-medium text-[#14271C] dark:text-white"} ${mono ? "font-mono" : ""} whitespace-pre-wrap break-words`}>
        {empty ? "—" : value}
      </p>
    </div>
  )
}

function DetailSection({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <section className={`mt-4 overflow-hidden rounded-xl border first:mt-0 ${tone}`}>
      <p className="border-b border-inherit bg-black/[0.02] px-4 py-2 text-[13.5px] font-bold text-[#37473E] dark:bg-white/5 dark:text-gray-200" style={{ fontFamily: "'Mitr', sans-serif" }}>{title}</p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function DetailImages({ label, items }: { label: string; items: SkuImage[] }) {
  if (!items.length) return null
  return (
    <div className="sm:col-span-2">
      <p className="text-[11px] font-medium text-[#9AA8A0] dark:text-white/40">{label} ({items.length})</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((im) => (
          <a key={im.mediaId} href={im.webpUrl} target="_blank" rel="noopener noreferrer" title={im.filename}
            className="block h-16 w-16 overflow-hidden rounded-lg border border-[#EEF2F0] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.thumbnailUrl || im.webpUrl} alt={im.filename} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  )
}

function RepairDetailCard({ r, isParts, images, quotImages, negImages }: {
  r: Omit<RepairExternal, "_id">; isParts: boolean
  images: SkuImage[]; quotImages: SkuImage[]; negImages: SkuImage[]
}) {
  const money = (n: number) => (n ? `${fmtNum(n)} บาท` : "")
  const date = (s: string) => (s ? fmtDateShort(s) : "")
  return (
    <div>
      <DetailSection title="🚚 ข้อมูลรถ" tone="border-[#D6EFDF] dark:border-[#1B8C4B]/30">
        <DetailField label="เบอร์รถ" value={r.fleetNo} mono />
        <DetailField label="ทะเบียน" value={r.plate} mono />
        <DetailField label="ฟลีท" value={r.fleet} />
        <DetailField label="แพล้นท์" value={r.plant} />
        <DetailField label="คนขับ" value={r.driverName} />
        <DetailField label="เบอร์โทรคนขับ" value={r.driverPhone} />
        <DetailField label="สถานะปูนในโม่" value={r.cementStatus} />
        <DetailField label="สภาพรถ" value={r.drivableStatus} />
        <DetailField label="จุดที่รถเสีย" value={r.breakdownLocation} wide />
      </DetailSection>

      <DetailSection title={isParts ? "🔩 อะไหล่ลงคัน" : "🔧 งานซ่อม"} tone={isParts ? "border-[#C7D6FB] dark:border-blue-500/30" : "border-[#F8D8C2] dark:border-orange-500/30"}>
        <DetailField label="เลข MR" value={r.mrNo} mono />
        <DetailField label={isParts ? "ร้านอะไหล่" : "อู่ซ่อม"} value={r.garage} />
        <DetailField label="อาการ / รายละเอียด" value={r.symptom} wide />
        <DetailField label="วันที่รับแจ้ง" value={date(r.receivedDate)} />
        <DetailField label={isParts ? "วันที่สั่งของ" : "วันที่รถเข้าอู่"} value={date(r.garageInDate)} />
        <DetailField label="กำหนดเสร็จ" value={date(r.dueDate)} />
        <DetailField label="วันที่เสร็จจริง" value={date(r.completedDate)} />
        <DetailImages label="ไฟล์แนบ" items={images} />
      </DetailSection>

      <DetailSection title="💰 ราคา · ใบเสนอราคา" tone="border-[#BEE7F2] dark:border-cyan-500/30">
        <DetailField label="ราคาเสนอครั้งแรก" value={money(r.offerPrice)} />
        <DetailField label="ประกันที่เสนอ" value={r.offerWarranty} />
        <DetailField label="ราคาหลังต่อรอง" value={money(r.negotiatedPrice)} />
        <DetailField label="ขอบเขตต่อรอง" value={r.negotiationScope === "ระบุสินค้า/บริการ" ? `${r.negotiationScope}: ${r.negotiationItem || "—"}` : r.negotiationScope} />
        <DetailField label="ราคาซ่อมที่ตกลง" value={money(r.repairPrice)} />
        <DetailField label="รับประกัน" value={r.warranty} />
        <DetailField label="รายละเอียดใบเสนอราคา" value={r.quotationDetail} wide />
        <DetailImages label="ไฟล์ใบเสนอราคา" items={quotImages} />
        <DetailImages label="หลักฐานการต่อรอง" items={negImages} />
      </DetailSection>

      <DetailSection title="📄 สถานะ · เอกสาร" tone="border-[#E4D5FB] dark:border-violet-500/30">
        <DetailField label="สถานะปัจจุบัน" value={
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold ${statusMeta(r.status).cls}`}>
            {statusMeta(r.status).emoji} {r.status}
          </span>} />
        <DetailField label="อยู่สถานะนี้ตั้งแต่" value={date(r.statusSince)} />
        <DetailField label="เลข PR" value={r.prCode} mono />
        <DetailField label="เลข PO" value={r.poCode} mono />
        {!isParts && <DetailField label="รอใบเสนอราคา" value={r.waitingQuote ? "🔍 ใช่" : ""} />}
        <DetailField label="หมายเหตุ" value={r.note} wide />
      </DetailSection>
    </div>
  )
}

/* ── การ์ดความคิดเห็น 1 รายการ (ผู้เขียน + เวลา + ข้อความ) ── */
function CommentRow({ c, reply }: { c: Comment; reply?: boolean }) {
  const name    = c.by || c.byEmail || "ไม่ระบุ"
  const initial = name.charAt(0).toUpperCase()
  return (
    <div className="flex gap-2">
      <div className={`flex shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] font-bold text-white ${reply ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs"}`}>
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{name}</span>
          <span className="text-[10px] text-gray-400">{fmtDateTime(c.at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300">{c.text}</p>
      </div>
    </div>
  )
}

/* ── Tag input: หลายค่าเป็นชิป (เก็บเป็น string คั่นด้วย ,) เช่น รหัส PO ── */
function TagInput({
  value, onChange, placeholder, invalid, mono,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  mono?: boolean
}) {
  const tags = value.split(",").map((t) => t.trim()).filter(Boolean)
  const [text, setText] = useState("")

  function add(t: string) {
    const v = t.trim()
    setText("")
    if (!v || tags.includes(v)) return
    onChange([...tags, v].join(","))
  }
  function removeAt(i: number) {
    onChange(tags.filter((_, j) => j !== i).join(","))
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 rounded-[11px] border bg-white dark:bg-[#0f1117] px-2.5 py-2 focus-within:border-[#1B8C4B] focus-within:ring-1 focus-within:ring-[#1B8C4B] ${invalid ? "border-amber-400 ring-1 ring-amber-400" : "border-[#E2E8E4] dark:border-white/10"}`}>
      {tags.map((t, i) => (
        <span key={i} className={`inline-flex items-center gap-1 rounded-md bg-[#F0FDF4] dark:bg-[#1B8C4B]/15 px-2 py-0.5 text-xs font-medium text-[#1B8C4B] ${mono ? "font-mono" : ""}`}>
          {t}
          <button type="button" onClick={() => removeAt(i)} className="text-[#1B8C4B]/60 hover:text-[#DC2626]"><X size={12} /></button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text) }
          else if (e.key === "Backspace" && !text && tags.length) { removeAt(tags.length - 1) }
        }}
        onBlur={() => { if (text.trim()) add(text) }}
        placeholder={tags.length ? "" : placeholder}
        className="min-w-[110px] flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-0"
      />
    </div>
  )
}

/* ── combobox กรองแบบ autocomplete จาก string list (สร้างโดย/แก้ไขโดย) ── */
function FilterCombobox({
  value, options, onChange, placeholder,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const filtered = options.filter((o) => o.toLowerCase().includes(text.trim().toLowerCase()))

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={inputCls + " flex items-center justify-between text-left"}>
        <span className={"truncate " + (value ? "text-gray-900 dark:text-white" : "text-gray-400")}>{value || placeholder}</span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-[60] mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ค้นหา..."
              className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151a10] px-2.5 py-1.5 text-sm focus:border-[#1B8C4B] focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto pb-1">
            <button type="button" onClick={() => { onChange(""); setText(""); setOpen(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5">
              <X size={12} /> {placeholder.replace(/^[^\s]+\s*/, "")}: ทั้งหมด
            </button>
            {filtered.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => { onChange(o); setText(""); setOpen(false) }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
              >
                <span className="truncate">{o}</span>
                {value === o && <Check size={14} className="shrink-0 text-[#1B8C4B]" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">ไม่พบรายชื่อ</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── อู่ combobox: เลือกจาก master หรือพิมพ์ชื่อใหม่แล้วกดเพิ่ม ── */
function GarageCombobox({
  value, garages, onChange, onCreated, filterMode, placeholder,
}: {
  value: string
  garages: Garage[]
  onChange: (name: string) => void
  onCreated?: (g: Garage) => void
  filterMode?: boolean   // โหมดตัวกรอง: ไม่มีปุ่มเพิ่มอู่ใหม่
  placeholder?: string
}) {
  const [open, setOpen]     = useState(false)
  const [text, setText]     = useState("")
  const [adding, setAdding] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const filtered = garages.filter((g) => g.name.toLowerCase().includes(text.trim().toLowerCase()))
  const exactMatch = garages.some((g) => g.name.toLowerCase() === text.trim().toLowerCase())
  const canCreate = !filterMode && text.trim().length > 0 && !exactMatch

  async function createGarage() {
    const name = text.trim()
    if (!name) return
    setAdding(true)
    try {
      const res = await fetch("/api/garage-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const g = await res.json()
      if (g?._id) onCreated?.(g)
      onChange(g?.name ?? name)
      setText("")
      setOpen(false)
    } catch {
      swalError("เพิ่มอู่ไม่สำเร็จ")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={inputCls + " flex items-center justify-between text-left"}
      >
        <span className={"truncate " + (value ? "text-gray-900 dark:text-white" : "text-gray-400")}>{value || placeholder || "เลือกอู่..."}</span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-[60] mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg">
          <div className="p-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); createGarage() } }}
              placeholder={filterMode ? "ค้นหาอู่..." : "ค้นหา หรือพิมพ์ชื่ออู่ใหม่..."}
              className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151a10] px-2.5 py-1.5 text-sm focus:border-[#1B8C4B] focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto pb-1">
            {(value || filterMode) && (
              <button type="button" onClick={() => { onChange(""); setText(""); setOpen(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5">
                <X size={12} /> {filterMode ? "ทุกอู่" : "ล้างค่า"}
              </button>
            )}
            {filtered.map((g) => (
              <button
                key={g._id}
                type="button"
                onClick={() => { onChange(g.name); setText(""); setOpen(false) }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
              >
                {g.name}
                {value === g.name && <Check size={14} className="text-[#1B8C4B]" />}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={createGarage}
                disabled={adding}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5 disabled:opacity-60"
              >
                <Plus size={14} /> เพิ่มอู่ “{text.trim()}”
              </button>
            )}
            {!canCreate && filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">ไม่พบอู่</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
