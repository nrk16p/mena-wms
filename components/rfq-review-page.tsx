"use client"
// ตรวจใบเสนอราคา 1 ใบ: หัวใบ · แท็บ ค่าแรง / อะไหล่ (อ่านอย่างเดียว) · ยืนยัน / ส่งกลับแก้ · Excel · ประวัติ
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Download } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { canApproveVendor } from "@/lib/roles"
import { bkkToday } from "@/lib/bkk-time"
import { STATUS_META, SHEET_ORDER, addMonths, partKey, progress, effectiveStatus, mapsLink, isCustomJob, type RfqInvite, type RfqJob, type RfqPart, type RfqLogEntry } from "@/lib/rfq-core"
import { mitr } from "@/components/vendor-shared"
import { thDate, thDateTime } from "@/components/rfq-vendor-shared"

type Data = { invite: RfqInvite; jobs: RfqJob[]; parts: RfqPart[] }
const fmt = (n: number | null | undefined) => n == null ? "" : n.toLocaleString("th-TH")
const td = { padding: "6px 8px", borderBottom: "1px solid #F3F4F6", fontSize: 12.5, verticalAlign: "top" as const }
const th = { ...td, fontWeight: 600, background: "#F6FAF7", whiteSpace: "nowrap" as const }

export function RfqReviewPage({ id }: { id: string }) {
  const { data: session } = useSession()
  const approver = canApproveVendor(session?.user?.email)
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<"labour" | "parts">("labour")
  const [log, setLog] = useState<(Omit<RfqLogEntry, "at"> & { at: string })[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const fetchData = useCallback(async (): Promise<Data> => {
    const r = await fetch(`/api/rfq/${id}`, { cache: "no-store" }); const d = await r.json()
    if (!r.ok) throw new Error(d?.error ?? "โหลดไม่สำเร็จ")
    return d
  }, [id])
  const apply = useCallback((d: Data) => {
    setData(d); setTab(d.invite.sections.includes("labour") ? "labour" : "parts")
  }, [])
  // โหลดครั้งแรกใน callback หลัง await เท่านั้น (กัน cascading render)
  useEffect(() => {
    let cancelled = false
    fetchData()
      .then((d) => { if (!cancelled) apply(d) })
      .catch((e) => { if (!cancelled) swalError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [fetchData, apply])
  const load = useCallback(async () => {
    try { apply(await fetchData()) } catch (e) { swalError(e instanceof Error ? e.message : String(e)) }
  }, [fetchData, apply])
  async function act(body: Record<string, unknown>) {
    const r = await fetch(`/api/rfq/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { swalError(d?.error ?? "ไม่สำเร็จ"); return false }
    swalToast("success", "บันทึกแล้ว"); void load(); setLog(null); return true
  }
  async function openLog() { const r = await fetch(`/api/rfq/${id}/log`); const d = await r.json(); setLog(d.log ?? []) }
  if (!data) return <div style={{ ...mitr, color: "#9AA8A0" }}>กำลังโหลด…</div>
  const { invite: inv, jobs, parts } = data
  const eff = effectiveStatus(inv, bkkToday()); const m = STATUS_META[eff]
  const pg = progress(inv, jobs, parts)
  const sheets = SHEET_ORDER.filter((s) => inv.sheets.includes(s))
  return (
    <div style={mitr}>
      <div style={{ fontSize: 12.5, marginBottom: 6 }}><Link href="/rfq" style={{ color: "#0E7490" }}>‹ ใบขอราคาอู่</Link></div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{inv.vendor}</h1>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: m.bg, color: m.fg }}>{eff}</span>
        <span style={{ fontSize: 12.5, color: "#6B7C72" }}>{inv.title} · ปิดรับ {thDate(inv.deadline)} · ชีต {sheets.join(" ")}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <a href={`/api/rfq/${id}/xlsx`} style={{ ...mitr, display: "inline-flex", gap: 6, alignItems: "center", padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, textDecoration: "none", color: "#14271C" }}><Download size={14} /> Excel</a>
          <button onClick={() => void openLog()} style={{ ...mitr, padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>ประวัติ</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Box title="ผู้ติดต่อ">{inv.contact ? <>{inv.contact.name}<br /><span style={{ color: "#6B7C72" }}>{inv.contact.phone} {inv.contact.email}</span></> : <span style={{ color: "#9AA8A0" }}>ยังไม่เปิดลิงก์</span>}</Box>
        <Box title="ความคืบหน้า">ค่าแรง {pg.labour.done}/{pg.labour.total} · อะไหล่ {pg.parts.done}/{pg.parts.total}<br /><span style={{ color: "#6B7C72" }}>เปิด {thDateTime(inv.openedAt)} · ส่ง {thDateTime(inv.submittedAt)}</span></Box>
        <Box title="การยืนยัน">{inv.confirm ? <>ราคามีผล {thDate(inv.confirm.validFrom)} – {thDate(inv.confirm.validTo)}<br /><span style={{ color: "#6B7C72" }}>โดย {inv.confirm.by} · {thDateTime(inv.confirm.at)}{inv.confirm.note && ` · ${inv.confirm.note}`}</span></> : inv.returnNote ? <span style={{ color: "#C2410C" }}>ส่งกลับแก้: {inv.returnNote}</span> : <span style={{ color: "#9AA8A0" }}>—</span>}</Box>
        {inv.submitNote && <Box title="หมายเหตุจากอู่">{inv.submitNote}</Box>}
        {inv.profile && (
          <Box title="ข้อมูลอู่ (อู่กรอกเอง)">
            {inv.profile.lat !== undefined
              ? <a href={mapsLink(inv.profile.lat, inv.profile.lng!)} target="_blank" rel="noreferrer" style={{ color: "#1D4ED8" }}>📍 เปิดแผนที่ ({inv.profile.lat}, {inv.profile.lng})</a>
              : <span style={{ color: "#9AA8A0" }}>ไม่มีพิกัด</span>}
            {inv.profile.address && <div style={{ color: "#6B7C72" }}>{inv.profile.address}</div>}
            <div style={{ marginTop: 4 }}>ช่องซ่อม {inv.profile.capacity.bays} ช่อง <span style={{ color: "#6B7C72" }}>(หนัก {inv.profile.capacity.heavy} · กลาง {inv.profile.capacity.mid} · เบา {inv.profile.capacity.light})</span></div>
          </Box>
        )}
      </div>
      {inv.status === "ส่งแล้ว" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {approver && <button onClick={() => setConfirmOpen(true)} style={{ ...mitr, padding: "9px 16px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}>ยืนยันการเสนอราคา</button>}
          <button onClick={() => { const n = prompt("เหตุผลที่ส่งกลับให้อู่แก้ (อู่จะเห็นข้อความนี้)"); if (n?.trim()) void act({ action: "return", note: n }) }} style={{ ...mitr, padding: "9px 16px", borderRadius: 8, border: "1px solid #C2410C", background: "#fff", color: "#C2410C", fontWeight: 600, cursor: "pointer" }}>ส่งกลับแก้</button>
          {!approver && <span style={{ fontSize: 12, color: "#9AA8A0", alignSelf: "center" }}>ยืนยันได้เฉพาะแอดมินและผู้อนุมัติอู่</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {inv.sections.includes("labour") && <Tab on={tab === "labour"} onClick={() => setTab("labour")} label={`ค่าแรง ${pg.labour.done}/${pg.labour.total}`} color="#1B8C4B" />}
        {inv.sections.includes("parts") && <Tab on={tab === "parts"} onClick={() => setTab("parts")} label={`อะไหล่ ${pg.parts.done}/${pg.parts.total}`} color="#1D4ED8" />}
      </div>
      {tab === "labour" && sheets.map((s) => {
        const list = jobs.filter((j) => j.sheet === s); if (!list.length) return null
        return (
          <div key={s} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 12, overflowX: "auto" }}>
            <div style={{ padding: "8px 10px", fontWeight: 600, background: "#F6FAF7", borderBottom: "1px solid #E5E7EB" }}>{s} · {list[0].sheetTitle}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "งาน", "แบบ", "L ฿/ชม.", "L ชม.", "L เบา", "L กลาง", "L หนัก", "S ฿/ชม.", "S ชม.", "S เบา", "S กลาง", "S หนัก", "ประกัน", "หมายเหตุ"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{list.map((j) => { const a = inv.items[j.jobCode]; return (
                <tr key={j.jobCode} style={{ background: !a ? "#FFFBEB" : a.mode === "skip" ? "#FAFAFA" : "#fff" }}>
                  <td style={td}>{j.seq}</td><td style={{ ...td, minWidth: 200 }}>{j.name}<div style={{ fontSize: 11, color: isCustomJob(j.jobCode) ? "#B45309" : "#9AA8A0" }}>{isCustomJob(j.jobCode) ? "หัวข้อเพิ่มเอง" : `${j.jobCode} · อ้างอิง L ${j.refHoursL ?? "—"} / S ${j.refHoursS ?? "—"} ชม.`}</div></td>
                  <td style={td}>{!a ? <span style={{ color: "#92400E" }}>ไม่กรอก</span> : a.mode === "skip" ? "ไม่รับงาน" : a.mode === "hourly" ? "รายชั่วโมง" : "เหมา"}</td>
                  <td style={td}>{fmt(a?.L.rate)}</td><td style={td}>{fmt(a?.L.hours)}</td><td style={td}>{fmt(a?.L.light)}</td><td style={td}>{fmt(a?.L.mid)}</td><td style={td}>{fmt(a?.L.heavy)}</td>
                  <td style={td}>{fmt(a?.S.rate)}</td><td style={td}>{fmt(a?.S.hours)}</td><td style={td}>{fmt(a?.S.light)}</td><td style={td}>{fmt(a?.S.mid)}</td><td style={td}>{fmt(a?.S.heavy)}</td>
                  <td style={td}>{fmt(a?.warrantyMonths)}</td><td style={{ ...td, minWidth: 140 }}>{a?.note}</td>
                </tr>) })}</tbody>
            </table>
          </div>) })}
      {tab === "parts" && sheets.map((s) => {
        const list = parts.filter((p) => p.sheet === s); if (!list.length) return null
        return (
          <div key={s} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, marginBottom: 12, overflowX: "auto" }}>
            <div style={{ padding: "8px 10px", fontWeight: 600, background: "#F6FAF7", borderBottom: "1px solid #E5E7EB" }}>{s} · {list[0].sheetTitle}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "รหัส", "รายการ", "ใช้กับ", "หน่วย", "฿ L", "฿ S", "ยี่ห้อ/สเปก", "ประกัน", "ส่งมอบ", "หมายเหตุ"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{list.map((p) => { const a = inv.parts[partKey(p.sheet, p.sku)]; return (
                <tr key={p.sku} style={{ background: !a ? "#FFFBEB" : a.skip ? "#FAFAFA" : "#fff" }}>
                  <td style={td}>{p.seq}</td><td style={td}>{p.sku}</td><td style={{ ...td, minWidth: 200 }}>{p.name}</td><td style={td}>{p.useWith}</td><td style={td}>{p.unit}</td>
                  <td style={td}>{!a ? <span style={{ color: "#92400E" }}>ไม่กรอก</span> : a.skip ? "ไม่มีจำหน่าย" : fmt(a.priceL)}</td><td style={td}>{a && !a.skip ? fmt(a.priceS) : ""}</td>
                  <td style={td}>{a?.brand}</td><td style={td}>{fmt(a?.warrantyMonths)}</td><td style={td}>{fmt(a?.leadDays)}</td><td style={{ ...td, minWidth: 140 }}>{a?.note}</td>
                </tr>) })}</tbody>
            </table>
          </div>) })}
      {log && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>ประวัติ</div>
          {!log.length && <div style={{ color: "#9AA8A0", fontSize: 12.5 }}>ไม่มี</div>}
          {log.map((e, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid #F3F4F6" : "none" }}><span style={{ color: "#6B7C72" }}>{thDateTime(e.at)}</span> · <b>{e.action}</b>{e.from && ` ${e.from} → ${e.to}`} · {e.by}{e.note && <span style={{ color: "#6B7C72" }}> · {e.note}</span>}</div>)}
        </div>
      )}
      {confirmOpen && <ConfirmModal onClose={() => setConfirmOpen(false)} onSubmit={async (v) => { if (await act({ action: "confirm", ...v })) setConfirmOpen(false) }} />}
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 10, fontSize: 13 }}><div style={{ fontSize: 11.5, color: "#9AA8A0", fontWeight: 600, marginBottom: 2 }}>{title}</div>{children}</div>
}
function Tab({ on, onClick, label, color }: { on: boolean; onClick: () => void; label: string; color: string }) {
  return <button onClick={onClick} style={{ ...mitr, padding: "7px 14px", borderRadius: 8, border: `1px solid ${on ? color : "#E5E7EB"}`, background: on ? color : "#fff", color: on ? "#fff" : "#14271C", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{label}</button>
}
function ConfirmModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: { validFrom: string; validTo: string; note: string }) => Promise<void> }) {
  const today = bkkToday()
  const [from, setFrom] = useState(today); const [to, setTo] = useState(addMonths(today, 12)); const [note, setNote] = useState("")
  const inp = { ...mitr, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, boxSizing: "border-box" as const }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...mitr, background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>ยืนยันการเสนอราคา</div>
        <label style={{ fontSize: 12.5, fontWeight: 600 }}>ราคามีผลตั้งแต่</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
        <label style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, display: "block" }}>ถึง</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
        <label style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, display: "block" }}>หมายเหตุ</label><input value={note} onChange={(e) => setNote(e.target.value)} style={inp} maxLength={500} />
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...mitr, padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>ยกเลิก</button>
          <button onClick={() => void onSubmit({ validFrom: from, validTo: to, note })} style={{ ...mitr, padding: "8px 14px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}>ยืนยัน</button>
        </div>
      </div>
    </div>
  )
}
