"use client"
// ฟอร์มสมัครเป็นผู้ส่งมอบรายใหม่ (/form-vendor) — ลิงก์สาธารณะ ไม่ต้อง login · เปิดใน LINE LIFF ได้
// ทางเดินเหมือนหน้าสมัครงานของ hr-service: ยินยอม PDPA → ข้อมูล → คำถามประเมิน → เอกสาร → ตรวจทาน → ส่ง
// ร่างเก็บใน localStorage ทุกครั้งที่ค่าเปลี่ยน (ปิดจอกลางคันกลับมากรอกต่อได้) · ล้างทิ้งหลังส่งสำเร็จ
// เกณฑ์/เอกสาร/ข้อความยินยอมมาจาก GET /api/form-vendor/config (แก้ในหน้า settings ไม่ต้องแก้โค้ด)
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { AtSign, Briefcase, Building2, Check, ChevronLeft, Hash, Loader2, MapPin, Package, Phone, Receipt, ShieldCheck, User } from "lucide-react"
import { Field, Hero, PublicSkeleton, StepRail, VO_CSS, scrollTop, useLiff } from "@/components/vendor-onboarding/public-ui"
import { SlotUploader } from "@/components/vendor-onboarding/slot-uploader"
import { taxIdOk } from "@/lib/vendor-register"
import {
  CATEGORY_LABEL, ENTITY_LABEL, isDocRequired,
  type Criterion, type DocSlot, type EntityType, type VendorAnswers, type VendorProfile,
} from "@/lib/vendor-onboarding/types"
import {
  answerText, digits, errMsg, fmtPhone, fmtTaxId, getFormConfig, newDraftId, submitForm,
  type FormConfig, type UploadedFile,
} from "@/lib/vendor-onboarding/client"

const DRAFT_KEY = "vendor-onboarding-draft-v1"
const STAGES = ["ยินยอมให้ใช้ข้อมูล", "ข้อมูลผู้ส่งมอบ", "ข้อมูลประกอบการประเมิน", "เอกสาร", "ตรวจทานก่อนส่ง"] as const
const LAST = STAGES.length - 1

const EMPTY_PROFILE: VendorProfile = {
  entityType: "company", companyName: "", taxId: "", branch: "สำนักงานใหญ่", address: "", phone: "", email: "", productType: "",
  contact: { name: "", phone: "", email: "", position: "" },
}

type Draft = {
  draftId: string
  stage: number
  granted: string[]
  accepted: boolean
  profile: VendorProfile
  answers: VendorAnswers
  files: Record<string, UploadedFile[]>
}

const emptyDraft = (): Draft => ({ draftId: newDraftId(), stage: 0, granted: [], accepted: false, profile: EMPTY_PROFILE, answers: {}, files: {} })

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return emptyDraft()
    const d = JSON.parse(raw) as Partial<Draft>
    return {
      draftId: d.draftId || newDraftId(),
      stage: Math.min(Math.max(Number(d.stage) || 0, 0), LAST),
      granted: Array.isArray(d.granted) ? d.granted : [],
      accepted: Boolean(d.accepted),
      profile: { ...EMPTY_PROFILE, ...d.profile, contact: { ...EMPTY_PROFILE.contact, ...d.profile?.contact } },
      answers: d.answers ?? {},
      files: d.files ?? {},
    }
  } catch {
    return emptyDraft() // ร่างเสีย/เบราว์เซอร์ปิด storage — เริ่มใหม่เงียบ ๆ
  }
}
const writeDraft = (d: Draft) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* storage เต็ม/ปิด — กรอกต่อได้ แค่ไม่มีร่าง */ } }
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ไม่เป็นไร */ } }

const noSubscribe = () => () => {}
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
const phoneOk = (s: string) => /^0\d{8,9}$/.test(s)

type ProfileErrors = Partial<Record<"companyName" | "taxId" | "branch" | "address" | "phone" | "email" | "productType" | "cName" | "cPhone" | "cEmail", string>>

