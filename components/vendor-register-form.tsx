"use client"
// ฟอร์มลงทะเบียน Vendor (/form-vendor) — ลิงก์ภายนอก ใครมีลิงก์ก็กรอกได้ ไม่ต้อง login
// กดส่ง → POST /api/form-vendor → datawarehouse.vendor_registration (status: pending ให้ฝ่ายจัดซื้อตรวจ)
// หน้าตาแบบแอปมือถือสำหรับ LINE LIFF: หัวเขียว + การ์ดฟอร์ม + ปุ่มส่งติดล่างจอ · สีจาก lib/vendor-brand
import { useEffect, useState, type ReactNode } from "react"
import type { Liff } from "@line/liff"
import { Building2, Check, MapPin, Phone, Receipt, User } from "lucide-react"
import { scrollToTop } from "@/components/rfq-vendor-shared"
import { BRAND } from "@/lib/vendor-brand"
import { validateVendorRegister as validate, type VendorRegisterInput as Form, type VendorRegisterKey as Key } from "@/lib/vendor-register"

const EMPTY: Form = { firstName: "", lastName: "", onBehalf: "", address: "", phone: "", taxId: "" }

const digits = (s: string) => s.replace(/\D/g, "")

const group = (s: string, sizes: number[]) => {
  const out: string[] = []
  let i = 0
  for (const n of sizes) { if (i >= s.length) break; out.push(s.slice(i, i + n)); i += n }
  return out.join("-")
}
/** 0-0000-00000-00-0 */
const fmtTaxId = (id: string) => group(id, [1, 4, 5, 2, 1])
/** 081-234-5678 · 02-123-4567 */
const fmtPhone = (p: string) => group(p, p.startsWith("02") ? [2, 3, 4] : [3, 3, 4])

