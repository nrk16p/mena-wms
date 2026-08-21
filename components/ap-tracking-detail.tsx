"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { X } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, AP_FILES_MAX, AP_NO_FIELDS, AP_NO_MAX, AP_NOS_MAX,
  AP_PAY_TYPES, AP_REVIEW_NOTE_MAX, AP_REVIEW_STATUSES, CREDIT_TERMS, apPaySchedule, payThursdayChoices,
  apDocLabel, apFilesByDoc, apItemKeys, apReviewMeta, apStatusMeta, apStatusOf, apTimeline,
  atmsDepositUrl, atmsPoUrl, cleanDocNos, readDocNos, docChecked,
  dueDateOf, isDocSetComplete, missingDocLabels, reviewNeedsNote, thaiDate, thaiDateTime, todayICT,
  upcomingThursdays,
  type ApDocKey, type ApDocNos, type ApDocs, type ApFile, type ApItems, type ApNoKey,
  type ApPayType, type ApReview, type ApReviewStatus,
  type ApSentType, type ApStatus, type ApTimelineStep,
} from "@/lib/ap-tracking"
import type { SkuImage } from "@/lib/media"
import { ImageUpload } from "@/components/image-upload"
import { ApFinanceRequestDialog } from "@/components/ap-finance-request"
import { isAccounting } from "@/lib/roles"
import { NUM, baht, mitr } from "@/components/ap-style"
import type { ApPay, ApRow } from "@/components/ap-types"

type DepositItem = { parts_group?: string; item?: string; serial_no?: string; qty?: string; unit_price?: string; total?: string; remark?: string }
type LogEntry = { action?: string; field?: string; detail?: string; by?: string; at?: string }
type Detail = {
  tracking: ({ log?: LogEntry[]; items?: ApItems; files?: ApFile[]; review?: ApReview; note?: string; pay?: ApPay | null }
    & Partial<ApDocNos>) | null
  items: DepositItem[]
  po: Record<string, unknown> | null
}
type Draft = Record<ApDocKey, boolean>
type Tab = "docs" | "money" | "log"

const TABS: { key: Tab; label: string }[] = [
  { key: "docs",  label: "เอกสารและรายการสินค้า" },
  { key: "money", label: "การเงิน" },
  { key: "log",   label: "ประวัติ" },
]

// ค่าตั้งต้นของช่องติ๊ก — ใช้ docChecked เพื่อให้ช่องรวม "ใบแจ้งหนี้/ใบวางบิล" ขึ้นถูกกับใบเก่า
const draftOf = (docs: ApDocs): Draft =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, docChecked(docs, f.key)])) as Draft

// draft (แค่ true/false) → รูปร่าง ApDocs เพื่อส่งให้กติกาตัวเดียวกับที่เซิร์ฟเวอร์ใช้ตรวจครบชุด
const docsOf = (d: Draft): ApDocs =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, { checked: d[f.key], by: "", at: "" }])) as ApDocs

// ประวัติ 1 บรรทัดอ้างถึงอะไร — ช่องเอกสาร (รวมช่องเก่าที่ถอดออกแล้ว), รายการสินค้า, หรือไม่มีหัวข้อ
function logSubject(field?: string): string {
  if (!field) return ""
  if (field.startsWith("item:")) return `รายการ ${field.slice(5)}`
  if (["sent", "note", "file", "review"].includes(field)) return ""
  return apDocLabel(field)
}

const filesKey = (files: ApFile[]) =>
  files.map((f) => `${f.webpUrl}|${f.docType ?? ""}`).sort().join("\n")

// เส้นทางสถานะ — ใบนี้เดินมาถึงไหนแล้ว ใครทำเมื่อไหร่ · อยู่ใต้หัวโมดัลจึงเห็นได้ทุกแท็บ
const STEP_DOT: Record<ApTimelineStep["state"], string> = {
  done:     "bg-emerald-500 border-emerald-500",
  current:  "bg-white border-emerald-500 dark:bg-[#161a23]",
  rejected: "bg-rose-500 border-rose-500",
  todo:     "bg-gray-200 border-gray-200 dark:bg-white/10 dark:border-white/10",
}
const STEP_TEXT: Record<ApTimelineStep["state"], string> = {
  done:     "text-gray-700 dark:text-gray-200",
  current:  "font-medium text-emerald-700 dark:text-emerald-400",
  rejected: "font-medium text-rose-600 dark:text-rose-400",
  todo:     "text-gray-400",
}