function validateProfile(p: VendorProfile): ProfileErrors {
  const e: ProfileErrors = {}
  if (!p.companyName.trim()) e.companyName = p.entityType === "company" ? "กรอกชื่อบริษัทหรือร้าน" : "กรอกชื่อ-นามสกุล"
  if (p.taxId.length !== 13) e.taxId = "เลขผู้เสียภาษีต้องมี 13 หลัก"
  else if (!taxIdOk(p.taxId)) e.taxId = "เลขนี้ไม่ผ่านการตรวจ ลองเทียบกับ ภ.พ.20 หรือบัตรประชาชนอีกที"
  if (!p.branch.trim()) e.branch = "ใส่ สำนักงานใหญ่ หรือเลขสาขา"
  if (!p.address.trim()) e.address = "กรอกที่อยู่"
  if (!phoneOk(p.phone)) e.phone = "เบอร์ 9–10 หลัก ขึ้นต้นด้วย 0"
  if (p.email && !emailOk(p.email)) e.email = "รูปแบบอีเมลไม่ถูก"
  if (!p.productType.trim()) e.productType = "บอกประเภทสินค้าหรือบริการที่ขาย"
  if (!p.contact.name.trim()) e.cName = "กรอกชื่อผู้ติดต่อ"
  if (!phoneOk(p.contact.phone)) e.cPhone = "เบอร์ 9–10 หลัก ขึ้นต้นด้วย 0"
  if (p.contact.email && !emailOk(p.contact.email)) e.cEmail = "รูปแบบอีเมลไม่ถูก"
  return e
}

/** yesno กับ number ต้องตอบ · text เว้นได้ (เช่น ไม่มี ISO ก็เว้นว่าง) */
function validateAnswers(criteria: Criterion[], a: VendorAnswers): Record<string, string> {
  const e: Record<string, string> = {}
  for (const c of criteria) {
    const v = a[c.key]
    if (c.input.kind === "yesno" && typeof v !== "boolean") e[c.key] = "เลือก มี หรือ ไม่มี"
    if (c.input.kind === "number" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) e[c.key] = "ใส่ตัวเลข"
  }
  return e
}

export function VendorRegisterForm() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  const [config, setConfig] = useState<FormConfig | null>(null)
  const [loadError, setLoadError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    getFormConfig()
      .then((c) => { if (alive) { setConfig(c); setLoadError("") } })
      .catch((e) => { if (alive) setLoadError(errMsg(e)) })
    return () => { alive = false }
  }, [reloadKey])

  if (loadError) {
    return (
      <div className="vo">
        <style>{VO_CSS}</style>
        <Hero title="สมัครเป็นผู้ส่งมอบ" sub="Mena Transport" />
        <section className="vo-card">
          <h2 className="vo-h2">เปิดฟอร์มไม่ได้</h2>
          <p className="vo-lead">{loadError}</p>
          <button type="button" className="vo-btn wide" onClick={() => { setLoadError(""); setReloadKey((k) => k + 1) }}>ลองใหม่</button>
        </section>
      </div>
    )
  }
  if (!hydrated || !config) return <PublicSkeleton title="สมัครเป็นผู้ส่งมอบ" />
  return <Flow config={config} initial={readDraft()} />
}

