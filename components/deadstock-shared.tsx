"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertTriangle, PackageX, RefreshCw } from "lucide-react"
import type { BucketKey, DeadstockPayload } from "@/lib/deadstock-core"

export const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

export const baht = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })

/** สีตามช่วงอายุ — ยิ่งค้างนานยิ่งแดง */
export const BUCKET_STYLE: Record<BucketKey, { bg: string; fg: string; ring: string }> = {
  "0-7": { bg: "#ECFDF5", fg: "#047857", ring: "#A7F3D0" },
  "8-15": { bg: "#FEFCE8", fg: "#A16207", ring: "#FDE68A" },
  "16-30": { bg: "#FFF7ED", fg: "#C2410C", ring: "#FED7AA" },
  "31-60": { bg: "#FEF2F2", fg: "#B91C1C", ring: "#FECACA" },
  "60+": { bg: "#7F1D1D", fg: "#FFFFFF", ring: "#7F1D1D" },
}

export function BucketBadge({ bucket, days }: { bucket: BucketKey; days: number }) {
  const s = BUCKET_STYLE[bucket]
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.ring}`,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {days} วัน
    </span>
  )
}

/** "ซื้อซ้ำ" — จำนวนใบ DD ของรหัสเดียวกันที่รับเข้ามาหลังใบนี้ ทั้งที่ใบนี้ยังไม่ถูกเบิก
 *  0 = ไม่ได้ซื้อซ้ำ แสดงเป็นขีดจาง เพื่อให้สายตาไปจับเฉพาะตัวที่มีปัญหา */
export function RepurchaseBadge({ n }: { n: number }) {
  if (n <= 0) return <span style={{ color: "#D1D5DB" }}>–</span>
  const heavy = n >= 4
  return (
    <span
      title={`มีใบ DD ของรหัสนี้รับเข้ามาหลังใบนี้อีก ${n} ใบ ทั้งที่ใบนี้ยังไม่ถูกเบิก`}
      style={{
        background: heavy ? "#7C2D12" : "#FFF7ED",
        color: heavy ? "#fff" : "#C2410C",
        border: `1px solid ${heavy ? "#7C2D12" : "#FED7AA"}`,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      +{n} ใบ
    </span>
  )
}

async function fetchDeadstock(refresh: boolean): Promise<DeadstockPayload> {
  const res = await fetch(`/api/deadstock${refresh ? "?refresh=1" : ""}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useDeadstock() {
  const [data, setData] = useState<DeadstockPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchDeadstock(refresh))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // โหลดครั้งแรก — setState ทุกตัวเกิดหลัง await เท่านั้น (กัน cascading render)
  // และเช็ค cancelled กันเซ็ต state หลังผู้ใช้ออกจากหน้าไปแล้ว
  useEffect(() => {
    let cancelled = false
    fetchDeadstock(false)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { data, error, loading, reload }
}

const TABS = [
  { href: "/deadstock", label: "ภาพรายเดือน" },
  { href: "/deadstock/pending", label: "สถานะล่าสุด" },
  { href: "/deadstock/items", label: "รายรหัสสินค้า" },
  { href: "/deadstock/baseline", label: "นิยามตัวชี้วัด" },
]

export function DeadstockShell({
  data,
  loading,
  error,
  reload,
  children,
}: {
  data: DeadstockPayload | null
  loading: boolean
  error: string | null
  reload: (refresh?: boolean) => void
  children: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <PackageX size={26} color="#B91C1C" />
        <h1 style={{ ...mitr, fontSize: 24, fontWeight: 700, margin: 0 }}>ของค้างคลัง (DD ที่ยังไม่ถูกเบิก)</h1>
        <button
          onClick={() => reload(true)}
          disabled={loading}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> รีเฟรช
        </button>
      </div>
      <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 14px" }}>
        {data?.warehouse ?? "คลังลาดกระบัง"} · ตั้งแต่ {data?.startYm ?? "2026-01"} · ตัดของแบบ FIFO · เน้นรายการที่ค้างเกิน{" "}
        {data?.staleDays ?? 7} วัน
      </p>

      <nav style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                padding: "7px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "none",
                background: active ? "#111827" : "#F3F4F6",
                color: active ? "#fff" : "#374151",
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: "#FEF2F2", color: "#B91C1C", marginBottom: 16 }}>
          โหลดข้อมูลไม่สำเร็จ: {error}
        </div>
      )}
      {loading && !data && <p style={{ color: "#6B7280" }}>กำลังคำนวณ FIFO…</p>}
      {data && children}
      {data && <DataQualityNote data={data} />}
    </div>
  )
}

export function SummaryCards({ data }: { data: DeadstockPayload }) {
  const s = data.summary
  const over60 = s.buckets.find((b) => b.key === "60+")
  const cards = [
    { label: "ค้างทั้งหมด", value: `${s.pendingCount.toLocaleString()} รายการ`, sub: baht(s.pendingValue), tone: "#111827" },
    { label: `ค้างเกิน ${data.staleDays} วัน`, value: `${s.staleCount.toLocaleString()} รายการ`, sub: baht(s.staleValue), tone: "#B91C1C" },
    { label: "ค้างเกิน 60 วัน", value: `${(over60?.count ?? 0).toLocaleString()} รายการ`, sub: baht(over60?.value ?? 0), tone: "#7F1D1D" },
    { label: "รหัสสินค้าที่ค้าง", value: `${data.items.length.toLocaleString()} รายการ`, sub: `${s.pendingQty.toLocaleString()} ชิ้น`, tone: "#374151" },
  ]
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{c.label}</div>
          <div style={{ ...mitr, fontSize: 22, fontWeight: 700, color: c.tone, marginTop: 2 }}>{c.value}</div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

/** ข้อจำกัดของข้อมูล — ต้องแสดงเสมอ ห้ามซ่อน (ระบุไว้ใน spec ข้อ 4) */
function DataQualityNote({ data }: { data: DeadstockPayload }) {
  return (
    <div
      style={{
        marginTop: 24,
        padding: "12px 16px",
        borderRadius: 10,
        background: "#F9FAFB",
        border: "1px solid #E5E7EB",
        fontSize: 12.5,
        color: "#4B5563",
        lineHeight: 1.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#374151", marginBottom: 4 }}>
        <AlertTriangle size={14} /> ข้อจำกัดของข้อมูล
      </div>
      • FIFO เริ่มนับที่ {data.startYm} ของที่รับเข้ามาก่อนหน้านั้นไม่ปรากฏ — มียอดเบิก{" "}
      <b>{data.dataQuality.unmatchedIssueQty.toLocaleString()}</b> หน่วยที่หาใบ DD ต้นทางมาตัดไม่เจอ
      <br />• แสดงเฉพาะของที่ระบุทะเบียนรถในหมายเหตุ — ของที่รับเข้าสต็อกกลางอีก{" "}
      <b>{data.dataQuality.stockLayersRemaining.toLocaleString()}</b> ชั้นถูกนำไปร่วมตัด FIFO แล้วแต่ไม่แสดงในตาราง
      <br />• ไม่รวมรายการค่าแรง · ข้อมูล ณ {new Date(data.asOf).toLocaleString("th-TH")}
    </div>
  )
}
