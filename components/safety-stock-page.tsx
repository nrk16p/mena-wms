"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { ChevronDown, ChevronUp, Download, RefreshCw, Search, TriangleAlert, X } from "lucide-react"
import * as XLSX from "xlsx"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import {
  derive, STATUS_META, MIN_VERDICT_META, Z_BY_SERVICE, WINDOW_MONTHS, WAREHOUSES, INVENTORY_ID,
  DEFAULT_WINDOW, DEFAULT_Z,
  type SafetyStockPayload, type SnapshotRow, type WindowKey, type Status,
  type Derived, type MinVerdict, type LeadTimeSource,
} from "@/lib/safety-stock-core"

// ── โทนสี/ฟอนต์ — ธีมเดียวกับ components/deadstock-pending-page.tsx (ไม่รองรับ dark mode ตามแบบเดิม) ──
const mitr = { fontFamily: "'Mitr', sans-serif" }

const baht = (n: number) =>
  n.toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 })

const num = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 })

const thaiDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) : "—"

const thaiDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—"

type ToneKey = "zinc" | "orange" | "amber" | "blue" | "violet" | "emerald"
const TONE_COLORS: Record<ToneKey, { bg: string; fg: string; ring: string }> = {
  zinc:    { bg: "#F4F4F5", fg: "#3F3F46", ring: "#D4D4D8" },
  orange:  { bg: "#FFF7ED", fg: "#C2410C", ring: "#FED7AA" },
  amber:   { bg: "#FFFBEB", fg: "#92400E", ring: "#FDE68A" },
  blue:    { bg: "#EFF6FF", fg: "#1D4ED8", ring: "#BFDBFE" },
  violet:  { bg: "#F5F3FF", fg: "#6D28D9", ring: "#DDD6FE" },
  emerald: { bg: "#ECFDF5", fg: "#047857", ring: "#A7F3D0" },
}
const toneOf = (t: string): { bg: string; fg: string; ring: string } => TONE_COLORS[t as ToneKey] ?? TONE_COLORS.zinc

const VERDICT_TONE: Record<MinVerdict, ToneKey> = { too_low: "orange", too_high: "blue", ok: "emerald", unknown: "zinc" }

const WINDOW_KEYS: WindowKey[] = ["m3", "m6", "m12"]
const SERVICE_LEVELS = Object.keys(Z_BY_SERVICE).map(Number).sort((a, b) => a - b)

/** จำนวนวันนับถึงวันนี้ — แยกเป็นฟังก์ชันนอก component เพราะ Date.now() เป็น impure call
 *  เรียกตรงๆ ใน useMemo/render body ไม่ได้ (react-hooks/purity) เหมือนที่ไฟล์อื่นในโปรเจกต์ทำ (เช่น tire-transaction-tracking.tsx) */
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** จำนวนครั้งที่เบิก แปลงเป็น "ครั้ง/ปี" ให้เทียบกันได้ไม่ว่าจะเลือกหน้าต่างไหน */
function annualCount(r: SnapshotRow, win: WindowKey): number {
  return Math.round(r.issueCounts[win] * (12 / WINDOW_MONTHS[win]))
}

