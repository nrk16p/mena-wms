"use client"
// รายละเอียดใบสมัครผู้ส่งมอบ — แท็บ ข้อมูล / เอกสาร / ประเมิน / ประวัติ
// ปุ่มท้าย modal โชว์เฉพาะที่บทบาทของคนเปิดกดได้ในสถานะตอนนี้ (ตาม ACTIONS ใน types.ts)
// ตรวจเอกสาร + ให้คะแนน = ฝ่ายจัดซื้อ (officer) ตอนสถานะ "กำลังตรวจ" · คะแนนบันทึกอัตโนมัติ
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Swal from "sweetalert2"
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, FileText, ImageIcon, Link2, Loader2, Printer, RotateCcw, X } from "lucide-react"
import { darkOpts, swalError, swalTextInput } from "@/lib/swal"
import {
  ACTIONS, CATEGORY_LABEL, ENTITY_LABEL, STATUS_LABEL, canSendReview, isDocRequired, scoreSummary,
  type ActorRole, type Criterion, type DocEntry, type DocSlot, type OnboardingAction, type OnboardingDoc, type ScoreItem, type ScoreValue,
} from "@/lib/vendor-onboarding/types"
import {
  answerText, errMsg, fileUrl, fmtBytes, fmtPhone, fmtTaxId, getOnboarding, isNewDoc, patchDocument, patchScores, patchVendorCode,
  postAction, thDate, thDateTime, type DetailResponse, type LegacyDoc,
} from "@/lib/vendor-onboarding/client"
import { DocChip, Dl, ModalShell, Panel, StatusPill, btn, inputCls } from "./admin-ui"

type Tab = "info" | "docs" | "score" | "history"
const TABS: { id: Tab; label: string }[] = [
  { id: "info", label: "ข้อมูล" },
  { id: "docs", label: "เอกสาร" },
  { id: "score", label: "ประเมิน" },
  { id: "history", label: "ประวัติ" },
]

/** บทบาทนี้กด action นี้ได้ไหม — reject: reviewer หรือ approver */
function roleCan(roles: ActorRole[], a: OnboardingAction) {
  const need = ACTIONS[a].role
  return roles.includes(need) || (a === "reject" && roles.includes("approver"))
}

export function DetailModal({ id, threshold, onClose, onChanged }: {
  id: string
  threshold: number | null
  onClose: () => void
  onChanged: () => void
}) {
  const [res, setRes] = useState<DetailResponse | null>(null)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    getOnboarding(id)
      .then((d) => { if (alive) { setRes(d); setError("") } })
      .catch((e) => { if (alive) setError(errMsg(e)) })
    return () => { alive = false }
  }, [id, reloadKey])

  if (error) {
    return (
      <ModalShell title="เปิดใบสมัครไม่ได้" onClose={onClose} width="520px"
        footer={<><button type="button" className={btn.ghost} onClick={onClose}>ปิด</button><button type="button" className={btn.primary} onClick={() => { setError(""); setReloadKey((k) => k + 1) }}>ลองใหม่</button></>}>
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </ModalShell>
    )
  }
  if (!res) {
    return (
      <ModalShell title="กำลังโหลด…" onClose={onClose} width="520px">
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" aria-hidden /> กำลังโหลดใบสมัคร</div>
      </ModalShell>
    )
  }
  if (!isNewDoc(res.doc)) return <LegacyModal doc={res.doc} onClose={onClose} />
  return <Detail id={id} initial={res} doc0={res.doc} threshold={threshold} onClose={onClose} onChanged={onChanged} />
}

// ───────────────────────── ใบแบบเก่า (อ่านอย่างเดียว) ─────────────────────────

