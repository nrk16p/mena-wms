"use client"
// หน้าค่าแรง: ชีตละขั้น · บนสุดของชีต = อัตราค่าแรง ฿/ชม. (ปกติ / นอกสถานที่) ใช้ทั้ง L และ S
// การ์ดละงาน = ชั่วโมง Mixer L แล้ว S (+ "S เท่ากับ L") หรือ ไม่รับงาน · ตัดค่าแรงเหมาออกแล้ว (ผู้ใช้ขอ 2026-09-18)
import { useEffect, useMemo, useRef, useState } from "react"
import { SHEET_ORDER, isCustomJob, isAnswered, jobCost, type RfqAnswer, type RfqJob, type RfqRate, type JobHours } from "@/lib/rfq-core"
import { useInvite, useAutosave, V, VendorHeader, StatusNotice, SaveBadge, NeedContact, toNum, scrollToTop } from "@/components/rfq-vendor-shared"

const EMPTY: RfqAnswer = { mode: "hours", L: {}, S: {}, sameAsL: true, note: "", at: "" }
/** คำตอบรูปแบบเก่า (เหมา / รายชั่วโมงที่มีอัตราต่องาน) ไม่ใช้แล้ว — ถือว่ายังไม่กรอก ให้อู่กรอกใหม่เป็นชั่วโมง */
const current = (a: RfqAnswer | undefined): RfqAnswer | undefined => (a && (a.mode === "hours" || a.mode === "skip") ? a : undefined)
const baht = (n: number | null) => (n === null ? "—" : `฿${n.toLocaleString("th-TH")}`)

