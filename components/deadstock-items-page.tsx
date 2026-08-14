"use client"

import { Fragment, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { BucketBadge, DeadstockShell, baht, thaiDate, useDeadstock } from "@/components/deadstock-shared"
import { ITEM_AGE_FILTERS, matchesAgeFilter, rollupItems } from "@/lib/deadstock-core"

export function DeadstockItemsPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [age, setAge] = useState<string>("")
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (code: string) =>
    setOpen((prev) => {
      const s = new Set(prev)
      if (s.has(code)) s.delete(code)
      else s.add(code)
      return s
    })

  // กรองที่ระดับใบ DD ก่อน แล้วรวมยอดต่อรหัสสินค้าใหม่ — จำนวนใบ/คงเหลือ/มูลค่า/ค้างนานสุด
  // จึงสะท้อนเฉพาะใบที่เข้าช่วงอายุ ไม่ใช่ยอดเดิมทั้งรหัส
  const layersInScope = useMemo(
    () => (data ? data.pending.filter((p) => matchesAgeFilter(age, p.ageDays)) : []),
    [data, age]
  )

  const items = useMemo(() => {
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return rollupItems(layersInScope).filter(
      (i) => !rx || rx.test(i.itemCode) || rx.test(i.itemName) || rx.test(i.itemGroup)
    )
  }, [layersInScope, q])

  const countFor = (key: string) =>
    data ? new Set(data.pending.filter((p) => matchesAgeFilter(key, p.ageDays)).map((p) => p.itemCode)).size : 0

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหารหัส / ชื่อ / กลุ่มสินค้า"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 290 }}
              />
            </div>
            <div style={{ display: "flex", gap: 4, background: "#F3F4F6", padding: 3, borderRadius: 999, flexWrap: "wrap" }}>
              {ITEM_AGE_FILTERS.map((f) => (
                <button
                  key={f.key || "all"}
                  onClick={() => setAge(f.key)}
                  style={{
                    padding: "5px 13px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    background: age === f.key ? "#111827" : "transparent",
                    color: age === f.key ? "#fff" : "#6B7280",
                  }}
                >
                  {f.label} ({countFor(f.key)})
                </button>
              ))}
            </div>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              {items.length.toLocaleString()} รหัสสินค้า · {layersInScope.length.toLocaleString()} ใบ DD ·{" "}
              {baht(items.reduce((s, i) => s + i.value, 0))}
            </span>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["", "รหัสสินค้า", "ชื่อสินค้า", "กลุ่ม", "ใบ DD ค้าง", "คงเหลือ", "มูลค่า", "ค้างนานสุด"].map((h, i) => (
                    <th
                      key={h || `col${i}`}
                      style={{
                        padding: "10px 12px",
                        fontWeight: 700,
                        color: "#374151",
                        borderBottom: "1px solid #E5E7EB",
                        whiteSpace: "nowrap",
                        textAlign: i >= 4 ? "right" : "left",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const isOpen = open.has(it.itemCode)
                  const layers = isOpen ? layersInScope.filter((p) => p.itemCode === it.itemCode) : []
                  return (
                    <Fragment key={it.itemCode}>
                      <tr onClick={() => toggle(it.itemCode)} style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}>
                        <td style={{ padding: "9px 12px", width: 28 }}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{it.itemCode}</td>
                        <td style={{ padding: "9px 12px", minWidth: 220 }}>{it.itemName}</td>
                        <td style={{ padding: "9px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>{it.itemGroup}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.layers}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.remaining.toLocaleString()}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{baht(it.value)}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{it.oldestAgeDays} วัน</td>
                      </tr>
                      {isOpen &&
                        layers.map((l) => (
                          <tr key={`${it.itemCode}|${l.dd}|${l.date}`} style={{ background: "#FAFAFA", borderBottom: "1px solid #F3F4F6" }}>
                            <td />
                            <td style={{ padding: "7px 12px", fontFamily: "monospace", fontSize: 12 }}>{l.dd}</td>
                            <td style={{ padding: "7px 12px", fontSize: 12, color: "#6B7280" }}>
                              รับ {thaiDate(l.date)} · ทะเบียน <b>{l.plate}</b>
                            </td>
                            <td />
                            <td />
                            <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 12 }}>{l.remaining.toLocaleString()}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontSize: 12 }}>{baht(l.value)}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right" }}>
                              <BucketBadge bucket={l.bucket} days={l.ageDays} />
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
                      ไม่พบรหัสสินค้าตามเงื่อนไข
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
