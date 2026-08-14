"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  AP_DOC_FIELDS, apStatusMeta, apStatusOf, isDocSetComplete, missingDocLabels, thaiDate,
  type ApDocKey, type ApDocs, type ApStatus,
} from "@/lib/ap-tracking"
import type { ApRow } from "@/components/ap-tracking-page"

type DepositItem = { parts_group?: string; item?: string; serial_no?: string; qty?: string; unit_price?: string; total?: string; remark?: string }
type LogEntry = { action?: string; field?: string; detail?: string; by?: string; at?: string }
type Detail = {
  tracking: { log?: LogEntry[] } | null
  items: DepositItem[]
  po: Record<string, unknown> | null
}
type Draft = Record<ApDocKey, boolean>

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }
const labelOf = (k: string) => AP_DOC_FIELDS.find((f) => f.key === k)?.label ?? k

const draftOf = (docs: ApDocs): Draft =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, Boolean(docs[f.key]?.checked)])) as Draft

// draft (แค่ true/false) → รูปร่าง ApDocs เพื่อส่งให้กติกาตัวเดียวกับที่เซิร์ฟเวอร์ใช้ตรวจครบชุด
// (by/at เป็นค่าว่างได้ ฟังก์ชันพวกนั้นดูแค่ .checked)
const docsOf = (d: Draft): ApDocs =>
  Object.fromEntries(AP_DOC_FIELDS.map((f) => [f.key, { checked: d[f.key], by: "", at: "" }])) as ApDocs

