"use client"
// หน้าหลักของอู่: ยืนยันตัวตนครั้งแรก → แถบภาพ + ขั้นตอน + รายการส่วนที่ต้องกรอก → ตรวจทานและส่ง
// หน้าตาตามเว็บทางการ (2026-09-18): แถบภาพรถ Mena ทับเขียวเข้ม · รายการแบบเส้นคั่น · ปุ่มแคปซูลเขียว
import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Building2, Check, Package, Wrench } from "lucide-react"
import { progress } from "@/lib/rfq-core"
import { BRAND } from "@/lib/vendor-brand"
import { useInvite, V, VendorHeader, StatusNotice, StatusBadge, daysLeft, thDate, type PublicInvite } from "@/components/rfq-vendor-shared"

type Part = { key: string; href: string; icon: ReactNode; title: string; desc: string; done: number; total: number; label: string }

export function RfqVendorHub({ token }: { token: string }) {
  const { data, loading, error, reload, setLocal } = useInvite(token)
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, jobs, parts } = data
  if (!invite.contact && invite.canWrite) return <IdentityStep token={token} invite={invite} onDone={(inv) => setLocal((d) => ({ ...d, invite: inv }))} />
  const pg = progress(invite, jobs, parts)
  const profileDone = invite.profile ? (invite.profile.lat !== undefined ? 2 : 1) : 0
  const sections: Part[] = [
    { key: "profile", href: `/q/${token}/profile`, icon: <Building2 size={20} />, title: "ข้อมูลอู่", desc: "จำนวนช่องซ่อม หนัก/กลาง/เบา · ที่อยู่ · พิกัด", done: profileDone, total: 2,
      label: !invite.profile ? "ยังไม่ได้กรอก" : `ช่องซ่อม ${invite.profile.capacity.bays} · ${invite.profile.lat !== undefined ? "มีพิกัดแล้ว" : "ยังไม่มีพิกัด"}` },
    ...(invite.sections.includes("labour") ? [{ key: "labour", href: `/q/${token}/labour`, icon: <Wrench size={20} />, title: "ค่าแรง", desc: "อัตรา ฿/ชม. ต่อระบบ (ปกติ / นอกสถานที่) · ชั่วโมงที่ใช้ต่องาน",
      done: pg.labour.done + pg.rates.done, total: pg.labour.total + pg.rates.total, label: `อัตราค่าแรง ${pg.rates.done}/${pg.rates.total} ระบบ · ชั่วโมง ${pg.labour.done}/${pg.labour.total} งาน` }] : []),
    ...(invite.sections.includes("parts") ? [{ key: "parts", href: `/q/${token}/parts`, icon: <Package size={20} />, title: "อะไหล่", desc: "ราคาต่อหน่วย Mixer L / S · ยี่ห้อ · รับประกัน · ส่งมอบ",
      done: pg.parts.done, total: pg.parts.total, label: `กรอกแล้ว ${pg.parts.done}/${pg.parts.total} รายการ` }] : []),
  ]
  const blank = (pg.labour.total - pg.labour.done) + (pg.rates.total - pg.rates.done) + (pg.parts.total - pg.parts.done)
  const submitted = invite.status === "ส่งแล้ว" || invite.status === "ยืนยันแล้ว"
  return (
    <div style={V.page}>
      <HubHero invite={invite} />
      <StatusNotice invite={invite} />
      <Stepper steps={[...sections.map((s) => ({ label: s.title, done: s.done, total: s.total })), { label: "ส่งใบเสนอราคา", done: submitted ? 1 : 0, total: 1 }]} />
      <div style={{ ...V.card, padding: 0 }}>
        {sections.map((s, i) => <SectionRow key={s.key} part={s} last={i === sections.length - 1} ro={!invite.canWrite} />)}
      </div>
      {invite.canWrite && <SubmitBox token={token} invite={invite} blank={blank} onDone={reload} />}
      <div style={{ ...V.muted, marginTop: 8, textAlign: "center" }}>ระบบที่ขอราคา: {invite.sheets.join(" · ")}</div>
    </div>
  )
}

