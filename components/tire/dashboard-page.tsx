"use client"

// ===========================================================================
// Dashboard ยาง — ภาพรวมยางที่อยู่บนรถตอนนี้ทุกเส้น อ่านแบบ Excel
// ===========================================================================
// โครงเดียวกับรายงานที่ฝ่ายจัดซื้อ/ช่างทำเองใน Excel:
//   Slicer ด้านบน (เลือกได้หลายรายการ ทุกกล่องกรองกันไขว้) → ตัวเลขสรุป → Pivot → ตารางรายเส้น
// ข้อมูลมาจาก /api/tire-dashboard ก้อนเดียว (ยางทุกเส้น ไม่รวมยางอะไหล่) แล้วกรอง/สรุปบนเครื่อง
// ตัวเลขชุดเดียวกับแท็บ "ยางถึงกำหนดเปลี่ยน" และแอปคนขับ (tire_distance)

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useSession } from "next-auth/react"
import { ArrowDown, ArrowUp, FileSpreadsheet, FilterX, RefreshCw, Search, X } from "lucide-react"
import {
  FOLLOW_DOT, FOLLOW_LABEL, LEVEL_DOT, LEVEL_ORDER, SLICERS, SLICER_BY_KEY, buildRows, keyOfVehicle, matches,
  type AcceptOverride, type Payload, type Row, type SlicerDef, type SlicerKey, type Selection,
} from "@/components/tire/dashboard-shared"
import { TireDashTable } from "@/components/tire/dashboard-table"
import { bkkToday } from "@/lib/bkk-time"
import { XLS_DATE_FMT, downloadExcelBook, xlsDate, type ExcelCol, type ExcelRow } from "@/lib/excel-table"
import { swalError, swalToast } from "@/lib/swal"
import { DUE_LABEL, SOURCE_LABEL, type DueLevel } from "@/lib/tire-due"
import {
  FreshnessBar, StatCard, branchLabel, card, fmtNum, fontHead, fontThai, freshBtn, oldestTime,
} from "@/components/tire/shared"

// recharts หนัก ~100KB+ — แยก chunk โหลดหลัง KPI/ตาราง
const TireTrend = dynamic(() => import("@/components/tire/dashboard-trend").then((m) => m.TireTrend), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-[14px] bg-gray-50 dark:bg-white/5" />,
})

// ชนิดข้อมูล + Slicer อยู่ที่ dashboard-shared.ts (ใช้ร่วมกับกราฟและตารางรายเส้น)

