"use client"

import { useMemo, useRef, useState } from "react"
import { Image as ImageIcon } from "lucide-react"
import { DeadstockShell, SummaryCards, baht, mitr, useDeadstock } from "@/components/deadstock-shared"
import type { BucketKey, DeadstockPayload } from "@/lib/deadstock-core"

type Metric = "count" | "value"

/** ไล่สีตามความรุนแรงของอายุค้าง — เขียว (เพิ่งรับ) ไปแดงเข้ม (ค้างนาน) */
const AGE_COLOR: Record<BucketKey, string> = {
  "0-7": "#10B981",
  "8-15": "#F59E0B",
  "16-30": "#F97316",
  "31-60": "#DC2626",
  "60+": "#7F1D1D",
}

export function DeadstockMonthlyPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [metric, setMetric] = useState<Metric>("count")
  const slideRef = useRef<HTMLDivElement>(null)
  const [savingPng, setSavingPng] = useState(false)

  const savePng = async () => {
    const el = slideRef.current
    if (!el || savingPng) return
    setSavingPng(true)
    try {
      const { toBlob } = await import("html-to-image")
      const opts = {
        pixelRatio: 2, // 1280×720 → 2560×1440
        backgroundColor: "#ffffff",
        // ข้ามการฝังเว็บฟอนต์ — กัน CORS SecurityError จาก Google Fonts และเร็วกว่า (แพตเทิร์นเดียวกับ /atms-new-sku-report)
        skipFonts: true,
      }
      // Safari/WebKit: การจับภาพครั้งแรกมักได้ภาพเปล่า — วอร์มก่อนแล้วค่อยจับจริง
      await toBlob(el, opts)
      const blob = await toBlob(el, opts)
      if (!blob) throw new Error("capture returned empty image")
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.download = `deadstock-${new Date().toISOString().slice(0, 10)}.png`
      a.href = url
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error("save png failed", e)
      alert(`บันทึก PNG ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingPng(false)
    }
  }

  const pick = (m: { count: number; value: number; staleCount: number; staleValue: number }) =>
    metric === "count" ? { total: m.count, stale: m.staleCount } : { total: m.value, stale: m.staleValue }
  const fmt = (n: number) => (metric === "count" ? n.toLocaleString() : baht(n))

  const max = Math.max(1, ...(data?.monthly.map((m) => pick(m).total) ?? [1]))

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <SummaryCards data={data} />

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <h2 style={{ ...mitr, fontSize: 16, fontWeight: 700, margin: 0 }}>ของค้าง ณ สิ้นแต่ละเดือน</h2>
            <div style={{ display: "flex", gap: 4, background: "#F3F4F6", padding: 3, borderRadius: 999 }}>
              {(
                [
                  ["count", "จำนวนรายการ"],
                  ["value", "มูลค่า"],
                ] as [Metric, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setMetric(k)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: metric === k ? "#111827" : "transparent",
                    color: metric === k ? "#fff" : "#6B7280",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, marginLeft: "auto", fontSize: 12, color: "#6B7280" }}>
              <span>
                <i style={{ display: "inline-block", width: 10, height: 10, background: "#DC2626", borderRadius: 2, marginRight: 5 }} />
                ค้างเกิน {data.staleDays} วัน
              </span>
              <span>
                <i style={{ display: "inline-block", width: 10, height: 10, background: "#D1D5DB", borderRadius: 2, marginRight: 5 }} />
                ค้างไม่เกิน {data.staleDays} วัน
              </span>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "22px 20px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 260 }}>
              {data.monthly.map((m) => {
                const { total, stale } = pick(m)
                const h = (total / max) * 210
                const staleH = total > 0 ? (stale / total) * h : 0
                return (
                  <div key={m.ym} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{fmt(total)}</div>
                    <div
                      title={`${m.ym} — ค้าง ${fmt(total)} (เกิน ${data.staleDays} วัน ${fmt(stale)})`}
                      style={{
                        width: "100%",
                        maxWidth: 62,
                        height: Math.max(h, 2),
                        background: "#D1D5DB",
                        borderRadius: "5px 5px 0 0",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                      }}
                    >
                      <div style={{ height: staleH, background: "#DC2626", borderRadius: h === staleH ? "5px 5px 0 0" : 0 }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
              {data.monthly.map((m) => (
                <div key={m.ym} style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#6B7280" }}>
                  {m.ym.slice(5)}/{m.ym.slice(2, 4)}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18, overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB", textAlign: "right" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>เดือน</th>
                  {["ค้าง (รายการ)", "ค้าง (ชิ้น)", "มูลค่าค้าง", `เกิน ${data.staleDays} วัน (รายการ)`, `เกิน ${data.staleDays} วัน (มูลค่า)`].map(
                    (h) => (
                      <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.ym} style={{ borderBottom: "1px solid #F3F4F6", textAlign: "right" }}>
                    <td style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600 }}>{m.ym}</td>
                    <td style={{ padding: "9px 12px" }}>{m.count.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>{m.qty.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>{baht(m.value)}</td>
                    <td style={{ padding: "9px 12px", color: "#B91C1C", fontWeight: 600 }}>{m.staleCount.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", color: "#B91C1C", fontWeight: 600 }}>{baht(m.staleValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "26px 0 10px", flexWrap: "wrap" }}>
            <h2 style={{ ...mitr, fontSize: 16, fontWeight: 700, margin: 0 }}>ภาพสำหรับนำเสนอ (16:9)</h2>
            <span style={{ fontSize: 12.5, color: "#6B7280" }}>1280 × 720 · บันทึกออกมาที่ 2560 × 1440</span>
            <button
              onClick={savePng}
              disabled={savingPng}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 16px",
                borderRadius: 8,
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: savingPng ? "wait" : "pointer",
              }}
            >
              <ImageIcon size={14} /> {savingPng ? "กำลังบันทึก…" : "บันทึกเป็น PNG"}
            </button>
          </div>

          <div style={{ overflowX: "auto", paddingBottom: 6 }}>
            <DeadstockSlide ref={slideRef} data={data} />
          </div>
        </>
      )}
    </DeadstockShell>
  )
}

/** สไลด์ 16:9 ขนาดคงที่ 1280×720 — ออกแบบเพื่อนำเสนอโดยเฉพาะ ไม่ใช่ภาพหน้าจอของหน้าเว็บ
 *  ใช้ inline style + px คงที่ทั้งหมด เพราะ html-to-image จับภาพจาก DOM จริง
 *  ขนาดที่ยืดตาม viewport จะทำให้ไฟล์ที่ได้ไม่คงที่ */
function DeadstockSlide({ ref, data }: { ref: React.Ref<HTMLDivElement>; data: DeadstockPayload }) {
  const stale = data.staleDays

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; value: number; staleValue: number }>()
    for (const p of data.pending) {
      let g = m.get(p.itemGroup)
      if (!g) m.set(p.itemGroup, (g = { name: p.itemGroup, value: 0, staleValue: 0 }))
      g.value += p.value
      if (p.ageDays > stale) g.staleValue += p.value
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 6)
  }, [data, stale])

  // สไลด์กว้างคงที่ 1280px — เกิน 12 แท่งตัวเลขบนแท่งจะทับกัน จึงตัดเหลือ 12 เดือนล่าสุด
  const slideMonths = data.monthly.slice(-12)
  const maxMonth = Math.max(1, ...slideMonths.map((m) => m.count))
  const maxGroup = Math.max(1, ...groups.map((g) => g.value))
  const maxBucket = Math.max(1, ...data.summary.buckets.map((b) => b.value))
  const first = slideMonths[0]
  const last = slideMonths[slideMonths.length - 1]
  const growth = first && last && first.count > 0 ? Math.round(((last.count - first.count) / first.count) * 100) : 0

  const kpis = [
    { label: "ใบ DD ที่ยังไม่ถูกเบิก", value: data.summary.pendingCount.toLocaleString(), unit: "รายการ", color: "#111827", bg: "#F9FAFB", border: "#E5E7EB" },
    { label: `ค้างเกิน ${stale} วัน`, value: data.summary.staleCount.toLocaleString(), unit: `รายการ · ${baht(data.summary.staleValue)}`, color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
    { label: "มูลค่าที่จมอยู่", value: baht(data.summary.pendingValue), unit: `${data.items.length} รหัสสินค้า`, color: "#0F172A", bg: "#F1F5F9", border: "#CBD5E1" },
  ]

  return (
    <div
      ref={ref}
      style={{
        width: 1280,
        height: 720,
        flexShrink: 0,
        background: "#fff",
        padding: 36,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        color: "#111827",
      }}
    >
      {/* หัวสไลด์ */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <h1 style={{ ...mitr, fontSize: 30, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
            ของค้างคลัง — ใบรับ (DD) ที่ยังไม่ถูกเบิก
          </h1>
          <p style={{ fontSize: 15, color: "#6B7280", margin: "6px 0 0" }}>
            {data.warehouse} · ตั้งแต่ {data.startYm} · ตัดของแบบ FIFO · เฉพาะของที่ซื้อเพื่อรถคันใดคันหนึ่ง
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {kpis.map((k) => (
            <div
              key={k.label}
              style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 12, padding: "10px 16px", minWidth: 152, textAlign: "center" }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6B7280" }}>{k.label}</div>
              <div style={{ ...mitr, fontSize: 27, fontWeight: 700, color: k.color, lineHeight: 1.25 }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "#9CA3AF" }}>{k.unit}</div>
            </div>
          ))}
        </div>
      </div>

      {/* เนื้อสไลด์ */}
      <div style={{ flex: 1, display: "flex", gap: 16, marginTop: 18, minHeight: 0 }}>
        {/* กราฟรายเดือน */}
        <div style={{ flex: "1 1 62%", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <h2 style={{ ...mitr, fontSize: 16, fontWeight: 700, margin: 0 }}>ของค้าง ณ สิ้นแต่ละเดือน</h2>
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>จำนวนรายการ · {slideMonths.length} เดือนล่าสุด</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#6B7280" }}>
              <i style={{ display: "inline-block", width: 9, height: 9, background: "#DC2626", borderRadius: 2, marginRight: 5 }} />
              ค้างเกิน {stale} วัน
            </span>
          </div>
          {growth > 0 && (
            <p style={{ fontSize: 12.5, color: "#B91C1C", fontWeight: 700, margin: "0 0 6px" }}>
              เพิ่มขึ้น {growth}% จาก {first.count} เป็น {last.count} รายการ
            </p>
          )}
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 10, minHeight: 0 }}>
            {slideMonths.map((m) => {
              const h = (m.count / maxMonth) * 100
              const sh = m.count > 0 ? (m.staleCount / m.count) * 100 : 0
              return (
                <div key={m.ym} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{m.count}</div>
                  <div style={{ width: "100%", maxWidth: 56, height: `${h}%`, background: "#D1D5DB", borderRadius: "5px 5px 0 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div style={{ height: `${sh}%`, background: "#DC2626", borderRadius: sh >= 99.5 ? "5px 5px 0 0" : 0 }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {slideMonths.map((m) => (
              <div key={m.ym} style={{ flex: 1, textAlign: "center", fontSize: 11.5, color: "#6B7280" }}>
                {m.ym.slice(5)}/{m.ym.slice(2, 4)}
              </div>
            ))}
          </div>
        </div>

        {/* กลุ่มสินค้า + ช่วงอายุ */}
        <div style={{ flex: "1 1 38%", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ flex: 1, border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <h2 style={{ ...mitr, fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>มูลค่าค้างตามกลุ่มสินค้า</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              {groups.map((g) => (
                <div key={g.name} style={{ display: "grid", gridTemplateColumns: "108px 1fr 74px", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                  <span style={{ display: "block", height: 15, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${(g.value / maxGroup) * 100}%`, height: "100%", background: "#D1D5DB", borderRadius: 4 }}>
                      <span style={{ display: "block", width: `${g.value > 0 ? (g.staleValue / g.value) * 100 : 0}%`, height: "100%", background: "#DC2626", borderRadius: 4 }} />
                    </span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{baht(g.value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 194, border: "1px solid #E5E7EB", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
              <h2 style={{ ...mitr, fontSize: 15, fontWeight: 700, margin: 0 }}>แยกตามอายุค้าง</h2>
              <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>ความสูงแท่ง = มูลค่า · ตัวเลขในวงเล็บ = จำนวนรายการ</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 7, minHeight: 0 }}>
              {data.summary.buckets.map((b) => (
                <div key={b.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 3 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: AGE_COLOR[b.key], whiteSpace: "nowrap" }}>{baht(b.value)}</div>
                  <div
                    title={`${b.label} — ${b.count} รายการ · ${baht(b.value)}`}
                    style={{ width: "100%", maxWidth: 44, height: `${Math.max((b.value / maxBucket) * 100, 2)}%`, background: AGE_COLOR[b.key], borderRadius: "4px 4px 0 0" }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
              {data.summary.buckets.map((b) => (
                <div key={b.key} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: "#374151", fontWeight: 600, whiteSpace: "nowrap" }}>{b.label}</div>
                  <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>({b.count})</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ท้ายสไลด์ */}
      <div style={{ marginTop: 12, fontSize: 11, color: "#9CA3AF", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>ที่มา: ATMS stockmovement · ไม่รวมค่าแรงและของที่รับเข้าสต็อกกลาง</span>
        <span>ยอดเบิกที่หาใบ DD ต้นทางไม่พบ {data.dataQuality.unmatchedIssueQty.toLocaleString()} หน่วย (ของยกมาก่อนปี 2026)</span>
        <span style={{ marginLeft: "auto" }}>ข้อมูล ณ {new Date(data.asOf).toLocaleString("th-TH")}</span>
      </div>
    </div>
  )
}
