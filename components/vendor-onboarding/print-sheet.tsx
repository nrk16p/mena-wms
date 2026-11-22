"use client"
// /vendors/onboarding/[id]/print — ใบคัดเลือกผู้ส่งมอบ (หน้าตามกระดาษ Rev1 TW28.11.68) + หน้า 2 Checklist เอกสาร
// วาดผ่าน portal ลง body ตรง ๆ: บนจอเป็นแผ่นทับหน้าแอป · ตอนพิมพ์ซ่อนลูกอื่นของ body ทั้งหมด
// (body ของแอปล็อก h-screen/overflow ไว้ ถ้าพิมพ์จากใน main จะได้หน้าเดียวแล้วโดนตัด)
import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Loader2, Printer, X } from "lucide-react"
import { CATEGORY_LABEL, ENTITY_LABEL, isDocRequired, scoreSummary, type Criterion, type OnboardingDoc, type Signoff } from "@/lib/vendor-onboarding/types"
import { answerText, errMsg, fmtPhone, getOnboarding, isNewDoc, thDateLong } from "@/lib/vendor-onboarding/client"
import { COMPANY } from "@/lib/vendor-brand"

const CSS = `
#vo-print-root { position: fixed; inset: 0; z-index: 100; overflow: auto; background: #E5E7EB; font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif; color: #111; color-scheme: light; }
.vp-bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: center; gap: 8px; padding: 10px; background: rgba(229,231,235,.92); backdrop-filter: blur(4px); }
.vp-bar button { font: 600 14px 'IBM Plex Sans Thai', sans-serif; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: 1px solid #D1D5DB; background: #fff; color: #111; cursor: pointer; }
.vp-bar button.pri { background: #1B8C4B; border-color: #1B8C4B; color: #fff; }
.vp-bar button:focus-visible { outline: 3px solid #1B8C4B66; outline-offset: 2px; }
.vp-page { width: 210mm; min-height: 297mm; margin: 0 auto 16px; background: #fff; padding: 12mm 14mm; box-shadow: 0 2px 10px rgba(0,0,0,.12); font-size: 12.5px; line-height: 1.45; }
.vp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
.vp-head img { height: 34px; }
.vp-co { text-align: right; font-size: 11px; }
.vp-title { text-align: center; font-size: 18px; font-weight: 700; margin: 6px 0 10px; }
.vp-meta { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.vp-meta td { padding: 3px 4px; vertical-align: bottom; }
.vp-meta .k { white-space: nowrap; font-weight: 600; width: 1%; }
.vp-meta .v { border-bottom: 1px dotted #555; }
table.vp-t { width: 100%; border-collapse: collapse; }
.vp-t th, .vp-t td { border: 1px solid #333; padding: 3px 5px; vertical-align: top; }
.vp-t th { background: #F1F5F2; font-weight: 700; text-align: center; }
.vp-t td.c { text-align: center; vertical-align: middle; width: 13mm; font-size: 14px; }
.vp-t td.cat { width: 34mm; font-weight: 600; }
.vp-t td.note { width: 46mm; font-size: 11.5px; }
.vp-sum { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #333; border-top: 0; }
.vp-sum div { padding: 5px 6px; border-left: 1px solid #333; }
.vp-sum div:first-child { border-left: 0; }
.vp-sum b { display: block; font-size: 15px; }
.vp-sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
.vp-sign > div { border: 1px solid #333; padding: 8px 8px 6px; text-align: center; min-height: 32mm; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; }
.vp-sign .line { border-bottom: 1px dotted #555; margin: 0 6px 4px; min-height: 18px; }
.vp-contact { margin-top: 12px; border: 1px solid #333; padding: 6px 8px; }
.vp-contact h3, .vp-h3 { margin: 0 0 4px; font-size: 13px; }
.vp-box { font-size: 15px; line-height: 1; }
.vp-foot { margin-top: 8px; font-size: 10px; color: #555; display: flex; justify-content: space-between; }
@page { size: A4; margin: 0; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#vo-print-root) { display: none !important; }
  #vo-print-root { position: static; overflow: visible; background: #fff; }
  .vp-bar { display: none !important; }
  .vp-page { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
  .vp-page:last-child { page-break-after: auto; break-after: auto; }
  .vp-t tr { break-inside: avoid; }
}
`

const noSubscribe = () => () => {}
const box = (on: boolean) => <span className="vp-box" aria-label={on ? "ติ๊ก" : "ว่าง"}>{on ? "☑" : "☐"}</span>

