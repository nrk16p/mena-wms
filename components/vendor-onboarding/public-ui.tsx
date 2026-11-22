"use client"
// ชิ้นส่วนหน้า public ของ New Vendor Onboarding (/form-vendor, /form-vendor/docs/[token])
// มือถือก่อน (เปิดใน LINE LIFF ได้) · ธีมสว่างเสมอ · สีจาก lib/vendor-brand
// :focus-within / animation ใช้ inline style ไม่ได้ เลยใช้ class ขึ้นต้น vo- เฉพาะหน้านี้
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Liff } from "@line/liff"
import { BRAND } from "@/lib/vendor-brand"

export const VO_CSS = `
.vo { font-family: ${BRAND.font}; color: ${BRAND.ink}; max-width: 560px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }
.vo *, .vo *::before, .vo *::after { box-sizing: border-box; }
.vo-hero { position: relative; overflow: hidden; background: linear-gradient(160deg, ${BRAND.green} 0%, ${BRAND.greenDark} 100%); color: #fff; padding: calc(18px + env(safe-area-inset-top)) 20px 64px; }
.vo-hero::before, .vo-hero::after { content: ""; position: absolute; border-radius: 50%; border: 28px solid rgba(255,255,255,.07); pointer-events: none; }
.vo-hero::before { width: 260px; height: 260px; right: -90px; top: -110px; }
.vo-hero::after { width: 160px; height: 160px; right: 60px; bottom: -120px; border-width: 18px; }
.vo-logo { display: inline-flex; background: #fff; border-radius: 12px; padding: 7px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.15); }
.vo-logo img { height: 26px; width: auto; display: block; }
.vo-title { font-size: 22px; font-weight: 600; margin: 18px 0 0; line-height: 1.3; }
.vo-sub { font-size: 14px; opacity: .85; margin-top: 2px; font-weight: 300; }
.vo-rail { position: relative; margin-top: 16px; }
.vo-rail-top { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; opacity: .9; margin-bottom: 8px; }
.vo-rail-bars { display: flex; gap: 6px; }
.vo-rail-bars span { height: 6px; flex: 1; border-radius: 99px; background: rgba(255,255,255,.25); transition: background .3s, box-shadow .3s; }
.vo-rail-bars span.on { background: #fff; }
.vo-rail-bars span.cur { background: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.25); }
.vo-card { position: relative; background: #fff; border-radius: 20px; margin: -44px 12px 0; padding: 20px 16px 10px; box-shadow: 0 10px 30px rgba(2,58,30,.10), 0 1px 3px rgba(2,58,30,.06); animation: vo-lift .25s ease-out both; }
.vo-card + .vo-card { margin-top: 12px; }
.vo-h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
.vo-lead { font-size: 13.5px; color: ${BRAND.muted}; margin: 0 0 16px; font-weight: 300; line-height: 1.6; }
.vo-sec { font-size: 12px; font-weight: 600; letter-spacing: .6px; color: ${BRAND.green}; margin: 18px 0 10px; text-transform: uppercase; }
.vo-sec:first-child { margin-top: 0; }
.vo-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 380px) { .vo-row { grid-template-columns: 1fr; } }
.vo-field { margin-bottom: 14px; min-width: 0; }
.vo-label { display: block; font-size: 13px; font-weight: 500; color: ${BRAND.body}; margin: 0 0 6px 2px; }
.vo-label small { font-weight: 300; color: ${BRAND.muted}; font-size: 12px; }
.vo-box { display: flex; align-items: flex-start; gap: 10px; background: #F4F6F5; border: 1.5px solid transparent; border-radius: 12px; padding: 0 14px; transition: border-color .15s, background .15s, box-shadow .15s; }
.vo-box svg { flex-shrink: 0; color: #9AA5A0; margin-top: 14px; }
.vo-box:focus-within { background: #fff; border-color: ${BRAND.green}; box-shadow: 0 0 0 4px ${BRAND.greenTint}; }
.vo-box:focus-within svg { color: ${BRAND.green}; }
.vo-box.err { border-color: #DC2626; background: #FEF6F6; }
.vo-box.ok svg { color: ${BRAND.green2}; }
.vo-box input, .vo-box textarea, .vo-box select { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 16px; color: ${BRAND.ink}; padding: 12px 0; line-height: 1.5; }
.vo .vo-box input, .vo .vo-box textarea, .vo .vo-box select { background-color: transparent !important; color: ${BRAND.ink} !important; }
.vo-box textarea { resize: none; }
.vo-box input::placeholder, .vo-box textarea::placeholder { color: #A7B0AC; font-weight: 300; }
.vo-unit { align-self: center; font-size: 14px; color: ${BRAND.muted}; flex-shrink: 0; }
.vo-mono { letter-spacing: .5px; font-variant-numeric: tabular-nums; }
.vo-err { font-size: 12.5px; color: #DC2626; margin: 5px 0 0 4px; }
.vo-okmsg { font-size: 12.5px; color: ${BRAND.green2}; margin: 5px 0 0 4px; }
.vo-alert { font-size: 13.5px; color: #B91C1C; background: #FEF2F2; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.vo-info { font-size: 13px; color: ${BRAND.body}; background: ${BRAND.greenTint}; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; line-height: 1.55; }
.vo-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vo-seg button, .vo-yn button { font: inherit; font-size: 15px; min-height: 48px; border-radius: 12px; border: 1.5px solid ${BRAND.line}; background: #fff; color: ${BRAND.body}; cursor: pointer; transition: all .15s; -webkit-tap-highlight-color: transparent; }
.vo-seg button[aria-pressed="true"], .vo-yn button[aria-pressed="true"] { border-color: ${BRAND.green}; background: ${BRAND.greenTint}; color: ${BRAND.green}; font-weight: 600; }
.vo-yn { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vo-yn button.no[aria-pressed="true"] { border-color: #9CA3AF; background: #F3F4F6; color: #374151; }
.vo button:focus-visible, .vo a:focus-visible, .vo label:focus-within { outline: 3px solid ${BRAND.green}55; outline-offset: 2px; }
.vo-q { padding: 14px 0; border-top: 1px dashed ${BRAND.line}; }
.vo-q:first-of-type { border-top: 0; padding-top: 4px; }
.vo-q-label { display: block; font-size: 14.5px; font-weight: 500; margin: 0 0 8px; line-height: 1.5; }
.vo-check { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1.5px solid ${BRAND.line}; border-radius: 14px; margin-bottom: 10px; cursor: pointer; transition: border-color .15s, background .15s; }
.vo-check.on { border-color: ${BRAND.green}; background: ${BRAND.greenTint}; }
.vo-check input { position: absolute; opacity: 0; pointer-events: none; }
.vo-tick { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; border: 1.5px solid ${BRAND.field}; background: #fff; display: grid; place-items: center; color: #fff; margin-top: 1px; }
.vo-check.on .vo-tick { background: ${BRAND.green}; border-color: ${BRAND.green}; }
.vo-check-text { font-size: 14px; line-height: 1.55; }
.vo-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 6px; margin-left: 6px; vertical-align: 1px; white-space: nowrap; }
.vo-tag.req { background: #FEE2E2; color: #B91C1C; }
.vo-tag.opt { background: #F1F3F5; color: ${BRAND.muted}; }
.vo-tag.sys { background: ${BRAND.greenTint}; color: ${BRAND.green}; }
.vo-tag.ok { background: #DCFCE7; color: #166534; }
.vo-slot { padding: 14px 0; border-top: 1px solid #EEF1EF; }
.vo-slot:first-of-type { border-top: 0; padding-top: 2px; }
.vo-slot-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.vo-slot-name { font-size: 14.5px; font-weight: 500; line-height: 1.45; }
.vo-slot-hint { font-size: 12.5px; color: ${BRAND.muted}; font-weight: 300; margin-top: 2px; }
.vo-sys { font-size: 13px; color: ${BRAND.muted}; padding: 10px 0; border-top: 1px solid #EEF1EF; display: flex; justify-content: space-between; gap: 10px; }
.vo-files { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.vo-file { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #F7F9F8; border-radius: 10px; font-size: 13px; }
.vo-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vo-file-size { color: ${BRAND.muted}; font-size: 12px; flex-shrink: 0; }
.vo-file.err { background: #FEF2F2; color: #B91C1C; }
.vo-prog { height: 4px; border-radius: 99px; background: #E5E9E7; overflow: hidden; margin-top: 4px; }
.vo-prog span { display: block; height: 100%; background: ${BRAND.green}; transition: width .2s; }
.vo-icon-btn { flex-shrink: 0; width: 34px; height: 34px; border-radius: 8px; border: 0; background: transparent; color: ${BRAND.muted}; display: grid; place-items: center; cursor: pointer; }
.vo-icon-btn:hover { background: #ECEFED; color: #B91C1C; }
.vo-add { margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 14px; font-weight: 500; color: ${BRAND.green}; background: #fff; border: 1.5px dashed ${BRAND.green}66; border-radius: 10px; padding: 9px 14px; cursor: pointer; min-height: 42px; }
.vo-add:disabled { color: ${BRAND.muted}; border-color: ${BRAND.line}; cursor: default; }
.vo-bar { position: sticky; bottom: 0; margin-top: auto; padding: 16px 12px calc(14px + env(safe-area-inset-bottom)); background: linear-gradient(to top, ${BRAND.bg} 72%, rgba(243,244,245,0)); z-index: 5; }
.vo-bar-row { display: flex; gap: 10px; }
.vo-btn { flex: 1; height: 52px; border: 0; border-radius: 14px; background: ${BRAND.green}; color: #fff; font: inherit; font-size: 16.5px; font-weight: 500; box-shadow: 0 6px 16px rgba(4,97,50,.28); cursor: pointer; transition: transform .1s, background .15s, opacity .15s; -webkit-tap-highlight-color: transparent; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.vo-btn:active { transform: scale(.98); background: ${BRAND.greenDark}; }
.vo-btn:disabled { opacity: .55; cursor: default; }
.vo-btn.ghost { flex: 0 0 auto; padding: 0 18px; background: #fff; color: ${BRAND.green}; border: 1.5px solid ${BRAND.line}; box-shadow: none; }
.vo-btn.wide { width: 100%; }
.vo-sum { margin: 0; }
.vo-sum div { display: flex; gap: 12px; padding: 9px 0; font-size: 14px; }
.vo-sum div + div { border-top: 1px dashed ${BRAND.line}; }
.vo-sum dt { width: 116px; flex-shrink: 0; color: ${BRAND.muted}; font-weight: 300; }
.vo-sum dd { margin: 0; flex: 1; white-space: pre-line; word-break: break-word; }
.vo-sum-head { display: flex; justify-content: space-between; align-items: center; margin: 0 0 6px; }
.vo-link { font: inherit; font-size: 13.5px; color: ${BRAND.green}; background: none; border: 0; padding: 6px 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.vo-done { text-align: center; padding-top: 28px; }
.vo-done-check { width: 72px; height: 72px; border-radius: 50%; background: ${BRAND.green}; color: #fff; display: grid; place-items: center; margin: -64px auto 0; border: 6px solid #fff; box-shadow: 0 8px 20px rgba(4,97,50,.25); animation: vo-pop .45s cubic-bezier(.34,1.56,.64,1) both; }
.vo-ref { display: inline-block; margin: 10px 0 4px; font-size: 22px; font-weight: 600; letter-spacing: 1px; color: ${BRAND.green}; background: ${BRAND.greenTint}; padding: 6px 16px; border-radius: 10px; font-variant-numeric: tabular-nums; }
.vo-steps { text-align: left; margin: 18px 0 8px; padding: 0; list-style: none; counter-reset: s; }
.vo-steps li { counter-increment: s; position: relative; padding: 0 0 12px 36px; font-size: 14px; line-height: 1.55; }
.vo-steps li::before { content: counter(s); position: absolute; left: 0; top: 0; width: 24px; height: 24px; border-radius: 50%; background: ${BRAND.greenTint}; color: ${BRAND.green}; font-size: 13px; font-weight: 600; display: grid; place-items: center; }
.vo-skel { background: #E9ECEA; border-radius: 12px; animation: vo-pulse 1.2s ease-in-out infinite; }
@keyframes vo-pop { from { transform: scale(.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes vo-lift { from { transform: translateY(6px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes vo-pulse { 50% { opacity: .55 } }
@media (prefers-reduced-motion: reduce) { .vo-card, .vo-done-check, .vo-skel { animation: none; } }
`

