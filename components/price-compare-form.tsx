"use client"
// components/price-compare-form.tsx — ฟอร์มใบเทียบราคาหน้าเดียวเลื่อนลง (pattern เดียวกับ repair-external)
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Save, FileDown, Trash2, Loader2, History, AlertTriangle } from "lucide-react"
import { ImageUpload } from "@/components/image-upload"
import type { SkuImage } from "@/lib/media"
import { inputCls, type Garage } from "@/components/garage-combobox"
import { PriceCompareMatrix } from "@/components/price-compare-matrix"
import { StatusChip } from "@/components/price-compare-list"
import { DEPT_MASTER } from "@/lib/order-tracking"
import { swalConfirm, swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import { bkkToday, toBkkIso } from "@/lib/bkk-time"
import {
  normalizeDoc, validateDoc, canTransition, isComplete, lowestNet, supplierTotals, fmtMoney,
  completeSupplierCount, isQuoteExpired, isDocNo, MIN_QUOTES,
  type PriceCompare, type PcCommittee, type PcFile, type PcStatus, type PcConditions,
} from "@/lib/price-compare"

type LogRow = { _id: string; action: string; by: string; at: string; statusChange?: { from: string; to: string }; changes?: { label: string; from: string; to: string }[] }

const COND_FIELDS: [keyof PcConditions, string][] = [
  ["payment", "(1) เงื่อนไขการชำระเงิน"], ["leadTime", "(2) ระยะเวลาส่งมอบหลังรับ PO"], ["warranty", "(3) เงื่อนไขการรับประกัน"],
  ["remark", "หมายเหตุ (ถ้ามี)"], ["bays", "(4) จำนวนช่องซ่อมที่อู่มี"], ["menaTrucksIn", "(5) จำนวนรถ Mena ที่เข้าซ่อมอยู่"],
  ["statusA", "(6) สถานะ ขA (คัน)"], ["statusB", "(6) สถานะ ขB (คัน)"],
]
const NEXT_STATUS: Record<PcStatus, { to: PcStatus; label: string }[]> = {
  "ร่าง":      [{ to: "รอลงนาม", label: "ส่งลงนาม" }],
  "รอลงนาม":   [{ to: "เสร็จสิ้น", label: "ปิดใบ (ลงนามครบ)" }, { to: "ร่าง", label: "ถอยกลับเป็นร่าง" }],
  "เสร็จสิ้น": [{ to: "รอลงนาม", label: "เปิดแก้ไข" }],
}
// เอกสารเก็บเวลาไทยไว้แล้ว (+07:00) แต่ log เก็บเป็น BSON Date → JSON ลงท้าย Z (UTC) ต้องเลื่อนก่อนแสดง
const fmtDT = (iso: string) => {
  if (!iso) return ""
  const s = iso.endsWith("Z") ? toBkkIso(iso) : iso
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`
}
// ImageUpload ยิง onChange ตั้งแต่ mount ครั้งแรก — ถ้าไม่เทียบก่อนจะทำให้ฟอร์มขึ้น "ยังไม่บันทึก" ทั้งที่ยังไม่ได้แตะอะไร
const filesEqual = (a: PcFile[], b: PcFile[]): boolean =>
  a.length === b.length && a.every((f, i) => f.mediaId === b[i].mediaId && f.batchId === b[i].batchId
    && f.filename === b[i].filename && f.webpUrl === b[i].webpUrl && f.thumbnailUrl === b[i].thumbnailUrl)

function Card({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <h2 className="mb-3 text-sm font-bold" style={{ color, fontFamily: "'Mitr', sans-serif" }}>{title}</h2>
      {children}
    </section>
  )
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-xs text-gray-500 dark:text-gray-400">{label}<div className="mt-1">{children}</div></label>
)

export function PriceCompareForm({ id }: { id: string }) {
  const router = useRouter()
  const [doc, setDoc] = useState<PriceCompare | null>(null)
  const [saved, setSaved] = useState<string>("")           // JSON ล่าสุดที่บันทึกแล้ว เพื่อรู้ว่า dirty
  const [garages, setGarages] = useState<Garage[]>([])
  const [logs, setLogs] = useState<LogRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  // เพิ่มค่าทุกครั้งที่โหลดใหม่ เพื่อ remount ImageUpload (มันอ่าน initial แค่ตอน mount) — เป็น state ไม่ใช่ ref เพราะถูกอ่านตอน render
  const [uploadKey, setUploadKey] = useState(0)

  // ใช้ promise chain (ไม่ใช่ async/await ในตัว callback) ตาม lint rule ของ repo: react-hooks/set-state-in-effect
  const load = useCallback(() => {
    fetch(`/api/price-compare/${id}`)
      .then(async (r) => (r.ok ? normalizeDoc(await r.json()) : null))
      .catch(() => null)
      .then((d) => {
        if (!d) { swalError("ไม่พบใบเทียบราคา"); router.push("/price-compare"); return }
        setUploadKey((k) => k + 1)
        setDoc(d); setSaved(JSON.stringify(d))
        // ลิงก์เก่าเปิดด้วย ObjectId — พาไป URL แบบเลขที่เอกสาร (canonical) เมื่อโหลดสำเร็จ
        if (!isDocNo(id)) router.replace(`/price-compare/${d.docNo}`)
      })
  }, [id, router])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch("/api/garage-master")
      .then((r) => r.json())
      .then((g: unknown) => setGarages(Array.isArray(g) ? g.map((x) => ({ _id: String(x._id), name: String(x.name ?? "") })) : []))
      .catch(() => setGarages([]))
  }, [])
  const loadLogs = useCallback(() => {
    fetch(`/api/price-compare/${id}/log`)
      .then((r) => r.json())
      .then((v: unknown) => setLogs(Array.isArray(v) ? (v as LogRow[]) : []))
      .catch(() => setLogs([]))
  }, [id])
  useEffect(() => { if (showLog && logs === null) loadLogs() }, [showLog, logs, loadLogs])

  const dirty = doc !== null && JSON.stringify(doc) !== saved
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = "" } }
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h)
  }, [dirty])

  const patch = (p: Partial<PriceCompare>) => setDoc((d) => (d ? { ...d, ...p } : d))
  const patchSupplier = (s: number, p: Partial<PriceCompare["suppliers"][number]>) => setDoc((d) => d && ({ ...d, suppliers: d.suppliers.map((sp, i) => (i === s ? { ...sp, ...p } : sp)) }))
  const patchCommittee = (i: number, p: Partial<PcCommittee>) => setDoc((d) => d && ({ ...d, committee: d.committee.map((m, k) => (k === i ? { ...m, ...p } : m)) }))
  // ไฟล์แนบ: ข้ามเมื่อชุดไฟล์เท่าเดิม (คืน state เดิม → ไม่ re-render, ไม่ทำให้ dirty)
  const setSupplierFiles = (s: number, imgs: SkuImage[]) => setDoc((d) => {
    if (!d || !d.suppliers[s] || filesEqual(d.suppliers[s].quotationFiles, imgs)) return d
    return { ...d, suppliers: d.suppliers.map((sp, i) => (i === s ? { ...sp, quotationFiles: imgs } : sp)) }
  })
  const setEvidenceFiles = (imgs: SkuImage[]) => setDoc((d) => (!d || filesEqual(d.evidenceFiles, imgs) ? d : { ...d, evidenceFiles: imgs }))

  const readOnly = doc?.status === "เสร็จสิ้น"
  const today = bkkToday()
  const lowNet = useMemo(() => (doc ? lowestNet(doc) : null), [doc])
  const fullCount = useMemo(() => (doc ? completeSupplierCount(doc) : 0), [doc])
  // ให้ตรงกับเกณฑ์ที่ canTransition ใช้จริง: ตอนร่างยังไม่บังคับชื่อกรรมการ
  const completeness = useMemo<{ ok: boolean; missing: string[] }>(
    () => (doc ? isComplete(doc, { requireCommitteeNames: doc.status !== "ร่าง" }) : { ok: false, missing: [] }), [doc])

  async function save(nextStatus?: PcStatus): Promise<boolean> {
    if (!doc) return false
    // ได้ใบเสนอราคาครบเกณฑ์แล้ว → เหตุผลเก่าที่ค้างอยู่ไม่ต้องเก็บ (ช่องกรอกถูกซ่อนไปแล้ว จะกลายเป็นข้อความค้างใน PDF)
    const body = { ...doc, status: nextStatus ?? doc.status, ...(fullCount >= MIN_QUOTES ? { fewerQuotesReason: "" } : {}) }
    const errs = validateDoc(normalizeDoc(body))
    if (errs.length) { swalError(errs.join("\n")); return false }
    if (nextStatus) {
      const tr = canTransition(doc.status, nextStatus, normalizeDoc(body))
      if (!tr.ok) { swalError(tr.reason ?? "เปลี่ยนสถานะไม่ได้"); return false }
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/price-compare/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ")
      const n = normalizeDoc(d); setDoc(n); setSaved(JSON.stringify(n)); setLogs(null)
      swalToast("success", nextStatus ? `เปลี่ยนสถานะเป็น ${nextStatus}` : "บันทึกแล้ว")
      return true
    } catch (e) { swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); return false }
    finally { setSaving(false) }
  }

  async function changeStatus(to: PcStatus, label: string) {
    const ok = await swalConfirm(`${label}?`, to === "เสร็จสิ้น" ? "หลังปิดใบจะแก้ไขไม่ได้ จนกว่าจะกดเปิดแก้ไข (ครั้งที่แก้ไข +1)" : undefined)
    if (ok.isConfirmed) await save(to)
  }
  async function remove() {
    const ok = await swalDeleteConfirm(`ลบใบ ${doc?.docNo} (ร่าง) — ลบแล้วเลขที่นี้จะไม่ถูกนำกลับมาใช้`)
    if (!ok.isConfirmed) return
    const r = await fetch(`/api/price-compare/${id}`, { method: "DELETE" })
    if (!r.ok) { swalError((await r.json().catch(() => ({}))).error || "ลบไม่สำเร็จ"); return }
    setSaved(JSON.stringify(doc)); router.push("/price-compare")
  }
  async function downloadPdf() {
    // เอกสารล็อกแล้วแก้อะไรไม่ได้ → ไม่ต้องถามบันทึก (save() จะทำให้ revision เดินฟรี)
    if (dirty && !readOnly) { const ok = await swalConfirm("มีการแก้ไขที่ยังไม่บันทึก", "บันทึกก่อนสร้าง PDF?"); if (!ok.isConfirmed) return; if (!(await save())) return }
    setPdfBusy(true)
    try {
      const r = await fetch(`/api/price-compare/${id}/pdf`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "สร้าง PDF ไม่สำเร็จ")
      const failed = parseInt(r.headers.get("X-Attachments-Failed") || "0", 10)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      // <a target="_blank"> ผ่าน popup blocker ได้ดีกว่า window.open หลัง await
      const a = document.createElement("a")
      a.href = url; a.target = "_blank"; a.rel = "noopener"
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (failed > 0) swalToast("warning", `แนบไฟล์ไม่ได้ ${failed} ไฟล์ (ดูหน้าสุดท้ายของ PDF)`)
    } catch (e) { swalError(e instanceof Error ? e.message : "สร้าง PDF ไม่สำเร็จ") }
    finally { setPdfBusy(false) }
  }

  if (!doc) return <div className="p-8 text-center text-gray-400"><Loader2 className="inline animate-spin" /> กำลังโหลด…</div>

  return (
    <div className="w-full px-4 py-4" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* หัว sticky */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-[#EEF2F0] dark:border-white/8 bg-white/90 dark:bg-[#0f1117]/90 px-4 py-2 backdrop-blur">
        <button onClick={() => router.push("/price-compare")} title="กลับหน้ารายการ" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><ArrowLeft size={18} /></button>
        <span className="font-mono text-sm font-semibold">{doc.docNo}</span>
        <span className="truncate text-sm text-gray-600 dark:text-gray-300">{doc.title || "(ยังไม่ระบุชื่องาน)"}</span>
        <StatusChip status={doc.status} />
        {dirty && <span className="text-xs text-amber-600">● ยังไม่บันทึก</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setShowLog((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs dark:border-white/10"><History size={14} /> ประวัติ</button>
          <button onClick={downloadPdf} disabled={pdfBusy} className="inline-flex items-center gap-1 rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-semibold text-[#0E7490] hover:bg-[#0E7490]/10 disabled:opacity-60">
            {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} ดาวน์โหลด PDF
          </button>
          {NEXT_STATUS[doc.status].map((n) => (
            <button key={n.to} onClick={() => changeStatus(n.to, n.label)} disabled={saving} className="rounded-lg border px-3 py-1.5 text-xs font-semibold dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">{n.label}</button>
          ))}
          {!readOnly && (
            <button onClick={() => save()} disabled={saving || !dirty} className="inline-flex items-center gap-1 rounded-lg bg-[#1B8C4B] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
            </button>
          )}
        </div>
      </div>

      {showLog && (
        <Card title="ประวัติ" color="#6B7280">
          {logs === null ? <p className="text-xs text-gray-400">กำลังโหลด…</p> : logs.length === 0 ? <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p> : (
            <ul className="space-y-1 text-xs">
              {logs.map((l) => (
                <li key={l._id} className="flex flex-wrap gap-x-2 border-b border-dashed border-gray-100 dark:border-white/5 py-1">
                  <span className="text-gray-400">{fmtDT(String(l.at))}</span><span className="font-medium">{l.by}</span>
                  <span>{l.action === "create" ? "สร้างใบ" : l.action === "delete" ? "ลบ" : l.statusChange ? `สถานะ ${l.statusChange.from} → ${l.statusChange.to}` : "แก้ไข"}</span>
                  {l.changes?.map((c, i) => <span key={i} className="text-gray-500">· {c.label}: {c.from || "—"} → {c.to || "—"}</span>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="mt-4 space-y-4">
        <Card title="1. หัวเอกสาร" color="#1B8C4B">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="ชื่อสินค้า / งานซ่อม *"><input value={doc.title} disabled={readOnly} onChange={(e) => patch({ title: e.target.value })} className={inputCls} placeholder="เช่น Pump + Motor UH03" /></Field>
            <Field label="หน่วยงานที่ร้องขอ">
              <input list="pc-depts" value={doc.requestDept} disabled={readOnly} onChange={(e) => patch({ requestDept: e.target.value })} className={inputCls} placeholder="เช่น ยานยนต์" />
              <datalist id="pc-depts">{DEPT_MASTER.map((d) => <option key={d} value={d} />)}</datalist>
            </Field>
            <Field label="ผู้จัดทำ"><input value={doc.preparedBy.name} disabled className={`${inputCls} opacity-70`} /></Field>
            <Field label="วันที่เริ่มจัดทำ"><input value={fmtDT(doc.createdAt)} disabled className={`${inputCls} opacity-70`} /></Field>
            <Field label="ครั้งที่แก้ไข / แก้ไขล่าสุด"><input value={`${doc.revision} · ${fmtDT(doc.updatedAt)}`} disabled className={`${inputCls} opacity-70`} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="PR (ถ้ามี)"><input value={doc.links.prCode ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, prCode: e.target.value || undefined } })} className={inputCls} /></Field>
              <Field label="ทะเบียนรถ"><input value={doc.links.plate ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, plate: e.target.value || undefined } })} className={inputCls} /></Field>
              <Field label="เบอร์รถ"><input value={doc.links.fleetNo ?? ""} disabled={readOnly} onChange={(e) => patch({ links: { ...doc.links, fleetNo: e.target.value || undefined } })} className={inputCls} /></Field>
            </div>
          </div>
        </Card>

        <Card title="2. ตารางเทียบราคา" color="#EA580C">
          <PriceCompareMatrix doc={doc} garages={garages} onGarageCreated={(g) => setGarages((gs) => [...gs, g])} onChange={(p) => patch(p)} readOnly={readOnly} />
        </Card>

        <Card title="3. เงื่อนไขในการคัดเลือก" color="#2563EB">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr><th className="px-2 py-1 text-left text-xs text-gray-500">เงื่อนไข</th>{doc.suppliers.map((s, i) => <th key={i} className="px-2 py-1 text-left text-xs text-gray-500">S{i + 1} {s.name}</th>)}</tr></thead>
              <tbody>
                {COND_FIELDS.map(([key, label]) => (
                  <tr key={key} className="border-t border-[#EEF2F0] dark:border-white/8">
                    <td className="px-2 py-1 text-xs">{label}</td>
                    {doc.suppliers.map((s, i) => (
                      <td key={i} className="px-1 py-0.5"><input aria-label={`${label} — S${i + 1}`} value={s.conditions[key]} disabled={readOnly} onChange={(e) => patchSupplier(i, { conditions: { ...s.conditions, [key]: e.target.value } })} className={inputCls} /></td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-[#EEF2F0] dark:border-white/8">
                  <td className="px-2 py-1 text-xs">(7) วันที่ใบเสนอราคา</td>
                  {doc.suppliers.map((s, i) => <td key={i} className="px-1 py-0.5"><input type="date" aria-label={`วันที่ใบเสนอราคา — S${i + 1}`} value={s.quoteDate} disabled={readOnly} onChange={(e) => patchSupplier(i, { quoteDate: e.target.value })} className={inputCls} /></td>)}
                </tr>
                <tr className="border-t border-[#EEF2F0] dark:border-white/8">
                  <td className="px-2 py-1 text-xs">ใบเสนอราคาใช้ได้ถึง</td>
                  {doc.suppliers.map((s, i) => (
                    <td key={i} className="px-1 py-0.5">
                      <input type="date" aria-label={`ใบเสนอราคาใช้ได้ถึง — S${i + 1}`} value={s.validUntil} disabled={readOnly} onChange={(e) => patchSupplier(i, { validUntil: e.target.value })} className={`${inputCls} ${isQuoteExpired(s, today) ? "border-red-400" : ""}`} />
                      {isQuoteExpired(s, today) && <p className="mt-0.5 text-[11px] text-red-600">⚠ หมดอายุแล้ว — ขอใบใหม่ก่อนอนุมัติ</p>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="4. หลักฐาน (ใบเสนอราคา / แชท LINE)" color="#0891B2">
          <div className="grid gap-4 md:grid-cols-2">
            {doc.suppliers.map((s, i) => (
              <div key={`${i}-${doc.suppliers.length}-${uploadKey}`} className="rounded-xl border border-dashed border-[#E2E8E4] dark:border-white/10 p-3">
                <p className="mb-2 text-xs font-semibold">ใบเสนอราคา Supplier {i + 1} — {s.name || "(ยังไม่ระบุ)"} <span className="font-normal text-gray-400">รูปหรือ PDF</span></p>
                <ImageUpload initial={s.quotationFiles} disabled={readOnly} max={10} onChange={(imgs) => setSupplierFiles(i, imgs)} />
              </div>
            ))}
            <div key={`ev-${uploadKey}`} className="rounded-xl border border-dashed border-[#E2E8E4] dark:border-white/10 p-3">
              <p className="mb-2 text-xs font-semibold">หลักฐานอื่น <span className="font-normal text-gray-400">เช่น แคปแชท LINE</span></p>
              <ImageUpload initial={doc.evidenceFiles} disabled={readOnly} max={10} onChange={setEvidenceFiles} />
            </div>
          </div>
        </Card>

        <Card title="5. คณะกรรมการพิจารณาคัดเลือก" color="#7C3AED">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {doc.committee.map((m, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-[#EEF2F0] dark:border-white/8 p-3">
                <Field label="ตำแหน่ง"><input value={m.role} disabled={readOnly} onChange={(e) => patchCommittee(i, { role: e.target.value })} className={inputCls} /></Field>
                <Field label="ชื่อ"><input value={m.name} disabled={readOnly} onChange={(e) => patchCommittee(i, { name: e.target.value })} className={inputCls} /></Field>
                <Field label="Email (ไม่บังคับ)"><input value={m.email ?? ""} disabled={readOnly} onChange={(e) => patchCommittee(i, { email: e.target.value })} className={inputCls} /></Field>
                <Field label="เลือก supplier ลำดับที่">
                  <select value={m.pickedSupplier ?? ""} disabled={readOnly} onChange={(e) => patchCommittee(i, { pickedSupplier: e.target.value ? Number(e.target.value) : null })} className={inputCls}>
                    <option value="">—</option>{doc.suppliers.map((s, k) => <option key={k} value={k + 1}>{k + 1}. {s.name}</option>)}
                  </select>
                </Field>
                <Field label="เหตุผลในการเลือก"><textarea value={m.reason} disabled={readOnly} onChange={(e) => patchCommittee(i, { reason: e.target.value })} rows={2} className={inputCls} /></Field>
                <Field label="วันที่ลงนาม"><input type="date" value={m.signedDate} disabled={readOnly} onChange={(e) => patchCommittee(i, { signedDate: e.target.value })} className={inputCls} /></Field>
              </div>
            ))}
          </div>
        </Card>

        <Card title="6. สรุปผล — ผู้ได้รับเลือก" color="#DC2626">
          <div className="flex flex-wrap gap-3">
            {doc.suppliers.map((s, i) => (
              <label key={i} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm ${doc.selectedSupplier === i + 1 ? "border-[#1B8C4B] bg-[#1B8C4B]/5" : "border-[#EEF2F0] dark:border-white/8"}`}>
                <input type="radio" name="selected" disabled={readOnly} checked={doc.selectedSupplier === i + 1} onChange={() => patch({ selectedSupplier: i + 1, ...(lowNet != null && i === lowNet ? { selectionReason: "" } : {}) })} />
                <span className="font-medium">Supplier {i + 1}</span><span>{s.name}</span>
                <span className="tabular-nums text-gray-500">{fmtMoney(supplierTotals(doc, i).net)}</span>
                {i === lowNet && <span className="rounded bg-emerald-100 px-1.5 text-[10px] text-emerald-700">ถูกสุด</span>}
              </label>
            ))}
          </div>
          {doc.selectedSupplier != null && lowNet != null && doc.selectedSupplier !== lowNet + 1 && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> เลือกรายที่ไม่ใช่สุทธิต่ำสุด — ต้องระบุเหตุผลก่อนส่งลงนาม</p>
              <textarea value={doc.selectionReason} disabled={readOnly} onChange={(e) => patch({ selectionReason: e.target.value })} rows={2} placeholder="เช่น ของใหม่ มือ 1 รับประกัน 1 ปี / ส่งมอบเร็วกว่า 10 วัน" className={inputCls} />
            </div>
          )}
          {fullCount < MIN_QUOTES && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> มีใบเสนอราคาที่ราคาครบเพียง {fullCount} ราย (เกณฑ์ {MIN_QUOTES} ราย) — ต้องระบุเหตุผล</p>
              <textarea value={doc.fewerQuotesReason} disabled={readOnly} onChange={(e) => patch({ fewerQuotesReason: e.target.value })} rows={2} placeholder="เช่น ผู้ขายที่รับงานนี้มีรายเดียว / อีกรายไม่ตอบกลับภายในกำหนด" className={inputCls} />
            </div>
          )}
          {!completeness.ok && <p className="mt-2 text-xs text-gray-500">ยังขาด: {completeness.missing.join(", ")}</p>}
          {doc.status === "ร่าง" && (
            <button onClick={remove} className="mt-4 inline-flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={13} /> ลบใบร่างนี้</button>
          )}
        </Card>
      </div>
    </div>
  )
}