export function OnboardingPrint({ id }: { id: string }) {
  const [doc, setDoc] = useState<OnboardingDoc | null>(null)
  const [error, setError] = useState("")
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false) // portal หลัง hydrate

  useEffect(() => {
    let alive = true
    getOnboarding(id)
      .then((r) => { if (!alive) return; if (isNewDoc(r.doc)) setDoc(r.doc); else setError("ใบนี้เป็นแบบเก่า ไม่มีใบคัดเลือกให้พิมพ์") })
      .catch((e) => { if (alive) setError(errMsg(e)) })
    return () => { alive = false }
  }, [id])

  if (!mounted) return null
  return createPortal(
    <div id="vo-print-root">
      <style>{CSS}</style>
      <div className="vp-bar">
        <button type="button" onClick={() => window.close()}><X size={15} aria-hidden /> ปิด</button>
        <button type="button" className="pri" disabled={!doc} onClick={() => window.print()}><Printer size={15} aria-hidden /> พิมพ์</button>
      </div>
      {error ? <div className="vp-page"><p>{error}</p></div>
        : !doc ? <div className="vp-page" style={{ display: "grid", placeItems: "center" }}><span><Loader2 size={18} className="animate-spin" style={{ display: "inline" }} aria-hidden /> กำลังโหลด…</span></div>
          : <Sheet doc={doc} />}
    </div>,
    document.body,
  )
}