function LegacyModal({ doc, onClose }: { doc: LegacyDoc; onClose: () => void }) {
  const name = doc.fullName || [doc.firstName, doc.lastName].filter(Boolean).join(" ")
  return (
    <ModalShell title={doc.onBehalf || name || "ใบลงทะเบียนแบบเก่า"} subtitle={<span>ใบลงทะเบียนแบบเก่า · อ่านอย่างเดียว</span>} onClose={onClose} width="640px"
      footer={<button type="button" className={btn.ghost} onClick={onClose}>ปิด</button>}>
      <Panel>
        <Dl rows={[
          ["ชื่อ", name],
          ["ในนาม", doc.onBehalf ?? ""],
          ["เลขผู้เสียภาษี", doc.taxId ? fmtTaxId(doc.taxId) : ""],
          ["เบอร์โทร", doc.phone ? fmtPhone(doc.phone) : ""],
          ["ที่อยู่", doc.address ?? ""],
          ["LINE", doc.lineDisplayName ?? ""],
          ["สถานะ", doc.status === "approved" ? "อนุมัติ" : doc.status === "rejected" ? "ไม่ผ่าน" : "รอตรวจ"],
          ["รหัส vendor", doc.vendorCode ?? ""],
          ["ผู้ตรวจ", doc.reviewedBy ? `${doc.reviewedBy.name} · ${thDateTime(doc.reviewedAt)}` : ""],
          ["หมายเหตุ", doc.reviewNote ?? ""],
          ["วันที่ส่ง", thDateTime(doc.createdAt)],
        ]} />
      </Panel>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400">ใบนี้มาจากฟอร์มเดิมก่อนมีขั้นตอนคัดเลือก ถ้าจะคัดเลือกตามขั้นตอนใหม่ ให้ผู้ส่งมอบกรอกฟอร์มใหม่อีกครั้ง</p>
    </ModalShell>
  )
}

// ───────────────────────── ใบแบบใหม่ ─────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error"

