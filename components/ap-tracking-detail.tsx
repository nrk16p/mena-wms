"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X, Paperclip, CalendarClock } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, AP_FILES_MAX, apDocLabel, apFilesByDoc, apItemKeys,
  apStatusMeta, apStatusOf, docsNeedingFile, dueDateOf, isDocSetComplete, missingDocLabels,
  thaiDate, todayICT, upcomingThursdays,
  type ApDocKey, type ApDocs, type ApFile, type ApItems, type ApSentType, type ApStatus,
} from "@/lib/ap-tracking"
import type { SkuImage } from "@/lib/media"
import { ImageUpload } from "@/components/image-upload"
import type { ApRow } from "@/components/ap-tracking-page"

type DepositItem = { parts_group?: string; item?: string; serial_no?: string; qty?: string; unit_price?: string; total?: string; remark?: string }
type LogEntry = { action?: string; field?: string; detail?: string; by?: string; at?: string }
type Detail = {
  tracking: { log?: LogEntry[]; items?: ApItems; files?: ApFile[] } | null
  items: DepositItem[]
  po: Record<string, unknown> | null
}
type Draft = Record<ApDocKey, boolean>

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

const draftOf = (docs: ApDocs): Draft =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, Boolean(docs[f.key]?.checked)])) as Draft

// draft (แค่ true/false) → รูปร่าง ApDocs เพื่อส่งให้กติกาตัวเดียวกับที่เซิร์ฟเวอร์ใช้ตรวจครบชุด
// (by/at เป็นค่าว่างได้ ฟังก์ชันพวกนั้นดูแค่ .checked)
const docsOf = (d: Draft): ApDocs =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, { checked: d[f.key], by: "", at: "" }])) as ApDocs

// ประวัติ 1 บรรทัดอ้างถึงอะไร — ช่องเอกสาร (รวมช่องเก่าที่ถอดออกแล้ว), รายการสินค้า, หรือไม่มีหัวข้อ
function logSubject(field?: string): string {
  if (!field) return ""
  if (field.startsWith("item:")) return `รายการ ${field.slice(5)}`
  if (["sent", "note", "file"].includes(field)) return ""
  return apDocLabel(field)
}

// เทียบไฟล์แนบว่าต่างจากที่บันทึกไว้ไหม — ดูทั้งชุดและประเภทของแต่ละไฟล์
const filesKey = (files: ApFile[]) =>
  files.map((f) => `${f.webpUrl}|${f.docType ?? ""}`).sort().join("\n")