function ApTimelineBar({ steps }: { steps: ApTimelineStep[] }) {
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-2 pt-3">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-start gap-1">
          {i > 0 && <span className="mt-[7px] mr-1 h-px w-6 bg-gray-200 dark:bg-white/10" />}
          <span className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full border-2 ${STEP_DOT[s.state]}`} />
          <span className="leading-tight">
            <span className={`block text-[11px] ${STEP_TEXT[s.state]}`}>{s.label}</span>
            <span className="block text-[10px] text-gray-400" title={s.by ? `โดย ${s.by}` : undefined}>
              {/* ช่วงแรกเป็นวันที่ทำ DD (YYYY-MM-DD) ไม่มีเวลา ช่วงอื่นเป็น timestamp จาก log */}
              {s.at ? (s.at.length === 10 ? thaiDate(s.at) : thaiDateTime(s.at)) : "—"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function ApTrackingDetail({
  row, onClose, onSaved,
}: {
  row: ApRow
  onClose: () => void
  onSaved: (depositCode: string, patch: {
    docs: ApDocs; status: ApStatus; sentType: string; sentDate: string
    note: string; review?: { status: string; note: string }; pay?: ApPay | null
  }) => void
}) {
  // สิทธิ์แก้ผลตรวจ — ฝ่ายบัญชี (หรือแอดมิน) เท่านั้น · คนอื่นเห็นผลตรวจได้แต่กดไม่ได้
  // เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น (403) การซ่อนปุ่มอย่างเดียวไม่ใช่การกันสิทธิ์
  const { data: session } = useSession()
  const canReview = isAccounting(session?.user?.email, session?.user?.employee?.department)

  const [tab, setTab]         = useState<Tab>("docs")
  const [data, setData]       = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  // baseline = สิ่งที่บันทึกไว้จริงในฐานข้อมูล · draft = สิ่งที่ผู้ใช้กำลังแก้ค้างไว้
  // เก็บ baseline เป็น state เอง เพื่อให้หลังบันทึกสำเร็จค่าใหม่กลายเป็นฐานเทียบทันที
  const [saved, setSaved]     = useState<ApDocs>(row.docs)
  const [draft, setDraft]     = useState<Draft>(() => draftOf(row.docs))
  // เลขที่เอกสารเก็บเป็นชุดต่อช่อง (4 ช่อง) — ช่องไหนไม่เคยกรอกก็ยังมีคีย์เป็น [] เสมอ
  const [savedNos, setSavedNos]     = useState<ApDocNos>(() => readDocNos(null))
  const [nos, setNos]               = useState<ApDocNos>(() => readDocNos(null))
  const [savedItems, setSavedItems] = useState<ApItems>({})
  const [itemDraft, setItemDraft]   = useState<Record<string, boolean>>({})
  const [savedFiles, setSavedFiles] = useState<ApFile[]>([])
  const [files, setFiles]           = useState<ApFile[]>([])
  const [savedReview, setSavedReview] = useState<ApReview>({ status: "", note: "" })
  const [savedPay, setSavedPay] = useState<ApPay | null>(null)
  // กล่องยืนยันตอนกดผ่าน — null = ไม่เปิด · เปิดพร้อมค่าตั้งต้น: คำขอจากจัดซื้อ + เทอมจาก master
  const [passConfirm, setPassConfirm] = useState<{ payType: ApPayType; creditTerm: string; payDate: string } | null>(null)
  const [financeOpen, setFinanceOpen] = useState(false)    // กล่องแจ้งการเงินขอนอกรอบ (ใบนี้ใบเดียว)
  const [resubmitNote, setResubmitNote] = useState("")     // สิ่งที่แก้ ก่อนส่งตรวจใหม่ (ลงประวัติ)
  const [resubmitting, setResubmitting] = useState(false)
  const [review, setReview]           = useState<ApReview>({ status: "", note: "" })
  const [savedNote, setSavedNote] = useState(row.note ?? "")
  const [note, setNote]           = useState(row.note ?? "")
  const [savedSent, setSavedSent] = useState({ type: row.sentType as ApSentType, date: row.sentDate })
  const [sent, setSent]           = useState({ type: row.sentType as ApSentType, date: row.sentDate })
  // วันตั้งต้นของ "ตามรอบ" — ปกติคือวันที่ทำ DD แต่เลือกเองได้ · เก็บฝั่งหน้าเว็บอย่างเดียว
  // สิ่งที่บันทึกลงฐานคือวันครบกำหนดที่คำนวณออกมา
  const [baseDate, setBaseDate] = useState(row.receivedAt)
  const [saving, setSaving]     = useState(false)

  const changed = useMemo(
    () => AP_DOC_FIELDS.map((f) => f.key).filter((k) => draft[k] !== docChecked(saved, k)),
    [draft, saved],
  )
  const itemsChanged = useMemo(
    () => Object.keys(itemDraft).filter((k) => itemDraft[k] !== Boolean(savedItems[k]?.checked)),
    [itemDraft, savedItems],
  )
  // เทียบหลังทำความสะอาด — พิมพ์แล้วลบจนเหลือค่าเดิมต้องไม่นับว่าแก้ · นับแยกทีละช่อง
  const nosChangedKeys = useMemo(
    () => AP_NO_FIELDS.map((f) => f.key)
      .filter((k) => cleanDocNos(nos[k]).join("|") !== cleanDocNos(savedNos[k]).join("|")),
    [nos, savedNos],
  )
  const filesChanged  = filesKey(files) !== filesKey(savedFiles)
  const sentChanged   = sent.type !== savedSent.type || sent.date !== savedSent.date
  const reviewChanged = review.status !== savedReview.status || review.note.trim() !== (savedReview.note ?? "").trim()
  const noteChanged   = note.trim() !== savedNote.trim()
  const dirtyCount = changed.length + itemsChanged.length + nosChangedKeys.length
    + (filesChanged ? 1 : 0) + (sentChanged ? 1 : 0) + (reviewChanged ? 1 : 0) + (noteChanged ? 1 : 0)
  const dirty = dirtyCount > 0

  const draftDocs   = useMemo(() => docsOf(draft), [draft])
  const draftStatus = apStatusOf(draftDocs, sent.date)
  const missing     = missingDocLabels(draftDocs)
  const fileCounts  = useMemo(() => apFilesByDoc(files), [files])
  const meta        = apStatusMeta(draftStatus)

  // ตัวเลือก "นอกรอบ" = วันพฤหัสที่กำลังจะถึง 4 ตัว (+ วันที่บันทึกไว้เดิม เผื่อเป็นพฤหัสที่ผ่านมาแล้ว)
  const thursdays = useMemo(() => {
    const list = upcomingThursdays(todayICT(), 4)
    return savedSent.type === "นอกรอบ" && savedSent.date && !list.includes(savedSent.date)
      ? [savedSent.date, ...list] : list
  }, [savedSent])

  const timeline = useMemo(
    () => apTimeline(data?.tracking?.log,
      { docs: saved, sentDate: savedSent.date, review: savedReview, receivedAt: row.receivedAt,
        paid: row.paid ?? null }),
    [data, saved, savedSent.date, savedReview, row.receivedAt, row.paid],
  )

  const depositItems = useMemo(() => data?.items ?? [], [data])
  const itemKeys     = useMemo(() => apItemKeys(depositItems), [depositItems])
  const itemsDone    = itemKeys.filter((k) => itemDraft[k]).length
  const allItemsOn   = itemKeys.length > 0 && itemsDone === itemKeys.length
  // ติ๊กทั้งใบทีเดียว — ใบที่มีสิบกว่ารายการแต่มาพร้อมบิลใบเดียว ไม่ควรต้องคลิกทีละแถว
  const toggleAllItems = () => setItemDraft((d) => {
    const next = { ...d }
    for (const k of itemKeys) next[k] = !allItemsOn
    return next
  })

  // แก้ลิสต์เลขที่ทีละช่อง — ทุกตัวคืน object ใหม่ทั้งชุด ไม่แก้ของเดิมในที่ (React ต้องเห็นว่าเปลี่ยน)
  const setNoAt   = (key: ApNoKey, i: number, v: string) =>
    setNos((p) => ({ ...p, [key]: p[key].map((x, j) => (j === i ? v : x)) }))
  const addNo     = (key: ApNoKey) => setNos((p) => ({ ...p, [key]: [...p[key], ""] }))
  const removeNo  = (key: ApNoKey, i: number) =>
    setNos((p) => ({ ...p, [key]: p[key].filter((_, j) => j !== i) }))

  const loadDetail = useCallback(async (code: string, alive: () => boolean) => {
    try {
      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(code)}`)
      const d   = await res.json()
      if (!alive() || !res.ok) return
      setData(d)
      const t: ApItems   = d?.tracking?.items ?? {}
      const fl: ApFile[] = Array.isArray(d?.tracking?.files) ? d.tracking.files : []
      const dn: ApDocNos = readDocNos(d?.tracking)
      const rv: ApReview = {
        status: (d?.tracking?.review?.status ?? "") as ApReviewStatus,
        note: d?.tracking?.review?.note ?? "",
        by: d?.tracking?.review?.by, at: d?.tracking?.review?.at,
      }
      const nt = String(d?.tracking?.note ?? "")
      setSavedPay((d?.tracking?.pay ?? null) as ApPay | null)
      setSavedNos(dn);    setNos(dn)
      setSavedReview(rv); setReview(rv)
      setSavedNote(nt);   setNote(nt)
      setSavedItems(t)
      setItemDraft(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Boolean(v?.checked)])))
      setSavedFiles(fl);  setFiles(fl)
    } finally { if (alive()) setLoading(false) }
  }, [])

  useEffect(() => {
    let ok = true
    loadDetail(row.depositCode, () => ok)
    return () => { ok = false }
  }, [row.depositCode, loadDetail])

  // ImageUpload คายรายการไฟล์ที่อัปโหลดเสร็จทุกครั้งที่ชุดเปลี่ยน (รวมตอน mount ที่ยังว่าง)
  // — ก่อนโหลดเสร็จต้องไม่รับ ไม่งั้นไฟล์ที่บันทึกไว้จะถูกล้างเป็น [] ตั้งแต่ยังไม่ทันเห็น
  const onUpload = useCallback((imgs: SkuImage[]) => {
    if (loading) return
    setFiles((prev) => {
      const typeByUrl = new Map(prev.map((f) => [f.webpUrl, f.docType]))
      return imgs.map((img) => ({ ...img, docType: typeByUrl.get(img.webpUrl) ?? "" }))
    })
  }, [loading])

  const requestClose = async () => {
    if (!dirty) return onClose()
    const r = await swalConfirm("ปิดโดยไม่บันทึก?", `มีการแก้ไขที่ยังไม่ได้บันทึก ${dirtyCount} รายการ — ปิดแล้วจะหายไป`)
    if (r.isConfirmed) onClose()
  }

  const resetAll = () => {
    setDraft(draftOf(saved)); setNos(savedNos); setFiles(savedFiles)
    setItemDraft(Object.fromEntries(Object.entries(savedItems).map(([k, v]) => [k, Boolean(v?.checked)])))
    setSent(savedSent); setReview(savedReview); setNote(savedNote)
  }

  // กดบันทึกโดยมีการเปลี่ยนผลตรวจเป็น "ผ่าน" → ต้องผ่านกล่องยืนยันกำหนดจ่ายก่อนเสมอ
  // (กติกาผู้ใช้: กดผ่าน = เริ่มกระบวนการจ่ายเงิน ต้องเห็นวันจ่ายก่อนยืนยัน)
  const requestSave = () => {
    if (reviewChanged && review.status === "ผ่าน") {
      setTab("money")
      setPassConfirm({
        payType: (AP_PAY_TYPES as string[]).includes(sent.type) ? (sent.type as ApPayType) : "ตามรอบ",
        creditTerm: row.creditTerm ?? "",
        payDate: payThursdayChoices(todayICT()).def,     // default = พฤหัสหน้า (ผู้ใช้สั่ง)
      })
      return
    }
    save()
  }

  const save = async (passOpts?: { payType: ApPayType; creditTerm: string; payDate: string }) => {
    if (!dirty || saving) return
    if (reviewNeedsNote(review.status, review.note)) {
      setTab("money"); swalError("ตีกลับต้องระบุเหตุผลว่าไม่ผ่านเพราะอะไร"); return
    }
    if (sent.type && !sent.date) {
      setTab("money")
      swalError(sent.type === "ตามรอบ"
        ? "ยังไม่มีวันครบกำหนด — ตั้งเครดิตเทอมของซัพพลายเออร์ก่อน หรือระบุวันที่เอง"
        : "เลือกวันพฤหัสที่จะโอนก่อน")
      return
    }
    setSaving(true)
    try {
      // ส่งเฉพาะสิ่งที่เปลี่ยนจริง — ช่องติ๊ก/รายการเขียนแบบ dotted path ต่อคีย์ฝั่งเซิร์ฟเวอร์
      // จึงไม่ทับของที่คนอื่นเพิ่งบันทึกระหว่างที่เราเปิดโมดัลค้างไว้
      const body: Record<string, unknown> = {}
      if (changed.length) {
        const docsBody: Record<string, boolean> = Object.fromEntries(changed.map((k) => [k, draft[k]]))
        // เอาติ๊กช่องรวมออก แต่ใบนี้ติ๊กค้างไว้ที่คีย์เก่า → ต้องล้างคีย์เก่าด้วย
        // ไม่งั้นเหลือติ๊กผีที่มองไม่เห็นแต่ยังทำให้สถานะเป็น "ครบชุด"
        if (changed.includes("invoice") && !draft.invoice && saved.billingNote?.checked) docsBody.billingNote = false
        body.docs = docsBody
      }
      if (itemsChanged.length) body.items  = Object.fromEntries(itemsChanged.map((k) => [k, itemDraft[k]]))
      for (const k of nosChangedKeys) body[k] = cleanDocNos(nos[k])
      if (filesChanged)        body.files  = files
      if (reviewChanged)       body.review = { status: review.status, note: review.note.trim() }
      // ค่าที่ยืนยันในกล่องกำหนดจ่าย — เซิร์ฟเวอร์คิดวันจ่ายเองอีกรอบจากนาฬิกาของมัน (ตัวจริง)
      if (passOpts) {
        body.payType = passOpts.payType
        // ส่งเทอมเฉพาะตอนที่ต่างจาก master — ฝั่งเซิร์ฟเวอร์จะบันทึกกลับเข้า ap_supplier ให้ด้วย
        if (passOpts.creditTerm && passOpts.creditTerm !== (row.creditTerm ?? "")) body.payCreditTerm = passOpts.creditTerm
        // นอกรอบ: วันพฤหัสที่เลือก — เซิร์ฟเวอร์ตรวจกับตัวเลือกที่ทันรอบอีกชั้น
        if (passOpts.payType === "นอกรอบ" && passOpts.payDate) body.payDate = passOpts.payDate
      }
      if (noteChanged)         body.note   = note.trim()
      if (sentChanged)       { body.sentType = sent.type; body.sentDate = sent.date }

      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")

      // ยึดผลจากเซิร์ฟเวอร์เป็นความจริง (มี by/at ของคนติ๊กจริง + ช่องที่ถูกติ๊กอัตโนมัติจากไฟล์แนบ)
      const docsOut  = d.docs as ApDocs
      const itemsOut = (d.items ?? {}) as ApItems
      const filesOut = (d.files ?? []) as ApFile[]
      const nosOut   = readDocNos(d)
      const rvOut    = (d.review ?? { status: "", note: "" }) as ApReview
      const payOut   = (d.pay ?? null) as ApPay | null
      const noteOut  = String(d.note ?? "")
      const sentOut  = { type: (d.sentType ?? "") as ApSentType, date: String(d.sentDate ?? "") }
      setSaved(docsOut);       setDraft(draftOf(docsOut))
      setSavedItems(itemsOut); setItemDraft(Object.fromEntries(Object.entries(itemsOut).map(([k, v]) => [k, Boolean(v?.checked)])))
      setSavedFiles(filesOut); setFiles(filesOut)
      setSavedNos(nosOut);     setNos(nosOut)
      setSavedReview(rvOut);   setReview(rvOut)
      setSavedPay(payOut);     setPassConfirm(null)
      setSavedNote(noteOut);   setNote(noteOut)
      setSavedSent(sentOut);   setSent(sentOut)
      onSaved(row.depositCode, {
        docs: docsOut, status: d.status as ApStatus, sentType: sentOut.type, sentDate: sentOut.date,
        note: noteOut, review: { status: rvOut.status, note: rvOut.note }, pay: payOut,
      })
      loadDetail(row.depositCode, () => true)   // ดึง log รอบใหม่มาแสดง
      swalToast("success", `บันทึกแล้ว ${dirtyCount} รายการ`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  // จัดซื้อกด "แก้ไขแล้ว ส่งตรวจใหม่" — เคลียร์ตีกลับกลับเป็นรอตรวจ (สิทธิ์แคบ เซิร์ฟเวอร์คุมอีกชั้น)
  const resubmit = async () => {
    if (resubmitting) return
    setResubmitting(true)
    try {
      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review: { status: "", note: "" }, resubmitNote: resubmitNote.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "ส่งตรวจใหม่ไม่สำเร็จ")
      const rvOut = (d.review ?? { status: "", note: "" }) as ApReview
      setSavedReview(rvOut); setReview(rvOut); setResubmitNote("")
      onSaved(row.depositCode, {
        docs: d.docs as ApDocs, status: d.status as ApStatus, sentType: d.sentType ?? "", sentDate: d.sentDate ?? "",
        note: String(d.note ?? ""), review: { status: rvOut.status, note: rvOut.note }, pay: d.pay ?? null,
      })
      loadDetail(row.depositCode, () => true)
      swalToast("success", "ส่งตรวจใหม่แล้ว — ใบกลับไปคิวบัญชีตรวจ")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ส่งตรวจใหม่ไม่สำเร็จ")
    } finally { setResubmitting(false) }
  }

  const rvMeta = apReviewMeta(savedReview.status)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={requestClose}>
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-[#161a23] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>

        {/* หัวติดบน — เลขใบ ยอดเงิน สถานะ อยู่ในสายตาตลอดเวลาที่เลื่อนดูข้างล่าง */}
        <div className="border-b border-gray-100 px-5 pt-4 dark:border-white/10">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold" style={mitr}>{row.depositCode}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
                  {meta.emoji} {meta.value}
                </span>
                {savedReview.status && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${rvMeta.cls}`}>
                    {rvMeta.emoji} {rvMeta.label}
                  </span>
                )}
              </div>
              <div className="truncate text-sm text-gray-500" title={row.supplier}>{row.supplier}</div>
              <div className="text-xs text-gray-400">
                {row.warehouse} · รับของ {thaiDate(row.receivedAt)}
                {row.creditTerm ? ` · เครดิต ${row.creditTerm} ครบกำหนด ${thaiDate(row.dueDate)}` : " · ยังไม่ตั้งเครดิตเทอม"}
                {/* เปิดหน้าเอกสารตัวจริงใน ATMS — เช็คกับต้นทางได้โดยไม่ต้องไปค้นเอง */}
                {row.depositId != null && (
                  <> · <a href={atmsDepositUrl(row.depositId)} target="_blank" rel="noreferrer"
                    className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400">DD ใน ATMS ↗</a></>
                )}
                {row.poId != null && (
                  <> · <a href={atmsPoUrl(row.poId)} target="_blank" rel="noreferrer"
                    className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400">PO ใน ATMS ↗</a></>
                )}
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className={`text-xl font-bold ${NUM}`}>{baht(row.amount)}</div>
              <div className="text-xs text-gray-400">{row.purchaseOrder || "ไม่มี PO"}</div>
            </div>
            <button onClick={requestClose} aria-label="ปิด"
              className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10"><X className="h-5 w-5" /></button>
          </div>

          <ApTimelineBar steps={timeline} />

          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition ${tab === t.key
                  ? "border-emerald-600 font-medium text-emerald-700 dark:text-emerald-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
                {t.label}
                {t.key === "docs" && (depositItems.length > 0 || files.length > 0) && (
                  <span className="ml-1 text-[10px] text-gray-400">
                    {depositItems.length > 0 ? `${itemsDone}/${depositItems.length}` : ""}
                    {files.length > 0 ? ` 📎${files.length}` : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* เนื้อหาแท็บ — เลื่อนเฉพาะส่วนนี้ หัวกับปุ่มบันทึกอยู่กับที่ */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {tab === "docs" && (
            <section className="space-y-2">
              <div className="text-xs text-gray-500">
                {row.purchaseOrder
                  ? <>PO {row.purchaseOrder} · ยอด <span className={NUM}>{row.poTotal.toLocaleString("th-TH")}</span> · กำหนดส่ง {thaiDate(row.poDue)} · {row.poStatus || "—"}{row.vehicle ? <> · 🚚 {row.vehicle}</> : null}
                    {row.prNote ? <div className="mt-0.5 text-[11px] text-gray-400">หมายเหตุ PR: {row.prNote}</div> : null}</>
                  : "ไม่มี PO ผูกกับใบนี้ในระบบ ATMS"}
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold" style={mitr}>รายการสินค้า</h3>
                {depositItems.length > 0 && (
                  <span className={`text-xs ${itemsDone === depositItems.length ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500"}`}>
                    หลักฐานครบ {itemsDone}/{depositItems.length} รายการ
                  </span>
                )}
                <span className="text-[10px] text-gray-400">(ติ๊กได้เลย ไม่ต้องแนบไฟล์)</span>
              </div>
              {loading ? <div className="text-sm text-gray-400">กำลังโหลด…</div> : (
                <div className="overflow-x-auto rounded-xl border border-gray-200/80 dark:border-white/10">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50/80 text-gray-500 dark:bg-white/5">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">รายการ</th>
                        <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                        <th className="px-2 py-2 text-right font-medium">ราคา/หน่วย</th>
                        <th className="px-2 py-2 text-right font-medium">รวม</th>
                        <th className="px-2 py-2 text-center font-medium">
                          <label className="inline-flex cursor-pointer items-center gap-1.5" title="ติ๊กหลักฐานทุกรายการในใบนี้">
                            <input type="checkbox" checked={allItemsOn} onChange={toggleAllItems}
                              disabled={itemKeys.length === 0}
                              ref={(el) => { if (el) el.indeterminate = itemsDone > 0 && !allItemsOn }}
                              className="h-3.5 w-3.5 cursor-pointer accent-emerald-600" />
                            หลักฐาน
                          </label>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {depositItems.map((it, i) => {
                        const k = itemKeys[i]
                        const mark = savedItems[k]
                        const on = Boolean(itemDraft[k])
                        return (
                          <tr key={k} className="border-t border-gray-100 dark:border-white/5">
                            <td className="px-2 py-2">{it.item}</td>
                            <td className={`px-2 py-2 text-right ${NUM}`}>{it.qty}</td>
                            <td className={`px-2 py-2 text-right ${NUM}`}>{it.unit_price}</td>
                            <td className={`px-2 py-2 text-right ${NUM}`}>{it.total}</td>
                            <td className="px-2 py-2 text-center">
                              <input type="checkbox" checked={on}
                                onChange={(e) => setItemDraft((d) => ({ ...d, [k]: e.target.checked }))}
                                title={mark?.checked && mark.by ? `ติ๊กโดย ${mark.by} ${thaiDateTime(mark.at || "")}` : undefined}
                                className={`h-4 w-4 cursor-pointer accent-emerald-600 ${on !== Boolean(mark?.checked) ? "rounded ring-2 ring-amber-400" : ""}`} />
                            </td>
                          </tr>
                        )
                      })}
                      {depositItems.length === 0 && (
                        <tr><td colSpan={5} className="px-2 py-6 text-center text-gray-400">ไม่มีรายการสินค้าในระบบ</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "docs" && (
            <>
              <section className="space-y-2 border-t border-gray-100 pt-4 dark:border-white/10">
                <h3 className="text-sm font-bold" style={mitr}>ชุดเอกสาร</h3>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {AP_DOC_FIELDS.map((f) => {
                    const mark = f.key === "invoice" ? (saved.invoice ?? saved.billingNote) : saved[f.key]
                    const n = fileCounts[f.key] ?? 0
                    return (
                      <label key={f.key} className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                        <input type="checkbox" checked={draft[f.key]}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))}
                          className="h-4 w-4 cursor-pointer accent-emerald-600" />
                        <span className={draft[f.key] !== docChecked(saved, f.key) ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                          {f.label}
                        </span>
                        {n > 0 && <span className="text-[10px] text-blue-600 dark:text-blue-400" title={`มีไฟล์แนบ ${n} ไฟล์`}>📎{n}</span>}
                        {mark?.checked && mark.by && (
                          <span className="ml-auto text-[10px] text-gray-400" title={`${mark.by} · ${thaiDateTime(mark.at || "")}`}>
                            {mark.by.split(" ")[0]}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
                <div className="text-xs">
                  {isDocSetComplete(draftDocs)
                    ? <span className="text-emerald-700 dark:text-emerald-400">ครบชุดแล้ว — ส่งบัญชีได้</span>
                    : <span className="text-gray-500">ยังขาด: {missing.join(", ")}</span>}
                </div>
              </section>

              {/* เลขที่เอกสาร — ATMS ไม่มีให้ ต้องคีย์เอง · ช่องหนึ่งใส่ได้หลายเลข (ใบ DD ใบเดียว
                  อาจมีใบกำกับหลายใบ) · โครงช่องมาจาก AP_NO_FIELDS ที่เดียว เพิ่มช่องใหม่ไม่ต้องแก้ตรงนี้ */}
              <section className="space-y-2">
                <h3 className="text-sm font-bold" style={mitr}>เลขที่เอกสาร</h3>
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {/* เลข Voucher เป็นของฝั่งบัญชี — ย้ายไปแท็บการเงิน ใต้ช่องตรวจผ่าน (ผู้ใช้สั่ง 21/08/2026) */}
                  {AP_NO_FIELDS.filter((f) => f.key !== "voucherNos").map((f) => {
                    const list = nos[f.key]
                    const edited = nosChangedKeys.includes(f.key)
                    return (
                      <div key={f.key} className="space-y-1">
                        <div className={`text-xs font-medium ${edited ? "text-amber-700 dark:text-amber-400" : "text-gray-600 dark:text-gray-300"}`}>
                          {f.label}{list.length > 1 ? ` (${list.length})` : ""}
                        </div>
                        {list.map((v, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <input value={v} maxLength={AP_NO_MAX} placeholder={f.label}
                              onChange={(e) => setNoAt(f.key, i, e.target.value)}
                              className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm dark:bg-white/5 ${edited ? "border-amber-400" : "border-gray-200/80 dark:border-white/10"}`} />
                            <button onClick={() => removeNo(f.key, i)} title={`ลบ${f.label}นี้`}
                              className="shrink-0 rounded-lg border border-gray-200/80 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:border-white/10 dark:hover:bg-rose-900/20">✕</button>
                          </div>
                        ))}
                        {list.length < AP_NOS_MAX && (
                          <button onClick={() => addNo(f.key)}
                            className="rounded-lg border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-white/20 dark:text-gray-300 dark:hover:bg-white/5">
                            + เพิ่ม{f.short}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold" style={mitr}>ไฟล์แนบ</h3>
                  <span className="text-xs text-gray-400">{files.length}/{AP_FILES_MAX} ไฟล์ · รูปหรือ PDF · ไม่บังคับ</span>
                </div>
                {/* key พลิกตอนโหลดเสร็จ → uploader เกิดใหม่พร้อมไฟล์ที่บันทึกไว้เป็นค่าตั้งต้น */}
                <ImageUpload key={loading ? "up-loading" : "up-ready"} initial={savedFiles} onChange={onUpload} max={AP_FILES_MAX} />
                {files.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-400">เลือกประเภทเอกสารของแต่ละไฟล์ — เลือกแล้วระบบติ๊กช่องนั้นให้</div>
                    {files.map((f) => (
                      <div key={f.webpUrl} className="flex items-center gap-2 text-xs">
                        <a href={f.webpUrl} target="_blank" rel="noreferrer"
                          className="flex-1 truncate text-blue-600 hover:underline" title={f.filename}>{f.filename}</a>
                        <select value={f.docType ?? ""}
                          onChange={(e) => setFiles((prev) => prev.map((x) =>
                            x.webpUrl === f.webpUrl ? { ...x, docType: e.target.value as ApDocKey | "" } : x))}
                          className={`rounded-lg border bg-white px-2 py-1 dark:bg-white/5 ${f.docType ? "border-gray-200/80 dark:border-white/10" : "border-amber-400 text-amber-700 dark:text-amber-400"}`}>
                          <option value="">— เลือกประเภท —</option>
                          {AP_DOC_FIELDS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {tab === "money" && (
            <>
              {/* จ่ายจริงแล้ว (จากทะเบียนการเงิน) — ใบจบวงจร ให้เห็นก่อนทุกอย่างในแท็บการเงิน */}
              {row.paid?.paymentNos?.length ? (
                <section className="rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm dark:border-teal-800 dark:bg-teal-900/20">
                  <div className="font-bold text-teal-800 dark:text-teal-300" style={mitr}>
                    ✅ จ่ายเงินแล้ว {thaiDate(row.paid.date)}
                  </div>
                  <div className="mt-0.5 text-xs text-teal-700 dark:text-teal-300">
                    เลข PV: <span className={NUM}>{row.paid.paymentNos.join(", ")}</span>
                    {typeof row.paid.amount === "number" && <> · ยอดจ่าย <span className={NUM}>{baht(row.paid.amount)}</span> บาท</>}
                    {row.paid.sharedWith?.length ? <> · จ่ายรวมบิลเดียวกับ {row.paid.sharedWith.join(", ")}</> : null}
                  </div>
                  {row.paid.source === "payment-file" && (
                    <div className="mt-0.5 text-[10px] text-teal-600/70 dark:text-teal-400/70">ที่มา: ทะเบียนจ่ายของการเงิน (นำเข้าจากไฟล์)</div>
                  )}
                </section>
              ) : null}

              {/* รอบการวางบิล — ตามรอบ = เครดิตเทอมนับจากวันตั้งต้น · นอกรอบ = วันพฤหัสเท่านั้น */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold" style={mitr}>รอบการวางบิล</h3>
                  {savedSent.date
                    ? <span className="text-xs text-emerald-700 dark:text-emerald-400">บันทึกไว้: {savedSent.type} {thaiDate(savedSent.date)}</span>
                    : <span className="text-xs text-gray-400">ยังไม่ได้ส่งบัญชี</span>}
                </div>

                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="radio" name="apSent" className="h-4 w-4 accent-emerald-600"
                    checked={sent.type === "ตามรอบ"}
                    onChange={() => setSent({ type: "ตามรอบ", date: sent.type === "ตามรอบ" ? sent.date : (dueDateOf(baseDate, row.creditTerm) || row.dueDate || "") })} />
                  <span className="font-medium">📋 ตามรอบ</span>
                  <span className="text-xs text-gray-500">
                    {row.creditTerm ? `เครดิต ${row.creditTerm} นับจากวันที่ทำ DD` : "ยังไม่ตั้งเครดิตเทอม — ระบุวันครบกำหนดเอง"}
                  </span>
                </label>
                {sent.type === "ตามรอบ" && (
                  <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">
                    <span className="text-gray-500">นับจาก</span>
                    <input type="date" value={baseDate}
                      onChange={(e) => {
                        const b = e.target.value
                        setBaseDate(b)
                        const d = dueDateOf(b, row.creditTerm)
                        if (d) setSent({ type: "ตามรอบ", date: d })
                      }}
                      className="rounded-lg border border-gray-200/80 bg-white px-2 py-1 dark:border-white/10 dark:bg-white/5" />
                    {baseDate !== row.receivedAt && (
                      <button onClick={() => {
                        setBaseDate(row.receivedAt)
                        const d = dueDateOf(row.receivedAt, row.creditTerm)
                        if (d) setSent({ type: "ตามรอบ", date: d })
                      }} className="text-blue-600 hover:underline">ใช้วันที่ทำ DD</button>
                    )}
                    <span className="text-gray-500">→ ครบกำหนด</span>
                    <input type="date" value={sent.date} onChange={(e) => setSent({ type: "ตามรอบ", date: e.target.value })}
                      className="rounded-lg border border-gray-200/80 bg-white px-2 py-1 dark:border-white/10 dark:bg-white/5" />
                    {sent.date && <span className="text-gray-400">({thaiDate(sent.date)})</span>}
                  </div>
                )}

                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="radio" name="apSent" className="h-4 w-4 accent-emerald-600"
                    checked={sent.type === "นอกรอบ"}
                    onChange={() => setSent({ type: "นอกรอบ", date: sent.type === "นอกรอบ" ? sent.date : (thursdays[0] ?? "") })} />
                  <span className="font-medium">💸 นอกรอบ</span>
                  <span className="text-xs text-gray-500">โอนทุกวันพฤหัส</span>
                  {sent.type === "นอกรอบ" && (
                    <select value={sent.date} onChange={(e) => setSent({ type: "นอกรอบ", date: e.target.value })}
                      className="rounded-lg border border-gray-200/80 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5">
                      {thursdays.map((d, i) => (
                        <option key={d} value={d}>{thaiDate(d)}{i === 0 ? " (พฤหัสนี้)" : i === 1 ? " (พฤหัสหน้า)" : ""}</option>
                      ))}
                    </select>
                  )}
                </label>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {!isDocSetComplete(draftDocs) && sent.type && (
                    <span className="text-rose-600">ส่งบัญชีไม่ได้จนกว่าเอกสารจะครบชุด — ยังขาด: {missing.join(", ")}</span>
                  )}
                  {/* ขอนอกรอบต้องอีเมลแจ้งการเงินด้วยทุกครั้ง — สร้างข้อความให้จากใบนี้เลย */}
                  {sent.type === "นอกรอบ" && (
                    <button onClick={() => setFinanceOpen(true)}
                      className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20">
                      ✉️ แจ้งการเงิน
                    </button>
                  )}
                  {sent.date && (
                    <button onClick={() => setSent({ type: "", date: "" })} className="ml-auto text-rose-600 hover:underline">
                      ยกเลิกการส่งบัญชี
                    </button>
                  )}
                </div>
              </section>

              {/* บัญชีตรวจเอกสาร — ตีกลับต้องบอกเหตุผล (บังคับทั้งที่นี่และฝั่ง API) */}
              <section className="space-y-2 border-t border-gray-100 pt-4 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold" style={mitr}>บัญชีตรวจเอกสาร</h3>
                  {savedReview.by && (
                    <span className="text-xs text-gray-400">
                      ล่าสุดโดย {savedReview.by}{savedReview.at ? ` · ${thaiDateTime(savedReview.at)}` : ""}
                    </span>
                  )}
                  {!canReview && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-white/10 dark:text-gray-400">
                      เฉพาะฝ่ายบัญชีแก้ไขได้
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["", ...AP_REVIEW_STATUSES] as ApReviewStatus[]).map((st) => {
                    const m = apReviewMeta(st)
                    const on = review.status === st
                    return (
                      <button key={st || "none"} onClick={() => setReview((r) => ({ ...r, status: st }))}
                        disabled={!canReview}
                        title={canReview ? undefined : "เฉพาะฝ่ายบัญชีแก้ไขได้"}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? `${m.cls} border-transparent ring-2 ring-offset-1 dark:ring-offset-[#161a23]` : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
                        {m.emoji} {st || "ยังไม่ตรวจ"}
                      </button>
                    )
                  })}
                </div>
                {/* ใบถูกตีกลับ — จัดซื้อแก้เอกสารแล้วส่งกลับเข้าคิวตรวจได้เอง ไม่ต้องรอบัญชีมาเคลียร์ให้
                    (เซิร์ฟเวอร์เปิดสิทธิ์เฉพาะทรานสิชัน ไม่ผ่าน → รอตรวจ เท่านั้น) */}
                {savedReview.status === "ไม่ผ่าน" && (
                  <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-900 dark:bg-rose-900/15">
                    <div className="text-xs text-rose-700 dark:text-rose-300">
                      <b>เหตุผลที่ตีกลับ:</b> {savedReview.note || "—"}
                      {savedReview.by && <span className="text-rose-400"> · โดย {savedReview.by}{savedReview.at ? ` · ${thaiDateTime(savedReview.at)}` : ""}</span>}
                    </div>
                    <textarea value={resubmitNote} rows={2} maxLength={AP_REVIEW_NOTE_MAX}
                      onChange={(e) => setResubmitNote(e.target.value)}
                      placeholder="สิ่งที่แก้ไข (บันทึกลงประวัติ) เช่น แนบใบกำกับฉบับแก้แล้ว"
                      className="w-full rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs dark:border-rose-900 dark:bg-white/5" />
                    <button onClick={resubmit} disabled={resubmitting}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                      {resubmitting ? "กำลังส่ง…" : "📤 แก้ไขแล้ว — ส่งตรวจใหม่"}
                    </button>
                  </div>
                )}

                {/* กำหนดจ่ายที่ยืนยันไว้ตอนกดผ่าน — โชว์ค้างไว้ให้ทุกคนเห็นว่าเงินจะออกวันไหน */}
                {savedPay && savedReview.status === "ผ่าน" && (
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                    💰 {savedPay.type === "ตามรอบ"
                      ? savedPay.cutoff
                        ? <>ตามรอบ · ครบกำหนด {thaiDate(savedPay.dueDate)} · ตัดรอบ {thaiDate(savedPay.cutoff)} · <b>จ่าย {thaiDate(savedPay.payDate)}</b></>
                        : <>ตามรอบ (เครดิตสั้น) · <b>โอนพฤหัส {thaiDate(savedPay.payDate)}</b></>
                      : <>นอกรอบ · <b>โอนพฤหัส {thaiDate(savedPay.payDate)}</b></>}
                    {savedPay.basis?.creditTerm && savedPay.type === "ตามรอบ" && <> · เครดิต {savedPay.basis.creditTerm}</>}
                  </div>
                )}
                {(review.status === "ไม่ผ่าน" || review.note) && (
                  <label className="block space-y-1 text-xs">
                    <span className={review.status === "ไม่ผ่าน" ? "text-rose-600" : "text-gray-500"}>
                      {review.status === "ไม่ผ่าน" ? "เหตุผลที่ไม่ผ่าน (จำเป็น)" : "หมายเหตุจากบัญชี"}
                    </span>
                    <textarea value={review.note} rows={2} maxLength={AP_REVIEW_NOTE_MAX} disabled={!canReview}
                      onChange={(e) => setReview((r) => ({ ...r, note: e.target.value }))}
                      className={`w-full rounded-lg border px-2 py-1 dark:bg-white/5 ${reviewNeedsNote(review.status, review.note) ? "border-rose-400" : "border-gray-200/80 dark:border-white/10"}`} />
                  </label>
                )}
              </section>

              {/* เลขตั้งหนี้ (Voucher) — บัญชีออกตอนผ่าน จึงอยู่คู่กับช่องตรวจ ไม่ใช่ชุดเอกสารของจัดซื้อ */}
              <section className="space-y-1 border-t border-gray-100 pt-4 dark:border-white/10">
                <div className={`text-sm font-bold ${nosChangedKeys.includes("voucherNos") ? "text-amber-700 dark:text-amber-400" : ""}`} style={mitr}>
                  เลขที่ Voucher/ตั้งหนี้{nos.voucherNos.length > 1 ? ` (${nos.voucherNos.length})` : ""}
                </div>
                {nos.voucherNos.map((v, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input value={v} maxLength={AP_NO_MAX} placeholder="เช่น LAPO26080130"
                      onChange={(e) => setNoAt("voucherNos", i, e.target.value)}
                      className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm dark:bg-white/5 ${nosChangedKeys.includes("voucherNos") ? "border-amber-400" : "border-gray-200/80 dark:border-white/10"}`} />
                    <button onClick={() => removeNo("voucherNos", i)} title="ลบเลขนี้"
                      className="shrink-0 rounded-lg border border-gray-200/80 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:border-white/10 dark:hover:bg-rose-900/20">✕</button>
                  </div>
                ))}
                {nos.voucherNos.length < AP_NOS_MAX && (
                  <button onClick={() => addNo("voucherNos")}
                    className="rounded-lg border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-white/20 dark:text-gray-300 dark:hover:bg-white/5">
                    + เพิ่มเลข Voucher
                  </button>
                )}
              </section>

              <section className="space-y-1 border-t border-gray-100 pt-4 dark:border-white/10">
                <label className="block space-y-1 text-xs">
                  <span className="text-sm font-bold" style={mitr}>หมายเหตุ</span>
                  <textarea value={note} rows={2} maxLength={500} placeholder="บันทึกภายในของทีมจัดเอกสาร"
                    onChange={(e) => setNote(e.target.value)}
                    className={`w-full rounded-lg border px-2 py-1 dark:bg-white/5 ${noteChanged ? "border-amber-400" : "border-gray-200/80 dark:border-white/10"}`} />
                </label>
              </section>
            </>
          )}

          {tab === "log" && (
            <section>
              <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
                {(data?.tracking?.log ?? []).slice().reverse().map((l, i) => (
                  <li key={i} className="border-l-2 border-gray-200 pl-2 dark:border-white/10">
                    <span className={`text-gray-400 ${NUM}`}>{thaiDateTime(l.at ?? "")}</span>{" "}
                    {l.action} {logSubject(l.field)} {l.detail ?? ""}
                    <span className="text-gray-400"> · โดย {l.by || "—"}</span>
                  </li>
                ))}
                {!loading && (data?.tracking?.log ?? []).length === 0 && <li className="text-gray-400">ยังไม่มีประวัติ</li>}
              </ul>
            </section>
          )}
        </div>

        {/* กล่องยืนยันตอนกดผ่าน — เห็นวันจ่ายที่คิดตามกติกาก่อน แล้วค่อยยืนยัน
            พรีวิวฝั่งนี้คิดจากวันนี้ (เวลาไทย) — เซิร์ฟเวอร์คิดซ้ำจากนาฬิกาตัวเองเป็นตัวจริง */}
        {passConfirm && (() => {
          const thuChoices = payThursdayChoices(todayICT())
          const preview = apPaySchedule(todayICT(), passConfirm.payType, passConfirm.creditTerm,
            passConfirm.payType === "นอกรอบ" ? passConfirm.payDate || undefined : undefined,
            row.sentMarkedDate)
          const needTerm = passConfirm.payType === "ตามรอบ" && !passConfirm.creditTerm
          return (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
              onClick={() => setPassConfirm(null)}>
              <div className="w-full max-w-sm space-y-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#161a23]"
                onClick={(e) => e.stopPropagation()}>
                <div className="font-bold" style={mitr}>✅ ยืนยันผ่าน · {row.depositCode}</div>
                <div className="text-xs text-gray-500">{row.supplier} · <span className={NUM}>{baht(row.amount)}</span> บาท</div>

                <div className="flex gap-2">
                  {AP_PAY_TYPES.map((t) => (
                    <button key={t} onClick={() => setPassConfirm((p) => p && { ...p, payType: t })}
                      className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${passConfirm.payType === t
                        ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
                      {t === "ตามรอบ" ? "📋 ตามรอบ" : "💸 นอกรอบ"}
                    </button>
                  ))}
                </div>
                {sent.type && sent.type !== passConfirm.payType && (
                  <div className="text-[11px] text-amber-600">จัดซื้อขอมาเป็น “{sent.type}” — ค่าที่ยืนยันตรงนี้คือตัวจริง</div>
                )}

                {/* นอกรอบ: เลือกวันพฤหัส — default พฤหัสหน้า · พฤหัสนี้โผล่เฉพาะตอนยังทัน (≤ อังคาร) */}
                {passConfirm.payType === "นอกรอบ" && thuChoices.options.length > 0 && (
                  <div className="space-y-1 text-xs">
                    <span className="text-gray-500">วันพฤหัสที่จะโอน</span>
                    <div className="flex flex-wrap gap-2">
                      {thuChoices.options.map((d) => (
                        <button key={d} onClick={() => setPassConfirm((p) => p && { ...p, payDate: d })}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition ${(passConfirm.payDate || thuChoices.def) === d
                            ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                            : "border-gray-200/80 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
                          {thaiDate(d)}{d === thuChoices.def ? " · พฤหัสหน้า" : " · พฤหัสนี้"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {passConfirm.payType === "ตามรอบ" && (
                  <label className="block space-y-1 text-xs">
                    <span className={needTerm ? "text-rose-600" : "text-gray-500"}>
                      เครดิตเทอม{needTerm ? " (จำเป็น — ยังไม่ตั้งใน master จะบันทึกให้เลย)" : ""}
                    </span>
                    <select value={passConfirm.creditTerm}
                      onChange={(e) => setPassConfirm((p) => p && { ...p, creditTerm: e.target.value })}
                      className={`w-full rounded-lg border bg-white px-2 py-1.5 text-sm dark:bg-white/5 ${needTerm ? "border-rose-400" : "border-gray-200/80 dark:border-white/10"}`}>
                      <option value="">— เลือกเครดิตเทอม —</option>
                      {CREDIT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                )}

                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-white/5">
                  {preview ? (
                    preview.type === "ตามรอบ" ? (
                      preview.cutoff ? (
                        <div className="space-y-0.5 text-xs">
                          <div>ครบกำหนด <b>{thaiDate(preview.dueDate)}</b></div>
                          <div>ตัดรอบ <b>{thaiDate(preview.cutoff)}</b></div>
                          <div className="text-emerald-700 dark:text-emerald-400">💰 จ่าย <b>{thaiDate(preview.payDate)}</b></div>
                        </div>
                      ) : (
                        // เครดิตสั้น 7D/15D — รอบพฤหัส นับจากวันส่งเอกสารเข้าบัญชี ไม่เดินสายตัดรอบ 25
                        <div className="text-xs text-emerald-700 dark:text-emerald-400">
                          💰 โอนพฤหัส <b>{thaiDate(preview.payDate)}</b>
                          <span className="text-gray-400"> (เครดิตสั้น — นับจากวันส่งเอกสารเข้าบัญชี)</span>
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-emerald-700 dark:text-emerald-400">💰 โอนพฤหัส <b>{thaiDate(preview.payDate)}</b></div>
                    )
                  ) : (
                    <div className="text-xs text-gray-400">เลือกเครดิตเทอมก่อน จึงจะคำนวณวันจ่ายได้</div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={() => setPassConfirm(null)}
                    className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                    ยกเลิก
                  </button>
                  <button disabled={!preview || saving}
                    onClick={() => save({ payType: passConfirm.payType, creditTerm: passConfirm.creditTerm, payDate: passConfirm.payDate || thuChoices.def })}
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
                    {saving ? "กำลังบันทึก…" : "ยืนยันผ่าน"}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {financeOpen && (
          <ApFinanceRequestDialog onClose={() => setFinanceOpen(false)}
            items={[{ depositCode: row.depositCode, supplier: row.supplier, amount: row.amount,
              purchaseOrder: row.purchaseOrder, docNos: nos }]} />
        )}

        {/* ปุ่มบันทึกติดล่างเสมอ — ไม่ว่าจะอยู่แท็บไหนหรือเลื่อนไปไหน กดบันทึกได้ทันที */}
        <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3 dark:border-white/10">
          <span className="text-xs text-amber-600">{dirty ? `ยังไม่ได้บันทึก ${dirtyCount} รายการ` : ""}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={resetAll} disabled={!dirty || saving}
              className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">
              คืนค่า
            </button>
            <button onClick={requestClose}
              className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
              ปิด
            </button>
            <button onClick={requestSave} disabled={!dirty || saving}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