function Detail({ id, initial, doc0, threshold, onClose, onChanged }: {
  id: string; initial: DetailResponse; doc0: OnboardingDoc; threshold: number | null; onClose: () => void; onChanged: () => void
}) {
  const roles = initial.roles
  const [doc, setDoc] = useState<OnboardingDoc>(doc0)
  const [tab, setTab] = useState<Tab>(doc0.status === "submitted" || doc0.status === "checking" ? "docs" : "info")
  const [busy, setBusy] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(doc0.status === "need_docs" ? initial.activeLink?.url ?? null : null)
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | undefined>(initial.activeLink?.expiresAt)
  const [reqOpen, setReqOpen] = useState(false)

  const isOfficer = roles.includes("officer")
  const editable = isOfficer && doc.status === "checking"

  // ── คะแนน (autosave) ──
  const [scores, setScores] = useState<ScoreItem[]>(doc0.scores ?? [])
  const [save, setSave] = useState<{ state: SaveState; at: string; msg: string }>({ state: "idle", at: "", msg: "" })
  const pending = useRef<ScoreItem[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const s = pending.current
    if (!s) return
    pending.current = null
    setSave((x) => ({ ...x, state: "saving" }))
    try {
      const r = await patchScores(id, s)
      if (r?.doc) setDoc((d) => ({ ...d, ...r.doc, scores: s }))
      else setDoc((d) => ({ ...d, scores: s }))
      dirty.current = true
      setSave({ state: "saved", at: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }), msg: "" })
    } catch (e) {
      pending.current = pending.current ?? s
      setSave({ state: "error", at: "", msg: errMsg(e) })
    }
  }, [id])

  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  useEffect(() => () => { void flushRef.current() }, [])

  function setScore(key: string, patch: Partial<ScoreItem>) {
    const prev = pending.current ?? scores
    const cur = prev.find((s) => s.key === key)
    if (!cur && !patch.value) return // ยังไม่เลือกผ่าน/ไม่ผ่าน = เขียนหมายเหตุไม่ได้
    const nextItem: ScoreItem = { key, value: patch.value ?? cur?.value ?? "pass", note: patch.note ?? cur?.note }
    const next = cur ? prev.map((s) => (s.key === key ? nextItem : s)) : [...prev, nextItem]
    setScores(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), 700)
  }

  const live: OnboardingDoc = useMemo(() => ({ ...doc, scores }), [doc, scores])
  const sum = scoreSummary(live)
  const sendCheck = canSendReview(live)

  function closeAll() {
    void flush()
    if (dirty.current) onChanged()
    onClose()
  }

  // ── เอกสาร ──
  async function setDocStatus(slot: DocSlot, status: "passed" | "redo") {
    let note: string | undefined
    if (status === "redo") {
      const r = await swalTextInput({ title: "ขอเอกสารใหม่", html: slot.label, label: "บอกผู้ส่งมอบว่าต้องแก้อะไร", placeholder: "เช่น รูปไม่ชัด, หนังสือรับรองเกิน 6 เดือน", required: true, confirmText: "บันทึก" })
      if (!r.isConfirmed) return
      note = String(r.value ?? "").trim()
    }
    setBusy(`doc:${slot.key}`)
    try {
      const r = await patchDocument(id, { slot: slot.key, status, note })
      if (r?.doc) setDoc((d) => ({ ...r.doc, scores: d.scores }))
      dirty.current = true
    } catch (e) {
      void swalError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  // ── action ──
  const actions = (Object.keys(ACTIONS) as OnboardingAction[]).filter((a) => ACTIONS[a].from.includes(doc.status) && roleCan(roles, a))

  async function run(a: OnboardingAction) {
    if (a === "request_docs") { setReqOpen(true); return }
    const meta = ACTIONS[a]
    let note: string | undefined
    if (meta.needsNote) {
      const r = await swalTextInput({
        title: meta.label, html: doc.profile.companyName, label: "เหตุผล (บันทึกในประวัติ)", required: true,
        confirmText: meta.label, danger: a === "reject" || a === "cancel",
      })
      if (!r.isConfirmed) return
      note = String(r.value ?? "").trim()
    } else if (a !== "start_check") {
      const r = await Swal.fire({
        title: `${meta.label}?`, text: `${doc.profile.companyName} → ${STATUS_LABEL[meta.to]}`, icon: "question",
        showCancelButton: true, confirmButtonText: meta.label, cancelButtonText: "ยกเลิก", confirmButtonColor: "#1B8C4B", reverseButtons: true, ...darkOpts(),
      })
      if (!r.isConfirmed) return
    }
    await doAction(a, { note })
  }

  async function doAction(a: OnboardingAction, body: { note?: string; requestedSlots?: string[] }) {
    await flush()
    setBusy(`act:${a}`)
    try {
      const r = await postAction(id, { action: a, ...body })
      setDoc(r.doc)
      setScores(r.doc.scores ?? [])
      if (r.linkUrl) { setLinkUrl(r.linkUrl); setLinkExpiresAt(r.linkExpiresAt ?? undefined) }
      else if (r.doc.status !== "need_docs") setLinkUrl(null)
      dirty.current = true
      if (a === "start_check") setTab("docs")
      return true
    } catch (e) {
      void swalError(errMsg(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const thr = doc.passThreshold ?? threshold ?? 0

  return (
    <ModalShell
      title={doc.profile.companyName}
      width="900px"
      onClose={closeAll}
      subtitle={<>
        <span className="font-mono">{doc.ref}</span>
        <span aria-hidden>·</span>
        <span>{ENTITY_LABEL[doc.profile.entityType]}</span>
        <span aria-hidden>·</span>
        <span>ส่ง {thDate(doc.createdAt)}</span>
        <StatusPill status={doc.status} />
      </>}
      footer={<>
        <a href={`/vendors/onboarding/${encodeURIComponent(id)}/print`} target="_blank" rel="noopener noreferrer" className={`${btn.ghost} mr-auto`}>
          <Printer size={15} aria-hidden /> พิมพ์ใบคัดเลือก
        </a>
        {actions.map((a) => {
          const meta = ACTIONS[a]
          const blocked = a === "send_review" && !sendCheck.ok
          const danger = a === "reject" || a === "cancel"
          const back = a === "review_return" || a === "approve_return"
          const primary = !danger && !back && a !== "request_docs" && a !== "reissue_link"
          return (
            <button key={a} type="button" disabled={Boolean(busy) || blocked} onClick={() => void run(a)}
              title={blocked ? sendCheck.reasons.join(" · ") : undefined}
              className={danger ? btn.danger : primary ? btn.primary : btn.ghost}>
              {busy === `act:${a}` && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {back && <RotateCcw size={14} aria-hidden />}
              {meta.label}
            </button>
          )
        })}
        {actions.length === 0 && <button type="button" className={btn.ghost} onClick={closeAll}>ปิด</button>}
      </>}
    >
      {actions.includes("send_review") && !sendCheck.ok && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 flex-none" aria-hidden />
          <span>ยังส่งรีวิวไม่ได้: {sendCheck.reasons.join(" · ")}</span>
        </div>
      )}

      {linkUrl && <LinkBanner url={linkUrl} expiresAt={linkExpiresAt} />}
      {!linkUrl && doc.status === "need_docs" && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 flex-none" aria-hidden />
          <span>ลิงก์ส่งเอกสารเดิมหมดอายุหรือใช้ไปแล้ว{actions.includes("reissue_link") ? " กด \"ออกลิงก์ใหม่\" แล้วส่งให้ผู้ส่งมอบอีกครั้ง" : ""}</span>
        </div>
      )}

      {doc.status === "approved" && <VendorCodeBox id={id} value={doc.vendorCode} canEdit={isOfficer || roles.includes("approver")} onSaved={(v) => { setDoc((d) => ({ ...d, vendorCode: v })); dirty.current = true }} />}

      <div role="tablist" aria-label="ส่วนของใบสมัคร" className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-[#E8EEEA] dark:bg-[#151a10] dark:ring-white/8">
        {TABS.map((t) => {
          const badge = t.id === "score" ? `${sum.pass}/${sum.total}` : t.id === "docs" ? docBadge(doc) : null
          return (
            <button key={t.id} type="button" role="tab" id={`vo-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`vo-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab)
                if (e.key === "ArrowRight") { const n = TABS[(i + 1) % TABS.length].id; setTab(n); document.getElementById(`vo-tab-${n}`)?.focus() }
                if (e.key === "ArrowLeft") { const n = TABS[(i + TABS.length - 1) % TABS.length].id; setTab(n); document.getElementById(`vo-tab-${n}`)?.focus() }
              }}
              tabIndex={tab === t.id ? 0 : -1}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 ${tab === t.id ? "bg-[#1B8C4B] text-white" : "text-gray-600 hover:bg-[#F6FAF7] dark:text-gray-300 dark:hover:bg-white/5"}`}>
              {t.label}
              {badge && <span className={`rounded-full px-1.5 font-mono text-[10.5px] ${tab === t.id ? "bg-white/20" : "bg-gray-100 dark:bg-white/10"}`}>{badge}</span>}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`vo-panel-${tab}`} aria-labelledby={`vo-tab-${tab}`} className="flex flex-col gap-3.5">
        {tab === "info" && <InfoTab doc={doc} />}
        {tab === "docs" && <DocsTab doc={doc} id={id} editable={editable} busy={busy} onSet={setDocStatus} />}
        {tab === "score" && (
          <ScoreTab doc={doc} scores={scores} editable={editable} threshold={thr} sum={sum} save={save}
            onRetry={() => void flush()} onScore={setScore} />
        )}
        {tab === "history" && <HistoryTab doc={doc} />}
      </div>

      {reqOpen && (
        <RequestDocsModal doc={doc} onClose={() => setReqOpen(false)}
          onSubmit={async (slots, note) => { const ok = await doAction("request_docs", { note, requestedSlots: slots }); if (ok) setReqOpen(false) }} />
      )}
    </ModalShell>
  )
}

function docBadge(doc: OnboardingDoc) {
  const by = new Map(doc.documents.map((d) => [d.slot, d]))
  const req = doc.docSlotSnapshot.filter((s) => s.active && isDocRequired(s, doc.profile.entityType))
  return `${req.filter((s) => by.get(s.key)?.status === "passed").length}/${req.length}`
}

// ── ลิงก์ขอเอกสารเพิ่ม ──
function LinkBanner({ url, expiresAt }: { url: string; expiresAt?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-400/30 dark:bg-amber-500/10">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900 dark:text-amber-100">
        <Link2 size={15} aria-hidden /> ลิงก์ให้ผู้ส่งมอบแนบเอกสารเพิ่ม
        {expiresAt && <span className="font-normal text-amber-800/80 dark:text-amber-200/80">· ใช้ได้ถึง {thDate(expiresAt)}</span>}
      </div>
      <div className="flex gap-2">
        <label htmlFor="vo-link-url" className="sr-only">ลิงก์</label>
        <input id="vo-link-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} font-mono text-[12px]`} />
        <button type="button" className={btn.primary} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ไม่ให้คัดลอก — กดเลือกในช่องแล้วคัดลอกเอง */ } }}>
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "คัดลอกแล้ว" : "คัดลอก"}
        </button>
      </div>
      <p className="text-[12px] text-amber-800 dark:text-amber-200/90">ส่งลิงก์นี้ให้ผู้ติดต่อทาง LINE หรืออีเมล แนบครบแล้วใบจะกลับมาที่ “กำลังตรวจ” เอง</p>
    </div>
  )
}

// ── รหัส vendor หลังอนุมัติ ──
function VendorCodeBox({ id, value, canEdit, onSaved }: { id: string; value: string | null; canEdit: boolean; onSaved: (v: string) => void }) {
  const [v, setV] = useState(value ?? "")
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  async function saveCode() {
    const code = v.trim()
    if (!code) return
    setSaving(true); setOk(false)
    try { await patchVendorCode(id, code); onSaved(code); setOk(true) }
    catch (e) { void swalError(errMsg(e)) }
    finally { setSaving(false) }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 dark:border-emerald-400/30 dark:bg-emerald-500/10">
      <label htmlFor="vo-vendor-code" className="text-[13px] font-semibold text-emerald-900 dark:text-emerald-100">
        รหัส vendor ใน ATMS {!value && <span className="font-normal">· เปิดเจ้าหนี้ใน ATMS แล้วใส่รหัสที่นี่</span>}
      </label>
      <div className="flex gap-2">
        <input id="vo-vendor-code" value={v} disabled={!canEdit} maxLength={40} onChange={(e) => { setV(e.target.value); setOk(false) }}
          onKeyDown={(e) => { if (e.key === "Enter") void saveCode() }} placeholder="เช่น VEN-00812" className={`${inputCls} max-w-xs font-mono`} />
        {canEdit && (
          <button type="button" className={btn.primary} disabled={saving || !v.trim() || v.trim() === (value ?? "")} onClick={() => void saveCode()}>
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : ok ? <Check size={14} aria-hidden /> : null} บันทึก
          </button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── แท็บ ─────────────────────────

function InfoTab({ doc }: { doc: OnboardingDoc }) {
  const p = doc.profile
  const asked = doc.criteriaSnapshot.filter((c) => c.active && c.vendorQuestion != null).sort(byCat)
  return (
    <>
      <Panel title="ข้อมูลผู้ส่งมอบ">
        <Dl rows={[
          ["ประเภท", ENTITY_LABEL[p.entityType]],
          [p.entityType === "company" ? "ชื่อบริษัท" : "ชื่อ", p.companyName],
          ["เลขผู้เสียภาษี", fmtTaxId(p.taxId)],
          ["สาขา", p.branch],
          ["เบอร์โทร", fmtPhone(p.phone)],
          ["อีเมล", p.email],
          ["สินค้า/บริการ", p.productType],
          ["ที่อยู่", p.address],
        ]} />
      </Panel>
      <Panel title="ผู้ติดต่อ">
        <Dl rows={[
          ["ชื่อ", p.contact.name],
          ["ตำแหน่ง", p.contact.position],
          ["เบอร์โทร", p.contact.phone ? <a className="text-[#1B8C4B] hover:underline" href={`tel:${p.contact.phone}`}>{fmtPhone(p.contact.phone)}</a> : ""],
          ["อีเมล", p.contact.email ? <a className="text-[#1B8C4B] hover:underline" href={`mailto:${p.contact.email}`}>{p.contact.email}</a> : ""],
          ["LINE", doc.lineDisplayName ?? ""],
        ]} />
      </Panel>
      {asked.length > 0 && (
        <Panel title="คำตอบของผู้ส่งมอบ">
          <dl className="flex flex-col">
            {asked.map((c) => (
              <div key={c.key} className="flex gap-3 border-b border-dashed border-[#EEF2F0] py-2 text-[13px] last:border-b-0 dark:border-white/8">
                <dt className="flex-1 text-gray-600 dark:text-gray-300"><span className="mr-1.5 font-mono text-[11.5px] text-gray-400">{c.key}</span>{c.vendorQuestion}</dt>
                <dd className="m-0 w-2/5 text-[#14271C] dark:text-gray-100">{answerText(c, doc.answers[c.key])}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel title="ความยินยอม (PDPA)">
        <p className="text-[12.5px] text-gray-600 dark:text-gray-300">
          ฉบับ {doc.consent?.version ?? "—"} · ยินยอมเมื่อ {thDateTime(doc.consent?.acceptedAt)} · {doc.consent?.items?.filter((i) => i.granted).length ?? 0}/{doc.consent?.items?.length ?? 0} ข้อ
        </p>
      </Panel>
    </>
  )
}

const byCat = (a: Criterion, b: Criterion) => a.category - b.category || a.order - b.order

function DocsTab({ doc, id, editable, busy, onSet }: {
  doc: OnboardingDoc; id: string; editable: boolean; busy: string | null; onSet: (slot: DocSlot, s: "passed" | "redo") => void
}) {
  const entries = new Map<string, DocEntry>(doc.documents.map((d) => [d.slot, d]))
  const groups = new Map<string, DocSlot[]>()
  for (const s of doc.docSlotSnapshot.filter((x) => x.active).sort((a, b) => a.order - b.order)) groups.set(s.group, [...(groups.get(s.group) ?? []), s])

  return (
    <>
      {!editable && doc.status === "submitted" && <p className="text-[12.5px] text-gray-500 dark:text-gray-400">กด “เริ่มตรวจ” ก่อน ถึงจะกดผ่านหรือขอใหม่ได้</p>}
      {[...groups].map(([group, slots]) => (
        <Panel key={group} title={group}>
          <ul className="flex flex-col">
            {slots.map((s) => {
              if (s.requirement === "system") {
                return (
                  <li key={s.key} className="flex items-center justify-between gap-3 border-b border-[#F1F5F2] py-2.5 text-[13px] text-gray-500 last:border-b-0 dark:border-white/5 dark:text-gray-400">
                    <span>{s.label}</span><span className="text-[11.5px]">{s.hint || "ทำผ่านระบบ"}</span>
                  </li>
                )
              }
              const e = entries.get(s.key)
              const status = e?.status ?? "missing"
              const req = isDocRequired(s, doc.profile.entityType)
              return (
                <li key={s.key} className="flex flex-col gap-2 border-b border-[#F1F5F2] py-3 last:border-b-0 dark:border-white/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-[13.5px] font-medium text-[#14271C] dark:text-white">{s.label}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${req ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200" : "bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-gray-400"}`}>{req ? "บังคับ" : "ไม่บังคับ"}</span>
                    <DocChip status={status} />
                  </div>
                  {e?.files?.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {e.files.map((f) => (
                        <li key={f.key}>
                          <a href={fileUrl(id, f.key)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-[#E2E8E4] bg-[#F8FAF9] px-2.5 py-1.5 text-[12px] text-[#14271C] hover:border-[#1B8C4B]/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 dark:border-white/10 dark:bg-white/5 dark:text-gray-100">
                            {f.contentType === "application/pdf" ? <FileText size={14} aria-hidden /> : <ImageIcon size={14} aria-hidden />}
                            <span className="truncate">{f.name}</span>
                            <span className="flex-none text-gray-400">{fmtBytes(f.size)}</span>
                            <ExternalLink size={12} className="flex-none text-gray-400" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-[12px] text-gray-400">ไม่ได้แนบ</span>}
                  {(e?.note || e?.checkedBy) && (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">
                      {e?.note && <span className={status === "redo" ? "text-red-600 dark:text-red-300" : ""}>หมายเหตุ: {e.note} </span>}
                      {e?.checkedBy && <span>· ตรวจโดย {e.checkedBy.name} {thDateTime(e.checkedAt)}</span>}
                    </p>
                  )}
                  {editable && (e?.files?.length ?? 0) > 0 && (
                    <div className="flex gap-2">
                      <button type="button" disabled={Boolean(busy) || status === "passed"} onClick={() => onSet(s, "passed")}
                        className={`${btn.ghost} px-3 py-1.5 text-[12px] ${status === "passed" ? "!border-emerald-300 !bg-emerald-50 !text-emerald-800 dark:!bg-emerald-500/15 dark:!text-emerald-200" : ""}`}>
                        {busy === `doc:${s.key}` ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <CheckCircle2 size={13} aria-hidden />} ผ่าน
                      </button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => onSet(s, "redo")} className={`${btn.danger} px-3 py-1.5 text-[12px]`}>
                        <RotateCcw size={13} aria-hidden /> ขอใหม่
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      ))}
    </>
  )
}

function ScoreTab({ doc, scores, editable, threshold, sum, save, onRetry, onScore }: {
  doc: OnboardingDoc; scores: ScoreItem[]; editable: boolean; threshold: number
  sum: ReturnType<typeof scoreSummary>; save: { state: SaveState; at: string; msg: string }
  onRetry: () => void; onScore: (key: string, patch: Partial<ScoreItem>) => void
}) {
  const byKey = new Map(scores.map((s) => [s.key, s]))
  const groups = new Map<number, Criterion[]>()
  for (const c of doc.criteriaSnapshot.filter((x) => x.active).sort(byCat)) groups.set(c.category, [...(groups.get(c.category) ?? []), c])
  const reached = sum.pass >= threshold
  const barPct = sum.total ? (sum.pass / sum.total) * 100 : 0
  const thrPct = sum.total ? (threshold / sum.total) * 100 : 0

  return (
    <>
      <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-[#E8EEEA] bg-white px-4 py-3 shadow-sm dark:border-white/8 dark:bg-[#151a10]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="font-semibold text-[#14271C] dark:text-white">
            ผ่าน <span className={`font-mono text-[18px] ${reached ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{sum.pass}</span>
            <span className="text-gray-400">/{sum.total}</span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">ไม่ผ่าน {sum.fail} · ยังไม่ให้ {sum.blank} · เกณฑ์ขั้นต่ำ {threshold}</span>
          <span className="ml-auto text-[12px]" role="status">
            {save.state === "saving" && <span className="text-amber-700 dark:text-amber-300"><Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden />กำลังบันทึก…</span>}
            {save.state === "saved" && <span className="text-emerald-700 dark:text-emerald-300">บันทึกแล้ว {save.at}</span>}
            {save.state === "error" && <span className="text-red-600 dark:text-red-300">บันทึกไม่สำเร็จ: {save.msg} <button type="button" onClick={onRetry} className="ml-1 underline">ลองใหม่</button></span>}
          </span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-gray-100 dark:bg-white/8" aria-hidden>
          <div className={`h-full rounded-full transition-[width] ${reached ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${barPct}%` }} />
          <div className="absolute -top-1 h-4 w-0.5 bg-[#14271C] dark:bg-white" style={{ left: `${thrPct}%` }} title={`เกณฑ์ ${threshold}`} />
        </div>
        {!editable && <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">{doc.status === "submitted" ? "กด “เริ่มตรวจ” ก่อน ถึงจะให้คะแนนได้" : "ดูได้อย่างเดียว ให้คะแนนได้ตอนสถานะ “กำลังตรวจ”"}</p>}
      </div>

      {[...groups].map(([cat, list]) => (
        <Panel key={cat} title={`${cat}. ${CATEGORY_LABEL[cat] ?? ""}`}>
          <ul className="flex flex-col">
            {list.map((c) => {
              const s = byKey.get(c.key)
              const ans = doc.answers[c.key]
              const hint = suggestHint(c, ans)
              return (
                <li key={c.key} className="flex flex-col gap-2 border-b border-[#F1F5F2] py-3 last:border-b-0 sm:flex-row sm:items-start dark:border-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] text-[#14271C] dark:text-white"><span className="mr-1.5 font-mono text-[11.5px] text-gray-400">{c.key}</span>{c.label}</div>
                    <div className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
                      {c.vendorQuestion == null ? "จัดซื้อประเมินเอง" : <>ผู้ส่งมอบตอบ: <span className="font-medium text-[#14271C] dark:text-gray-100">{answerText(c, ans)}</span></>}
                      {hint && <span className={`ml-2 ${hint.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>· {hint.text}</span>}
                    </div>
                    {(editable || s?.note) && (
                      <>
                        <label htmlFor={`vo-note-${c.key}`} className="sr-only">หมายเหตุข้อ {c.key}</label>
                        <input id={`vo-note-${c.key}`} disabled={!editable || !s} value={s?.note ?? ""} maxLength={200}
                          placeholder={s ? "หมายเหตุ (ถ้ามี)" : "เลือกผ่าน/ไม่ผ่านก่อน แล้วค่อยใส่หมายเหตุ"}
                          onChange={(e) => onScore(c.key, { note: e.target.value })}
                          className={`${inputCls} mt-2 py-1.5 text-[12.5px]`} />
                      </>
                    )}
                  </div>
                  <div className="flex flex-none gap-1.5" role="group" aria-label={`ผลข้อ ${c.key}`}>
                    <ScoreBtn on={s?.value === "pass"} value="pass" disabled={!editable} onClick={() => onScore(c.key, { value: "pass" })} />
                    <ScoreBtn on={s?.value === "fail"} value="fail" disabled={!editable} onClick={() => onScore(c.key, { value: "fail" })} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      ))}
    </>
  )
}

function suggestHint(c: Criterion, ans: unknown): { ok: boolean; text: string } | null {
  if (c.suggestMin == null || typeof ans !== "number") return null
  return ans >= c.suggestMin
    ? { ok: true, text: `ถึงเกณฑ์ ${c.suggestMin}${c.input.kind === "number" ? ` ${c.input.unit}` : ""} แนะนำ ผ่าน` }
    : { ok: false, text: `ต่ำกว่าเกณฑ์ ${c.suggestMin}${c.input.kind === "number" ? ` ${c.input.unit}` : ""}` }
}

function ScoreBtn({ on, value, disabled, onClick }: { on: boolean; value: ScoreValue; disabled: boolean; onClick: () => void }) {
  const pass = value === "pass"
  const onCls = pass
    ? "border-emerald-500 bg-emerald-500 text-white"
    : "border-red-500 bg-red-500 text-white"
  return (
    <button type="button" aria-pressed={on} disabled={disabled && !on} onClick={disabled ? undefined : onClick}
      className={`inline-flex min-w-[84px] items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]/50 disabled:opacity-40 ${on ? onCls : "border-[#E2E8E4] bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/5"} ${disabled ? "cursor-default" : "cursor-pointer"}`}>
      {pass ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />} {pass ? "ผ่าน" : "ไม่ผ่าน"}
    </button>
  )
}

function HistoryTab({ doc }: { doc: OnboardingDoc }) {
  const list = [...(doc.timeline ?? [])].reverse()
  const what = (e: OnboardingDoc["timeline"][number]): ReactNode =>
    e.action === "submit" ? "ผู้ส่งมอบส่งใบสมัคร"
      : e.action === "resubmit" ? "ผู้ส่งมอบแนบเอกสารเพิ่ม"
        : ACTIONS[e.action]?.label ?? e.action
  return (
    <Panel>
      {list.length === 0 ? <p className="text-[13px] text-gray-400">ยังไม่มีประวัติ</p> : (
        <ol className="relative flex flex-col gap-4 border-l-2 border-[#E8EEEA] pl-5 dark:border-white/10">
          {list.map((e, i) => (
            <li key={i} className="relative">
              <span aria-hidden className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-white bg-[#1B8C4B] dark:border-[#151a10]" />
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold text-[#14271C] dark:text-white">{what(e)}</span>
                <StatusPill status={e.to} />
              </div>
              <div className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">{thDateTime(e.at)} · {e.by?.name ?? "ผู้ส่งมอบ"}</div>
              {e.note && <p className="mt-1 whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700 dark:bg-white/5 dark:text-gray-200">{e.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

// ── เลือกเอกสารที่ขอเพิ่ม ──
function RequestDocsModal({ doc, onClose, onSubmit }: { doc: OnboardingDoc; onClose: () => void; onSubmit: (slots: string[], note: string) => Promise<void> }) {
  const entries = new Map(doc.documents.map((d) => [d.slot, d]))
  const slots = doc.docSlotSnapshot.filter((s) => s.active && s.requirement !== "system").sort((a, b) => a.order - b.order)
  // ติ๊กให้ก่อน: รายการที่ขอใหม่ + บังคับที่ยังไม่ได้แนบ
  const [picked, setPicked] = useState<string[]>(() => slots.filter((s) => {
    const st = entries.get(s.key)?.status ?? "missing"
    return st === "redo" || (st === "missing" && isDocRequired(s, doc.profile.entityType))
  }).map((s) => s.key))
  const [note, setNote] = useState(() => slots.filter((s) => entries.get(s.key)?.status === "redo" && entries.get(s.key)?.note).map((s) => `${s.label}: ${entries.get(s.key)?.note}`).join("\n"))
  const [sending, setSending] = useState(false)
  const [touched, setTouched] = useState(false)
  const ok = picked.length > 0 && note.trim().length > 0

  async function send() {
    setTouched(true)
    if (!ok) return
    setSending(true)
    try { await onSubmit(picked, note.trim()) } finally { setSending(false) }
  }

  return (
    <ModalShell title="ขอเอกสารเพิ่ม" subtitle={doc.profile.companyName} onClose={onClose} width="600px"
      footer={<>
        <button type="button" className={btn.ghost} onClick={onClose}>ยกเลิก</button>
        <button type="button" className={btn.primary} disabled={sending} onClick={() => void send()}>
          {sending && <Loader2 size={14} className="animate-spin" aria-hidden />} สร้างลิงก์ขอเอกสาร
        </button>
      </>}>
      <Panel title={`เลือกเอกสารที่ขอ (${picked.length})`}>
        <ul className="flex flex-col">
          {slots.map((s) => {
            const st = entries.get(s.key)?.status ?? "missing"
            const on = picked.includes(s.key)
            return (
              <li key={s.key}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-[#F6FAF7] dark:hover:bg-white/5">
                  <input type="checkbox" checked={on} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== s.key) : [...p, s.key]))} className="size-4 accent-[#1B8C4B]" />
                  <span className="flex-1 text-[#14271C] dark:text-gray-100">{s.label}</span>
                  {isDocRequired(s, doc.profile.entityType) && <span className="text-[10.5px] font-semibold text-red-600 dark:text-red-300">บังคับ</span>}
                  <DocChip status={st} />
                </label>
              </li>
            )
          })}
        </ul>
        {touched && picked.length === 0 && <p className="mt-1 text-[12px] text-red-600">ติ๊กอย่างน้อย 1 รายการ</p>}
      </Panel>
      <div>
        <label htmlFor="vo-req-note" className="mb-1 block text-[13px] font-semibold text-[#14271C] dark:text-white">ข้อความถึงผู้ส่งมอบ</label>
        <textarea id="vo-req-note" rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น หนังสือรับรองเกิน 6 เดือน ขอฉบับใหม่ · Bookbank ขอหน้าที่เห็นชื่อบัญชีชัด ๆ" className={inputCls} />
        {touched && !note.trim() && <p className="mt-1 text-[12px] text-red-600">บอกผู้ส่งมอบสั้น ๆ ว่าต้องแนบอะไรเพิ่ม</p>}
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">ข้อความนี้ผู้ส่งมอบจะเห็นในหน้าแนบเอกสาร และบันทึกในประวัติด้วย</p>
      </div>
    </ModalShell>
  )
}
