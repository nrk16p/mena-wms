"use client"

// ===========================================================================
// สต็อกยางรายสาขา — ใช้ snapshot ชุดเดียวกับหน้า /safety-stock แต่ตัดเหลือ
// กลุ่ม "ยาง" หน่วย "เส้น" (ดู lib/tire-stock-safety.ts)
//
// หน้าตาตารางยึดแบบเดียวกับแท็บคำขอ/อนุมัติ V.2 (components/tire/transaction-tracking.tsx):
// datatable หัวเข้ม + เส้นแบ่งคอลัมน์ + เรียง/กรองรายคอลัมน์แบบ Excel + แบ่งหน้า
// ชิ้นส่วนกลางอยู่ที่ components/datatable-shared.tsx
// ===========================================================================

import React, { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  ChevronDown, ChevronUp, Disc3, FileSpreadsheet, Layers, RefreshCw, Search, TriangleAlert,
} from "lucide-react"
import * as XLSX from "xlsx"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import {
  derive, STATUS_META, MIN_VERDICT_META, Z_BY_SERVICE, WINDOW_MONTHS,
  DEFAULT_WINDOW, DEFAULT_Z,
  type SafetyStockPayload, type SnapshotRow, type WindowKey, type Status,
  type Derived, type MinVerdict, type LeadTimeSource,
} from "@/lib/safety-stock-core"
import { TIRE_GROUP, TIRE_UNIT } from "@/lib/tire-stock-safety"
import { card, fontHead, fontThai, inp, StatCard } from "@/components/tire/shared"
import {
  buildFacetOptions, passFacets, ColHead, Empty, Pager,
  dtTdCls, dtTheadCls, PAGE_SIZES,
  type FacetOption, type HeadCtx, type SortState,
} from "@/components/datatable-shared"

// ── ตัวเลขและวันที่ ─────────────────────────────────────────────────────────

const baht = (n: number) =>
  n.toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 })

const num = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 })

const fmtInt = (n: number) => n.toLocaleString("th-TH")

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—"

// ── โทนสีของชิปในตาราง ──────────────────────────────────────────────────────

const STATUS_CHIP_CLS: Record<Status, string> = {
  out:       "bg-gray-200 text-gray-700 dark:bg-white/15 dark:text-gray-200",
  below_rop: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  below_min: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  over_max:  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  no_usage:  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  ok:        "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
}

const VERDICT_CHIP_CLS: Record<MinVerdict, string> = {
  too_low:  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  too_high: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ok:       "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  unknown:  "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400",
}

const LT_CHIP_CLS: Record<LeadTimeSource, string> = {
  sku:       "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  group:     "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  warehouse: "bg-gray-100 text-gray-400 dark:bg-white/8 dark:text-gray-500",
}

/** ที่มา lead time แบบสั้น — ใช้เป็นค่าติ๊กในเมนูกรอง (ไม่มีเลขครั้ง ไม่งั้นค่าจะแตกเป็นสิบ ๆ ตัว) */
const LT_SOURCE_TH: Record<LeadTimeSource, string> = {
  sku: "รายรหัส", group: "กลุ่ม", warehouse: "ค่ากลางคลัง",
}

const ltLabel = (source: LeadTimeSource, samples: number) =>
  source === "sku" ? `รายรหัส (${samples} ครั้ง)` : LT_SOURCE_TH[source]

// ── ตัวเลือกการคำนวณ ────────────────────────────────────────────────────────

const WINDOW_KEYS: WindowKey[] = ["m3", "m6", "m12"]
const SERVICE_LEVELS = Object.keys(Z_BY_SERVICE).map(Number).sort((a, b) => a - b)

/** จำนวนวันนับถึงวันนี้ — Date.now() เป็น impure call เรียกตรงๆ ใน useMemo/render body ไม่ได้ (react-hooks/purity) */
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** จำนวนครั้งที่เบิก แปลงเป็น "ครั้ง/ปี" ให้เทียบกันได้ไม่ว่าจะเลือกหน้าต่างไหน */
function annualCount(r: SnapshotRow, win: WindowKey): number {
  return Math.round(r.issueCounts[win] * (12 / WINDOW_MONTHS[win]))
}

const THAI_MONTH_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return THAI_MONTH_ABBR[m - 1] ?? ym
}

// ── เรียง / กรองรายคอลัมน์ ──────────────────────────────────────────────────

type Row = { r: SnapshotRow; d: Derived }

type SortKey =
  | "code" | "name" | "stock" | "stockValue" | "minmax" | "adu"
  | "lt" | "rop" | "dos" | "status" | "orderValue"

/** ค่าที่ใช้เทียบเวลาเรียง — ตัวเลขเทียบด้วยตัวเลข ข้อความเทียบตามลำดับพจนานุกรมไทย
 *  "พอใช้อีกกี่วัน" ของแถวที่ไม่มีการเบิกเป็น null (ADU=0 หารไม่ได้) — แทนด้วย Infinity
 *  เพื่อให้ไปกองท้ายตอนเรียงจากน้อยไปมาก ซึ่งเป็นทิศที่คนใช้จริง (หาของที่จะหมดก่อน) */