/** แถบภาพรถ Mena ทับเขียวเข้ม — ชื่ออู่ รอบ วันปิดรับ สถานะ */
function HubHero({ invite }: { invite: PublicInvite }) {
  const left = daysLeft(invite.deadline)
  return (
    <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 16, color: BRAND.white,
      background: `linear-gradient(100deg, rgba(2,58,30,.95) 0%, rgba(4,97,50,.86) 48%, rgba(4,97,50,.35) 100%), url(/brand/fleet.jpg) center 60% / cover` }}>
      <div style={{ padding: "22px 20px 20px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, opacity: .85 }}>ใบขอราคา · REQUEST FOR QUOTATION</div>
        <h1 style={{ fontSize: 26, fontWeight: 500, margin: "6px 0 2px", lineHeight: 1.3 }}>{invite.vendor}</h1>
        <div style={{ fontSize: 14.5, opacity: .9 }}>{invite.title}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <span style={{ fontSize: 13, padding: "5px 12px", borderRadius: 999, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.3)" }}>
            ปิดรับ {thDate(invite.deadline)}{left !== null && invite.canWrite ? ` · เหลือ ${left} วัน` : ""}
          </span>
          <StatusBadge status={invite.effective} onDark />
        </div>
        {invite.contact && <div style={{ fontSize: 12.5, opacity: .8, marginTop: 12 }}>ผู้ติดต่อ: {invite.contact.name} · {invite.contact.phone || invite.contact.email}</div>}
      </div>
    </div>
  )
}

/** ขั้นตอนแนวนอน: วงกลมเลข → ติ๊กเมื่อครบ · เส้นเชื่อมเขียวเมื่อขั้นก่อนหน้าครบ */
function Stepper({ steps }: { steps: { label: string; done: number; total: number }[] }) {
  return (
    <div style={{ ...V.card, display: "flex", alignItems: "flex-start", padding: "16px 12px" }}>
      {steps.map((s, i) => {
        const full = s.total > 0 && s.done >= s.total
        const some = s.done > 0 && !full
        const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
        const prevFull = i > 0 && steps[i - 1].total > 0 && steps[i - 1].done >= steps[i - 1].total
        return (
          <div key={s.label} style={{ flex: 1, position: "relative", textAlign: "center", minWidth: 0 }}>
            {i > 0 && <div aria-hidden style={{ position: "absolute", top: 15, right: "calc(50% + 20px)", left: "calc(-50% + 20px)", height: 2, background: prevFull ? BRAND.green2 : BRAND.line }} />}
            <div style={{ width: 32, height: 32, margin: "0 auto", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500,
              background: full ? BRAND.green : some ? BRAND.greenTint : BRAND.white, color: full ? BRAND.white : some ? BRAND.green : BRAND.muted, border: `2px solid ${full || some ? BRAND.green : BRAND.line}` }}>
              {full ? <Check size={16} strokeWidth={3} /> : i + 1}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 6, color: full || some ? BRAND.ink : BRAND.muted, fontWeight: full || some ? 500 : 400 }}>{s.label}</div>
            <div style={{ fontSize: 11.5, color: BRAND.muted }}>{s.total > 1 ? `${pct}%` : full ? "เรียบร้อย" : ""}</div>
          </div>
        )
      })}
    </div>
  )
}