function Flow({ config, initial }: { config: FormConfig; initial: Draft }) {
  const { liff, idToken } = useLiff()
  const [draftId, setDraftId] = useState(initial.draftId)
  const [stage, setStage] = useState(initial.stage)
  const [granted, setGranted] = useState<string[]>(initial.granted)
  const [profile, setProfile] = useState<VendorProfile>(initial.profile)
  const [answers, setAnswers] = useState<VendorAnswers>(initial.answers)
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>(initial.files)
  const [touched, setTouched] = useState<Record<number, boolean>>({})
  const [busySlots, setBusySlots] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [doneRef, setDoneRef] = useState<string | null>(null)

  const criteria = useMemo(() => config.criteria.filter((c) => c.active && c.vendorQuestion != null).sort((a, b) => a.category - b.category || a.order - b.order), [config.criteria])
  const slots = useMemo(() => config.docSlots.filter((s) => s.active).sort((a, b) => a.order - b.order), [config.docSlots])
  const uploadSlots = useMemo(() => slots.filter((s) => s.requirement !== "system"), [slots])

  // ร่างลง localStorage ทุกครั้งที่ค่าเปลี่ยน (ยกเว้นหลังส่งแล้ว)
  useEffect(() => {
    if (doneRef) return
    writeDraft({ draftId, stage, granted, accepted: stage > 0, profile, answers, files })
  }, [draftId, stage, granted, profile, answers, files, doneRef])

  const pErrors = validateProfile(profile)
  const aErrors = validateAnswers(criteria, answers)
  const missingDocs = uploadSlots.filter((s) => isDocRequired(s, profile.entityType) && !(files[s.key]?.length))
  const uploading = Object.values(busySlots).some(Boolean)
  const consentReady = config.consentItems.every((c) => !c.required || granted.includes(c.id))

  const onBusy = useCallback((slot: string, busy: boolean) => setBusySlots((b) => (b[slot] === busy ? b : { ...b, [slot]: busy })), [])

  function goTo(n: number) {
    setStage(Math.min(Math.max(n, 0), LAST))
    setSubmitError("")
    scrollTop()
  }

  function next() {
    setTouched((t) => ({ ...t, [stage]: true }))
    if (stage === 0 && !consentReady) return
    if (stage === 1 && Object.keys(pErrors).length) { focusFirst(Object.keys(pErrors)[0]); return }
    if (stage === 2 && Object.keys(aErrors).length) { focusFirst(`q-${Object.keys(aErrors)[0]}`); return }
    if (stage === 3 && (missingDocs.length || uploading)) return
    goTo(stage + 1)
  }

  function focusFirst(id: string) {
    const el = document.getElementById(`vo-${id}`)
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
    el?.focus({ preventScroll: true })
  }

  async function submit() {
    if (saving) return
    // ตรวจซ้ำทุกขั้น เผื่อร่างเก่าข้ามมา
    if (!consentReady) return goTo(0)
    if (Object.keys(pErrors).length) { setTouched((t) => ({ ...t, 1: true })); return goTo(1) }
    if (Object.keys(aErrors).length) { setTouched((t) => ({ ...t, 2: true })); return goTo(2) }
    if (missingDocs.length) { setTouched((t) => ({ ...t, 3: true })); return goTo(3) }
    setSaving(true)
    setSubmitError("")
    try {
      const clean: VendorProfile = {
        ...profile,
        companyName: profile.companyName.trim(), branch: profile.branch.trim(), address: profile.address.trim(),
        email: profile.email.trim(), productType: profile.productType.trim(),
        contact: { name: profile.contact.name.trim(), phone: profile.contact.phone, email: profile.contact.email.trim(), position: profile.contact.position.trim() },
      }
      const keep = new Set(criteria.map((c) => c.key))
      const res = await submitForm({
        draftId,
        consent: { items: config.consentItems.map((c) => ({ id: c.id, granted: granted.includes(c.id) })) },
        profile: clean,
        answers: Object.fromEntries(Object.entries(answers).filter(([k, v]) => keep.has(k) && v !== "")),
        documents: uploadSlots.filter((s) => files[s.key]?.length).map((s) => ({ slot: s.key, files: files[s.key] })),
        idToken: await idToken(),
      })
      clearDraft()
      setDoneRef(res.ref)
      scrollTop()
    } catch (e) {
      setSubmitError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  function restart() {
    clearDraft()
    setDraftId(newDraftId()); setStage(0); setGranted([]); setProfile(EMPTY_PROFILE); setAnswers({}); setFiles({}); setTouched({}); setDoneRef(null)
    scrollTop()
  }

  if (doneRef) {
    return (
      <div className="vo">
        <style>{VO_CSS}</style>
        <Hero title="ส่งใบสมัครแล้ว" sub={profile.companyName} />
        <section className="vo-card vo-done">
          <div className="vo-done-check"><Check size={34} strokeWidth={3} aria-hidden /></div>
          <h2 className="vo-h2" style={{ marginTop: 14 }}>ได้รับข้อมูลแล้ว ขอบคุณครับ</h2>
          <p className="vo-lead" style={{ margin: 0 }}>เลขที่ใบสมัคร เก็บไว้ใช้ตอนติดต่อฝ่ายจัดซื้อ</p>
          <div className="vo-ref" aria-label="เลขที่ใบสมัคร">{doneRef}</div>
          <ol className="vo-steps">
            <li>ฝ่ายจัดซื้อตรวจเอกสารและข้อมูลที่ส่งมา</li>
            <li>ถ้าเอกสารไม่ครบหรือไม่ชัด จะส่งลิงก์ให้แนบเพิ่มทางเบอร์หรืออีเมลผู้ติดต่อ</li>
            <li>ผ่านการคัดเลือกแล้ว ฝ่ายจัดซื้อจะแจ้งรหัสผู้ส่งมอบให้</li>
          </ol>
        </section>
        <div className="vo-bar" style={{ display: "grid", gap: 10 }}>
          {liff && <button type="button" className="vo-btn wide" onClick={() => liff.closeWindow()}>ปิดหน้าต่าง</button>}
          <button type="button" className="vo-btn ghost wide" onClick={restart}>สมัครให้อีกราย</button>
        </div>
      </div>
    )
  }

  const shown = touched[stage]
  const setP = <K extends keyof VendorProfile>(k: K, v: VendorProfile[K]) => setProfile((p) => ({ ...p, [k]: v }))
  const setC = (k: keyof VendorProfile["contact"], v: string) => setProfile((p) => ({ ...p, contact: { ...p.contact, [k]: v } }))

  return (
    <div className="vo">
      <style>{VO_CSS}</style>
      <Hero title="สมัครเป็นผู้ส่งมอบ" sub="Mena Transport · กรอกครั้งเดียว ใช้เวลาราว 10 นาที">
        <StepRail stage={stage} total={STAGES.length} title={STAGES[stage]} />
      </Hero>

      <div key={stage}>
        {stage === 0 && (
          <section className="vo-card" aria-labelledby="vo-h-consent">
            <h2 className="vo-h2" id="vo-h-consent"><ShieldCheck size={18} style={{ verticalAlign: -3, marginRight: 6, color: "#046132" }} aria-hidden />ก่อนเริ่มกรอก</h2>
            <p className="vo-lead">เราใช้ข้อมูลและเอกสารที่ส่งมาเพื่อคัดเลือกผู้ส่งมอบเท่านั้น ติ๊กยินยอมทุกข้อที่มีป้าย “จำเป็น” ก่อนนะครับ</p>
            {config.consentItems.map((c) => {
              const on = granted.includes(c.id)
              return (
                <label key={c.id} className={`vo-check${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => setGranted((g) => (on ? g.filter((x) => x !== c.id) : [...g, c.id]))} />
                  <span className="vo-tick" aria-hidden>{on && <Check size={14} strokeWidth={3} />}</span>
                  <span className="vo-check-text">
                    {c.label}
                    <span className={`vo-tag ${c.required ? "req" : "opt"}`}>{c.required ? "จำเป็น" : "ไม่บังคับ"}</span>
                  </span>
                </label>
              )
            })}
            {shown && !consentReady && <div className="vo-err" role="alert">ติ๊กข้อที่จำเป็นให้ครบก่อน</div>}
            <p className="vo-lead" style={{ fontSize: 12.5, marginTop: 8 }}>ฉบับความยินยอม {config.consentVersion}</p>
          </section>
        )}

        {stage === 1 && (
          <section className="vo-card" aria-label="ข้อมูลผู้ส่งมอบ">
            <div className="vo-sec">ประเภทผู้ส่งมอบ</div>
            <div className="vo-seg" role="group" aria-label="ประเภทผู้ส่งมอบ" style={{ marginBottom: 16 }}>
              {(Object.keys(ENTITY_LABEL) as EntityType[]).map((t) => (
                <button key={t} type="button" aria-pressed={profile.entityType === t} onClick={() => setP("entityType", t)}>{ENTITY_LABEL[t]}</button>
              ))}
            </div>

            <Field id="vo-companyName" label={profile.entityType === "company" ? "ชื่อบริษัท / ร้าน" : "ชื่อ-นามสกุล"} icon={<Building2 size={18} />} error={shown ? pErrors.companyName : undefined}>
              <input id="vo-companyName" autoComplete={profile.entityType === "company" ? "organization" : "name"} value={profile.companyName} maxLength={200}
                placeholder={profile.entityType === "company" ? "บริษัท ตัวอย่าง จำกัด" : "สมชาย ใจดี"} onChange={(e) => setP("companyName", e.target.value)} />
            </Field>

            <div className="vo-row">
              <Field id="vo-taxId" label="เลขผู้เสียภาษี" icon={<Receipt size={18} />}
                error={(shown || profile.taxId.length === 13) ? pErrors.taxId : undefined}
                ok={profile.taxId.length === 13 && !pErrors.taxId ? "เลขถูกต้อง" : undefined}>
                <input id="vo-taxId" inputMode="numeric" className="vo-mono" placeholder="0-0000-00000-00-0"
                  value={fmtTaxId(profile.taxId)} onChange={(e) => setP("taxId", digits(e.target.value).slice(0, 13))} />
              </Field>
              <Field id="vo-branch" label="สาขา" icon={<Hash size={18} />} error={shown ? pErrors.branch : undefined}>
                <input id="vo-branch" value={profile.branch} maxLength={60} placeholder="สำนักงานใหญ่ / 00001" onChange={(e) => setP("branch", e.target.value)} />
              </Field>
            </div>

            <Field id="vo-address" label="ที่อยู่" icon={<MapPin size={18} />} error={shown ? pErrors.address : undefined}>
              <textarea id="vo-address" rows={3} autoComplete="street-address" maxLength={500} placeholder="เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
                value={profile.address} onChange={(e) => setP("address", e.target.value)} />
            </Field>

            <div className="vo-row">
              <Field id="vo-phone" label="เบอร์โทร" icon={<Phone size={18} />} error={shown ? pErrors.phone : undefined}>
                <input id="vo-phone" type="tel" inputMode="numeric" autoComplete="tel" className="vo-mono" placeholder="02-123-4567"
                  value={fmtPhone(profile.phone)} onChange={(e) => setP("phone", digits(e.target.value).slice(0, 10))} />
              </Field>
              <Field id="vo-email" label={<>อีเมล <small>(ถ้ามี)</small></>} icon={<AtSign size={18} />} error={shown ? pErrors.email : undefined}>
                <input id="vo-email" type="email" inputMode="email" autoComplete="email" value={profile.email} maxLength={120} onChange={(e) => setP("email", e.target.value.trim())} />
              </Field>
            </div>

            <Field id="vo-productType" label="ประเภทสินค้า / บริการ" icon={<Package size={18} />} error={shown ? pErrors.productType : undefined}>
              <input id="vo-productType" value={profile.productType} maxLength={200} placeholder="เช่น อะไหล่ช่วงล่าง, ยางรถบรรทุก, งานซ่อมแอร์"
                onChange={(e) => setP("productType", e.target.value)} />
            </Field>

            <div className="vo-sec">ผู้ติดต่อ (Contact Person)</div>
            <div className="vo-row">
              <Field id="vo-cName" label="ชื่อ-นามสกุล" icon={<User size={18} />} error={shown ? pErrors.cName : undefined}>
                <input id="vo-cName" autoComplete="name" value={profile.contact.name} maxLength={120} onChange={(e) => setC("name", e.target.value)} />
              </Field>
              <Field id="vo-cPosition" label={<>ตำแหน่ง <small>(ถ้ามี)</small></>} icon={<Briefcase size={18} />}>
                <input id="vo-cPosition" autoComplete="organization-title" value={profile.contact.position} maxLength={80} onChange={(e) => setC("position", e.target.value)} />
              </Field>
            </div>
            <div className="vo-row">
              <Field id="vo-cPhone" label="เบอร์มือถือ" icon={<Phone size={18} />} error={shown ? pErrors.cPhone : undefined}>
                <input id="vo-cPhone" type="tel" inputMode="numeric" className="vo-mono" placeholder="081-234-5678"
                  value={fmtPhone(profile.contact.phone)} onChange={(e) => setC("phone", digits(e.target.value).slice(0, 10))} />
              </Field>
              <Field id="vo-cEmail" label={<>อีเมล <small>(ถ้ามี)</small></>} icon={<AtSign size={18} />} error={shown ? pErrors.cEmail : undefined}>
                <input id="vo-cEmail" type="email" inputMode="email" value={profile.contact.email} maxLength={120} onChange={(e) => setC("email", e.target.value.trim())} />
              </Field>
            </div>
          </section>
        )}

        {stage === 2 && (
          <QuestionsStage criteria={criteria} answers={answers} errors={shown ? aErrors : {}}
            onAnswer={(k, v) => setAnswers((a) => { const n = { ...a }; if (v === undefined) delete n[k]; else n[k] = v; return n })} />
        )}

        {stage === 3 && (
          <DocsStage slots={slots} entity={profile.entityType} files={files} draftId={draftId} config={config} onBusy={onBusy}
            missing={shown ? missingDocs.map((s) => s.key) : []}
            onFiles={(slot, list) => setFiles((f) => ({ ...f, [slot]: list }))} />
        )}

        {stage === 4 && (
          <ReviewStage profile={profile} criteria={criteria} answers={answers} slots={uploadSlots} files={files} onEdit={goTo} />
        )}
      </div>

      <div className="vo-bar">
        {stage === 3 && shown && missingDocs.length > 0 && (
          <div className="vo-alert" role="alert">ยังขาดเอกสารบังคับ {missingDocs.length} รายการ: {missingDocs.map((s) => s.label).join(", ")}</div>
        )}
        {stage === 3 && uploading && <div className="vo-info" role="status">รอไฟล์อัปให้เสร็จก่อนนะครับ</div>}
        {submitError && <div className="vo-alert" role="alert">{submitError}</div>}
        <div className="vo-bar-row">
          {stage > 0 && (
            <button type="button" className="vo-btn ghost" onClick={() => goTo(stage - 1)} aria-label="ย้อนกลับ"><ChevronLeft size={18} aria-hidden /> กลับ</button>
          )}
          {stage < LAST ? (
            <button type="button" className="vo-btn" onClick={next} disabled={(stage === 0 && !consentReady) || (stage === 3 && uploading)}>
              {stage === 0 ? "ยินยอมและเริ่มกรอก" : "ถัดไป"}
            </button>
          ) : (
            <button type="button" className="vo-btn" onClick={submit} disabled={saving}>
              {saving ? <><Loader2 size={18} className="animate-spin" aria-hidden /> กำลังส่ง…</> : "ส่งใบสมัคร"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function QuestionsStage({ criteria, answers, errors, onAnswer }: {
  criteria: Criterion[]; answers: VendorAnswers; errors: Record<string, string>
  onAnswer: (key: string, v: boolean | number | string | undefined) => void
}) {
  const groups = useMemo(() => {
    const m = new Map<number, Criterion[]>()
    for (const c of criteria) m.set(c.category, [...(m.get(c.category) ?? []), c])
    return [...m]
  }, [criteria])

  if (!criteria.length) {
    return <section className="vo-card"><p className="vo-lead" style={{ margin: 0 }}>ขั้นนี้ไม่มีคำถาม กดถัดไปได้เลย</p></section>
  }

  return (
    <>
      {groups.map(([cat, list], gi) => (
        <section key={cat} className="vo-card" aria-labelledby={`vo-cat-${cat}`}>
          {gi === 0 && <p className="vo-lead">ตอบตามจริง ฝ่ายจัดซื้อใช้ประกอบการประเมิน ไม่มีข้อไหนตอบแล้วตกทันที</p>}
          <div className="vo-sec" id={`vo-cat-${cat}`}>{cat}. {CATEGORY_LABEL[cat] ?? ""}</div>
          {list.map((c) => {
            const v = answers[c.key]
            const err = errors[c.key]
            const qid = `vo-q-${c.key}`
            return (
              <div key={c.key} className="vo-q">
                {c.input.kind === "yesno" ? (
                  <div role="group" aria-labelledby={`${qid}-l`}>
                    <span className="vo-q-label" id={`${qid}-l`}>{c.vendorQuestion}</span>
                    <div className="vo-yn">
                      <button id={qid} type="button" aria-pressed={v === true} onClick={() => onAnswer(c.key, true)}>มี</button>
                      <button type="button" className="no" aria-pressed={v === false} onClick={() => onAnswer(c.key, false)}>ไม่มี</button>
                    </div>
                  </div>
                ) : c.input.kind === "number" ? (
                  <>
                    <label className="vo-q-label" htmlFor={qid}>{c.vendorQuestion}</label>
                    <div className={`vo-box${err ? " err" : ""}`}>
                      <input id={qid} inputMode="numeric" className="vo-mono" value={typeof v === "number" ? String(v) : ""} placeholder="0"
                        onChange={(e) => { const d = digits(e.target.value).slice(0, 5); onAnswer(c.key, d === "" ? undefined : Number(d)) }} />
                      <span className="vo-unit">{c.input.unit}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="vo-q-label" htmlFor={qid}>{c.vendorQuestion}</label>
                    <div className="vo-box">
                      <textarea id={qid} rows={2} maxLength={300} value={typeof v === "string" ? v : ""}
                        placeholder={c.input.kind === "text" ? c.input.placeholder : undefined}
                        onChange={(e) => onAnswer(c.key, e.target.value === "" ? undefined : e.target.value)} />
                    </div>
                  </>
                )}
                {err && <div className="vo-err">{err}</div>}
              </div>
            )
          })}
        </section>
      ))}
    </>
  )
}

function DocsStage({ slots, entity, files, draftId, config, missing, onFiles, onBusy }: {
  slots: DocSlot[]; entity: EntityType; files: Record<string, UploadedFile[]>; draftId: string; config: FormConfig
  missing: string[]; onFiles: (slot: string, list: UploadedFile[]) => void; onBusy: (slot: string, busy: boolean) => void
}) {
  const groups = useMemo(() => {
    const m = new Map<string, DocSlot[]>()
    for (const s of slots) m.set(s.group, [...(m.get(s.group) ?? []), s])
    return [...m]
  }, [slots])
  const limits = { maxFiles: config.maxFiles, maxBytes: config.maxBytes, types: config.types }
  const presignExtra = useMemo(() => ({ draftId }), [draftId])

  return (
    <>
      {groups.map(([group, list], gi) => (
        <section key={group} className="vo-card" aria-label={group}>
          {gi === 0 && (
            <p className="vo-lead">
              แนบได้ทั้งรูปถ่ายและ PDF รายการละไม่เกิน {config.maxFiles} ไฟล์ ไฟล์ละไม่เกิน {Math.round(config.maxBytes / 1024 / 1024)} MB
              {entity === "individual" ? " · บุคคลธรรมดาไม่ต้องแนบเอกสารของบริษัท" : ""}
            </p>
          )}
          <div className="vo-sec">{group}</div>
          {list.map((s) => {
            if (s.requirement === "system") {
              return (
                <div key={s.key} className="vo-sys">
                  <span>{s.label}</span>
                  <span className="vo-tag sys">{s.hint || "ทำผ่านระบบ"}</span>
                </div>
              )
            }
            const req = isDocRequired(s, entity)
            const has = (files[s.key]?.length ?? 0) > 0
            const isMissing = missing.includes(s.key)
            return (
              <div key={s.key} className="vo-slot" id={`vo-slot-${s.key}`}>
                <div className="vo-slot-head">
                  <div>
                    <div className="vo-slot-name">{s.label}</div>
                    {s.hint && <div className="vo-slot-hint">{s.hint}</div>}
                  </div>
                  <span className={`vo-tag ${has ? "ok" : req ? "req" : "opt"}`}>{has ? "แนบแล้ว" : req ? "บังคับ" : "ไม่บังคับ"}</span>
                </div>
                <SlotUploader slot={s.key} label={s.label} files={files[s.key] ?? []} onChange={(l) => onFiles(s.key, l)} onBusy={onBusy}
                  presignUrl="/api/form-vendor/uploads/presign" presignExtra={presignExtra} limits={limits} />
                {isMissing && <div className="vo-err">รายการนี้ต้องแนบ</div>}
              </div>
            )
          })}
        </section>
      ))}
    </>
  )
}

function ReviewStage({ profile, criteria, answers, slots, files, onEdit }: {
  profile: VendorProfile; criteria: Criterion[]; answers: VendorAnswers; slots: DocSlot[]; files: Record<string, UploadedFile[]>; onEdit: (stage: number) => void
}) {
  const head = (title: string, stage: number) => (
    <div className="vo-sum-head">
      <h2 className="vo-h2" style={{ margin: 0, fontSize: 16 }}>{title}</h2>
      <button type="button" className="vo-link" onClick={() => onEdit(stage)} aria-label={`แก้ไข${title}`}>แก้ไข</button>
    </div>
  )
  const withFiles = slots.filter((s) => files[s.key]?.length)
  return (
    <>
      <section className="vo-card">
        <p className="vo-lead">ดูให้ครบอีกรอบ ถ้าถูกแล้วกด “ส่งใบสมัคร” ส่งแล้วแก้เองไม่ได้ ต้องให้ฝ่ายจัดซื้อส่งลิงก์ให้</p>
        {head("ข้อมูลผู้ส่งมอบ", 1)}
        <dl className="vo-sum">
          {([
            ["ประเภท", ENTITY_LABEL[profile.entityType]],
            [profile.entityType === "company" ? "ชื่อบริษัท" : "ชื่อ", profile.companyName],
            ["เลขผู้เสียภาษี", fmtTaxId(profile.taxId)],
            ["สาขา", profile.branch],
            ["ที่อยู่", profile.address],
            ["เบอร์โทร", fmtPhone(profile.phone)],
            ["อีเมล", profile.email || "—"],
            ["สินค้า/บริการ", profile.productType],
            ["ผู้ติดต่อ", [profile.contact.name, profile.contact.position].filter(Boolean).join(" · ")],
            ["เบอร์ผู้ติดต่อ", fmtPhone(profile.contact.phone)],
            ["อีเมลผู้ติดต่อ", profile.contact.email || "—"],
          ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>
      {criteria.length > 0 && (
        <section className="vo-card">
          {head("ข้อมูลประกอบการประเมิน", 2)}
          <dl className="vo-sum">
            {criteria.map((c) => <div key={c.key}><dt style={{ width: "55%" }}>{c.vendorQuestion}</dt><dd>{answerText(c, answers[c.key])}</dd></div>)}
          </dl>
        </section>
      )}
      <section className="vo-card">
        {head("เอกสารที่แนบ", 3)}
        {withFiles.length === 0 ? <p className="vo-lead" style={{ margin: 0 }}>ยังไม่ได้แนบเอกสาร</p> : (
          <dl className="vo-sum">
            {withFiles.map((s) => <div key={s.key}><dt style={{ width: "55%" }}>{s.label}</dt><dd>{files[s.key].length} ไฟล์</dd></div>)}
          </dl>
        )}
      </section>
    </>
  )
}
