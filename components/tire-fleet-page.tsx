"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { useSession } from "next-auth/react"
import {
  Truck, Search, ArrowLeft, RefreshCw, History, ClipboardCheck,
  Check, X, Camera, ChevronDown, ChevronUp, Flag, CalendarClock, Gauge,
  List, CalendarDays, ChevronLeft, ChevronRight,
} from "lucide-react"
import Swal from "sweetalert2"
import { swalConfirm, swalToast, swalError } from "@/lib/swal"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Calendar } from "@/components/ui/calendar"

// ===========================================================================
// SECTION 1: Types
// ===========================================================================

type FleetVehicle = {
  branch:         string
  plate:          string
  unit:           "head" | "trailer"
  vehicleType:    string
  fleet:          string
  plant:          string
  tireCount:      number
  danger:         number
  warn:           number
  normal:         number
  unknown:        number
  oldestAgeText:  string | null
  activeRequests: number
}

type ReqRef = {
  requestId:       string
  itemId:          string
  itemStatus:      string
  requestStatus:   string
  appointmentDate: string | null
  reason:          string
  driverName:      string
  jobNo:           string
}

type TireRow = {
  _id:            string
  tirePosition:   string
  positionCode:   string
  positionName:   string
  product:        string
  serialNo:       string
  treadMm:        number
  mileageStart:   number
  mileageEnd:     number
  maintenanceRequest: string
  changeIn:       string | null
  changeOut:      string | null
  isLatest:       boolean
  unitPrice:      number | null
  stockDistance:  number | null
  usedDistance:   number | null
  remainingPct:   number | null
  remainingLevel: "green" | "amber" | "red" | null
  bahtPerKm:      number | null
  age:            { text: string; level: "normal" | "warn" | "danger" } | null
  request:        ReqRef | null
}

type VehicleDetailData = {
  vehicle: { plate: string; vehicleType?: string; brand?: string; model?: string; fleet?: string; fleetNo?: string; plant?: string } | null
  plate:   string
  branch:  string
  odometer: number
  odometerSource: "input" | "request" | "history" | "none"
  current: TireRow[]
  history: TireRow[]
}

type RequestItem = {
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
}

type TireRequest = {
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
}

type MrInfo = { mrId: string; status: string; note: string; updatedAt: string } | null

// ===========================================================================
// SECTION 2: Constants + helpers
// ===========================================================================

const BRANCHES = [
  { value: "latkrabang", label: "ลาดกระบัง" },
  { value: "saraburi",   label: "สระบุรี" },
]

const branchLabel = (b: string) => BRANCHES.find((x) => x.value === b)?.label ?? b

// Sync ดึงรวมสาขาย่อยจาก ATMS: ลาดกระบัง+ขอนแก่น / สระบุรี+DIST
const SYNC_SCOPE: Record<string, string> = { latkrabang: "+ขอนแก่น", saraburi: "+DIST" }

const REASON_OPTIONS = ["หมดดอก", "ยางระเบิด", "ยางฉีก", "ยางบวม", "รถกินยาง", "เช็คสภาพยาง"]

// โครงเพลามาตรฐาน — แสดงเฉพาะแถวที่มียางจริงในข้อมูล
const AXLE_ROWS: { label: string; positions: string[][] }[] = [
  { label: "หน้า 1", positions: [["F1"], ["F2"]] },
  { label: "หน้า 2", positions: [["F3"], ["F4"]] },
  { label: "หลัง 1", positions: [["RA1", "RA2"], ["RA3", "RA4"]] },
  { label: "หลัง 2", positions: [["RA5", "RA6"], ["RA7", "RA8"]] },
  { label: "หาง 1",  positions: [["RB1", "RB2"], ["RB3", "RB4"]] },
  { label: "หาง 2",  positions: [["RB5", "RB6"], ["RB7", "RB8"]] },
  { label: "หาง 3",  positions: [["RB9", "RB10"], ["RB11", "RB12"]] },
]
const SPARE_POSITIONS = ["RB13"]

// รหัส RB หรือชื่อตำแหน่งมีคำว่า "หาง" = ยางหางพ่วง ที่เหลือ = ยางหัวรถ
const isTrailerTire = (t: TireRow) =>
  t.positionCode.toUpperCase().startsWith("RB") ||
  (t.positionName + " " + t.tirePosition).includes("หาง")

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

// นัดหมาย ไม่มีการเลือกเวลา — แสดงเฉพาะวันที่
const fmtDateOnly = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const fmtNum = (n?: number | null) => (n ?? 0).toLocaleString("th-TH")

// สีล้อ: คำขอค้าง → ฟ้า / ประสิทธิภาพคงเหลือ → เขียว-เหลือง-แดง / ไม่มีข้อมูล → อายุยางแทน
function wheelGradient(t: TireRow | undefined): string {
  if (!t) return "from-gray-400/60 to-transparent"
  if (t.request) return "from-blue-500/90 to-transparent"
  if (t.remainingLevel === "red")   return "from-red-500/95 to-transparent"
  if (t.remainingLevel === "amber") return "from-amber-500/90 to-transparent"
  if (t.remainingLevel === "green") return "from-green-500/90 to-transparent"
  if (t.age?.level === "danger") return "from-red-500/95 to-transparent"
  if (t.age?.level === "warn")   return "from-amber-500/90 to-transparent"
  if (t.age?.level === "normal") return "from-green-500/90 to-transparent"
  return "from-gray-500/70 to-transparent"
}

function statusChip(status: string) {
  switch (status) {
    case "approved":    return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    case "appointment": return "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
    case "done":        return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    case "rejected":    return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
    default:            return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว", appointment: "นัดหมายแล้ว", done: "เสร็จสิ้น", rejected: "ปฏิเสธ",
}

const remainingChipCls = {
  red:   "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  amber: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  green: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
}

const branchChipCls = (b: string) =>
  b === "saraburi"
    ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
    : "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"

// resize photo to max 1280px JPEG before upload
function resizeImage(file: File, maxSize = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width  = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านรูปไม่สำเร็จ")) }
    img.src = url
  })
}

// fetch ทั้ง 2 สาขาแล้ว merge (หรือสาขาเดียวตาม filter)
function branchesFor(filter: string): string[] {
  return filter ? [filter] : BRANCHES.map((b) => b.value)
}

// shared styles (WMS design tokens)
const card = "rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]"
const inp  = "rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30 placeholder-[#9AA8A0]"
const thCls = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#9AA8A0] whitespace-nowrap"
const tdCls = "px-3 py-2 text-[12px] text-[#6B7C72] dark:text-gray-300 whitespace-nowrap"
// แถวหัวตาราง — ทึบสี (ไม่โปร่งแสง) เพื่อให้บังแถวข้อมูลที่เลื่อนลอดใต้ header ตอน sticky
const theadCls       = "sticky top-0 z-10 border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#151a10]"
const theadStaticCls = "border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#151a10]"
// const scrollBoxCls   = "max-h-[65vh] overflow-auto"
const btnPrimary = "rounded-[11px] bg-[#1B8C4B] text-white px-3.5 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
const btnSmall = "rounded-[10px] px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
const fontThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const fontHead = { fontFamily: "'Mitr', sans-serif", fontWeight: 500 }

// ===========================================================================
// SECTION 3: Main page — tab switcher
// ===========================================================================

