"use client"

import { useMemo, useState } from "react"
import { Download, Search } from "lucide-react"
import * as XLSX from "xlsx"
import { BucketBadge, DeadstockShell, SummaryCards, baht, thaiDate, useDeadstock } from "@/components/deadstock-shared"
import { AGE_BUCKETS } from "@/lib/deadstock-core"

export function DeadstockPendingPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [bucket, setBucket] = useState("")
  const [group, setGroup] = useState("")

  const groups = useMemo(() => [...new Set(data?.pending.map((p) => p.itemGroup) ?? [])].sort(), [data])

  const rows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.pending.filter(
      (p) =>
        (!bucket || p.bucket === bucket) &&
        (!group || p.itemGroup === group) &&
        (!rx || rx.test(p.dd) || rx.test(p.plate) || rx.test(p.itemCode) || rx.test(p.itemName))
    )
  }, [data, q, bucket, group])

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        "ใบ DD": r.dd,
        วันที่รับ: thaiDate(r.date),
        ทะเบียนรถ: r.plate,
        รหัสสินค้า: r.itemCode,
        ชื่อสินค้า: r.itemName,
        กลุ่มสินค้า: r.itemGroup,
        คงเหลือ: r.remaining,
        ราคาทุน: r.cost,
        มูลค่า: r.value,
        "อายุค้าง (วัน)": r.ageDays,
      }))
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "ของค้าง")
    XLSX.writeFile(wb, `deadstock-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <SummaryCards data={data} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา DD / ทะเบียน / รหัส / ชื่อสินค้า"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 290 }}
              />
            </div>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}
            >
              <option value="">ทุกช่วงอายุ</option>
              {AGE_BUCKETS.map((b) => {
                const n = data.summary.buckets.find((x) => x.key === b.key)?.count ?? 0
                return (
                  <option key={b.key} value={b.key}>
                    {b.label} ({n})
                  </option>
                )
              })}
            </select>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}
            >
              <option value="">ทุกกลุ่มสินค้า</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              แสดง {rows.length.toLocaleString()} / {data.pending.length.toLocaleString()} รายการ ·{" "}
              {baht(rows.reduce((s, r) => s + r.value, 0))}
            </span>
            <button
              onClick={exportXlsx}
              disabled={rows.length === 0}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid #E5E7EB",
                background: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Download size={14} /> Excel
            </button>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["ใบ DD", "วันที่รับ", "ทะเบียนรถ", "รหัสสินค้า", "ชื่อสินค้า", "กลุ่ม", "คงเหลือ", "มูลค่า", "อายุค้าง"].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 12px",
                        fontWeight: 700,
                        color: "#374151",
                        borderBottom: "1px solid #E5E7EB",
                        whiteSpace: "nowrap",
                        textAlign: i >= 6 ? "right" : "left",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.dd}|${r.itemCode}|${r.date}`} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.dd}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{thaiDate(r.date)}</td>
                    <td style={{ padding: "9px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.plate}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.itemCode}</td>
                    <td style={{ padding: "9px 12px", minWidth: 220 }}>{r.itemName}</td>
                    <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{r.itemGroup}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>{r.remaining.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{baht(r.value)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <BucketBadge bucket={r.bucket} days={r.ageDays} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
                      ไม่พบรายการตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DeadstockShell>
  )
}