export function Hero({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="vo-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <span className="vo-logo"><img src="/brand/mena-logo.svg" alt="Mena Transport" /></span>
      <h1 className="vo-title">{title}</h1>
      {sub && <div className="vo-sub">{sub}</div>}
      {children}
    </header>
  )
}

/** หนึ่งขีดต่อหนึ่งขั้น — เห็นว่าเหลืออีกกี่หน้าในแวบเดียว */
export function StepRail({ stage, total, title }: { stage: number; total: number; title: string }) {
  return (
    <div className="vo-rail">
      <div className="vo-rail-top"><span>{title}</span><span>{stage + 1}/{total}</span></div>
      <div className="vo-rail-bars" role="progressbar" aria-valuenow={stage + 1} aria-valuemin={1} aria-valuemax={total} aria-label={`ขั้นที่ ${stage + 1} จาก ${total}`}>
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < stage ? "on" : i === stage ? "cur" : ""} />)}
      </div>
    </div>
  )
}

export function Field({ id, label, icon, error, ok, children }: { id: string; label: ReactNode; icon?: ReactNode; error?: string; ok?: string; children: ReactNode }) {
  return (
    <div className="vo-field">
      <label htmlFor={id} className="vo-label">{label}</label>
      <div className={`vo-box${error ? " err" : ok ? " ok" : ""}`}>{icon}{children}</div>
      {error ? <div className="vo-err" id={`${id}-err`}>{error}</div> : ok ? <div className="vo-okmsg">{ok}</div> : null}
    </div>
  )
}

