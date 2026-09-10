"use client"
// หน้าหลักของอู่: ยืนยันตัวตนครั้งแรก → การ์ด ค่าแรง / อะไหล่ → ส่งใบเสนอราคา
import { useState } from "react"
import Link from "next/link"
import { progress } from "@/lib/rfq-core"
import { useInvite, V, VendorHeader, StatusNotice, thDate, type PublicInvite } from "@/components/rfq-vendor-shared"

export function RfqVendorHub({ token }: { token: string }) {
  const { data, loading, error, reload, setLocal } = useInvite(token)
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, jobs, parts } = data
  if (!invite.contact && invite.canWrite) return <IdentityStep token={token} invite={invite} onDone={(inv) => setLocal((d) => ({ ...d, invite: inv }))} />
  const pg = progress(invite, jobs, parts)
  return (
    <div style={V.page}>
      <VendorHeader invite={invite} />
      <StatusNotice invite={invite} />
      {invite.contact && <div style={{ ...V.muted, marginBottom: 10 }}>ผู้ติดต่อ: {invite.contact.name} · {invite.contact.phone || invite.contact.email}</div>}
      {invite.sections.includes("labour") && <SectionCard href={`/q/${token}/labour`} title="ค่าแรง" desc="งานช่างมาตรฐาน · เสนอรายชั่วโมงหรือเหมา เบา/กลาง/หนัก" done={pg.labour.done} total={pg.labour.total} color="#1B8C4B" />}
      {invite.sections.includes("parts") && <SectionCard href={`/q/${token}/parts`} title="อะไหล่" desc="ราคาต่อหน่วย Mixer L / S · ยี่ห้อ · รับประกัน · ส่งมอบ" done={pg.parts.done} total={pg.parts.total} color="#1D4ED8" />}
      {invite.canWrite && <SubmitBox token={token} invite={invite} blank={(pg.labour.total - pg.labour.done) + (pg.parts.total - pg.parts.done)} onDone={reload} />}
      <div style={{ ...V.muted, marginTop: 16, textAlign: "center" }}>ระบบชีต: {invite.sheets.join(" · ")} · ปิดรับ {thDate(invite.deadline)}</div>
    </div>
  )
}

function SectionCard({ href, title, desc, done, total, color }: { href: string; title: string; desc: string; done: number; total: number; color: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ ...V.card, borderLeft: `5px solid ${color}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={V.muted}>{desc}</div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: "#EEF3EF", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: color }} /></div>
          <div style={{ ...V.muted, marginTop: 4 }}>กรอกแล้ว {done}/{total} รายการ</div>
        </div>
        <span style={{ fontSize: 22, color }}>›</span>
      </div>
    </Link>
  )
}

function IdentityStep({ token, invite, onDone }: { token: string; invite: PublicInvite; onDone: (inv: PublicInvite) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("")
  const [ok, setOk] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true); setErr("")
    try {
      const r = await fetch(`/api/q/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact: { name, phone, email, confirmedVendor: ok } }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      onDone(d.invite)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ก่อนเริ่ม กรุณากรอกข้อมูลผู้ติดต่อ" />
      <div style={V.card}>
        <label style={V.label}>ชื่อผู้ติดต่อ *</label>
        <input style={V.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ช่างเอ" autoComplete="name" />
        <label style={{ ...V.label, marginTop: 12 }}>เบอร์โทร</label>
        <input style={V.input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08x-xxx-xxxx" autoComplete="tel" />
        <label style={{ ...V.label, marginTop: 12 }}>อีเมล</label>
        <input style={V.input} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="(กรอกเบอร์โทรหรืออีเมลอย่างน้อย 1 อย่าง)" autoComplete="email" />
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
          <span>ยืนยันว่าเสนอราคาในนาม <b>{invite.vendor}</b></span>
        </label>
        {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button style={{ ...V.btnPrimary, marginTop: 14, opacity: busy ? .6 : 1 }} disabled={busy} onClick={() => void go()}>เริ่มกรอกใบเสนอราคา</button>
      </div>
      <div style={{ ...V.muted, textAlign: "center" }}>ข้อมูลใช้สำหรับติดต่อกลับเรื่องใบเสนอราคานี้เท่านั้น</div>
    </div>
  )
}

function SubmitBox({ token, invite, blank, onDone }: { token: string; invite: PublicInvite; blank: number; onDone: () => void }) {
  const [ack, setAck] = useState(false); const [note, setNote] = useState(invite.submitNote ?? "")
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setErr("")
    try {
      const r = await fetch(`/api/q/${token}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acknowledgeBlank: ack, submitNote: note }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "ส่งไม่สำเร็จ")
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div style={{ ...V.card, marginTop: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>ส่งใบเสนอราคา</div>
      <label style={{ ...V.label, marginTop: 10 }}>หมายเหตุถึงฝ่ายจัดซื้อ (ถ้ามี)</label>
      <textarea style={{ ...V.input, minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
        <span>รายการที่เว้นว่างไว้ ({blank} รายการ) ถือว่า <b>ไม่เสนอราคา</b> และเมื่อส่งแล้วจะแก้ไขไม่ได้จนกว่าฝ่ายจัดซื้อจะเปิดให้แก้</span>
      </label>
      {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <button style={{ ...V.btnPrimary, marginTop: 14, opacity: !ack || busy ? .5 : 1 }} disabled={!ack || busy} onClick={() => void submit()}>ส่งใบเสนอราคา</button>
    </div>
  )
}
