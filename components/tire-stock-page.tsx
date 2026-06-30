"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Search, Plus, Pencil, Trash2, Disc3, Download, FileBarChart2, X, Link2, TrendingUp, ChevronDown, ChevronRight } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import * as XLSX from "xlsx"

type TireStock = {
  _id:         string
  branch:      string
  prCode:      string
  ddCode:      string
  depositDate: string
  productCode: string
  productName: string
  serialNo:    string
  unitPrice:   number
  brand:       string
  tireSize:    string
  tireModel:   string
  distance:    number
  status:      string
  tireType:      string
  warrantyUntil: string
}

const STATUS_OPTIONS = ["In Stock", "เบิกใช้แล้ว", "เคลม", "ขายแล้ว"]
const TIRE_TYPES     = ["เรเดียล", "ผ้าใบ"]

const EMPTY: Omit<TireStock, "_id" | "branch"> = {
  prCode: "", ddCode: "", depositDate: "", productCode: "", productName: "",
  serialNo: "", unitPrice: 0, brand: "", tireSize: "", tireModel: "",
  distance: 0, status: "In Stock", tireType: "", warrantyUntil: "",
}

const fmtNum = (n: number) =>
  (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtInt = (n: number) => (n ?? 0).toLocaleString("th-TH")

const fmtDate = (s: string | Date | null | undefined) => {
  if (!s) return "—"
  const d = new Date(s as string)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

type MrStatus = {
  mrId: string
  status: string
  note: string
  updatedAt: string
}

type TirePerf = {
  serialNo: string; unitPrice: number; status: string
  plate: string | null; reason: string | null
  usedDistance: number | null; remainingPct: number | null
  bahtPerKm: number | null; stdBahtPerKm: number | null
  requestStatus: string | null; itemCreatedAt: string | null
}
type PerfGroup = {
  brand: string; tireSize: string; tireModel: string
  stdDistance: number; count: number; countIssued: number
  avgUsedDistance: number | null; avgRemainingPct: number | null
  avgBahtPerKm: number | null; avgStdBahtPerKm: number | null
  costVariance: number | null; tires: TirePerf[]
}

type PrReqItem = {
  requestId: string; requestDate: string | null; plate: string; truckNumber: string
  driverName: string; fleet: string; plant: string; currentOdometer: number; requestStatus: string
  tirePosition: string; positionCode: string; positionName: string; product: string
  reason: string; note: string; photoUrls: string[]; odometerPhotoUrl: string; currentTreadMm: number
  mileageStart: number; usedDistance: number; itemCreatedAt: string | null; itemStatus: string
  remainingPct: number | null; bahtPerKm: number | null; bahtPerKmStock: number | null
}
type PrReportRow = {
  _id: string; prCode: string; ddCode: string; depositDate: string
  productCode: string; productName: string; serialNo: string
  unitPrice: number; brand: string; tireSize: string; tireModel: string
  distance: number; status: string; requests: PrReqItem[]
}

function statusChip(status: string) {
  switch (status) {
    case "In Stock":   return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    case "เบิกใช้แล้ว": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    case "เคลม":       return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
    case "ขายแล้ว":    return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
    default:           return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
  }
}

/** Row tint based on the first request's requestStatus (or no-request default) */
function rowTint(requests: PrReqItem[]): string {
  if (requests.length === 0) return ""
  const s = requests[0].requestStatus
  if (s === "pending")  return "bg-amber-50/60  dark:bg-amber-900/10"
  if (s === "approved") return "bg-blue-50/60   dark:bg-blue-900/10"
  if (s === "done")     return "bg-green-50/60  dark:bg-green-900/10"
  return ""
}

export function TireStockPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [items, setItems]           = useState<TireStock[]>([])
  const [loading, setLoading]       = useState(true)
  const [q, setQ]                   = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [prFilter, setPrFilter]     = useState("")
  const [dateFrom, setDateFrom]     = useState("")
  const [dateTo, setDateTo]         = useState("")
  const [editId, setEditId]         = useState<string | null>(null)
  const [form, setForm]             = useState(EMPTY)
  const [saving, setSaving]         = useState(false)

  // PR Report
  const [mode, setMode]             = useState<"stock" | "report" | "performance">("stock")
  const [prCodes, setPrCodes]       = useState<string[]>([])
  const [selectedPr, setSelectedPr] = useState("")
  const [reportRows, setReportRows] = useState<PrReportRow[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  // Performance
  const [perfGroups, setPerfGroups]       = useState<PerfGroup[]>([])
  const [perfLoading, setPerfLoading]     = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  // MR status (internal)
  const [mrStatusMap, setMrStatusMap] = useState<Record<string, MrStatus>>({})

  // PR dropdown search
  const [prSearch, setPrSearch]     = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Sync URL params → state on mount ─────────────────────────────────────
  useEffect(() => {
    const tab = searchParams.get("tab")
    const pr  = searchParams.get("pr")
    if (tab === "report") {
      setMode("report")
      if (pr) { setSelectedPr(pr); setPrSearch(pr) }
    } else if (tab === "performance") {
      setMode("performance")
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push URL params when mode / selectedPr changes ───────────────────────
  const pushParams = useCallback((nextMode: "stock" | "report" | "performance", nextPr: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (nextMode === "report") {
      params.set("tab", "report")
      if (nextPr) params.set("pr", nextPr)
      else        params.delete("pr")
    } else if (nextMode === "performance") {
      params.set("tab", "performance")
      params.delete("pr")
    } else {
      params.delete("tab")
      params.delete("pr")
    }
    router.push(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  function switchMode(next: "stock" | "report" | "performance") {
    setMode(next)
    pushParams(next, next === "report" ? selectedPr : "")
  }

  function selectPr(pr: string) {
    setSelectedPr(pr)
    setPrSearch(pr)
    setDropdownOpen(false)
    pushParams("report", pr)
  }

  function clearPr() {
    setSelectedPr("")
    setPrSearch("")
    setReportRows([])
    pushParams("report", "")
  }

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ branch })
    if (q)            qs.set("q", q)
    if (statusFilter) qs.set("status", statusFilter)
    if (prFilter)     qs.set("prCode", prFilter)
    if (dateFrom)     qs.set("dateFrom", dateFrom)
    if (dateTo)       qs.set("dateTo", dateTo)
    const res  = await fetch(`/api/tire-stock?${qs}`)
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [branch, q, statusFilter, prFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // load PR codes when switching to report mode
  useEffect(() => {
    if (mode !== "report") return
    fetch(`/api/tire-stock/pr-report?branch=${branch}`)
      .then((r) => r.json()).then((d) => { if (Array.isArray(d)) setPrCodes(d) })
  }, [mode, branch])

  async function loadReport(pr: string) {
    if (!pr) return
    setReportLoading(true)
    const res = await fetch(`/api/tire-stock/pr-report?branch=${branch}&prCode=${encodeURIComponent(pr)}`)
    const raw = await res.json().catch(() => [])
    const d: PrReportRow[] = Array.isArray(raw) ? raw : []
    setReportRows(d)
    setReportLoading(false)

    // fetch internal MR latest status for all plates in this report
    const plates = [...new Set(d.flatMap((r) => r.requests.map((rq) => rq.plate)).filter(Boolean))]
    if (plates.length > 0) {
      fetch(`/api/tire-mr/latest?branch=${branch}&plates=${encodeURIComponent(plates.join(","))}`)
        .then((r) => r.json())
        .then((data: Record<string, MrStatus>) => setMrStatusMap(data))
        .catch(() => {})
    }
  }

  useEffect(() => { if (selectedPr) loadReport(selectedPr) }, [selectedPr]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "performance") return
    setPerfLoading(true)
    fetch(`/api/tire-stock/performance?branch=${branch}`)
      .then((r) => r.json())
      .then((d) => { setPerfGroups(Array.isArray(d) ? d : []); setPerfLoading(false) })
      .catch(() => setPerfLoading(false))
  }, [mode, branch])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      swalToast("success", "คัดลอกแล้ว!")
    } catch {
      swalToast("error", "คัดลอกไม่สำเร็จ")
    }
  }

  const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"

  function setF(k: string, v: string | number) { setForm((p) => ({ ...p, [k]: v })) }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setSaving(true)
    const res = await fetch(`/api/tire-stock/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) { swalError("บันทึกไม่สำเร็จ"); return }
    setEditId(null)
    swalToast("success", "บันทึกสำเร็จ")
    load()
  }

  async function handleDelete(item: TireStock) {
    const result = await swalDeleteConfirm(`ลบรายการ Serial No "${item.serialNo}"?`)
    if (!result.isConfirmed) return
    await fetch(`/api/tire-stock/${item._id}`, { method: "DELETE" })
    swalToast("success", "ลบรายการสำเร็จ")
    load()
  }

  function startEdit(item: TireStock) {
    setEditId(item._id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, branch: _b, ...rest } = item
    setForm({ ...EMPTY, ...rest })
  }

  function exportToExcel() {
    const rows = items.map((t) => ({
      "PR Code":      t.prCode,
      "DD Code":      t.ddCode,
      "Deposit Date": t.depositDate,
      "รหัสสินค้า":    t.productCode,
      "ชื่อสินค้า":    t.productName,
      "Serial No":    t.serialNo,
      "Unit Price":   t.unitPrice,
      "ยี่ห้อ":        t.brand,
      "ขนาดยาง":      t.tireSize,
      "รุ่นยาง":       t.tireModel,
      "ระยะทาง":      t.distance,
      "Status":       t.status,
      "ประเภทยาง":    t.tireType,
      "วันหมดประกัน":  t.warrantyUntil,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "TireStock")
    XLSX.writeFile(wb, `tire-stock-${branch}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // plain JSX (not a nested component) so inputs keep focus across re-renders
  const formFields = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">PR Code</label>
          <input value={form.prCode} onChange={(e) => setF("prCode", e.target.value)} className={inp} placeholder="PR-2026-001" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">DD Code</label>
          <input value={form.ddCode} onChange={(e) => setF("ddCode", e.target.value)} className={inp} placeholder="DD-2026-001" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Deposit Date</label>
          <input type="date" value={form.depositDate} onChange={(e) => setF("depositDate", e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Serial No *</label>
          <input value={form.serialNo} onChange={(e) => setF("serialNo", e.target.value)} className={inp} required placeholder="SN123456" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">รหัสสินค้า</label>
          <input value={form.productCode} onChange={(e) => setF("productCode", e.target.value)} className={inp} placeholder="TR-001" />
        </div>
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ชื่อสินค้า</label>
          <input value={form.productName} onChange={(e) => setF("productName", e.target.value)} className={inp} placeholder="ยางรถบรรทุก 11R22.5" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ยี่ห้อ</label>
          <input value={form.brand} onChange={(e) => setF("brand", e.target.value)} className={inp} placeholder="Bridgestone" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ขนาดยาง</label>
          <input value={form.tireSize} onChange={(e) => setF("tireSize", e.target.value)} className={inp} placeholder="11R22.5" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">รุ่นยาง</label>
          <input value={form.tireModel} onChange={(e) => setF("tireModel", e.target.value)} className={inp} placeholder="R150" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Status</label>
          <select value={form.status} onChange={(e) => setF("status", e.target.value)} className={inp}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Unit Price</label>
          <input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setF("unitPrice", Number(e.target.value))} className={inp} placeholder="0.00" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ระยะทาง</label>
          <input type="number" step="1" min="0" value={form.distance} onChange={(e) => setF("distance", Number(e.target.value))} className={inp} placeholder="20000" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ประเภทยาง</label>
          <select value={form.tireType} onChange={(e) => setF("tireType", e.target.value)} className={inp}>
            <option value="">— เลือก —</option>
            {!TIRE_TYPES.includes(form.tireType) && form.tireType && <option value={form.tireType}>{form.tireType}</option>}
            {TIRE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">วันหมดประกัน</label>
          <input type="date" value={form.warrantyUntil} onChange={(e) => setF("warrantyUntil", e.target.value)} className={inp} />
        </div>
      </div>
    </div>
  )

  function mrChip(status: string) {
    switch (status) {
      case "completed":   return { label: "ซ่อมเสร็จ",     cls: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" }
      case "in_progress": return { label: "กำลังซ่อม",     cls: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" }
      case "pending":     return { label: "รอดำเนินการ",   cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" }
      default:            return { label: status,            cls: "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400" }
    }
  }

  const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
  // First column of each column group gets a left border separator
  const thGroup = th + " border-l-2 border-gray-200 dark:border-white/10"

  // Filtered PR list for dropdown
  const filteredPrCodes = prSearch
    ? prCodes.filter((p) => p.toLowerCase().includes(prSearch.toLowerCase()))
    : prCodes

  // Summary counts
  const totalSerial  = reportRows.length
  const countIssued  = reportRows.filter((r) => r.requests.length > 0).length
  const countPending = reportRows.filter((r) => r.requests.some((q) => q.requestStatus === "pending")).length
  const countDone    = reportRows.filter((r) => r.requests.some((q) => q.requestStatus === "approved" || q.requestStatus === "done")).length

  // Extended summary metrics
  const totalValue   = reportRows.reduce((s, r) => s + (r.unitPrice || 0), 0)
  const reqRows      = reportRows.filter((r) => r.requests.length > 0)
  const allReqs      = reqRows.map((r) => r.requests[0])
  const avgUsedDist  = allReqs.length ? Math.round(allReqs.reduce((s, r) => s + r.usedDistance, 0) / allReqs.length) : null
  const avgRemaining = allReqs.filter((r) => r.remainingPct !== null).length
    ? Math.round(allReqs.filter((r) => r.remainingPct !== null).reduce((s, r) => s + (r.remainingPct ?? 0), 0) / allReqs.filter((r) => r.remainingPct !== null).length)
    : null
  const avgBahtPerKm = allReqs.filter((r) => r.bahtPerKm !== null).length
    ? allReqs.filter((r) => r.bahtPerKm !== null).reduce((s, r) => s + (r.bahtPerKm ?? 0), 0) / allReqs.filter((r) => r.bahtPerKm !== null).length
    : null
  const avgBahtPerKmStock = allReqs.filter((r) => r.bahtPerKmStock !== null).length
    ? allReqs.filter((r) => r.bahtPerKmStock !== null).reduce((s, r) => s + (r.bahtPerKmStock ?? 0), 0) / allReqs.filter((r) => r.bahtPerKmStock !== null).length
    : null
  // Reason breakdown
  const reasonMap = new Map<string, number>()
  for (const r of allReqs) {
    const reason = r.reason || "ไม่ระบุ"
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1)
  }
  const reasonBreakdown = [...reasonMap.entries()].sort((a, b) => b[1] - a[1])
  const reasonMax = reasonBreakdown[0]?.[1] ?? 1
  const REASON_COLORS: Record<string, string> = {
    "หมดดอก":   "bg-amber-400",
    "ยางระเบิด": "bg-red-500",
    "ยางฉีก":   "bg-orange-400",
    "ยางบวม":   "bg-purple-400",
    "รถกินยาง": "bg-blue-400",
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Disc3 size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Tire Stock — {branchLabel}</h1>
        <span className="text-sm text-gray-400">({items.length} รายการ)</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => switchMode("stock")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === "stock" ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900" : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8"}`}>
            Stock
          </button>
          <button onClick={() => switchMode("report")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === "report" ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900" : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8"}`}>
            <FileBarChart2 size={14} /> รายงาน PR
          </button>
          <button onClick={() => switchMode("performance")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === "performance" ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900" : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8"}`}>
            <TrendingUp size={14} /> ประสิทธิภาพยาง
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        สต๊อกยางสาขา{branchLabel} — ค้นหาด้วย PR Code / DD Code / รหัสสินค้า / Serial No / ยี่ห้อ
      </p>

      {/* ── PR Report view ── */}
      {mode === "report" && (
        <div>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* PR search dropdown */}
            <div className="relative" ref={dropdownRef}>
              <div className="relative w-64">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={prSearch}
                  onChange={(e) => { setPrSearch(e.target.value); setDropdownOpen(true) }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder="พิมพ์หรือเลือก PR Code..."
                  className={inp + " pl-8"}
                  aria-label="ค้นหา PR Code"
                  aria-expanded={dropdownOpen}
                  aria-haspopup="listbox"
                  role="combobox"
                  aria-autocomplete="list"
                />
              </div>
              {dropdownOpen && filteredPrCodes.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="รายการ PR Code"
                  className="absolute z-50 mt-1 w-64 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg py-1"
                >
                  {filteredPrCodes.map((p) => (
                    <li key={p} role="option" aria-selected={p === selectedPr}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectPr(p) }}
                        className={`w-full px-3 py-2 text-left text-sm font-mono transition-colors
                          ${p === selectedPr
                            ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white font-semibold"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
                          }`}
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {dropdownOpen && filteredPrCodes.length === 0 && prSearch && (
                <div className="absolute z-50 mt-1 w-64 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-lg px-3 py-3 text-sm text-gray-400">
                  ไม่พบ PR Code
                </div>
              )}
            </div>

            {/* Selected PR chip + share */}
            {selectedPr && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-white/10 px-3 py-1.5 text-sm font-mono font-semibold text-gray-900 dark:text-white">
                  {selectedPr}
                  <button
                    type="button"
                    onClick={clearPr}
                    aria-label="ล้าง PR ที่เลือก"
                    className="ml-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
                  >
                    <X size={13} />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  title="คัดลอกลิงก์"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/8 transition-colors"
                >
                  <Link2 size={13} />
                  คัดลอกลิงก์
                </button>
              </div>
            )}
          </div>

          {/* Summary bar */}
          {reportRows.length > 0 && !reportLoading && (
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-white/8 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                {totalSerial} Serial No
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                {countIssued} เบิกแล้ว
              </span>
              {countPending > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {countPending} pending
                </span>
              )}
              {countDone > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/30 px-2.5 py-1 text-[11px] font-medium text-green-700 dark:text-green-300">
                  {countDone} approved/done
                </span>
              )}
            </div>
          )}

          {reportLoading ? (
            <p className="text-sm text-gray-400 py-10 text-center">กำลังโหลด...</p>
          ) : !selectedPr ? null : reportRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">ไม่พบข้อมูล</p>
          ) : (
            <>
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              {/* Card 1: Serial / เบิก */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">ยางใน PR</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{totalSerial}<span className="text-xs font-normal text-gray-400 ml-1">เส้น</span></p>
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${totalSerial ? (countIssued / totalSerial) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">{countIssued} เบิก</span>
                </div>
              </div>
              {/* Card 2: มูลค่า PR */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">มูลค่า PR</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  ฿{totalValue.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  เฉลี่ย ฿{totalSerial ? Math.round(totalValue / totalSerial).toLocaleString("th-TH") : "—"}/เส้น
                </p>
              </div>
              {/* Card 3: ระยะทางเฉลี่ย */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">ระยะทางเฉลี่ย</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {avgUsedDist !== null ? avgUsedDist.toLocaleString("th-TH") : "—"}
                  <span className="text-xs font-normal text-gray-400 ml-1">กม.</span>
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  มาตรฐาน {reportRows[0]?.distance ? reportRows[0].distance.toLocaleString("th-TH") : "—"} กม.
                </p>
              </div>
              {/* Card 4: ประสิทธิภาพ */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">ประสิทธิภาพเฉลี่ย</p>
                <p className={`text-xl font-bold ${avgRemaining !== null && avgRemaining <= 20 ? "text-red-600 dark:text-red-400" : avgRemaining !== null && avgRemaining <= 50 ? "text-amber-500 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                  {avgRemaining !== null ? `${avgRemaining}%` : "—"}
                  <span className="text-xs font-normal text-gray-400 ml-1">เหลือ</span>
                </p>
                <p className="text-[11px] text-gray-400 mt-1">{countPending} รออนุมัติ · {countDone} เสร็จ</p>
              </div>
              {/* Card 5: ฿/กม. จริง vs มาตรฐาน */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">฿/กม. เฉลี่ย</p>
                <p className={`text-xl font-bold ${avgBahtPerKm !== null && avgBahtPerKmStock !== null && avgBahtPerKm > avgBahtPerKmStock ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                  {avgBahtPerKm !== null ? avgBahtPerKm.toFixed(4) : "—"}
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                  <span className="text-gray-400">มาตรฐาน</span>
                  <span className="text-gray-600 dark:text-gray-400 font-medium">{avgBahtPerKmStock !== null ? avgBahtPerKmStock.toFixed(4) : "—"}</span>
                  {avgBahtPerKm !== null && avgBahtPerKmStock !== null && avgBahtPerKm > avgBahtPerKmStock && (
                    <span className="text-red-500 text-[10px] font-semibold">↑ สูงกว่ามาตรฐาน</span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Breakdown สาเหตุ ── */}
            {reasonBreakdown.length > 0 && (
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-4 mb-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">สาเหตุการเปลี่ยนยาง</p>
                <div className="space-y-2.5">
                  {reasonBreakdown.map(([reason, count]) => (
                    <div key={reason} className="flex items-center gap-3">
                      <span className="w-28 text-xs text-gray-700 dark:text-gray-300 shrink-0 truncate">{reason}</span>
                      <div className="flex-1 h-5 rounded-md bg-gray-100 dark:bg-white/8 overflow-hidden">
                        <div
                          className={`h-full rounded-md transition-all ${REASON_COLORS[reason] ?? "bg-gray-400"}`}
                          style={{ width: `${(count / reasonMax) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-900 dark:text-white w-6 text-right">{count}</span>
                      <span className="text-[11px] text-gray-400 w-10 text-right">{allReqs.length ? Math.round((count / allReqs.length) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
                {allReqs.length > 0 && (
                  <p className="mt-3 text-[11px] text-gray-400">จากยางที่มีคำขอทั้งหมด {allReqs.length} เส้น</p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                      {/* Group 1: สต๊อก */}
                      <th className={th + " sticky left-0 z-20 bg-gray-50 dark:bg-[#0f1117] shadow-[1px_0_0_0_#e5e7eb] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.08)]"}>Serial No</th>
                      <th className={th}>สินค้า</th>
                      <th className={th + " text-right"}>ราคา</th>
                      <th className={th + " text-right"}>ระยะ</th>
                      <th className={th}>สถานะ</th>
                      {/* Group 2: คำขอ */}
                      <th className={thGroup}>ทะเบียน</th>
                      <th className={th}>เบอร์</th>
                      <th className={th}>คนขับ</th>
                      <th className={th}>ฟลีท/Plant</th>
                      <th className={th + " text-right"}>ไมล์</th>
                      {/* Group 3: ยาง */}
                      <th className={thGroup}>Pos</th>
                      <th className={th}>ตำแหน่ง</th>
                      <th className={th}>สาเหตุ</th>
                      <th className={th + " text-right"}>มม.</th>
                      <th className={th + " text-right"}>ไมล์เริ่ม</th>
                      {/* Group 4: ผลลัพธ์ */}
                      <th className={thGroup + " text-right"}>ใช้งาน</th>
                      <th className={th + " text-right"}>ประสิทธิ์</th>
                      <th className={th + " text-right"}>฿/กม.<br/><span className="font-normal normal-case opacity-60">มาตรฐาน/จริง</span></th>
                      {/* Group 5: หลักฐาน */}
                      <th className={thGroup}>รูป</th>
                      <th className={th}>วันที่ขอ</th>
                      <th className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.flatMap((row, ri) => {
                      const td0 = "px-2 py-1 text-[11px] whitespace-nowrap"
                      const tdGroup = td0 + " border-l-2 border-gray-100 dark:border-white/5"
                      const tint = rowTint(row.requests)
                      const baseRow = tint || (ri % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : "")

                      const stockCells = (
                        <>
                          <td className={td0 + " font-mono font-semibold text-gray-900 dark:text-white sticky left-0 z-10 bg-white dark:bg-[#0f1117] shadow-[1px_0_0_0_#e5e7eb] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.08)]"}>
                            {row.serialNo}
                          </td>
                          <td className="px-2 py-1 text-[11px] text-gray-700 dark:text-gray-300">{row.productName || "—"}</td>
                          <td className={td0 + " text-right"}>{fmtNum(row.unitPrice)}</td>
                          <td className={td0 + " text-right"}>{fmtInt(row.distance)}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <span className={`inline-block rounded-md px-1.5 py-px text-[10px] font-medium ${statusChip(row.status)}`}>{row.status || "—"}</span>
                          </td>
                        </>
                      )

                      if (row.requests.length === 0) {
                        return [(
                          <tr key={row.serialNo} className={`border-b border-gray-100 dark:border-white/5 ${baseRow}`}>
                            {stockCells}
                            {/* Group 2 first cell gets left border */}
                            <td className={tdGroup + " text-gray-300 dark:text-gray-600"}>—</td>
                            {Array.from({ length: 15 }).map((_, i) => (
                              <td key={i} className="px-2 py-1 text-[11px] text-gray-300 dark:text-gray-600">—</td>
                            ))}
                          </tr>
                        )]
                      }

                      return row.requests.map((rq, qi) => (
                        <tr key={`${row.serialNo}-${qi}`} className={`border-b border-gray-100 dark:border-white/5 ${baseRow}`}>
                          {stockCells}
                          {/* Group 2: คำขอ — first cell gets left border */}
                          <td className={tdGroup + " font-mono font-semibold text-gray-900 dark:text-white"}>
                            <div>{rq.plate}</div>
                            {mrStatusMap[rq.plate] && (() => {
                              const { label, cls } = mrChip(mrStatusMap[rq.plate].status)
                              return (
                                <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[9px] font-medium ${cls}`}>
                                  MR · {label}
                                </span>
                              )
                            })()}
                          </td>
                          <td className={td0}>{rq.truckNumber || "—"}</td>
                          <td className={td0}>{rq.driverName || "—"}</td>
                          <td className={td0}>{[rq.fleet, rq.plant].filter(Boolean).join("/") || "—"}</td>
                          <td className={td0 + " text-right"}>{fmtInt(rq.currentOdometer)}</td>
                          {/* Group 3: ยาง — first cell gets left border */}
                          <td className={tdGroup + " font-mono font-semibold"}>{rq.positionCode || "—"}</td>
                          <td className={td0}>{rq.positionName || "—"}</td>
                          <td className={td0 + " font-medium"}>{rq.reason || "—"}</td>
                          <td className={td0 + " text-right"}>{rq.currentTreadMm || "—"}</td>
                          <td className={td0 + " text-right"}>{fmtInt(rq.mileageStart)}</td>
                          {/* Group 4: ผลลัพธ์ — first cell gets left border */}
                          <td className={tdGroup + " text-right font-semibold"}>{rq.usedDistance > 0 ? fmtInt(rq.usedDistance) : "—"}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {rq.remainingPct !== null ? (
                              <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${rq.remainingPct <= 20 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : rq.remainingPct <= 50 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"}`}>{rq.remainingPct}%</span>
                            ) : "—"}
                          </td>
                          <td className="px-2 py-1 text-[11px] text-right whitespace-nowrap">
                            <div className="text-gray-400 text-[10px]">{rq.bahtPerKmStock !== null ? rq.bahtPerKmStock.toFixed(4) : "—"}</div>
                            <div className={`font-semibold ${rq.bahtPerKm !== null && rq.bahtPerKmStock !== null && rq.bahtPerKm > rq.bahtPerKmStock ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                              {rq.bahtPerKm !== null ? rq.bahtPerKm.toFixed(4) : "—"}
                            </div>
                          </td>
                          {/* Group 5: หลักฐาน — first cell gets left border */}
                          <td className="px-2 py-1 whitespace-nowrap border-l-2 border-gray-100 dark:border-white/5">
                            <div className="flex flex-col gap-1">
                              {rq.photoUrls.length > 0 && (
                                <div className="flex gap-1">
                                  {rq.photoUrls.map((u, ui) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={ui} src={u} alt="" onClick={() => window.open(u, "_blank")}
                                      className="h-7 w-7 cursor-zoom-in rounded object-cover ring-1 ring-gray-200 dark:ring-white/10" />
                                  ))}
                                </div>
                              )}
                              {rq.odometerPhotoUrl && (
                                <div className="flex items-center gap-1">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={rq.odometerPhotoUrl} alt="เลขไมล์" onClick={() => window.open(rq.odometerPhotoUrl, "_blank")}
                                    className="h-7 w-7 cursor-zoom-in rounded object-cover ring-1 ring-blue-200 dark:ring-blue-700" />
                                  <span className="text-[9px] text-blue-500 dark:text-blue-400">ไมล์</span>
                                </div>
                              )}
                              {rq.photoUrls.length === 0 && !rq.odometerPhotoUrl && (
                                <span className="text-[11px] text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                          <td className={td0 + " text-gray-400"}>{fmtDate(rq.itemCreatedAt)}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <span className={`inline-block rounded px-1.5 py-px text-[10px] font-medium ${statusChip(rq.itemStatus)}`}>{rq.itemStatus}</span>
                          </td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* ── Performance tab ── */}
      {mode === "performance" && (
        <div>
          {perfLoading ? (
            <p className="text-sm text-gray-400 py-10 text-center">กำลังโหลด...</p>
          ) : perfGroups.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">ไม่พบข้อมูลยาง</p>
          ) : (() => {
            const totalTires   = perfGroups.reduce((s, g) => s + g.count, 0)
            const totalIssued  = perfGroups.reduce((s, g) => s + g.countIssued, 0)
            const groupsWithBpk = perfGroups.filter((g) => g.avgBahtPerKm !== null)
            const overBudget   = groupsWithBpk.filter((g) => (g.costVariance ?? 0) > 0)
            const underBudget  = groupsWithBpk.filter((g) => (g.costVariance ?? 0) <= 0)
            const overallAvgBpk = groupsWithBpk.length
              ? groupsWithBpk.reduce((s, g) => s + (g.avgBahtPerKm ?? 0), 0) / groupsWithBpk.length
              : null
            const overallStdBpk = groupsWithBpk.length
              ? groupsWithBpk.reduce((s, g) => s + (g.avgStdBahtPerKm ?? 0), 0) / groupsWithBpk.length
              : null

            return (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                    <p className="text-[11px] text-gray-400 mb-1">ยางทั้งหมด</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{totalTires}<span className="text-xs font-normal text-gray-400 ml-1">เส้น</span></p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-white/8 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${totalTires ? (totalIssued / totalTires) * 100 : 0}%` }} />
                      </div>
                      <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">{totalIssued} มีข้อมูล</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                    <p className="text-[11px] text-gray-400 mb-1">รุ่นยางในระบบ</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{perfGroups.length}<span className="text-xs font-normal text-gray-400 ml-1">รุ่น</span></p>
                    <p className="text-[11px] text-gray-400 mt-1">{groupsWithBpk.length} รุ่นมีข้อมูล ฿/กม.</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                    <p className="text-[11px] text-gray-400 mb-1">฿/กม. เฉลี่ย (จริง)</p>
                    <p className={`text-xl font-bold ${overallAvgBpk !== null && overallStdBpk !== null && overallAvgBpk > overallStdBpk ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                      {overallAvgBpk !== null ? overallAvgBpk.toFixed(4) : "—"}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">มาตรฐาน {overallStdBpk !== null ? overallStdBpk.toFixed(4) : "—"}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                    <p className="text-[11px] text-gray-400 mb-1">งบประมาณ</p>
                    <div className="flex items-end gap-2 mt-1">
                      {overBudget.length > 0 && (
                        <div>
                          <p className="text-xl font-bold text-red-600 dark:text-red-400">{overBudget.length}</p>
                          <p className="text-[11px] text-red-500">รุ่นเกินงบ</p>
                        </div>
                      )}
                      {underBudget.length > 0 && (
                        <div>
                          <p className="text-xl font-bold text-green-600 dark:text-green-400">{underBudget.length}</p>
                          <p className="text-[11px] text-green-500">รุ่นในงบ</p>
                        </div>
                      )}
                      {groupsWithBpk.length === 0 && <p className="text-sm text-gray-400">—</p>}
                    </div>
                  </div>
                </div>

                {/* Performance table */}
                <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                          <th className={th + " w-8"}></th>
                          <th className={th}>ยี่ห้อ</th>
                          <th className={th}>ขนาด</th>
                          <th className={th}>รุ่น</th>
                          <th className={th + " text-right"}>ระยะมาตรฐาน</th>
                          <th className={th + " text-right"}>เฉลี่ยใช้งาน</th>
                          <th className={th + " text-right"}>ประสิทธิภาพ</th>
                          <th className={th + " text-right"}>฿/กม. มาตรฐาน</th>
                          <th className={th + " text-right"}>฿/กม. จริง</th>
                          <th className={th + " text-right"}>ผลต่าง</th>
                          <th className={th + " text-center"}>เส้น</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perfGroups.map((g, gi) => {
                          const key = `${g.brand}||${g.tireSize}||${g.tireModel}`
                          const isExpanded = expandedGroup === key
                          const isOver = (g.costVariance ?? 0) > 0 && g.costVariance !== null
                          const isUnder = g.costVariance !== null && (g.costVariance ?? 0) <= 0
                          const effPct = g.stdDistance > 0 && g.avgUsedDistance
                            ? Math.round((g.avgUsedDistance / g.stdDistance) * 100)
                            : null

                          return [
                            <tr
                              key={key}
                              onClick={() => setExpandedGroup(isExpanded ? null : key)}
                              className={`border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${gi % 2 === 1 ? "bg-gray-50/40 dark:bg-white/1" : ""} ${isExpanded ? "bg-blue-50/60 dark:bg-blue-900/10" : ""}`}
                            >
                              <td className="px-2 py-2 text-center text-gray-400">
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </td>
                              <td className="px-2 py-2 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">{g.brand || "—"}</td>
                              <td className="px-2 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{g.tireSize || "—"}</td>
                              <td className="px-2 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{g.tireModel || "—"}</td>
                              <td className="px-2 py-2 text-sm text-right whitespace-nowrap text-gray-500">{fmtInt(g.stdDistance)} <span className="text-[10px]">กม.</span></td>
                              <td className="px-2 py-2 text-sm text-right whitespace-nowrap font-medium text-gray-900 dark:text-white">
                                {g.avgUsedDistance !== null ? fmtInt(g.avgUsedDistance) : "—"}
                                {g.avgUsedDistance !== null && <span className="text-[10px] text-gray-400 ml-1">กม.</span>}
                              </td>
                              <td className="px-2 py-2 text-right whitespace-nowrap">
                                {effPct !== null ? (
                                  <span className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold ${effPct >= 90 ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" : effPct >= 70 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"}`}>
                                    {effPct}%
                                  </span>
                                ) : <span className="text-gray-400 text-xs">—</span>}
                              </td>
                              <td className="px-2 py-2 text-sm text-right whitespace-nowrap text-gray-500 font-mono">
                                {g.avgStdBahtPerKm !== null ? g.avgStdBahtPerKm.toFixed(4) : "—"}
                              </td>
                              <td className={`px-2 py-2 text-sm text-right whitespace-nowrap font-mono font-semibold ${isOver ? "text-red-600 dark:text-red-400" : isUnder ? "text-green-600 dark:text-green-400" : "text-gray-900 dark:text-white"}`}>
                                {g.avgBahtPerKm !== null ? g.avgBahtPerKm.toFixed(4) : "—"}
                              </td>
                              <td className="px-2 py-2 text-right whitespace-nowrap">
                                {g.costVariance !== null ? (
                                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isOver ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                                    {isOver ? "↑" : "↓"} {Math.abs(g.costVariance).toFixed(4)}
                                  </span>
                                ) : <span className="text-gray-400 text-xs">—</span>}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">{g.countIssued}</span>
                                <span className="text-[10px] text-gray-400">/{g.count}</span>
                              </td>
                            </tr>,

                            // expanded individual tires
                            isExpanded && (
                              <tr key={key + "-detail"} className="border-b border-gray-100 dark:border-white/5">
                                <td colSpan={11} className="px-0 py-0 bg-blue-50/30 dark:bg-blue-900/5">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-blue-100 dark:border-white/5">
                                          <th className="pl-8 pr-2 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Serial No</th>
                                          <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                                          <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ทะเบียน</th>
                                          <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">สาเหตุ</th>
                                          <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ราคา</th>
                                          <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ใช้งาน (กม.)</th>
                                          <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">เหลือ%</th>
                                          <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">฿/กม. มาตรฐาน</th>
                                          <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider">฿/กม. จริง</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.tires.map((t) => {
                                          const tireOver = t.bahtPerKm !== null && t.stdBahtPerKm !== null && t.bahtPerKm > t.stdBahtPerKm
                                          return (
                                            <tr key={t.serialNo} className="border-b border-blue-50 dark:border-white/3 last:border-0">
                                              <td className="pl-8 pr-2 py-1.5 font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">{t.serialNo}</td>
                                              <td className="px-2 py-1.5 whitespace-nowrap">
                                                <span className={`inline-block rounded px-1.5 py-px text-[10px] font-medium ${statusChip(t.status)}`}>{t.status || "—"}</span>
                                              </td>
                                              <td className="px-2 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.plate || "—"}</td>
                                              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.reason || "—"}</td>
                                              <td className="px-2 py-1.5 text-right text-gray-500 whitespace-nowrap">{fmtNum(t.unitPrice)}</td>
                                              <td className="px-2 py-1.5 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                {t.usedDistance !== null ? fmtInt(t.usedDistance) : "—"}
                                              </td>
                                              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                {t.remainingPct !== null ? (
                                                  <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${t.remainingPct <= 20 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : t.remainingPct <= 50 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"}`}>
                                                    {t.remainingPct}%
                                                  </span>
                                                ) : "—"}
                                              </td>
                                              <td className="px-2 py-1.5 text-right font-mono text-gray-500 whitespace-nowrap">{t.stdBahtPerKm !== null ? t.stdBahtPerKm.toFixed(4) : "—"}</td>
                                              <td className={`px-2 py-1.5 text-right font-mono font-semibold whitespace-nowrap ${tireOver ? "text-red-600 dark:text-red-400" : t.bahtPerKm !== null ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}>
                                                {t.bahtPerKm !== null ? t.bahtPerKm.toFixed(4) : "—"}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            ),
                          ]
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}


      {/* ── Stock view ── */}
      {mode === "stock" && <>

      {/* Controls */}
      <div className="space-y-2 mb-4">
        {/* Row 1: search + status + actions */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา Serial / สินค้า / ยี่ห้อ..." className={inp + " pl-8"} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inp + " max-w-[160px]"}>
            <option value="">— ทุกสถานะ —</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={exportToExcel}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40 transition-colors"
          >
            <Download size={14} />
            Excel
          </button>
          <Link
            href={`/tire/${branch}/stock-tire/new`}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            เพิ่ม
          </Link>
        </div>
        {/* Row 2: PR Code + Deposit Date range */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative min-w-[160px] max-w-[200px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-400 select-none pointer-events-none">PR</span>
            <input value={prFilter} onChange={(e) => setPrFilter(e.target.value)} placeholder="กรอง PR Code..." className={inp + " pl-7"} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-400 whitespace-nowrap">Deposit Date</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inp + " max-w-[140px]"} />
            <span className="text-[11px] text-gray-400">ถึง</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inp + " max-w-[140px]"} />
            {(prFilter || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setPrFilter(""); setDateFrom(""); setDateTo("") }}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-gray-500 hover:text-gray-800 dark:hover:text-white border border-gray-200 dark:border-white/10 transition-colors"
              >
                <X size={11} /> ล้าง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Summary cards ── */}
      {!loading && items.length > 0 && (() => {
        const totalVal  = items.reduce((s, t) => s + (t.unitPrice || 0), 0)
        const inStockItems = items.filter(t => t.status === "In Stock")
        const inStockVal   = inStockItems.reduce((s, t) => s + (t.unitPrice || 0), 0)
        const statusCounts = STATUS_OPTIONS.map(s => ({ label: s, count: items.filter(t => t.status === s).length }))
        return (
          <div className="mb-4 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* ยางทั้งหมด */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">ยางทั้งหมด</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{items.length.toLocaleString("th-TH")}<span className="text-xs font-normal text-gray-400 ml-1">เส้น</span></p>
                <div className="mt-1.5 flex gap-1 flex-wrap">
                  {statusCounts.filter(s => s.count > 0).map(s => (
                    <span key={s.label} className={`inline-block rounded px-1.5 py-px text-[10px] font-medium ${statusChip(s.label)}`}>{s.label} {s.count}</span>
                  ))}
                </div>
              </div>
              {/* In Stock */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">In Stock</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{inStockItems.length.toLocaleString("th-TH")}<span className="text-xs font-normal text-gray-400 ml-1">เส้น</span></p>
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-white/8 overflow-hidden">
                    <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${items.length ? (inStockItems.length / items.length) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-500">{items.length ? Math.round((inStockItems.length / items.length) * 100) : 0}%</span>
                </div>
              </div>
              {/* มูลค่ารวม */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">มูลค่ารวม</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">฿{totalVal.toLocaleString("th-TH", { maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">เฉลี่ย ฿{items.length ? Math.round(totalVal / items.length).toLocaleString("th-TH") : "—"}/เส้น</p>
              </div>
              {/* มูลค่า In Stock */}
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-3 py-3">
                <p className="text-[11px] text-gray-400 mb-1">มูลค่า In Stock</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">฿{inStockVal.toLocaleString("th-TH", { maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-gray-400 mt-1">{totalVal ? Math.round((inStockVal / totalVal) * 100) : 0}% ของมูลค่าทั้งหมด</p>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>PR Code</th>
                <th className={th}>DD Code</th>
                <th className={th}>Deposit Date</th>
                <th className={th}>รหัสสินค้า</th>
                <th className={th}>ชื่อสินค้า</th>
                <th className={th}>Serial No</th>
                <th className={th + " text-right"}>Unit Price</th>
                <th className={th}>ยี่ห้อ</th>
                <th className={th}>ขนาดยาง</th>
                <th className={th}>รุ่นยาง</th>
                <th className={th + " text-right"}>ระยะทาง</th>
                <th className={th}>Status</th>
                <th className={th}>ประเภทยาง</th>
                <th className={th}>วันหมดประกัน</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบรายการ</td></tr>
              ) : items.map((t, i) => (
                <tr
                  key={t._id}
                  className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}
                >
                  {editId === t._id ? (
                    <td colSpan={15} className="px-3 py-3">
                      <form onSubmit={handleEdit}>
                        {formFields}
                        <div className="flex gap-2 mt-3">
                          <button type="submit" disabled={saving} className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50">
                            {saving ? "บันทึก..." : "บันทึก"}
                          </button>
                          <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
                            ยกเลิก
                          </button>
                        </div>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.prCode || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.ddCode || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.depositDate || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.productCode || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.productName || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">{t.serialNo || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 text-right whitespace-nowrap">{fmtNum(t.unitPrice)}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.brand || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.tireSize || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.tireModel || "—"}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-900 dark:text-white text-right whitespace-nowrap">{fmtInt(t.distance)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(t.status)}`}>
                          {t.status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.tireType || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.warrantyUntil || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(t)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(t)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </div>
  )
}