// :focus-within / animation ทำด้วย inline style ไม่ได้ — ใช้ class ที่ขึ้นต้น vr- เฉพาะหน้านี้
const CSS = `
.vr { font-family: ${BRAND.font}; color: ${BRAND.ink}; max-width: 480px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }
.vr-hero { position: relative; overflow: hidden; background: linear-gradient(160deg, ${BRAND.green} 0%, ${BRAND.greenDark} 100%); color: #fff; padding: calc(20px + env(safe-area-inset-top)) 20px 72px; }
.vr-hero::before, .vr-hero::after { content: ""; position: absolute; border-radius: 50%; border: 28px solid rgba(255,255,255,.07); pointer-events: none; }
.vr-hero::before { width: 260px; height: 260px; right: -90px; top: -110px; }
.vr-hero::after { width: 160px; height: 160px; right: 60px; bottom: -120px; border-width: 18px; }
.vr-logo { display: inline-flex; background: #fff; border-radius: 12px; padding: 7px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.15); }
.vr-logo img { height: 28px; width: auto; display: block; }
.vr-title { font-size: 24px; font-weight: 600; margin: 22px 0 0; line-height: 1.3; }
.vr-sub { font-size: 14px; opacity: .8; margin-top: 2px; font-weight: 300; }
.vr-card { position: relative; background: #fff; border-radius: 20px; margin: -48px 14px 0; padding: 20px 16px 8px; box-shadow: 0 10px 30px rgba(2,58,30,.10), 0 1px 3px rgba(2,58,30,.06); }
.vr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.vr-field { margin-bottom: 16px; min-width: 0; }
.vr-label { display: block; font-size: 13px; font-weight: 500; color: ${BRAND.body}; margin: 0 0 6px 2px; }
.vr-label small { font-weight: 300; color: ${BRAND.muted}; font-size: 12px; }
.vr-box { display: flex; align-items: flex-start; gap: 10px; background: #F4F6F5; border: 1.5px solid transparent; border-radius: 12px; padding: 0 14px; transition: border-color .15s, background .15s, box-shadow .15s; }
.vr-box svg { flex-shrink: 0; color: #9AA5A0; margin-top: 15px; transition: color .15s; }
.vr-box:focus-within { background: #fff; border-color: ${BRAND.green}; box-shadow: 0 0 0 4px ${BRAND.greenTint}; }
.vr-box:focus-within svg { color: ${BRAND.green}; }
.vr-box.err { border-color: #DC2626; background: #FEF6F6; }
.vr-box input, .vr-box textarea { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 16px; color: ${BRAND.ink}; padding: 13px 0; line-height: 1.5; }
.vr .vr-box input, .vr .vr-box textarea { background-color: transparent !important; color: ${BRAND.ink} !important; } /* ทับ .dark input ใน globals.css — หน้านี้สว่างเสมอ */
.vr-box textarea { resize: none; }
.vr-box input::placeholder, .vr-box textarea::placeholder { color: #A7B0AC; font-weight: 300; }
.vr-mono { letter-spacing: .5px; font-variant-numeric: tabular-nums; }
.vr-err { font-size: 12.5px; color: #DC2626; margin: 5px 0 0 4px; }
.vr-alert { font-size: 13.5px; color: #B91C1C; background: #FEF2F2; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; text-align: center; }
.vr-bar { position: sticky; bottom: 0; margin-top: auto; padding: 16px 14px calc(14px + env(safe-area-inset-bottom)); background: linear-gradient(to top, ${BRAND.bg} 70%, rgba(243,244,245,0)); }
.vr-stack { display: grid; gap: 10px; }
.vr-btn { width: 100%; height: 52px; border: 0; border-radius: 14px; background: ${BRAND.green}; color: #fff; font: inherit; font-size: 17px; font-weight: 500; box-shadow: 0 6px 16px rgba(4,97,50,.28); cursor: pointer; transition: transform .1s, background .15s, opacity .15s; -webkit-tap-highlight-color: transparent; }
.vr-btn:active { transform: scale(.98); background: ${BRAND.greenDark}; }
.vr-btn:disabled { opacity: .6; cursor: default; }
.vr-btn.ghost { background: #fff; color: ${BRAND.green}; border: 1.5px solid ${BRAND.line}; box-shadow: none; }
.vr-done { text-align: center; padding: 28px 18px 20px; }
.vr-check { width: 72px; height: 72px; border-radius: 50%; background: ${BRAND.green}; color: #fff; display: grid; place-items: center; margin: -64px auto 0; border: 6px solid #fff; box-shadow: 0 8px 20px rgba(4,97,50,.25); animation: vr-pop .45s cubic-bezier(.34,1.56,.64,1) both; }
.vr-done h2 { font-size: 21px; font-weight: 600; margin: 14px 0 4px; color: ${BRAND.ink}; }
.vr-done p { font-size: 14px; color: ${BRAND.muted}; margin: 0; font-weight: 300; }
.vr-sum { text-align: left; margin: 20px 0 0; background: #F7F9F8; border-radius: 14px; padding: 4px 14px; }
.vr-sum div { display: flex; gap: 12px; padding: 11px 0; font-size: 14px; }
.vr-sum div + div { border-top: 1px dashed ${BRAND.line}; }
.vr-sum dt { width: 92px; flex-shrink: 0; color: ${BRAND.muted}; font-weight: 300; }
.vr-sum dd { margin: 0; flex: 1; white-space: pre-line; word-break: break-word; }
@keyframes vr-pop { from { transform: scale(.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
`

function Field({ id, label, icon, error, children }: { id: string; label: ReactNode; icon?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="vr-field">
      <label htmlFor={id} className="vr-label">{label}</label>
      <div className={`vr-box${error ? " err" : ""}`}>{icon}{children}</div>
      {error && <div className="vr-err">{error}</div>}
    </div>
  )
}

function Hero({ sub }: { sub: string }) {
  return (
    <header className="vr-hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <span className="vr-logo"><img src="/brand/mena-logo.svg" alt="Mena Transport" /></span>
      <h1 className="vr-title">ลงทะเบียนผู้ให้บริการ</h1>
      <div className="vr-sub">{sub}</div>
    </header>
  )
}