/** แถวส่วนที่ต้องกรอก — แบบรายการข่าวบนเว็บทางการ (ไอคอน · ชื่อ · คำอธิบาย · ปุ่มลูกศรกลม) */
function SectionRow({ part: s, last, ro }: { part: Part; last: boolean; ro: boolean }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
  const action = ro ? "ดูข้อมูล" : s.done === 0 ? "เริ่มกรอก" : pct >= 100 ? "แก้ไข" : "กรอกต่อ"
  const start = s.done === 0 && !ro
  return (
    <Link href={s.href} aria-label={`${s.title} — ${action}`} style={{ display: "flex", gap: 14, alignItems: "center", padding: "16px 18px", textDecoration: "none", color: "inherit", borderBottom: last ? "none" : `1px solid ${BRAND.line}` }}>
      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, background: BRAND.greenTint, color: BRAND.green, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 500 }}>{s.title}</div>
        <div style={V.muted}>{s.desc}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 120px", maxWidth: 260, height: 4, borderRadius: 999, background: "#E9ECEF", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? BRAND.green2 : BRAND.green }} /></div>
          <span style={{ fontSize: 12, color: BRAND.muted }}>{s.label}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: start ? BRAND.green : BRAND.white, color: start ? BRAND.white : BRAND.green, border: `1.5px solid ${BRAND.green}` }}><ArrowRight size={18} /></span>
        <span style={{ fontSize: 11.5, color: BRAND.green, fontWeight: 500 }}>{action}</span>
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
    <div style={{ ...V.page, maxWidth: 560 }}>
      <VendorHeader invite={invite} />
      <div style={V.card}>
        <h2 style={V.h2}>ข้อมูลผู้ติดต่อ</h2>
        <div style={{ ...V.muted, marginBottom: 14 }}>กรุณากรอกก่อนเริ่มกรอกใบเสนอราคา</div>
        <label style={V.label}>ชื่อผู้ติดต่อ *</label>
        <input style={V.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ช่างเอ" autoComplete="name" />
        <label style={{ ...V.label, marginTop: 12 }}>เบอร์โทร</label>
        <input style={V.input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08x-xxx-xxxx" autoComplete="tel" />
        <label style={{ ...V.label, marginTop: 12 }}>อีเมล</label>
        <input style={V.input} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="(กรอกเบอร์โทรหรืออีเมลอย่างน้อย 1 อย่าง)" autoComplete="email" />
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, accentColor: BRAND.green }} />
          <span>ยืนยันว่าเสนอราคาในนาม <b style={{ fontWeight: 500 }}>{invite.vendor}</b></span>
        </label>
        {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button style={{ ...V.btnPrimary, marginTop: 16, opacity: busy ? .6 : 1 }} disabled={busy} onClick={() => void go()}>เริ่มกรอกใบเสนอราคา</button>
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
    <div style={V.card}>
      <h2 style={V.h2}>ตรวจทานและส่งใบเสนอราคา</h2>
      <div style={{ ...V.muted, marginTop: 2 }}>{blank ? `ยังเว้นว่าง ${blank} รายการ` : "กรอกครบทุกรายการแล้ว"} · ปิดรับ {thDate(invite.deadline)}</div>
      <label style={{ ...V.label, marginTop: 14 }}>หมายเหตุถึงฝ่ายจัดซื้อ (ถ้ามี)</label>
      <textarea style={{ ...V.input, minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, accentColor: BRAND.green }} />
        <span>รายการที่เว้นว่างไว้ ({blank} รายการ) ถือว่า <b style={{ fontWeight: 500 }}>ไม่เสนอราคา</b> และเมื่อส่งแล้วจะแก้ไขไม่ได้จนกว่าฝ่ายจัดซื้อจะเปิดให้แก้</span>
      </label>
      {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {/* ชื่อปุ่มตามที่ผู้ใช้กำหนด (2026-09-18) — ยาว จึงให้ขึ้น 2 บรรทัด ไทยบน อังกฤษล่าง */}
      <button style={{ ...V.btnPrimary, marginTop: 16, maxWidth: 480, marginLeft: "auto", display: "block", borderRadius: 28, lineHeight: 1.35, padding: "12px 24px", opacity: !ack || busy ? .45 : 1 }} disabled={!ack || busy} onClick={() => void submit()}>
        ยืนยันข้อตกลงอัตราค่าซ่อมและชั่วโมงแรงงานมาตรฐาน
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 400, opacity: .85 }}>Standard Repair Rate &amp; Labor Time Agreement</span>
      </button>
    </div>
  )
}
