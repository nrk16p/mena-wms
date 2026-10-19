"use client"

// ป๊อปอัปประวัติการซ่อมรายอู่ — เปิดจากหน้า "หาอู่ใกล้ที่สุด"
// ตอบคำถามเดียวก่อนโทร: "เจ้านี้เคยทำงานแบบที่เราจะส่งไหม ทำบ่อยแค่ไหน ครั้งละเท่าไร"
// อู่หลายเจ้าไม่เคยถูกเปิดใบใน WMS แต่มีประวัติจัดซื้อยาวใน ATMS จึงแสดงทั้งสองฝั่ง
import { useEffect, useState } from "react"
import { X, Loader2, TriangleAlert } from "lucide-react"
import { baht, num, ymThai, mitr } from "@/components/vendor-shared"

type ByService = { serviceType: string; jobs: number; baht: number; avg: number; vsMedian: number | null; lastYm: string }
type Job = { receivedDate?: string; completedDate?: string; mrNo?: string; plate?: string; fleetNo?: string; symptom?: string; status?: string; repairPrice?: number; warranty?: string }
type DdItem = { item: string; group: string; qty: number; total: number }
type Dd = { deposit_code?: string; created_at?: string; received_at?: string; grand_total?: number; warehouse?: string; purchase_order?: string; items?: DdItem[] }

type History = {
  vendor: string
  status: string
  totals: { jobs: number; baht: number; lastYm: string; monthsSince: number | null; wmsJobs: number; ddCount: number; ddBaht: number }
  byService: ByService[]
  jobs: Job[]
  dds: Dd[]
  fromYm: string
}

const d10 = (s?: string) => (s ?? "").slice(0, 10)