function Slicer({ def, items, picked, onToggle, onClear, compact }: {
  def:      SlicerDef
  items:    { value: string; count: number }[]
  picked:   string[]
  onToggle: (v: string) => void
  onClear:  () => void
  /** ครึ่งความสูง — สาขา/หัวหาง มีแค่ 2 ตัวเลือก วางซ้อนกันในช่องเดียว */
  compact?: boolean
}) {
  const [q, setQ] = useState("")
  const showSearch = !compact && items.length > 10
  const shown = q ? items.filter((i) => (def.display?.(i.value) ?? i.value).toLowerCase().includes(q.toLowerCase())) : items
  const active = picked.length > 0
  return (
    <div className={`flex min-w-0 flex-col rounded-[6px] border bg-white dark:bg-[#151a10] ${active ? "border-[#1B8C4B]/60" : "border-[#D9E3DD] dark:border-white/10"}`}>
      <div className="flex items-center gap-1 border-b border-[#E4EEE8] px-2 py-1.5 dark:border-white/8">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#14271C] dark:text-white" style={fontThai}>
          {def.label}
          {active && <span className="ml-1 font-normal text-[#1B8C4B]">({picked.length})</span>}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={!active}
          title="ล้างตัวกรองนี้"
          className="rounded p-0.5 text-[#9AA8A0] transition-colors hover:bg-[#F0FDF4] hover:text-[#1B8C4B] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <FilterX size={13} />
        </button>
      </div>
      {showSearch && (
        <div className="relative border-b border-[#E4EEE8] dark:border-white/8">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา..."
            className="w-full bg-transparent py-1 pl-6 pr-2 text-[11px] text-[#14271C] placeholder-[#9AA8A0] focus:outline-none dark:text-white"
            style={fontThai}
          />
        </div>
      )}
      <div className={`${compact ? "max-h-[58px]" : "h-[132px]"} space-y-0.5 overflow-y-auto p-1`}>
        {shown.map((i) => {
          const on = picked.includes(i.value)
          const empty = i.count === 0
          return (
            <button
              key={i.value}
              type="button"
              onClick={() => onToggle(i.value)}
              className={[
                "flex w-full items-center gap-1.5 rounded-[4px] border px-1.5 py-[3px] text-left text-[11.5px] transition-colors",
                on
                  ? "border-[#1B8C4B] bg-[#E4F3EA] text-[#14271C] dark:bg-[#1B8C4B]/25 dark:text-white"
                  : empty
                    ? "border-transparent text-[#B8C3BD] dark:text-gray-600"
                    : "border-[#E4EEE8] text-[#3C4B42] hover:border-[#1B8C4B]/40 hover:bg-[#F6FAF7] dark:border-white/8 dark:text-gray-300 dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {def.key === "level" && <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[i.value as DueLevel]}`} />}
              {def.key === "follow" && <span className={`h-2 w-2 shrink-0 rounded-full ${FOLLOW_DOT[i.value as keyof typeof FOLLOW_DOT]}`} />}
              <span className="min-w-0 flex-1 truncate">{def.display?.(i.value) ?? i.value}</span>
              <span className="shrink-0 tabular-nums text-[10.5px] text-[#9AA8A0]">{fmtNum(i.count)}</span>
            </button>
          )
        })}
        {shown.length === 0 && <p className="py-4 text-center text-[11px] text-[#9AA8A0]" style={fontThai}>ไม่พบ</p>}
      </div>
    </div>
  )
}

// ── Pivot ──────────────────────────────────────────────────────────────────

type PivotDim = "plant" | "zone" | "fleet" | "vtype" | "product" | "branch" | "plate"
const PIVOT_DIMS: { key: PivotDim; label: string }[] = [
  { key: "plant",   label: "แพล้นท์" },
  { key: "zone",    label: "โซน" },
  { key: "fleet",   label: "ฟลีท" },
  { key: "vtype",   label: "ประเภทรถ" },
  { key: "product", label: "รุ่นยาง" },
  { key: "branch",  label: "สาขา" },
  { key: "plate",   label: "ทะเบียนรถ" },
]

type PivotRow = {
  key: string; name: string; vehicles: number; tires: number
  over: number; due: number; warn: number; ok: number; unknown: number
  alertPct: number | null; avgPct: number | null; avgKm: number | null
}

function summarize(key: string, name: string, rows: Row[]): PivotRow {
  const veh = new Set<string>()
  const c = { over: 0, due: 0, warn: 0, ok: 0, unknown: 0 }
  let pctSum = 0, pctN = 0, kmSum = 0, kmN = 0
  for (const r of rows) {
    veh.add(`${r.branch}|${r.plate}`)
    c[r.level]++
    if (r.usedPct != null) { pctSum += r.usedPct; pctN++ }
    if (r.level !== "unknown" || r.kmUsed > 0) { kmSum += r.kmUsed; kmN++ }
  }
  const known = c.over + c.due + c.warn + c.ok
  return {
    key, name, vehicles: veh.size, tires: rows.length, ...c,
    alertPct: known > 0 ? ((c.over + c.due) / known) * 100 : null,
    avgPct: pctN > 0 ? pctSum / pctN : null,
    avgKm: kmN > 0 ? kmSum / kmN : null,
  }
}

type PivotSortKey = keyof Omit<PivotRow, "key">

const PIVOT_COLS: { key: PivotSortKey; label: string; level?: DueLevel; fmt: (r: PivotRow) => string }[] = [
  { key: "vehicles", label: "รถ (คัน)",     fmt: (r) => fmtNum(r.vehicles) },
  { key: "tires",    label: "ยาง (เส้น)",   fmt: (r) => fmtNum(r.tires) },
  { key: "over",     label: "เกินกำหนด",   level: "over",    fmt: (r) => (r.over ? fmtNum(r.over) : "") },
  { key: "due",      label: "ถึงกำหนด",    level: "due",     fmt: (r) => (r.due ? fmtNum(r.due) : "") },
  { key: "warn",     label: "เฝ้าระวัง",    level: "warn",    fmt: (r) => (r.warn ? fmtNum(r.warn) : "") },
  { key: "ok",       label: "ปกติ",        level: "ok",      fmt: (r) => (r.ok ? fmtNum(r.ok) : "") },
  { key: "unknown",  label: "คำนวณไม่ได้", level: "unknown", fmt: (r) => (r.unknown ? fmtNum(r.unknown) : "") },
  { key: "alertPct", label: "% ต้องเปลี่ยน", fmt: (r) => (r.alertPct == null ? "—" : `${r.alertPct.toFixed(1)}%`) },
  { key: "avgPct",   label: "ใช้ไปเฉลี่ย",  fmt: (r) => (r.avgPct == null ? "—" : `${Math.round(r.avgPct)}%`) },
  { key: "avgKm",    label: "กม.เฉลี่ย/เส้น", fmt: (r) => (r.avgKm == null ? "—" : fmtNum(Math.round(r.avgKm))) },
]

// สีพื้นช่องตามความเข้ม (Color Scale แบบ Excel) — เฉพาะช่องระดับที่ต้องลงมือ
const HEAT: Partial<Record<DueLevel, string>> = { over: "220,38,38", due: "234,88,12", warn: "202,138,4" }

// ── ตาราง Pivot (ตารางรายเส้นอยู่ที่ dashboard-table.tsx) ─────────────────────

const gridTh = "border-b border-r border-[#D9E3DD] bg-[#EEF4F0] px-2 py-1.5 text-[11.5px] font-semibold text-[#14271C] whitespace-nowrap dark:border-white/10 dark:bg-[#1c2416] dark:text-gray-200"
const gridTd = "border-b border-r border-[#E4EEE8] px-2 py-[5px] text-[12px] text-[#3C4B42] whitespace-nowrap dark:border-white/8 dark:text-gray-300"

function SortHead<K extends string>({ label, k, sort, onSort, right, className = "" }: {
  label: string; k: K; sort: { key: K; dir: 1 | -1 }; onSort: (k: K) => void; right?: boolean; className?: string
}) {
  const on = sort.key === k
  return (
    <th className={`${gridTh} ${right ? "text-right" : "text-left"} ${className}`} style={fontThai}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-0.5 hover:text-[#1B8C4B] ${right ? "flex-row-reverse" : ""}`}>
        {label}
        {on ? (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <span className="inline-block w-[11px]" />}
      </button>
    </th>
  )
}

// ===========================================================================

export function TireDashboard({ branchFilter, onOpenVehicle }: {
  branchFilter:  string
  onOpenVehicle: (v: { branch: string; plate: string }) => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  // ผลโหลดผูกกับ key ของคำขอ — key ไม่ตรง = กำลังโหลดรอบใหม่ (ไม่ต้อง setLoading ใน effect)
  const reqKey = `${branchFilter}|${reloadKey}`
  const [result, setResult] = useState<{ key: string; data: Payload | null; last: Payload | null }>({ key: "", data: null, last: null })
  const loading = result.key !== reqKey
  // รีเฟรชรอบใหม่ยังโชว์ชุดเดิมไว้ก่อน ไม่วูบเป็นหน้าว่าง
  const data = loading ? result.last : result.data
  const [sel, setSel]         = useState<Selection>({})
  const [dim, setDim]         = useState<PivotDim>("plant")
  const [pSort, setPSort]     = useState<{ key: PivotSortKey; dir: 1 | -1 }>({ key: "over", dir: -1 })
  const [overrides, setOverrides] = useState<AcceptOverride>(new Map())
  const [acting, setActing]   = useState(false)
  // ชื่อคนรับเรื่อง — กติกาเดียวกับแท็บ "ยางถึงกำหนดเปลี่ยน"
  const { data: session } = useSession()
  const me = [session?.user?.employee?.firstname, session?.user?.employee?.lastname]
    .filter(Boolean).join(" ") || session?.user?.employee?.username || session?.user?.email || ""

  useEffect(() => {
    let cancelled = false
    const qs = branchFilter ? `?branch=${encodeURIComponent(branchFilter)}` : ""
    const done = (d: Payload | null) => {
      if (cancelled) return
      setResult((prev) => ({ key: reqKey, data: d, last: d ?? prev.last }))
      // ได้ข้อมูลชุดใหม่ (มีผลรับเรื่องจากเซิร์ฟเวอร์แล้ว) — ทิ้งค่าที่ทับไว้บนหน้า
      if (d) setOverrides(new Map())
    }
    fetch(`/api/tire-dashboard${qs}`)
      .then((r) => r.json())
      .then((d) => done(d && Array.isArray(d.tires) ? d : null))
      .catch(() => done(null))
    return () => { cancelled = true }
  }, [branchFilter, reqKey])

  const rows = useMemo(() => buildRows(data, overrides), [data, overrides])

  const filtered = useMemo(() => rows.filter((r) => matches(r, sel)), [rows, sel])

  // รายการในแต่ละ Slicer นับจาก "ตัวกรองกล่องอื่น" (ไม่กรองตัวเอง) — เหมือน Slicer ใน Excel
  // ตัวเลือกที่ไม่มีข้อมูลตามตัวกรองตอนนี้ยังอยู่ แค่จางและไปอยู่ท้ายกล่อง
  const slicerItems = useMemo(() => {
    const out = {} as Record<SlicerKey, { value: string; count: number }[]>
    for (const s of SLICERS) {
      const all = new Map<string, number>()
      for (const r of rows) all.set(s.value(r), 0)
      for (const r of rows) if (matches(r, sel, s.key)) all.set(s.value(r), (all.get(s.value(r)) ?? 0) + 1)
      const items = [...all.entries()].map(([value, count]) => ({ value, count }))
      items.sort((a, b) => {
        if ((a.count === 0) !== (b.count === 0)) return a.count === 0 ? 1 : -1
        if (s.order) return s.order.indexOf(a.value) - s.order.indexOf(b.value)
        return a.value.localeCompare(b.value, "th")
      })
      out[s.key] = items
    }
    return out
  }, [rows, sel])

  // สาขาเดียว (ล็อกสิทธิ์หรือเลือกไว้ด้านบนแล้ว) ไม่ต้องมีกล่องสาขาซ้ำ
  const showBranch = !branchFilter && slicerItems.branch.length > 1
  // ช่องแรกของแถว = สาขา (บน) + หัว/หาง (ล่าง) คนละครึ่ง · ต่อด้วย สถานะยาง → งานติดตาม → มิติอื่น
  const stackSlicers = (showBranch ? ["branch", "unit"] : ["unit"]).map((k) => SLICER_BY_KEY[k as SlicerKey])
  const gridSlicers = SLICERS.filter((s) => s.key !== "branch" && s.key !== "unit")

  const toggle = (k: SlicerKey, v: string) => setSel((prev) => {
    const cur = prev[k] ?? []
    return { ...prev, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }
  })
  const clear = (k: SlicerKey) => setSel((prev) => ({ ...prev, [k]: [] }))
  // กดแถวใน Pivot / การ์ดสถานะ = เลือกตัวนั้นตัวเดียวใน Slicer (กดซ้ำ = ยกเลิก)
  const only = (k: SlicerKey, v: string) => setSel((prev) => {
    const cur = prev[k] ?? []
    return { ...prev, [k]: cur.length === 1 && cur[0] === v ? [] : [v] }
  })
  const activeSel = SLICERS.filter((s) => (sel[s.key]?.length ?? 0) > 0)

  // ── ตัวเลขสรุป ──
  const total = useMemo(() => summarize("_", "รวมทั้งหมด", filtered), [filtered])
  const reqVehicles = useMemo(() => {
    const s = new Set<string>()
    for (const r of filtered) if (r.vehicleReqs > 0) s.add(`${r.branch}|${r.plate}`)
    return s.size
  }, [filtered])
  const alertVehicles = useMemo(() => {
    const s = new Set<string>()
    for (const r of filtered) if (r.level === "over" || r.level === "due") s.add(`${r.branch}|${r.plate}`)
    return s.size
  }, [filtered])

  // ── Pivot ──
  const pivotKeyOf = (r: Row): [string, string] => {
    switch (dim) {
      case "branch": return [r.branch, branchLabel(r.branch)]
      case "plate":  return [`${r.branch}|${r.plate}`, r.fleetNo ? `${r.plate} · ${r.fleetNo}` : r.plate]
      default:       return [r[dim], r[dim]]
    }
  }
  const pivot = useMemo(() => {
    const groups = new Map<string, { name: string; rows: Row[] }>()
    for (const r of filtered) {
      const [k, name] = pivotKeyOf(r)
      const g = groups.get(k) ?? { name, rows: [] }
      g.rows.push(r)
      groups.set(k, g)
    }
    const out = [...groups.entries()].map(([k, g]) => summarize(k, g.name, g.rows))
    out.sort((a, b) => {
      const av = a[pSort.key], bv = b[pSort.key]
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv), "th") * pSort.dir
      return (((av as number | null) ?? -1) - ((bv as number | null) ?? -1)) * pSort.dir || a.name.localeCompare(b.name, "th")
    })
    return out
  }, [filtered, dim, pSort]) // eslint-disable-line react-hooks/exhaustive-deps
  const heatMax = useMemo(() => {
    const m: Partial<Record<DueLevel, number>> = {}
    for (const r of pivot) for (const lv of ["over", "due", "warn"] as const) m[lv] = Math.max(m[lv] ?? 0, r[lv])
    return m
  }, [pivot])
  const onPivotSort = (k: PivotSortKey) =>
    setPSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === "name" ? 1 : -1 }))
  const onPivotRow = (p: PivotRow) => {
    if (dim === "plate") { const [branch, plate] = p.key.split("|"); onOpenVehicle({ branch, plate }); return }
    only(dim, p.key)
  }

  // ── ตารางรายเส้น: ตามตัวกรองด้านบน (ตารางกรอง/เรียงต่อเองได้) ──
  const detail = useMemo(
    () => filtered.slice().sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || a.plate.localeCompare(b.plate, "th")),
    [filtered],
  )

  // ── รับเรื่อง (ยกมาจากแท็บ "ยางถึงกำหนดเปลี่ยน") — ทับค่าบนหน้าทันที ไม่ต้องรอโหลดยางทั้งฟลีตใหม่ ──
  const markAccepted = (targets: Row[], on: boolean) => setOverrides((prev) => {
    const n = new Map(prev)
    const at = bkkToday()
    for (const r of targets) n.set(r.id, on ? { by: me, at } : null)
    return n
  })
  async function acceptTires(targets: Row[], on: boolean): Promise<boolean> {
    if (targets.length === 0) return false
    if (on && !me) { swalError("ไม่ทราบชื่อผู้ใช้ — ลองเข้าสู่ระบบใหม่"); return false }
    setActing(true)
    const res = await fetch("/api/tire-due", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets.map((r) => r.id), accept: on, by: me }),
    }).catch(() => null)
    setActing(false)
    const d = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { swalError(d.error ?? "บันทึกไม่สำเร็จ"); return false }
    markAccepted(targets, on)
    swalToast("success", on ? `รับเรื่องแล้ว ${fmtNum(targets.length)} เส้น` : `ยกเลิกรับเรื่อง ${fmtNum(targets.length)} เส้น`)
    return true
  }
  async function acceptVehicle(r: Row, on: boolean) {
    if (on && !me) { swalError("ไม่ทราบชื่อผู้ใช้ — ลองเข้าสู่ระบบใหม่"); return }
    setActing(true)
    const res = await fetch("/api/tire-due", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate: r.plate, branch: r.branch, accept: on, by: me }),
    }).catch(() => null)
    setActing(false)
    const d = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { swalError(d.error ?? "บันทึกไม่สำเร็จ"); return }
    const k = keyOfVehicle(r)
    markAccepted(rows.filter((x) => keyOfVehicle(x) === k), on)
    swalToast("success", on ? `รับเรื่อง ${r.plate} แล้ว (${fmtNum(d.tires)} เส้น)` : `ยกเลิกรับเรื่อง ${r.plate}`)
  }

  // ── ส่งออก Excel: ชีตสรุป (Pivot ที่เห็นอยู่) + ชีตรายเส้น (ตามตัวกรอง) ──
  async function exportExcel() {
    if (filtered.length === 0) { swalError("ไม่มีรายการให้ส่งออก"); return }
    const dimLabel = PIVOT_DIMS.find((d) => d.key === dim)?.label ?? ""
    const filterText = [
      branchFilter ? branchLabel(branchFilter) : "ทุกสาขา",
      ...activeSel.map((s) => `${s.label}: ${(sel[s.key] ?? []).map((v) => s.display?.(v) ?? v).join(", ")}`),
    ].join(" · ")
    const stamp = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })
    const subtitle = `${filterText} · ส่งออก ${stamp}`

    const pCols: ExcelCol[] = [
      { key: "name", header: dimLabel, width: 28 },
      ...PIVOT_COLS.map((c) => ({
        key: c.key, header: c.label, width: 12, align: "right" as const,
        numFmt: c.key === "alertPct" ? "0.0\"%\"" : c.key === "avgPct" ? "0\"%\"" : "#,##0",
      })),
    ]
    const pCells = (p: PivotRow) => ({
      name: p.name, vehicles: p.vehicles, tires: p.tires,
      over: p.over || null, due: p.due || null, warn: p.warn || null, ok: p.ok || null, unknown: p.unknown || null,
      alertPct: p.alertPct == null ? null : Math.round(p.alertPct * 10) / 10,
      avgPct: p.avgPct == null ? null : Math.round(p.avgPct),
      avgKm: p.avgKm == null ? null : Math.round(p.avgKm),
    })
    const BOLD = Object.fromEntries(pCols.map((c) => [c.key, "FF14271C"]))
    const pRows: ExcelRow[] = [
      ...pivot.map((p) => ({ cells: pCells(p), tone: p.over > 0 ? ("danger" as const) : undefined })),
      { cells: pCells(total), tone: "warn", ink: BOLD },
    ]

    const dCols: ExcelCol[] = [
      { key: "branch",   header: "สาขา", width: 11 },
      { key: "plate",    header: "ทะเบียน", width: 13 },
      { key: "fleetNo",  header: "เบอร์รถ", width: 10, align: "center" },
      { key: "unit",     header: "หัว/หาง", width: 8, align: "center" },
      { key: "vtype",    header: "ประเภทรถ", width: 16 },
      { key: "fleet",    header: "ฟลีท", width: 14 },
      { key: "zone",     header: "โซน", width: 14 },
      { key: "plant",    header: "แพล้นท์", width: 20 },
      { key: "position", header: "ตำแหน่ง", width: 16 },
      { key: "product",  header: "รุ่นยาง", width: 30 },
      { key: "serial",   header: "ซีเรียล", width: 14 },
      { key: "changeIn", header: "วันเปลี่ยนเข้า", width: 12, align: "center", numFmt: XLS_DATE_FMT },
      { key: "kmUsed",   header: "วิ่งไปแล้ว (กม.)", width: 13, align: "right", numFmt: "#,##0", group: "ระยะทาง" },
      { key: "spec",     header: "ระยะกำหนด (กม.)", width: 13, align: "right", numFmt: "#,##0", group: "ระยะทาง" },
      { key: "usedPct",  header: "ใช้ไป %", width: 9, align: "right", numFmt: "0\"%\"", group: "ระยะทาง" },
      { key: "level",    header: "สถานะ", width: 14 },
      { key: "follow",   header: "งานติดตาม", width: 14, group: "การดำเนินการ" },
      { key: "acceptBy", header: "รับเรื่องโดย", width: 18, group: "การดำเนินการ" },
      { key: "acceptAt", header: "รับเรื่องเมื่อ", width: 12, group: "การดำเนินการ", align: "center", numFmt: XLS_DATE_FMT },
      { key: "source",   header: "แหล่งระยะ", width: 10, align: "center" },
    ]
    const dRows: ExcelRow[] = detail.map((r) => ({
      cells: {
        branch: branchLabel(r.branch), plate: r.plate, fleetNo: r.fleetNo, unit: r.unit === "trailer" ? "หาง" : "หัว",
        vtype: r.vtype, fleet: r.fleet, zone: r.zone, plant: r.plant, position: r.position, product: r.product,
        serial: r.serial, changeIn: xlsDate(r.changeIn), kmUsed: r.kmUsed || null, spec: r.spec || null,
        usedPct: r.usedPct, level: DUE_LABEL[r.level],
        follow: FOLLOW_LABEL[r.follow], acceptBy: r.acceptedBy, acceptAt: xlsDate(r.acceptedAt || null), source: r.source === "none" ? "—" : SOURCE_LABEL[r.source],
      },
      tone: r.level === "over" ? "danger" : r.level === "due" ? "warn" : undefined,
    }))

    try {
      const n = await downloadExcelBook(`Dashboard ยาง ${bkkToday()}.xlsx`, [
        { sheetName: `สรุปตาม${dimLabel}`, title: `สรุปสภาพยางตาม${dimLabel}`, subtitle, columns: pCols, rows: pRows, freezeCols: 1 },
        { sheetName: "รายเส้น", title: "รายการยางบนรถ (รายเส้น)", subtitle, columns: dCols, rows: dRows, freezeCols: 3 },
      ])
      swalToast("success", `ส่งออก ${fmtNum(n)} แถวแล้ว`)
    } catch {
      swalError("ส่งออก Excel ไม่สำเร็จ")
    }
  }

  const fresh = data?.freshness
  const dimLabel = PIVOT_DIMS.find((d) => d.key === dim)?.label ?? ""

  return (
    <div>
      <FreshnessBar
        loading={loading && !fresh}
        items={[
          { label: "ข้อมูลจาก ATMS ล่าสุด",    at: oldestTime((fresh?.atms ?? []).map((a) => a.syncedAt)) },
          { label: "ข้อมูลระยะทาง GPS ล่าสุด", at: fresh?.computedAt ?? null },
        ]}
        actions={
          <>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} className={freshBtn} style={fontThai}>
              <RefreshCw size={13} className={"text-[#1B8C4B] " + (loading ? "animate-spin" : "")} />
              รีเฟรช
            </button>
            <button type="button" onClick={exportExcel} disabled={loading || filtered.length === 0} className={freshBtn} style={fontThai}>
              <FileSpreadsheet size={13} className="text-[#1B8C4B]" />
              ส่งออก Excel
            </button>
          </>
        }
      />

      {loading && !data ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"} style={fontThai}>กำลังโหลดข้อมูลยาง...</div>
      ) : !data ? (
        <div className={card + " px-4 py-16 text-center text-sm text-gray-400"} style={fontThai}>โหลดข้อมูลไม่สำเร็จ — ลองกดรีเฟรช</div>
      ) : (
        <>
          {/* ── Slicer ── */}
          <section className={card + " mb-4 p-3"}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] text-[#14271C] dark:text-white" style={fontHead}>ตัวกรอง</h2>
              <span className="text-[11px] text-[#9AA8A0]" style={fontThai}>เลือกได้หลายรายการในแต่ละกล่อง · ตัวเลขคือจำนวนเส้นตามตัวกรองกล่องอื่น</span>
              <button
                type="button"
                onClick={() => setSel({})}
                disabled={activeSel.length === 0}
                className="ml-auto inline-flex items-center gap-1 rounded-[8px] border border-[#D9E3DD] px-2.5 py-1 text-[12px] text-[#3C4B42] transition-colors hover:bg-[#F6FAF7] disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                style={fontThai}
              >
                <FilterX size={12} /> ล้างตัวกรองทั้งหมด
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
              <div className="flex min-w-0 flex-col gap-2">
                {stackSlicers.map((s) => (
                  <Slicer key={s.key} def={s} items={slicerItems[s.key]} picked={sel[s.key] ?? []} compact
                    onToggle={(v) => toggle(s.key, v)} onClear={() => clear(s.key)} />
                ))}
              </div>
              {gridSlicers.map((s) => (
                <Slicer key={s.key} def={s} items={slicerItems[s.key]} picked={sel[s.key] ?? []}
                  onToggle={(v) => toggle(s.key, v)} onClear={() => clear(s.key)} />
              ))}
            </div>
            {activeSel.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[#E4EEE8] pt-2 dark:border-white/8" style={fontThai}>
                <span className="text-[11px] text-[#9AA8A0]">กำลังกรอง:</span>
                {activeSel.flatMap((s) => (sel[s.key] ?? []).map((v) => (
                  <button
                    key={`${s.key}|${v}`}
                    type="button"
                    onClick={() => toggle(s.key, v)}
                    className="inline-flex items-center gap-1 rounded-[4px] border border-[#1B8C4B]/40 bg-[#F0FDF4] px-1.5 py-px text-[11px] text-[#14271C] hover:border-[#1B8C4B] dark:bg-[#1B8C4B]/15 dark:text-white"
                  >
                    <span className="text-[#6B7C72] dark:text-gray-400">{s.label}:</span> {s.display?.(v) ?? v}
                    <X size={10} className="text-[#9AA8A0]" />
                  </button>
                )))}
              </div>
            )}
          </section>

          {/* ── ตัวเลขสรุป ── */}
          <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            <StatCard label="ยางบนรถทั้งหมด" value={fmtNum(total.tires)} caption="เส้น" sub={`รถ ${fmtNum(total.vehicles)} คัน`} />
            <StatCard label="รถที่ต้องเปลี่ยนยาง" value={fmtNum(alertVehicles)} caption="คัน" tone="red" sub="มียางเกิน/ถึงกำหนด ≥ 1 เส้น" />
            {(["over", "due", "warn", "ok", "unknown"] as const).map((lv) => (
              <StatCard
                key={lv}
                label={DUE_LABEL[lv]}
                value={fmtNum(total[lv])}
                caption="เส้น"
                tone={lv === "over" ? "red" : lv === "due" ? "orange" : lv === "warn" ? "amber" : lv === "ok" ? "green" : "slate"}
                sub={total.tires > 0 ? `${((total[lv] / total.tires) * 100).toFixed(1)}% ของทั้งหมด` : undefined}
                active={(sel.level ?? []).length === 1 && sel.level![0] === lv}
                onClick={() => only("level", lv)}
              />
            ))}
            <StatCard label="รถมีคำขอค้าง" value={fmtNum(reqVehicles)} caption="คัน" tone="blue" sub={total.avgPct != null ? `ใช้ไปเฉลี่ย ${Math.round(total.avgPct)}%` : undefined} />
          </section>

          {/* แถบสัดส่วนสถานะ 100% */}
          {total.tires > 0 && (
            <div className="mb-4">
              <div className="flex h-2.5 w-full overflow-hidden rounded-[3px] bg-[#EEF2F0] dark:bg-white/10">
                {LEVEL_ORDER.map((lv) => total[lv] > 0 && (
                  <div key={lv} className={LEVEL_DOT[lv]} style={{ width: `${(total[lv] / total.tires) * 100}%` }} title={`${DUE_LABEL[lv]} ${fmtNum(total[lv])} เส้น`} />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
                {LEVEL_ORDER.map((lv) => (
                  <span key={lv} className="inline-flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-[2px] ${LEVEL_DOT[lv]}`} />
                    {DUE_LABEL[lv]} <b className="font-semibold tabular-nums text-[#14271C] dark:text-white">{fmtNum(total[lv])}</b>
                  </span>
                ))}
                <span className="ml-auto text-[#9AA8A0]">เกณฑ์: เฝ้าระวัง 80% · ถึงกำหนด 90% · เกินกำหนด 100% ของระยะกำหนดรุ่นยาง</span>
              </div>
            </div>
          )}

          {/* ── แนวโน้มรายวัน (ย้อน 30 วัน) ── */}
          <TireTrend branchFilter={branchFilter} sel={sel} reloadKey={reloadKey} />

          {/* ── Pivot ── */}
          <section className={card + " mb-4 overflow-hidden"}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#E4EEE8] px-3 py-2 dark:border-white/8">
              <h2 className="text-[14px] text-[#14271C] dark:text-white" style={fontHead}>สรุปตาม</h2>
              <div className="flex flex-wrap rounded-[8px] border border-[#D9E3DD] p-0.5 dark:border-white/10">
                {PIVOT_DIMS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setDim(d.key)}
                    className={`rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${dim === d.key ? "bg-[#14271C] text-white dark:bg-white dark:text-gray-900" : "text-[#3C4B42] hover:bg-[#F6FAF7] dark:text-gray-300 dark:hover:bg-white/5"}`}
                    style={fontThai}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[11px] text-[#9AA8A0]" style={fontThai}>
                {fmtNum(pivot.length)} {dimLabel} · {dim === "plate" ? "คลิกแถวเพื่อเปิดดูยางรายล้อ" : "คลิกชื่อเพื่อกรองเฉพาะรายการนั้น"}
              </span>
            </div>
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full border-collapse text-[12px] tabular-nums">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={gridTh + " w-10 text-center text-[#9AA8A0]"}>#</th>
                    <SortHead label={dimLabel} k={"name" as PivotSortKey} sort={pSort} onSort={onPivotSort} className="min-w-[200px]" />
                    {PIVOT_COLS.map((c) => (
                      <SortHead
                        key={c.key} label={c.label} k={c.key} sort={pSort} onSort={onPivotSort} right
                        className={c.level ? "" : "bg-[#E6EEE9] dark:bg-[#1f2a19]"}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivot.map((p, i) => (
                    <tr key={p.key} className="hover:bg-[#F6FAF7] dark:hover:bg-white/4">
                      <td className={gridTd + " text-center text-[#9AA8A0]"}>{i + 1}</td>
                      <td className={gridTd} style={fontThai}>
                        <button
                          type="button"
                          onClick={() => onPivotRow(p)}
                          className={`max-w-[320px] truncate text-left hover:text-[#1B8C4B] hover:underline ${(sel[dim as SlicerKey] ?? []).includes(p.key) ? "font-semibold text-[#1B8C4B]" : "text-[#14271C] dark:text-white"} ${dim === "plate" ? "font-mono" : ""}`}
                        >
                          {p.name}
                        </button>
                      </td>
                      {PIVOT_COLS.map((c) => {
                        const heat = c.level && HEAT[c.level] && heatMax[c.level] ? (p[c.level] / heatMax[c.level]!) : 0
                        return (
                          <td
                            key={c.key}
                            className={`${gridTd} text-right ${c.key === "over" && p.over > 0 ? "font-semibold text-red-700 dark:text-red-300" : ""}`}
                            style={heat > 0 ? { backgroundColor: `rgba(${HEAT[c.level!]},${(0.06 + heat * 0.26).toFixed(3)})` } : undefined}
                          >
                            {c.key === "alertPct" && p.alertPct != null ? (
                              <span className="relative block">
                                <span className="absolute inset-y-0 right-0 rounded-[2px] bg-red-500/15" style={{ width: `${Math.min(100, p.alertPct)}%` }} />
                                <span className="relative">{c.fmt(p)}</span>
                              </span>
                            ) : c.fmt(p)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr className="bg-[#EEF4F0] font-semibold dark:bg-[#1c2416]">
                    <td className={gridTd + " border-t-2 border-t-[#14271C]/30"} />
                    <td className={gridTd + " border-t-2 border-t-[#14271C]/30 text-[#14271C] dark:text-white"} style={fontThai}>รวมทั้งหมด</td>
                    {PIVOT_COLS.map((c) => (
                      <td key={c.key} className={gridTd + " border-t-2 border-t-[#14271C]/30 text-right text-[#14271C] dark:text-white"}>{c.fmt(total)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
              {pivot.length === 0 && <p className="py-10 text-center text-sm text-gray-400" style={fontThai}>ไม่มีข้อมูลตามตัวกรอง</p>}
            </div>
          </section>

          {/* ── รายเส้น (DataTable แบบหน้า คำขอ/อนุมัติ) ── */}
          <TireDashTable rows={detail} acting={acting} onOpenVehicle={onOpenVehicle} onAccept={acceptTires} onAcceptVehicle={acceptVehicle} />
        </>
      )}
    </div>
  )
}
