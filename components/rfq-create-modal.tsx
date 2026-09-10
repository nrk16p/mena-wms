"use client"
// modal สร้างลิงก์ขอราคา: ชื่อรอบ · วันปิดรับ · ตาราง อู่ × ชีต (ค่าตั้งต้นจากช่องที่ติ๊ก) · ส่วน ค่าแรง/อะไหล่ → ลิงก์รายอู่ + ข้อความ LINE
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Copy, X } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import { sheetsForVendor, addDays, SHEET_ORDER, SVC_SHEET, type RfqSection } from "@/lib/rfq-core"
import { mitr } from "@/components/vendor-shared"
import { thDate } from "@/components/rfq-vendor-shared"

type SheetInfo = { sheet: string; title: string; jobs: number; parts: number }
type Created = { id: string; vendor: string; token: string; url: string }

export function RfqCreateModal({ vendors, onClose }: { vendors: { vendor: string; codes: string[] }[]; onClose: () => void }) {
  const [catalog, setCatalog] = useState<SheetInfo[]>([])
  const [title, setTitle] = useState(`ขอราคางานช่าง Mixer ${new Date().toLocaleDateString("th-TH", { month: "short", year: "2-digit" })}`)
  const [deadline, setDeadline] = useState(addDays(bkkToday(), 14))
  const [sections, setSections] = useState<RfqSection[]>(["labour", "parts"])
  const [sheets, setSheets] = useState<Record<string, Set<string>>>(() => Object.fromEntries(vendors.map((v) => [v.vendor, new Set(sheetsForVendor(v.codes))])))
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Created[] | null>(null)
  useEffect(() => { void fetch("/api/rfq/catalog").then((r) => r.json()).then((d) => setCatalog(d.sheets ?? [])).catch(() => setCatalog([])) }, [])
  const cols = useMemo(() => SHEET_ORDER.filter((s) => catalog.some((c) => c.sheet === s)), [catalog])
  const toggle = (vendor: string, s: string) => setSheets((m) => { const n = new Set(m[vendor]); if (s === SVC_SHEET) return m; if (n.has(s)) n.delete(s); else n.add(s); return { ...m, [vendor]: n } })
  async function create() {
    if (!title.trim()) { swalError("กรุณาตั้งชื่อรอบ"); return }
    if (!sections.length) { swalError("เลือกอย่างน้อย 1 ส่วน (ค่าแรง/อะไหล่)"); return }
    setBusy(true)
    try {
      const r = await fetch("/api/rfq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, deadline, invites: vendors.map((v) => ({ vendor: v.vendor, sheets: [...sheets[v.vendor]], sections })) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "สร้างไม่สำเร็จ")
      setCreated(d.invites)
    } catch (e) { swalError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const lineText = (c: Created) => `เรียน ${c.vendor}\nMena Transport ขอเชิญเสนอราคา ${title}\nกรอกได้ที่ลิงก์นี้ (เปิดจากมือถือได้ ไม่ต้องสมัคร): ${c.url}\nปิดรับ ${thDate(deadline)}\nขอบคุณครับ/ค่ะ — ฝ่ายจัดซื้อ`
  const copy = (t: string) => { void navigator.clipboard.writeText(t); swalToast("success", "คัดลอกแล้ว") }
  const inp = { ...mitr, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...mitr, background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 960, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{created ? `สร้างลิงก์แล้ว ${created.length} อู่` : `ขอราคา — ${vendors.length} อู่`}</div>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {!created ? (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
              <label style={{ flex: 2, minWidth: 220 }}><div style={{ fontSize: 12, fontWeight: 600 }}>ชื่อรอบ</div><input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} maxLength={120} /></label>
              <label><div style={{ fontSize: 12, fontWeight: 600 }}>ปิดรับ</div><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inp} /></label>
              <div><div style={{ fontSize: 12, fontWeight: 600 }}>ส่วนที่ให้เสนอ</div>
                {(["labour", "parts"] as const).map((s) => <label key={s} style={{ marginRight: 12, fontSize: 13 }}><input type="checkbox" checked={sections.includes(s)} onChange={(e) => setSections((c) => e.target.checked ? [...new Set([...c, s])] : c.filter((x) => x !== s))} /> {s === "labour" ? "ค่าแรง" : "อะไหล่"}</label>)}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#6B7C72", marginBottom: 6 }}>ค่าตั้งต้นของชีตมาจากช่องที่ติ๊กในตารางความสามารถ · SVC (งานช่างพื้นฐาน) ให้ทุกอู่ · คลิกช่องเพื่อเพิ่ม/ลด</div>
            <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
                <thead><tr style={{ background: "#F6FAF7" }}><th style={{ padding: 6, textAlign: "left", position: "sticky", left: 0, background: "#F6FAF7" }}>อู่</th>{cols.map((s) => { const c = catalog.find((x) => x.sheet === s)!; return <th key={s} title={`${c.title} · งาน ${c.jobs} · อะไหล่ ${c.parts}`} style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap" }}>{s}</th> })}</tr></thead>
                <tbody>{vendors.map((v) => <tr key={v.vendor} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }}>{v.vendor}</td>
                  {cols.map((s) => { const on = sheets[v.vendor].has(s); return <td key={s} onClick={() => toggle(v.vendor, s)} style={{ padding: 6, textAlign: "center", cursor: s === SVC_SHEET ? "default" : "pointer", background: on ? "#ECFDF5" : "#fff", color: on ? "#047857" : "#D1D5DB", fontWeight: 700 }}>{on ? "✓" : "·"}</td> })}
                </tr>)}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={onClose} style={{ ...inp, background: "#fff", cursor: "pointer" }}>ยกเลิก</button>
              <button disabled={busy} onClick={() => void create()} style={{ ...mitr, padding: "8px 16px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: busy ? .6 : 1 }}>สร้างลิงก์</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => copy(created.map(lineText).join("\n\n"))} style={{ ...mitr, display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 14px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}><Copy size={14} /> คัดลอกข้อความ LINE ทั้งหมด</button>
              <Link href="/rfq" style={{ ...inp, textDecoration: "none", color: "#14271C" }}>ไปหน้าใบขอราคาอู่</Link>
            </div>
            {created.map((c) => (
              <div key={c.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{c.vendor}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <code style={{ fontSize: 12, background: "#F6FAF7", padding: "4px 8px", borderRadius: 6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.url}</code>
                  <button onClick={() => copy(c.url)} style={{ ...inp, cursor: "pointer" }}>ลิงก์</button>
                  <button onClick={() => copy(lineText(c))} style={{ ...inp, cursor: "pointer" }}>ข้อความ LINE</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
