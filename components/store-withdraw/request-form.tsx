"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ChevronRight, Trash2, Loader2 } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import type { SwWorkType } from "@/lib/store-withdraw/types"
import { WORK_TYPE_KIND, WORK_TYPE_LABEL } from "@/lib/store-withdraw/core"
import { DUE_MAX_DAYS } from "@/lib/store-withdraw/pending"
import { SkuPicker, type SkuHit } from "./sku-picker"
import { MrPicker, type MrItem } from "./mr-picker"
import { OptionCombobox } from "./option-combobox"
import { DuePicker, dueError } from "./due-picker"
import { DocRefPicker } from "./doc-ref-picker"
import { DocLinesPanel } from "./doc-lines-panel"
import { DOC_LABEL, type DocHit, type DocKind, type ImportLine } from "./doc-ref-types"

type Opt = { id: number; name: string }
type FormLine = { skuId: number; skuCode: string; skuName: string; qty: string; stockQty: number | null; mrItemId: number | null; mrItemLabel: string | null; remark: string; fromDoc?: boolean }

const inputCls =
  "w-full rounded-md border border-[#D5DCD8] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const labelCls = "mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300"
const LATKRABANG = 4
// "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041" → "อู่ใน-CM-ระบบไฟ" (ตัดเลข MR หน้า กับ id ท้าย)
const mrItemName = (label: string) => label.replace(/^\S*MR\S*\d\s+/i, "").replace(/\s*:\s*\d+$/, "")

/**
 * ฟอร์มยื่นคำขอเบิก · หน้าเต็ม (/store-withdraw/new) หรือฝังใน Dialog (onDone/onCancel)
 * — โหมด Dialog: ไม่มีหัวข้อ/ลิงก์กลับ · ยื่นสำเร็จเรียก onDone แทนการเปลี่ยนหน้า
 */
