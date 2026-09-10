"use client"
// รายการลิงก์ขอราคา — สถานะ ความคืบหน้า คัดลอกลิงก์ ต่ออายุ ยกเลิก
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Copy, RefreshCw, CalendarPlus, XCircle } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { canApproveVendor } from "@/lib/roles"
import { STATUS_META, addDays, type EffectiveStatus, type RfqInvite } from "@/lib/rfq-core"
import { mitr, num } from "@/components/vendor-shared"
import { thDate, thDateTime } from "@/components/rfq-vendor-shared"

type Row = Omit<RfqInvite, "items" | "parts"> & { answered: { labour: number; parts: number }; total: { labour: number; parts: number }; effective: EffectiveStatus }
const ALL: EffectiveStatus[] = ["สร้างแล้ว", "กำลังกรอก", "ส่งแล้ว", "ส่งกลับแก้", "ยืนยันแล้ว", "หมดอายุ", "ยกเลิก"]

export function RfqListPage() {
  const { data: session } = useSession()
  const approver = canApproveVendor(session?.user?.email)
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true)
  const [q, setQ] = useState(""); const [st, setSt] = useState<EffectiveStatus | "">(""); const [title, setTitle] = useState("")
  const fetchRows = useCallback(async (): Promise<Row[]> => {
    const r = await fetch("/api/rfq", { cache: "no-store" }); const d = await r.json()
    if (!r.ok) throw new Error(d?.error ?? "โหลดไม่สำเร็จ")
    return d.invites
  }, [])
  // โหลดครั้งแรกใน callback หลัง await เท่านั้น (แพตเทิร์นเดียวกับ vendor-shared)
  useEffect(() => {
    let cancelled = false
    fetchRows()
      .then((rows) => { if (!cancelled) setRows(rows) })
      .catch((e) => { if (!cancelled) swalError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchRows])
  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await fetchRows()) }
    catch (e) { swalError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [fetchRows])
  const titles = useMemo(() => [...new Set(rows.map((r) => r.title))], [rows])
  const shown = rows.filter((r) => (!st || r.effective === st) && (!title || r.title === title) && (!q || (r.vendor + r.title + (r.contact?.name ?? "")).toLowerCase().includes(q.toLowerCase())))
  const counts = ALL.map((s) => [s, rows.filter((r) => r.effective === s).length] as const).filter(([, n]) => n)
  const copy = (r: Row) => { void navigator.clipboard.writeText(`${location.origin}/q/${r.token}`); swalToast("success", "คัดลอกลิงก์แล้ว") }
  async function act(r: Row, action: "extend" | "cancel") {
    let body: Record<string, unknown> = { action }
    if (action === "extend") { const d = prompt("วันปิดรับใหม่ (YYYY-MM-DD)", addDays(r.deadline, 7)); if (!d) return; body = { action, deadline: d } }
    if (action === "cancel" && !confirm(`ยกเลิกลิงก์ของ ${r.vendor}?`)) return
    const res = await fetch(`/api/rfq/${r._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalError(d?.error ?? "ไม่สำเร็จ"); return }
    swalToast("success", "บันทึกแล้ว"); void load()
  }
  const pill = (s: EffectiveStatus) => { const m = STATUS_META[s]; return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.fg, whiteSpace: "nowrap" }}>{s}</span> }
  const bar = (done: number, total: number, color: string) => total ? <div title={`${done}/${total}`} style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 70, height: 6, borderRadius: 999, background: "#EEF3EF", overflow: "hidden" }}><div style={{ width: `${Math.round(done / total * 100)}%`, height: "100%", background: color }} /></div><span style={{ fontSize: 11.5, color: "#6B7C72" }}>{done}/{total}</span></div> : <span style={{ fontSize: 11.5, color: "#B8C4BC" }}>—</span>
  return (
    <div style={{ ...mitr }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>ใบขอราคาอู่</h1>
        <span style={{ fontSize: 12.5, color: "#6B7C72" }}>สร้างลิงก์ใหม่ได้จากหน้า <Link href="/vendors" style={{ color: "#0E7490" }}>ตารางความสามารถอู่</Link> (เลือกอู่ → ขอราคา)</span>
        <button onClick={() => void load()} style={{ ...mitr, marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}><RefreshCw size={14} /> โหลดใหม่</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={() => setSt("")} style={{ ...mitr, padding: "5px 11px", borderRadius: 999, fontSize: 12, border: !st ? "1px solid #0E7490" : "1px solid #E5E7EB", background: !st ? "#ECFEFF" : "#fff", cursor: "pointer" }}>ทั้งหมด {num(rows.length)}</button>
        {counts.map(([s, n]) => <button key={s} onClick={() => setSt(st === s ? "" : s)} style={{ ...mitr, padding: "5px 11px", borderRadius: 999, fontSize: 12, border: st === s ? "1px solid #0E7490" : "1px solid #E5E7EB", background: STATUS_META[s].bg, color: STATUS_META[s].fg, cursor: "pointer" }}>{s} {n}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาอู่ / รอบ / ผู้ติดต่อ" style={{ ...mitr, padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 260 }} />
        <select value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...mitr, padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}><option value="">ทุกรอบ</option>{titles.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </div>
      <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#F6FAF7", textAlign: "left" }}>{["อู่", "รอบ", "ชีต", "สถานะ", "ค่าแรง", "อะไหล่", "เปิดครั้งแรก", "ส่งเมื่อ", "ปิดรับ", "ราคามีผลถึง", ""].map((h) => <th key={h} style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={11} style={{ padding: 20, color: "#9AA8A0" }}>กำลังโหลด…</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={11} style={{ padding: 20, color: "#9AA8A0" }}>ไม่มีรายการ</td></tr>}
            {shown.map((r) => (
              <tr key={r._id} style={{ borderTop: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}><Link href={`/rfq/${r._id}`} style={{ color: "#14271C", textDecoration: "none" }}>{r.vendor}</Link>{r.contact && <div style={{ fontSize: 11, color: "#9AA8A0", fontWeight: 400 }}>{r.contact.name} · {r.contact.phone || r.contact.email}</div>}</td>
                <td style={{ padding: "8px 10px" }}>{r.title}</td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, color: "#6B7C72" }}>{r.sheets.join(" ")}</td>
                <td style={{ padding: "8px 10px" }}>{pill(r.effective)}</td>
                <td style={{ padding: "8px 10px" }}>{r.sections.includes("labour") ? bar(r.answered.labour, r.total.labour, "#1B8C4B") : "—"}</td>
                <td style={{ padding: "8px 10px" }}>{r.sections.includes("parts") ? bar(r.answered.parts, r.total.parts, "#1D4ED8") : "—"}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6B7C72" }}>{thDateTime(r.openedAt)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#6B7C72" }}>{thDateTime(r.submittedAt)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{thDate(r.deadline)}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.confirm ? thDate(r.confirm.validTo) : "—"}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  <button title="คัดลอกลิงก์" onClick={() => copy(r)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#0E7490" }}><Copy size={15} /></button>
                  {["สร้างแล้ว", "กำลังกรอก", "ส่งกลับแก้", "หมดอายุ"].includes(r.effective) && <button title="ต่ออายุ" onClick={() => void act(r, "extend")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#92400E" }}><CalendarPlus size={15} /></button>}
                  {approver && r.effective !== "ยืนยันแล้ว" && r.effective !== "ยกเลิก" && <button title="ยกเลิก" onClick={() => void act(r, "cancel")} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B91C1C" }}><XCircle size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
