"use client"

// ส่วนที่ 3 หน้าของ Vendor List ใช้ร่วมกัน — โทน/ฟอนต์เดียวกับ /deadstock, /safety-stock
import { useCallback, useEffect, useState } from "react"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { TIER_LABEL, type Tier, type VendorPayload, type ServiceType } from "@/lib/vendor-core"

export const mitr = { fontFamily: "'Mitr', sans-serif" }

export const baht = (n: number) =>
  n.toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 })

export const num = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 0 })

/** "2026-08" → "ส.ค. 69" */
export const ymThai = (ym: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || "")
  if (!m) return "—"
  const MON = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
  return `${MON[+m[2] - 1]} ${String(+m[1] + 543).slice(-2)}`
}

export const TIER_STYLE: Record<Tier, { bg: string; fg: string; ring: string }> = {
  primary:    { bg: "#ECFDF5", fg: "#047857", ring: "#A7F3D0" },
  backup:     { bg: "#FFFBEB", fg: "#92400E", ring: "#FDE68A" },
  unapproved: { bg: "#F4F4F5", fg: "#52525B", ring: "#D4D4D8" },
}

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier]
  return (
    <span
      title={TIER_LABEL[tier].hint}
      style={{
        background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.ring}`,
        padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      {TIER_LABEL[tier].th}
    </span>
  )
}

/** ราคาเทียบค่ากลางของประเภทงานนั้น — เขียวคือถูกกว่า ไม่ใช่ "ดีกว่า" เสมอไป
 *  จึงใช้สีอ่อนและมี tooltip กำกับ ไม่ให้อ่านเป็นคะแนนคุณภาพ */
export function PriceBadge({ vsMedian }: { vsMedian: number | null }) {
  if (vsMedian === null) return <span style={{ color: "#D1D5DB" }}>—</span>
  const near = Math.abs(vsMedian) <= 15
  const c = near ? "#6B7280" : vsMedian > 0 ? "#B45309" : "#047857"
  return (
    <span
      title={`ราคาเฉลี่ยต่อครั้ง เทียบค่ากลางของงานประเภทนี้ (มัธยฐานข้ามอู่)\n${
        near ? "ใกล้เคียงค่ากลาง" : vsMedian > 0 ? "สูงกว่าค่ากลาง" : "ต่ำกว่าค่ากลาง"
      } · ถูกกว่าไม่ได้แปลว่างานดีกว่าเสมอไป ดูจำนวนงานประกอบด้วย`}
      style={{ color: c, fontWeight: near ? 400 : 700, whiteSpace: "nowrap" }}
    >
      {vsMedian > 0 ? "+" : ""}{vsMedian}%
    </span>
  )
}

export function ServiceChips({ types, max = 4 }: { types: { serviceType: ServiceType; jobs: number }[]; max?: number }) {
  const shown = types.slice(0, max)
  const rest = types.length - shown.length
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {shown.map((t) => (
        <span
          key={t.serviceType}
          title={`${t.serviceType} · ${num(t.jobs)} ครั้ง`}
          style={{
            background: "#F6FAF7", color: "#2F5D45", boxShadow: "inset 0 0 0 1px #DCEAE1",
            padding: "1px 7px", borderRadius: 999, fontSize: 11, whiteSpace: "nowrap",
          }}
        >
          {t.serviceType}
        </span>
      ))}
      {rest > 0 && <span style={{ fontSize: 11, color: "#9AA8A0" }}>+{rest}</span>}
    </span>
  )
}

export function useVendors() {
  const [data, setData]       = useState<VendorPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState("")

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError("")
    try {
      const r = await fetch(`/api/vendors${refresh ? "?refresh=1" : ""}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? "ดึงข้อมูลไม่สำเร็จ")
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // โหลดครั้งแรก — setState ทุกตัวเกิดหลัง await เท่านั้น (กัน cascading render)
  // และเช็ค cancelled กันเซ็ต state หลังผู้ใช้ออกจากหน้าไปแล้ว
  useEffect(() => {
    let cancelled = false
    fetch("/api/vendors")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? "ดึงข้อมูลไม่สำเร็จ")
        return d as VendorPayload
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { data, loading, error, reload: load }
}

export function VendorShell({
  title, subtitle, data, loading, error, reload, children,
}: {
  title: string
  subtitle: string
  data: VendorPayload | null
  loading: boolean
  error: string
  reload: (refresh?: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div style={{ ...mitr, padding: "20px 24px 48px", maxWidth: 1500, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#18181B" }}>{title}</h1>
          <p style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>{subtitle}</p>
        </div>
        <button
          onClick={() => reload(true)}
          disabled={loading}
          title="ดึงข้อมูลใหม่จากต้นทาง (ปกติ cache ไว้ 1 ชั่วโมง)"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff",
            fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} /> รีเฟรช
        </button>
      </div>

      {data && (
        <p style={{ fontSize: 11.5, color: "#9AA8A0", marginBottom: 14 }}>
          ข้อมูล {ymThai(data.fromYm)} – {ymThai(data.asOfYm)} · จากรายการซื้อค่าแรงซ่อมใน ATMS
          {data.unclassified.codes > 0 && (
            <span style={{ color: "#B45309" }}>
              {" · "}ยังมีรหัสค่าแรง {num(data.unclassified.codes)} รหัส ({baht(data.unclassified.baht)}) ที่ยังไม่ได้จัดประเภท
            </span>
          )}
        </p>
      )}

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 14,
          background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA", borderRadius: 10, fontSize: 13,
        }}>
          <TriangleAlert size={16} /> {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ padding: 60, textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>กำลังโหลด…</div>
      ) : (
        children
      )}
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  )
}
