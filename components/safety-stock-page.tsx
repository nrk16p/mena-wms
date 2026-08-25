"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { ChevronDown, ChevronUp, Download, RefreshCw, Search, TriangleAlert, X } from "lucide-react"
import * as XLSX from "xlsx"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import {
  derive, STATUS_META, MIN_VERDICT_META, GLOSSARY, Z_BY_SERVICE, WINDOW_MONTHS, WAREHOUSES, INVENTORY_ID,
  DEFAULT_WINDOW, DEFAULT_Z, LEAD_TIME_DAYS,
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
 *  เรียกตรงๆ ใน useMemo/render body ไม่ได้ (react-hooks/purity) เหมือนที่ไฟล์อื่นในโปรเจกต์ทำ (เช่น components/tire/transaction-tracking.tsx) */
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

// compact: ใช้ในตารางหลัก (คอลัมน์ "สถานะ" ที่ยุบรวมแล้ว) — ตัวเล็กลง ยอมให้ตัดบรรทัดได้ ไม่บังคับ nowrap
// เหมือนตอนอยู่ในหน้าต่างรายละเอียด เพราะคอลัมน์กว้างจำกัด (ข้อ 1 ของงานยุบตาราง)
function StatusChipBadge({ status, compact }: { status: Status; compact?: boolean }) {
  const meta = STATUS_META.find((s) => s.key === status)
  if (!meta) return null
  const c = toneOf(meta.tone)
  return (
    <span
      title={meta.hint}
      style={{
        background: c.bg, color: c.fg, border: `1px solid ${c.ring}`, borderRadius: 999, fontWeight: 700,
        display: "inline-block",
        padding: compact ? "1.5px 7px" : "2px 9px",
        fontSize: compact ? 10.5 : 11.5,
        whiteSpace: compact ? "normal" : "nowrap",
        lineHeight: compact ? 1.35 : undefined,
      }}
    >
      {meta.th}
    </span>
  )
}

function VerdictBadge({ verdict, compact }: { verdict: MinVerdict; compact?: boolean }) {
  const meta = MIN_VERDICT_META[verdict]
  const c = toneOf(VERDICT_TONE[verdict])
  return (
    <span
      title={meta.hint}
      style={{
        background: c.bg, color: c.fg, border: `1px solid ${c.ring}`, borderRadius: 999, fontWeight: 700,
        display: "inline-block",
        padding: compact ? "1.5px 7px" : "2px 9px",
        fontSize: compact ? 10.5 : 11.5,
        whiteSpace: compact ? "normal" : "nowrap",
        lineHeight: compact ? 1.35 : undefined,
      }}
    >
      {meta.th}
    </span>
  )
}

/** แถบเล็กบอกตำแหน่งคงเหลือระหว่าง min–max แบบมองปราดเดียวรู้เรื่อง (ข้อ 1 คอลัมน์ "คงเหลือ")
 *  ต่ำกว่า min = สีส้ม (โทนเดียวกับชิป "ต้องสั่งวันนี้"/"ต่ำกว่า min"), อยู่ในช่วง = สีเขียว (โทนชิป "ปกติ"),
 *  เกิน max = สีฟ้า (โทนชิป "เกิน max") — ใช้พาเลตเดิมของไฟล์นี้ทั้งหมด ไม่มีสีใหม่
 *  ไม่ใช่ตัวบอกความหมายหลัก (ชิปสถานะในคอลัมน์ก่อนหน้ามีคำอธิบายเป็นข้อความอยู่แล้ว) — แถบนี้แค่ช่วยให้เห็นภาพเร็วขึ้น */
function MinMaxBar({ stock, min, max }: { stock: number; min: number; max: number }) {
  if (max <= 0) return null // ไม่ควรเกิดขึ้นจริง (isPartsPolicyRow กรอง max>0 มาแล้ว) — กันพังไว้เฉยๆ
  const domain = Math.max(max, stock, min) * 1.08 || 1
  const pct = (v: number) => Math.min(100, Math.max(0, (v / domain) * 100))
  const zone: "low" | "ok" | "high" = stock < min ? "low" : stock > max ? "high" : "ok"
  const fill = zone === "low" ? TONE_COLORS.orange.fg : zone === "high" ? TONE_COLORS.blue.fg : TONE_COLORS.emerald.fg
  return (
    <div
      title={`คงเหลือ ${num(stock)} — ช่วง min ${num(min)} ถึง max ${num(max)}`}
      style={{ position: "relative", width: "100%", height: 5, background: "#E5E7EB", borderRadius: 999, marginTop: 4 }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(Math.max(0, stock))}%`, background: fill, borderRadius: 999 }} />
      <div style={{ position: "absolute", left: `${pct(min)}%`, top: -2, bottom: -2, width: 2, background: "#6B7280" }} />
      <div style={{ position: "absolute", left: `${pct(max)}%`, top: -2, bottom: -2, width: 2, background: "#6B7280" }} />
    </div>
  )
}

// annualIssue: จำนวนครั้งที่เบิกแปลงเป็น "ครั้ง/ปี" — คำนวณไว้ล่วงหน้าตอน enrich (ต้องใช้ win ซึ่ง sortValue()
// ที่เป็นฟังก์ชันนอก component ไม่มีให้ใช้) ให้ทั้งตัวเรียงและเซลล์ในตารางอ่านค่าเดียวกัน ไม่คำนวณซ้ำคนละที่
type EnrichedRow = { r: SnapshotRow; d: Derived; annualIssue: number }

// leadTimeDays ตัดออกจาก sort key พร้อมกับคอลัมน์ (ข้อ 4) — ทุกแถวใช้เวลารอของนโยบายคงที่ {LEAD_TIME_DAYS} วัน
// เหมือนกันหมดแล้ว เรียงคอลัมน์นี้จึงไม่มีความหมาย (เปรียบเทียบค่าที่วัดได้จริงจะเข้าใจผิดว่าคือค่าที่ใช้คำนวณ)
/** ป้ายแทนแถวที่คนคลังยังไม่ได้กรอกสถานที่จัดเก็บใน ATMS — ใช้เป็นทั้งตัวเลือกในตัวกรองและตัวเรียง
 *  (แถวที่ซิงก์ไว้ก่อน 25/08/2026 ก็ยังไม่มีฟิลด์นี้ ต้องอ่านเป็นค่าว่างได้โดยไม่พัง) */
const NO_LOCATION = "(ยังไม่ระบุ)"
const locationOf = (r: SnapshotRow): string => r.storageLocation?.trim() || NO_LOCATION

/** จำนวนที่สั่งไปแล้วแต่ยังไม่เข้าคลัง — แถวที่ build ไว้ก่อนมีฟีเจอร์นี้ยังไม่มี onOrder ต้องอ่านเป็น 0 ได้ */
const onOrderQtyOf = (r: SnapshotRow): number => r.onOrder?.qty ?? 0

type SortKey =
  | "code" | "name" | "group" | "storageLocation" | "stockQty" | "onOrder" | "minQty" | "maxQty" | "adu" | "issueCount"
  | "rop" | "ss" | "dos" | "status" | "minVerdict" | "suggestQty" | "orderValue"

// daysOfSupply เป็น null สำหรับแถวไม่มีการเบิก (ADU=0 หารไม่ได้) — คืน null ตรงๆ แล้วให้ตัวเปรียบเทียบใน `sorted`
// ดันไปท้ายลิสต์เสมอไม่ว่าจะเรียงขึ้นหรือลง (ข้อ C) ห้าม map เป็นเลข sentinel เพราะการสลับทิศจะพลิกตำแหน่งไปอยู่หัวลิสต์แทน
function sortValue(row: EnrichedRow, key: SortKey): number | string | null {
  switch (key) {
    case "code": return row.r.code
    case "name": return row.r.name
    case "group": return row.r.group
    case "storageLocation": return locationOf(row.r)
    case "onOrder": return onOrderQtyOf(row.r)
    case "stockQty": return row.r.stockQty
    case "minQty": return row.r.minQty
    case "maxQty": return row.r.maxQty
    case "adu": return row.d.adu
    case "issueCount": return row.annualIssue
    case "rop": return row.d.reorderPoint
    case "ss": return row.d.safetyStock
    case "dos": return row.d.daysOfSupply
    case "status": return STATUS_META.findIndex((s) => s.key === row.d.status)
    case "minVerdict": return row.d.minVerdict
    case "suggestQty": return row.d.suggestQty
    case "orderValue": return row.d.suggestQty * row.r.cost
  }
}

/** รายการตัวชี้วัดทั้งหมดที่เรียงได้ — ใช้เติม dropdown "เรียงตาม" เหนือตาราง (ข้อ 1 ของงานยุบตาราง)
 *  หัวคอลัมน์ที่คลิกได้คือ "ตัวหลัก" ของแต่ละคอลัมน์เท่านั้น ส่วน dropdown นี้ครอบคลุมทั้ง 15 ตัวชี้วัดเดิม
 *  รวมตัวที่ย้ายไปอยู่เป็นบรรทัดรองในเซลล์ (min, max, SS, จำนวนครั้งที่เบิก, ตรวจ min, มูลค่า, กลุ่ม, ชื่อ) */
const ORDER_BY_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "orderValue", label: "มูลค่าที่ต้องสั่ง" },
  { key: "suggestQty", label: "แนะนำสั่ง" },
  { key: "status", label: "สถานะ" },
  { key: "minVerdict", label: "ตรวจ min" },
  { key: "rop", label: "ROP (จุดสั่งซื้อ)" },
  { key: "ss", label: "SS (กันขาด)" },
  { key: "dos", label: "พอใช้อีก (วัน)" },
  { key: "adu", label: "เฉลี่ยเบิก/วัน (ADU)" },
  { key: "issueCount", label: "จำนวนครั้งที่เบิก/ปี" },
  { key: "stockQty", label: "คงเหลือ" },
  { key: "onOrder", label: "กำลังสั่งซื้อ" },
  { key: "minQty", label: "min" },
  { key: "maxQty", label: "max" },
  { key: "code", label: "รหัส" },
  { key: "name", label: "ชื่อ" },
  { key: "group", label: "กลุ่ม" },
  { key: "storageLocation", label: "สถานที่จัดเก็บ" },
]

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
  // ส่ง LEAD_TIME_DAYS (นโยบายคงที่) เข้า derive() เหมือนกับตารางหลัก — ให้สถานะ/ROP/SS/ตรวจ min ในหน้าต่างนี้
  // ตรงกับที่แถวในตารางแสดงเป๊ะๆ ไม่ใช่คำนวณจากเวลารอของที่วัดได้จริง (row.leadTimeDays ยังใช้แสดงแยกเป็นข้อมูลอ้างอิงด้านล่าง)
  const d = useMemo(() => derive(row, win, z, LEAD_TIME_DAYS, onOrderQtyOf(row)), [row, win, z])
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

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <StatusChipBadge status={d.status} />
          <VerdictBadge verdict={d.minVerdict} />
          {d.coveredByOrder && (
            <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#DBEAFE", color: "#1D4ED8", border: "1px solid #93C5FD" }}>
              สั่งแล้ว รอของ
            </span>
          )}
        </div>

        {/* ของที่สั่งไปแล้วแต่ยังไม่เข้าคลัง — โชว์เลข PR ให้ตามของต่อได้ทันที ไม่ต้องไปค้นเองในหน้า /pr */}
        {row.onOrder && row.onOrder.qty > 0 && (
          <div style={{ marginTop: 10, borderRadius: 10, border: "1px solid #BFDBFE", background: "#EFF6FF", padding: "10px 12px" }}>
            <div style={{ fontSize: 13, color: "#1E3A8A" }}>
              กำลังสั่งซื้ออยู่ <b>{num(row.onOrder.qty)} {row.unit}</b> จากใบ PR {row.onOrder.prCount} ใบ ·
              {" "}รวมกับคงเหลือแล้วเป็น <b>{num(row.stockQty + row.onOrder.qty)} {row.unit}</b>
            </div>
            <div style={{ fontSize: 11.5, color: "#3B82F6", marginTop: 3, fontFamily: "monospace" }}>
              {row.onOrder.prCodes.join(" · ")}{row.onOrder.prCount > row.onOrder.prCodes.length ? " · …" : ""}
            </div>
            <div style={{ fontSize: 11.5, color: row.onOrder.oldestDays > 30 ? "#B45309" : "#6B7280", marginTop: 3 }}>
              ใบเก่าสุดค้างมา {row.onOrder.oldestDays} วัน
              {row.onOrder.oldestDays > 30 && " — นานกว่าเวลารอของตามนโยบายมาก ควรตามของก่อนสั่งเพิ่ม"}
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
              นับจากใบ PR ที่ซื้อเข้าสต๊อกและยังไม่มีใบรับของ (DD) ครบ อายุไม่เกิน 90 วัน หักส่วนที่รับไปแล้ว ·
              {" "}ใบที่ระบุทะเบียนรถ (อะไหล่ลงคัน) ไม่นับ เพราะรับเข้าแล้วเบิกออกให้รถทันที สต๊อกไม่ได้เพิ่มจริง ·
              {" "}ยอดนี้หักออกจาก &quot;แนะนำสั่ง&quot; ให้แล้ว แต่ไม่นับใน &quot;คงเหลือ&quot; เพราะของยังเบิกไม่ได้
            </div>
          </div>
        )}

        {/* ประโยคภาษาคนแทนที่ตัว ROP/SS ของรหัสนี้เข้าไปตรงๆ — จุดที่มีประโยชน์ที่สุดของนิยาม ROP/SS ทั้งหมด
         *  เพราะผูกกับตัวเลขจริงของรหัสนี้ ไม่ใช่คำอธิบายลอยๆ (ข้อ 2 ของงานยุบตาราง) */}
        <p style={{ fontSize: 13, color: "#065F46", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 10, padding: "10px 12px", marginTop: 10, lineHeight: 1.55 }}>
          ควรสั่งเมื่อของเหลือต่ำกว่า <b>{num(d.reorderPoint)} {row.unit}</b> — ในนั้นเป็นของกันขาด <b>{num(d.safetyStock)} {row.unit}</b>
        </p>

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>ยอดเบิกรายเดือน (12 เดือน)</h4>
        <UsageMiniChart r={row} months={months} />

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>min / max / ROP / SS เทียบกัน</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          {[
            { label: "min (ATMS)", value: row.minQty, title: GLOSSARY.min.desc },
            { label: "max (ATMS)", value: row.maxQty, title: GLOSSARY.max.desc },
            { label: "ROP (คำนวณ)", value: d.reorderPoint, title: GLOSSARY.rop.desc },
            { label: "SS (คำนวณ)", value: d.safetyStock, title: GLOSSARY.ss.desc },
            { label: "คงเหลือ", value: row.stockQty, title: "จำนวนที่มีอยู่จริงในระบบ ATMS ณ เวลาที่ sync ล่าสุด" },
          ].map((x) => (
            <div key={x.label} title={x.title} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "#6B7280", fontWeight: 600 }}>{x.label}</div>
              <div style={{ ...mitr, fontSize: 16, fontWeight: 700, marginTop: 2 }}>{num(x.value)}</div>
            </div>
          ))}
        </div>

        <h4 style={{ ...mitr, fontSize: 13, fontWeight: 700, margin: "18px 0 6px" }}>เวลารอของจริงที่วัดได้ (อ้างอิง)</h4>
        <p style={{ fontSize: 13, color: "#374151", margin: 0 }}>
          <b>{row.leadTimeDays} วัน</b> — <LtBadge source={row.leadTimeSource} samples={row.leadTimeSamples} />
          <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 4 }}>
            สูตร ROP/SS/แนะนำสั่งด้านบนใช้เวลารอของตามนโยบายคงที่ {LEAD_TIME_DAYS} วันสำหรับทุกรายการ ไม่ใช่ตัวเลขนี้ —
            ตัวเลขนี้คือค่าที่วัดได้จริงจากประวัติสั่งซื้อ→รับของ ใช้เทียบดูว่านโยบาย {LEAD_TIME_DAYS} วันตรงกับความเป็นจริงแค่ไหน
          </span>
          {row.leadTimeSource === "warehouse" && (
            <span style={{ display: "block", fontSize: 11.5, color: "#9CA3AF", marginTop: 4 }}>
              เป็นค่ากลางทั้งคลัง (ไม่มีข้อมูล PR→รับของรายรหัสหรือรายกลุ่มพอ) — ใช้ประกอบได้เท่านั้น
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

/** แผงคำอธิบายตัวย่อ — ยุบไว้เป็นค่าเริ่มต้นเสมอ ไม่ดันตารางลง (ข้อ 5) เปิดเมื่อกดเท่านั้น
 *  ใช้ GLOSSARY/STATUS_META/MIN_VERDICT_META ชุดเดียวกับ tooltip หัวตารางและหน้า /safety-stock/baseline
 *  ไม่มีทางเพี้ยนคนละความหมาย เพราะอ่านจากที่เดียวกันทั้งหมด */
function GlossaryPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff", marginBottom: 14, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
          border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#374151", textAlign: "left",
        }}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        คำอธิบายตัวย่อ
        <span style={{ fontWeight: 500, color: "#9CA3AF", fontSize: 12 }}>— ตัวเลขแต่ละตัวหมายถึงอะไร ควรทำอะไรต่อ</span>
      </button>
      {open && (
        <div style={{ padding: "4px 16px 16px", borderTop: "1px solid #F3F4F6" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 10 }}>
            {(Object.keys(GLOSSARY) as (keyof typeof GLOSSARY)[]).map((k) => (
              <div key={k} style={{ background: "#F9FAFB", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111827" }}>{GLOSSARY[k].label}</div>
                <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 2, lineHeight: 1.5 }}>{GLOSSARY[k].desc}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 8 }}>
            หน้านี้ใช้เวลารอของตามนโยบายคงที่ {LEAD_TIME_DAYS} วันกับทุกรายการ (ไม่ใช้ค่าที่วัดได้จริงรายรหัสในการคำนวณ) —
            ดูค่าที่วัดได้จริงเป็นข้อมูลอ้างอิงได้ในหน้าต่างรายละเอียดของแต่ละรหัส
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>สถานะ</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {STATUS_META.map((s) => (
                  <div key={s.key} style={{ fontSize: 11.5, color: "#6B7280" }}>
                    <b style={{ color: "#374151" }}>{s.th}</b> — {s.hint}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>ตรวจ min</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(Object.keys(MIN_VERDICT_META) as MinVerdict[]).map((k) => (
                  <div key={k} style={{ fontSize: 11.5, color: "#6B7280" }}>
                    <b style={{ color: "#374151" }}>{MIN_VERDICT_META[k].th}</b> — {MIN_VERDICT_META[k].hint}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
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
  const [locs, setLocs] = useState<string[]>([])
  const [onlyCovered, setOnlyCovered] = useState(false)
  const [statuses, setStatuses] = useState<Status[]>(["out", "below_rop"])
  const [win, setWin] = useState<WindowKey>(DEFAULT_WINDOW)
  const [service, setService] = useState(95)
  const [selectedRow, setSelectedRow] = useState<SnapshotRow | null>(null)
  const [glossaryOpen, setGlossaryOpen] = useState(false) // ยุบไว้ก่อนเสมอ — ไม่ดันตารางลง (ข้อ 5)
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
    setLocs([])   // ชื่อสถานที่คนละชุดกันคนละคลัง (ลาดกระบัง "B1-1" · สระบุรี "Shelf 4/B")
    setOnlyCovered(false)
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
  // LEAD_TIME_DAYS: นโยบายคงที่ 7 วันสำหรับทุกแถว — r.leadTimeDays (ค่าที่วัดได้จริง) ยังอยู่ในแถวเหมือนเดิม
  // แสดงเป็นข้อมูลอ้างอิงในหน้าต่างรายละเอียดรายรหัสเท่านั้น (RowDialog) ไม่ใช้คำนวณ SS/ROP/แนะนำสั่งอีกต่อไป
  const enriched: EnrichedRow[] = useMemo(() => {
    if (!data) return []
    return data.rows.map((r) => ({ r, d: derive(r, win, z, LEAD_TIME_DAYS, onOrderQtyOf(r)), annualIssue: annualCount(r, win) }))
  }, [data, win, z])

  const groupOptions = useMemo<Record<string, { th: string; en: string }>>(() => {
    if (!data) return {}
    const out: Record<string, { th: string; en: string }> = {}
    for (const g of [...new Set(data.rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, "th"))) {
      out[g] = { th: g, en: "" }
    }
    return out
  }, [data])

  // เรียงแบบ th ให้ "Shelf 1/A" กับ "A1-2" อยู่ในลำดับที่คนอ่านคาดเดาได้ · ดัน "(ยังไม่ระบุ)" ไปท้ายเสมอ
  const locationOptions = useMemo<Record<string, { th: string; en: string }>>(() => {
    if (!data) return {}
    const all = [...new Set(data.rows.map(locationOf))]
      .sort((a, b) => (a === NO_LOCATION ? 1 : b === NO_LOCATION ? -1 : a.localeCompare(b, "th")))
    const out: Record<string, { th: string; en: string }> = {}
    for (const l of all) out[l] = { th: l, en: "" }
    return out
  }, [data])

  // ค้นหา+กลุ่ม ก่อนสถานะ — เพื่อให้จำนวนในวงเล็บของชิปสถานะสะท้อนตัวกรองอื่นที่เลือกอยู่ (ไม่รวมสถานะเอง)
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return enriched.filter(({ r }) => {
      if (needle && !r.code.toLowerCase().includes(needle) && !r.name.toLowerCase().includes(needle)) return false
      if (groups.length && !groups.includes(r.group)) return false
      if (locs.length && !locs.includes(locationOf(r))) return false
      return true
    })
  }, [enriched, q, groups, locs])

  const statusCounts = useMemo(() => {
    const m = new Map<Status, number>()
    for (const { d } of searched) m.set(d.status, (m.get(d.status) ?? 0) + 1)
    return m
  }, [searched])

  // นับจาก searched (ไม่ใช่ filtered) เหมือนชิปสถานะ — เลขในวงเล็บจะได้ไม่กระพริบตามตัวเองตอนกดเปิด/ปิด
  const coveredCount = useMemo(() => searched.filter(({ d }) => d.coveredByOrder).length, [searched])

  const filtered = useMemo(() => {
    let out = searched
    if (statuses.length) out = out.filter(({ d }) => statuses.includes(d.status))
    if (onlyCovered) out = out.filter(({ d }) => d.coveredByOrder)
    return out
  }, [searched, statuses, onlyCovered])

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

  // ปุ่มพลิกทิศแยกต่างหากสำหรับ dropdown "เรียงตาม" — เลือกตัวชี้วัดใหม่จาก <select> เสมอรีเซ็ตเป็น desc
  // (ผ่าน toggleSort เหมือนคลิกหัวคอลัมน์) ส่วนปุ่มนี้แค่พลิกทิศของตัวชี้วัดที่เลือกอยู่ ไม่ยุ่งกับ sortKey
  function flipSortDir() {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"))
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
        สถานที่จัดเก็บ: r.storageLocation ?? "",
        หน่วย: r.unit,
        คงเหลือ: r.stockQty,
        กำลังสั่งซื้อ: onOrderQtyOf(r),
        "คงเหลือ+กำลังสั่งซื้อ": Math.round((r.stockQty + onOrderQtyOf(r)) * 100) / 100,
        "ใบ PR ที่ค้าง (เข้าสต๊อก)": r.onOrder?.prCodes.join(", ") ?? "",
        "PR เก่าสุด (วัน)": r.onOrder ? r.onOrder.oldestDays : "",
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

  // ── ความกว้างคอลัมน์ตาราง (ยุบจาก 15 เหลือ 7 — ต้องไม่เกิดสกอลล์แนวนอนที่จอแล็ปท็อป 1280px) ──
  // ตารางเป็น fluid ไม่ใช่ความกว้างตายตัว: width 100% + minWidth = TABLE_W (พื้น/floor)
  // 6 คอลัมน์ตัวเลข/ชิปด้านล่างล็อกความกว้างตรงตัวผ่าน <col> ในทุกจอ — ไม่ขยับตามพื้นที่ว่าง
  // (กันการจัดแนวตัวเลข/บาร์ min–max ที่ออกแบบไว้ไม่ให้เพี้ยน) ส่วนคอลัมน์ "รหัส/ชื่อ" (COL_ID ด้านล่าง
  // คือ "พื้นขั้นต่ำ" ของมันเท่านั้น) ไม่ตั้ง width ให้ <col> เลย — ตาม algorithm ของ table-layout: fixed
  // คอลัมน์ที่ไม่ระบุ width จะได้พื้นที่ว่างที่เหลือทั้งหมดไปเอง พอดีกับตารางกว้าง = TABLE_W (พื้น)
  // ก็จะได้ 220px เป๊ะเหมือนเดิม แต่ถ้าจอกว้างกว่านั้น คอลัมน์นี้จะขยายรับพื้นที่ส่วนเกินไปเอง ให้ชื่อสินค้า
  // ยาวๆ มีที่แสดงมากขึ้นแทนที่จะโดน ellipsis ตัดทิ้งเร็วเกินจำเป็น — ตารางไม่ปล่อยพื้นที่ว่างทิ้งบนจอกว้าง
  // overflow-x: auto ที่ wrapper ยังอยู่เป็น safety net เมื่อจอแคบกว่า TABLE_W เท่านั้น
  const COL_STATUS = 100
  const COL_ID = 220     // พื้นขั้นต่ำของคอลัมน์ รหัส/ชื่อ (ตรึงซ้าย/sticky) — ใช้คิด TABLE_W เท่านั้น ไม่ตั้งเป็น width จริง
  const COL_LOC = 108    // พอสำหรับ "ห้องเก็บเครื่องมือช่าง" ของสระบุรี (ยาวสุดที่พบ) โดยไม่กิน 1280px จนล้น
  const COL_STOCK = 144
  const COL_ONORDER = 104
  const COL_ROP = 100
  const COL_DOS = 70
  const COL_USAGE = 104
  const COL_SUGGEST = 128
  const TABLE_W = COL_STATUS + COL_ID + COL_LOC + COL_STOCK + COL_ONORDER + COL_ROP + COL_DOS + COL_USAGE + COL_SUGGEST // 1,078 (พื้น/floor)

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

        <GlossaryPanel open={glossaryOpen} onToggle={() => setGlossaryOpen((o) => !o)} />

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
              <MultiSelectCombobox
                options={locationOptions}
                values={locs}
                onChange={setLocs}
                placeholder="— ทุกสถานที่จัดเก็บ —"
                className="min-w-[200px] max-w-[280px] rounded-lg border border-[#E5E7EB] px-2"
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
              {coveredCount > 0 && (
                <button
                  onClick={() => setOnlyCovered((v) => !v)}
                  title="เห็นเฉพาะรหัสที่คงเหลือต่ำจริง แต่มีใบ PR ค้างรับของอยู่แล้วพอจนไม่ต้องสั่งเพิ่ม — กองที่เสี่ยงสั่งซ้ำที่สุด"
                  aria-pressed={onlyCovered}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                    marginLeft: 8, fontWeight: onlyCovered ? 700 : 600,
                    background: onlyCovered ? "#DBEAFE" : "#F9FAFB",
                    color: onlyCovered ? "#1D4ED8" : "#9CA3AF",
                    border: `1.5px solid ${onlyCovered ? "#93C5FD" : "#E5E7EB"}`,
                  }}
                >
                  สั่งแล้ว รอของ ({coveredCount})
                </button>
              )}
            </div>

            {/* ── เรียงตาม — dropdown ครอบคลุมทุกตัวชี้วัด รวมตัวที่ย้ายไปเป็นบรรทัดรองในเซลล์แล้ว (ข้อ 1) ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: "#6B7280", fontWeight: 600 }}>เรียงตาม</span>
              <select
                value={sortKey}
                onChange={(e) => toggleSort(e.target.value as SortKey)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12.5, fontWeight: 600, color: "#374151", background: "#fff", cursor: "pointer" }}
              >
                {ORDER_BY_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={flipSortDir}
                title={sortDir === "asc" ? "น้อย → มาก (กดเพื่อสลับ)" : "มาก → น้อย (กดเพื่อสลับ)"}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}
              >
                {sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {/* ── ตาราง — ยุบเหลือ 7 คอลัมน์ (จากเดิม 15) ให้พอดีจอแล็ปท็อปโดยไม่ต้องเลื่อนแนวนอน
             *  fluid ไม่ใช่ตายตัว: width 100% + minWidth: TABLE_W (พื้น 866px ที่วัดไว้พอดีจอแล็ปท็อป)
             *  colgroup ล็อก 6 คอลัมน์ตัวเลข/ชิปตรงตัวทุกจอ ส่วนคอลัมน์ "รหัส/ชื่อ" ไม่ตั้ง width — รับพื้นที่
             *  ส่วนเกินทั้งหมดไปเอง (table-layout: fixed แบ่งพื้นที่เหลือให้คอลัมน์ที่ไม่ระบุ width)
             *  overflow-x: auto ที่ wrapper ยังอยู่เป็น safety net เมื่อจอแคบกว่าพื้น 866px เท่านั้น ── */}
            <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
              <table style={{ width: "100%", minWidth: TABLE_W, tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
                <colgroup>
                  <col style={{ width: COL_STATUS }} />
                  <col /> {/* รหัส/ชื่อ — ไม่ตั้ง width โดยตั้งใจ ให้ได้พื้นที่ว่างที่เหลือทั้งหมด (ดูคอมเมนต์ COL_ID ด้านบน) */}
                  <col style={{ width: COL_LOC }} />
                  <col style={{ width: COL_STOCK }} />
                  <col style={{ width: COL_ONORDER }} />
                  <col style={{ width: COL_ROP }} />
                  <col style={{ width: COL_DOS }} />
                  <col style={{ width: COL_USAGE }} />
                  <col style={{ width: COL_SUGGEST }} />
                </colgroup>
                <thead>
                  <tr>
                    <SortableTh
                      label="สถานะ" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                      title={"สรุปว่าต้องลงมือทำอะไรกับรหัสนี้ — วางเมาส์บนป้ายแต่ละแถวเพื่อดูรายละเอียด หรือดูแผงคำอธิบายตัวย่อด้านบน\nตรวจ min: เทียบ min ที่ตั้งไว้ใน ATMS กับ ROP ที่คำนวณได้ — วางเมาส์บนป้ายแต่ละแถวเพื่อดูรายละเอียด หรือดูแผงคำอธิบายตัวย่อด้านบน"}
                    />
                    <SortableTh label="รหัส / ชื่อ" colKey="code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} stickyLeft={COL_STATUS} />
                    <SortableTh
                      label="สถานที่จัดเก็บ" colKey="storageLocation" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                      title={"ช่อง/ชั้นที่เก็บของจริงในคลัง — คนคลังกรอกไว้ใน ATMS (หน้าประวัติสต๊อก) ระบบซิงก์มาคืนละครั้ง\nว่าง = ยังไม่ได้กรอกใน ATMS ไม่ใช่ระบบดึงไม่ได้"}
                    />
                    <SortableTh
                      label="คงเหลือ" colKey="stockQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right"
                      title={`จำนวนที่มีอยู่จริงในระบบ ATMS ณ เวลาที่ sync ล่าสุด\nmin: ${GLOSSARY.min.desc}\nmax: ${GLOSSARY.max.desc}`}
                    />
                    <SortableTh
                      label="กำลังสั่งซื้อ" colKey="onOrder" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right"
                      title={"จำนวนที่สั่งไปแล้วแต่ยังไม่เข้าคลัง — รวมจากใบ PR ของคลังนี้ที่ยังไม่มีใบรับของ (DD) ครบ อายุไม่เกิน 90 วัน\nนับเฉพาะของที่ซื้อเข้าสต๊อก — ใบที่ระบุทะเบียนรถ (อะไหล่ลงคัน) กับบรรทัดกลุ่มค่าแรง ไม่นับ\nหักส่วนที่รับของไปแล้วออกแล้ว (PR ใบเดียวแตกเป็นหลาย PO แล้วทยอยรับได้)\nตัวเลขนี้ถูกหักออกจาก \"แนะนำสั่ง\" ให้แล้ว แต่ไม่ถูกนับใน \"คงเหลือ\"/\"พอใช้\" เพราะของยังเบิกไม่ได้"}
                    />
                    <SortableTh
                      label="ROP" colKey="rop" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right"
                      title={`${GLOSSARY.rop.desc} — คำนวณด้วยเวลารอของนโยบายคงที่ ${LEAD_TIME_DAYS} วันทุกรายการ\nSS (กันขาด): ${GLOSSARY.ss.desc}`}
                    />
                    <SortableTh label="พอใช้" colKey="dos" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" title={GLOSSARY.dos.desc} />
                    <SortableTh
                      label="การเบิก" colKey="adu" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right"
                      title={`${GLOSSARY.adu.desc} (จำนวนครั้งที่เบิกแสดงคู่กันเสมอ กันเข้าใจผิดว่า ADU ทศนิยมเล็กๆ ผิดพลาด)`}
                    />
                    <SortableTh
                      label="แนะนำสั่ง" colKey="suggestQty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right"
                      title={`${GLOSSARY.suggestQty.desc}\nมูลค่าที่ต้องสั่ง: แนะนำสั่ง × ราคาทุนล่าสุดที่พบของรหัสนี้`}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ r, d, annualIssue }) => (
                    <tr
                      key={r.code}
                      onClick={() => setSelectedRow(r)}
                      style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
                    >
                      {/* สถานะ — ชิปสถานะ (ตัวหลัก) + ชิปตรวจ min ต่อเมื่อไม่ใช่ unknown (บรรทัดรอง) */}
                      <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                        <StatusChipBadge status={d.status} compact />
                        {d.minVerdict !== "unknown" && (
                          <div style={{ marginTop: 3 }}><VerdictBadge verdict={d.minVerdict} compact /></div>
                        )}
                        {/* ต้องสั่งตามคงเหลือ แต่ของที่สั่งไว้แล้วพอ — จุดที่กันสั่งซ้ำ ต้องเห็นคู่กับชิปสถานะเสมอ */}
                        {d.coveredByOrder && (
                          <div style={{ marginTop: 3 }}>
                            <span
                              title={`สั่งไปแล้ว ${num(onOrderQtyOf(r))} ${r.unit} และยังไม่เข้าคลัง — พอจนไม่ต้องสั่งเพิ่มในรอบนี้`}
                              style={{ display: "inline-block", padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "#DBEAFE", color: "#1D4ED8", border: "1px solid #93C5FD", whiteSpace: "nowrap" }}
                            >
                              สั่งแล้ว รอของ
                            </span>
                          </div>
                        )}
                      </td>

                      {/* รหัส/ชื่อ — ตรึงซ้าย (คอลัมน์ตรึงเดียวที่เหลืออยู่) — รหัส (ตัวหลัก) + ชื่อ + กลุ่ม (บรรทัดรอง) */}
                      <td
                        style={{ padding: "8px 10px", position: "sticky", left: COL_STATUS, background: "#fff", zIndex: 1, verticalAlign: "top" }}
                        title={`${r.code} — ${r.name}${r.group ? ` (${r.group})` : ""}`}
                      >
                        <div style={{ fontFamily: "monospace", fontSize: 11.5 }}>{r.code}</div>
                        <div style={{ fontSize: 12.5, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.group}</div>
                      </td>

                      {/* สถานที่จัดเก็บ — ค่าจาก ATMS ตรงๆ ไม่แปลง · แถวที่ยังไม่ได้กรอกขึ้นขีดเทา ไม่ใช่ช่องว่างเปล่า
                          (ช่องว่างเปล่าอ่านไม่ออกว่า "ยังไม่กรอก" หรือ "ระบบดึงไม่ได้") */}
                      <td style={{ padding: "8px 10px", verticalAlign: "top" }} title={r.storageLocation || "ยังไม่ได้กรอกสถานที่จัดเก็บใน ATMS"}>
                        {r.storageLocation?.trim()
                          ? <span style={{ fontFamily: "monospace", fontSize: 11.5, background: "#F3F4F6", borderRadius: 6, padding: "2px 6px", display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.storageLocation}</span>
                          : <span style={{ color: "#D1D5DB" }}>—</span>}
                      </td>

                      {/* คงเหลือ — คงเหลือ+หน่วย (ตัวหลัก) + min·max (บรรทัดรอง) + แถบตำแหน่งระหว่าง min–max
                       *  overflowWrap: คอลัมน์นี้ความกว้างล็อกตายตัว (ไม่ flex เหมือนรหัส/ชื่อ) — ค่า min/max/คงเหลือ
                       *  ที่เป็นเลขหลักเยอะๆ ต้องตัดขึ้นบรรทัดใหม่แทนที่จะล้นออกนอกเซลล์ (ข้อกังวลเรื่องความกว้างแถว) */}
                      <td
                        style={{ padding: "8px 10px", verticalAlign: "top", overflowWrap: "anywhere" }}
                        title={`จำนวนที่มีอยู่จริงในระบบ ATMS ณ เวลาที่ sync ล่าสุด\nmin: ${GLOSSARY.min.desc}\nmax: ${GLOSSARY.max.desc}`}
                      >
                        <div>{num(r.stockQty)} {r.unit}</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 1 }}>min {num(r.minQty)} · max {num(r.maxQty)}</div>
                        <MinMaxBar stock={r.stockQty} min={r.minQty} max={r.maxQty} />
                      </td>

                      {/* กำลังสั่งซื้อ — จำนวนค้างรับ (ตัวหลัก) + รวมกับคงเหลือ (บรรทัดรอง)
                          แถวที่ไม่มีของค้างขึ้นขีดเทา ไม่ใช่เลข 0 (0 อ่านเหมือน "สั่งแล้วแต่ได้ศูนย์ชิ้น") */}
                      <td
                        style={{ padding: "8px 10px", textAlign: "right", verticalAlign: "top", overflowWrap: "anywhere" }}
                        title={r.onOrder
                          ? `PR ที่ยังไม่มีใบรับของครบ ${r.onOrder.prCount} ใบ · เก่าสุด ${r.onOrder.oldestDays} วัน\n${r.onOrder.prCodes.join(", ")}${r.onOrder.prCount > r.onOrder.prCodes.length ? " …" : ""}`
                          : "ไม่มีใบ PR ที่ค้างรับของสำหรับรหัสนี้"}
                      >
                        {onOrderQtyOf(r) > 0 ? (
                          <>
                            <div style={{ fontWeight: 700, color: "#1D4ED8" }}>+{num(onOrderQtyOf(r))}</div>
                            <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>รวม {num(r.stockQty + onOrderQtyOf(r))}</div>
                            {r.onOrder && r.onOrder.oldestDays > 30 && (
                              <div style={{ fontSize: 10, color: "#B45309" }}>ค้าง {r.onOrder.oldestDays} วัน</div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "#D1D5DB" }}>—</span>
                        )}
                      </td>

                      {/* ROP — จุดสั่งซื้อ (ตัวหลัก) + กันขาด/SS (บรรทัดรอง) */}
                      <td
                        style={{ padding: "8px 10px", textAlign: "right", verticalAlign: "top", overflowWrap: "anywhere" }}
                        title={`${GLOSSARY.rop.desc} — คำนวณด้วยเวลารอของนโยบายคงที่ ${LEAD_TIME_DAYS} วันทุกรายการ\nSS (กันขาด): ${GLOSSARY.ss.desc}`}
                      >
                        <div style={{ fontWeight: 700 }}>{num(d.reorderPoint)}</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>กันขาด {num(d.safetyStock)}</div>
                      </td>

                      {/* พอใช้ — พอใช้อีกกี่วัน */}
                      <td style={{ padding: "8px 10px", textAlign: "right", verticalAlign: "top", overflowWrap: "anywhere" }} title={GLOSSARY.dos.desc}>
                        {d.daysOfSupply === null ? "–" : `${d.daysOfSupply} วัน`}
                      </td>

                      {/* การเบิก — เฉลี่ย/วัน (ตัวหลัก) + จำนวนครั้ง/ปี (บรรทัดรอง)
                       *  overflowWrap: "N.NN/วัน" ไม่มีช่องว่างให้ตัดคำตามปกติ — เลขทศนิยมเยอะๆ (ของหมุนเร็วมาก)
                       *  ต้องบังคับตัดได้ ไม่งั้นล้นออกนอกคอลัมน์ที่ความกว้างล็อกตายตัวไว้ */}
                      <td
                        style={{ padding: "8px 10px", textAlign: "right", verticalAlign: "top", overflowWrap: "anywhere" }}
                        title={`${GLOSSARY.adu.desc} (จำนวนครั้งที่เบิกแสดงคู่กันเสมอ กันเข้าใจผิดว่า ADU ทศนิยมเล็กๆ ผิดพลาด)`}
                      >
                        <div>{d.adu.toFixed(2)}/วัน</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>{annualIssue.toLocaleString()} ครั้ง/ปี</div>
                      </td>

                      {/* แนะนำสั่ง — จำนวนแนะนำ (ตัวหลัก) + มูลค่า (บรรทัดรอง มัวๆ) */}
                      <td
                        style={{ padding: "8px 10px", textAlign: "right", verticalAlign: "top", overflowWrap: "anywhere" }}
                        title={`${GLOSSARY.suggestQty.desc}\nมูลค่าที่ต้องสั่ง: แนะนำสั่ง × ราคาทุนล่าสุดที่พบของรหัสนี้`}
                      >
                        <div style={{ fontWeight: 700 }}>{d.suggestQty > 0 ? `${num(d.suggestQty)} ${r.unit}` : "–"}</div>
                        <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>{baht(d.suggestQty * r.cost)}</div>
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
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
