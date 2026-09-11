"use client"
// components/price-compare-matrix.tsx — ตารางเทียบราคา รายการ × Supplier 1–4 + สรุปยอด (คำนวณสดจาก lib/price-compare)
import { Fragment } from "react"
import { Plus, Trash2, ArrowUp, ArrowDown, ExternalLink } from "lucide-react"
import { VendorCombobox } from "@/components/vendor-combobox"
import { SkuPicker, type SkuHit } from "@/components/sku-picker"
import { benchmarkUrl } from "@/lib/intel-links"
import { swalConfirm } from "@/lib/swal"
import {
  emptySupplier, supplierTotals, lowestNet, fmtMoney, lineTotal, MAX_SUPPLIERS, VAT_MODE_LABEL,
  effectiveLineSupplier, allLinesAwarded, mixedTotals, bestMixNet, pickLowestPerLine, renumberAfterRemoval,
  groupsOf, hasGrades, newGroupId,
  type PriceCompare, type PcItem, type PcSupplier, type PcVatMode, type PcTotals, type PcGroup,
} from "@/lib/price-compare"

type Props = {
  doc: PriceCompare
  onChange: (patch: Partial<Pick<PriceCompare, "items" | "suppliers" | "lineSupplier">>) => void
  readOnly?: boolean
}

const cellInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-right tabular-nums focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const textInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const numOrNull = (v: string): number | null => { if (v.trim() === "") return null; const n = parseFloat(v.replace(/,/g, "")); return isFinite(n) ? n : null }

