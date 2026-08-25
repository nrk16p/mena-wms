"use client"

// "งานซ่อมประเภทนี้ ควรเลือกอู่ไหน" — หน้าหลักของ Vendor List
// เลือกประเภทงาน → เห็นอู่ที่เคยทำจริง พร้อมหลักฐานว่าทำมากี่ครั้ง ราคาเทียบค่ากลาง และยังทำอยู่ไหม
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { TIER_LABEL, type Tier } from "@/lib/vendor-core"
import {
  baht, num, ymThai, mitr, TierBadge, PriceBadge, useVendors, VendorShell,
} from "@/components/vendor-shared"

const TIERS: Tier[] = ["primary", "backup", "unapproved"]

export function VendorByServicePage() {
  const { data, loading, error, reload } = useVendors()
  const [service, setService] = useState("")
  const [q, setQ] = useState("")
  const [tierFilter, setTierFilter] = useState<Tier | "">("")

  // เปิดหน้ามาให้เลือกประเภทที่มียอดสูงสุดไว้ก่อน จะได้ไม่เจอหน้าว่าง
  const active = service || data?.services[0]?.serviceType || ""

  const rows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.byService.filter(
      (r) => r.serviceType === active && (!tierFilter || r.tier === tierFilter) && (!rx || rx.test(r.vendor))
    )
  }, [data, active, q, tierFilter])

  const summary = data?.services.find((s) => s.serviceType === active)

  return (
    <VendorShell
      title="เลือกอู่ตามประเภทงาน"
      subtitle="งานซ่อมประเภทนี้ ที่ผ่านมาใช้อู่ไหนบ้าง และอู่ไหนอนุมัติแล้ว"
      data={data} loading={loading} error={error} reload={reload}
    >
      {data && (
        <>
          {/* ประเภทงาน — เรียงตามยอดเงิน ตัวที่ใช้บ่อยอยู่ต้นแถว */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {data.services.map((s) => {
              const on = s.serviceType === active
              return (
                <button
                  key={s.serviceType}
                  onClick={() => setService(s.serviceType)}
                  title={`${num(s.vendors)} อู่ · ${num(s.jobs)} ครั้ง · ${baht(s.baht)}`}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                    border: on ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                    background: on ? "#1B8C4B" : "#fff",
                    color: on ? "#fff" : "#374151",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {s.serviceType}
                  <span style={{ opacity: 0.75, marginLeft: 6, fontSize: 11 }}>{num(s.vendors)}</span>
                </button>
              )
            })}
          </div>

          {summary && (
            <div style={{
              display: "flex", gap: 24, flexWrap: "wrap", padding: "12px 16px", marginBottom: 12,
              background: "#F6FAF7", border: "1px solid #DCEAE1", borderRadius: 12, fontSize: 13,
            }}>
              <span><b>{num(summary.vendors)}</b> อู่เคยทำงานประเภทนี้</span>
              <span><b>{num(summary.jobs)}</b> ครั้ง</span>
              <span>รวม <b>{baht(summary.baht)}</b></span>
              <span title="มัธยฐานของราคาเฉลี่ยต่อครั้ง คิดข้ามอู่ ไม่ใช่ข้ามบรรทัด — อู่ที่แตกบิลถี่จึงไม่ลากค่ากลาง">
                ค่ากลางต่อครั้ง <b>{baht(summary.medianAvg)}</b>
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาชื่ออู่"
                style={{
                  ...mitr, padding: "8px 12px 8px 30px", borderRadius: 8,
                  border: "1px solid #E5E7EB", fontSize: 13, width: 240,
                }}
              />
            </div>
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => setTierFilter((c) => (c === t ? "" : t))}
                title={TIER_LABEL[t].hint}
                style={{
                  padding: "7px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
                  border: tierFilter === t ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                  background: tierFilter === t ? "#F6FAF7" : "#fff",
                  fontWeight: tierFilter === t ? 700 : 500,
                }}
              >
                {TIER_LABEL[t].th}
              </button>
            ))}
            <span style={{ fontSize: 12, color: "#9AA8A0" }}>{num(rows.length)} อู่</span>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {[
                    ["อู่", "ชื่อผู้ให้บริการตามที่บันทึกในใบรับของ"],
                    ["แนะนำ", "ตัวหลัก = อนุมัติแล้ว + งานถึงเกณฑ์ + ยังใช้อยู่ · สำรอง = อนุมัติแล้วแต่งานน้อยหรือหายไปนาน"],
                    ["ครั้ง", "จำนวนใบรับไม่ซ้ำ ไม่ใช่จำนวนบรรทัด"],
                    ["ยอดรวม", ""],
                    ["เฉลี่ย/ครั้ง", ""],
                    ["เทียบค่ากลาง", "ราคาเฉลี่ยต่อครั้งเทียบมัธยฐานของงานประเภทนี้"],
                    ["ล่าสุด", ""],
                    ["คลัง", "คลังที่เคยตั้งเบิกงานของอู่นี้"],
                  ].map(([h, tip], i) => (
                    <th
                      key={h}
                      title={tip || undefined}
                      style={{
                        padding: "10px 12px", fontWeight: 700, color: "#374151",
                        borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap",
                        textAlign: i >= 2 && i <= 6 ? "right" : "left",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vendor} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "9px 12px", fontWeight: 600, minWidth: 240 }}>{r.vendor}</td>
                    <td style={{ padding: "9px 12px" }}><TierBadge tier={r.tier} /></td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{num(r.jobs)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>{baht(r.baht)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>{baht(r.avg)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}><PriceBadge vsMedian={r.vsMedian} /></td>
                    <td style={{
                      padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap",
                      color: r.monthsSince > 12 ? "#B45309" : "#374151",
                    }}
                      title={r.monthsSince > 12 ? `ไม่ได้ใช้บริการมา ${r.monthsSince} เดือน` : undefined}
                    >
                      {ymThai(r.lastYm)}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 11.5, color: "#6B7280" }}>
                      {r.warehouses.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
                      ไม่มีอู่ที่ตรงเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </VendorShell>
  )
}