export function ApTrackingDetail({
  row, onClose, onSaved,
}: {
  row: ApRow
  onClose: () => void
  onSaved: (depositCode: string, docs: ApDocs, status: ApStatus) => void
}) {
  const [data, setData]       = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  // baseline = สิ่งที่บันทึกไว้จริงในฐานข้อมูล · draft = สิ่งที่ผู้ใช้กำลังติ๊กค้างไว้
  // เก็บ baseline เป็น state ของตัวเอง ไม่อ่านจาก prop ตรง ๆ เพราะหลังบันทึกสำเร็จ ค่าใหม่ต้องกลายเป็น
  // ฐานเทียบทันทีโดยไม่ต้องรอ parent ส่ง row ใหม่ลงมา (ไม่งั้นปุ่มบันทึกค้างสถานะ "มีของยังไม่บันทึก")
  const [saved, setSaved]     = useState<ApDocs>(row.docs)
  const [draft, setDraft]     = useState<Draft>(() => draftOf(row.docs))
  const [saving, setSaving]   = useState(false)

  const changed = useMemo(
    () => AP_DOC_FIELDS.map((f) => f.key).filter((k) => draft[k] !== Boolean(saved[k]?.checked)),
    [draft, saved],
  )
  const dirty = changed.length > 0

  const draftDocs   = useMemo(() => docsOf(draft), [draft])
  const draftStatus = apStatusOf(draftDocs, row.sentDate)
  const missing     = missingDocLabels(draftDocs)

  // ไม่ตั้ง loading=true ตรงนี้ — ค่าตั้งต้นเป็น true อยู่แล้วและ component เกิดใหม่ทุกใบ (key)
  // การ setState ตอนเริ่ม effect ทำให้ render ซ้อนโดยเปล่าประโยชน์ · เรียกซ้ำหลังบันทึกก็แค่รีเฟรช log เงียบ ๆ
  const loadDetail = useCallback(async (code: string, alive: () => boolean) => {
    try {
      const res = await fetch(`/api/ap-tracking/${encodeURIComponent(code)}`)
      const d   = await res.json()
      if (alive() && res.ok) setData(d)
    } finally { if (alive()) setLoading(false) }
  }, [])

  // fetch เมื่อเปิด — ธง alive กัน response ที่ตอบช้ามาทับ state หลังผู้ใช้ปิดโมดัลไปแล้ว
  // ไม่ต้องรีเซ็ต draft/baseline ตรงนี้: จุดเรียกใช้ใส่ key={depositCode} ให้ component เกิดใหม่ต่อใบ
  // (state ตั้งต้นจาก useState เท่านั้น — setState ใน effect ทำให้ render ซ้อนโดยไม่จำเป็น)
  useEffect(() => {
    let ok = true
    loadDetail(row.depositCode, () => ok)
    return () => { ok = false }
  }, [row.depositCode, loadDetail])

  // มีของติ๊กค้างแล้วจะปิด — ถามก่อนเสมอ (กดพื้นหลัง/กากบาท/ปุ่มปิด ใช้ทางเดียวกันหมด)
  const requestClose = async () => {
    if (!dirty) return onClose()
    const r = await swalConfirm("ปิดโดยไม่บันทึก?", `มีการติ๊กที่ยังไม่ได้บันทึก ${changed.length} ช่อง — ปิดแล้วจะหายไป`)
    if (r.isConfirmed) onClose()
  }

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      // ส่งเฉพาะช่องที่เปลี่ยนจริงในคำขอเดียว — เซิร์ฟเวอร์เขียนแบบ dotted path ต่อช่อง
      // จึงไม่ทับการติ๊กช่องอื่นที่คนอื่นเพิ่งบันทึกระหว่างที่เราเปิดโมดัลค้างไว้
      const body = Object.fromEntries(changed.map((k) => [k, draft[k]]))
      const res  = await fetch(`/api/ap-tracking/${encodeURIComponent(row.depositCode)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs: body }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      // ยึดผลจากเซิร์ฟเวอร์เป็นความจริง (มี by/at ของคนติ๊กจริง) ทั้ง baseline และ draft
      setSaved(d.docs as ApDocs)
      setDraft(draftOf(d.docs as ApDocs))
      onSaved(row.depositCode, d.docs as ApDocs, d.status as ApStatus)
      loadDetail(row.depositCode, () => true)   // ดึง log รอบใหม่มาแสดง
      swalToast("success", `บันทึกแล้ว ${changed.length} ช่อง`)
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

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>รายการสินค้า</h3>
          {loading ? <div className="text-sm text-gray-400">กำลังโหลด…</div> : (
            <div className="overflow-x-auto rounded-lg border dark:border-white/10">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-2 py-1.5 text-left">รายการ</th>
                    <th className="px-2 py-1.5 text-right">จำนวน</th>
                    <th className="px-2 py-1.5 text-right">ราคา/หน่วย</th>
                    <th className="px-2 py-1.5 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((it, i) => (
                    <tr key={i} className="border-t dark:border-white/10">
                      <td className="px-2 py-1.5">{it.item}</td>
                      <td className="px-2 py-1.5 text-right">{it.qty}</td>
                      <td className="px-2 py-1.5 text-right">{it.unit_price}</td>
                      <td className="px-2 py-1.5 text-right">{it.total}</td>
                    </tr>
                  ))}
                  {(data?.items ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-4 text-center text-gray-400">ไม่มีรายการสินค้าในระบบ</td></tr>
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
            {dirty && <span className="text-xs text-amber-600">● ยังไม่ได้บันทึก {changed.length} ช่อง</span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {AP_DOC_FIELDS.map((f) => {
              const mark = saved[f.key]
              return (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                  <span className={draft[f.key] !== Boolean(mark?.checked) ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                    {f.label}
                  </span>
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
              {isDocSetComplete(draftDocs)
                ? <span className="text-green-700 dark:text-green-400">✅ ครบชุด — ส่งบัญชีได้</span>
                : <span className="text-gray-500">ยังขาด: {missing.join(", ")}</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setDraft(draftOf(saved))} disabled={!dirty || saving}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-white/5">
                คืนค่า
              </button>
              <button onClick={save} disabled={!dirty || saving}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-emerald-700">
                {saving ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold mb-1" style={mitr}>ประวัติการติ๊ก/แก้ไข</h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {(data?.tracking?.log ?? []).slice().reverse().map((l, i) => (
              <li key={i}>
                {thaiDate((l.at ?? "").slice(0, 10))} · {l.action} {l.field && l.field !== "sent" && l.field !== "note" ? labelOf(l.field) : ""} {l.detail ?? ""} · โดย {l.by || "—"}
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