export function PriceCompareMatrix({ doc, onChange, readOnly }: Props) {
  const { items, suppliers, lineSupplier } = doc
  const groups = groupsOf(doc)                 // รายการ (กลุ่ม) ตามลำดับ — รายการธรรมดา = กลุ่มขนาด 1
  const gradeMode = hasGrades(doc)             // มีรายการหลายเกรด → ทั้งใบเลือกรายบรรทัด (กติกาข้อ 4)
  const low = pickLowestPerLine(doc)   // 1-based, เทียบหลัง VAT, group-aware (1 ช่องต่อรายการ) — เกณฑ์เดียวกับ isComplete/PDF
  // มีรายการหลายเกรด: supplierTotals/lowestNet นับเฉพาะเกรดที่เลือก (ยอดบางส่วนโดยนิยาม) → ไม่ชี้ "สุทธิต่ำสุดทั้งใบ" ให้เข้าใจผิด
  const lowNet = gradeMode ? null : lowestNet(doc)
  const totals = suppliers.map((_, i) => supplierTotals(doc, i))
  const cols = 4 + suppliers.length * 2 + (readOnly ? 0 : 1)
  const mixedAll = allLinesAwarded(doc)
  const pickedCount = lineSupplier.filter((v) => v != null).length
  const awardedCount = groups.filter((g) => g.rows.some((i) => lineSupplier[i] != null)).length   // นับต่อรายการ ไม่ใช่ต่อแถวเกรด
  const mt = mixedTotals(doc)      // null เมื่อยังมีแถวที่ไม่มีเจ้าที่ใช้ได้จริง (ไม่ได้เลือก + ไม่มีผู้ได้รับเลือกทั้งใบ) / รายการหลายเกรดที่ยังไม่เลือกเกรด
  const bNet = bestMixNet(doc)
  // แถว → กลุ่มของแถวนั้น (radio ของทุกช่องในกลุ่มเป็นชุดเดียวกัน)
  const groupOfRow: PcGroup[] = []
  groups.forEach((g) => g.rows.forEach((i) => { groupOfRow[i] = g }))

  const patchSupplier = (s: number, p: Partial<PcSupplier>) => onChange({ suppliers: suppliers.map((sp, i) => (i === s ? { ...sp, ...p } : sp)) })
  const setPrice = (s: number, r: number, v: number | null) => patchSupplier(s, { prices: suppliers[s].prices.map((p, i) => (i === r ? v : p)) })
  const setLineSupplier = (next: (number | null)[]) => onChange({ lineSupplier: next })
  // ชื่อ/จำนวน/หน่วย/sku เป็นของทั้งรายการ: แก้ที่แถวหัว = เขียนทุกแถวเกรดของกลุ่ม (normalizeDoc ก็ sync จากแถวแรกอีกชั้น)
  const patchRows = (rows: number[], p: Partial<PcItem>) => onChange({ items: items.map((it, i) => (rows.includes(i) ? { ...it, ...p } : it)) })
  // ปัก/ถอนธง "ใช้ supplier รายนี้สำหรับรายการนี้" — กดซ้ำที่ธงเดิม = ถอนธง (กลับไป fallback ผู้ได้รับเลือกทั้งใบ)
  // รายการหลายเกรด: เลือกช่องหนึ่ง = ล้างแถวเกรดอื่นของกลุ่มในแพตช์เดียวกัน (เลือกได้ 1 เกรด + 1 เจ้าต่อรายการ)
  const toggleLineAward = (r: number, supplierNum: number) => {
    const rows = groupOfRow[r]?.rows ?? [r]
    setLineSupplier(lineSupplier.map((v, i) => (i === r ? (v === supplierNum ? null : supplierNum) : rows.includes(i) ? null : v)))
  }

  // ทุกการเพิ่ม/ลบ/เลื่อนแถวผ่านทางเดียว: src[k] = แถวเดิมที่มาอยู่ตำแหน่ง k (null = แถวใหม่ ราคาว่าง ยังไม่เลือก)
  // prices ทุกเจ้าและ lineSupplier ถูกจัดตาม src ชุดเดียวกับ items เสมอ → items/prices/lineSupplier ยาวเท่ากันทุก mutation
  const reshape = (src: (number | null)[], nextItems: PcItem[]) => onChange({
    items: nextItems,
    suppliers: suppliers.map((sp) => ({ ...sp, prices: src.map((i) => (i == null ? null : sp.prices[i] ?? null)) })),
    lineSupplier: src.map((i) => (i == null ? null : lineSupplier[i] ?? null)),
  })
  const allRows = items.map((_, i) => i)
  const addItem = () => reshape([...allRows, null], [...items, { name: "", qty: 1, unit: "" }])
  // +เกรด: รายการธรรมดา → กลุ่ม 2 เกรด (แถวเดิม + แถวใหม่ต่อท้าย); กลุ่มอยู่แล้ว → เกรดใหม่ท้ายกลุ่ม
  // ชื่อเกรดว่างให้ผู้ใช้กรอก (validateDoc บังคับตอนบันทึก), แถวใหม่ราคาว่างทุกเจ้า + ยังไม่เลือก
  const addGrade = (g: PcGroup) => {
    const head = items[g.rows[0]]
    const last = g.rows[g.rows.length - 1]
    const group = head.group || newGroupId(items.flatMap((it) => (it.group ? [it.group] : [])))
    const nextItems = items.map((it, i) => (g.rows.includes(i) ? { ...it, group, grade: it.grade ?? "" } : it))
    nextItems.splice(last + 1, 0, { name: head.name, qty: head.qty, unit: head.unit, ...(head.sku ? { sku: head.sku } : {}), group, grade: "" })
    const src: (number | null)[] = [...allRows]
    src.splice(last + 1, 0, null)
    reshape(src, nextItems)
  }
  // ลบทั้งรายการ (ทุกแถวเกรด) — รายการหลายเกรดถามก่อน เพราะราคาหลายช่องหายพร้อมกัน
  const removeGroup = async (g: PcGroup) => {
    if (g.rows.length > 1) {
      const name = items[g.rows[0]].name
      const ok = await swalConfirm(`ลบทั้งรายการ${name ? ` "${name}"` : ""}?`, `ราคาทั้ง ${g.rows.length} เกรดของทุกเจ้าจะถูกลบ`)
      if (!ok.isConfirmed) return
    }
    const keep = allRows.filter((i) => !g.rows.includes(i))
    reshape(keep, keep.map((i) => items[i]))
  }
  // ลบเกรดหนึ่งแถว — เหลือเกรดเดียว = กลับเป็นรายการธรรมดา (ถอด group/grade ออกจากแถวที่เหลือ; การเลือกของแถวนั้นคงไว้)
  const removeGrade = (g: PcGroup, r: number) => {
    const keep = allRows.filter((i) => i !== r)
    const survivors = g.rows.filter((i) => i !== r)
    reshape(keep, keep.map((i) => {
      if (survivors.length !== 1 || i !== survivors[0]) return items[i]
      const { name, qty, unit, sku } = items[i]
      return { name, qty, unit, ...(sku ? { sku } : {}) }
    }))
  }
  // เลื่อนทั้งรายการ (ทุกแถวเกรดไปด้วยกัน) สลับกับรายการข้างเคียงทั้งก้อน
  const moveGroup = (gi: number, dir: -1 | 1) => {
    const gj = gi + dir
    if (gj < 0 || gj >= groups.length) return
    const order = groups.map((g) => g.rows)
    ;[order[gi], order[gj]] = [order[gj], order[gi]]
    const src = order.flat()
    reshape(src, src.map((i) => items[i]))
  }
  const addSupplier = () => suppliers.length < MAX_SUPPLIERS && onChange({ suppliers: [...suppliers, emptySupplier(items.length)] })
  // ลบคอลัมน์แล้วเลขลำดับของเจ้าที่อยู่ถัดไปเลื่อนขึ้น — การมอบหมายรายบรรทัดต้องเลื่อนตาม ไม่งั้นชี้ผิดเจ้าเงียบๆ
  // (selectedSupplier / committee[].pickedSupplier เลื่อนที่ onMatrixChange ในฟอร์ม เพราะไม่ได้อยู่ในพื้นที่ของตารางนี้)
  const removeSupplier = (s: number) => onChange({
    suppliers: suppliers.filter((_, i) => i !== s),
    lineSupplier: lineSupplier.map((v) => renumberAfterRemoval(v, s)),
  })

  const th = "px-2 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-[#E2E8E4] dark:border-white/10"
  const td = "px-1 py-0.5 border-b border-[#EEF2F0] dark:border-white/8 align-middle"

  // ช่องราคาต่อเจ้าของแถว r (colSpan 2 ต่อเจ้า) — radioName ร่วมกันทั้งกลุ่มสำหรับรายการหลายเกรด, เฉพาะแถวสำหรับรายการธรรมดา
  const priceCells = (r: number, radioName: string, label: string) => suppliers.map((sp, s) => {
    const it = items[r]
    const p = sp.prices[r] ?? null
    const best = low[r] === s + 1 && p != null
    const picked = lineSupplier[r] === s + 1                                                  // เลือกรายบรรทัดไว้จริง
    const fallback = !gradeMode && !picked && effectiveLineSupplier(doc, r) === s + 1          // ไม่ได้เลือกเอง แต่ตกมาที่ผู้ได้รับเลือกทั้งใบ
    return (
      <td key={s} colSpan={2} className={`${td} ${picked ? "bg-emerald-100 dark:bg-emerald-900/40" : best ? "bg-emerald-50 dark:bg-emerald-900/20" : ""} ${fallback ? "ring-1 ring-inset ring-[#1B8C4B]" : ""}`}>
        <div className="flex items-center gap-1">
          {/* radio ต่อเซลล์: ชุดเดียวกันทั้งแถว (รายการหลายเกรด = ทั้งกลุ่ม) เลือกได้ช่องเดียว — คลิกซ้ำที่อันที่เลือกอยู่ = ล้าง
              click ยิงก่อน change เสมอ; ถ้าอันนี้ถูกเลือกอยู่แล้ว change จะไม่ยิง จึงต้องล้างจาก onClick */}
          <input type="radio" name={radioName} checked={picked} disabled={readOnly || p == null}
            aria-label={`ใช้ Supplier ${s + 1} สำหรับ${label}`}
            onClick={() => { if (picked && !readOnly) toggleLineAward(r, s + 1) }}
            onChange={() => toggleLineAward(r, s + 1)}
            title={picked ? "กดซ้ำเพื่อล้างการเลือกของรายการนี้" : gradeMode && (groupOfRow[r]?.rows.length ?? 1) > 1 ? "ใช้เกรดนี้จาก supplier นี้ (เลือกได้ 1 ช่องต่อรายการ)" : "ใช้ supplier นี้สำหรับรายการนี้ (ผสมข้าม supplier)"}
            className="h-3.5 w-3.5 shrink-0 accent-[#1B8C4B]" />
          <span aria-hidden className={`w-2.5 shrink-0 text-center text-xs font-bold ${picked ? "text-emerald-700 dark:text-emerald-300" : "text-transparent"}`}>✓</span>
          <input inputMode="decimal" value={p ?? ""} disabled={readOnly} onChange={(e) => setPrice(s, r, numOrNull(e.target.value))} placeholder="—" className={cellInput} />
          <span className={`w-24 shrink-0 text-right text-xs tabular-nums ${best ? "font-semibold text-emerald-700" : "text-gray-500"}`}>{p != null ? fmtMoney(lineTotal(it, p)) : ""}</span>
        </div>
      </td>
    )
  })
  // ช่องลำดับ (นับต่อรายการ) + ปุ่มเลื่อนทั้งรายการ
  const orderCell = (gi: number) => (
    <td className={`${td} text-center text-xs text-gray-400`}>
      <div className="flex flex-col items-center">
        <span>{gi + 1}</span>
        {!readOnly && (
          <span className="hidden group-hover:flex flex-col">
            <button type="button" onClick={() => moveGroup(gi, -1)} title="เลื่อนขึ้น" className="text-gray-300 hover:text-gray-600"><ArrowUp size={10} /></button>
            <button type="button" onClick={() => moveGroup(gi, 1)} title="เลื่อนลง" className="text-gray-300 hover:text-gray-600"><ArrowDown size={10} /></button>
          </span>
        )}
      </div>
    </td>
  )
  // ช่องรายการ (ชื่อ / SKU / ราคากลาง / +เกรด) + จำนวน + หน่วย — ของทั้งรายการ เขียนทุกแถวในกลุ่ม
  const itemCells = (g: PcGroup) => {
    const it = items[g.rows[0]]
    return (
      <>
        <td className={td}>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SkuPicker
                value={it.name}
                disabled={readOnly}
                placeholder="ชื่อรายการ"
                onChange={(name) => patchRows(g.rows, { name, sku: undefined })}
                onPick={(hit: SkuHit) => patchRows(g.rows, { name: `${hit.code} : ${hit.name}`, unit: it.unit || hit.unit, sku: hit.code })}
              />
            </div>
            {it.sku && (
              <span title={it.sku} className="shrink-0 rounded bg-[#1B8C4B]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#1B8C4B]">SKU</span>
            )}
            {it.sku && (
              <a
                href={benchmarkUrl(it.sku)}
                target="_blank"
                rel="noopener noreferrer"
                title="ดูราคากลางใน mena-intelligence"
                aria-label={`ดูราคากลางของ ${it.sku} ใน mena-intelligence`}
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-[#0E7490] hover:underline"
              >
                ราคากลาง <ExternalLink size={11} />
              </a>
            )}
            {!readOnly && (
              <button type="button" onClick={() => addGrade(g)} title="เพิ่มเกรด เช่น มือ 1 / มือ 2 / ซ่อมของเดิม — ทุกเจ้ากรอกราคาต่อเกรด เลือกได้ 1 เกรด + 1 เจ้า"
                className="shrink-0 rounded border border-dashed border-[#7C3AED]/50 px-1 py-0.5 text-[10px] font-medium text-[#7C3AED] hover:bg-[#7C3AED]/10">+เกรด</button>
            )}
          </div>
        </td>
        <td className={td}><input type="number" min={0} step="any" value={it.qty} disabled={readOnly} onChange={(e) => patchRows(g.rows, { qty: parseFloat(e.target.value) || 0 })} className={cellInput} /></td>
        <td className={td}><input value={it.unit} disabled={readOnly} onChange={(e) => patchRows(g.rows, { unit: e.target.value })} placeholder="หน่วย" className={textInput} /></td>
      </>
    )
  }

  return (
    <div>
      <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={`${th} w-8 text-center`}>#</th>
            <th className={`${th} min-w-[220px] text-left`}>รายการ</th>
            <th className={`${th} w-20 text-right`}>จำนวน</th>
            <th className={`${th} w-20 text-left`}>หน่วย</th>
            {suppliers.map((sp, s) => (
              <th key={s} colSpan={2} className={`${th} min-w-[230px] text-left ${s === lowNet ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 rounded bg-[#0E7490]/10 px-1.5 py-0.5 text-[10px] text-[#0E7490]">S{s + 1}</span>
                  <div className="flex-1">
                    {readOnly ? <span className="font-medium">{sp.name}</span> : (
                      // S1–S4 เลือกได้เฉพาะจากรายชื่อ AVL (/vendors) — ไม่มีพิมพ์ชื่อใหม่ (ผู้ใช้กำหนด 2026-09-10)
                      // garageId ของเดิม (garage_master) เลิกผูก: คีย์ถาวรคือชื่ออู่ตาม AVL
                      <VendorCombobox
                        value={sp.name}
                        onChange={(v) => patchSupplier(s, { name: v?.vendor ?? "", garageId: undefined })}
                        placeholder={`Supplier ${s + 1}`}
                      />
                    )}
                  </div>
                  {!readOnly && suppliers.length > 1 && (
                    <button type="button" onClick={() => removeSupplier(s)} title="ลบ supplier" className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                  )}
                </div>
                <input value={sp.note} disabled={readOnly} onChange={(e) => patchSupplier(s, { note: e.target.value })} placeholder="หมายเหตุ เช่น ราคานี้เป็นราคาซ่อมของเดิม" className={`${textInput} mt-1 text-xs font-normal`} />
                <select value={sp.vatMode} disabled={readOnly} onChange={(e) => patchSupplier(s, { vatMode: e.target.value as PcVatMode })} title="ฐานราคาที่เสนอ — ระบบ normalize ให้เทียบกันที่สุทธิ" className="mt-1 w-full rounded-md border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-1.5 py-0.5 text-[11px] font-normal">
                  {(Object.keys(VAT_MODE_LABEL) as PcVatMode[]).map((m) => <option key={m} value={m}>{VAT_MODE_LABEL[m]}</option>)}
                </select>
              </th>
            ))}
            {!readOnly && (
              <th className={`${th} w-10`}>
                {suppliers.length < MAX_SUPPLIERS && (
                  <button type="button" onClick={addSupplier} title="เพิ่ม supplier" className="rounded-md border border-dashed border-[#1B8C4B] p-1 text-[#1B8C4B] hover:bg-[#1B8C4B]/10"><Plus size={14} /></button>
                )}
              </th>
            )}
          </tr>
          <tr className="text-[11px] text-gray-500">
            <th className={td} colSpan={4}></th>
            {suppliers.map((_, s) => (
              <Fragment key={s}>
                <th className={`${td} text-right`}>ราคา/หน่วย</th>
                <th className={`${td} text-right`}>ยอดรวม</th>
              </Fragment>
            ))}
            {!readOnly && <th className={td}></th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => {
            const head = items[g.rows[0]]
            if (g.rows.length === 1) {
              const r = g.rows[0]
              return (
                <tr key={`row:${r}`} className="group">
                  {orderCell(gi)}
                  {itemCells(g)}
                  {priceCells(r, `pc-line-${r}`, `แถว ${gi + 1}`)}
                  {!readOnly && (
                    <td className={`${td} text-center`}>{groups.length > 1 && <button type="button" onClick={() => void removeGroup(g)} title="ลบแถว" className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}</td>
                  )}
                </tr>
              )
            }
            // รายการหลายเกรด: แถวหัว (ของทั้งรายการ ช่องราคาเว้นว่าง) + แถวเกรดละแถว — radio ชุดเดียวทั้งกลุ่ม
            const radioName = `pc-line-${g.key}`
            const pickedRow = g.rows.find((i) => lineSupplier[i] != null)
            const pickedSup = pickedRow != null ? lineSupplier[pickedRow]! : null
            return (
              <Fragment key={`grp:${g.key}`}>
                <tr className="group">
                  {orderCell(gi)}
                  {itemCells(g)}
                  <td colSpan={suppliers.length * 2} className={`${td} px-2 text-[11px]`}>
                    {pickedRow != null && pickedSup != null
                      ? <span className="text-emerald-700 dark:text-emerald-300">✓ เลือก เกรด {items[pickedRow].grade || "—"} · S{pickedSup} {suppliers[pickedSup - 1]?.name}</span>
                      : <span className="text-amber-700 dark:text-amber-400">{g.rows.length} เกรด — ยังไม่เลือกเกรด (เลือก 1 ช่อง: เกรด + เจ้า)</span>}
                  </td>
                  {!readOnly && (
                    <td className={`${td} text-center`}>{groups.length > 1 && <button type="button" onClick={() => void removeGroup(g)} title="ลบทั้งรายการ (ทุกเกรด)" className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}</td>
                  )}
                </tr>
                {g.rows.map((r, k) => {
                  const it = items[r]
                  const gradeLabel = it.grade?.trim() || `ที่ ${k + 1}`
                  return (
                    <tr key={`grade:${r}`}>
                      <td className={td}></td>
                      <td className={td}>
                        <div className="flex items-center gap-1 pl-3">
                          <span className="shrink-0 text-xs text-gray-400">├ เกรด:</span>
                          <input value={it.grade ?? ""} disabled={readOnly} onChange={(e) => patchRows([r], { grade: e.target.value })}
                            placeholder="เช่น มือ 1 / มือ 2 / ซ่อมของเดิม" aria-label={`ชื่อเกรดที่ ${k + 1} ของรายการ ${gi + 1}`}
                            className={`${textInput} ${!readOnly && !(it.grade ?? "").trim() ? "ring-1 ring-inset ring-amber-300" : ""}`} />
                        </div>
                      </td>
                      <td className={`${td} px-2 text-right text-xs tabular-nums text-gray-400`}>{it.qty}</td>
                      <td className={`${td} px-2 text-xs text-gray-400`}>{it.unit}</td>
                      {priceCells(r, radioName, ` ${head.name || `รายการ ${gi + 1}`} เกรด ${gradeLabel}`)}
                      {!readOnly && (
                        <td className={`${td} text-center`}><button type="button" onClick={() => removeGrade(g, r)} title="ลบเกรดนี้" className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button></td>
                      )}
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
          {!readOnly && (
            <tr><td colSpan={cols} className="px-2 py-1.5">
              <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-[#1B8C4B] hover:underline"><Plus size={13} /> เพิ่มรายการ</button>
            </td></tr>
          )}
        </tbody>
        <tfoot className="text-sm">
          {([
            ["รวมราคา ก่อนภาษี", "subtotal", true], ["ส่วนลด", "discount", false], ["รวมราคาหลังส่วนลด", "afterDiscount", false], ["ภาษีมูลค่าเพิ่ม 7%", "vat", false], ["รวมราคาทั้งหมด (สุทธิ)", "net", true],
          ] as [string, keyof PcTotals, boolean][]).map(([label, key, bold]) => (
            <tr key={key} className={bold ? "font-semibold" : ""}>
              <td colSpan={4} className={`${td} px-2 py-1 text-right text-xs text-gray-600 dark:text-gray-300`}>{label}</td>
              {suppliers.map((sp, s) => (
                <td key={s} colSpan={2} className={`${td} text-right tabular-nums ${key === "net" && s === lowNet ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20" : ""}`}>
                  {key === "discount" && !readOnly
                    ? <input inputMode="decimal" value={sp.discount || ""} onChange={(e) => patchSupplier(s, { discount: numOrNull(e.target.value) ?? 0 })} placeholder="0.00" className={cellInput} />
                    : key === "vat" && sp.vatMode !== "excl"
                    ? <span className="px-2 text-xs text-gray-400">{sp.vatMode === "none" ? "ไม่มี VAT" : `(รวมในราคา) ${fmtMoney(totals[s].vat)}`}</span>
                    : <span className="px-2">{fmtMoney(totals[s][key])}</span>}
                </td>
              ))}
              {!readOnly && <td className={td}></td>}
            </tr>
          ))}
          {/* โหมดผสม: ยอดที่ตกกับแต่ละเจ้าตามที่เลือกรายบรรทัด (ไม่ปันส่วนส่วนลดท้ายใบ) */}
          {mixedAll && mt && (
            <Fragment>
              <tr className="border-t border-dashed border-[#E2E8E4] dark:border-white/10">
                <td colSpan={4} className={`${td} px-2 py-1 text-right text-xs text-gray-600 dark:text-gray-300`}>ยอดที่เลือกจากเจ้านี้ (ก่อน VAT)</td>
                {suppliers.map((_, s) => (
                  <td key={s} colSpan={2} className={`${td} text-right tabular-nums`}>
                    <span className="px-2">{mt.perSupplier[s].lines > 0 ? fmtMoney(mt.perSupplier[s].subtotal) : <span className="text-gray-300 dark:text-gray-600">—</span>}</span>
                  </td>
                ))}
                {!readOnly && <td className={td}></td>}
              </tr>
              <tr className="font-semibold">
                <td colSpan={4} className={`${td} px-2 py-1 text-right text-xs text-gray-600 dark:text-gray-300`}>
                  สุทธิที่เลือก{readOnly && <span className="ml-2 text-emerald-700 dark:text-emerald-300">รวมสุทธิแบบผสม {fmtMoney(mt.grand)}</span>}
                </td>
                {suppliers.map((_, s) => (
                  <td key={s} colSpan={2} className={`${td} text-right tabular-nums ${mt.perSupplier[s].lines > 0 ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                    <span className="px-2">{mt.perSupplier[s].lines > 0 ? fmtMoney(mt.perSupplier[s].net) : <span className="font-normal text-gray-300 dark:text-gray-600">—</span>}</span>
                  </td>
                ))}
                {!readOnly && <td title="รวมสุทธิแบบผสม" className={`${td} whitespace-nowrap px-1 text-right tabular-nums text-emerald-700 dark:text-emerald-300`}>{fmtMoney(mt.grand)}</td>}
              </tr>
            </Fragment>
          )}
          {(pickedCount > 0 || gradeMode) && (
            <tr>
              <td colSpan={cols} className="px-2 py-1.5 text-[11px] text-gray-500">
                {gradeMode && <>ยอดรวมต่อเจ้าด้านบนนับเฉพาะเกรดที่เลือก · </>}
                ส่วนลดท้ายใบไม่ถูกนำมาคิดเมื่อเลือก supplier รายบรรทัด
                {bNet != null && <> · ถ้าเลือกถูกสุดทุกแถว: <b className="text-emerald-700 dark:text-emerald-300">{fmtMoney(bNet)}</b></>}
                {!mixedAll && (gradeMode
                  ? <> · เลือกแล้ว {awardedCount}/{groups.length} รายการ — มีรายการหลายเกรด ต้องเลือกเกรดและเจ้าให้ครบทุกรายการ</>
                  : <> · เลือกรายบรรทัดแล้ว {pickedCount}/{items.length} แถว — แถวที่เหลือใช้ผู้ได้รับเลือกทั้งใบ</>)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => setLineSupplier(pickLowestPerLine(doc))}
            className="rounded-lg border border-[#1B8C4B] px-3 py-1 font-semibold text-[#1B8C4B] hover:bg-[#1B8C4B]/10">เลือกถูกสุดทุกแถว</button>
          <button type="button" disabled={pickedCount === 0} onClick={() => setLineSupplier(items.map(() => null))}
            className="rounded-lg border px-3 py-1 text-gray-600 dark:border-white/10 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">ล้างการเลือกรายแถว</button>
          <span className="text-gray-400">{gradeMode ? `เลือกเกรด/เจ้าแล้ว ${awardedCount}/${groups.length} รายการ` : `เลือก supplier รายบรรทัดแล้ว ${pickedCount}/${items.length} แถว`}</span>
        </div>
      )}
    </div>
  )
}
