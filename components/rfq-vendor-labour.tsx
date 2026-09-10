"use client"
// หน้าค่าแรง: ชีตละขั้น · การ์ดละงาน · รายชั่วโมง / เหมา / ไม่รับงาน · Mixer L แล้ว S (+ "S เหมือน L")
import { useEffect, useMemo, useRef, useState } from "react"
import { SHEET_ORDER, type RfqAnswer, type RfqJob, type Tier } from "@/lib/rfq-core"
import { useInvite, useAutosave, V, VendorHeader, StatusNotice, SaveBadge, toNum } from "@/components/rfq-vendor-shared"

const EMPTY: RfqAnswer = { mode: "lump", L: {}, S: {}, sameAsL: true, note: "", at: "" }

export function RfqVendorLabour({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  const { save, flush, state, savedAt, errorMsg } = useAutosave(token)
  const [step, setStep] = useState(0)
  const [openScope, setOpenScope] = useState<Record<string, boolean>>({})
  const sheets = useMemo(() => data ? SHEET_ORDER.filter((s) => data.invite.sheets.includes(s) && data.jobs.some((j) => j.sheet === s)) : [], [data])
  const itemsRef = useRef<Record<string, RfqAnswer>>({})
  useEffect(() => { if (data) itemsRef.current = data.invite.items }, [data])
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  const { invite, jobs } = data
  const ro = !invite.canWrite
  const sheet = sheets[step]
  const list = jobs.filter((j) => j.sheet === sheet)
  const doneIn = (s: string) => jobs.filter((j) => j.sheet === s && invite.items[j.jobCode]).length
  const totalIn = (s: string) => jobs.filter((j) => j.sheet === s).length

  // อ่านค่าล่าสุดจาก ref ไม่ใช่จาก closure ตอน render — กดข้ามช่องเร็ว ๆ บนมือถือ
  // สอง blur อาจมาก่อน React จะ render ใหม่ ถ้าใช้ค่าจาก closure ช่องก่อนหน้าจะถูกทับหาย
  function update(job: RfqJob, patch: Partial<RfqAnswer> & { Lp?: Partial<Tier>; Sp?: Partial<Tier> }) {
    if (ro) return
    const cur = itemsRef.current[job.jobCode] ?? EMPTY
    const { Lp, Sp, ...rest } = patch
    let next: RfqAnswer = { ...cur, ...rest, L: { ...cur.L, ...(Lp ?? {}) }, S: { ...cur.S, ...(Sp ?? {}) } }
    if (next.sameAsL) next = { ...next, S: { ...next.L } }
    itemsRef.current = { ...itemsRef.current, [job.jobCode]: next }
    setLocal((d) => ({ ...d, invite: { ...d.invite, items: { ...d.invite.items, [job.jobCode]: next } } }))
    void save({ items: { [job.jobCode]: next } })
  }

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ค่าแรง — งานช่างมาตรฐาน" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      {/* แถบชีต เลื่อนแนวนอน */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {sheets.map((s, i) => {
          const t = jobs.find((j) => j.sheet === s)?.sheetTitle ?? s
          const on = i === step
          return <button key={s} onClick={() => setStep(i)} style={{ ...V.btn, flexShrink: 0, minHeight: 36, padding: "6px 10px", fontSize: 12.5, background: on ? "#1B8C4B" : "#fff", color: on ? "#fff" : "#14271C", borderColor: on ? "#1B8C4B" : "#D5E2DA" }}>{s} {t} <span style={{ opacity: .8 }}>· {doneIn(s)}/{totalIn(s)}</span></button>
        })}
      </div>
      {sheet && <div style={{ fontSize: 15, fontWeight: 600, margin: "4px 0 10px" }}>{sheet} · {list[0]?.sheetTitle} <span style={V.muted}>กรอกแล้ว {doneIn(sheet)}/{list.length}</span></div>}
      {list.map((job) => {
        const a = invite.items[job.jobCode]
        const mode = a?.mode ?? null
        const border = !a ? "#F3D48A" : a.mode === "skip" ? "#D4D4D8" : "#A7F3D0"
        const so = openScope[job.jobCode]
        return (
          <div key={job.jobCode} style={{ ...V.card, borderLeft: `4px solid ${border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...V.muted, fontVariantNumeric: "tabular-nums" }}>{job.seq}.</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{job.name}</div>
                <div style={V.muted}>{job.jobCode} · ชม.อ้างอิง L {job.refHoursL ?? "—"} / S {job.refHoursS ?? "—"}</div>
              </div>
            </div>
            <button onClick={() => setOpenScope((o) => ({ ...o, [job.jobCode]: !so }))} style={{ ...V.btn, minHeight: 32, padding: "4px 10px", fontSize: 12.5, marginTop: 8, background: "#F6FAF7" }}>{so ? "ซ่อน" : "ดู"}ขอบเขตงาน + เกณฑ์ เบา/กลาง/หนัก</button>
            {so && (
              <div style={{ fontSize: 13, color: "#3F5148", marginTop: 8, whiteSpace: "pre-wrap", background: "#F6FAF7", borderRadius: 10, padding: 10 }}>
                <b>ขอบเขต:</b> {job.scope || "—"}{"\n"}<b>เกณฑ์:</b> {job.tierCriteria || "—"}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {([["hourly", "รายชั่วโมง"], ["lump", "เหมา"], ["skip", "ไม่รับงานนี้"]] as const).map(([m, label]) => (
                <button key={m} disabled={ro} onClick={() => update(job, { mode: m })} style={{ ...V.btn, flex: 1, padding: "8px 4px", fontSize: 13.5, background: mode === m ? (m === "skip" ? "#52525B" : "#1B8C4B") : "#fff", color: mode === m ? "#fff" : "#14271C", borderColor: mode === m ? "transparent" : "#D5E2DA" }}>{label}</button>
              ))}
            </div>
            {a && a.mode !== "skip" && (
              <>
                <TierBlock title="Mixer L (10 ล้อ)" color="#1B8C4B" mode={a.mode} t={a.L} ro={ro} onChange={(Lp) => update(job, { Lp })} />
                <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 4px", fontSize: 13.5 }}>
                  <input type="checkbox" checked={a.sameAsL} disabled={ro} onChange={(e) => update(job, { sameAsL: e.target.checked })} style={{ width: 18, height: 18 }} /> Mixer S ราคาเดียวกับ L
                </label>
                {!a.sameAsL && <TierBlock title="Mixer S (6 ล้อ)" color="#1D4ED8" mode={a.mode} t={a.S} ro={ro} onChange={(Sp) => update(job, { Sp })} />}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 10 }}>
                  <div><label style={V.label}>รับประกัน (เดือน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a.warrantyMonths ?? ""} onBlur={(e) => update(job, { warrantyMonths: toNum(e.target.value) })} /></div>
                  <div><label style={V.label}>หมายเหตุ</label><input style={V.input} disabled={ro} defaultValue={a.note} maxLength={500} onBlur={(e) => update(job, { note: e.target.value })} /></div>
                </div>
              </>
            )}
          </div>
        )
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ ...V.btn, flex: 1 }} disabled={step === 0} onClick={() => { void flush(); setStep(step - 1); window.scrollTo(0, 0) }}>‹ ชีตก่อนหน้า</button>
        {step < sheets.length - 1
          ? <button style={{ ...V.btnPrimary, flex: 1, width: "auto" }} onClick={() => { void flush(); setStep(step + 1); window.scrollTo(0, 0) }}>ชีตถัดไป ›</button>
          : <a href={`/q/${token}`} style={{ ...V.btnPrimary, flex: 1, width: "auto", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>กลับหน้าหลัก</a>}
      </div>
      <SaveBadge state={state} savedAt={savedAt} errorMsg={errorMsg} onRetry={() => void flush()} />
    </div>
  )
}

function TierField({ k, label, t, ro, onChange }: { k: keyof Tier; label: string; t: Tier; ro: boolean; onChange: (p: Partial<Tier>) => void }) {
  return (
    <div><label style={V.label}>{label}</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={t[k] ?? ""} placeholder="฿" onBlur={(e) => onChange({ [k]: toNum(e.target.value) })} /></div>
  )
}

function TierBlock({ title, color, mode, t, ro, onChange }: { title: string; color: string; mode: "hourly" | "lump"; t: Tier; ro: boolean; onChange: (p: Partial<Tier>) => void }) {
  const f = { t, ro, onChange }
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: color + "0D", border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      {mode === "hourly"
        ? <div key="hourly" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><TierField k="rate" label="อัตรา ฿/ชม." {...f} /><TierField k="hours" label="ชม.มาตรฐาน" {...f} /></div>
        : <div key="lump" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><TierField k="light" label="เหมา เบา" {...f} /><TierField k="mid" label="เหมา กลาง" {...f} /><TierField k="heavy" label="เหมา หนัก" {...f} /></div>}
    </div>
  )
}
