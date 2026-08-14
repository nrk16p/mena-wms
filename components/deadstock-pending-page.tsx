"use client"

import { useMemo, useState } from "react"
import { Download, Search } from "lucide-react"
import * as XLSX from "xlsx"
import { BucketBadge, DeadstockShell, RepurchaseBadge, SummaryCards, baht, mitr, thaiDate, useDeadstock } from "@/components/deadstock-shared"
import { AGE_BUCKETS } from "@/lib/deadstock-core"

type GroupBar = { name: string; value: number; count: number; staleValue: number }

/** แท่งแนวนอน เรียงมูลค่ามากไปน้อย — ส่วนแดง = ค้างเกินเกณฑ์ (ภาษาสีเดียวกับกราฟหน้ารายเดือน)
 *  คลิกแท่งเพื่อกรองกลุ่มนั้น คลิกซ้ำเพื่อยกเลิก */
function GroupBarChart({
  rows,
  staleDays,
  selected,
  onSelect,
}: {
  rows: GroupBar[]
  staleDays: number
  selected: string
  onSelect: (name: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (rows.length === 0) return null

  const max = Math.max(...rows.map((r) => r.value), 1)
  const shown = showAll ? rows : rows.slice(0, 10)
  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ ...mitr, fontSize: 15, fontWeight: 700, margin: 0 }}>มูลค่าค้างตามกลุ่มสินค้า</h2>
        <span style={{ fontSize: 12.5, color: "#6B7280" }}>
          {rows.length} กลุ่ม · รวม {baht(total)}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6B7280" }}>
          <i style={{ display: "inline-block", width: 10, height: 10, background: "#DC2626", borderRadius: 2, marginRight: 5 }} />
          ค้างเกิน {staleDays} วัน
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {shown.map((r) => {
          const active = selected === r.name
          const w = (r.value / max) * 100
          const staleW = r.value > 0 ? (r.staleValue / r.value) * 100 : 0
          return (
            <button
              key={r.name}
              onClick={() => onSelect(r.name)}
              title={`${r.name} — ${baht(r.value)} · ${r.count} รายการ · ค้างเกิน ${staleDays} วัน ${baht(r.staleValue)}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 168px) 1fr minmax(96px, auto)",
                alignItems: "center",
                gap: 10,
                border: "none",
                background: active ? "#F3F4F6" : "transparent",
                borderRadius: 8,
                padding: "3px 6px",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  color: "#374151",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name}
              </span>
              <span style={{ display: "block", height: 18, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${w}%`, height: "100%", background: "#D1D5DB", borderRadius: 4 }}>
                  <span style={{ display: "block", width: `${staleW}%`, height: "100%", background: "#DC2626", borderRadius: 4 }} />
                </span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#111827", textAlign: "right", whiteSpace: "nowrap" }}>
                {baht(r.value)} <span style={{ color: "#9CA3AF", fontWeight: 500 }}>({r.count})</span>
              </span>
            </button>
          )
        })}
      </div>

      {rows.length > 10 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{
            marginTop: 10,
            padding: "5px 12px",
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showAll ? "ย่อ" : `ดูทั้งหมด (${rows.length} กลุ่ม)`}
        </button>
      )}
    </div>
  )
}

export function DeadstockPendingPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [bucket, setBucket] = useState("")
  const [group, setGroup] = useState("")

  const groups = useMemo(() => [...new Set(data?.pending.map((p) => p.itemGroup) ?? [])].sort(), [data])

  // กราฟอิงค้นหา + ช่วงอายุ แต่ไม่อิงตัวกรองกลุ่ม เพื่อให้กราฟทำหน้าที่เป็นตัวเลือกกลุ่มไปในตัว
  const chartRows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.pending.filter(
      (p) =>
        (!bucket || p.bucket === bucket) &&
        (!rx || rx.test(p.dd) || rx.test(p.plate) || rx.test(p.itemCode) || rx.test(p.itemName))
    )
  }, [data, q, bucket])

  const rows = useMemo(() => chartRows.filter((p) => !group || p.itemGroup === group), [chartRows, group])

  /** ยอดต่อกลุ่มสินค้า เรียงมูลค่ามากไปน้อย + แยกส่วนที่ค้างเกินเกณฑ์ */
  const byGroup = useMemo(() => {
    const stale = data?.staleDays ?? 7
    const m = new Map<string, { name: string; value: number; count: number; staleValue: number }>()
    for (const p of chartRows) {
      let g = m.get(p.itemGroup)
      if (!g) m.set(p.itemGroup, (g = { name: p.itemGroup, value: 0, count: 0, staleValue: 0 }))
      g.value += p.value
      g.count += 1
      if (p.ageDays > stale) g.staleValue += p.value
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [chartRows, data])

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
        "ซื้อซ้ำหลังใบนี้ (ใบ)": r.newerCount,
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

          <GroupBarChart
            rows={byGroup}
            staleDays={data.staleDays}
            selected={group}
            onSelect={(name) => setGroup((cur) => (cur === name ? "" : name))}
          />

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
                  {["ใบ DD", "วันที่รับ", "ทะเบียนรถ", "รหัสสินค้า", "ชื่อสินค้า", "กลุ่ม", "คงเหลือ", "มูลค่า", "อายุค้าง", "ซื้อซ้ำ"].map((h, i) => (
                    <th
                      key={h}
                      title={h === "ซื้อซ้ำ" ? "จำนวนใบ DD ของรหัสสินค้าเดียวกันที่รับเข้ามาหลังใบนี้ (นับเฉพาะใบที่ผูกทะเบียนรถ)" : undefined}
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
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <RepurchaseBadge n={r.newerCount} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
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