/** ที่มาของ lead time — ป้ายเล็กตามข้อ 4: รายรหัส (N ครั้ง) / กลุ่ม / ค่ากลางคลัง (สีเทาจาง) */
function LtBadge({ source, samples }: { source: LeadTimeSource; samples: number }) {
  const style =
    source === "sku"
      ? { bg: "#EEF2FF", fg: "#4338CA" }
      : source === "group"
        ? { bg: "#ECFDF5", fg: "#047857" }
        : { bg: "#F3F4F6", fg: "#9CA3AF" } // ค่ากลางคลัง — สีเทาจางตามสเปก
  const label = source === "sku" ? `รายรหัส (${samples} ครั้ง)` : source === "group" ? "กลุ่ม" : "ค่ากลางคลัง"
  return (
    <span style={{ background: style.bg, color: style.fg, padding: "1px 6px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
      {label}
    </span>
  )
}

function StatusChipBadge({ status }: { status: Status }) {
  const meta = STATUS_META.find((s) => s.key === status)
  if (!meta) return null
  const c = toneOf(meta.tone)
  return (
    <span
      title={meta.hint}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.ring}`, padding: "2px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}
    >
      {meta.th}
    </span>
  )
}

function VerdictBadge({ verdict }: { verdict: MinVerdict }) {
  const meta = MIN_VERDICT_META[verdict]
  const c = toneOf(VERDICT_TONE[verdict])
  return (
    <span
      title={meta.hint}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.ring}`, padding: "2px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}
    >
      {meta.th}
    </span>
  )
}

type EnrichedRow = { r: SnapshotRow; d: Derived }

type SortKey =
  | "code" | "name" | "group" | "stockQty" | "minQty" | "maxQty" | "adu" | "leadTimeDays"
  | "rop" | "ss" | "dos" | "status" | "minVerdict" | "suggestQty" | "orderValue"

// daysOfSupply เป็น null สำหรับแถวไม่มีการเบิก (ADU=0 หารไม่ได้) — คืน null ตรงๆ แล้วให้ตัวเปรียบเทียบใน `sorted`
// ดันไปท้ายลิสต์เสมอไม่ว่าจะเรียงขึ้นหรือลง (ข้อ C) ห้าม map เป็นเลข sentinel เพราะการสลับทิศจะพลิกตำแหน่งไปอยู่หัวลิสต์แทน
function sortValue(row: EnrichedRow, key: SortKey): number | string | null {
  switch (key) {
    case "code": return row.r.code
    case "name": return row.r.name
    case "group": return row.r.group
    case "stockQty": return row.r.stockQty
    case "minQty": return row.r.minQty
    case "maxQty": return row.r.maxQty
    case "adu": return row.d.adu
    case "leadTimeDays": return row.r.leadTimeDays
    case "rop": return row.d.reorderPoint
    case "ss": return row.d.safetyStock
    case "dos": return row.d.daysOfSupply
    case "status": return STATUS_META.findIndex((s) => s.key === row.d.status)
    case "minVerdict": return row.d.minVerdict
    case "suggestQty": return row.d.suggestQty
    case "orderValue": return row.d.suggestQty * row.r.cost
  }
}

/** หัวคอลัมน์ที่คลิกเรียงได้ — ตรึงซ้ายได้ถ้าระบุ stickyLeft (ข้อ 3) */
function SortableTh({
  label, colKey, sortKey, sortDir, onSort, align, stickyLeft, title,
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (k: SortKey) => void
  align?: "right"
  stickyLeft?: number
  title?: string
}) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      title={title}
      style={{
        padding: "10px 12px",
        fontWeight: 700,
        color: "#374151",
        borderBottom: "1px solid #E5E7EB",
        whiteSpace: "nowrap",
        textAlign: align ?? "left",
        cursor: "pointer",
        userSelect: "none",
        background: "#F9FAFB",
        ...(stickyLeft !== undefined ? { position: "sticky" as const, left: stickyLeft, zIndex: 3 } : {}),
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        {active && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  )
}

const THAI_MONTH_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/** "2026-08" → "ส.ค." — ย่อให้ป้าย 12 เดือนพอดีความกว้างกราฟ */
function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return THAI_MONTH_ABBR[m - 1] ?? ym
}

/** กราฟแท่ง SVG เขียนเอง — ยอดเบิกรายเดือนจริง 12 เดือนจาก row.monthly (เก่า→ใหม่ ตรงตำแหน่งกับ SafetyStockPayload.months)
 *  แถวที่ snapshot ยังไม่ผ่าน build รอบที่เพิ่ม field นี้จะไม่มี monthly (หรือความยาวไม่ตรงกับ months) — กันพังด้วยข้อความแทนกราฟ */
function UsageMiniChart({ r, months }: { r: SnapshotRow; months: string[] }) {
  if (!Array.isArray(r.monthly) || r.monthly.length === 0 || r.monthly.length !== months.length) {
    return <p style={{ fontSize: 12.5, color: "#9CA3AF", margin: 0 }}>ไม่มีข้อมูลรายเดือน — แถวนี้ยังไม่ได้ผ่านการ build รอบล่าสุด</p>
  }

  const bars = r.monthly.map((value, i) => ({ ym: months[i], label: monthLabel(months[i]), value: Math.max(0, value) }))
  const max = Math.max(...bars.map((b) => b.value), 0.0001)
  const H = 90, barW = 26, gap = 6, x0 = 8
  const width = x0 * 2 + bars.length * barW + (bars.length - 1) * gap

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={H + 24} role="img" aria-label="กราฟยอดเบิกรายเดือน 12 เดือน">
        {bars.map((b, i) => {
          const h = (b.value / max) * H
          const x = x0 + i * (barW + gap)
          return (
            <g key={b.ym}>
              <title>{`${b.label} (${b.ym}) — ${num(b.value)} ${r.unit}`}</title>
              <rect x={x} y={H - h} width={barW} height={Math.max(h, 1)} rx={3} fill="#1B8C4B" />
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="#6B7280">
                {b.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** dialog รายรหัส — กราฟยอดเบิก · ล็อต FIFO ที่ค้าง · min/max/ROP/SS เทียบกัน · ที่มา lead time (ข้อ 7) */
function RowDialog({
  row, win, z, months, onClose,
}: { row: SnapshotRow; win: WindowKey; z: number; months: string[]; onClose: () => void }) {
  const d = useMemo(() => derive(row, win, z), [row, win, z])
  const isLB = row.inventoryId === INVENTORY_ID

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`รายละเอียด ${row.code} ${row.name}`}
        style={{ background: "#fff", borderRadius: 14, maxWidth: 640, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "20px 22px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: "monospace", fontSize: 12.5, color: "#6B7280", margin: 0 }}>{row.code}</p>
            <h3 style={{ ...mitr, fontSize: 17, fontWeight: 700, margin: "2px 0 0" }}>{row.name}</h3>
            <p style={{ fontSize: 12, color: "#9CA3AF", margin: "2px 0 0" }}>{row.group} · {row.unit} · {row.brand || "ไม่ระบุยี่ห้อ"}</p>
          </div>
          <button onClick={onClose} aria-label="ปิด" style={{ border: "none", background: "#F3F4F6", borderRadius: 8, width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <StatusChipBadge status={d.status} />
          <VerdictBadge verdict={d.minVerdict} />
        </div>

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>ยอดเบิกรายเดือน (12 เดือน)</h4>
        <UsageMiniChart r={row} months={months} />

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>min / max / ROP / SS เทียบกัน</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          {[
            { label: "min (ATMS)", value: row.minQty },
            { label: "max (ATMS)", value: row.maxQty },
            { label: "ROP (คำนวณ)", value: d.reorderPoint },
            { label: "SS (คำนวณ)", value: d.safetyStock },
            { label: "คงเหลือ", value: row.stockQty },
          ].map((x) => (
            <div key={x.label} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "#6B7280", fontWeight: 600 }}>{x.label}</div>
              <div style={{ ...mitr, fontSize: 16, fontWeight: 700, marginTop: 2 }}>{num(x.value)}</div>
            </div>
          ))}
        </div>

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>ที่มา Lead Time</h4>
        <p style={{ fontSize: 13, color: "#374151", margin: 0 }}>
          <b>{row.leadTimeDays} วัน</b> — <LtBadge source={row.leadTimeSource} samples={row.leadTimeSamples} />
          {row.leadTimeSource === "warehouse" && (
            <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 4 }}>
              เป็นค่ากลางทั้งคลัง (ไม่มีข้อมูล PR→รับของรายรหัสหรือรายกลุ่มพอ) — ใช้ประกอบได้ แต่ห้ามใช้ตัดสิน min
            </span>
          )}
        </p>

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>ล็อต FIFO ที่ค้าง</h4>
        {isLB ? (
          <p style={{ fontSize: 13, color: "#374151", margin: 0 }}>
            ค้างอยู่ <b>{num(row.fifoRemaining)}</b> {row.unit} · ล็อตเก่าสุดค้างมาแล้ว <b>{row.oldestAgeDays}</b> วัน
          </p>
        ) : (
          <p style={{ fontSize: 12.5, color: "#9CA3AF", margin: 0 }}>ข้อมูล FIFO เก็บเฉพาะคลังลาดกระบัง — คลังนี้ยังไม่มีข้อมูลส่วนนี้</p>
        )}
      </div>
    </div>
  )
}

export default function SafetyStockPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const [warehouseId, setWarehouseId] = useState<string>(WAREHOUSES[0]?.id ?? INVENTORY_ID)
  // ref กระจกค่า warehouseId — ใช้เทียบ ณ เวลา request แก้เสร็จ (ไม่ใช่ ณ ตอนสร้าง closure) กัน race ตอนดึงข้อมูลใหม่ (ข้อ A)
  const warehouseIdRef = useRef(warehouseId)
  useEffect(() => { warehouseIdRef.current = warehouseId }, [warehouseId])
  const [data, setData] = useState<SafetyStockPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [q, setQ] = useState("")
  const [groups, setGroups] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Status[]>(["out", "below_rop"])
  const [win, setWin] = useState<WindowKey>(DEFAULT_WINDOW)
  const [service, setService] = useState(95)
  const [selectedRow, setSelectedRow] = useState<SnapshotRow | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("orderValue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // โหลดข้อมูล — ยิงใหม่ทุกครั้งที่เปลี่ยนคลัง · loading เริ่มเป็น true อยู่แล้วตอน mount จึงไม่ต้อง setState ซ้ำในนี้
  useEffect(() => {
    let cancelled = false
    fetch(`/api/safety-stock?inventory=${warehouseId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [warehouseId])

  // สลับคลัง — รีเซ็ตตัวกรองกลุ่ม/สถานะในนี้ (event handler ไม่ใช่ effect) เพราะกลุ่มสินค้าต่างกันคนละคลัง
  // คงค่าหน้าต่างเวลาและ service level ไว้ตามที่ผู้ใช้เลือก
  function selectWarehouse(id: string) {
    if (id === warehouseId || loading) return
    setLoading(true)
    setError(null)
    setSelectedRow(null)
    setGroups([])
    setStatuses(["out", "below_rop"])
    setWarehouseId(id)
  }

  async function doRefresh() {
    // เก็บคลังที่กำลังกดตอนนี้ไว้ — ถ้าผู้ใช้สลับคลังก่อน request นี้เสร็จ ต้องไม่เอาผลลัพธ์คลังเก่ามาทับคลังใหม่ (ข้อ A)
    const requestedWarehouse = warehouseId
    setRefreshing(true)
    try {
      const res = await fetch(`/api/safety-stock?inventory=${requestedWarehouse}&refresh=1`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      // ยังอยู่คลังเดิมที่กดรีเฟรชหรือไม่ — เทียบกับ ref ที่ตามค่าปัจจุบันจริง ไม่ใช่ closure ตอนกดปุ่ม
      if (warehouseIdRef.current === requestedWarehouse) {
        setData(json)
        swalToast("success", "ดึงข้อมูลใหม่แล้ว")
      }
      // ถ้าสลับคลังไปแล้ว — ทิ้งผลลัพธ์นี้เงียบๆ ไม่ต้องแจ้ง (คลังเดิมจะดึงใหม่เองถ้าสลับกลับไป)
    } catch (e) {
      swalError(`ดึงข้อมูลใหม่ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      // ปุ่มรีเฟรชมีอันเดียว ไม่ผูกกับคลัง — ต้องปลดสถานะ loading เสมอ ไม่งั้นถ้าสลับคลังระหว่างรอ ปุ่มจะค้าง disabled ตลอดไป
      setRefreshing(false)
    }
  }

  const z = Z_BY_SERVICE[service] ?? DEFAULT_Z

  // คำนวณใหม่ในเครื่องเมื่อผู้ใช้เปลี่ยนหน้าต่างหรือ service level — ไม่ยิง DB ซ้ำ
  const enriched: EnrichedRow[] = useMemo(() => {
    if (!data) return []
    return data.rows.map((r) => ({ r, d: derive(r, win, z) }))
  }, [data, win, z])

  const groupOptions = useMemo<Record<string, { th: string; en: string }>>(() => {
    if (!data) return {}
    const out: Record<string, { th: string; en: string }> = {}
    for (const g of [...new Set(data.rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, "th"))) {
      out[g] = { th: g, en: "" }
    }
    return out
  }, [data])

  // ค้นหา+กลุ่ม ก่อนสถานะ — เพื่อให้จำนวนในวงเล็บของชิปสถานะสะท้อนตัวกรองอื่นที่เลือกอยู่ (ไม่รวมสถานะเอง)
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return enriched.filter(({ r }) => {
      if (needle && !r.code.toLowerCase().includes(needle) && !r.name.toLowerCase().includes(needle)) return false
      if (groups.length && !groups.includes(r.group)) return false
      return true
    })
  }, [enriched, q, groups])

  const statusCounts = useMemo(() => {
    const m = new Map<Status, number>()
    for (const { d } of searched) m.set(d.status, (m.get(d.status) ?? 0) + 1)
    return m
  }, [searched])

  const filtered = useMemo(() => {
    if (!statuses.length) return searched
    return searched.filter(({ d }) => statuses.includes(d.status))
  }, [searched, statuses])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      // null (เช่น "พอใช้อีกกี่วัน" ของแถวไม่มีการเบิก) ต้องอยู่ท้ายลิสต์เสมอ ไม่ว่าจะเรียงขึ้นหรือลง — เช็คก่อนกลับทิศ
      if (av === null && bv === null) return a.r.code.localeCompare(b.r.code, "th")
      if (av === null) return 1
      if (bv === null) return -1
      let cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "th") : (av as number) - (bv as number)
      if (cmp === 0) cmp = a.r.code.localeCompare(b.r.code, "th") // กันเรียงดูสุ่มเมื่อค่าเท่ากัน (เช่น cost=0 จำนวนมาก)
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  function toggleStatus(key: Status) {
    setStatuses((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]))
  }

  // การ์ด 4 ใบ — คิดจากข้อมูลทั้งคลัง (ไม่ผูกกับตัวกรองค้นหา/กลุ่ม/สถานะ) ข้อ 2
  const cards = useMemo(() => {
    let todayCount = 0, todayValue = 0
    let outCount = 0
    let overCount = 0, overValue = 0
    let reviewTooLow = 0, reviewTooHigh = 0, reviewNoUsage = 0
    for (const { r, d } of enriched) {
      if (d.status === "out" || d.status === "below_rop") { todayCount++; todayValue += d.suggestQty * r.cost }
      if (d.status === "out") outCount++
      if (d.status === "over_max") { overCount++; overValue += Math.max(0, r.stockQty - r.maxQty) * r.cost }
      if (d.minVerdict === "too_low") reviewTooLow++
      else if (d.minVerdict === "too_high") reviewTooHigh++
      else if (d.status === "no_usage") reviewNoUsage++
    }
    return { todayCount, todayValue, outCount, overCount, overValue, reviewTooLow, reviewTooHigh, reviewNoUsage }
  }, [enriched])

  // แถบเตือนความสด — ข้อ 1
  const staleDays = data?.latestMovementDate ? daysSince(data.latestMovementDate) : null
  const isStale = staleDays !== null && staleDays > 2

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(
      sorted.map(({ r, d }) => ({
        รหัส: r.code,
        ชื่อ: r.name,
        กลุ่ม: r.group,
        หน่วย: r.unit,
        คงเหลือ: r.stockQty,
        min: r.minQty,
        max: r.maxQty,
        "เฉลี่ย/วัน": d.adu,
        "จำนวนครั้งที่เบิก (ครั้ง/ปี โดยประมาณ)": annualCount(r, win),
        "Lead Time (วัน)": r.leadTimeDays,
        "ที่มา Lead Time": r.leadTimeSource === "sku" ? `รายรหัส (${r.leadTimeSamples} ครั้ง)` : r.leadTimeSource === "group" ? "กลุ่ม" : "ค่ากลางคลัง",
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
    XLSX.utils.book_append_sheet(wb, ws, "Safety Stock")
    // ห้ามใช้ toISOString().slice(0,10) — เป็นวันที่ UTC ช่วง 00:00-07:00 เวลาไทยจะได้ชื่อไฟล์ของ "เมื่อวาน" (lib/bkk-time.ts)
    XLSX.writeFile(wb, `safety-stock-${bkkToday()}.xlsx`)
  }

  const CODE_W = 96
  const NAME_W = 210

  return (
    <div>
      {/* ── แถบเตือนความสด — เต็มความกว้างบนสุด ข้อ 1 (ตั้งใจปล่อยให้ขึ้นแดงถ้าข้อมูลเก่า ไม่ปิดบัง) ── */}
      {isStale && data && (
        <div style={{ background: "#DC2626", color: "#fff", padding: "8px 24px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <TriangleAlert size={15} className="shrink-0" />
          ข้อมูลการเคลื่อนไหวล่าสุดคือ {thaiDate(data.latestMovementDate)} ({staleDays} วันที่แล้ว) — ตัวเลขคงเหลืออาจไม่เป็นปัจจุบัน ตรวจสอบ pipeline ก่อนใช้ตัดสินใจสั่งของ
        </div>
      )}
      {data && data.skuSyncedAt === null && (
        <div style={{ background: "#F59E0B", color: "#fff", padding: "8px 24px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <TriangleAlert size={15} className="shrink-0" />
          ยังไม่เคย sync min/max จาก ATMS สำเร็จ
        </div>
      )}

      <div style={{ padding: "20px 24px 48px", maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <h1 style={{ ...mitr, fontSize: 24, fontWeight: 700, margin: 0 }}>จุดสั่งซื้อ (Safety Stock)</h1>
          {isAdmin && (
            <button
              onClick={doRefresh}
              disabled={refreshing || loading}
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, cursor: refreshing || loading ? "wait" : "pointer" }}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> ดึงข้อมูลใหม่
            </button>
          )}
        </div>

        {/* ── ตัวเลือกคลัง — segmented control ข้อกำหนดเพิ่มเติม (multi-warehouse) ── */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {WAREHOUSES.map((w) => {
            const active = w.id === warehouseId
            return (
              <button
                key={w.id}
                onClick={() => selectWarehouse(w.id)}
                disabled={loading}
                aria-current={active ? "true" : undefined}
                style={{
                  padding: "7px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, border: "none",
                  cursor: loading ? "wait" : "pointer",
                  background: active ? "#111827" : "#F3F4F6", color: active ? "#fff" : "#374151",
                }}
              >
                {w.name}
              </button>
            )
          })}
        </div>

        <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 16px" }}>
          {data?.warehouse ?? "—"} · ข้อมูล ณ {data ? thaiDateTime(data.asOf) : "—"} · เคลื่อนไหวล่าสุด {data ? thaiDate(data.latestMovementDate) : "—"} · sync min/max ล่าสุด {data ? thaiDateTime(data.skuSyncedAt) : "—"}
        </p>

        {error && (
          <div style={{ padding: 16, borderRadius: 10, background: "#FEF2F2", color: "#B91C1C", marginBottom: 16 }}>
            โหลดข้อมูลไม่สำเร็จ: {error}
          </div>
        )}

        {loading && !data && <p style={{ color: "#6B7280" }}>กำลังโหลดข้อมูล...</p>}

        {data && (
          <div style={{ position: "relative" }}>
            {loading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.65)", zIndex: 20, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60 }}>
                <span style={{ ...mitr, fontSize: 14, fontWeight: 700, color: "#374151", display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 999, padding: "8px 18px" }}>
                  <RefreshCw size={15} className="animate-spin" /> กำลังโหลดข้อมูลคลัง...
                </span>
              </div>
            )}

            {/* ── การ์ด 4 ใบ — ข้อ 2 ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ต้องสั่งวันนี้</div>
                <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: "#DC2626", marginTop: 2 }}>{cards.todayCount.toLocaleString()} รหัส</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>{baht(cards.todayValue)}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>ของหมดแล้ว</div>
                <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: "#111827", marginTop: 2 }}>{cards.outCount.toLocaleString()} รหัส</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>onHand ≤ 0 แต่ยังมีการเบิก</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>เกิน max</div>
                <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: "#2563EB", marginTop: 2 }}>{cards.overCount.toLocaleString()} รหัส</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>{baht(cards.overValue)} จมเกินจำเป็น</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>min/max ควรทบทวน</div>
                <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: "#7C3AED", marginTop: 2 }}>{(cards.reviewTooLow + cards.reviewTooHigh + cards.reviewNoUsage).toLocaleString()} รหัส</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>ต่ำไป {cards.reviewTooLow} · สูงไป {cards.reviewTooHigh} · ไม่มีการเบิก {cards.reviewNoUsage}</div>
              </div>
            </div>

            {/* ── ตัวกรอง ── */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ค้นหารหัส / ชื่อสินค้า"
                  style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 240 }}
                />
              </div>
              <MultiSelectCombobox
                options={groupOptions}
                values={groups}
                onChange={setGroups}
                placeholder="— ทุกกลุ่มสินค้า —"
                className="min-w-[220px] max-w-[320px] rounded-lg border border-[#E5E7EB] px-2"
              />
              <div style={{ display: "flex", gap: 4, background: "#F3F4F6", borderRadius: 8, padding: 3 }}>
                {WINDOW_KEYS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWin(w)}
                    style={{ padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: win === w ? "#fff" : "transparent", color: win === w ? "#111827" : "#6B7280", boxShadow: win === w ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
                  >
                    {WINDOW_MONTHS[w]} เดือน
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: "#6B7280", fontWeight: 600 }}>Service level</span>
                <input
                  type="range"
                  min={0}
                  max={SERVICE_LEVELS.length - 1}
                  step={1}
                  value={Math.max(0, SERVICE_LEVELS.indexOf(service))}
                  onChange={(e) => setService(SERVICE_LEVELS[Number(e.target.value)])}
                  style={{ width: 90 }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#111827", minWidth: 32 }}>{service}%</span>
              </div>
              <span style={{ fontSize: 13, color: "#6B7280" }}>
                แสดง {sorted.length.toLocaleString()} / {data.rows.length.toLocaleString()} รายการ
              </span>
              <button
                onClick={exportXlsx}
                disabled={sorted.length === 0}
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                <Download size={14} /> Excel
              </button>
            </div>

            {/* ── ชิปสถานะ — ข้อ 6 ── */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {STATUS_META.map((s) => {
                const active = statuses.includes(s.key)
                const c = toneOf(s.tone)
                const count = statusCounts.get(s.key) ?? 0
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleStatus(s.key)}
                    title={s.hint}
                    aria-pressed={active}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                      fontWeight: active ? 700 : 600,
                      background: active ? c.bg : "#F9FAFB",
                      color: active ? c.fg : "#9CA3AF",
                      border: `1.5px solid ${active ? c.ring : "#E5E7EB"}`,
                    }}
                  >
                    {s.th} ({count})
                  </button>
                )
              })}
            </div>

            {/* ── ตาราง — ตรึงคอลัมน์รหัส/ชื่อ เลื่อนแนวนอนได้ ข้อ 3 ── */}
            <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <SortableTh label="รหัส" colKey="code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} stickyLeft={0} />
                    <SortableTh label="ชื่อ" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} stickyLeft={CODE_W} />
                    <SortableTh label="กลุ่ม" colKey="group" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th style={{ padding: "10px 12px", fontWeight: 700, color: "#374151", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#F9FAFB" }}>หน่วย</th>
                    <SortableTh label="คงเหลือ" colKey="stockQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="min" colKey="minQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="max" colKey="maxQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="เฉลี่ย/วัน · ครั้งที่เบิก" colKey="adu" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title="จำนวนครั้งที่เบิกแสดงคู่กันเสมอ กันเข้าใจผิดว่า ADU ทศนิยมเล็กๆ ผิดพลาด" />
                    <SortableTh label="LT (ที่มา)" colKey="leadTimeDays" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="ROP" colKey="rop" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="SS" colKey="ss" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="พอใช้อีก (วัน)" colKey="dos" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="สถานะ" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="ตรวจ min" colKey="minVerdict" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="แนะนำสั่ง" colKey="suggestQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="มูลค่าที่ต้องสั่ง" colKey="orderValue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ r, d }) => (
                    <tr
                      key={r.code}
                      onClick={() => setSelectedRow(r)}
                      style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
                    >
                      <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>{r.code}</td>
                      <td style={{ padding: "9px 12px", minWidth: NAME_W, position: "sticky", left: CODE_W, background: "#fff", zIndex: 1 }}>{r.name}</td>
                      <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{r.group}</td>
                      <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{r.unit}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>{num(r.stockQty)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "#6B7280" }}>{num(r.minQty)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", color: "#6B7280" }}>{num(r.maxQty)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>{d.adu.toFixed(2)}/วัน · {annualCount(r, win)} ครั้ง/ปี</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div>{r.leadTimeDays} วัน</div>
                        <LtBadge source={r.leadTimeSource} samples={r.leadTimeSamples} />
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>{num(d.reorderPoint)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>{num(d.safetyStock)}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>{d.daysOfSupply === null ? "–" : `${d.daysOfSupply} วัน`}</td>
                      <td style={{ padding: "9px 12px" }}><StatusChipBadge status={d.status} /></td>
                      <td style={{ padding: "9px 12px" }}><VerdictBadge verdict={d.minVerdict} /></td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700 }}>{d.suggestQty > 0 ? `${num(d.suggestQty)} ${r.unit}` : "–"}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700 }}>{baht(d.suggestQty * r.cost)}</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={16} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
                        ไม่พบรายการตามเงื่อนไข
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedRow && (
          <RowDialog row={selectedRow} win={win} z={z} months={data?.months ?? []} onClose={() => setSelectedRow(null)} />
        )}
      </div>
    </div>
  )
}
