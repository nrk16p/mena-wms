"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
// "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041" → "อู่ใน-CM-ระบบไฟ" (ตัดเลข MR หน้า กับ id ท้าย)
const mrItemName = (label: string) => label.replace(/^\S*MR\S*\d\s+/i, "").replace(/\s*:\s*\d+$/, "")

export function RequestForm() {
  const router = useRouter()
  const [workType, setWorkType] = useState<SwWorkType>("garage_in")
  const needMr = workType !== "mobile_pm"   // อู่ใน/อู่นอก: ใบเบิกต้องละเอียดถึง MR + ประเภทการซ่อม
  const kind = WORK_TYPE_KIND[workType]
  const [invs, setInvs] = useState<Opt[]>([])
  const [picks, setPicks] = useState<Opt[]>([])
  const [optErr, setOptErr] = useState("")
  const [inventoryId, setInventoryId] = useState<number | "">("")
  const [pickToId, setPickToId] = useState<number | "">("")
  const [plate, setPlate] = useState("")
  const [mrCode, setMrCode] = useState("")
  const [mrItems, setMrItems] = useState<MrItem[]>([])
  const [mrSelIds, setMrSelIds] = useState<number[]>([])   // ประเภทการซ่อมที่เลือก (รายการใน MR) · 1 ใบเบิก = 1 MR แต่เลือกได้หลายประเภท
  const chosen = useMemo(() => mrItems.filter((m) => mrSelIds.includes(m.id)), [mrItems, mrSelIds])
  const mrSel = useMemo(() => (chosen.length === 1 ? chosen[0] : null), [chosen])     // เลือกประเภทเดียว = เป็นค่าตั้งต้นของทุกบรรทัด
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
      return [...cur, { skuId: s.skuId, skuCode: s.skuCode, skuName: s.skuName, qty: "1", stockQty: s.stockQty, mrItemId: mrSel?.id ?? null, mrItemLabel: mrSel?.label ?? null, remark: "" }]
    })
  }, [mrSel])

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
        else next.push({ skuId: g.skuId, skuCode: g.skuCode, skuName: g.skuName, qty: String(g.qty), stockQty: g.stockQty, mrItemId: mrSel?.id ?? null, mrItemLabel: mrSel?.label ?? null, remark: "", fromDoc: true })
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
  // ติ๊ก/เอาออกประเภทการซ่อม → เหลือประเภทเดียว = ลงทุกบรรทัด · หลายประเภท = บรรทัดที่ประเภทถูกเอาออกต้องเลือกใหม่
  const toggleType = (id: number) => {
    const ids = mrSelIds.includes(id) ? mrSelIds.filter((x) => x !== id) : [...mrSelIds, id]
    const sel = mrItems.filter((m) => ids.includes(m.id))
    setMrSelIds(ids)
    setLines((cur) => cur.map((l) => {
      if (sel.length === 1) return { ...l, mrItemId: sel[0].id, mrItemLabel: sel[0].label }
      return l.mrItemId && ids.includes(l.mrItemId) ? l : { ...l, mrItemId: null, mrItemLabel: null }
    }))
  }

  const submit = async () => {
    if (!plate.trim()) return swalError("ใส่ทะเบียนรถ/เบอร์รถก่อนยื่นคำขอ")
    if (needMr && !mrCode) return swalError(`งาน${WORK_TYPE_LABEL[workType]}ต้องเลือกใบแจ้งซ่อม (MR) ก่อน`)
    if (needMr && mrItems.length === 0) return swalError("เลือก MR จากรายการที่ค้นเจอ เพื่อเลือกประเภทการซ่อมได้")
    if (mrItems.length > 0 && chosen.length === 0) return swalError("เลือกประเภทการซ่อมของ MR ด้วย")
    if (!inventoryId || !pickToId) return swalError("เลือกคลังกับจุดประสงค์ให้ครบ")
    if (lines.length === 0) return swalError("เพิ่มอะไหล่อย่างน้อย 1 รายการ")
    if ((needMr || chosen.length > 0) && lines.some((l) => !l.mrItemId)) return swalError("ทุกรายการอะไหล่ต้องระบุว่าใช้กับประเภทการซ่อมไหน")
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
            {workBtn("garage_out", "ซื้อมาใช้เลย ต้องมี MR ตัดยอดตามใบรับของ")}
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
            <span className={labelCls}>ใบแจ้งซ่อม (MR){needMr && <span className="text-red-600"> *ต้องเลือก</span>}</span>
            {needMr && <p className="mb-1 text-xs text-gray-500">เลือก MR ของรถคันนี้ แล้วเลือกประเภทการซ่อม</p>}
            <MrPicker
              mrCode={mrCode}
              plate={plate}
              onPick={(code, items) => { setMrCode(code); setMrItems(items); const one = items.length === 1 ? items[0] : null; setMrSelIds(one ? [one.id] : []); setLines((c) => c.map((l) => ({ ...l, mrItemId: one?.id ?? null, mrItemLabel: one?.label ?? null }))) }}
              onClear={() => { setMrCode(""); setMrItems([]); setMrSelIds([]); setLines((c) => c.map((l) => ({ ...l, mrItemId: null, mrItemLabel: null }))) }}
            />
            {mrItems.length > 0 && (
              <div className="mt-2">
                <span className={labelCls}>ประเภทการซ่อม<span className="text-red-600"> *ต้องเลือก</span> <span className="font-normal text-gray-400">(1 ใบเบิกอ้าง MR เดียว เลือกได้หลายประเภท)</span></span>
                <div className="space-y-1.5" role="group" aria-label="ประเภทการซ่อม">
                  {mrItems.map((m) => (
                    <label key={m.id} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${mrSelIds.includes(m.id) ? "border-[#1B8C4B] bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10"}`}>
                      <input type="checkbox" checked={mrSelIds.includes(m.id)} onChange={() => toggleType(m.id)} className="h-4 w-4 accent-[#1B8C4B]" />
                      <span className="min-w-0 break-words text-gray-900 dark:text-white">{mrItemName(m.label)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
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
                {chosen.length > 1 && (
                  <select aria-label="รายการใน MR" className={`${inputCls} mt-2`} value={l.mrItemId ?? ""} onChange={(e) => setMrItem(i, e.target.value)}>
                    <option value="" disabled>เลือกประเภทการซ่อม</option>
                    {chosen.map((m) => <option key={m.id} value={m.id}>{mrItemName(m.label)}</option>)}
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
