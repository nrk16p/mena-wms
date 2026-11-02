"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Trash2, Loader2 } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import type { SwWorkType } from "@/lib/store-withdraw/types"
import { WORK_TYPE_KIND, WORK_TYPE_LABEL } from "@/lib/store-withdraw/core"
import { SkuPicker, type SkuHit } from "./sku-picker"
import { MrPicker, type MrItem } from "./mr-picker"
import { OptionCombobox } from "./option-combobox"
import { DocRefPicker } from "./doc-ref-picker"
import { DocLinesPanel } from "./doc-lines-panel"
import { DOC_LABEL, type DocHit, type DocKind, type ImportLine } from "./doc-ref-types"

type Opt = { id: number; name: string }
type FormLine = { skuId: number; skuCode: string; skuName: string; qty: string; stockQty: number | null; mrItemId: number | null; mrItemLabel: string | null; remark: string; fromDoc?: boolean }

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const labelCls = "mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
const LATKRABANG = 4

export function RequestForm() {
  const router = useRouter()
  const [workType, setWorkType] = useState<SwWorkType>("garage_in")
  const kind = WORK_TYPE_KIND[workType]
  const [invs, setInvs] = useState<Opt[]>([])
  const [picks, setPicks] = useState<Opt[]>([])
  const [optErr, setOptErr] = useState("")
  const [inventoryId, setInventoryId] = useState<number | "">("")
  const [pickToId, setPickToId] = useState<number | "">("")
  const [plate, setPlate] = useState("")
  const [mrCode, setMrCode] = useState("")
  const [mrItems, setMrItems] = useState<MrItem[]>([])
  const [urgent, setUrgent] = useState(false)
  const [remark, setRemark] = useState("")
  const [lines, setLines] = useState<FormLine[]>([])
  const [docKind, setDocKind] = useState<DocKind>("pr")
  const [doc, setDoc] = useState<DocHit | null>(null)
  const [docPanel, setDocPanel] = useState(false)
  const [docMsg, setDocMsg] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const ctl = new AbortController()
    fetch("/api/store-withdraw/options", { signal: ctl.signal })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "โหลดรายการคลังไม่สำเร็จ"); return j })
      .then((j: { inventories: Opt[]; pickTos: Opt[] }) => {
        setInvs(j.inventories); setPicks(j.pickTos)
        setInventoryId(j.inventories.find((o) => o.id === LATKRABANG)?.id ?? j.inventories[0]?.id ?? "")
      })
      .catch((e) => { if (!ctl.signal.aborted) setOptErr(e instanceof Error ? e.message : "โหลดรายการคลังไม่สำเร็จ") })
    return () => ctl.abort()
  }, [])

  const addSku = useCallback((s: SkuHit) => {
    setLines((cur) => {
      if (cur.some((l) => l.skuId === s.skuId)) return cur.map((l) => (l.skuId === s.skuId ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
      return [...cur, { skuId: s.skuId, skuCode: s.skuCode, skuName: s.skuName, qty: "1", stockQty: s.stockQty, mrItemId: mrItems.length === 1 ? mrItems[0].id : null, mrItemLabel: mrItems.length === 1 ? mrItems[0].label : null, remark: "" }]
    })
  }, [mrItems])

  // เปลี่ยน/ล้างใบอ้างอิง หรือเปลี่ยนคลัง → ทิ้งรายการที่นำเข้าจากใบ เหลือเฉพาะที่พิมพ์เอง
  const dropFromDoc = () => setLines((c) => c.filter((l) => !l.fromDoc))
  const pickDoc = (d: DocHit) => { dropFromDoc(); setDoc(d); setDocPanel(true); setDocMsg("") }
  const clearDoc = () => { dropFromDoc(); setDoc(null); setDocPanel(false); setDocMsg("") }
  const changeKind = (k: DocKind) => { clearDoc(); setDocKind(k) }

  // นำเข้าจากแผงรายการ: SKU เดียวกับที่มีอยู่แล้ว = บวกจำนวนเพิ่ม · ที่ใหม่ติดแท็ก fromDoc
  const importLines = (got: ImportLine[]) => {
    setLines((cur) => {
      const next = cur.map((l) => ({ ...l }))
      for (const g of got) {
        const at = next.findIndex((l) => l.skuId === g.skuId)
        if (at >= 0) next[at].qty = String((Number(next[at].qty) || 0) + g.qty)
        else next.push({ skuId: g.skuId, skuCode: g.skuCode, skuName: g.skuName, qty: String(g.qty), stockQty: g.stockQty, mrItemId: mrItems.length === 1 ? mrItems[0].id : null, mrItemLabel: mrItems.length === 1 ? mrItems[0].label : null, remark: "", fromDoc: true })
      }
      return next
    })
    setDocPanel(false)
    setDocMsg(`นำเข้า ${got.length} รายการแล้ว อยู่ในรายการอะไหล่ด้านล่าง แก้จำนวนหรือลบได้`)
  }

  const patch = (i: number, p: Partial<FormLine>) => setLines((cur) => cur.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const setMrItem = (i: number, id: string) => {
    const it = mrItems.find((m) => String(m.id) === id)
    patch(i, { mrItemId: it?.id ?? null, mrItemLabel: it?.label ?? null })
  }
  const applyAllMr = (id: string) => {
    const it = mrItems.find((m) => String(m.id) === id)
    setLines((cur) => cur.map((l) => ({ ...l, mrItemId: it?.id ?? null, mrItemLabel: it?.label ?? null })))
  }

  const submit = async () => {
    if (!plate.trim()) return swalError("ใส่ทะเบียนรถ/เบอร์รถก่อนยื่นคำขอ")
    if (workType === "garage_in" && !mrCode) return swalError("งานอู่ในต้องเลือกใบแจ้งซ่อม (MR) ก่อน")
    if (!inventoryId || !pickToId) return swalError("เลือกคลังกับจุดประสงค์ให้ครบ")
    if (lines.length === 0) return swalError("เพิ่มอะไหล่อย่างน้อย 1 รายการ")
    if (lines.some((l) => !(Number(l.qty) > 0))) return swalError("จำนวนที่ขอต้องมากกว่า 0 ทุกรายการ")
    setBusy(true)
    try {
      const r = await fetch("/api/store-withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workType, kind, inventoryId, pickToId, plate: plate.trim(), mrCode: mrCode || undefined, ref: doc ? { type: doc.kind, code: doc.code, id: doc.id } : undefined, urgent, remark: remark.trim(),
          lines: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, requestedQty: Number(l.qty), mrItemId: l.mrItemId ?? undefined, mrItemLabel: l.mrItemLabel ?? undefined, remark: l.remark.trim() })),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "ยื่นคำขอไม่สำเร็จ ลองใหม่อีกครั้ง")
      await swalToast("success", "ยื่นคำขอแล้ว รอสโตร์รับงาน")
      router.push("/store-withdraw")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ยื่นคำขอไม่สำเร็จ ลองใหม่อีกครั้ง")
      setBusy(false)
    }
  }

  const workBtn = (w: SwWorkType, hint: string) => (
    <button type="button" key={w} onClick={() => setWorkType(w)} aria-pressed={workType === w} data-testid={`wt-${w}`}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition ${workType === w ? "border-[#1B8C4B] bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10"}`}>
      <span className="block text-sm font-medium text-gray-900 dark:text-white">{WORK_TYPE_LABEL[w]}</span>
      <span className="block text-[11px] text-gray-500">{hint}</span>
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <Link href="/store-withdraw" className="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#1B8C4B]"><ArrowLeft size={14} />กลับไปรายการของฉัน</Link>
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ขอเบิกอะไหล่</h1>
      </div>

      {optErr && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{optErr}</p>}

      <section className="space-y-4 rounded-2xl border border-[#EEF2F0] bg-white p-4 dark:border-white/10 dark:bg-[#161922]">
        <div>
          <span className={labelCls}>ประเภทงาน</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            {workBtn("garage_in", "ซ่อมในอู่ เบิกจากสต๊อก ต้องมี MR")}
            {workBtn("garage_out", "ซื้อมาใช้เลย ตัดยอดตามใบรับของ")}
            {workBtn("mobile_pm", "ช่างออกหน้างาน เบิกจากสต๊อก")}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="sw-inv">คลัง</label>
            <OptionCombobox id="sw-inv" options={invs} value={inventoryId} placeholder="เลือกคลัง" searchPlaceholder="พิมพ์ชื่อคลัง"
              onChange={(v) => { setInventoryId(v); dropFromDoc(); setDocMsg(""); if (doc) setDocPanel(true) }} />
          </div>
          <div>
            <label className={labelCls} htmlFor="sw-pick">จุดประสงค์</label>
            <OptionCombobox id="sw-pick" options={picks} value={pickToId} placeholder="เลือกจุดประสงค์" searchPlaceholder="พิมพ์ เช่น CM, ซ่อม, อุบัติเหตุ" clearable
              onChange={setPickToId} />
          </div>
          <div>
            <label className={labelCls} htmlFor="sw-plate">ทะเบียนรถ/เบอร์รถ</label>
            <input id="sw-plate" className={inputCls} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="เช่น 71-1234 หรือ เบอร์ 1234" />
          </div>
          <div>
            <span className={labelCls}>ใบแจ้งซ่อม (MR){workType === "garage_in" && <span className="text-red-600"> *ต้องเลือก</span>}</span>
            {workType === "garage_in" && <p className="mb-1 text-xs text-gray-500">เลือก MR ของรถคันนี้</p>}
            <MrPicker
              mrCode={mrCode}
              plate={plate}
              onPick={(code, items) => { setMrCode(code); setMrItems(items); if (items.length === 1) setLines((c) => c.map((l) => ({ ...l, mrItemId: l.mrItemId ?? items[0].id, mrItemLabel: l.mrItemLabel ?? items[0].label }))) }}
              onClear={() => { setMrCode(""); setMrItems([]) }}
            />
          </div>
        </div>

        <div>
          <span className={labelCls}>อ้างอิงใบ PR / PO / DD (ไม่บังคับ)</span>
          <DocRefPicker plate={plate} inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} kind={docKind} onKind={changeKind}
            picked={doc} onPick={pickDoc} onClear={clearDoc} panelOpen={docPanel} onTogglePanel={() => setDocPanel((v) => !v)} />
          {doc && !docPanel && docMsg && <p data-testid="docref-msg" className="mt-2 rounded-xl bg-[#1B8C4B]/10 px-3 py-2 text-xs text-[#14532d] dark:text-emerald-300">{docMsg}</p>}
          {doc && docPanel && (
            <div className="mt-2">
              <DocLinesPanel doc={doc} inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} onImport={importLines} />
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[#1B8C4B]" />
          รถจอดรออะไหล่
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#EEF2F0] bg-white p-4 dark:border-white/10 dark:bg-[#161922]">
        <h2 className="text-sm font-semibold text-[#14271C] dark:text-white">รายการอะไหล่</h2>
        <SkuPicker inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} onPick={addSku} />

        {mrItems.length > 1 && lines.length > 0 && (
          <div>
            <label className={labelCls}>ผูกทุกรายการกับรายการใน MR</label>
            <select className={inputCls} defaultValue="" onChange={(e) => applyAllMr(e.target.value)}>
              <option value="">ไม่ผูก / เลือกรายบรรทัด</option>
              {mrItems.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-6 text-center text-sm text-gray-500 dark:border-white/10">ยังไม่มีรายการ ค้นอะไหล่ด้านบนแล้วกดเลือก</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={l.skuId} className="rounded-xl border border-[#EEF2F0] p-3 dark:border-white/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{l.skuName}</p>
                    <p className="text-xs text-gray-500">{l.skuCode}{l.stockQty != null && ` · คงเหลือ ${l.stockQty.toLocaleString("th-TH")}`}{l.fromDoc && doc && ` · จาก ${DOC_LABEL[doc.kind]} ${doc.code}`}</p>
                  </div>
                  <button type="button" aria-label="ลบรายการ" onClick={() => setLines((c) => c.filter((_, k) => k !== i))} className="shrink-0 p-1 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
                <div className="mt-2 grid grid-cols-[88px_1fr] gap-2">
                  <input aria-label="จำนวน" inputMode="decimal" className={inputCls} value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} />
                  <input aria-label="หมายเหตุรายการ" className={inputCls} placeholder="หมายเหตุ (ไม่ใส่ก็ได้)" value={l.remark} onChange={(e) => patch(i, { remark: e.target.value })} />
                </div>
                {mrItems.length > 0 && (
                  <select aria-label="รายการใน MR" className={`${inputCls} mt-2`} value={l.mrItemId ?? ""} onChange={(e) => setMrItem(i, e.target.value)}>
                    <option value="">ไม่ผูกรายการใน MR</option>
                    {mrItems.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
                {l.stockQty != null && Number(l.qty) > l.stockQty && kind === "stock" && (
                  <p className="mt-1.5 text-xs text-amber-600">ขอเกินของที่มีในคลัง สโตร์อาจจัดให้ไม่ครบ</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div>
          <label className={labelCls} htmlFor="sw-remark">หมายเหตุ</label>
          <textarea id="sw-remark" rows={2} className={inputCls} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Link href="/store-withdraw" className="rounded-xl border border-[#E2E8E4] px-4 py-2.5 text-sm text-gray-700 dark:border-white/10 dark:text-gray-300">ยกเลิก</Link>
        <button type="button" disabled={busy} onClick={submit}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1B8C4B] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-60">
          {busy && <Loader2 size={15} className="animate-spin" />}ยื่นคำขอ
        </button>
      </div>
    </div>
  )
}
