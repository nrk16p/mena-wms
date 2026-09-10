"use client"
// หน้าอะไหล่: ชีตละขั้น · แถวละรายการ กะทัดรัด · ค้นหาในชีต · "ไม่มีจำหน่าย"
import { useEffect, useMemo, useRef, useState } from "react"
import { SHEET_ORDER, partKey, type RfqPartAnswer, type RfqPart } from "@/lib/rfq-core"
import { useInvite, useAutosave, V, VendorHeader, StatusNotice, SaveBadge, toNum } from "@/components/rfq-vendor-shared"

const EMPTY: RfqPartAnswer = { skip: false, sameAsL: true, brand: "", note: "", at: "" }
const isBlank = (a: RfqPartAnswer) =>
  !a.skip && a.priceL === undefined && a.priceS === undefined && !a.brand && a.warrantyMonths === undefined && a.leadDays === undefined && !a.note

export function RfqVendorParts({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  const { save, flush, state, savedAt, errorMsg } = useAutosave(token)
  const [step, setStep] = useState(0)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)   // แถวที่กางช่อง ยี่ห้อ/รับประกัน/ส่งมอบ/หมายเหตุ
  const sheets = useMemo(() => data ? SHEET_ORDER.filter((s) => data.invite.sheets.includes(s) && data.parts.some((p) => p.sheet === s)) : [], [data])
  const partsRef = useRef<Record<string, RfqPartAnswer>>({})
  useEffect(() => { if (data) partsRef.current = data.invite.parts }, [data])
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, parts } = data
  const ro = !invite.canWrite
  const sheet = sheets[step]
  const all = parts.filter((p) => p.sheet === sheet)
  const list = q ? all.filter((p) => (p.name + " " + p.sku).toLowerCase().includes(q.toLowerCase())) : all
  const doneIn = (s: string) => parts.filter((p) => p.sheet === s && invite.parts[partKey(p.sheet, p.sku)]).length

  function update(p: RfqPart, patch: Partial<RfqPartAnswer>) {
    if (ro) return
    const k = partKey(p.sheet, p.sku)
    // อ่านจาก ref กัน blur สองช่องติดกันทับกัน (ดูหมายเหตุในหน้าค่าแรง)
    const cur = partsRef.current[k] ?? EMPTY
    let next: RfqPartAnswer = { ...cur, ...patch }
    if (next.sameAsL) next = { ...next, priceS: next.priceL }
    // แตะช่องแล้วออกโดยไม่พิมพ์ ไม่ถือว่า "กรอกแล้ว" — ไม่งั้นจัดซื้อแยกไม่ออกว่าอู่ตั้งใจเว้นหรือแค่ผ่านตา
    if (!partsRef.current[k] && isBlank(next)) return
    partsRef.current = { ...partsRef.current, [k]: next }
    setLocal((d) => ({ ...d, invite: { ...d.invite, parts: { ...d.invite.parts, [k]: next } } }))
    void save({ parts: { [k]: next } })
  }

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="อะไหล่ — ราคาต่อหน่วย" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {sheets.map((s, i) => {
          const t = parts.find((p) => p.sheet === s)?.sheetTitle ?? s
          const on = i === step
          return <button key={s} onClick={() => { setStep(i); setQ("") }} style={{ ...V.btn, flexShrink: 0, minHeight: 36, padding: "6px 10px", fontSize: 12.5, background: on ? "#1D4ED8" : "#fff", color: on ? "#fff" : "#14271C", borderColor: on ? "#1D4ED8" : "#D5E2DA" }}>{s} {t} <span style={{ opacity: .8 }}>· {doneIn(s)}/{parts.filter((p) => p.sheet === s).length}</span></button>
        })}
      </div>
      <input style={{ ...V.input, marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`ค้นหาในชีต ${sheet} (ชื่อหรือรหัส)`} />
      <div style={{ ...V.muted, marginBottom: 6 }}>{list.length} รายการ · กรอกแล้ว {doneIn(sheet)}/{all.length}</div>
      {list.map((p) => {
        const k = partKey(p.sheet, p.sku)
        const a = invite.parts[k]
        const border = !a ? "#F3D48A" : a.skip ? "#D4D4D8" : "#BFDBFE"
        const isOpen = open === k
        return (
          <div key={k} style={{ ...V.card, padding: 10, borderLeft: `4px solid ${border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</div>
                <div style={V.muted}>{p.sku} · {p.unit} · ใช้กับ {p.useWith}</div>
              </div>
              <button disabled={ro} onClick={() => update(p, { skip: !a?.skip })} style={{ ...V.btn, minHeight: 34, padding: "4px 10px", fontSize: 12, background: a?.skip ? "#52525B" : "#fff", color: a?.skip ? "#fff" : "#52525B", flexShrink: 0 }}>{a?.skip ? "ไม่มีจำหน่าย ✓" : "ไม่มีจำหน่าย"}</button>
            </div>
            {!a?.skip && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end", marginTop: 8 }}>
                <div><label style={V.label}>฿/หน่วย Mixer L</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.priceL ?? ""} placeholder="฿" onBlur={(e) => update(p, { priceL: toNum(e.target.value) })} /></div>
                <div><label style={V.label}>฿/หน่วย Mixer S</label><input style={{ ...V.input, background: a?.sameAsL !== false ? "#F6FAF7" : "#fff" }} inputMode="decimal" disabled={ro || a?.sameAsL !== false} defaultValue={a?.priceS ?? ""} placeholder={a?.sameAsL !== false ? "= L" : "฿"} onBlur={(e) => update(p, { priceS: toNum(e.target.value) })} /></div>
                <label style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, paddingBottom: 8 }}><input type="checkbox" checked={a?.sameAsL !== false} disabled={ro} onChange={(e) => update(p, { sameAsL: e.target.checked })} style={{ width: 18, height: 18 }} />S=L</label>
              </div>
            )}
            <button onClick={() => setOpen(isOpen ? null : k)} style={{ ...V.btn, minHeight: 30, padding: "3px 10px", fontSize: 12, marginTop: 8, background: "#F6FAF7" }}>{isOpen ? "ซ่อน" : "เพิ่ม"} ยี่ห้อ / รับประกัน / ส่งมอบ / หมายเหตุ{a?.brand ? ` · ${a.brand}` : ""}</button>
            {isOpen && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}><label style={V.label}>ยี่ห้อ / สเปกที่เสนอ</label><input style={V.input} disabled={ro} defaultValue={a?.brand ?? ""} maxLength={120} onBlur={(e) => update(p, { brand: e.target.value })} /></div>
                <div><label style={V.label}>รับประกัน (เดือน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.warrantyMonths ?? ""} onBlur={(e) => update(p, { warrantyMonths: toNum(e.target.value) })} /></div>
                <div><label style={V.label}>ส่งมอบ (วัน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.leadDays ?? ""} onBlur={(e) => update(p, { leadDays: toNum(e.target.value) })} /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={V.label}>หมายเหตุ</label><input style={V.input} disabled={ro} defaultValue={a?.note ?? ""} maxLength={500} onBlur={(e) => update(p, { note: e.target.value })} /></div>
              </div>
            )}
          </div>
        )
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ ...V.btn, flex: 1 }} disabled={step === 0} onClick={() => { void flush(); setStep(step - 1); setQ(""); window.scrollTo(0, 0) }}>‹ ชีตก่อนหน้า</button>
        {step < sheets.length - 1
          ? <button style={{ ...V.btnPrimary, flex: 1, width: "auto", background: "#1D4ED8" }} onClick={() => { void flush(); setStep(step + 1); setQ(""); window.scrollTo(0, 0) }}>ชีตถัดไป ›</button>
          : <a href={`/q/${token}`} style={{ ...V.btnPrimary, flex: 1, width: "auto", background: "#1D4ED8", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>กลับหน้าหลัก</a>}
      </div>
      <SaveBadge state={state} savedAt={savedAt} errorMsg={errorMsg} onRetry={() => void flush()} />
    </div>
  )
}
