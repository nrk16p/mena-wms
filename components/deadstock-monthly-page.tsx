"use client"

import { useState } from "react"
import { DeadstockShell, SummaryCards, baht, mitr, useDeadstock } from "@/components/deadstock-shared"

type Metric = "count" | "value"

export function DeadstockMonthlyPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [metric, setMetric] = useState<Metric>("count")

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
        </>
      )}
    </DeadstockShell>
  )
}