/** เปิดใน LINE (LIFF) ไหม — closeWindow/isInClient ใช้ได้ก่อน init · init เมื่อมี NEXT_PUBLIC_LIFF_ID */
function useLiff() {
  const [liff, setLiff] = useState<Liff | null>(null)
  useEffect(() => {
    let alive = true
    import("@line/liff").then(({ default: l }) => {
      if (!alive || !l.isInClient()) return
      const id = process.env.NEXT_PUBLIC_LIFF_ID
      if (id) l.init({ liffId: id }).catch(() => {})
      setLiff(l)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  return liff
}

export function VendorRegisterForm() {
  const liff = useLiff()
  const [f, setF] = useState<Form>(EMPTY)
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  const errors = validate(f)
  const shown = touched ? errors : {}
  const set = (k: Key) => (v: string) => setF((x) => ({ ...x, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setTouched(true)
    setSaveError("")
    if (Object.keys(errors).length) {
      // โฟกัสช่องแรกที่ผิด
      const first = (Object.keys(EMPTY) as Key[]).find((k) => errors[k])
      if (first) document.getElementById(`vr-${first}`)?.focus()
      return
    }
    const clean = { ...f, firstName: f.firstName.trim(), lastName: f.lastName.trim(), onBehalf: f.onBehalf.trim(), address: f.address.trim() }
    setSaving(true)
    try {
      const res = await fetch("/api/form-vendor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clean) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveError(data.error || "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง"); return }
      setDone(clean)
      scrollToTop()
    } catch {
      setSaveError("เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่")
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="vr">
        <style>{CSS}</style>
        <Hero sub="Mena Transport" />
        <section className="vr-card vr-done">
          <div className="vr-check"><Check size={34} strokeWidth={3} /></div>
          <h2>ส่งข้อมูลเรียบร้อย</h2>
          <p>ฝ่ายจัดซื้อจะติดต่อกลับเร็ว ๆ นี้</p>
          <dl className="vr-sum">
            {([
              ["ชื่อ", `${done.firstName} ${done.lastName}`],
              ["ในนาม", done.onBehalf || "—"],
              ["เบอร์โทร", fmtPhone(done.phone)],
              ["เลขผู้เสียภาษี", fmtTaxId(done.taxId)],
              ["ที่อยู่", done.address],
            ] as const).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
        <div className="vr-bar vr-stack">
          {liff && <button type="button" className="vr-btn" onClick={() => liff.closeWindow()}>ปิดหน้าต่าง</button>}
          <button type="button" className="vr-btn ghost" onClick={() => { setF(EMPTY); setTouched(false); setDone(null) }}>
            ลงทะเบียนรายใหม่
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="vr" onSubmit={submit} noValidate>
      <style>{CSS}</style>
      <Hero sub="กรอกข้อมูลเพียงครั้งเดียว" />

      <section className="vr-card">
        <div className="vr-row">
          <Field id="vr-firstName" label="ชื่อ" icon={<User size={18} />} error={shown.firstName}>
            <input id="vr-firstName" autoComplete="given-name" enterKeyHint="next"
              value={f.firstName} onChange={(e) => set("firstName")(e.target.value)} />
          </Field>
          <Field id="vr-lastName" label="นามสกุล" error={shown.lastName}>
            <input id="vr-lastName" autoComplete="family-name" enterKeyHint="next"
              value={f.lastName} onChange={(e) => set("lastName")(e.target.value)} />
          </Field>
        </div>

        <Field id="vr-onBehalf" label={<>ในนาม <small>(ไม่บังคับ)</small></>} icon={<Building2 size={18} />} error={shown.onBehalf}>
          <input id="vr-onBehalf" autoComplete="organization" enterKeyHint="next" placeholder="ร้าน / บริษัท"
            value={f.onBehalf} onChange={(e) => set("onBehalf")(e.target.value)} />
        </Field>

        <Field id="vr-phone" label="เบอร์โทร" icon={<Phone size={18} />} error={shown.phone}>
          <input id="vr-phone" type="tel" inputMode="numeric" autoComplete="tel" enterKeyHint="next" placeholder="081-234-5678"
            className="vr-mono" value={fmtPhone(f.phone)} onChange={(e) => set("phone")(digits(e.target.value).slice(0, 10))} />
        </Field>

        <Field id="vr-taxId" label="เลขประจำตัวผู้เสียภาษี" icon={<Receipt size={18} />} error={shown.taxId}>
          <input id="vr-taxId" inputMode="numeric" enterKeyHint="next" placeholder="0-0000-00000-00-0"
            className="vr-mono" value={fmtTaxId(f.taxId)} onChange={(e) => set("taxId")(digits(e.target.value).slice(0, 13))} />
        </Field>

        <Field id="vr-address" label="ที่อยู่" icon={<MapPin size={18} />} error={shown.address}>
          <textarea id="vr-address" rows={3} autoComplete="street-address" placeholder="เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
            value={f.address} onChange={(e) => set("address")(e.target.value)} />
        </Field>
      </section>

      <div className="vr-bar">
        {saveError && <div role="alert" className="vr-alert">{saveError}</div>}
        <button type="submit" className="vr-btn" disabled={saving}>{saving ? "กำลังบันทึก…" : "ลงทะเบียน"}</button>
      </div>
    </form>
  )
}