const SORT_VALUE: Record<SortKey, (x: Row) => number | string> = {
  code:       ({ r }) => r.code,
  name:       ({ r }) => r.name,
  stock:      ({ r }) => r.stockQty,
  stockValue: ({ r }) => r.stockQty * r.cost,
  minmax:     ({ r }) => r.minQty,
  adu:        ({ d }) => d.adu,
  lt:         ({ r }) => r.leadTimeDays,
  rop:        ({ d }) => d.reorderPoint,
  dos:        ({ d }) => d.daysOfSupply ?? Infinity,
  status:     ({ d }) => STATUS_META.findIndex((s) => s.key === d.status),
  orderValue: ({ r, d }) => d.suggestQty * r.cost,
}

type FacetKey = "brand" | "status" | "verdict" | "ltSource"

const FACET_KEYS = ["brand", "status", "verdict", "ltSource"] as const

/** ค่าที่โผล่ในรายการติ๊กของแต่ละคอลัมน์ — ต้องเป็น "ข้อความเดียวกับที่เห็นในเซลล์"
 *  ไม่ใช่ค่าดิบในฐานข้อมูล ไม่งั้นผู้ใช้ติ๊กแล้วหาไม่เจอว่าตรงกับแถวไหน */
const FACET_VALUE: Record<FacetKey, (x: Row) => string> = {
  brand:    ({ r }) => (r.brand || "").trim() || "ไม่ระบุยี่ห้อ",
  status:   ({ d }) => STATUS_META.find((s) => s.key === d.status)?.th ?? d.status,
  verdict:  ({ d }) => MIN_VERDICT_META[d.minVerdict].th,
  ltSource: ({ r }) => LT_SOURCE_TH[r.leadTimeSource],
}

type FacetState = Record<FacetKey, string[]>

/** ค่าเริ่มต้น: ไม่ติ๊กอะไรเลย = ไม่กรอง (ไม่ใช่ติ๊กครบแบบ Excel — ไม่ต้องมาไล่เอาติ๊กออก) */
const NO_FACETS: FacetState = { brand: [], status: [], verdict: [], ltSource: [] }

const hasFacet = (f: FacetState) => FACET_KEYS.some((k) => f[k].length > 0)

// ── กราฟยอดเบิกรายเดือน ─────────────────────────────────────────────────────

/** กราฟแท่ง 12 เดือน เก่า→ใหม่ ตรงตำแหน่งกับ SafetyStockPayload.months
 *  แถวที่ยังไม่ผ่าน build รอบที่เพิ่ม field นี้จะไม่มี monthly (หรือความยาวไม่ตรง) — กันพังด้วยข้อความแทนกราฟ */