function Sheet({ doc }: { doc: OnboardingDoc }) {
  const p = doc.profile
  const crit = doc.criteriaSnapshot.filter((c) => c.active).sort((a, b) => a.category - b.category || a.order - b.order)
  const groups = new Map<number, Criterion[]>()
  for (const c of crit) groups.set(c.category, [...(groups.get(c.category) ?? []), c])
  const score = new Map(doc.scores.map((s) => [s.key, s]))
  const sum = scoreSummary(doc)
  const final = doc.status === "approved" ? true : doc.status === "rejected" ? false : sum.blank === 0 ? sum.pass >= sum.threshold : null
  const evalDate = doc.evaluatedBy?.at ?? null

  const noteOf = (c: Criterion) => {
    const parts: string[] = []
    const a = doc.answers[c.key]
    if (a !== undefined && a !== "" && c.input.kind !== "yesno") parts.push(answerText(c, a))
    const n = score.get(c.key)?.note
    if (n) parts.push(n)
    return parts.join(" · ")
  }

  const entries = new Map(doc.documents.map((d) => [d.slot, d]))
  const slots = doc.docSlotSnapshot.filter((s) => s.active).sort((a, b) => a.order - b.order)
  const slotGroups = new Map<string, typeof slots>()
  for (const s of slots) slotGroups.set(s.group, [...(slotGroups.get(s.group) ?? []), s])
  const systemDone = (key: string) =>
    key === "pdpa" ? Boolean(doc.consent?.items?.length)
      : key === "selection_form" ? Boolean(doc.evaluatedBy)
        : key === "new_creditor_form" ? Boolean(doc.vendorCode) : false

  const header = (
    <div className="vp-head">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mena-logo.svg" alt="Mena Transport" />
      <div className="vp-co"><div style={{ fontWeight: 700 }}>{COMPANY.nameTh}</div><div>{COMPANY.address}</div></div>
    </div>
  )

  return (
    <>
      <section className="vp-page" aria-label="ใบคัดเลือกผู้ส่งมอบ">
        {header}
        <div className="vp-title">ใบคัดเลือกผู้ส่งมอบ</div>
        <table className="vp-meta">
          <tbody>
            <tr>
              <td className="k">ชื่อผู้ส่งมอบ</td><td className="v">{p.companyName}</td>
              <td className="k">เลขที่</td><td className="v" style={{ width: "28mm" }}>{doc.ref}</td>
            </tr>
            <tr>
              <td className="k">ประเภท</td><td className="v">{p.productType} ({ENTITY_LABEL[p.entityType]})</td>
              <td className="k">วันที่ประเมิน</td><td className="v">{thDateLong(evalDate)}</td>
            </tr>
          </tbody>
        </table>

        <table className="vp-t">
          <thead>
            <tr>
              <th rowSpan={2}>หมวดหมู่</th>
              <th rowSpan={2}>รายการประเมิน</th>
              <th colSpan={2}>ผลการประเมิน</th>
              <th rowSpan={2}>หมายเหตุ</th>
            </tr>
            <tr><th>ผ่าน</th><th>ไม่ผ่าน</th></tr>
          </thead>
          <tbody>
            {[...groups].map(([cat, list]) => list.map((c, i) => {
              const v = score.get(c.key)?.value
              return (
                <tr key={c.key}>
                  {i === 0 && <td className="cat" rowSpan={list.length}>{cat}. {CATEGORY_LABEL[cat] ?? ""}</td>}
                  <td>{c.key} {c.label}</td>
                  <td className="c">{v === "pass" ? "✓" : ""}</td>
                  <td className="c">{v === "fail" ? "✗" : ""}</td>
                  <td className="note">{noteOf(c)}</td>
                </tr>
              )
            }))}
          </tbody>
        </table>
        <div className="vp-sum">
          <div>จำนวนผ่าน<b>{sum.pass} ข้อ</b></div>
          <div>จำนวนไม่ผ่าน<b>{sum.fail} ข้อ</b></div>
          <div>เกณฑ์ขั้นต่ำ<b>{sum.threshold} ข้อ</b></div>
          <div>ผลการคัดเลือก<b>{box(final === true)} ผ่าน &nbsp; {box(final === false)} ไม่ผ่าน</b></div>
        </div>

        <div className="vp-sign">
          <SignBlock role="ผู้ประเมิน" s={doc.evaluatedBy} />
          <SignBlock role="ผู้ตรวจสอบ" s={doc.reviewedBy} />
          <SignBlock role="ผู้อนุมัติ" s={doc.approvedBy} />
        </div>

        <div className="vp-contact">
          <h3>Contact Person</h3>
          <table className="vp-meta" style={{ margin: 0 }}>
            <tbody>
              <tr><td className="k">ชื่อ</td><td className="v">{p.contact.name}</td><td className="k">ตำแหน่ง</td><td className="v">{p.contact.position}</td></tr>
              <tr><td className="k">โทร</td><td className="v">{fmtPhone(p.contact.phone)}</td><td className="k">อีเมล</td><td className="v">{p.contact.email}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="vp-foot"><span>ใบคัดเลือกผู้ส่งมอบ Rev1 TW28.11.68</span><span>{doc.ref}</span></div>
      </section>

      <section className="vp-page" aria-label="Checklist เอกสาร">
        {header}
        <div className="vp-title">Checklist เอกสาร</div>
        <table className="vp-meta">
          <tbody>
            <tr><td className="k">ชื่อผู้ส่งมอบ</td><td className="v">{p.companyName}</td><td className="k">เลขที่</td><td className="v" style={{ width: "28mm" }}>{doc.ref}</td></tr>
          </tbody>
        </table>
        <table className="vp-t">
          <thead><tr><th style={{ width: "12mm" }}>ส่งแล้ว</th><th>รายการเอกสาร</th><th style={{ width: "26mm" }}>เงื่อนไข</th><th style={{ width: "46mm" }}>หมายเหตุ</th></tr></thead>
          <tbody>
            {[...slotGroups].map(([g, list]) => [
              <tr key={`g-${g}`}><td colSpan={4} style={{ fontWeight: 700, background: "#FAFAFA" }}>{g}</td></tr>,
              ...list.map((s) => {
                const e = entries.get(s.key)
                const done = s.requirement === "system" ? systemDone(s.key) : e?.status === "passed"
                return (
                  <tr key={s.key}>
                    <td className="c">{box(done)}</td>
                    <td>{s.label}</td>
                    <td style={{ textAlign: "center" }}>{s.requirement === "system" ? "ทำผ่านระบบ" : isDocRequired(s, p.entityType) ? "บังคับ" : "ไม่บังคับ"}</td>
                    <td className="note">{s.requirement === "system" ? "" : e?.note || (e?.files?.length && e.status !== "passed" ? `แนบ ${e.files.length} ไฟล์ ยังไม่ผ่าน` : "")}</td>
                  </tr>
                )
              }),
            ])}
          </tbody>
        </table>
        <div className="vp-foot"><span>พิมพ์เมื่อ {thDateLong(new Date().toISOString())}</span><span>{doc.ref}</span></div>
      </section>
    </>
  )
}

function SignBlock({ role, s }: { role: string; s: Signoff | null }) {
  return (
    <div>
      <div className="line" />
      <div>({s?.by.name || "................................................"})</div>
      <div style={{ fontWeight: 700 }}>{role}</div>
      <div>วันที่ {s ? thDateLong(s.at) : "......../......../........"}</div>
    </div>
  )
}