export function RfqVendorLabour({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  const { save, flush, state, savedAt, errorMsg } = useAutosave(token)
  const [step, setStep] = useState(0)
  const [openScope, setOpenScope] = useState<Record<string, boolean>>({})
  const sheets = useMemo(() => data ? SHEET_ORDER.filter((s) => data.invite.sheets.includes(s) && data.jobs.some((j) => j.sheet === s)) : [], [data])
  const itemsRef = useRef<Record<string, RfqAnswer>>({})
  const ratesRef = useRef<Record<string, RfqRate>>({})
  useEffect(() => { if (data) { itemsRef.current = data.invite.items; ratesRef.current = data.invite.rates ?? {} } }, [data])
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  // เปิดลิงก์ตรงมาหน้านี้โดยยังไม่กรอกผู้ติดต่อ → API จะปฏิเสธการบันทึกทุกช่อง ส่งกลับไปหน้าหลักก่อน
  if (!data.invite.contact && data.invite.canWrite) return <NeedContact token={token} />
  const { invite, jobs } = data
  const ro = !invite.canWrite
  const sheet = sheets[step]
  const list = jobs.filter((j) => j.sheet === sheet)
  const rate = sheet ? invite.rates?.[sheet] : undefined
  const hasRate = (s: string) => invite.rates?.[s]?.normal !== undefined && invite.rates?.[s]?.normal !== null
  const doneIn = (s: string) => jobs.filter((j) => j.sheet === s && isAnswered(invite.items[j.jobCode])).length
  const totalIn = (s: string) => jobs.filter((j) => j.sheet === s).length

  // อ่านค่าล่าสุดจาก ref ไม่ใช่จาก closure ตอน render — กดข้ามช่องเร็ว ๆ บนมือถือ
  // สอง blur อาจมาก่อน React จะ render ใหม่ ถ้าใช้ค่าจาก closure ช่องก่อนหน้าจะถูกทับหาย
  function update(job: RfqJob, patch: Partial<RfqAnswer> & { Lp?: Partial<JobHours>; Sp?: Partial<JobHours> }) {
    if (ro) return
    const cur = current(itemsRef.current[job.jobCode]) ?? EMPTY
    const { Lp, Sp, ...rest } = patch
    let next: RfqAnswer = { ...cur, ...rest, L: { ...cur.L, ...(Lp ?? {}) }, S: { ...cur.S, ...(Sp ?? {}) } }
    if (next.sameAsL) next = { ...next, S: { ...next.L } }
    itemsRef.current = { ...itemsRef.current, [job.jobCode]: next }
    setLocal((d) => ({ ...d, invite: { ...d.invite, items: { ...d.invite.items, [job.jobCode]: next } } }))
    void save({ items: { [job.jobCode]: next } })
  }
  function updateRate(s: string, patch: Partial<Pick<RfqRate, "normal" | "onsite">>) {
    if (ro) return
    const next: RfqRate = { ...(ratesRef.current[s] ?? { at: "" }), ...patch }
    ratesRef.current = { ...ratesRef.current, [s]: next }
    setLocal((d) => ({ ...d, invite: { ...d.invite, rates: { ...(d.invite.rates ?? {}), [s]: next } } }))
    void save({ rates: { [s]: next } })
  }

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ค่าแรง — อัตราต่อชั่วโมง + ชั่วโมงต่องาน" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      {/* แถบชีต เลื่อนแนวนอน · จุดส้ม = ยังไม่ใส่อัตราค่าแรงของชีต */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
        {sheets.map((s, i) => {
          const t = jobs.find((j) => j.sheet === s)?.sheetTitle ?? s
          const on = i === step
          return <button key={s} onClick={() => setStep(i)} style={{ ...V.btn, flexShrink: 0, minHeight: 36, padding: "6px 10px", fontSize: 12.5, background: on ? "#046132" : "#fff", color: on ? "#fff" : "#212529", borderColor: on ? "#046132" : "#CED4DA" }}>{!hasRate(s) && <span title="ยังไม่ใส่อัตราค่าแรง" style={{ color: on ? "#FDE68A" : "#D97706" }}>● </span>}{s} {t} <span style={{ opacity: .8 }}>· {doneIn(s)}/{totalIn(s)}</span></button>
        })}
      </div>
      {sheet && <div style={{ fontSize: 15, fontWeight: 500, margin: "4px 0 10px" }}>{sheet} · {list[0]?.sheetTitle} <span style={V.muted}>กรอกแล้ว {doneIn(sheet)}/{list.length}</span></div>}
      {sheet && <RateCard key={sheet} rate={rate} ro={ro} onChange={(p) => updateRate(sheet, p)} />}
      {list.map((job) => {
        const a = current(invite.items[job.jobCode])
        const skip = a?.mode === "skip"
        const done = isAnswered(a)
        const border = !done ? "#F3D48A" : skip ? "#D4D4D8" : "#338B5F"
        const so = openScope[job.jobCode]
        const sameAsL = a?.sameAsL ?? true
        const cost = jobCost(a, rate)
        return (
          <div key={job.jobCode} style={{ ...V.card, borderLeft: `4px solid ${border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...V.muted, fontVariantNumeric: "tabular-nums" }}>{job.seq}.</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15.5, fontWeight: 500, lineHeight: 1.3 }}>{job.name}</div>
                <div style={V.muted}>{isCustomJob(job.jobCode) ? <span style={{ color: "#B45309", fontWeight: 500 }}>หัวข้อเพิ่มเติมจากฝ่ายจัดซื้อ</span> : job.jobCode}</div>
              </div>
            </div>
            {job.scope && <button onClick={() => setOpenScope((o) => ({ ...o, [job.jobCode]: !so }))} style={{ ...V.btn, minHeight: 32, padding: "4px 10px", fontSize: 12.5, marginTop: 8, background: "#F3F4F5" }}>{so ? "ซ่อน" : "ดู"}ขอบเขตงาน</button>}
            {so && <div style={{ fontSize: 13, color: "#343A40", marginTop: 8, whiteSpace: "pre-wrap", background: "#F3F4F5", borderRadius: 6, padding: 10 }}><b>ขอบเขต:</b> {job.scope}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {([["hours", "เสนอชั่วโมง"], ["skip", "ไม่รับงานนี้"]] as const).map(([m, label]) => {
                const on = m === "skip" ? skip : !skip
                return <button key={m} disabled={ro} onClick={() => update(job, { mode: m })} style={{ ...V.btn, flex: 1, padding: "8px 4px", fontSize: 13.5, background: on ? (m === "skip" ? "#52525B" : "#046132") : "#fff", color: on ? "#fff" : "#212529", borderColor: on ? "transparent" : "#CED4DA" }}>{label}</button>
              })}
            </div>
            {!skip && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <HoursField title="Mixer L (10 ล้อ)" color="#046132" value={a?.L.hours} ro={ro} onBlur={(hours) => update(job, { mode: "hours", Lp: { hours } })} />
                  {sameAsL
                    ? <div style={{ padding: 10, borderRadius: 6, background: "#1D4ED80D", border: "1px dashed #1D4ED833" }}><div style={{ fontSize: 13, fontWeight: 600, color: "#1D4ED8" }}>Mixer S (6 ล้อ)</div><div style={{ ...V.muted, marginTop: 6 }}>ชั่วโมงเท่ากับ L</div></div>
                    : <HoursField title="Mixer S (6 ล้อ)" color="#1D4ED8" value={a?.S.hours} ro={ro} onBlur={(hours) => update(job, { mode: "hours", Sp: { hours } })} />}
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 4px", fontSize: 13.5 }}>
                  <input type="checkbox" checked={sameAsL} disabled={ro} onChange={(e) => update(job, { mode: "hours", sameAsL: e.target.checked })} style={{ width: 18, height: 18 }} /> Mixer S ใช้ชั่วโมงเท่ากับ L
                </label>
                {cost && <CostLine cost={cost} sameAsL={sameAsL} />}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 10 }}>
                  <div><label style={V.label}>รับประกัน (เดือน)</label><input style={V.input} inputMode="decimal" disabled={ro} defaultValue={a?.warrantyMonths ?? ""} onBlur={(e) => update(job, { warrantyMonths: toNum(e.target.value) })} /></div>
                  <div><label style={V.label}>หมายเหตุ</label><input style={V.input} disabled={ro} defaultValue={a?.note ?? ""} maxLength={500} onBlur={(e) => update(job, { note: e.target.value })} /></div>
                </div>
              </>
            )}
          </div>
        )
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ ...V.btn, flex: 1 }} disabled={step === 0} onClick={() => { void flush(); setStep(step - 1); scrollToTop() }}>‹ ชีตก่อนหน้า</button>
        {step < sheets.length - 1
          ? <button style={{ ...V.btnPrimary, flex: 1, width: "auto" }} onClick={() => { void flush(); setStep(step + 1); scrollToTop() }}>ชีตถัดไป ›</button>
          : <a href={`/q/${token}`} style={{ ...V.btnPrimary, flex: 1, width: "auto", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>กลับหน้าหลัก</a>}
      </div>
      <SaveBadge state={state} savedAt={savedAt} errorMsg={errorMsg} onRetry={() => void flush()} />
    </div>
  )
}

/** อัตราค่าแรงของชีต — ใช้คิดทุกงานในชีตนี้ ทั้ง Mixer L และ S */
function RateCard({ rate, ro, onChange }: { rate: RfqRate | undefined; ro: boolean; onChange: (p: Partial<Pick<RfqRate, "normal" | "onsite">>) => void }) {
  const ok = rate?.normal !== undefined && rate?.normal !== null
  return (
    <div style={{ ...V.card, borderLeft: `4px solid ${ok ? "#338B5F" : "#F3D48A"}`, background: ok ? "#fff" : "#FFFBEB" }}>
      <div style={{ fontSize: 15.5, fontWeight: 500 }}>อัตราค่าแรงระบบนี้ (บาท/ชั่วโมง)</div>
      <div style={V.muted}>ใช้คิดทุกงานในชีตนี้ ทั้ง Mixer L และ S · ค่าแรงต่องาน = ชั่วโมง × อัตรา</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <label style={V.label}>ค่าแรงปกติ *<span style={{ display: "block", fontWeight: 400, color: "#6C757D", fontSize: 11.5 }}>ซ่อมที่อู่</span></label>
          <input style={V.input} inputMode="decimal" disabled={ro} defaultValue={rate?.normal ?? ""} placeholder="฿/ชม." onBlur={(e) => onChange({ normal: toNum(e.target.value) })} />
        </div>
        <div>
          <label style={V.label}>ค่าแรงนอกสถานที่<span style={{ display: "block", fontWeight: 400, color: "#6C757D", fontSize: 11.5 }}>ออกไปซ่อมหน้างาน · เว้นว่าง = ไม่รับ</span></label>
          <input style={V.input} inputMode="decimal" disabled={ro} defaultValue={rate?.onsite ?? ""} placeholder="฿/ชม." onBlur={(e) => onChange({ onsite: toNum(e.target.value) })} />
        </div>
      </div>
    </div>
  )
}

function HoursField({ title, color, value, ro, onBlur }: { title: string; color: string; value: number | undefined; ro: boolean; onBlur: (hours: number | undefined) => void }) {
  return (
    <div style={{ padding: 10, borderRadius: 6, background: color + "0D", border: `1px solid ${color}33` }}>
      <label style={{ ...V.label, color, fontSize: 13, fontWeight: 600 }}>{title}<span style={{ display: "block", fontWeight: 400, color: "#6C757D", fontSize: 11.5 }}>จำนวนชั่วโมงที่ใช้ซ่อม</span></label>
      <input style={V.input} inputMode="decimal" disabled={ro} defaultValue={value ?? ""} placeholder="ชม." onBlur={(e) => onBlur(toNum(e.target.value))} />
    </div>
  )
}

/** ให้อู่เห็นว่าชั่วโมงที่ใส่คิดเป็นเงินเท่าไร — เฉพาะเมื่อมีทั้งชั่วโมงและอัตรา */
function CostLine({ cost, sameAsL }: { cost: NonNullable<ReturnType<typeof jobCost>>; sameAsL: boolean }) {
  const line = (label: string, m: { normal: number | null; onsite: number | null }) =>
    m.normal === null && m.onsite === null ? null
      : <div>{label}: ปกติ {baht(m.normal)}{m.onsite !== null && <> · นอกสถานที่ {baht(m.onsite)}</>}</div>
  const l = line(sameAsL ? "คิดเป็น (L และ S)" : "คิดเป็น L", cost.L)
  const s = sameAsL ? null : line("คิดเป็น S", cost.S)
  if (!l && !s) return null
  return <div style={{ ...V.muted, fontSize: 12.5, color: "#343A40", background: "#F3F4F5", borderRadius: 8, padding: "6px 10px" }}>{l}{s}</div>
}
