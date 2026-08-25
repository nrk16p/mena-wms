"use client"

// ตั้งค่า: รหัสค่าแรง → ประเภทงานซ่อม
// ต้นทางแบ่งกลุ่มค่าแรงมาให้แค่บางส่วน ที่เหลือกองรวมอยู่ในกลุ่ม "ค่าแรง" เปล่า ๆ
// ราว 55% ของยอด หน้านี้คือที่ที่คนมาบอกระบบว่ารหัสไหนคืองานระบบอะไร
import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Search, TriangleAlert } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { SERVICE_TYPES, type LabourCode, type ServiceType } from "@/lib/vendor-core"
import { baht, num, mitr } from "@/components/vendor-shared"

export function VendorLabourCodesPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [items, setItems]   = useState<LabourCode[]>([])
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState("")
  const [q, setQ]           = useState("")
  const [onlyTodo, setTodo] = useState(true)
  const [saving, setSaving] = useState("")

  // โหลดครั้งแรก — setState หลัง await เท่านั้น (กัน cascading render)
  useEffect(() => {
    let cancelled = false
    fetch("/api/vendors/labour-codes")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? "ดึงรายการไม่สำเร็จ")
        return (d.items ?? []) as LabourCode[]
      })
      .then((d) => { if (!cancelled) setItems(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoad(false) })
    return () => { cancelled = true }
  }, [])

  /** ยังไม่จัดประเภท = คนยังไม่ตั้ง และเดาจากชื่อไม่ได้ */
  const isTodo = (c: LabourCode) => !c.serviceType && !c.seeded

  const rows = useMemo(() => {
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return items.filter((c) =>
      (!onlyTodo || isTodo(c)) && (!rx || rx.test(c.code) || rx.test(c.itemName)))
  }, [items, q, onlyTodo])

  const todoCount = items.filter(isTodo).length
  const todoBaht  = items.filter(isTodo).reduce((a, c) => a + c.baht, 0)

  async function save(code: string, serviceType: ServiceType | "") {
    setSaving(code)
    try {
      const r = await fetch("/api/vendors/labour-codes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, serviceType }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      setItems((cur) => cur.map((c) => (c.code === code ? { ...c, serviceType } : c)))
      swalToast("success", "บันทึกแล้ว")
    } catch (e) {
      swalError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving("")
    }
  }

  return (
    <div style={{ ...mitr, padding: "20px 24px 48px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#18181B" }}>ตั้งค่า: รหัสค่าแรง → ประเภทงาน</h1>
      <p style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>
        รหัสที่ต้นทางไม่ได้ระบุระบบไว้ ต้องบอกระบบเองว่าเป็นงานประเภทไหน ไม่งั้นจะไปกองอยู่ใน &quot;อื่นๆ&quot;
      </p>
      <p style={{ fontSize: 11.5, color: "#9AA8A0", marginTop: 4, marginBottom: 14 }}>
        แสดงเฉพาะรหัสในกลุ่ม &quot;ค่าแรง&quot; ที่ไม่บอกประเภท — รหัสที่ต้นทางระบุระบบมาแล้วไม่ต้องตั้ง
      </p>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 14,
          background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA", borderRadius: 10, fontSize: 13,
        }}>
          <TriangleAlert size={16} /> {error}
        </div>
      )}

      {todoCount > 0 && (
        <div style={{
          padding: "12px 16px", marginBottom: 12, background: "#FFFBEB",
          border: "1px solid #FDE68A", borderRadius: 12, fontSize: 13, color: "#92400E",
        }}>
          ยังไม่ได้จัดประเภท <b>{num(todoCount)}</b> รหัส คิดเป็น <b>{baht(todoBaht)}</b> —
          จัดให้ครบแล้วหน้า &quot;เลือกอู่ตามประเภทงาน&quot; จะแม่นขึ้นทันที
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหารหัส / ชื่อรายการ"
            style={{ ...mitr, padding: "8px 12px 8px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 280 }}
          />
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setTodo(e.target.checked)} />
          เฉพาะที่ยังไม่ได้จัด
        </label>
        <span style={{ fontSize: 12, color: "#9AA8A0" }}>{num(rows.length)} รหัส</span>
        {!isAdmin && <span style={{ fontSize: 11.5, color: "#9AA8A0" }}>· ดูได้อย่างเดียว ตั้งค่าได้เฉพาะแอดมิน</span>}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>กำลังโหลด…</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {[["รหัส","left"],["ชื่อรายการ","left"],["ครั้ง","right"],["ยอดรวม","right"],["ประเภทงาน","left"]].map(([h, al]) => (
                  <th key={h} style={{
                    padding: "10px 12px", fontWeight: 700, color: "#374151",
                    borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", textAlign: al as "left" | "right",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{c.code}</td>
                  <td style={{ padding: "9px 12px", minWidth: 260 }}>{c.itemName || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>{num(c.jobs)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 600 }}>{baht(c.baht)}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <select
                      value={c.serviceType || ""}
                      disabled={!isAdmin || saving === c.code}
                      onChange={(e) => void save(c.code, e.target.value as ServiceType | "")}
                      style={{
                        ...mitr, padding: "6px 10px", borderRadius: 8, fontSize: 12.5,
                        border: c.serviceType ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                        background: c.serviceType ? "#F6FAF7" : "#fff",
                        cursor: isAdmin ? "pointer" : "not-allowed", minWidth: 200,
                      }}
                    >
                      <option value="">
                        {c.seeded ? `— ใช้ค่าที่ระบบเดา: ${c.seeded} —` : "— ยังไม่จัดประเภท —"}
                      </option>
                      {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
                  {onlyTodo ? "จัดประเภทครบทุกรหัสแล้ว" : "ไม่มีรหัสที่ตรงเงื่อนไข"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