export function TireFleetPage() {
  const [tab, setTab] = useState<"fleet" | "requests" | "history">("fleet")
  const [branchFilter, setBranchFilter] = useState("")
  const [selected, setSelected] = useState<{ branch: string; plate: string } | null>(null)
  const [pendingBadge, setPendingBadge] = useState(0)

  // badge จำนวนคำขอรออนุมัติรวม 2 สาขา
  const loadBadge = useCallback(async () => {
    const totals = await Promise.all(
      BRANCHES.map((b) =>
        fetch(`/api/tire-change-request?branch=${b.value}&status=pending&limit=1`)
          .then((r) => r.json()).then((d) => d.total ?? 0).catch(() => 0)
      )
    )
    setPendingBadge(totals.reduce((a, b) => a + b, 0))
  }, [])
  useEffect(() => { loadBadge() }, [loadBadge])

  const TABS = [
    { value: "fleet"    as const, label: "รถทุกคัน",          icon: Truck },
    { value: "requests" as const, label: "คำขอ / อนุมัติ",    icon: ClipboardCheck, badge: pendingBadge },
    { value: "history"  as const, label: "ประวัติการเปลี่ยน", icon: History },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <Truck size={20} className="text-[#1B8C4B]" />
        <h1 className="text-[22px] text-[#14271C] dark:text-white" style={fontHead}>ศูนย์จัดการยางรถ</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5" style={fontThai}>
        รวมทุกคัน ทั้งลาดกระบังและสระบุรี — คลิกที่รถเพื่อดูสภาพยางรายล้อ ขอเปลี่ยน และอนุมัติในหน้าเดียว
      </p>

      {/* Tabs + branch filter */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-[13px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.value
            return (
              <button
                key={t.value}
                onClick={() => { setTab(t.value); setSelected(null) }}
                className={[
                  "flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "bg-[#1B8C4B] text-white" : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
                ].join(" ")}
                style={fontThai}
              >
                <Icon size={13} />
                {t.label}
                {!!t.badge && (
                  <span className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${active ? "bg-white text-[#1B8C4B]" : "bg-[#E8A317] text-white"}`}>
                    {t.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex rounded-[13px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-1 ml-auto">
          {[{ value: "", label: "ทุกสาขา" }, ...BRANCHES].map((b) => (
            <button
              key={b.value}
              onClick={() => { setBranchFilter(b.value); setSelected(null) }}
              className={[
                "rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                branchFilter === b.value ? "bg-[#14271C] dark:bg-white text-white dark:text-gray-900" : "text-[#6B7C72] dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "fleet" && (
        selected
          ? <VehicleDetail branch={selected.branch} plate={selected.plate} onBack={() => setSelected(null)} onChanged={loadBadge} />
          : <FleetGrid branchFilter={branchFilter} onSelect={(v) => setSelected(v)} />
      )}
      {tab === "requests" && <RequestsTab branchFilter={branchFilter} onChanged={loadBadge} />}
      {tab === "history"  && <HistoryTab branchFilter={branchFilter} />}
    </div>
  )
}

// ===========================================================================
// SECTION 4: Fleet grid — รถ unique ทุกคัน
// ===========================================================================

function FleetGrid({ branchFilter, onSelect }: {
  branchFilter: string
  onSelect: (v: { branch: string; plate: string }) => void
}) {
  const [items, setItems]   = useState<FleetVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  // กรองทะเบียน: หัว (รถ) / หาง (พ่วง) — default หัว
  const [unitFilter, setUnitFilter] = useState<"head" | "trailer" | "all">("head")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = new URLSearchParams()
    if (branchFilter) qs.set("branch", branchFilter)
    if (q) qs.set("q", q)
    fetch(`/api/tire-fleet?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setItems(Array.isArray(d.items) ? d.items : []) })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branchFilter, q])

  const headCount    = useMemo(() => items.filter((v) => v.unit === "head").length, [items])
  const trailerCount = items.length - headCount
  const shown = useMemo(
    () => (unitFilter === "all" ? items : items.filter((v) => v.unit === unitFilter)),
    [items, unitFilter],
  )

  const summary = useMemo(() => ({
    total:    shown.length,
    danger:   shown.filter((v) => v.danger > 0).length,
    requests: shown.reduce((a, v) => a + v.activeRequests, 0),
  }), [shown])

  return (
    <div>
      {/* Summary + unit filter + search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-4 text-[13px]" style={fontThai}>
          <span className="text-[#6B7C72] dark:text-gray-400">รถทั้งหมด <b className="text-[#14271C] dark:text-white">{fmtNum(summary.total)}</b> คัน</span>
          <span className="text-red-600 dark:text-red-400">มียางอันตราย <b>{fmtNum(summary.danger)}</b> คัน</span>
          <span className="text-blue-600 dark:text-blue-400">คำขอค้าง <b>{fmtNum(summary.requests)}</b> รายการ</span>
        </div>

        {/* กรองทะเบียน หัว / หาง */}
        <div className="ml-auto flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "head",    label: `หัว (${headCount})` },
            { key: "trailer", label: `หาง (${trailerCount})` },
            { key: "all",     label: `ทั้งหมด (${items.length})` },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setUnitFilter(opt.key)}
              className={[
                "rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                unitFilter === opt.key
                  ? "bg-[#1B8C4B] text-white"
                  : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียนรถ..." className={inp + " w-full pl-8"} />
        </div>
      </div>

      {loading ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"}>กำลังโหลดข้อมูลรถ...</div>
      ) : items.length === 0 ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"}>
          ไม่พบรถ — ตรวจสอบการ Sync ที่แท็บ &quot;ประวัติการเปลี่ยน&quot;
        </div>
      ) : shown.length === 0 ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"} style={fontThai}>
          ไม่มีทะเบียน{unitFilter === "trailer" ? "หาง" : "หัว"}ตามเงื่อนไขนี้ — ลองสลับตัวกรอง หัว/หาง ด้านบน
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {shown.map((v) => {
            const known = v.danger + v.warn + v.normal
            return (
              <button
                key={`${v.branch}|${v.plate}`}
                onClick={() => onSelect({ branch: v.branch, plate: v.plate })}
                className={card + " p-4 text-left transition-all hover:border-[#1B8C4B]/40 hover:shadow-[0_4px_14px_-6px_rgba(27,140,75,.35)] active:scale-[0.99]"}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-[15px] font-bold text-[#14271C] dark:text-white truncate">{v.plate}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${v.unit === "trailer" ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300"}`} style={fontThai}>
                      {v.unit === "trailer" ? "หาง" : "หัว"}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${branchChipCls(v.branch)}`} style={fontThai}>
                      {branchLabel(v.branch)}
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-[#9AA8A0] truncate mb-3" style={fontThai}>
                  {v.vehicleType || "ไม่ระบุประเภท"}{v.fleet ? ` · ${v.fleet}` : ""}
                </p>

                {/* health bar — สัดส่วนอายุยาง ปกติ/เฝ้าระวัง/อันตราย */}
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10 mb-2">
                  {known > 0 && (
                    <>
                      <div className="bg-green-500" style={{ width: `${(v.normal / v.tireCount) * 100}%` }} />
                      <div className="bg-amber-500" style={{ width: `${(v.warn / v.tireCount) * 100}%` }} />
                      <div className="bg-red-500"   style={{ width: `${(v.danger / v.tireCount) * 100}%` }} />
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px]" style={fontThai}>
                  <span className="text-[#6B7C72] dark:text-gray-400">
                    ยาง {v.tireCount} เส้น{v.oldestAgeText ? ` · เก่าสุด ${v.oldestAgeText}` : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {v.danger > 0 && <span className="font-bold text-red-600 dark:text-red-400">⚠ {v.danger}</span>}
                    {v.activeRequests > 0 && (
                      <span className="rounded-md bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                        คำขอ {v.activeRequests}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// SECTION 5: Wheel schematic — รูปล้อแบบ mena-go-srb
// ===========================================================================

function WheelButton({ tire, pos, selected, onClick }: {
  tire?: TireRow
  pos: string
  selected: boolean
  onClick: () => void
}) {
  const pct = tire?.remainingPct
  const sub = tire?.request
    ? STATUS_LABEL[tire.request.requestStatus] ?? "มีคำขอ"
    : pct !== null && pct !== undefined ? `${pct}%` : tire?.age?.text ?? "—"
  return (
    <button
      type="button"
      onClick={onClick}
      title={tire ? `${pos} ${tire.positionName}` : pos}
      className={[
        "relative flex flex-col items-center justify-center gap-px overflow-hidden rounded-xl bg-gray-800 text-white shadow transition-transform duration-100 active:scale-90",
        selected ? "ring-2 ring-[#1B8C4B] ring-offset-2 dark:ring-offset-[#151a10]" : "",
      ].join(" ")}
      style={{
        width: 46, height: 84,
        backgroundImage: "url(/images/tire-wheel.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <span className={`absolute inset-0 rounded-xl bg-gradient-to-b ${wheelGradient(tire)}`} />
      <span className="relative text-[12px] font-black leading-none tracking-tight drop-shadow-md">{pos}</span>
      <span className="relative my-0.5 h-px w-4/5 rounded-full bg-white/40" />
      <span className="relative px-0.5 text-center text-[9px] font-extrabold leading-none drop-shadow-md" style={fontThai}>
        {sub}
      </span>
    </button>
  )
}

function TireSchematic({ tireMap, selectedPos, onSelect }: {
  tireMap: Record<string, TireRow>
  selectedPos: string | null
  onSelect: (pos: string) => void
}) {
  const has = (pos: string) => !!tireMap[pos]
  const rows = AXLE_ROWS.filter((r) => r.positions.flat().some(has))
  const hasFront = has("F1") || has("F2") || has("F3") || has("F4")
  const spares = SPARE_POSITIONS.filter(has)

  if (rows.length === 0 && spares.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400" style={fontThai}>ไม่มีข้อมูลยางปัจจุบัน</p>
  }

  return (
    <div className="mx-auto flex w-full max-w-[300px] flex-col items-center">
      {hasFront && (
        <div className="mb-1 flex h-9 w-20 items-center justify-center rounded-t-2xl border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5">
          <span className="text-[9px] font-medium text-gray-400" style={fontThai}>หัวรถ</span>
        </div>
      )}
      <div className="flex w-full flex-col items-center gap-4 py-3">
        {rows.map((row) => {
          const [left, right] = row.positions
          const leftPresent  = left.filter(has)
          const rightPresent = right.filter(has)
          return (
            <div key={row.label} className="flex w-full flex-col items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400" style={fontThai}>{row.label}</span>
              <div className="flex w-full items-center">
                <div className="flex gap-1.5">
                  {leftPresent.map((pos) => (
                    <WheelButton key={pos} pos={pos} tire={tireMap[pos]} selected={selectedPos === pos} onClick={() => onSelect(pos)} />
                  ))}
                </div>
                <div className="mx-2 h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-white/10" />
                <div className="flex gap-1.5">
                  {rightPresent.map((pos) => (
                    <WheelButton key={pos} pos={pos} tire={tireMap[pos]} selected={selectedPos === pos} onClick={() => onSelect(pos)} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
        {spares.length > 0 && (
          <div className="flex flex-col items-center gap-1.5 pt-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400" style={fontThai}>ยางอะไหล่</span>
            <div className="flex gap-1.5">
              {spares.map((pos) => (
                <WheelButton key={pos} pos={pos} tire={tireMap[pos]} selected={selectedPos === pos} onClick={() => onSelect(pos)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1 text-[10px] text-gray-400" style={fontThai}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> ปกติ</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> เฝ้าระวัง</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> ควรเปลี่ยน</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> มีคำขอ</span>
      </div>
    </div>
  )
}

// ===========================================================================
// SECTION 6: Vehicle detail — schematic + tire panel + history
// ===========================================================================

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]" style={fontThai}>
      <span className="shrink-0 text-[#9AA8A0]">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function VehicleDetail({ branch, plate, onBack, onChanged }: {
  branch: string
  plate: string
  onBack: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<VehicleDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPos, setSelectedPos] = useState<string | null>(null)
  const [odoDraft, setOdoDraft] = useState("")
  const [odoOverride, setOdoOverride] = useState(0)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [acting, setActing] = useState(false)
  // กรองตำแหน่งยาง: หัว (รถ) / หาง (พ่วง) — null = อัตโนมัติ (หัวถ้ามี ไม่งั้นหาง)
  const [unitChoice, setUnitChoice] = useState<"head" | "trailer" | "all" | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ branch, plate })
    if (odoOverride > 0) qs.set("odometer", String(odoOverride))
    const d = await fetch(`/api/tire-fleet/vehicle?${qs}`).then((r) => r.json()).catch(() => null)
    setData(d && !d.error ? d : null)
    setLoading(false)
  }, [branch, plate, odoOverride])

  useEffect(() => { load() }, [load])
  useEffect(() => { setOdoDraft(data?.odometer ? String(data.odometer) : "") }, [data?.odometer])

  const headCount    = (data?.current ?? []).filter((t) => !isTrailerTire(t)).length
  const trailerCount = (data?.current ?? []).length - headCount
  // ยังไม่ได้เลือกเอง → หัวถ้ามียางหัว ไม่งั้นสลับเป็นหางให้ (เช่น ทะเบียนหางพ่วง)
  const unitFilter = unitChoice ?? (headCount === 0 && trailerCount > 0 ? "trailer" : "head")

  const matchesUnit = (t: TireRow) =>
    unitFilter === "all" ? true : unitFilter === "trailer" ? isTrailerTire(t) : !isTrailerTire(t)
  const shownCurrent = (data?.current ?? []).filter(matchesUnit)
  const shownHistory = (data?.history ?? []).filter(matchesUnit)

  const tireMap: Record<string, TireRow> = {}
  for (const t of shownCurrent) if (t.positionCode) tireMap[t.positionCode] = t

  const selectedTire = selectedPos ? tireMap[selectedPos] : null

  async function handleApprove(t: TireRow) {
    if (!t.request) return
    // gate: รถกินยาง ต้องปิด MR ก่อน
    if (t.request.reason === "รถกินยาง") {
      const mr = await fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(branch)}&plates=${encodeURIComponent(plate)}`)
        .then((r) => r.json()).then((d) => d[plate] ?? null).catch(() => null)
      if (!mr || mr.status !== "completed") {
        await Swal.fire({
          icon: "warning",
          title: "รอ MR ซ่อมเสร็จก่อน",
          html: `ยางเส้นนี้สาเหตุ <b>รถกินยาง</b><br>ต้องปิด MR ก่อนจึงจะอนุมัติได้ — จัดการ MR ได้ที่แท็บ "คำขอ / อนุมัติ"`,
          confirmButtonText: "รับทราบ",
        })
        return
      }
    }
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "อนุมัติยางเส้นนี้?",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${t.positionCode} ${t.positionName} · ${t.serialNo}</div>`,
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
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${t.request.requestId}/items/${t.request.itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", jobNo: String(jobNo).trim() }),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "อนุมัติไม่สำเร็จ"); return }
    swalToast("success", `อนุมัติ ${t.positionCode} แล้ว`)
    load(); onChanged()
  }

  async function handleReject(t: TireRow) {
    if (!t.request) return
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "ปฏิเสธยางเส้นนี้?",
      html: `<code style="font-size:0.8rem;opacity:0.65">${t.positionCode} ${t.positionName} · ${t.serialNo}</code>`,
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
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${t.request.requestId}/items/${t.request.itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reason: value ?? "" }),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "ปฏิเสธไม่สำเร็จ"); return }
    swalToast("success", `ปฏิเสธ ${t.positionCode} แล้ว`)
    load(); onChanged()
  }

  async function handleEditJob(t: TireRow) {
    if (!t.request) return
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "แก้ไขเลข Job",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${t.positionCode} ${t.positionName} · ${t.serialNo}</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputValue: t.request.jobNo ?? "",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "บันทึก",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${t.request.requestId}/items/${t.request.itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "editJob", jobNo: String(jobNo).trim() }),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "อัปเดตไม่สำเร็จ"); return }
    swalToast("success", `อัปเดตเลข Job ${t.positionCode} แล้ว`)
    load(); onChanged()
  }

  const v = data?.vehicle

  return (
    <div>
      {/* Back + vehicle header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-[11px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 text-[13px] text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5 transition-colors" style={fontThai}>
          <ArrowLeft size={13} /> รถทุกคัน
        </button>
        <span className="font-mono text-[18px] font-bold text-[#14271C] dark:text-white">{plate}</span>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${branchChipCls(branch)}`} style={fontThai}>{branchLabel(branch)}</span>
        {v?.vehicleType && <span className="rounded-md bg-gray-100 dark:bg-white/10 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300" style={fontThai}>{v.vehicleType}</span>}
        {(v?.brand || v?.model) && (
          <span className="text-[12px] text-[#9AA8A0]" style={fontThai}>{v?.brand}{v?.model ? ` · ${v.model}` : ""}</span>
        )}

        {/* กรอง หัว / หาง */}
        <div className="flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "head",    label: `หัว (${headCount})` },
            { key: "trailer", label: `หาง (${trailerCount})` },
            { key: "all",     label: "ทั้งหมด" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => { setUnitChoice(opt.key); setSelectedPos(null) }}
              className={[
                "rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                unitFilter === opt.key
                  ? "bg-[#1B8C4B] text-white"
                  : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* odometer อ้างอิง */}
        <div className="ml-auto flex items-center gap-1.5" style={fontThai}>
          <Gauge size={13} className="text-gray-400" />
          <span className="text-[11px] text-[#9AA8A0]">ไมล์อ้างอิง</span>
          <input
            value={odoDraft}
            onChange={(e) => setOdoDraft(e.target.value.replace(/[^\d,]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") setOdoOverride(Number(odoDraft.replace(/,/g, "")) || 0) }}
            onBlur={() => { const n = Number(odoDraft.replace(/,/g, "")) || 0; if (n !== data?.odometer) setOdoOverride(n) }}
            className={inp + " w-28 text-right font-mono"}
            inputMode="numeric"
          />
          <span className="text-[11px] text-[#9AA8A0]">
            กม.{data?.odometerSource === "request" ? " (จากคำขอล่าสุด)" : data?.odometerSource === "history" ? " (ประมาณจากประวัติ)" : ""}
          </span>
        </div>
      </div>

      {loading ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"}>กำลังโหลดข้อมูลยาง...</div>
      ) : !data ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"}>โหลดข้อมูลไม่สำเร็จ</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          {/* Schematic */}
          <div className={card + " p-5"}>
            <p className="mb-2 text-center text-[12px] font-semibold text-[#6B7C72] dark:text-gray-400" style={fontThai}>
              แตะที่ล้อเพื่อดูรายละเอียด — ตัวเลขคือประสิทธิภาพคงเหลือ
            </p>
            <TireSchematic tireMap={tireMap} selectedPos={selectedPos} onSelect={setSelectedPos} />
          </div>

          {/* Right: tire detail panel */}
          <div className="flex flex-col gap-4">
            {selectedTire ? (
              <div className={card + " p-5"}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-[16px] text-[#14271C] dark:text-white" style={fontHead}>
                      {selectedTire.positionCode} — {selectedTire.positionName}
                    </h3>
                    <p className="mt-0.5 font-mono text-[11px] text-[#9AA8A0]">{selectedTire.serialNo || "ไม่มีซีเรียล"}</p>
                  </div>
                  {selectedTire.remainingPct !== null && selectedTire.remainingLevel && (
                    <span className={`rounded-lg px-2.5 py-1 text-[13px] font-bold ${remainingChipCls[selectedTire.remainingLevel]}`}>
                      {selectedTire.remainingPct}%
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 rounded-[12px] bg-[#F6FAF7] dark:bg-white/4 p-3.5">
                  <InfoRow label="รุ่นยาง"><span className="text-[#14271C] dark:text-white">{selectedTire.product || "—"}</span></InfoRow>
                  <InfoRow label="เปลี่ยนเข้า"><span className="text-[#14271C] dark:text-white">{fmtDate(selectedTire.changeIn)}</span></InfoRow>
                  <InfoRow label="อายุยาง">
                    <span className={
                      selectedTire.age?.level === "danger" ? "font-semibold text-red-600 dark:text-red-400"
                      : selectedTire.age?.level === "warn" ? "font-semibold text-amber-600 dark:text-amber-400"
                      : "text-[#14271C] dark:text-white"
                    }>{selectedTire.age?.text ?? "—"}</span>
                  </InfoRow>
                  <InfoRow label="ไมล์เริ่มต้น"><span className="font-mono text-[#14271C] dark:text-white">{fmtNum(selectedTire.mileageStart)}</span></InfoRow>
                  <InfoRow label="ระยะทางใช้งาน">
                    <span className="font-mono font-semibold text-[#14271C] dark:text-white">
                      {selectedTire.usedDistance !== null ? `${fmtNum(selectedTire.usedDistance)} กม.` : "—"}
                    </span>
                  </InfoRow>
                  <InfoRow label="ระยะทางมาตรฐาน">
                    <span className="font-mono text-[#14271C] dark:text-white">
                      {selectedTire.stockDistance !== null ? `${fmtNum(selectedTire.stockDistance)} กม.` : "—"}
                    </span>
                  </InfoRow>
                  <InfoRow label="บาทต่อกิโล">
                    <span className="font-mono text-[#14271C] dark:text-white">
                      {selectedTire.bahtPerKm !== null ? selectedTire.bahtPerKm.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}
                    </span>
                  </InfoRow>
                  <InfoRow label="ดอกยาง (ตอนใส่)"><span className="text-[#14271C] dark:text-white">{selectedTire.treadMm > 0 ? `${selectedTire.treadMm} มม.` : "—"}</span></InfoRow>
                </div>

                {/* action zone */}
                <div className="mt-4">
                  {selectedTire.request ? (
                    <div className="rounded-[12px] border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div style={fontThai}>
                          <p className="text-[13px] font-bold text-blue-700 dark:text-blue-300">
                            มีคำขอ — {STATUS_LABEL[selectedTire.request.requestStatus] ?? selectedTire.request.requestStatus}
                          </p>
                          <p className="mt-0.5 text-[11px] text-blue-600/80 dark:text-blue-300/70">
                            สาเหตุ: {selectedTire.request.reason || "—"}
                            {selectedTire.request.driverName ? ` · คนขับ: ${selectedTire.request.driverName}` : ""}
                            {selectedTire.request.appointmentDate ? ` · นัด ${fmtDateOnly(selectedTire.request.appointmentDate)}` : ""}
                          </p>
                          {selectedTire.request.itemStatus === "approved" && (
                            <button type="button" disabled={acting} onClick={() => handleEditJob(selectedTire)}
                              className="mt-1 text-[11px] text-blue-700 underline decoration-dotted hover:opacity-80 dark:text-blue-300">
                              {selectedTire.request.jobNo
                                ? <>Job: <span className="font-mono font-semibold">{selectedTire.request.jobNo}</span></>
                                : "+ ระบุเลข Job"}
                            </button>
                          )}
                        </div>
                        {selectedTire.request.itemStatus === "pending" && (
                          <div className="flex shrink-0 gap-1.5">
                            <button disabled={acting} onClick={() => handleApprove(selectedTire)}
                              className={btnSmall + " inline-flex items-center gap-1 bg-green-600 text-white"} style={fontThai}>
                              <Check size={11} /> อนุมัติ
                            </button>
                            <button disabled={acting} onClick={() => handleReject(selectedTire)}
                              className={btnSmall + " inline-flex items-center gap-1 bg-red-600 text-white"} style={fontThai}>
                              <X size={11} /> ปฏิเสธ
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowRequestModal(true)} className={btnPrimary + " w-full"} style={fontThai}>
                      ขอเปลี่ยนยางเส้นนี้
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={card + " flex flex-1 items-center justify-center px-4 py-16 text-center"}>
                <p className="text-sm text-gray-400" style={fontThai}>
                  เลือกล้อจากรูปด้านซ้าย<br />เพื่อดูรายละเอียดและขอเปลี่ยนยาง
                </p>
              </div>
            )}

            {/* ยางปัจจุบันแบบตารางย่อ */}
            <div className={card + " overflow-hidden"}>
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={theadCls}>
                      <th className={thCls}>ล้อ</th>
                      <th className={thCls}>Serial</th>
                      <th className={thCls + " text-right"}>ใช้งาน (กม.)</th>
                      <th className={thCls + " text-right"}>คงเหลือ</th>
                      <th className={thCls}>อายุ</th>
                      <th className={thCls}>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownCurrent.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400" style={fontThai}>
                          ไม่มียาง{unitFilter === "trailer" ? "หาง" : "หัว"}สำหรับคันนี้ — ลองสลับตัวกรองด้านบน
                        </td>
                      </tr>
                    )}
                    {shownCurrent.map((t, i) => (
                      <tr
                        key={t._id}
                        onClick={() => setSelectedPos(t.positionCode || null)}
                        className={[
                          "cursor-pointer border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-[#F0FDF4] dark:hover:bg-white/4",
                          selectedPos === t.positionCode ? "bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : "",
                        ].join(" ")}
                      >
                        <td className={tdCls + " font-mono font-bold text-[#14271C] dark:text-white"}>{t.positionCode || "—"}</td>
                        <td className={tdCls + " font-mono"}>{t.serialNo || "—"}</td>
                        <td className={tdCls + " text-right font-mono"}>{t.usedDistance !== null ? fmtNum(t.usedDistance) : "—"}</td>
                        <td className={tdCls + " text-right"}>
                          {t.remainingPct !== null && t.remainingLevel
                            ? <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${remainingChipCls[t.remainingLevel]}`}>{t.remainingPct}%</span>
                            : "—"}
                        </td>
                        <td className={tdCls}>
                          <span className={
                            t.age?.level === "danger" ? "font-semibold text-red-600 dark:text-red-400"
                            : t.age?.level === "warn" ? "font-semibold text-amber-600 dark:text-amber-400" : ""
                          }>{t.age?.text ?? "—"}</span>
                        </td>
                        <td className={tdCls}>
                          {t.request
                            ? <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(t.request.requestStatus)}`} style={fontThai}>{STATUS_LABEL[t.request.requestStatus] ?? t.request.requestStatus}</span>
                            : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ประวัติการเปลี่ยนของคันนี้ */}
      {!loading && data && (
        <div className={card + " mt-4 overflow-hidden"}>
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[#F6FAF7] dark:hover:bg-white/3 transition-colors"
          >
            <History size={14} className="text-gray-400" />
            <span className="text-[13px] font-semibold text-[#14271C] dark:text-white" style={fontThai}>
              ประวัติการเปลี่ยนยางของคันนี้
            </span>
            <span className="text-[12px] text-gray-400">({shownHistory.length} รายการ)</span>
            {showHistory ? <ChevronUp size={13} className="ml-auto text-gray-400" /> : <ChevronDown size={13} className="ml-auto text-gray-400" />}
          </button>
          {showHistory && (
            <div className={" border-t border-[#EEF2F0] dark:border-white/8"}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadCls}>
                    <th className={thCls}>ล้อ</th>
                    <th className={thCls}>สินค้า</th>
                    <th className={thCls}>Serial</th>
                    <th className={thCls + " text-right"}>ไมล์เริ่มต้น</th>
                    <th className={thCls + " text-right"}>ไมล์สิ้นสุด</th>
                    <th className={thCls}>เปลี่ยนเข้า</th>
                    <th className={thCls}>เปลี่ยนออก</th>
                    <th className={thCls}>ปัจจุบัน</th>
                  </tr>
                </thead>
                <tbody>
                  {shownHistory.map((t, i) => (
                    <tr key={t._id} className={`border-b border-gray-100 dark:border-white/5 last:border-0 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                      <td className={tdCls + " font-mono font-bold text-[#14271C] dark:text-white"}>{t.positionCode || t.tirePosition || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.product || "—"}</td>
                      <td className={tdCls + " font-mono"}>{t.serialNo || "—"}</td>
                      <td className={tdCls + " text-right font-mono"}>{fmtNum(t.mileageStart)}</td>
                      <td className={tdCls + " text-right font-mono"}>{t.mileageEnd > 0 ? fmtNum(t.mileageEnd) : "—"}</td>
                      <td className={tdCls}>{fmtDate(t.changeIn)}</td>
                      <td className={tdCls}>{fmtDate(t.changeOut)}</td>
                      <td className={tdCls}>
                        {t.isLatest && (
                          <span className="inline-block rounded-md bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-300" style={fontThai}>
                            ใช้อยู่
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* modal ขอเปลี่ยนยาง */}
      {showRequestModal && selectedTire && data && (
        <RequestModal
          branch={branch}
          plate={plate}
          tire={selectedTire}
          odometer={data.odometer}
          vehicle={data.vehicle}
          onClose={() => setShowRequestModal(false)}
          onSaved={() => { setShowRequestModal(false); load(); onChanged() }}
        />
      )}
    </div>
  )
}

// ===========================================================================
// SECTION 7: Request modal — ขอเปลี่ยนยางเส้นเดียวจบ
// ===========================================================================

function RequestModal({ branch, plate, tire, odometer, vehicle, onClose, onSaved }: {
  branch: string
  plate: string
  tire: TireRow
  odometer: number
  vehicle: VehicleDetailData["vehicle"]
  onClose: () => void
  onSaved: () => void
}) {
  const [driverName, setDriverName]   = useState("")
  const [truckNumber, setTruckNumber] = useState(vehicle?.fleetNo ?? "")
  const [odo, setOdo]                 = useState(odometer > 0 ? String(odometer) : "")
  const [reason, setReason]           = useState("")
  const [treadMm, setTreadMm]         = useState("")
  const [note, setNote]               = useState("")
  const [photos, setPhotos]           = useState<string[]>([])
  const [saving, setSaving]           = useState(false)

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const img = await resizeImage(file)
      setPhotos((prev) => (prev.length >= 3 ? prev : [...prev, img]))
    } catch {
      swalError("อ่านรูปไม่สำเร็จ กรุณาลองใหม่")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const odoNum = Number(odo.replace(/,/g, "")) || 0
    const saveRes = await fetch("/api/tire-change-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch,
        driverName,
        plate,
        truckNumber,
        currentOdometer: odoNum,
        fleet: vehicle?.fleet ?? "",
        plant: vehicle?.plant ?? "",
        vehicleType: vehicle?.vehicleType ?? "",
        odometerPhoto: "",
      }),
    })
    if (!saveRes.ok) {
      setSaving(false)
      const d = await saveRes.json().catch(() => ({}))
      swalError(d.error ?? "บันทึกคำขอไม่สำเร็จ")
      return
    }
    const saved = await saveRes.json().catch(() => ({}))
    const rid = saved._id
    if (!rid) { setSaving(false); swalError("บันทึกคำขอไม่สำเร็จ"); return }

    const usedDistance = odoNum > 0 && tire.mileageStart > 0 ? odoNum - tire.mileageStart : tire.usedDistance ?? 0
    const itemRes = await fetch(`/api/tire-change-request/${rid}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tirePosition: tire.tirePosition,
        positionCode: tire.positionCode,
        positionName: tire.positionName,
        serialNo:     tire.serialNo,
        product:      tire.product,
        reason,
        note,
        photos,
        currentTreadMm: Number(treadMm) || 0,
        mileageStart: tire.mileageStart,
        usedDistance,
      }),
    })
    setSaving(false)
    if (!itemRes.ok) {
      const d = await itemRes.json().catch(() => ({}))
      swalError(d.error ?? "ส่งคำขอไม่สำเร็จ")
      return
    }
    swalToast("success", `ส่งคำขอเปลี่ยนยาง ${tire.positionCode || tire.serialNo} สำเร็จ`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && onClose()}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151a10] p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-[16px] text-[#14271C] dark:text-white" style={fontHead}>ขอเปลี่ยนยาง</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" style={fontThai}>
              <span className="font-mono font-semibold">{plate}</span>
              {" · "}{tire.positionCode} {tire.positionName}
              {tire.serialNo ? <>{" · "}<span className="font-mono">{tire.serialNo}</span></> : null}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>ชื่อคนขับ *</span>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inp + " w-full"} required placeholder="สมชาย ใจดี" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>เบอร์รถ *</span>
            <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} className={inp + " w-full"} required placeholder="112" />
          </label>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>เลขไมล์ปัจจุบัน *</span>
          <input value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^\d,]/g, ""))} className={inp + " w-full font-mono"} required inputMode="numeric" placeholder="250000" />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>สาเหตุ *</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} required className={inp + " w-full"}>
            <option value="">— เลือกสาเหตุ —</option>
            {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>มิลยาง (มม.)</span>
          <input type="number" step="0.5" min="0" inputMode="decimal" value={treadMm} onChange={(e) => setTreadMm(e.target.value)} placeholder="เช่น 3.5" className={inp + " w-full"} />
        </label>

        {/* photos (max 3) */}
        <div className="mb-3">
          <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-gray-500" style={fontThai}>
            <Camera size={11} /> รูปถ่ายยาง — {photos.length}/3
          </span>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, pi) => (
              <div key={pi} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt={`รูปยาง ${pi + 1}`} className="h-20 w-full rounded-lg bg-gray-50 object-cover dark:bg-white/5" />
                <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== pi))}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                  <X size={11} />
                </button>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="flex h-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-gray-400 dark:border-white/15 dark:hover:border-white/30">
                <span className="flex items-center gap-1 text-[11px]" style={fontThai}><Camera size={13} /> เพิ่มรูป</span>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
              </label>
            )}
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-[11px] font-medium text-gray-500" style={fontThai}>หมายเหตุ</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" className={inp + " w-full resize-none"} />
        </label>

        <div className="flex gap-2">
          <button type="submit" disabled={saving || !reason} className={btnPrimary + " flex-1"} style={fontThai}>
            {saving ? "กำลังส่ง..." : "ส่งคำขอ"}
          </button>
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-[11px] border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/8" style={fontThai}>
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  )
}

// ===========================================================================
// SECTION 8: Requests tab — คำขอ + อนุมัติ รวม 2 สาขา
// ===========================================================================

function PhotoThumb({ src, alt }: { src: string; alt: string }) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => window.open(src, "_blank")}
        onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        className="h-10 w-10 cursor-zoom-in rounded-md object-cover ring-1 ring-gray-200 dark:ring-white/10"
      />
      {hover && createPortal(
        <img
          src={src}
          alt={alt}
          className="pointer-events-none fixed z-50 rounded-lg object-cover shadow-2xl ring-2 ring-white dark:ring-white/20"
          style={{ left: hover.x + 16, top: hover.y + 16, width: 480, height: 320 }}
        />,
        document.body,
      )}
    </>
  )
}

const REQ_STATUS_TABS = [
  { value: "",            label: "ทั้งหมด" },
  { value: "pending",     label: "รออนุมัติ" },
  { value: "approved",    label: "อนุมัติแล้ว" },
  { value: "appointment", label: "นัดหมาย" },
  { value: "done",        label: "เสร็จสิ้น" },
  { value: "rejected",    label: "ปฏิเสธ" },
]

function RequestsTab({ branchFilter, onChanged }: {
  branchFilter: string
  onChanged: () => void
}) {
  const { data: session } = useSession()
  const [items, setItems]     = useState<TireRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState("")
  const [q, setQ]             = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acting, setActing]   = useState(false)
  const [mrMap, setMrMap]     = useState<Record<string, MrInfo | undefined>>({})
  const [view, setView]       = useState<"list" | "calendar">("list")
  const [appointmentTarget, setAppointmentTarget] = useState<TireRequest | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      branchesFor(branchFilter).map((b) => {
        const qs = new URLSearchParams({ branch: b, limit: "100" })
        if (statusTab) qs.set("status", statusTab)
        if (q)         qs.set("q", q)
        return fetch(`/api/tire-change-request?${qs}`)
          .then((r) => r.json())
          .then((d) => (Array.isArray(d.items) ? d.items : []) as TireRequest[])
          .catch(() => [] as TireRequest[])
      })
    )
    const merged = results.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    setItems(merged)
    setLoading(false)
  }, [branchFilter, statusTab, q])

  useEffect(() => { load() }, [load])

  // group คำขอด้วยทะเบียนรถ — 1 แถว = 1 คัน, กางออกดูรายละเอียดยางแต่ละเส้นได้ (2 ชั้น)
  const groups = useMemo(() => {
    const map = new Map<string, {
      key: string; branch: string; plate: string; truckNumber: string
      driverNames: string[]; requests: TireRequest[]; totalItems: number
      latestCreatedAt: string; statuses: string[]
    }>()
    for (const r of items) {
      const key = `${r.branch}|${r.plate}`
      let g = map.get(key)
      if (!g) {
        g = { key, branch: r.branch, plate: r.plate, truckNumber: r.truckNumber, driverNames: [], requests: [], totalItems: 0, latestCreatedAt: r.createdAt, statuses: [] }
        map.set(key, g)
      }
      g.requests.push(r)
      if (r.driverName && !g.driverNames.includes(r.driverName)) g.driverNames.push(r.driverName)
      g.totalItems += (r.items ?? []).length
      if (new Date(r.createdAt).getTime() > new Date(g.latestCreatedAt).getTime()) g.latestCreatedAt = r.createdAt
      const st = r.status ?? "pending"
      if (!g.statuses.includes(st)) g.statuses.push(st)
    }
    for (const g of map.values()) g.requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return Array.from(map.values()).sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime())
  }, [items])

  // fetch MR เมื่อกางแถวที่มีรายการ "รถกินยาง"
  useEffect(() => {
    if (!expanded) return
    const g = groups.find((x) => x.key === expanded)
    if (!g || !g.requests.some((r) => (r.items ?? []).some((it) => it.reason === "รถกินยาง"))) return
    fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(g.branch)}&plates=${encodeURIComponent(g.plate)}`)
      .then((res) => res.json())
      .then((data: Record<string, NonNullable<MrInfo>>) => setMrMap((prev) => ({ ...prev, [g.key]: data[g.plate] ?? null })))
      .catch(() => {})
  }, [expanded, groups])

  function mrChip(status: string) {
    if (status === "completed")   return { label: "ซ่อมเสร็จแล้ว", cls: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" }
    if (status === "in_progress") return { label: "กำลังซ่อม",     cls: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" }
    return { label: "รอดำเนินการ", cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" }
  }

  async function itemPatch(r: TireRequest, it: RequestItem, body: Record<string, unknown>, msg: string) {
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${r._id}/items/${it._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "ดำเนินการไม่สำเร็จ"); return }
    swalToast("success", msg)
    load(); onChanged()
  }

  async function requestPatch(r: TireRequest, body: Record<string, unknown>, msg: string) {
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${r._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); swalError(d.error ?? "ดำเนินการไม่สำเร็จ"); return }
    swalToast("success", msg)
    load(); onChanged()
  }

  async function handleItemApprove(r: TireRequest, it: RequestItem) {
    if (it.reason === "รถกินยาง") {
      const mr = mrMap[`${r.branch}|${r.plate}`]
      if (!mr || mr.status !== "completed") {
        await Swal.fire({
          icon: "warning",
          title: "รอ MR ซ่อมเสร็จก่อน",
          html: `ยางเส้นนี้สาเหตุ <b>รถกินยาง</b><br>ต้องปิด MR ก่อนจึงจะอนุมัติได้<br><br>สถานะ MR: <b>${mr ? mrChip(mr.status).label : "ยังไม่มี MR"}</b>`,
          confirmButtonText: "รับทราบ",
        })
        return
      }
    }
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "อนุมัติยางเส้นนี้?",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${r.driverName} · ${r.plate}<br>${it.positionCode} ${it.positionName} · ${it.serialNo}</div>`,
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
    itemPatch(r, it, { action: "approve", jobNo: String(jobNo).trim() }, `อนุมัติ ${it.positionCode || it.serialNo} แล้ว`)
  }

  async function handleItemReject(r: TireRequest, it: RequestItem) {
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "ปฏิเสธยางเส้นนี้?",
      html: `<code style="font-size:0.8rem;opacity:0.65">${it.positionCode} ${it.positionName} · ${it.serialNo}</code>`,
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
    itemPatch(r, it, { action: "reject", reason: value ?? "" }, `ปฏิเสธ ${it.positionCode || it.serialNo} แล้ว`)
  }

  async function handleEditJob(r: TireRequest, it: RequestItem) {
    const { value: jobNo, isConfirmed } = await Swal.fire<string>({
      title: "แก้ไขเลข Job",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">${r.driverName} · ${r.plate}<br>${it.positionCode} ${it.positionName} · ${it.serialNo}</div>`,
      input: "text",
      inputLabel: "เลข Job",
      inputValue: it.jobNo ?? "",
      inputPlaceholder: "ระบุเลข Job",
      inputValidator: (value) => (!value || !value.trim() ? "กรุณากรอกเลข Job" : undefined),
      showCancelButton: true,
      confirmButtonText: "บันทึก",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed || !jobNo) return
    itemPatch(r, it, { action: "editJob", jobNo: String(jobNo).trim() }, `อัปเดตเลข Job ${it.positionCode || it.serialNo} แล้ว`)
  }

  function handleAppointment(r: TireRequest) {
    setAppointmentTarget(r)
  }

  function confirmAppointment(dateIso: string) {
    if (!appointmentTarget) return
    requestPatch(appointmentTarget, { action: "appointment", date: dateIso }, "บันทึกนัดหมายแล้ว")
    setAppointmentTarget(null)
  }

  async function handleDone(r: TireRequest) {
    const result = await swalConfirm("ปิดงานเปลี่ยนยาง?", `${r.plate} · ${r.driverName}`)
    if (!result.isConfirmed) return
    requestPatch(r, { action: "done" }, "ปิดงานแล้ว")
  }

  async function handleCreateMr(r: TireRequest) {
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "สร้าง MR",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">ทะเบียน <b>${r.plate}</b></div>`,
      input: "textarea",
      inputLabel: "หมายเหตุ (ไม่บังคับ)",
      inputAttributes: { rows: "3", placeholder: "ระบุรายละเอียดการซ่อม..." },
      showCancelButton: true,
      confirmButtonText: "สร้าง MR",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    const res = await fetch("/api/tire-mr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: r.branch, plate: r.plate, requestId: r._id, note: value ?? "", createdBy: session?.user?.name ?? "" }),
    })
    if (!res.ok) { swalError("สร้าง MR ไม่สำเร็จ"); return }
    const data = await res.json()
    setMrMap((prev) => ({ ...prev, [`${r.branch}|${r.plate}`]: { mrId: String(data._id), status: "pending", note: value ?? "", updatedAt: new Date().toISOString() } }))
    swalToast("success", "สร้าง MR แล้ว")
  }

  async function handleMrStatusUpdate(r: TireRequest, nextStatus: string) {
    const key = `${r.branch}|${r.plate}`
    const mr = mrMap[key]
    if (!mr) return
    const label = nextStatus === "in_progress" ? "เริ่มดำเนินการซ่อม" : "ปิด MR — ซ่อมเสร็จแล้ว"
    const { value, isConfirmed } = await Swal.fire<string>({
      title: label,
      html: `<div style="font-size:0.85rem;margin-bottom:6px">ทะเบียน <b>${r.plate}</b></div>`,
      input: "textarea",
      inputLabel: "หมายเหตุ (ไม่บังคับ)",
      inputAttributes: { rows: "2" },
      showCancelButton: true,
      confirmButtonText: "ยืนยัน",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    const res = await fetch(`/api/tire-mr/${mr.mrId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, note: value ?? "", updatedBy: session?.user?.name ?? "" }),
    })
    if (!res.ok) { swalError("อัปเดตไม่สำเร็จ"); return }
    setMrMap((prev) => ({ ...prev, [key]: { ...mr, status: nextStatus, updatedAt: new Date().toISOString() } }))
    swalToast("success", `อัปเดต MR เป็น "${mrChip(nextStatus).label}" แล้ว`)
  }

  return (
    <div>
      {/* status tabs + search */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {REQ_STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatusTab(t.value)}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                statusTab === t.value
                  ? "bg-[#1B8C4B] text-white"
                  : "border border-[#EEF2F0] dark:border-white/10 text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/8",
              ].join(" ")}
              style={fontThai}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / คนขับ / เบอร์รถ / เลข Job..." className={inp + " w-full pl-8"} />
        </div>
        <div className="flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "list" as const,     label: "รายการ", Icon: List },
            { key: "calendar" as const, label: "ปฏิทิน",  Icon: CalendarDays },
          ]).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={[
                "inline-flex items-center gap-1 rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                view === key
                  ? "bg-[#1B8C4B] text-white"
                  : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-1.5 text-[12px] text-gray-400" style={fontThai}>{loading ? "กำลังโหลด..." : `${fmtNum(groups.length)} ทะเบียน`}</p>

      {view === "calendar" ? (
        <AppointmentCalendarView
          groups={groups}
          onAppointment={handleAppointment}
          onDone={handleDone}
          acting={acting}
        />
      ) : (
      <div className={card + " overflow-hidden"}>
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className={theadCls}>
                <th className={thCls}>ทะเบียน</th>
                <th className={thCls}>เบอร์รถ</th>
                <th className={thCls}>สาขา</th>
                <th className={thCls}>คนขับ</th>
                <th className={thCls + " text-center"}>คำขอ</th>
                <th className={thCls + " text-center"}>ยางที่ขอ</th>
                <th className={thCls}>สถานะ</th>
                <th className={thCls}>ล่าสุด</th>
                <th className={thCls}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-sm text-gray-400">
                  <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-gray-300 dark:text-gray-600" />
                  กำลังโหลด...
                </td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-sm text-gray-400" style={fontThai}>
                  <ClipboardCheck size={20} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  ไม่พบคำขอ
                </td></tr>
              ) : groups.map((g, i) => {
                const isOpen = expanded === g.key
                const approvedReq    = g.requests.find((r) => (r.status ?? "pending") === "approved")
                const appointmentReq = g.requests.find((r) => r.status === "appointment")
                return (
                  <React.Fragment key={g.key}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : g.key)}
                      className={`cursor-pointer border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""} hover:bg-[#F0FDF4] dark:hover:bg-white/4`}
                    >
                      <td className={tdCls + " font-mono font-semibold text-gray-900 dark:text-white"}>
                        <span className="inline-flex items-center gap-1">
                          {g.plate}
                          {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </span>
                      </td>
                      <td className={tdCls}>{g.truckNumber || "—"}</td>
                      <td className={tdCls}>
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold ${branchChipCls(g.branch)}`} style={fontThai}>
                          {branchLabel(g.branch)}
                        </span>
                      </td>
                      <td className={tdCls} style={fontThai}>{g.driverNames.join(", ") || "—"}</td>
                      <td className={tdCls + " text-center font-semibold"}>{g.requests.length}</td>
                      <td className={tdCls + " text-center font-semibold"}>{g.totalItems}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {g.statuses.map((st) => (
                            <span key={st} className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(st)}`} style={fontThai}>
                              {STATUS_LABEL[st] ?? st}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={tdCls}>{fmtDate(g.latestCreatedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {approvedReq || appointmentReq ? (
                          <div className="flex items-center gap-1.5">
                            {approvedReq && (
                              <button disabled={acting} onClick={() => handleAppointment(approvedReq)}
                                className={btnSmall + " cursor-pointer inline-flex items-center gap-1 bg-purple-600 text-white"} style={fontThai}>
                                <CalendarClock size={11} /> นัดหมาย
                              </button>
                            )}
                            {appointmentReq && (
                              <button disabled={acting} onClick={() => handleDone(appointmentReq)}
                                className={btnSmall + " cursor-pointer inline-flex items-center gap-1 bg-green-600 text-white"} style={fontThai}>
                                <Flag size={11} /> เสร็จสิ้น
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    </tr>

                    {/* expanded: คำขอของทะเบียนนี้ทั้งหมด แต่ละคำขอกางดูรายละเอียดยางแต่ละเส้นได้ */}
                    {isOpen && (
                      <tr className="border-b border-gray-100 bg-[#F6FAF7]/70 dark:border-white/5 dark:bg-white/2">
                        <td colSpan={9} className="px-4 py-3">
                          {g.requests.every((r) => (r.items ?? []).length === 0) ? (
                            <p className="text-xs text-gray-400" style={fontThai}>ไม่มีรายการยาง</p>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-white/8 dark:bg-[#0f1410]">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className={theadStaticCls}>
                                    <th className={thCls}>ล้อ</th>
                                    <th className={thCls}>Product</th>
                                    <th className={thCls}>Serial</th>
                                    <th className={thCls}>สาเหตุ</th>
                                    <th className={thCls + " text-right"}>มิลยาง</th>
                                    <th className={thCls + " text-right"}>ใช้งาน (กม.)</th>
                                    <th className={thCls}>รูป</th>
                                    <th className={thCls}>หมายเหตุ</th>
                                    <th className={thCls}>สถานะ</th>
                                    <th className={thCls}>คำขอ</th>
                                    <th className={thCls + " w-40"}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.requests.flatMap((r) => {
                                    const status = r.status ?? "pending"
                                    const mrKey = g.key
                                    const mr = mrMap[mrKey]
                                    const rItems = r.items ?? []
                                    const reqInfoCell = (
                                      <td rowSpan={Math.max(rItems.length, 1)} className="border-l border-[#EEF2F0] px-3 py-2 align-top dark:border-white/8">
                                        <div className="flex flex-col gap-1.5">
                                          <span className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(r.createdAt)}</span>
                                          {/* <span className={`inline-block w-fit rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(status)}`} style={fontThai}>
                                            {STATUS_LABEL[status] ?? status}
                                          </span> */}
                                          {r.appointmentDate && (
                                            <span className="text-[11px] text-purple-600 dark:text-purple-300" style={fontThai}>นัด: {fmtDateOnly(r.appointmentDate)}</span>
                                          )}
                                          {rItems.some((it) => (it.status ?? "pending") === "approved") && (
                                            <div className="flex flex-col gap-1">
                                              {rItems.filter((it) => (it.status ?? "pending") === "approved").map((it) => (
                                                <button key={it._id} type="button" onClick={() => handleEditJob(r, it)}
                                                  className="text-left text-[10px] text-gray-500 dark:text-gray-400 underline decoration-dotted hover:text-[#1B8C4B] dark:hover:text-green-400">
                                                  {it.positionCode}: {it.jobNo
                                                    ? <span className="cursor-pointer font-mono font-medium text-gray-700 dark:text-gray-200">{it.jobNo}</span>
                                                    : "+ ระบุเลข Job"}
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          {r.rejectReason && <span className="text-[11px] text-red-500" style={fontThai}>เหตุผล: {r.rejectReason}</span>}
                                        </div>
                                      </td>
                                    )

                                    if (rItems.length === 0) {
                                      return [
                                        <tr key={`${r._id}-empty`} className="border-b border-gray-100 last:border-0 dark:border-white/5">
                                          <td colSpan={9} className="px-3 py-2 text-xs text-gray-400" style={fontThai}>ไม่มีรายการยาง</td>
                                          {reqInfoCell}
                                          <td></td>
                                        </tr>,
                                      ]
                                    }

                                    return rItems.map((it, ii) => {
                                      const urls = it.photoUrls?.length ? it.photoUrls : it.photoUrl ? [it.photoUrl] : []
                                      const itStatus = it.status ?? "pending"
                                      return (
                                        <tr key={it._id} className="border-b border-gray-100 last:border-0 dark:border-white/5">
                                          <td className={tdCls + " font-mono font-bold text-gray-900 dark:text-white"} title={it.positionName}>{it.positionCode || "—"}</td>
                                          <td className={tdCls + " font-mono"}>{it.product || "—"}</td>
                                          <td className={tdCls + " font-mono"}>{it.serialNo || "—"}</td>
                                          <td className={tdCls + " font-medium"}>
                                            <div className="flex flex-col gap-1">
                                              <span style={fontThai}>{it.reason}</span>
                                              {it.reason === "รถกินยาง" && (() => {
                                                if (mr === undefined) return <span className="text-[10px] text-gray-400" style={fontThai}>กำลังตรวจ MR...</span>
                                                if (mr === null) return (
                                                  <button type="button" onClick={() => handleCreateMr(r)}
                                                    className="inline-flex w-fit items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90" style={fontThai}>
                                                    + สร้าง MR
                                                  </button>
                                                )
                                                const c = mrChip(mr.status)
                                                return (
                                                  <div className="flex flex-col gap-1">
                                                    <span className={`inline-block w-fit rounded px-1.5 py-px text-[10px] font-semibold ${c.cls}`} style={fontThai}>MR: {c.label}</span>
                                                    {mr.status === "pending" && (
                                                      <button type="button" onClick={() => handleMrStatusUpdate(r, "in_progress")}
                                                        className="inline-flex w-fit items-center rounded bg-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90" style={fontThai}>
                                                        เริ่มซ่อม
                                                      </button>
                                                    )}
                                                    {mr.status === "in_progress" && (
                                                      <button type="button" onClick={() => handleMrStatusUpdate(r, "completed")}
                                                        className="inline-flex w-fit items-center rounded bg-green-600 px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90" style={fontThai}>
                                                        ซ่อมเสร็จ ✓
                                                      </button>
                                                    )}
                                                  </div>
                                                )
                                              })()}
                                            </div>
                                          </td>
                                          <td className={tdCls + " text-right"}>{it.currentTreadMm > 0 ? it.currentTreadMm : "—"}</td>
                                          <td className={tdCls + " text-right font-mono"}>{it.usedDistance > 0 ? fmtNum(it.usedDistance) : "—"}</td>
                
                                          <td className="whitespace-nowrap px-3 py-1.5">
                                            {urls.length === 0 ? <span className="text-xs text-gray-400">—</span> : (
                                              <div className="flex gap-1.5">
                                                {urls.map((u, ui) => (
                                                   <PhotoThumb key={ui} src={u} alt={`รูปยาง ${ui + 1}`} />
                                                ))}
                                              </div>
                                            )}
                                          </td>
                                          <td className="max-w-[160px] truncate px-3 py-2 text-xs text-gray-500 dark:text-gray-400" title={it.note || undefined} style={fontThai}>{it.note || "—"}</td>
                                          <td className="whitespace-nowrap px-3 py-2">
                                            <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(itStatus)}`}
                                              title={it.rejectReason ? `เหตุผล: ${it.rejectReason}` : undefined} style={fontThai}>
                                              {STATUS_LABEL[itStatus] ?? itStatus}
                                            </span>
                                          </td>
                                          {ii === 0 && reqInfoCell}
                                          <td className="whitespace-nowrap px-3 py-2">
                                            {status !== "done" && (
                                              <div className="flex items-center gap-1.5">
                                                {itStatus !== "approved" && (
                                                  <button disabled={acting} onClick={() => handleItemApprove(r, it)}
                                                    className={btnSmall + "cursor-pointer inline-flex items-center gap-1 bg-green-600 text-white"} style={fontThai}>
                                                    <Check size={11} /> อนุมัติ
                                                  </button>
                                                )}
                                                {itStatus !== "rejected" && (
                                                  <button disabled={acting} onClick={() => handleItemReject(r, it)}
                                                    className={btnSmall + "cursor-pointer inline-flex items-center gap-1 bg-red-600 text-white"} style={fontThai}>
                                                    <X size={11} /> ปฏิเสธ
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      )
                                    })
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      <AppointmentDialog
        target={appointmentTarget}
        onClose={() => setAppointmentTarget(null)}
        onConfirm={confirmAppointment}
      />
    </div>
  )
}

// ===========================================================================
// SECTION 8b: Appointment dialog (shadcn Calendar) + Calendar view ของแท็บคำขอ
// ===========================================================================

function AppointmentDialog({ target, onClose, onConfirm }: {
  target: TireRequest | null
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
              {" · "}{target.driverName}
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

type ReqGroup = {
  key: string; branch: string; plate: string; truckNumber: string
  driverNames: string[]; requests: TireRequest[]; totalItems: number
  latestCreatedAt: string; statuses: string[]
}

type AppointmentEvent = {
  key:        string
  requestId:  string
  plate:      string
  branch:     string
  driverName: string
  status:     string
  date:       Date
}

const WEEKDAY_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
const MONTH_LABELS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]

const dayKey = (d: Date) => d.toDateString()

function AppointmentCalendarView({ groups, onAppointment, onDone, acting }: {
  groups: ReqGroup[]
  onAppointment: (r: TireRequest) => void
  onDone: (r: TireRequest) => void
  acting: boolean
}) {
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })
  const [selectedDay, setSelectedDay] = useState<string | null>(dayKey(new Date()))

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AppointmentEvent[]>()
    for (const g of groups) {
      for (const r of g.requests) {
        if (!r.appointmentDate) continue
        const d = new Date(r.appointmentDate)
        if (isNaN(d.getTime())) continue
        const k = dayKey(d)
        const arr = map.get(k) ?? []
        arr.push({ key: r._id, requestId: r._id, plate: g.plate, branch: g.branch, driverName: r.driverName, status: r.status ?? "pending", date: d })
        map.set(k, arr)
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime())
    return map
  }, [groups])

  const gridDays = useMemo(() => {
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const startOffset = new Date(year, month, 1).getDay()
    const gridStart = new Date(year, month, 1 - startOffset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [monthCursor])

  const todayKey = dayKey(new Date())
  const selectedEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : []

  function shiftMonth(delta: number) {
    setMonthCursor((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + delta); return d })
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      <div className={card + " p-4"}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg border border-[#EEF2F0] dark:border-white/10 p-1.5 hover:bg-[#F0FDF4] dark:hover:bg-white/5">
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg border border-[#EEF2F0] dark:border-white/10 p-1.5 hover:bg-[#F0FDF4] dark:hover:bg-white/5">
              <ChevronRight size={14} />
            </button>
            <h3 className="text-[15px] text-[#14271C] dark:text-white" style={fontHead}>
              {MONTH_LABELS[monthCursor.getMonth()]} {monthCursor.getFullYear() + 543}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonthCursor(d); setSelectedDay(dayKey(new Date())) }}
            className="rounded-lg border border-[#EEF2F0] dark:border-white/10 px-2.5 py-1 text-[12px] text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5"
            style={fontThai}
          >
            วันนี้
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1 text-center text-[11px] font-semibold text-[#9AA8A0]" style={fontThai}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {gridDays.map((d) => {
            const k = dayKey(d)
            const inMonth = d.getMonth() === monthCursor.getMonth()
            const dayEvents = eventsByDay.get(k) ?? []
            const isToday = k === todayKey
            const isSelected = k === selectedDay
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedDay(k)}
                className={[
                  "min-h-[64px] rounded-lg border p-1.5 text-left align-top transition-colors",
                  isSelected ? "border-[#1B8C4B] bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : "border-[#EEF2F0] dark:border-white/8 hover:bg-[#F6FAF7] dark:hover:bg-white/4",
                  !inMonth ? "opacity-40" : "",
                ].join(" ")}
              >
                <span className={isToday
                  ? "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1B8C4B] text-[11px] font-semibold text-white"
                  : "text-[11px] font-semibold text-[#14271C] dark:text-white"}>
                  {d.getDate()}
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  {dayEvents.slice(0, 2).map((e) => (
                    <span key={e.key} className={`truncate rounded px-1 py-px text-[9px] font-medium ${statusChip(e.status)}`} style={fontThai}>
                      {e.plate}
                    </span>
                  ))}
                  {dayEvents.length > 2 && (
                    <span className="text-[9px] text-[#9AA8A0]" style={fontThai}>+{dayEvents.length - 2} อื่นๆ</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className={card + " p-4"}>
        <h4 className="mb-2 text-[13px] font-semibold text-[#14271C] dark:text-white" style={fontThai}>
          {selectedDay ? new Date(selectedDay).toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" }) : "เลือกวันที่เพื่อดูรายละเอียด"}
        </h4>
        {selectedDay && selectedEvents.length === 0 && (
          <p className="text-[12px] text-gray-400" style={fontThai}>ไม่มีนัดหมายวันนี้</p>
        )}
        <div className="flex flex-col gap-2">
          {selectedEvents.map((e) => {
            const g = groups.find((gr) => gr.key === `${e.branch}|${e.plate}`)
            const r = g?.requests.find((rr) => rr._id === e.requestId)
            return (
              <div key={e.key} className="rounded-[12px] border border-[#EEF2F0] dark:border-white/8 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[13px] font-semibold text-[#14271C] dark:text-white">{e.plate}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${branchChipCls(e.branch)}`} style={fontThai}>{branchLabel(e.branch)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>{e.driverName || "—"}</p>
                <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-[10px] font-medium ${statusChip(e.status)}`} style={fontThai}>
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
                {r && e.status !== "done" && (
                  <div className="mt-2 flex gap-1.5">
                    <button disabled={acting} onClick={() => onAppointment(r)} className={btnSmall + " inline-flex items-center gap-1 bg-purple-600 text-white"} style={fontThai}>
                      <CalendarClock size={11} /> แก้ไขนัดหมาย
                    </button>
                    {e.status === "appointment" && (
                      <button disabled={acting} onClick={() => onDone(r)} className={btnSmall + " inline-flex items-center gap-1 bg-green-600 text-white"} style={fontThai}>
                        <Flag size={11} /> เสร็จสิ้น
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// SECTION 9: History tab — ประวัติการเปลี่ยนรวม 2 สาขา + Sync
// ===========================================================================

type TireChange = {
  _id:                string
  branch:             string
  vehicle:            string
  tirePosition:       string
  product:            string
  serialNo:           string
  treadMm:            number
  mileageStart:       number
  mileageEnd:         number
  maintenanceRequest: string
  changeIn:           string | null
  changeOut:          string | null
  isLatest:           boolean
  updatedAt:          string | null
}

function HistoryTab({ branchFilter }: { branchFilter: string }) {
  const [items, setItems]     = useState<TireChange[]>([])
  const [total, setTotal]     = useState(0)
  const [pages, setPages]     = useState(1)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [q, setQ]             = useState("")
  const [latestFilter, setLatestFilter] = useState("yes")

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      branchesFor(branchFilter).map((b) => {
        const qs = new URLSearchParams({ branch: b, page: String(page), limit: "100" })
        if (q)            qs.set("q", q)
        if (latestFilter) qs.set("latest", latestFilter)
        return fetch(`/api/tire-change?${qs}`)
          .then((r) => r.json())
          .catch(() => ({ items: [], total: 0, pages: 1 }))
      })
    )
    const merged = results.flatMap((d) => (Array.isArray(d.items) ? d.items : []) as TireChange[])
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    setItems(merged)
    setTotal(results.reduce((a, d) => a + (d.total ?? 0), 0))
    setPages(Math.max(...results.map((d) => d.pages ?? 1)))
    setLoading(false)
  }, [branchFilter, q, latestFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, latestFilter, branchFilter])

  async function doSync(branch: string, phpsessid?: string) {
    setSyncing(branch)
    const res = await fetch("/api/tire-change/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch, ...(phpsessid ? { phpsessid } : {}) }),
    })
    setSyncing(null)
    const d = await res.json().catch(() => ({}))

    if (res.status === 401) {
      const { value, isConfirmed } = await Swal.fire<string>({
        title: "Session หมดอายุ",
        text: "วาง PHPSESSID ใหม่จาก mena-atms.com (DevTools → Cookies)",
        input: "text",
        inputPlaceholder: "PHPSESSID",
        showCancelButton: true,
        confirmButtonText: "Sync",
        cancelButtonText: "ยกเลิก",
        reverseButtons: true,
      })
      if (isConfirmed && value?.trim()) await doSync(branch, value.trim())
      return
    }
    if (!res.ok) { swalError(d.error ?? "Sync ไม่สำเร็จ"); return }
    swalToast("success", `Sync ${branchLabel(branch)} สำเร็จ ${(d.count ?? 0).toLocaleString()} รายการ`)
    load()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / Serial / สินค้า..." className={inp + " w-full pl-8"} />
        </div>
        <select value={latestFilter} onChange={(e) => setLatestFilter(e.target.value)} className={inp + " max-w-[170px]"} style={fontThai}>
          <option value="">ทั้งหมด</option>
          <option value="yes">เฉพาะยางที่ใช้อยู่</option>
          <option value="no">เฉพาะยางที่ถอดแล้ว</option>
        </select>
        <span className="text-[12px] text-gray-400" style={fontThai}>({fmtNum(total)} รายการ)</span>
        <div className="ml-auto flex gap-2">
          {branchesFor(branchFilter).map((b) => (
            <button
              key={b}
              onClick={() => doSync(b)}
              disabled={syncing !== null}
              className="flex items-center gap-1.5 rounded-[11px] bg-gray-950 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-gray-900"
              style={fontThai}
            >
              <RefreshCw size={12} className={syncing === b ? "animate-spin" : ""} />
              {syncing === b ? "กำลัง Sync..." : `Sync ${branchLabel(b)}${SYNC_SCOPE[b] ? ` (${SYNC_SCOPE[b]})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      <div className={card + " overflow-hidden"}>
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className={theadCls}>
                <th className={thCls}>สาขา</th>
                <th className={thCls}>ยานพาหนะ</th>
                <th className={thCls}>ตำแหน่งยาง</th>
                <th className={thCls}>สินค้า</th>
                <th className={thCls}>Serial No</th>
                <th className={thCls + " text-right"}>มม.</th>
                <th className={thCls + " text-right"}>ไมล์เริ่มต้น</th>
                <th className={thCls + " text-right"}>ไมล์สิ้นสุด</th>
                <th className={thCls}>เปลี่ยนเข้า</th>
                <th className={thCls}>เปลี่ยนออก</th>
                <th className={thCls}>ใช้อยู่</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-14 text-center text-sm text-gray-400">
                  <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-gray-300 dark:text-gray-600" />
                  กำลังโหลด...
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-14 text-center text-sm text-gray-400" style={fontThai}>
                  <History size={20} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  ไม่พบรายการ — กด Sync เพื่อดึงข้อมูลจาก ATMS
                </td></tr>
              ) : items.map((t, i) => (
                <tr key={t._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                  <td className={tdCls}>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold ${branchChipCls(t.branch)}`} style={fontThai}>
                      {branchLabel(t.branch)}
                    </span>
                  </td>
                  <td className={tdCls + " font-mono font-semibold text-gray-900 dark:text-white"}>{t.vehicle || "—"}</td>
                  <td className={tdCls}>{t.tirePosition || "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.product || "—"}</td>
                  <td className={tdCls + " font-mono"}>{t.serialNo || "—"}</td>
                  <td className={tdCls + " text-right"}>{t.treadMm || "—"}</td>
                  <td className={tdCls + " text-right font-mono"}>{fmtNum(t.mileageStart)}</td>
                  <td className={tdCls + " text-right font-mono"}>{t.mileageEnd > 0 ? fmtNum(t.mileageEnd) : "—"}</td>
                  <td className={tdCls}>{fmtDate(t.changeIn)}</td>
                  <td className={tdCls}>{fmtDate(t.changeOut)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {t.isLatest && (
                      <span className="inline-block rounded-md bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300" style={fontThai}>
                        ใช้อยู่
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5 dark:border-white/8">
            <span className="text-xs text-gray-400" style={fontThai}>หน้า {page} / {pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/8" style={fontThai}>
                ก่อนหน้า
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/8" style={fontThai}>
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
