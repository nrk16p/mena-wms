"use client"

import { useState, useEffect, useMemo } from "react"
import { TrendingUp, AlertTriangle, CheckCircle, Download, Search, RefreshCw, Loader2, Copy, ClipboardCheck, FileSpreadsheet } from "lucide-react"
import * as XLSX from "xlsx"

type TireRecord = {
  _id: string
  vehicle: string
  tirePosition: string
  serialNo: string
  product: string
  mileageStart: number
  changeIn: string | null
  changeOut: string | null
  isLatest: boolean
  sellRepairStatus: string
}

type MonthlyDist = { month_year: string; total_distance: number }

type RowData = TireRecord & {
  totalDistance: number | null
  estimatedOdo: number | null
  threshold: number | null
  status: "ok" | "warn" | "no-date" | "loading" | "error" | "idle"
}

type Phase = "idle" | "loading-tires" | "loading-distances" | "done"

const INTEL_API  = "/api/truck-distance"
const TODAY_MONTH = new Date().toISOString().slice(0, 7)
const NEAR_PCT   = 0.9   // show tires at ≥ 90 % of threshold

function getTireThreshold(position: string): number {
  return (position ?? "").trim().toUpperCase().startsWith("F") ? 20_000 : 40_000
}

function toYYYYMM(dateStr: string | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 7)
}

function sumFrom(monthly: MonthlyDist[], fromMonth: string): number {
  return monthly
    .filter(m => m.month_year >= fromMonth)
    .reduce((s, m) => s + (m.total_distance ?? 0), 0)
}

function applyDist(prev: RowData[], distMap: Map<string, MonthlyDist[] | null>): RowData[] {
  return prev.map(r => {
    const threshold = r.threshold ?? getTireThreshold(r.tirePosition ?? "")
    if (!r.changeIn) return { ...r, threshold, status: "no-date" }
    const startMonth = toYYYYMM(r.changeIn)
    if (!startMonth) return { ...r, threshold, status: "no-date" }
    const monthly = distMap.get(r.vehicle)
    if (monthly === undefined) return r                     // batch not yet done
    if (monthly === null)      return { ...r, threshold, status: "error" }
    if (monthly.length === 0)  return { ...r, totalDistance: 0, estimatedOdo: r.mileageStart, threshold, status: "ok" }
    const totalDistance = sumFrom(monthly, startMonth)
    const estimatedOdo  = r.mileageStart + totalDistance
    const status: RowData["status"] = totalDistance >= threshold ? "warn" : "ok"
    return { ...r, totalDistance, estimatedOdo, threshold, status }
  })
}

const fmtNum  = (n: number | null) => n == null ? "—" : n.toLocaleString("th-TH")
const fmtDate = (s: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function StatusChip({ r }: { r: RowData }) {
  if (r.status === "loading") return <span className="text-[10px] text-gray-400 animate-pulse">…</span>
  if (r.status === "error")   return <span className="text-[10px] text-red-400">Error</span>
  if (r.status === "no-date") return <span className="text-[10px] text-gray-400">ไม่มีวันเปลี่ยนเข้า</span>
  if (r.status === "idle")    return <span className="text-[10px] text-gray-300">—</span>
  if (r.totalDistance == null) return null

  if (r.status === "warn") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
        <AlertTriangle size={10} /> ถึงเวลาเปลี่ยน
      </span>
    )
  }

  const pct      = r.threshold ? Math.min((r.totalDistance / r.threshold) * 100, 100) : 0
  const barColor = pct >= 80 ? "bg-amber-400" : pct >= 60 ? "bg-yellow-400" : "bg-green-500"
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-gray-400">{Math.round(pct)}%</span>
      <CheckCircle size={10} className="text-green-500 shrink-0" />
    </div>
  )
}

