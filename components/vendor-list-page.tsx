"use client"

// รายชื่ออู่ทั้งหมด + อนุมัติรายประเภทงาน
// อนุมัติผูกกับคู่ (อู่ × ประเภทงาน) ไม่ใช่อนุมัติทั้งราย — อู่ที่เก่งระบบแอร์
// ไม่ได้แปลว่าให้ทำเครื่องยนต์ได้ ปุ่มจึงเป็นชิปรายประเภท ไม่ใช่สวิตช์เดียว
import { Fragment, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Check, Search, X } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { SERVICE_TYPES, type ServiceType, type VendorSummary } from "@/lib/vendor-core"
import { baht, num, ymThai, mitr, ServiceChips, useVendors, VendorShell } from "@/components/vendor-shared"

const STATUS_META: Record<VendorSummary["status"], { th: string; bg: string; fg: string; ring: string }> = {
  approved: { th: "อนุมัติแล้ว",  bg: "#ECFDF5", fg: "#047857", ring: "#A7F3D0" },
  rejected: { th: "ไม่อนุมัติ",   bg: "#FEF2F2", fg: "#B91C1C", ring: "#FECACA" },
  pending:  { th: "รอพิจารณา",    bg: "#F4F4F5", fg: "#52525B", ring: "#D4D4D8" },
}

