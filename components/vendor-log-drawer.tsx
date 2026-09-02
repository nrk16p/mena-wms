"use client"

// ประวัติการแก้ตารางความสามารถของอู่ 1 ราย — ลิ้นชักฝั่งขวา
// เปิดจากปุ่มนาฬิกาในคอลัมน์ชื่ออู่ · ดึงข้อมูลตอนเปิดเท่านั้น (ตารางมี 300+ อู่
// ถ้าโหลดประวัติทุกอู่พร้อมหน้าจะกลายเป็นการยิง DB ทิ้งเปล่าเกือบทั้งหมด)
import { useEffect, useState } from "react"
import { X, History } from "lucide-react"
import { describeVendorLog, fmtLogAt, type VendorLogRow } from "@/lib/vendor-log"
import { mitr } from "@/components/vendor-shared"

const TONE: Record<string, { dot: string; bg: string }> = {
  tick:   { dot: "#1B8C4B", bg: "#F3FAF5" },
  untick: { dot: "#B91C1C", bg: "#FEF6F6" },
  status: { dot: "#0E7490", bg: "#F2FAFB" },
  note:   { dot: "#B45309", bg: "#FFFBF3" },
  codes:  { dot: "#6D28D9", bg: "#F9F7FF" },
}

export function VendorLogDrawer({
  vendor, onClose, onLoaded,
}: {
  vendor: string | null
  onClose: () => void
  /** ส่งประวัติที่โหลดแล้วกลับให้ตารางเอาไปเติม tooltip รายช่อง — ไม่ต้องยิงซ้ำ */
  onLoaded?: (vendor: string, rows: VendorLogRow[]) => void
}) {
  // เก็บผลเป็นก้อนเดียวที่ผูกกับชื่ออู่ แล้วอนุมาน loading จาก "ผลที่มียังไม่ใช่ของอู่นี้"
  // — repo ห้าม setState ตรง ๆ ใน effect (react-hooks/set-state-in-effect) จึงไม่ตั้งธง
  // loading ก่อนยิง และวิธีนี้กัน response ของอู่ก่อนหน้าโผล่ผิดอู่ไปในตัว
  const [res, setRes] = useState<{ vendor: string; rows: VendorLogRow[]; error: string } | null>(null)

  useEffect(() => {
    if (!vendor) return
    let dead = false
    fetch(`/api/vendors/capability/log?vendor=${encodeURIComponent(vendor)}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? "อ่านประวัติไม่สำเร็จ")
        return d as VendorLogRow[]
      })
      .then((d) => {
        if (dead) return
        setRes({ vendor, rows: d, error: "" })
        onLoaded?.(vendor, d)
      })
      .catch((e) => {
        if (dead) return
        setRes({ vendor, rows: [], error: e instanceof Error ? e.message : String(e) })
      })
    return () => { dead = true }
    // onLoaded เป็น callback ของ parent — ไม่ใส่ใน deps จะได้ไม่ยิงซ้ำทุก render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor])

  const ready = !!vendor && res?.vendor === vendor
  const rows = ready ? res.rows : []
  const error = ready ? res.error : ""
  const loading = !!vendor && !ready

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [onClose])

  if (!vendor) return null

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.35)", zIndex: 60 }}
      />
      <aside style={{
        ...mitr,
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 100vw)",
        background: "#fff", zIndex: 61, boxShadow: "-8px 0 28px rgba(0,0,0,.12)",
        display: "flex", flexDirection: "column",
      }}>
        <header style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px",
          borderBottom: "1px solid #E5E7EB",
        }}>
          <History size={18} style={{ color: "#1B8C4B", marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>ประวัติการแก้</div>
            <div style={{ fontSize: 12, color: "#6B7280", wordBreak: "break-word" }}>{vendor}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6B7280", padding: 4 }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ overflow: "auto", padding: "12px 16px 24px", flex: 1 }}>
          {loading && <p style={{ fontSize: 12.5, color: "#9AA8A0" }}>กำลังโหลด…</p>}
          {error && <p style={{ fontSize: 12.5, color: "#B91C1C" }}>{error}</p>}

          {!loading && !error && rows.length === 0 && (
            <p style={{ fontSize: 12.5, color: "#9AA8A0", lineHeight: 1.7 }}>
              ยังไม่มีประวัติของอู่รายนี้
              <br />
              <span style={{ color: "#B8C4BC" }}>
                ระบบเริ่มบันทึกตั้งแต่ 2 ก.ย. 2026 — ช่องที่ติ๊กไว้ก่อนหน้านั้นไม่มีบันทึกว่าใครติ๊ก
              </span>
            </p>
          )}

          {rows.map((r, i) => {
            const t = TONE[r.action] ?? TONE.status
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0" }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 999, background: t.dot,
                  marginTop: 6, flexShrink: 0,
                }} />
                <div style={{ minWidth: 0, flex: 1, background: t.bg, borderRadius: 8, padding: "7px 10px" }}>
                  <div style={{ fontSize: 12.5, color: "#111827", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {describeVendorLog(r)}
                  </div>
                  <div style={{ fontSize: 11, color: "#9AA8A0", marginTop: 2 }}>
                    {r.by || r.byEmail || "ไม่ทราบชื่อ"} · {fmtLogAt(r.at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