export function TireMileageComparePage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const [rows,         setRows]         = useState<RowData[]>([])
  const [totalTires,   setTotalTires]   = useState(0)
  const [phase,        setPhase]        = useState<Phase>("idle")
  const [tiresLoaded,  setTiresLoaded]  = useState(0)
  const [distDone,     setDistDone]     = useState(0)
  const [distTotal,    setDistTotal]    = useState(0)
  const [plateQ,       setPlateQ]       = useState("")   // filter by vehicle plate
  const [q,            setQ]            = useState("")   // filter by serial/position
  const [copied,       setCopied]       = useState(false)
  const [vehicleMode,  setVehicleMode]  = useState(false) // show ALL tires of qualifying vehicles
  const [pgNum,        setPgNum]        = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { autoLoad() }, [branch]) // eslint-disable-line react-hooks/exhaustive-deps

  async function autoLoad() {
    setPhase("loading-tires")
    setRows([])
    setTiresLoaded(0)
    setDistDone(0)
    setDistTotal(0)

    // ── 1. Fetch all tire pages in parallel ─────────────────────────────
    const base = `/api/tire-change?branch=${branch}&sellRepair=อื่นๆ&latest=yes&limit=500`
    const first = await fetch(`${base}&page=1`)
    const firstData = await first.json()
    const totalPages = firstData.pages ?? 1
    setTotalTires(firstData.total ?? 0)

    let allItems: TireRecord[] = [...(firstData.items ?? [])]
    setTiresLoaded(allItems.length)

    if (totalPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          fetch(`${base}&page=${i + 2}`).then(r => r.json())
        )
      )
      for (const d of rest) {
        allItems = [...allItems, ...(d.items ?? [])]
      }
      setTiresLoaded(allItems.length)
    }

    // Deduplicate: same serial + position + changeIn = same physical tire stored twice
    const seen = new Set<string>()
    allItems = allItems.filter(r => {
      const key = `${r.serialNo}|${r.tirePosition}|${r.changeIn}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const rowData: RowData[] = allItems.map(r => ({
      ...r,
      totalDistance: null,
      estimatedOdo:  null,
      threshold:     getTireThreshold(r.tirePosition ?? ""),
      status:        r.changeIn ? "loading" : "no-date",
    }))
    setRows(rowData)

    // ── 2. Fetch distances per plate ────────────────────────────────────
    setPhase("loading-distances")

    const plateMap = new Map<string, string>()
    for (const r of rowData) {
      if (!r.changeIn) continue
      const m = toYYYYMM(r.changeIn)
      if (!m) continue
      const cur = plateMap.get(r.vehicle)
      if (!cur || m < cur) plateMap.set(r.vehicle, m)
    }

    // Skip plates whose earliest tire was installed this month (can't reach 90% threshold yet)
    const plates = [...plateMap.entries()]
      .filter(([, startMonth]) => startMonth < TODAY_MONTH)
      .map(([plate]) => plate)
    setDistTotal(plates.length)

    const distMap = new Map<string, MonthlyDist[] | null>()
    const BATCH = 15
    let done = 0

    for (let i = 0; i < plates.length; i += BATCH) {
      const batch = plates.slice(i, i + BATCH)
      await Promise.all(batch.map(async plate => {
        const startMonth = plateMap.get(plate)!
        try {
          const url = `${INTEL_API}?plate=${encodeURIComponent(plate)}&startMonth=${startMonth}&endMonth=${TODAY_MONTH}`
          const res = await fetch(url)
          if (!res.ok) { distMap.set(plate, null); return }
          const data = await res.json()
          distMap.set(plate, Array.isArray(data) ? data : [])
        } catch {
          distMap.set(plate, null)
        }
      }))
      done += batch.length
      setDistDone(done)
      setRows(prev => applyDist(prev, distMap))
    }

    setPhase("done")
  }

  // ── Derived / filtered data ────────────────────────────────────────────
  // All unique plates (for datalist autocomplete)
  const allPlates = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.vehicle) set.add(r.vehicle)
    return [...set].sort()
  }, [rows])

  // Plates that have ≥ 1 tire at ≥ 90 % or due
  const qualifiedPlates = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (!r.vehicle) continue
      if (r.status === "warn") { set.add(r.vehicle); continue }
      if (r.totalDistance != null && r.threshold != null && r.totalDistance >= r.threshold * NEAR_PCT)
        set.add(r.vehicle)
    }
    return set
  }, [rows])

  // Plates with at least one tire due for change
  const duePlates = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.status === "warn" && r.vehicle) set.add(r.vehicle)
    return [...set].sort()
  }, [rows])

  async function copyDuePlates() {
    await navigator.clipboard.writeText(duePlates.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredRows = useMemo(() => {
    const plateFilter = plateQ.trim().toLowerCase()
    const kwFilter    = q.trim().toLowerCase()

    // Plate search overrides everything — show ALL tires for that vehicle
    if (plateFilter) {
      return rows.filter(r => (r.vehicle ?? "").toLowerCase().includes(plateFilter))
    }

    let base: RowData[]
    if (vehicleMode) {
      // Show ALL tires of vehicles that have ≥ 1 tire at ≥ 90 % or due
      base = rows.filter(r => r.vehicle && qualifiedPlates.has(r.vehicle))
    } else {
      // Default: show only individual tires ≥ 90 % of threshold
      base = rows.filter(r =>
        r.totalDistance != null &&
        r.threshold     != null &&
        r.totalDistance >= r.threshold * NEAR_PCT
      )
    }

    if (!kwFilter) return base
    return base.filter(r =>
      (r.serialNo     ?? "").toLowerCase().includes(kwFilter) ||
      (r.tirePosition ?? "").toLowerCase().includes(kwFilter)
    )
  }, [rows, plateQ, q, vehicleMode, qualifiedPlates])

  const sortedRows = useMemo(() => {
    setPgNum(1)
    return [...filteredRows].sort((a, b) => (a.vehicle ?? "").localeCompare(b.vehicle ?? "", "th"))
  }, [filteredRows])

  const totalPages2 = Math.ceil(sortedRows.length / PAGE_SIZE)
  const pagedRows   = sortedRows.slice((pgNum - 1) * PAGE_SIZE, pgNum * PAGE_SIZE)

  function exportExcel() {
    const data = sortedRows.map((r, i) => ({
      "#":                    i + 1,
      "ยานพาหนะ":             r.vehicle ?? "",
      "ตำแหน่งยาง":          r.tirePosition ?? "",
      "Serial No":            r.serialNo ?? "",
      "สินค้า":               r.product ?? "",
      "ไมล์เริ่มต้น":        r.mileageStart ?? 0,
      "เปลี่ยนเข้า":         fmtDate(r.changeIn),
      "Start Month":          toYYYYMM(r.changeIn) ?? "",
      "Total Distance (km)":  r.totalDistance ?? "",
      "ขีดจำกัด (km)":       r.threshold ?? "",
      "ประมาณไมล์ปัจจุบัน": r.estimatedOdo ?? "",
      "สถานะ":                r.status === "warn" ? "ถึงเวลาเปลี่ยน" : r.status === "ok" ? "ปกติ" : r.status,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Tire Mileage")
    XLSX.writeFile(wb, `tire-mileage-${branch}-${TODAY_MONTH}.xlsx`)
  }

  // ── Counts (always from full dataset, not filtered view) ──────────────
  const allDue  = useMemo(() => rows.filter(r => r.status === "warn").length, [rows])
  const allNear = useMemo(() => rows.filter(r =>
    r.status === "ok" && r.totalDistance != null && r.threshold != null &&
    r.totalDistance >= r.threshold * NEAR_PCT
  ).length, [rows])
  const isDone    = phase === "done"

  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
  const td = "px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap"

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TrendingUp size={20} className="text-gray-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white leading-none">
              ตรวจสอบสถานะยางติดรถ — {branchLabel}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              ส่ง ขาย / ซ่อม = <span className="font-semibold text-amber-600 dark:text-amber-400">อื่นๆ</span>
              {" · "}แสดงยางที่ใกล้ถึงกำหนดเปลี่ยน (≥ 90% ของระยะ)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDone && sortedRows.length > 0 && (
            <button onClick={exportExcel} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <FileSpreadsheet size={13} /> Export Excel
            </button>
          )}
          <button
            onClick={autoLoad}
            disabled={phase !== "done" && phase !== "idle"}
            className="flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] text-white px-3.5 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <RefreshCw size={14} className={phase !== "done" && phase !== "idle" ? "animate-spin" : ""} />
            รีเฟรช
          </button>
        </div>
      </div>

      {/* ── Loading progress ── */}
      {(phase === "loading-tires" || phase === "loading-distances") && (
        <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="animate-spin text-blue-500" />
            {phase === "loading-tires" ? (
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                กำลังโหลดข้อมูลยาง… {tiresLoaded.toLocaleString()} / {totalTires.toLocaleString()} เส้น
              </span>
            ) : (
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                กำลังดึงระยะทาง… {distDone} / {distTotal} คัน
              </span>
            )}
          </div>
          <div className="h-1.5 w-full rounded-full bg-blue-200 dark:bg-blue-800/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{
                width: phase === "loading-tires"
                  ? `${totalTires ? (tiresLoaded / totalTires) * 100 : 0}%`
                  : `${distTotal ? (distDone / distTotal) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ── Filters (only when data is loading distances or done) ── */}
      {(isDone || phase === "loading-distances") && (
        <div className="flex flex-wrap gap-3 mb-4">
          {/* Vehicle plate filter — primary */}
          <div className="relative min-w-[220px] flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              list="plate-list"
              value={plateQ}
              onChange={e => { setPlateQ(e.target.value); setQ("") }}
              placeholder="กรอกทะเบียน เช่น สบ.71-1234"
              className="w-full pl-8 pr-8 py-2 text-sm border-2 border-[#1B8C4B]/40 dark:border-[#1B8C4B]/30 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-[#1B8C4B] dark:focus:border-[#1B8C4B]"
            />
            {plateQ && (
              <button
                onClick={() => setPlateQ("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white text-lg leading-none"
              >×</button>
            )}
            <datalist id="plate-list">
              {allPlates.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>

          {/* Vehicle mode toggle */}
          {!plateQ && (
            <button
              onClick={() => setVehicleMode(v => !v)}
              className={[
                "shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-all",
                vehicleMode
                  ? "border-[#1B8C4B] bg-[#1B8C4B] text-white"
                  : "border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5",
              ].join(" ")}
            >
              เฉพาะใกล้เปลี่ยนยาง
            </button>
          )}

          {/* Keyword filter — secondary (only when no plate selected) */}
          {!plateQ && (
            <div className="relative min-w-[180px] flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="ตำแหน่ง / Serial…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-white/20"
              />
            </div>
          )}

          {plateQ && (
            <div className="flex items-center gap-1.5 rounded-lg bg-[#1B8C4B]/10 border border-[#1B8C4B]/30 px-3 py-2 text-xs font-medium text-[#1B8C4B] dark:text-green-400">
              แสดงยางทั้งหมดของ <span className="font-mono font-bold">{plateQ}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Due-plate summary banner ── */}
      {isDone && duePlates.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 px-4 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-300">
                {duePlates.length} ทะเบียน ถึงเวลาเปลี่ยนยาง
              </p>
              <p className="text-[11px] text-red-500 dark:text-red-400 mt-0.5 font-mono leading-relaxed">
                {duePlates.slice(0, 8).join(" · ")}
                {duePlates.length > 8 && <span className="text-red-400"> +{duePlates.length - 8} คัน</span>}
              </p>
            </div>
          </div>
          <button
            onClick={copyDuePlates}
            className={[
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
              copied
                ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60",
            ].join(" ")}
          >
            {copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
            {copied ? "คัดลอกแล้ว!" : "คัดลอกทะเบียน"}
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      {isDone && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "สแกนยางทั้งหมด",       value: totalTires.toLocaleString(),      color: "text-gray-500 dark:text-gray-400" },
            { label: "ยานพาหนะที่พบ",         value: allPlates.length.toLocaleString(), color: "text-gray-900 dark:text-white" },
            { label: "ใกล้ถึงกำหนด (≥90%)",  value: allNear.toLocaleString(),          color: "text-amber-600 dark:text-amber-400" },
            { label: "ถึงเวลาเปลี่ยนแล้ว",   value: allDue.toLocaleString(),           color: "text-red-600 dark:text-red-400" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-3">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {(isDone || phase === "loading-distances") && (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                  <th className={th}>ยานพาหนะ</th>
                  <th className={th}>#</th>
                  <th className={th}>ตำแหน่งยาง</th>
                  <th className={th}>Serial No</th>
                  <th className={th}>สินค้า</th>
                  <th className={th + " text-right"}>ไมล์เริ่มต้น</th>
                  <th className={th}>เปลี่ยนเข้า</th>
                  <th className={th}>Start Month</th>
                  <th className={th + " text-right"}>Total Distance (km)</th>
                  <th className={th + " text-right"}>ประมาณไมล์ปัจจุบัน</th>
                  <th className={th}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && isDone ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-sm text-gray-400">
                      {plateQ
                        ? `ไม่พบยางสำหรับทะเบียน "${plateQ}"`
                        : "ไม่มียางที่ใกล้ถึงกำหนดเปลี่ยน (ระยะ < 80% ของขีดจำกัด)"}
                    </td>
                  </tr>
                ) : pagedRows.map((r, i) => {
                  const globalIdx = (pgNum - 1) * PAGE_SIZE + i + 1
                  const rowBg = r.status === "warn"
                    ? "bg-red-50/40 dark:bg-red-950/10"
                    : i % 2 === 1 ? "bg-gray-50/30 dark:bg-white/[0.01]" : ""
                  const startMonth = toYYYYMM(r.changeIn)
                  return (
                    <tr key={r._id} className={`border-b border-gray-100 dark:border-white/5 ${rowBg}`}>
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-xs text-gray-900 dark:text-white">{r.vehicle || "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-gray-400 tabular-nums">{globalIdx}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{r.tirePosition || "—"}</td>
                      <td className={td + " font-mono text-[11px]"}>{r.serialNo || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-[140px] truncate">{r.product || "—"}</td>
                      <td className={td + " text-right tabular-nums font-medium text-gray-900 dark:text-white"}>
                        {fmtNum(r.mileageStart)}
                      </td>
                      <td className={td}>{fmtDate(r.changeIn)}</td>
                      <td className="px-3 py-2">
                        {startMonth
                          ? <span className="inline-block rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-[11px] font-mono">{startMonth}</span>
                          : <span className="text-xs text-gray-400">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status === "loading" ? (
                          <span className="text-[11px] text-gray-400 animate-pulse">…</span>
                        ) : r.totalDistance != null ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`tabular-nums font-semibold text-xs ${r.status === "warn" ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                              {fmtNum(r.totalDistance)}
                            </span>
                            {r.threshold != null && (
                              <span className="text-[10px] text-gray-400 tabular-nums">/ {r.threshold.toLocaleString()}</span>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.estimatedOdo != null
                          ? <span className="tabular-nums text-xs text-gray-700 dark:text-gray-300">{fmtNum(r.estimatedOdo)}</span>
                          : "—"}
                      </td>
                      <td className="px-3 py-2"><StatusChip r={r} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {totalPages2 > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-white/8 px-4 py-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                หน้า {pgNum} / {totalPages2} · แสดง {((pgNum - 1) * PAGE_SIZE) + 1}–{Math.min(pgNum * PAGE_SIZE, sortedRows.length)} จาก {sortedRows.length.toLocaleString()} รายการ
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPgNum(1)}       disabled={pgNum === 1}           className="rounded-lg border border-gray-200 dark:border-white/10 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">«</button>
                <button onClick={() => setPgNum(p => p - 1)} disabled={pgNum === 1}        className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">‹ ก่อนหน้า</button>
                <span className="px-2 text-xs font-semibold text-gray-700 dark:text-gray-300">{pgNum}</span>
                <button onClick={() => setPgNum(p => p + 1)} disabled={pgNum === totalPages2} className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">ถัดไป ›</button>
                <button onClick={() => setPgNum(totalPages2)} disabled={pgNum === totalPages2} className="rounded-lg border border-gray-200 dark:border-white/10 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-white/5">»</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      {isDone && (
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-500 dark:text-gray-400">
          <span><span className="font-semibold text-gray-700 dark:text-gray-300">ยางหน้า (F1/F2)</span> ครบ 20,000 km</span>
          <span><span className="font-semibold text-gray-700 dark:text-gray-300">ยางหลัง (RA1–8)</span> ครบ 40,000 km</span>
          <span><span className="font-semibold text-gray-700 dark:text-gray-300">Total Distance</span> = ระยะทางจาก Start Month ({TODAY_MONTH})</span>
          <span className="flex items-center gap-1">
            <AlertTriangle size={10} className="text-red-500" /> ถึงเวลาเปลี่ยน = total ≥ ขีดจำกัด
          </span>
        </div>
      )}
    </div>
  )
}