export function RequestForm({ onDone, onCancel, backHref = "/store-withdraw" }: { onDone?: () => void; onCancel?: () => void; backHref?: string } = {}) {
  const router = useRouter()
  const embedded = !!onDone
  const [workType, setWorkType] = useState<SwWorkType>("garage_in")
  const needMr = workType !== "mobile_pm"   // อู่ใน/อู่นอก: ใบเบิกต้องละเอียดถึง MR + ประเภทการซ่อม
  const pendingFlow = workType === "mobile_pm" // Mobile/PM: ทะเบียน/MR ไปใส่ตอนสรุปการใช้ · ต้องมีกำหนดสรุปยอด
  const [due, setDue] = useState("")
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
  const mrSel = useMemo(() => (chosen.length === 1 ? chosen[0] : null), [chosen]) 
  const [targetId, setTargetId] = useState<number | null>(null)   // หลายประเภท: อะไหล่ที่เพิ่ม/นำเข้าใหม่จะลงกลุ่มนี้
  const addTo = useMemo(() => chosen.find((m) => m.id === targetId) ?? mrSel ?? chosen[0] ?? null, [chosen, targetId, mrSel])    // เลือกประเภทเดียว = เป็นค่าตั้งต้นของทุกบรรทัด
  const [urgent, setUrgent] = useState(false)
  const [remark, setRemark] = useState("")
  const [lines, setLines] = useState<FormLine[]>([])
  const [docKind, setDocKind] = useState<DocKind>("pr")
  const [doc, setDoc] = useState<DocHit | null>(null)
  const [docPanel, setDocPanel] = useState(false)
  const [docMsg, setDocMsg] = useState("")
  const [docOpen, setDocOpen] = useState(false)   // อ้างอิง PR/PO/DD พับไว้ (ไม่บังคับ)
  const [tried, setTried] = useState(false)       // กดยื่นแล้วอย่างน้อยครั้งหนึ่ง → ขึ้นกรอบแดงช่องที่ยังขาด
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
      const same = (l: FormLine) => l.skuId === s.skuId && (l.mrItemId ?? null) === (addTo?.id ?? null)   // อะไหล่เดียวกัน + ประเภทเดียวกัน = รวมจำนวน
      if (cur.some(same)) return cur.map((l) => (same(l) ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l))
      return [...cur, { skuId: s.skuId, skuCode: s.skuCode, skuName: s.skuName, qty: "1", stockQty: s.stockQty, mrItemId: addTo?.id ?? null, mrItemLabel: addTo?.label ?? null, remark: "" }]
    })
  }, [addTo])

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
        const at = next.findIndex((l) => l.skuId === g.skuId && (l.mrItemId ?? null) === (addTo?.id ?? null))
        if (at >= 0) next[at].qty = String((Number(next[at].qty) || 0) + g.qty)
        else next.push({ skuId: g.skuId, skuCode: g.skuCode, skuName: g.skuName, qty: String(g.qty), stockQty: g.stockQty, mrItemId: addTo?.id ?? null, mrItemLabel: addTo?.label ?? null, remark: "", fromDoc: true })
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

  // สิ่งที่ยังขาด (ตามลำดับเดียวกับ submit) — โชว์ในแถบล่างก่อนกดยื่น
  const missing = useMemo(() => {
    const m: string[] = []
    if (pendingFlow && !due) m.push("กำหนดสรุปยอด")
    if (!pendingFlow && !plate.trim()) m.push("ทะเบียนรถ")
    if (needMr && !mrCode) m.push("ใบแจ้งซ่อม (MR)")
    else if (mrItems.length > 0 && chosen.length === 0) m.push("ประเภทการซ่อม")
    if (!inventoryId) m.push("คลัง")
    if (!pickToId) m.push("จุดประสงค์")
    if (lines.length === 0) m.push("รายการอะไหล่")
    return m
  }, [pendingFlow, due, plate, needMr, mrCode, mrItems.length, chosen.length, inventoryId, pickToId, lines.length])

  const submit = async () => {
    setTried(true)
    if (!pendingFlow && !plate.trim()) return swalError("ใส่ทะเบียนรถ/เบอร์รถก่อนยื่นคำขอ")
    const dueAt = due ? new Date(due) : null
    if (pendingFlow) {
      if (!dueAt || isNaN(dueAt.getTime())) return swalError("ใส่กำหนดสรุปยอด (วันและเวลา) ก่อนยื่นคำขอ")
      const dueErr = dueError(due)
      if (dueErr) return swalError(dueErr)
    }
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
          workType, kind, inventoryId, pickToId, plate: plate.trim(), summaryDueAt: pendingFlow && dueAt ? dueAt.toISOString() : undefined, mrCode: mrCode || undefined, ref: doc ? { type: doc.kind, code: doc.code, id: doc.id } : undefined, urgent, remark: remark.trim(),
          lines: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, requestedQty: Number(l.qty), mrItemId: l.mrItemId ?? undefined, mrItemLabel: l.mrItemLabel ?? undefined, remark: l.remark.trim() })),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "ยื่นคำขอไม่สำเร็จ ลองใหม่อีกครั้ง")
      await swalToast("success", "ยื่นคำขอแล้ว รอสโตร์รับงาน")
      if (onDone) { onDone(); return }
      router.push(backHref)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ยื่นคำขอไม่สำเร็จ ลองใหม่อีกครั้ง")
      setBusy(false)
    }
  }

  // ประเภทงาน = radio group มาตรฐาน (วงกลม + ชื่อ + คำอธิบายสั้น)
  const workBtn = (w: SwWorkType, hint: string) => {
    const on = workType === w
    return (
      <button type="button" key={w} role="radio" aria-checked={on} onClick={() => setWorkType(w)} data-testid={`wt-${w}`}
        className={`flex flex-1 items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition ${on ? "border-[#1B8C4B] bg-[#1B8C4B]/[0.06] ring-1 ring-[#1B8C4B]" : "border-[#D5DCD8] hover:border-gray-300 dark:border-white/10"}`}>
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-[#1B8C4B]" : "border-gray-300 dark:border-white/30"}`}>
          {on && <span className="h-2 w-2 rounded-full bg-[#1B8C4B]" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-white">{WORK_TYPE_LABEL[w]}</span>
          <span className="block text-xs text-gray-500">{hint}</span>
        </span>
      </button>
    )
  }

  // หนึ่งบรรทัดอะไหล่ · หลายประเภท: เลือก "ย้ายไปประเภท" ได้ (กลุ่ม "ยังไม่ระบุ" ต้องเลือก)
  const renderLine = (l: FormLine, i: number, needType: boolean) => (
    <li key={`${l.skuId}-${i}`} className="rounded-md border border-[#D5DCD8] bg-white p-3 dark:border-white/10 dark:bg-[#161922]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{l.skuName}</p>
          <p className="text-xs text-gray-500">{l.skuCode}{l.stockQty != null && ` · คงเหลือ ${l.stockQty.toLocaleString("th-TH")}`}{l.fromDoc && doc && ` · จาก ${DOC_LABEL[doc.kind]} ${doc.code}`}</p>
        </div>
        <button type="button" aria-label="ลบรายการ" onClick={() => setLines((c) => c.filter((_, k) => k !== i))} className="shrink-0 p-1 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
      </div>
      <div className="mt-2 grid grid-cols-[96px_1fr] gap-2">
        <div>
          <span className="mb-1 block text-[11px] text-gray-500">จำนวน</span>
          <input aria-label="จำนวน" inputMode="decimal" className={`${inputCls} text-right tabular-nums`} value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} />
        </div>
        <div>
          <span className="mb-1 block text-[11px] text-gray-500">หมายเหตุรายการ</span>
          <input aria-label="หมายเหตุรายการ" className={inputCls} placeholder="ถ้ามี" value={l.remark} onChange={(e) => patch(i, { remark: e.target.value })} />
        </div>
      </div>
      {chosen.length > 1 && (
        <select aria-label={needType ? "เลือกประเภทการซ่อม" : "ย้ายไปประเภทการซ่อม"} className={`${inputCls} mt-2`} value={l.mrItemId ?? ""} onChange={(e) => setMrItem(i, e.target.value)}>
          <option value="" disabled>{needType ? "เลือกประเภทการซ่อม" : "ย้ายไปประเภท…"}</option>
          {chosen.map((m) => <option key={m.id} value={m.id}>{mrItemName(m.label)}</option>)}
        </select>
      )}
      {l.stockQty != null && Number(l.qty) > l.stockQty && kind === "stock" && (
        <p className="mt-1.5 text-xs text-amber-700">ขอเกินจำนวนคงเหลือในคลัง สโตร์อาจจัดให้ไม่ครบ</p>
      )}
    </li>
  )

  const req = <span className="ml-0.5 text-red-600" aria-hidden>*</span>
  const opt = <span className="ml-1 font-normal text-gray-400">(ถ้ามี)</span>
  const card = (n: number, title: string, body: ReactNode, aside?: ReactNode) => (
    <section className="rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,20,0.04)] dark:border-white/10 dark:bg-[#161922]">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/10">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1B8C4B]/10 text-[11px] font-semibold text-[#1B8C4B] dark:bg-emerald-500/15 dark:text-emerald-300">{n}</span>{title}
        </h2>
        {aside}
      </header>
      <div className="space-y-4 p-4">{body}</div>
    </section>
  )

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "mx-auto max-w-3xl p-4 sm:p-6"}>
      <div data-testid="form-body" className={embedded ? "min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#F4F6F5] px-4 py-4 sm:px-6 dark:bg-[#0f1117]" : "space-y-4 pb-4"}>
      {!embedded && (
        <div>
          <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#1B8C4B]"><ArrowLeft size={14} />กลับไปรายการของฉัน</Link>
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ขอเบิกอะไหล่</h1>
        </div>
      )}

      {optErr && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{optErr}</p>}
      {!embedded && <p className="text-xs text-gray-500">ช่องที่มีเครื่องหมาย <span className="text-red-600">*</span> ต้องกรอก</p>}

      {card(1, "ประเภทงาน", <>
        <div role="radiogroup" aria-label="ประเภทงาน" className="flex flex-col gap-2 sm:flex-row">
          {workBtn("garage_in", "ซ่อมในอู่ เบิกจากสต๊อก ต้องมี MR")}
          {workBtn("garage_out", "ซื้อมาใช้เลย ต้องมี MR ตัดยอดตามใบรับของ")}
          {workBtn("mobile_pm", "ช่างออกหน้างาน เบิกไปก่อน สรุปการใช้ทีหลัง")}
        </div>

        {pendingFlow && (
          <div>
            <label className={labelCls} htmlFor="sw-due">กำหนดสรุปยอด{req}</label>
            <DuePicker id="sw-due" value={due} onChange={setDue} />
            {tried && !due
              ? <p className="mt-1.5 text-xs text-red-600">ใส่กำหนดสรุปยอด (วันและเวลา) ก่อนยื่นคำขอ</p>
              : <p className="mt-1.5 text-xs leading-relaxed text-gray-500">วันและเวลาที่ต้องกลับมาสรุปการใช้อะไหล่ ว่าใช้กับรถทะเบียนใด และคืนของที่เหลือให้สโตร์ (เลือกได้ไม่เกิน {DUE_MAX_DAYS} วันนับจากวันนี้)</p>}
          </div>
        )}
      </>)}

      {card(2, "ข้อมูลคำขอ", <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="sw-inv">คลัง{req}</label>
            <OptionCombobox id="sw-inv" options={invs} value={inventoryId} placeholder="เลือกคลัง" searchPlaceholder="พิมพ์ชื่อคลัง"
              onChange={(v) => { setInventoryId(v); dropFromDoc(); setDocMsg(""); if (doc) setDocPanel(true) }} />
          </div>
          <div>
            <label className={labelCls} htmlFor="sw-pick">จุดประสงค์{req}</label>
            <OptionCombobox id="sw-pick" options={picks} value={pickToId} placeholder="เลือกจุดประสงค์" searchPlaceholder="พิมพ์ เช่น CM, ซ่อม, อุบัติเหตุ" clearable
              onChange={setPickToId} />
          </div>
          <div>
            <label className={labelCls} htmlFor="sw-plate">ทะเบียนรถ/เบอร์รถ{pendingFlow ? opt : req}</label>
            <input id="sw-plate" aria-invalid={(tried && !pendingFlow && !plate.trim()) || undefined}
              className={`${inputCls} ${tried && !pendingFlow && !plate.trim() ? "!border-red-400" : ""}`} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="เช่น 71-1234 หรือ เบอร์ 1234" />
            {pendingFlow && <p className="mt-1 text-xs text-gray-500">ใส่ตอนสรุปการใช้ได้</p>}
          </div>
          <div>
            <span className={labelCls}>ใบแจ้งซ่อม (MR){needMr ? req : opt}</span>
            <MrPicker
              mrCode={mrCode}
              plate={plate}
              onPick={(code, items) => { setMrCode(code); setMrItems(items); const one = items.length === 1 ? items[0] : null; setMrSelIds(one ? [one.id] : []); setLines((c) => c.map((l) => ({ ...l, mrItemId: one?.id ?? null, mrItemLabel: one?.label ?? null }))) }}
              onClear={() => { setMrCode(""); setMrItems([]); setMrSelIds([]); setLines((c) => c.map((l) => ({ ...l, mrItemId: null, mrItemLabel: null }))) }}
            />
            {mrItems.length > 0 && (
              <div className="mt-3">
                <span className={labelCls}>ประเภทการซ่อม{req}<span className="ml-1 font-normal text-gray-400">(เลือกได้มากกว่า 1)</span></span>
                <div className="divide-y divide-[#E2E8E4] rounded-md border border-[#D5DCD8] dark:divide-white/10 dark:border-white/10" role="group" aria-label="ประเภทการซ่อม">
                  {mrItems.map((m) => (
                    <label key={m.id} className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${mrSelIds.includes(m.id) ? "bg-[#1B8C4B]/[0.06]" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                      <input type="checkbox" checked={mrSelIds.includes(m.id)} onChange={() => toggleType(m.id)} className="h-4 w-4 accent-[#1B8C4B]" />
                      <span className="min-w-0 break-words text-gray-900 dark:text-white">{mrItemName(m.label)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#D5DCD8] pt-3 dark:border-white/10">
          {/* ไม่บังคับ — พับไว้ · มีใบที่เลือกอยู่ = กางให้เห็นเสมอ */}
          <button type="button" aria-expanded={docOpen || !!doc} data-testid="docref-toggle" onClick={() => setDocOpen((v) => !v)} disabled={!!doc}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-700 hover:text-[#1B8C4B] disabled:cursor-default disabled:hover:text-gray-700 dark:text-gray-300">
            <ChevronRight size={14} className={`transition-transform ${docOpen || doc ? "rotate-90" : ""}`} />
            อ้างอิงใบ PR / PO / DD{opt}
          </button>
          {(docOpen || doc) && (
            <div className="mt-2">
              <DocRefPicker plate={plate} inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} kind={docKind} onKind={changeKind}
                picked={doc} onPick={pickDoc} onClear={clearDoc} panelOpen={docPanel} onTogglePanel={() => setDocPanel((v) => !v)} />
              {doc && !docPanel && docMsg && <p data-testid="docref-msg" className="mt-2 rounded-md bg-[#1B8C4B]/10 px-3 py-2 text-xs text-[#14532d] dark:text-emerald-300">{docMsg}</p>}
              {doc && docPanel && (
                <div className="mt-2">
                  <DocLinesPanel doc={doc} inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} onImport={importLines} />
                </div>
              )}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[#1B8C4B]" />
          รถจอดรออะไหล่
        </label>
      </>)}

      {card(3, "รายการอะไหล่", <>
        <SkuPicker inventoryId={typeof inventoryId === "number" ? inventoryId : undefined} onPick={addSku} />

        {chosen.length > 1 && (
          <div>
            <span className={labelCls}>เพิ่มอะไหล่เข้าประเภทการซ่อม</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="เพิ่มอะไหล่เข้าประเภทการซ่อม">
              {chosen.map((m) => (
                <button key={m.id} type="button" onClick={() => setTargetId(m.id)} aria-pressed={addTo?.id === m.id}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${addTo?.id === m.id ? "border-[#1B8C4B] bg-[#1B8C4B] text-white" : "border-[#D5DCD8] text-gray-700 hover:border-gray-300 dark:border-white/10 dark:text-gray-200"}`}>
                  {mrItemName(m.label)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">อะไหล่ที่ค้นหรือนำเข้าจาก PR/PO/DD จะลงในประเภทที่เลือกไว้ เปลี่ยนประเภทของแต่ละบรรทัดทีหลังได้</p>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#D5DCD8] px-3 py-6 text-center text-sm text-gray-500 dark:border-white/10">ยังไม่มีรายการ ค้นหาอะไหล่ด้านบนแล้วเลือก</p>
        ) : chosen.length > 1 ? (
          <div className="space-y-4">
            {[...chosen.map((m) => ({ id: m.id as number | null, title: mrItemName(m.label) })), { id: null, title: "ยังไม่ระบุประเภทการซ่อม" }].map((g) => {
              const rows = lines.map((l, i) => ({ l, i })).filter(({ l }) => (g.id === null ? !l.mrItemId || !chosen.some((m) => m.id === l.mrItemId) : l.mrItemId === g.id))
              if (g.id === null && rows.length === 0) return null
              return (
                <section key={g.id ?? "none"} data-testid="line-group" aria-label={g.title}
                  className={`rounded-md border p-2.5 ${g.id === null ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10" : addTo?.id === g.id ? "border-[#1B8C4B]/60 bg-[#1B8C4B]/5" : "border-[#D5DCD8] dark:border-white/10"}`}>
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h3 className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-white">{g.title} <span className="font-normal text-gray-500">· {rows.length} รายการ</span></h3>
                    {g.id !== null && addTo?.id !== g.id && <button type="button" onClick={() => setTargetId(g.id)} className="shrink-0 rounded-md border border-[#1B8C4B]/40 px-2.5 py-1 text-xs text-[#1B8C4B] hover:bg-[#1B8C4B]/10">เพิ่มอะไหล่ในประเภทนี้</button>}
                    {g.id !== null && addTo?.id === g.id && <span className="shrink-0 text-xs text-[#1B8C4B]">กำลังเพิ่มเข้าประเภทนี้</span>}
                  </div>
                  {rows.length === 0
                    ? <p className="px-1 pb-1 text-xs text-gray-500">ยังไม่มีอะไหล่ในประเภทนี้</p>
                    : <ul className="space-y-2">{rows.map(({ l, i }) => renderLine(l, i, g.id === null))}</ul>}
                </section>
              )
            })}
          </div>
        ) : (
          <ul className="space-y-2">{lines.map((l, i) => renderLine(l, i, false))}</ul>
        )}

        <div>
          <label className={labelCls} htmlFor="sw-remark">หมายเหตุ{opt}</label>
          <textarea id="sw-remark" rows={2} className={inputCls} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </div>
      </>, lines.length > 0 ? <span className="text-xs text-gray-500">{lines.length} รายการ</span> : undefined)}

      </div>

      {/* แถบล่าง: สรุปสั้น + สิ่งที่ยังขาด ก่อนกดยื่น · Dialog = ท้ายกรอบนิ่ง · หน้าเต็ม = sticky */}
      <div className={`z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-gray-200 bg-white py-3 dark:border-white/10 dark:bg-[#161922] ${embedded ? "shrink-0 px-4 sm:px-6" : "sticky bottom-0 -mx-4 px-4 sm:-mx-6 sm:px-6"}`}>
        <div className="min-w-0 text-xs" data-testid="form-summary">
          <p className="flex flex-wrap items-center gap-1.5 text-gray-700 dark:text-gray-200">
            <span className="font-medium">{lines.length} รายการ</span>
            {lines.length > 0 && <span className="text-gray-400">· รวม {lines.reduce((s, l) => s + (Number(l.qty) || 0), 0).toLocaleString("th-TH")} ชิ้น</span>}
            {urgent && <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">รถจอดรอ</span>}
          </p>
          {missing.length > 0 && <p className={`mt-0.5 ${tried ? "text-red-600" : "text-gray-500"}`}>ยังไม่ได้กรอก: {missing.join(", ")}</p>}
        </div>
        {/* มือถือ: ปุ่มเต็มแถว (ยกเลิก 1 ส่วน : ยื่น 2 ส่วน) · จอใหญ่: ชิดขวาขนาดพอดีข้อความ */}
        <div className="flex w-full gap-2 sm:w-auto">
          {onCancel
            ? <button type="button" disabled={busy} onClick={onCancel} className="flex-1 rounded-md border border-[#D5DCD8] bg-white px-4 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 sm:flex-none dark:border-white/10 dark:bg-transparent dark:text-gray-300">ยกเลิก</button>
            : <Link href={backHref} className="flex-1 rounded-md border border-[#D5DCD8] bg-white px-4 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 sm:flex-none dark:border-white/10 dark:bg-transparent dark:text-gray-300">ยกเลิก</Link>}
          <button type="button" disabled={busy} onClick={submit} data-testid="submit"
            className="inline-flex flex-[2] items-center justify-center gap-2 rounded-md bg-[#1B8C4B] px-5 py-2 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-60 sm:flex-none">
            {busy && <Loader2 size={15} className="animate-spin" />}ยื่นคำขอ
          </button>
        </div>
      </div>
    </div>
  )
}