/** เปิดใน LINE (LIFF) ไหม — init เมื่อมี NEXT_PUBLIC_LIFF_ID · idToken() ให้ server ยืนยัน lineId · ไม่ได้ = null */
export function useLiff() {
  const [liff, setLiff] = useState<Liff | null>(null)
  const ready = useRef<Promise<boolean>>(Promise.resolve(false))
  useEffect(() => {
    let alive = true
    import("@line/liff").then(({ default: l }) => {
      if (!alive || !l.isInClient()) return
      const id = process.env.NEXT_PUBLIC_LIFF_ID
      if (id) ready.current = l.init({ liffId: id }).then(() => true, () => false)
      setLiff(l)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  const idToken = async (): Promise<string | null> => {
    if (!liff || !(await ready.current)) return null
    try { return liff.getIDToken() } catch { return null }
  }
  return { liff, idToken }
}

/** ตัวเลื่อนหน้าคือ div#vendor-scroll ใน app/form-vendor/layout.tsx ไม่ใช่ window */
export const scrollTop = () => document.getElementById("vendor-scroll")?.scrollTo({ top: 0 })

export function PublicSkeleton({ title }: { title: string }) {
  return (
    <div className="vo" aria-busy="true">
      <style>{VO_CSS}</style>
      <Hero title={title} sub="กำลังโหลด…" />
      <section className="vo-card">
        <div className="vo-skel" style={{ height: 22, width: "60%", marginBottom: 16 }} />
        <div className="vo-skel" style={{ height: 70, marginBottom: 12 }} />
        <div className="vo-skel" style={{ height: 70, marginBottom: 12 }} />
        <div className="vo-skel" style={{ height: 70, marginBottom: 12 }} />
      </section>
    </div>
  )
}