function UsageMiniChart({ r, months }: { r: SnapshotRow; months: string[] }) {
  if (!Array.isArray(r.monthly) || r.monthly.length === 0 || r.monthly.length !== months.length) {
    return <p className="text-[11px] text-gray-400" style={fontThai}>ไม่มีข้อมูลรายเดือน — แถวนี้ยังไม่ได้ผ่านการ build รอบล่าสุด</p>
  }
  const bars = r.monthly.map((value, i) => ({ ym: months[i], label: monthLabel(months[i]), value: Math.max(0, value) }))
  const max = Math.max(...bars.map((b) => b.value), 0.0001)
  const H = 72, barW = 22, gap = 6, x0 = 4
  const width = x0 * 2 + bars.length * barW + (bars.length - 1) * gap
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={H + 22} role="img" aria-label="กราฟยอดเบิกรายเดือน 12 เดือน">
        {bars.map((b, i) => {
          const h = (b.value / max) * H
          const x = x0 + i * (barW + gap)
          return (
            <g key={b.ym}>
              <title>{`${b.label} (${b.ym}) — ${num(b.value)} ${r.unit}`}</title>
              <rect x={x} y={H - h} width={barW} height={Math.max(h, 1)} rx={3} fill="#1B8C4B" />
              <text x={x + barW / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="#9AA8A0">{b.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** รายละเอียดที่กางออกมาใต้แถว — ใช้ทั้งในตาราง (จอ ≥md) และในการ์ดของจอเล็ก */
function RowDetail({ r, d, months, win }: { r: SnapshotRow; d: Derived; months: string[]; win: WindowKey }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <h4 className="mb-2 text-[12px] font-bold text-[#14271C] dark:text-white" style={fontThai}>ยอดเบิกรายเดือน (12 เดือน)</h4>
        <UsageMiniChart r={r} months={months} />
        <p className="mt-2 text-[11.5px] text-[#9AA8A0]" style={fontThai}>
          รวม 12 เดือน {num(r.usage.m12)} {r.unit} · {fmtInt(r.issueCounts.m12)} ครั้ง · ราคาทุน {baht(r.cost)}/{r.unit}
        </p>
      </div>

      <div>
        <h4 className="mb-2 text-[12px] font-bold text-[#14271C] dark:text-white" style={fontThai}>ตัวเลขที่ใช้ตัดสิน</h4>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {[
            { label: "คงเหลือ", value: num(r.stockQty) },
            { label: "min (ATMS)", value: num(r.minQty) },
            { label: "max (ATMS)", value: num(r.maxQty) },
            { label: "ROP (คำนวณ)", value: num(d.reorderPoint) },
            { label: "SS (คำนวณ)", value: num(d.safetyStock) },
          ].map((x) => (
            <div key={x.label} className="rounded-[10px] border border-[#EEF2F0] bg-white px-2.5 py-2 dark:border-white/8 dark:bg-[#151a10]">
              <div className="text-[10px] font-semibold text-[#9AA8A0]" style={fontThai}>{x.label}</div>
              <div className="text-[15px] text-[#14271C] dark:text-white" style={fontHead}>{x.value}</div>
            </div>
          ))}
        </div>

        <h4 className="mb-1 mt-4 text-[12px] font-bold text-[#14271C] dark:text-white" style={fontThai}>ที่มา Lead Time</h4>
        <p className="text-[12px] text-[#6B7C72] dark:text-gray-300" style={fontThai}>
          <b>{r.leadTimeDays} วัน</b>{" "}
          <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${LT_CHIP_CLS[r.leadTimeSource]}`}>
            {ltLabel(r.leadTimeSource, r.leadTimeSamples)}
          </span>
          {r.leadTimeSource === "warehouse" && (
            <span className="mt-1 block text-[11px] text-[#9AA8A0]">
              เป็นค่ากลางทั้งคลัง (ไม่มีข้อมูล PR→รับของรายรหัสหรือรายกลุ่มพอ) — ใช้ประกอบได้ แต่ห้ามใช้ตัดสิน min
            </span>
          )}
        </p>

        <h4 className="mb-1 mt-4 text-[12px] font-bold text-[#14271C] dark:text-white" style={fontThai}>ข้อมูลสินค้า</h4>
        <p className="text-[12px] text-[#6B7C72] dark:text-gray-300" style={fontThai}>
          รหัส Oracle {r.oracleCode || "—"} · กลุ่ม {r.group} · ยี่ห้อ {r.brand || "ไม่ระบุ"}
          {" · "}เบิกเฉลี่ย {d.adu.toFixed(2)}/วัน ({annualCount(r, win)} ครั้ง/ปี)
        </p>
      </div>
    </div>
  )
}

// ===========================================================================
// ตัวหน้า
// ===========================================================================

export function TireStockSafetyPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const [data, setData] = useState<SafetyStockPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [q, setQ] = useState("")
  const [statusChip, setStatusChip] = useState<Status | "all">("all")
  const [win, setWin] = useState<WindowKey>(DEFAULT_WINDOW)
  const [service, setService] = useState(95)
  // เปิดหน้ามาเรียงตามยอดเบิกเฉลี่ยมากสุดก่อนเสมอ — ยางที่หมุนเร็วที่สุดคือของที่ต้องจับตาก่อน
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "adu", dir: "desc" })
  const [facets, setFacets] = useState<FacetState>(NO_FACETS)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0])
  const [expanded, setExpanded] = useState<string | null>(null)

  // ref กระจกค่า branch — เทียบ ณ เวลา request แก้เสร็จ (ไม่ใช่ ณ ตอนสร้าง closure) กัน race เมื่อ prop เปลี่ยนสาขา
  const branchRef = useRef(branch)
  useEffect(() => { branchRef.current = branch }, [branch])

  // โหลดข้อมูล — loading เริ่มเป็น true อยู่แล้วตอน mount จึงไม่ต้อง setState ซ้ำในนี้
  // (branch เป็น prop คงที่ต่อ route — เปลี่ยนสาขาคือ remount คนละหน้า ไม่ใช่ effect รอบสอง)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/tire-stock/safety?branch=${branch}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d?.error) setError(d.error)
        else { setError(null); setData(d) }
      })
      .catch((e) => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch])

  async function doRefresh() {
    const requested = branch
    setRefreshing(true)
    try {
      const res = await fetch(`/api/tire-stock/safety?branch=${requested}&refresh=1`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      // ยังอยู่สาขาเดิมที่กดรีเฟรชหรือไม่ — เทียบกับ ref ที่ตามค่าปัจจุบันจริง ไม่ใช่ closure ตอนกดปุ่ม
      if (branchRef.current === requested) {
        setData(json)
        swalToast("success", "ดึงข้อมูลใหม่แล้ว")
      }
    } catch (e) {
      swalError(`ดึงข้อมูลใหม่ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setRefreshing(false)
    }
  }

  const z = Z_BY_SERVICE[service] ?? DEFAULT_Z

  // คำนวณใหม่ในเครื่องเมื่อเปลี่ยนหน้าต่างหรือ service level — ไม่ยิง DB ซ้ำ (สูตรตัวเดียวกับหน้า Safety Stock)
  const allRows: Row[] = useMemo(() => {
    if (!data) return []
    return data.rows.map((r) => ({ r, d: derive(r, win, z) }))
  }, [data, win, z])

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return allRows
    return allRows.filter(({ r }) =>
      r.code.toLowerCase().includes(needle) ||
      r.name.toLowerCase().includes(needle) ||
      (r.brand ?? "").toLowerCase().includes(needle) ||
      (r.oracleCode ?? "").toLowerCase().includes(needle)
    )
  }, [allRows, q])

  const chipped = useMemo(
    () => (statusChip === "all" ? searched : searched.filter(({ d }) => d.status === statusChip)),
    [searched, statusChip]
  )

  const facetOptions: Record<FacetKey, FacetOption[]> = useMemo(
    () => buildFacetOptions(chipped, FACET_KEYS, facets, FACET_VALUE),
    [chipped, facets]
  )

  const rows = useMemo(() => {
    const kept = chipped.filter((x) => passFacets(x, FACET_KEYS, facets, FACET_VALUE))
    if (!sort) return kept
    const valueOf = SORT_VALUE[sort.key]
    const sign = sort.dir === "asc" ? 1 : -1
    // sort ของ JS เสถียร — แถวที่ค่าเท่ากันจึงยังเรียงตามลำดับเดิม
    return [...kept].sort((a, b) => {
      const x = valueOf(a), y = valueOf(b)
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "th")
      // ค่าเท่ากันเยอะ (เช่น ADU=0 ของรหัสที่ไม่มีการเบิก) — ตัดสินด้วยรหัสกันเรียงดูสุ่ม
      // ตัวตัดสินนี้ห้ามคูณ sign: ไม่งั้นสลับทิศคอลัมน์หลักทีไร กลุ่มที่ค่าเท่ากันจะพลิกลำดับตามไปด้วย
      return cmp ? cmp * sign : a.r.code.localeCompare(b.r.code, "th")
    })
  }, [chipped, facets, sort])

  const headCtx: HeadCtx<SortKey, FacetKey> = {
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
  const filterKey = `${q}|${statusChip}|${perPage}|${facetKey}`
  const [lastKey, setLastKey] = useState(filterKey)
  if (lastKey !== filterKey) {
    setLastKey(filterKey)
    setPage(1)
  }

  const filtered = q.trim() !== "" || statusChip !== "all" || hasFacet(facets)

  function clearFilters() {
    setQ("")
    setStatusChip("all")
    setFacets(NO_FACETS)
  }

  /* ------------------------------------------------------------ การ์ดสรุป */

  // คิดจากยางทั้งคลัง ไม่ผูกกับคำค้น/ชิป/ตัวกรองคอลัมน์ เพื่อให้ตัวเลขภาพรวมนิ่ง
  const cards = useMemo(() => {
    let orderCount = 0, orderValue = 0, outCount = 0, overCount = 0, overValue = 0
    let stockQty = 0, stockValue = 0
    for (const { r, d } of allRows) {
      stockQty += Math.max(0, r.stockQty)
      stockValue += Math.max(0, r.stockQty) * r.cost
      if (d.status === "out" || d.status === "below_rop") { orderCount++; orderValue += d.suggestQty * r.cost }
      if (d.status === "out") outCount++
      if (d.status === "over_max") { overCount++; overValue += Math.max(0, r.stockQty - r.maxQty) * r.cost }
    }
    return { orderCount, orderValue, outCount, overCount, overValue, stockQty, stockValue }
  }, [allRows])

  /* ---------------------------------------------------------------- ส่งออก */

  function exportStock() {
    const ws = XLSX.utils.json_to_sheet(
      rows.map(({ r, d }) => ({
        รหัส: r.code,
        "รหัส Oracle": r.oracleCode,
        ชื่อสินค้า: r.name,
        ยี่ห้อ: r.brand,
        หน่วย: r.unit,
        คงเหลือ: r.stockQty,
        มูลค่าคงเหลือ: Math.round(r.stockQty * r.cost * 100) / 100,
        min: r.minQty,
        max: r.maxQty,
        "เฉลี่ย/วัน": d.adu,
        "จำนวนครั้งที่เบิก (ครั้ง/ปี โดยประมาณ)": annualCount(r, win),
        "Lead Time (วัน)": r.leadTimeDays,
        "ที่มา Lead Time": ltLabel(r.leadTimeSource, r.leadTimeSamples),
        ROP: d.reorderPoint,
        SS: d.safetyStock,
        "พอใช้อีก (วัน)": d.daysOfSupply ?? "",
        สถานะ: STATUS_META.find((s) => s.key === d.status)?.th ?? d.status,
        "ตรวจ min": MIN_VERDICT_META[d.minVerdict].th,
        แนะนำสั่ง: d.suggestQty,
        ราคาทุน: r.cost,
        มูลค่าที่ต้องสั่ง: Math.round(d.suggestQty * r.cost * 100) / 100,
      }))
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "สต็อกยาง")
    // ห้ามใช้ toISOString().slice(0,10) — เป็นวันที่ UTC ช่วง 00:00-07:00 เวลาไทยจะได้ชื่อไฟล์ของ "เมื่อวาน" (lib/bkk-time.ts)
    XLSX.writeFile(wb, `tire-stock-${branch}-${bkkToday()}.xlsx`)
  }

  const staleDays = data?.latestMovementDate ? daysSince(data.latestMovementDate) : null
  const isStale = staleDays !== null && staleDays > 2

  const months = data?.months ?? []
  const COLS = 11

  /* -------------------------------------------------------------------- จอ */

  return (
    <div>
      {/* ── หัวเรื่อง ── */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Disc3 size={20} className="text-[#1B8C4B]" />
        <h1 className="text-[22px] text-[#14271C] dark:text-white" style={fontHead}>สต็อกยาง — {branchLabel}</h1>
        <span className="text-[13px] text-[#9AA8A0]" style={fontThai}>
          ({fmtInt(data?.rows.length ?? 0)} รหัส)
        </span>
        <Link
          href={`/tire/${branch}/stock-tire/serial`}
          className="ml-auto inline-flex items-center gap-1 rounded-[10px] border border-[#EEF2F0] px-2.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:bg-[#F0FDF4] dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
          style={fontThai}
        >
          <Layers size={12} /> สต็อกรายเส้น (Serial)
        </Link>
      </div>
      <p className="mb-4 text-[13px] text-[#9AA8A0]" style={fontThai}>
        กลุ่ม “{TIRE_GROUP}” หน่วย “{TIRE_UNIT}” · {data?.warehouse ?? "—"} · ข้อมูล ณ {fmtDateTime(data?.asOf)}
        {" · "}เคลื่อนไหวล่าสุด {fmtDate(data?.latestMovementDate)}
        {" · "}sync min/max ล่าสุด {fmtDateTime(data?.skuSyncedAt)}
      </p>

      {/* ── แถบเตือน — ตั้งใจปล่อยให้ขึ้นแดงถ้าข้อมูลเก่า ไม่ปิดบัง ── */}
      {isStale && data && (
        <div className="mb-3 flex items-start gap-2 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300" style={fontThai}>
          <TriangleAlert size={14} className="mt-px shrink-0" />
          ข้อมูลการเคลื่อนไหวล่าสุดคือ {fmtDate(data.latestMovementDate)} ({staleDays} วันที่แล้ว) — ตัวเลขคงเหลืออาจไม่เป็นปัจจุบัน ตรวจสอบ pipeline ก่อนใช้ตัดสินใจสั่งของ
        </div>
      )}
      {data && data.skuSyncedAt === null && (
        <div className="mb-3 flex items-start gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300" style={fontThai}>
          <TriangleAlert size={14} className="mt-px shrink-0" />
          ยังไม่เคย sync min/max จาก ATMS สำเร็จ — คอลัมน์ min/max อาจว่างหรือเป็นค่าเก่า
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-[12px] bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-300" style={fontThai}>
          โหลดข้อมูลไม่สำเร็จ: {error}
        </div>
      )}

      {/* ── การ์ดสรุป — กดเพื่อกรองไปที่สถานะนั้น ── */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="ต้องสั่งวันนี้" tone="orange" value={fmtInt(cards.orderCount)} caption={`รหัส · ${baht(cards.orderValue)}`}
          active={statusChip === "below_rop"} onClick={() => setStatusChip(statusChip === "below_rop" ? "all" : "below_rop")}
        />
        <StatCard
          label="ของหมด" tone="slate" value={fmtInt(cards.outCount)} caption="รหัส · คงเหลือ ≤ 0 แต่ยังมีการเบิก"
          active={statusChip === "out"} onClick={() => setStatusChip(statusChip === "out" ? "all" : "out")}
        />
        <StatCard
          label="เกิน max" tone="blue" value={fmtInt(cards.overCount)} caption={`รหัส · ${baht(cards.overValue)} จมเกินจำเป็น`}
          active={statusChip === "over_max"} onClick={() => setStatusChip(statusChip === "over_max" ? "all" : "over_max")}
        />
        <StatCard
          label="ยางคงคลัง" tone="green" value={num(cards.stockQty)} caption={`${TIRE_UNIT} · ${baht(cards.stockValue)}`}
        />
      </div>

      {/* ── ค้นหา + ล้างตัวกรอง + รีเฟรช + ส่งออก ── */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหารหัส / ชื่อยาง / ยี่ห้อ / รหัส Oracle..."
            className={inp + " w-full pl-8"}
            style={fontThai}
          />
        </div>

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
          {isAdmin && (
            <button
              type="button"
              onClick={doRefresh}
              disabled={refreshing || loading}
              title="ดึง snapshot ใหม่จากฐานข้อมูล (ข้าม cache 1 ชั่วโมง)"
              className="inline-flex items-center gap-1 rounded-[10px] border border-[#EEF2F0] px-2.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:bg-[#F0FDF4] disabled:opacity-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
              style={fontThai}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> ดึงข้อมูลใหม่
            </button>
          )}

          {/* เลขบนปุ่มคือจำนวนแถวที่จะได้จริง — กดแล้วไม่ต้องลุ้นว่าไฟล์จะมีแค่หน้าที่เปิดอยู่ไหม */}
          <button
            type="button"
            onClick={exportStock}
            disabled={loading || rows.length === 0}
            title={rows.length ? `ส่งออก ${fmtInt(rows.length)} รหัสที่กรองอยู่เป็นไฟล์ Excel` : "ไม่มีรายการให้ส่งออก"}
            className={
              "group inline-flex items-center gap-1.5 rounded-[10px] bg-linear-to-b from-[#22A25B] to-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white " +
              "shadow-[0_1px_2px_rgba(20,39,28,0.18),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all " +
              "hover:from-[#26AF63] hover:to-[#177A41] hover:shadow-[0_3px_10px_rgba(27,140,75,0.32)] " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B8C4B] " +
              "active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
            }
            style={fontThai}
          >
            <FileSpreadsheet size={13} className="transition-transform group-hover:-translate-y-px" />
            ส่งออก Excel
            {rows.length > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-px font-mono text-[10.5px] font-bold tabular-nums">
                {fmtInt(rows.length)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── ตัวเลือกการคำนวณ — มีผลกับ ADU / ROP / SS / จำนวนแนะนำสั่งทั้งตาราง ── */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#EEF2F0] bg-[#F6FAF7] px-3 py-2 dark:border-white/8 dark:bg-white/3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#9AA8A0]" style={fontThai}>ฐานคำนวณ</span>

        <div className="flex items-center gap-1 rounded-[10px] bg-white p-0.5 dark:bg-[#151a10]">
          {WINDOW_KEYS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWin(w)}
              title="ช่วงยอดเบิกที่ใช้คำนวณ ADU / ROP / จำนวนแนะนำสั่ง"
              className={[
                "rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors",
                win === w ? "bg-[#1B8C4B] text-white" : "text-[#6B7C72] hover:text-[#14271C] dark:text-gray-400 dark:hover:text-white",
              ].join(" ")}
              style={fontThai}
            >
              {WINDOW_MONTHS[w]} เดือน
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>Service level</span>
          <input
            type="range"
            min={0}
            max={SERVICE_LEVELS.length - 1}
            step={1}
            value={Math.max(0, SERVICE_LEVELS.indexOf(service))}
            onChange={(e) => setService(SERVICE_LEVELS[Number(e.target.value)])}
            aria-label="ระดับการให้บริการที่ใช้คำนวณสต็อกกันขาด"
            className="w-24 accent-[#1B8C4B]"
          />
          <span className="w-8 text-[12px] font-bold text-[#14271C] dark:text-white">{service}%</span>
        </div>
      </div>

      {/* ── ตาราง (จอ ≥md) ── */}
      <div className={card + " hidden overflow-x-auto md:block"}>
        <table className="w-full text-sm">
          <thead>
            <tr className={dtTheadCls}>
              <ColHead ctx={headCtx} label="รหัส" width="w-32"
                sortKey="code" sortLabels={["รหัส ก → ฮ", "รหัส ฮ → ก"]} />
              <ColHead ctx={headCtx} label="ชื่อยาง / ยี่ห้อ" width="w-64"
                sortKey="name" sortLabels={["ชื่อ ก → ฮ", "ชื่อ ฮ → ก"]} facetKey="brand" />
              <ColHead ctx={headCtx} label="คงเหลือ" width="w-28" align="right"
                sortKey="stock" sortLabels={["เหลือน้อยสุดก่อน", "เหลือมากสุดก่อน"]} />
              <ColHead ctx={headCtx} label="มูลค่าคงเหลือ" width="w-32" align="right"
                sortKey="stockValue" sortLabels={["มูลค่าน้อย → มาก", "มูลค่ามาก → น้อย"]} />
              <ColHead ctx={headCtx} label="min / max" width="w-36" align="right"
                sortKey="minmax" sortLabels={["min น้อย → มาก", "min มาก → น้อย"]} facetKey="verdict"
                hint="min/max ที่ตั้งไว้ใน ATMS พร้อมผลตรวจว่าสอดคล้องกับการใช้จริงหรือไม่" />
              <ColHead ctx={headCtx} label="เบิกเฉลี่ย" width="w-32" align="right"
                sortKey="adu" sortLabels={["เบิกน้อย → มาก", "เบิกมาก → น้อย"]}
                hint="จำนวนครั้งที่เบิกแสดงคู่กันเสมอ กันเข้าใจผิดว่า ADU ทศนิยมเล็ก ๆ ผิดพลาด" />
              <ColHead ctx={headCtx} label="Lead time" width="w-32" align="right"
                sortKey="lt" sortLabels={["รอของสั้น → ยาว", "รอของยาว → สั้น"]} facetKey="ltSource" />
              <ColHead ctx={headCtx} label="ROP / SS" width="w-28" align="right"
                sortKey="rop" sortLabels={["ROP น้อย → มาก", "ROP มาก → น้อย"]}
                hint="จุดสั่งซื้อ / สต็อกกันขาด ที่คำนวณจากยอดเบิกจริง" />
              <ColHead ctx={headCtx} label="พอใช้อีก" width="w-28" align="right"
                sortKey="dos" sortLabels={["จะหมดก่อนอยู่บน", "เหลือใช้นานสุดก่อน"]} />
              <ColHead ctx={headCtx} label="สถานะ" width="w-36"
                sortKey="status" sortLabels={["ด่วนสุด → ปกติ", "ปกติ → ด่วนสุด"]} facetKey="status" />
              <ColHead ctx={headCtx} label="แนะนำสั่ง / มูลค่า" width="w-40" align="right"
                sortKey="orderValue" sortLabels={["มูลค่าน้อย → มาก", "มูลค่ามาก → น้อย"]} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={COLS} className="px-4 py-14 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={COLS}>
                  <Empty
                    hint={filtered ? "ไม่พบยางที่ตรงกับเงื่อนไข" : "ยังไม่มีข้อมูลยางในคลังนี้"}
                    onClear={filtered ? clearFilters : undefined}
                  />
                </td>
              </tr>
            ) : pageRows.map(({ r, d }, i) => {
              const isOpen = expanded === r.code
              const meta = STATUS_META.find((s) => s.key === d.status)
              return (
                <React.Fragment key={r.code}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r.code)}
                    className={[
                      "cursor-pointer border-b border-[#F1F5F2] transition-colors dark:border-white/5",
                      i % 2 === 1 ? "bg-[#FAFCFB] dark:bg-white/1" : "",
                      "hover:bg-[#F0FDF4]/70 dark:hover:bg-white/4",
                    ].join(" ")}
                  >
                    <td className={dtTdCls}>
                      <span className="inline-flex items-center gap-1 font-mono text-[12.5px] font-semibold text-[#14271C] dark:text-white">
                        {r.code}
                        {isOpen ? <ChevronUp size={11} className="text-[#9AA8A0]" /> : <ChevronDown size={11} className="text-[#9AA8A0]" />}
                      </span>
                      <div className="mt-0.5 font-mono text-[10px] text-[#9AA8A0]">{r.oracleCode || "—"}</div>
                    </td>

                    <td className={dtTdCls}>
                      <div className="truncate text-[12.5px] text-[#14271C] dark:text-gray-100" style={fontThai} title={r.name}>{r.name}</div>
                      <div className="truncate text-[10.5px] text-[#9AA8A0]" style={fontThai}>{r.brand || "ไม่ระบุยี่ห้อ"}</div>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      <span className="text-[13px] font-semibold text-[#14271C] tabular-nums dark:text-white" style={fontHead}>{num(r.stockQty)}</span>
                      <span className="ml-1 text-[10.5px] text-[#9AA8A0]" style={fontThai}>{r.unit}</span>
                    </td>

                    <td className={dtTdCls + " text-right text-[12px] text-[#6B7C72] tabular-nums dark:text-gray-300"}>
                      {baht(r.stockQty * r.cost)}
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      <div className="text-[12px] text-[#6B7C72] tabular-nums dark:text-gray-300">
                        {r.minQty > 0 || r.maxQty > 0 ? `${num(r.minQty)} / ${num(r.maxQty)}` : "—"}
                      </div>
                      <span
                        className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold ${VERDICT_CHIP_CLS[d.minVerdict]}`}
                        title={MIN_VERDICT_META[d.minVerdict].hint}
                        style={fontThai}
                      >
                        {MIN_VERDICT_META[d.minVerdict].th}
                      </span>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      <div className="text-[12px] text-[#6B7C72] tabular-nums dark:text-gray-300">{d.adu.toFixed(2)}/วัน</div>
                      <div className="text-[10.5px] text-[#9AA8A0]" style={fontThai}>{fmtInt(annualCount(r, win))} ครั้ง/ปี</div>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      <div className="text-[12px] text-[#6B7C72] tabular-nums dark:text-gray-300">{r.leadTimeDays} วัน</div>
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold ${LT_CHIP_CLS[r.leadTimeSource]}`} style={fontThai}>
                        {ltLabel(r.leadTimeSource, r.leadTimeSamples)}
                      </span>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      <div className="text-[12px] text-[#6B7C72] tabular-nums dark:text-gray-300">{num(d.reorderPoint)}</div>
                      <div className="text-[10.5px] text-[#9AA8A0] tabular-nums">SS {num(d.safetyStock)}</div>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      {d.daysOfSupply === null ? (
                        <span className="text-[11.5px] text-gray-300 dark:text-gray-600">—</span>
                      ) : (
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                            d.daysOfSupply <= r.leadTimeDays ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                            : d.daysOfSupply <= r.leadTimeDays * 2 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          }`}
                          title={`เทียบกับเวลารอของ ${r.leadTimeDays} วัน`}
                        >
                          {d.daysOfSupply} วัน
                        </span>
                      )}
                    </td>

                    <td className={dtTdCls}>
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP_CLS[d.status]}`} title={meta?.hint} style={fontThai}>
                        {meta?.th ?? d.status}
                      </span>
                    </td>

                    <td className={dtTdCls + " text-right"}>
                      {d.suggestQty > 0 ? (
                        <>
                          <div className="text-[13px] font-semibold text-[#14271C] tabular-nums dark:text-white" style={fontHead}>
                            {num(d.suggestQty)} <span className="text-[10.5px] font-normal text-[#9AA8A0]" style={fontThai}>{r.unit}</span>
                          </div>
                          <div className="text-[10.5px] text-[#9AA8A0] tabular-nums">{baht(d.suggestQty * r.cost)}</div>
                        </>
                      ) : (
                        <span className="text-[11.5px] text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-[#F1F5F2] bg-[#F6FAF7] dark:border-white/5 dark:bg-white/3">
                      <td colSpan={COLS} className="px-4 py-4">
                        <RowDetail r={r} d={d} months={months} win={win} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── การ์ด (จอ <md) — ตารางกว้าง 12 คอลัมน์อ่านบนมือถือไม่ไหว ── */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {loading && !data ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</p>
        ) : pageRows.length === 0 ? (
          <div className={card}>
            <Empty
              hint={filtered ? "ไม่พบยางที่ตรงกับเงื่อนไข" : "ยังไม่มีข้อมูลยางในคลังนี้"}
              onClear={filtered ? clearFilters : undefined}
            />
          </div>
        ) : pageRows.map(({ r, d }) => {
          const isOpen = expanded === r.code
          const meta = STATUS_META.find((s) => s.key === d.status)
          return (
            <div
              key={r.code}
              onClick={() => setExpanded(isOpen ? null : r.code)}
              className={card + " cursor-pointer px-3.5 py-3"}
            >
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[12.5px] font-semibold text-[#14271C] dark:text-white">{r.code}</p>
                  <p className="truncate text-[12.5px] text-[#14271C] dark:text-gray-100" style={fontThai}>{r.name}</p>
                  <p className="truncate text-[10.5px] text-[#9AA8A0]" style={fontThai}>{r.brand || "ไม่ระบุยี่ห้อ"}</p>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP_CLS[d.status]}`} style={fontThai}>
                  {meta?.th ?? d.status}
                </span>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[#EEF2F0] pt-2.5 dark:border-white/8">
                {[
                  { label: "คงเหลือ", value: `${num(r.stockQty)} ${r.unit}` },
                  { label: "ROP", value: num(d.reorderPoint) },
                  { label: "พอใช้อีก", value: d.daysOfSupply === null ? "—" : `${d.daysOfSupply} วัน` },
                  { label: "min / max", value: r.minQty > 0 || r.maxQty > 0 ? `${num(r.minQty)} / ${num(r.maxQty)}` : "—" },
                  { label: "แนะนำสั่ง", value: d.suggestQty > 0 ? `${num(d.suggestQty)} ${r.unit}` : "—" },
                  { label: "มูลค่าที่ต้องสั่ง", value: d.suggestQty > 0 ? baht(d.suggestQty * r.cost) : "—" },
                ].map((x) => (
                  <div key={x.label}>
                    <div className="text-[10px] text-[#9AA8A0]" style={fontThai}>{x.label}</div>
                    <div className="text-[12.5px] text-[#14271C] tabular-nums dark:text-gray-100" style={fontThai}>{x.value}</div>
                  </div>
                ))}
              </div>

              {isOpen && (
                <div className="mt-2.5 border-t border-[#EEF2F0] pt-3 dark:border-white/8" onClick={(e) => e.stopPropagation()}>
                  <RowDetail r={r} d={d} months={months} win={win} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── ท้ายตาราง: จำนวน + แบ่งหน้า ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="text-[12px] text-[#9AA8A0]" style={fontThai}>
          {rows.length ? (
            <>
              แสดง <span className="font-medium text-[#14271C] dark:text-white">{sliceFrom + 1}–{sliceFrom + pageRows.length}</span> จาก {fmtInt(rows.length)} รหัส
              {rows.length !== allRows.length ? ` (ทั้งหมด ${fmtInt(allRows.length)})` : ""}
            </>
          ) : "ไม่มีรายการที่ตรงกับเงื่อนไข"}
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
    </div>
  )
}