export function VendorListPage() {
  const { data, loading, error, reload } = useVendors()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [q, setQ] = useState("")
  const [statusFilter, setStatusFilter] = useState<VendorSummary["status"] | "">("")
  const [open, setOpen] = useState("")
  const [saving, setSaving] = useState("")
  // ทับผลลัพธ์ที่เพิ่งบันทึกไว้บนข้อมูลเดิม จะได้ไม่ต้องโหลดทั้งหน้าใหม่ทุกคลิก
  const [patched, setPatched] = useState<Record<string, Partial<VendorSummary>>>({})

  const rows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.vendors
      .map((v) => ({ ...v, ...(patched[v.vendor] ?? {}) }))
      .filter((v) => (!statusFilter || v.status === statusFilter) && (!rx || rx.test(v.vendor)))
  }, [data, q, statusFilter, patched])

  async function save(vendor: string, patch: { status?: VendorSummary["status"]; approvedTypes?: ServiceType[] }) {
    setSaving(vendor)
    try {
      const r = await fetch("/api/vendors/approval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, ...patch }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      setPatched((p) => ({ ...p, [vendor]: { ...(p[vendor] ?? {}), ...patch } }))
      swalToast("success", "บันทึกแล้ว")
    } catch (e) {
      swalError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving("")
    }
  }

  function toggleType(v: VendorSummary, t: ServiceType) {
    const cur = v.approvedTypes ?? []
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    // อนุมัติประเภทแรกให้ถือว่าอู่รายนี้ผ่านการอนุมัติไปในตัว ไม่ต้องกดสองที
    void save(v.vendor, { approvedTypes: next, ...(next.length && v.status !== "approved" ? { status: "approved" as const } : {}) })
  }

  return (
    <VendorShell
      title="อู่ทั้งหมด"
      subtitle="ผู้ให้บริการซ่อมที่เคยใช้จริงย้อนหลัง 2 ปี พร้อมสถานะอนุมัติ"
      data={data} loading={loading} error={error} reload={reload}
    >
      {data && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาชื่ออู่"
                style={{ ...mitr, padding: "8px 12px 8px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 260 }}
              />
            </div>
            {(["approved", "pending", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter((c) => (c === s ? "" : s))}
                style={{
                  padding: "7px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
                  border: statusFilter === s ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                  background: statusFilter === s ? "#F6FAF7" : "#fff",
                  fontWeight: statusFilter === s ? 700 : 500,
                }}
              >
                {STATUS_META[s].th}
              </button>
            ))}
            <span style={{ fontSize: 12, color: "#9AA8A0" }}>{num(rows.length)} อู่</span>
            {!isAdmin && <span style={{ fontSize: 11.5, color: "#9AA8A0" }}>· ดูได้อย่างเดียว การอนุมัติทำได้เฉพาะแอดมิน</span>}
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {[["อู่",""],["สถานะ",""],["ประเภทที่เคยทำ","จากประวัติจริง เรียงตามยอดเงิน"],
                    ["ครั้ง",""],["ยอดรวม",""],["ล่าสุด",""],["",""]].map(([h, tip], i) => (
                    <th key={h + i} title={tip || undefined} style={{
                      padding: "10px 12px", fontWeight: 700, color: "#374151",
                      borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap",
                      textAlign: i >= 3 && i <= 5 ? "right" : "left",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const m = STATUS_META[v.status]
                  const isOpen = open === v.vendor
                  return (
                    <Fragment key={v.vendor}>
                      <tr style={{ borderBottom: isOpen ? "none" : "1px solid #F3F4F6" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, minWidth: 240 }}>{v.vendor}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{
                            background: m.bg, color: m.fg, boxShadow: `inset 0 0 0 1px ${m.ring}`,
                            padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                          }}>{m.th}</span>
                          {v.approvedTypes.length > 0 && (
                            <span style={{ fontSize: 11, color: "#9AA8A0", marginLeft: 6 }}>
                              {v.approvedTypes.length} ประเภท
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "9px 12px", minWidth: 260 }}><ServiceChips types={v.didTypes} /></td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{num(v.jobs)}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>{baht(v.baht)}</td>
                        <td style={{
                          padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap",
                          color: v.monthsSince > 12 ? "#B45309" : "#374151",
                        }}>{ymThai(v.lastYm)}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right" }}>
                          <button
                            onClick={() => setOpen(isOpen ? "" : v.vendor)}
                            style={{
                              padding: "5px 10px", borderRadius: 8, border: "1px solid #E5E7EB",
                              background: "#fff", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
                            }}
                          >
                            {isOpen ? "ปิด" : "จัดการ"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr style={{ borderBottom: "1px solid #F3F4F6", background: "#FAFDFB" }}>
                          <td colSpan={7} style={{ padding: "14px 16px" }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, color: "#2F5D45" }}>
                              อนุมัติให้ทำงานประเภทไหนได้บ้าง
                              {saving === v.vendor && <span style={{ color: "#9AA8A0", fontWeight: 400 }}> · กำลังบันทึก…</span>}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                              {SERVICE_TYPES.map((t) => {
                                const on = (v.approvedTypes ?? []).includes(t)
                                const did = v.didTypes.some((d) => d.serviceType === t)
                                return (
                                  <button
                                    key={t}
                                    disabled={!isAdmin || saving === v.vendor}
                                    onClick={() => toggleType(v, t)}
                                    title={did ? "เคยทำงานประเภทนี้จริง" : "ยังไม่เคยมีประวัติงานประเภทนี้"}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 4,
                                      padding: "5px 10px", borderRadius: 999, fontSize: 12,
                                      cursor: isAdmin ? "pointer" : "not-allowed",
                                      border: on ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                                      background: on ? "#1B8C4B" : "#fff",
                                      color: on ? "#fff" : did ? "#374151" : "#9CA3AF",
                                      fontWeight: on ? 700 : 500,
                                      opacity: isAdmin ? 1 : 0.7,
                                    }}
                                  >
                                    {on && <Check size={12} />} {t}
                                  </button>
                                )
                              })}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {(["approved", "pending", "rejected"] as const).map((s) => (
                                <button
                                  key={s}
                                  disabled={!isAdmin || saving === v.vendor}
                                  onClick={() => void save(v.vendor, { status: s })}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    padding: "6px 12px", borderRadius: 8, fontSize: 12.5,
                                    cursor: isAdmin ? "pointer" : "not-allowed",
                                    border: v.status === s ? `1px solid ${STATUS_META[s].fg}` : "1px solid #E5E7EB",
                                    background: v.status === s ? STATUS_META[s].bg : "#fff",
                                    color: v.status === s ? STATUS_META[s].fg : "#374151",
                                    fontWeight: v.status === s ? 700 : 500,
                                  }}
                                >
                                  {s === "rejected" && <X size={12} />} {STATUS_META[s].th}
                                </button>
                              ))}
                              {v.by && (
                                <span style={{ fontSize: 11.5, color: "#9AA8A0" }}>
                                  แก้ล่าสุดโดย {v.by}
                                  {v.at ? ` · ${new Date(v.at).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" })}` : ""}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>ไม่มีอู่ที่ตรงเงื่อนไข</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </VendorShell>
  )
}