export function GarageHistoryModal({ vendor, onClose }: { vendor: string; onClose: () => void }) {
  const [data, setData] = useState<History | null>(null)
  const [err, setErr] = useState("")

  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const r = await fetch(`/api/vendors/map/history?vendor=${encodeURIComponent(vendor)}`)
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? "ดึงประวัติไม่สำเร็จ")
        if (!dead) setData(j)
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { dead = true }
  }, [vendor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div onClick={onClose}
      style={{ ...mitr, position: "fixed", inset: 0, background: "rgba(24,24,27,.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 14, width: "min(880px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.28)" }}>

        <div style={{ padding: "14px 18px", borderBottom: "1px solid #F1F1F3", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#18181B" }}>{vendor}</div>
            <div style={{ fontSize: 12, color: "#71717A", marginTop: 2 }}>ประวัติการซ่อมและการจัดซื้อ</div>
          </div>
          <button onClick={onClose} aria-label="ปิด"
            style={{ border: 0, background: "#F4F4F5", borderRadius: 8, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "14px 18px 20px" }}>
          {err && (
            <div style={{ color: "#B91C1C", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
              <TriangleAlert size={14} /> {err}
            </div>
          )}
          {!data && !err && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#71717A", fontSize: 13, padding: "24px 0" }}>
              <Loader2 size={15} className="animate-spin" /> กำลังดึงประวัติ…
            </div>
          )}

          {data && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                <Stat label="งานซ่อม (24 เดือน)" value={num(data.totals.jobs)} unit="ครั้ง" />
                <Stat label="ยอดค่าแรงสะสม" value={baht(data.totals.baht)} />
                <Stat label="ใบรับของ ATMS" value={num(data.totals.ddCount)} unit={`ใบ · ${baht(data.totals.ddBaht)}`} />
                <Stat label="ใช้ล่าสุด" value={data.totals.lastYm ? ymThai(data.totals.lastYm) : "—"}
                  unit={data.totals.monthsSince !== null && data.totals.lastYm ? `${data.totals.monthsSince} เดือนก่อน` : ""} />
              </div>

              <Section title="งานที่เคยทำจริง" hint="นับจากใบเบิกค่าแรงใน ATMS ย้อนหลัง 24 เดือน">
                {data.byService.length === 0
                  ? <Empty>ยังไม่มีประวัติค่าแรงในช่วง 24 เดือน</Empty>
                  : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", color: "#71717A", textAlign: "left" }}>
                          <Th>ประเภทงาน</Th><Th right>ครั้ง</Th><Th right>ยอดรวม</Th><Th right>เฉลี่ย/ครั้ง</Th><Th right>เทียบค่ากลาง</Th><Th right>ล่าสุด</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byService.map((s) => (
                          <tr key={s.serviceType} style={{ borderTop: "1px solid #F4F4F5" }}>
                            <Td>{s.serviceType}</Td>
                            <Td right>{num(s.jobs)}</Td>
                            <Td right>{baht(s.baht)}</Td>
                            <Td right>{baht(s.avg)}</Td>
                            <Td right>
                              {s.vsMedian === null ? <span style={{ color: "#D4D4D8" }}>—</span>
                                : <span style={{ color: Math.abs(s.vsMedian) <= 15 ? "#6B7280" : s.vsMedian > 0 ? "#B45309" : "#047857" }}>
                                    {s.vsMedian > 0 ? "+" : ""}{s.vsMedian}%
                                  </span>}
                            </Td>
                            <Td right>{ymThai(s.lastYm)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </Section>

              <Section title={`ใบซ่อมนอกใน WMS (${data.jobs.length})`} hint="ใบที่เปิดผ่านระบบ WMS เท่านั้น">
                {data.jobs.length === 0
                  ? <Empty>ยังไม่เคยเปิดใบซ่อมนอกกับอู่นี้ใน WMS — แต่ดูประวัติจัดซื้อด้านล่างประกอบได้</Empty>
                  : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", color: "#71717A", textAlign: "left" }}>
                          <Th>วันรับแจ้ง</Th><Th>ทะเบียน</Th><Th>อาการ</Th><Th>สถานะ</Th><Th right>ราคา</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.jobs.map((j, i) => (
                          <tr key={`${j.mrNo}-${i}`} style={{ borderTop: "1px solid #F4F4F5" }}>
                            <Td>{j.receivedDate || "—"}</Td>
                            <Td>{j.plate || j.fleetNo || "—"}</Td>
                            <Td><span title={j.symptom}>{(j.symptom ?? "").slice(0, 46) || "—"}</span></Td>
                            <Td>{j.status || "—"}</Td>
                            <Td right>{j.repairPrice ? baht(j.repairPrice) : "—"}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </Section>

              <Section title={`ใบรับของจาก ATMS (${data.dds.length} ใบล่าสุด)`} hint="ของและค่าแรงที่รับจริงจากอู่นี้">
                {data.dds.length === 0
                  ? <Empty>ไม่มีใบรับของจากอู่นี้</Empty>
                  : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", color: "#71717A", textAlign: "left" }}>
                          <Th>เลขที่</Th><Th>วันที่</Th><Th>รายการ</Th><Th>คลัง</Th><Th right>ยอด</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dds.map((d, i) => (
                          <tr key={`${d.deposit_code}-${i}`} style={{ borderTop: "1px solid #F4F4F5", verticalAlign: "top" }}>
                            <Td>{d.deposit_code || "—"}</Td>
                            <Td>{d10(d.received_at || d.created_at)}</Td>
                            <Td>
                              {/* ชื่อสินค้า/ค่าแรงในใบนั้น — บอกได้จริงว่าอู่นี้ทำอะไรให้บ้าง (ผู้ใช้ขอ 19/10/2569) */}
                              {d.items?.length
                                ? <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                    {d.items.slice(0, 4).map((it, n) => (
                                      <span key={n} title={`${it.item} · ${it.group} · ${num(it.qty)} หน่วย · ${baht(it.total)}`}>
                                        {it.item}{it.qty > 1 ? ` ×${num(it.qty)}` : ""}
                                      </span>
                                    ))}
                                    {d.items.length > 4 && (
                                      <span style={{ color: "#A1A1AA" }} title={d.items.slice(4).map((x) => x.item).join("\n")}>
                                        + อีก {d.items.length - 4} รายการ
                                      </span>
                                    )}
                                  </div>
                                : <span style={{ color: "#D4D4D8" }}>—</span>}
                            </Td>
                            <Td>{d.warehouse || "—"}</Td>
                            <Td right>{baht(d.grand_total ?? 0)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ background: "#FAFAFA", borderRadius: 10, padding: "9px 11px" }}>
      <div style={{ fontSize: 10.5, color: "#71717A" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#18181B", marginTop: 2 }}>{value}</div>
      {unit && <div style={{ fontSize: 10.5, color: "#A1A1AA" }}>{unit}</div>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#18181B" }}>{title}</span>
        {hint && <span style={{ fontSize: 10.5, color: "#A1A1AA" }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <th style={{ padding: "5px 8px", fontWeight: 600, fontSize: 11, textAlign: right ? "right" : "left" }}>{children}</th>
const Td = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <td style={{ padding: "5px 8px", color: "#3F3F46", textAlign: right ? "right" : "left", whiteSpace: right ? "nowrap" : undefined }}>{children}</td>
const Empty = ({ children }: { children: React.ReactNode }) =>
  <div style={{ fontSize: 12, color: "#A1A1AA", padding: "8px 2px" }}>{children}</div>