export function ApTrackingDetail({
  row, onClose, onSaved,
}: {
  row: ApRow
  onClose: () => void
  onSaved: (depositCode: string, patch: { docs: ApDocs; status: ApStatus; sentType: string; sentDate: string }) => void
}) {
  const [data, setData]       = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  // baseline = สิ่งที่บันทึกไว้จริงในฐานข้อมูล · draft = สิ่งที่ผู้ใช้กำลังแก้ค้างไว้
  // เก็บ baseline เป็น state ของตัวเอง ไม่อ่านจาก prop ตรง ๆ เพราะหลังบันทึกสำเร็จ ค่าใหม่ต้องกลายเป็น
  // ฐานเทียบทันทีโดยไม่ต้องรอ parent ส่ง row ใหม่ลงมา (ไม่งั้นปุ่มบันทึกค้างสถานะ "มีของยังไม่บันทึก")
  const [saved, setSaved]     = useState<ApDocs>(row.docs)
  const [draft, setDraft]     = useState<Draft>(() => draftOf(row.docs))
  const [savedItems, setSavedItems] = useState<ApItems>({})
  const [itemDraft, setItemDraft]   = useState<Record<string, boolean>>({})
  const [savedFiles, setSavedFiles] = useState<ApFile[]>([])
  const [files, setFiles]           = useState<ApFile[]>([])
  // รอบการวางบิล — baseline มาจากแถว (ตารางกับโมดัลใช้ค่าเดียวกัน) แล้วอัปเดตหลังบันทึกสำเร็จ
  const [savedSent, setSavedSent] = useState({ type: row.sentType as ApSentType, date: row.sentDate })
  const [sent, setSent]           = useState({ type: row.sentType as ApSentType, date: row.sentDate })
  // วันตั้งต้นของ "ตามรอบ" — ปกติคือวันที่ทำ DD แต่เลือกเองได้ (เช่น นับจากวันวางบิลจริง)
  // เก็บฝั่งหน้าเว็บอย่างเดียว ไม่บันทึกลงฐาน — สิ่งที่มีผลจริงคือวันครบกำหนดที่คำนวณออกมา
  const [baseDate, setBaseDate]   = useState(row.receivedAt)
  const [saving, setSaving]   = useState(false)

  const changed = useMemo(
    () => AP_DOC_FIELDS.map((f) => f.key).filter((k) => draft[k] !== Boolean(saved[k]?.checked)),
    [draft, saved],
  )
  const itemsChanged = useMemo(
    () => Object.keys(itemDraft).filter((k) => itemDraft[k] !== Boolean(savedItems[k]?.checked)),
    [itemDraft, savedItems],
  )
  const filesChanged = filesKey(files) !== filesKey(savedFiles)
  const sentChanged  = sent.type !== savedSent.type || sent.date !== savedSent.date
  const dirtyCount = changed.length + itemsChanged.length + (filesChanged ? 1 : 0) + (sentChanged ? 1 : 0)
  const dirty = dirtyCount > 0

  // กฎ "ติ๊กแล้วต้องมีไฟล์" — ตรวจเฉพาะช่องที่เพิ่งติ๊กในรอบนี้ (เหมือนฝั่งเซิร์ฟเวอร์เป๊ะ)
  // ใบเก่าที่ติ๊กไว้ตั้งแต่ก่อนมีระบบไฟล์แนบจึงยังแก้อย่างอื่นได้ ไม่ถูกบังคับย้อนหลัง
  const needFile = useMemo(
    () => docsNeedingFile(changed.filter((k) => draft[k]), files),
    [changed, draft, files],
  )

  const draftDocs   = useMemo(() => docsOf(draft), [draft])
  const draftStatus = apStatusOf(draftDocs, sent.date)
  // ตัวเลือก "นอกรอบ" = วันพฤหัสที่กำลังจะถึง 4 ตัว (+ วันที่ที่บันทึกไว้เดิม เผื่อเป็นพฤหัสที่ผ่านมาแล้ว)
  const thursdays = useMemo(() => {
    const list = upcomingThursdays(todayICT(), 4)
    return savedSent.type === "นอกรอบ" && savedSent.date && !list.includes(savedSent.date)
      ? [savedSent.date, ...list]
      : list
  }, [savedSent])
  const missing     = missingDocLabels(draftDocs)
  const fileCounts  = useMemo(() => apFilesByDoc(files), [files])

  // คีย์ของรายการสินค้า (เสถียรข้ามการ scrape ใหม่ — ดู apItemKeys)
  const depositItems = useMemo(() => data?.items ?? [], [data])
  const itemKeys     = useMemo(() => apItemKeys(depositItems), [depositItems])
  const itemsDone    = itemKeys.filter((k) => itemDraft[k]).length

  // ไม่ตั้ง loading=true ตรงนี้ — ค่าตั้งต้นเป็น true อยู่แล้วและ component เกิดใหม่ทุกใบ (key)
  const loadDetail = useCallback(async (code: string, alive: () => boolean) => {
    try {
      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(code)}`)
      const d   = await res.json()
      if (!alive() || !res.ok) return
      setData(d)
      const t: ApItems  = d?.tracking?.items ?? {}
      const fl: ApFile[] = Array.isArray(d?.tracking?.files) ? d.tracking.files : []
      setSavedItems(t)
      setItemDraft(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Boolean(v?.checked)])))
      setSavedFiles(fl)
      setFiles(fl)
    } finally { if (alive()) setLoading(false) }
  }, [])

  // fetch เมื่อเปิด — ธง alive กัน response ที่ตอบช้ามาทับ state หลังผู้ใช้ปิดโมดัลไปแล้ว
  // ไม่ต้องรีเซ็ต draft/baseline ตรงนี้: จุดเรียกใช้ใส่ key={depositCode} ให้ component เกิดใหม่ต่อใบ
  useEffect(() => {
    let ok = true
    loadDetail(row.depositCode, () => ok)
    return () => { ok = false }
  }, [row.depositCode, loadDetail])

  // ImageUpload คายรายการไฟล์ที่อัปโหลดเสร็จทุกครั้งที่ชุดเปลี่ยน (รวมตอน mount ที่ยังว่าง)
  // — ก่อนโหลดข้อมูลเสร็จต้องไม่รับ ไม่งั้นไฟล์ที่บันทึกไว้จะถูกล้างเป็น [] ตั้งแต่ยังไม่ทันเห็น
  const onUpload = useCallback((imgs: SkuImage[]) => {
    if (loading) return
    setFiles((prev) => {
      const typeByUrl = new Map(prev.map((f) => [f.webpUrl, f.docType]))
      return imgs.map((img) => ({ ...img, docType: typeByUrl.get(img.webpUrl) ?? "" }))
    })
  }, [loading])

  // มีของค้างแล้วจะปิด — ถามก่อนเสมอ (กดพื้นหลัง/กากบาท/ปุ่มปิด ใช้ทางเดียวกันหมด)
  const requestClose = async () => {
    if (!dirty) return onClose()
    const r = await swalConfirm("ปิดโดยไม่บันทึก?", `มีการแก้ไขที่ยังไม่ได้บันทึก ${dirtyCount} รายการ — ปิดแล้วจะหายไป`)
    if (r.isConfirmed) onClose()
  }

  const save = async () => {
    if (!dirty || saving) return
    if (needFile.length) {
      swalError(`ติ๊กแล้วต้องแนบไฟล์ของเอกสารนั้นด้วย — ยังไม่มีไฟล์: ${needFile.map(apDocLabel).join(", ")}`)
      return
    }
    // เลือกรอบไว้แต่ไม่มีวันที่ = เซิร์ฟเวอร์จะตีกลับ 400 อยู่ดี — บอกตรงนี้ให้รู้ว่าต้องเลือกวันไหน
    if (sent.type && !sent.date) {
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
      if (changed.length)      body.docs  = Object.fromEntries(changed.map((k) => [k, draft[k]]))
      if (itemsChanged.length) body.items = Object.fromEntries(itemsChanged.map((k) => [k, itemDraft[k]]))
      if (filesChanged)        body.files = files
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
      const sentOut = { type: (d.sentType ?? "") as ApSentType, date: String(d.sentDate ?? "") }
      setSaved(docsOut);      setDraft(draftOf(docsOut))
      setSavedItems(itemsOut); setItemDraft(Object.fromEntries(Object.entries(itemsOut).map(([k, v]) => [k, Boolean(v?.checked)])))
      setSavedFiles(filesOut); setFiles(filesOut)
      setSavedSent(sentOut);   setSent(sentOut)
      onSaved(row.depositCode, { docs: docsOut, status: d.status as ApStatus, sentType: sentOut.type, sentDate: sentOut.date })
      loadDetail(row.depositCode, () => true)   // ดึง log รอบใหม่มาแสดง
      swalToast("success", `บันทึกแล้ว ${dirtyCount} รายการ`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ""
      swalError(msg ? `บันทึกไม่สำเร็จ: ${msg}` : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  const meta = apStatusMeta(draftStatus)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161a23] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div>
            <div className="text-lg font-bold" style={mitr}>{row.depositCode}</div>
            <div className="text-sm text-gray-500">
              {row.supplier} · {row.warehouse} · รับของ {thaiDate(row.receivedAt)}
              {row.creditTerm && <> · เครดิต {row.creditTerm} · ครบกำหนด {thaiDate(row.dueDate)}</>}
            </div>
          </div>
          <button onClick={requestClose} className="ml-auto rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ใบสั่งซื้อ (PO)</h3>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {row.purchaseOrder
              ? <>{row.purchaseOrder} · ยอด PO {row.poTotal.toLocaleString("th-TH")} · กำหนดส่ง {thaiDate(row.poDue)} · {row.poStatus || "—"}</>
              : "ไม่มี PO ผูกกับใบนี้ในระบบ ATMS"}
          </div>
        </section>

        {/* รายการสินค้าในใบ DD + ติ๊กว่ารายการนั้นมีบิล/หลักฐานครบแล้ว */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold" style={mitr}>รายการสินค้า</h3>
            {depositItems.length > 0 && (
              <span className={`text-xs ${itemsDone === depositItems.length ? "text-green-700 dark:text-green-400" : "text-gray-500"}`}>
                หลักฐานครบ {itemsDone}/{depositItems.length} รายการ
              </span>
            )}
          </div>
          {loading ? <div className="text-sm text-gray-400">กำลังโหลด…</div> : (
            <div className="overflow-x-auto rounded-lg border dark:border-white/10">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left">รายการ</th>
                    <th className="px-2 py-1.5 text-right">จำนวน</th>
                    <th className="px-2 py-1.5 text-right">ราคา/หน่วย</th>
                    <th className="px-2 py-1.5 text-right">รวม</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap" title="ออกบิล/มีหลักฐานครบสำหรับรายการนี้">หลักฐาน</th>
                  </tr>
                </thead>
                <tbody>
                  {depositItems.map((it, i) => {
                    const k = itemKeys[i]
                    const mark = savedItems[k]
                    const on = Boolean(itemDraft[k])
                    return (
                      <tr key={k} className="border-t dark:border-white/10">
                        <td className="px-2 py-1.5">{it.item}</td>
                        <td className="px-2 py-1.5 text-right">{it.qty}</td>
                        <td className="px-2 py-1.5 text-right">{it.unit_price}</td>
                        <td className="px-2 py-1.5 text-right">{it.total}</td>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={on}
                            onChange={(e) => setItemDraft((d) => ({ ...d, [k]: e.target.checked }))}
                            title={mark?.checked && mark.by ? `ติ๊กโดย ${mark.by} ${thaiDate((mark.at || "").slice(0, 10))}` : undefined}
                            className={`w-4 h-4 accent-emerald-600 cursor-pointer ${on !== Boolean(mark?.checked) ? "ring-2 ring-amber-400 rounded" : ""}`} />
                        </td>
                      </tr>
                    )
                  })}
                  {depositItems.length === 0 && (
                    <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-400">ไม่มีรายการสินค้าในระบบ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ชุดเอกสาร — ติ๊กค้างไว้ได้หลายช่อง แล้วกดบันทึกทีเดียว (ตารางหน้าหลักเป็นแบบดูอย่างเดียว) */}
        <section className="rounded-xl border dark:border-white/10 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold" style={mitr}>ชุดเอกสาร</h3>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
              {meta.emoji} {meta.value}
            </span>
            {dirty && <span className="text-xs text-amber-600">● ยังไม่ได้บันทึก {dirtyCount} รายการ</span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {AP_DOC_FIELDS.map((f) => {
              const mark = saved[f.key]
              const n = fileCounts[f.key] ?? 0
              return (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                  <span className={draft[f.key] !== Boolean(mark?.checked) ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                    {f.label}
                  </span>
                  {n > 0 && <span className="text-[10px] text-blue-600 dark:text-blue-400" title={`มีไฟล์แนบ ${n} ไฟล์`}>📎{n}</span>}
                  {needFile.includes(f.key) && <span className="text-[10px] text-rose-600">ต้องแนบไฟล์</span>}
                  {mark?.checked && mark.by && (
                    <span className="text-[10px] text-gray-400" title={`${mark.by} · ${thaiDate((mark.at || "").slice(0, 10))}`}>
                      {mark.by.split(" ")[0]}
                    </span>
                  )}
                </label>
              )
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs">
              {needFile.length > 0
                ? <span className="text-rose-600">📎 ติ๊กแล้วต้องแนบไฟล์ด้วย — ยังไม่มีไฟล์: {needFile.map(apDocLabel).join(", ")}</span>
                : isDocSetComplete(draftDocs)
                  ? <span className="text-green-700 dark:text-green-400">✅ ครบชุด — ส่งบัญชีได้</span>
                  : <span className="text-gray-500">ยังขาด: {missing.join(", ")}</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setDraft(draftOf(saved)); setItemDraft(Object.fromEntries(Object.entries(savedItems).map(([k, v]) => [k, Boolean(v?.checked)]))); setFiles(savedFiles); setSent(savedSent) }}
                disabled={!dirty || saving}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-white/5">
                คืนค่า
              </button>
              <button onClick={save} disabled={!dirty || saving || needFile.length > 0}
                title={needFile.length > 0 ? `ต้องแนบไฟล์ก่อน: ${needFile.map(apDocLabel).join(", ")}` : undefined}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-emerald-700">
                {saving ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </section>

        {/* รอบการวางบิล — 2 แบบเท่านั้น
            ตามรอบ  = ครบกำหนดตามเครดิตเทอม นับจากวันที่ทำ DD (ค่าเดียวกับคอลัมน์ "ครบกำหนด")
            นอกรอบ  = โอนวันพฤหัส เลือกได้เฉพาะพฤหัสที่กำลังจะถึง (ไม่ให้พิมพ์วันอื่นเอง)
            ทั้งคู่บันทึกพร้อมปุ่ม "บันทึก" ด้านบน ไม่ save ทันทีที่กด — ผู้ใช้สั่งไว้ว่าต้องกดยืนยันเสมอ */}
        <section className="rounded-xl border dark:border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-bold" style={mitr}>รอบการวางบิล</h3>
            {savedSent.date
              ? <span className="text-xs text-green-700 dark:text-green-400">บันทึกไว้: {savedSent.type} {thaiDate(savedSent.date)}</span>
              : <span className="text-xs text-gray-400">ยังไม่ได้ส่งบัญชี</span>}
            {sentChanged && <span className="text-xs text-amber-600">● ยังไม่ได้บันทึก</span>}
          </div>

          <div className="space-y-1">
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="apSent" className="w-4 h-4 accent-emerald-600"
                checked={sent.type === "ตามรอบ"}
                onChange={() => setSent({
                  type: "ตามรอบ",
                  date: sent.type === "ตามรอบ" ? sent.date : (dueDateOf(baseDate, row.creditTerm) || row.dueDate || ""),
                })} />
              <span className="font-medium">📋 ตามรอบ</span>
              <span className="text-xs text-gray-500">
                {row.creditTerm
                  ? <>เครดิต {row.creditTerm} นับจากวันที่ทำ DD {thaiDate(row.receivedAt)}</>
                  : <span className="text-amber-700 dark:text-amber-400">ซัพพลายเออร์นี้ยังไม่ได้ตั้งเครดิตเทอม — ระบุวันครบกำหนดเอง</span>}
              </span>
            </label>

            {/* เลือกวันตั้งต้นเองได้ · แก้วันตั้งต้น = คำนวณวันครบกำหนดใหม่ให้ทันทีตามเครดิตเทอม
                แต่ยังพิมพ์ทับวันครบกำหนดเองได้ (เคสที่ตกลงกับเจ้าหนี้เป็นอย่างอื่น) */}
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
                  className="rounded-lg border px-2 py-1 bg-white dark:bg-white/5" />
                {baseDate !== row.receivedAt && (
                  <button onClick={() => {
                    setBaseDate(row.receivedAt)
                    const d = dueDateOf(row.receivedAt, row.creditTerm)
                    if (d) setSent({ type: "ตามรอบ", date: d })
                  }} className="text-blue-600 hover:underline">ใช้วันที่ทำ DD</button>
                )}
                <span className="text-gray-500">→ ครบกำหนด</span>
                <input type="date" value={sent.date} onChange={(e) => setSent({ type: "ตามรอบ", date: e.target.value })}
                  className="rounded-lg border px-2 py-1 bg-white dark:bg-white/5" />
                {sent.date && <span className="text-gray-400">({thaiDate(sent.date)})</span>}
              </div>
            )}
          </div>

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="radio" name="apSent" className="w-4 h-4 accent-emerald-600"
              checked={sent.type === "นอกรอบ"}
              onChange={() => setSent({ type: "นอกรอบ", date: sent.type === "นอกรอบ" ? sent.date : (thursdays[0] ?? "") })} />
            <span className="font-medium">💸 นอกรอบ</span>
            <span className="text-xs text-gray-500">โอนทุกวันพฤหัส</span>
            {sent.type === "นอกรอบ" && (
              <select value={sent.date} onChange={(e) => setSent({ type: "นอกรอบ", date: e.target.value })}
                className="rounded-lg border px-2 py-1 text-xs bg-white dark:bg-white/5">
                {thursdays.map((d, i) => (
                  <option key={d} value={d}>{thaiDate(d)}{i === 0 ? " (พฤหัสนี้)" : i === 1 ? " (พฤหัสหน้า)" : ""}</option>
                ))}
              </select>
            )}
          </label>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            {!isDocSetComplete(draftDocs) && sent.type && (
              <span className="text-rose-600">ส่งบัญชีไม่ได้จนกว่าเอกสารจะครบชุด — ยังขาด: {missing.join(", ")}</span>
            )}
            {sent.date && (
              <button onClick={() => setSent({ type: "", date: "" })} className="ml-auto text-rose-600 hover:underline">
                ยกเลิกการส่งบัญชี
              </button>
            )}
          </div>
        </section>

        {/* ไฟล์แนบ — เลือกประเภทเอกสารต่อไฟล์ · แนบประเภทไหนใหม่ ระบบติ๊กช่องนั้นให้อัตโนมัติ */}
        <section className="rounded-xl border dark:border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-bold" style={mitr}>ไฟล์แนบ</h3>
            <span className="text-xs text-gray-500">{files.length}/{AP_FILES_MAX} ไฟล์ · รูปหรือ PDF</span>
          </div>

          {/* key พลิกตอนโหลดเสร็จ → uploader เกิดใหม่พร้อมไฟล์ที่บันทึกไว้เป็นค่าตั้งต้น */}
          <ImageUpload key={loading ? "up-loading" : "up-ready"} initial={savedFiles} onChange={onUpload} max={AP_FILES_MAX} />

          {files.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-gray-500">เลือกประเภทเอกสารของแต่ละไฟล์</div>
              {files.map((f) => (
                <div key={f.webpUrl} className="flex items-center gap-2 text-xs">
                  <a href={f.webpUrl} target="_blank" rel="noreferrer"
                    className="flex-1 truncate text-blue-600 hover:underline" title={f.filename}>{f.filename}</a>
                  <select value={f.docType ?? ""}
                    onChange={(e) => setFiles((prev) => prev.map((x) =>
                      x.webpUrl === f.webpUrl ? { ...x, docType: e.target.value as ApDocKey | "" } : x))}
                    className={`rounded-lg border px-2 py-1 bg-white dark:bg-white/5 ${f.docType ? "" : "border-amber-400 text-amber-700 dark:text-amber-400"}`}>
                    <option value="">— เลือกประเภทเอกสาร —</option>
                    {AP_DOC_FIELDS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ประวัติการติ๊ก/แก้ไข</h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {(data?.tracking?.log ?? []).slice().reverse().map((l, i) => (
              <li key={i}>
                {thaiDate((l.at ?? "").slice(0, 10))} · {l.action} {logSubject(l.field)} {l.detail ?? ""} · โดย {l.by || "—"}
              </li>
            ))}
            {!loading && (data?.tracking?.log ?? []).length === 0 && <li className="text-gray-400">ยังไม่มีประวัติ</li>}
          </ul>
        </section>

        <div className="flex justify-end">
          <button onClick={requestClose} className="rounded-lg border px-4 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">ปิด</button>
        </div>
      </div>
    </div>
  )
}
