"use client"
// components/price-compare-matrix.tsx — ตารางเทียบราคา รายการ × Supplier 1–4 + สรุปยอด (คำนวณสดจาก lib/price-compare)
import { Fragment, useEffect, useRef } from "react"
import { Plus, Trash2, ArrowUp, ArrowDown, Star } from "lucide-react"
import { GarageCombobox, type Garage } from "@/components/garage-combobox"
import {
  emptySupplier, supplierTotals, lowestPerLine, lowestNet, fmtMoney, MAX_SUPPLIERS, VAT_MODE_LABEL,
  addPriceOption, removePriceOption, promotePriceOption, updatePriceOption,
  effectiveLineSupplier, allLinesAwarded, mixedNet, bestMixNet,
  type PriceCompare, type PcItem, type PcSupplier, type PcVatMode, type PcTotals,
} from "@/lib/price-compare"

type Props = {
  doc: PriceCompare
  garages: Garage[]
  onGarageCreated: (g: Garage) => void
  onChange: (patch: Partial<Pick<PriceCompare, "items" | "suppliers" | "lineSupplier">>) => void
  readOnly?: boolean
}

const cellInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-right tabular-nums focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const textInput = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm focus:border-[#1B8C4B] focus:bg-white dark:focus:bg-[#0f1117] focus:outline-none"
const numOrNull = (v: string): number | null => { if (v.trim() === "") return null; const n = parseFloat(v.replace(/,/g, "")); return isFinite(n) ? n : null }

export function PriceCompareMatrix({ doc, garages, onGarageCreated, onChange, readOnly }: Props) {
  const { items, suppliers, lineSupplier } = doc
  const low = lowestPerLine(doc)
  const lowNet = lowestNet(doc)
  const totals = suppliers.map((_, i) => supplierTotals(doc, i))
  const cols = 4 + suppliers.length * 2 + (readOnly ? 0 : 1)
  const mixed = allLinesAwarded(doc)
  const mNet = mixedNet(doc)
  const bNet = bestMixNet(doc)

  // ref แบบซิงค์ กันปัญหา stale closure: GarageCombobox เรียก onCreated แล้ว onChange ทันทีในจังหวะเดียวกัน
  // ก่อนที่ prop garages รอบใหม่จะมาถึง — ถ้า .find อิง garages เฉยๆ จะยังไม่เห็นอู่ที่เพิ่งสร้าง
  const garagesRef = useRef(garages)
  useEffect(() => { garagesRef.current = garages }, [garages])

  const patchItem = (r: number, p: Partial<PcItem>) => onChange({ items: items.map((it, i) => (i === r ? { ...it, ...p } : it)) })
  const patchSupplier = (s: number, p: Partial<PcSupplier>) => onChange({ suppliers: suppliers.map((sp, i) => (i === s ? { ...sp, ...p } : sp)) })
  const setPrice = (s: number, r: number, v: number | null) => patchSupplier(s, { prices: suppliers[s].prices.map((p, i) => (i === r ? v : p)) })
  const setLineSupplier = (next: (number | null)[]) => onChange({ lineSupplier: next })
  // ปัก/ถอนธง "ใช้ supplier รายนี้สำหรับรายการนี้" — กดซ้ำที่ธงเดิม = ถอนธง (กลับไป fallback ผู้ได้รับเลือกทั้งใบ)
  const toggleLineAward = (r: number, supplierNum: number) =>
    setLineSupplier(lineSupplier.map((v, i) => (i === r ? (v === supplierNum ? null : supplierNum) : v)))

  const addItem = () => onChange({
    items: [...items, { name: "", qty: 1, unit: "" }],
    suppliers: suppliers.map((sp) => ({ ...sp, prices: [...sp.prices, null], extraOptions: [...sp.extraOptions, []] })),
    lineSupplier: [...lineSupplier, null],
  })
  const removeItem = (r: number) => onChange({
    items: items.filter((_, i) => i !== r),
    suppliers: suppliers.map((sp) => ({ ...sp, prices: sp.prices.filter((_, i) => i !== r), extraOptions: sp.extraOptions.filter((_, i) => i !== r) })),
    lineSupplier: lineSupplier.filter((_, i) => i !== r),
  })
  const moveItem = (r: number, dir: -1 | 1) => {
    const j = r + dir
    if (j < 0 || j >= items.length) return
    const swap = <T,>(arr: T[]) => { const a = [...arr]; [a[r], a[j]] = [a[j], a[r]]; return a }
    onChange({
      items: swap(items),
      suppliers: suppliers.map((sp) => ({ ...sp, prices: swap(sp.prices), extraOptions: swap(sp.extraOptions) })),
      lineSupplier: swap(lineSupplier),
    })
  }
  const addSupplier = () => suppliers.length < MAX_SUPPLIERS && onChange({ suppliers: [...suppliers, emptySupplier(items.length)] })
  const removeSupplier = (s: number) => onChange({ suppliers: suppliers.filter((_, i) => i !== s) })

  const th = "px-2 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-[#E2E8E4] dark:border-white/10"
  const td = "px-1 py-0.5 border-b border-[#EEF2F0] dark:border-white/8 align-middle"

  return (
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
                      <GarageCombobox
                        value={sp.name}
                        garages={garages}
                        onChange={(name) => patchSupplier(s, { name, garageId: garagesRef.current.find((g) => g.name === name)?._id })}
                        onCreated={(g) => { garagesRef.current = [...garagesRef.current, g]; onGarageCreated(g) }}
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
          {items.map((it, r) => (
            <tr key={r} className="group">
              <td className={`${td} text-center text-xs text-gray-400`}>
                <div className="flex flex-col items-center">
                  <span>{r + 1}</span>
                  {!readOnly && (
                    <span className="hidden group-hover:flex flex-col">
                      <button type="button" onClick={() => moveItem(r, -1)} className="text-gray-300 hover:text-gray-600"><ArrowUp size={10} /></button>
                      <button type="button" onClick={() => moveItem(r, 1)} className="text-gray-300 hover:text-gray-600"><ArrowDown size={10} /></button>
                    </span>
                  )}
                </div>
              </td>
              <td className={td}><input value={it.name} disabled={readOnly} onChange={(e) => patchItem(r, { name: e.target.value })} placeholder="ชื่อรายการ" className={textInput} /></td>
              <td className={td}><input type="number" min={0} step="any" value={it.qty} disabled={readOnly} onChange={(e) => patchItem(r, { qty: parseFloat(e.target.value) || 0 })} className={cellInput} /></td>
              <td className={td}><input value={it.unit} disabled={readOnly} onChange={(e) => patchItem(r, { unit: e.target.value })} placeholder="หน่วย" className={textInput} /></td>
              {suppliers.map((sp, s) => {
                const p = sp.prices[r] ?? null
                const best = low[r] === s && p != null
                const awarded = effectiveLineSupplier(doc, r) === s + 1
                const opts = sp.extraOptions[r] ?? []
                return (
                  <td key={s} colSpan={2} className={`${td} ${best ? "bg-emerald-50 dark:bg-emerald-900/20" : ""} ${awarded ? "ring-1 ring-inset ring-[#1B8C4B]" : ""}`}>
                    <div className="flex items-center gap-1">
                      {!readOnly ? (
                        <button type="button" onClick={() => toggleLineAward(r, s + 1)}
                          title={awarded ? "เลิกกำหนด — กลับไปใช้ผู้ได้รับเลือกของทั้งใบ" : "ใช้ supplier นี้สำหรับรายการนี้ (mix ข้าม supplier)"}
                          className={awarded ? "shrink-0 text-[#1B8C4B]" : "shrink-0 text-gray-300 hover:text-gray-500"}>
                          <Star size={12} fill={awarded ? "currentColor" : "none"} />
                        </button>
                      ) : awarded ? <Star size={12} className="shrink-0 text-[#1B8C4B]" fill="currentColor" /> : null}
                      <input inputMode="decimal" value={p ?? ""} disabled={readOnly} onChange={(e) => setPrice(s, r, numOrNull(e.target.value))} placeholder="—" className={cellInput} />
                      <span className={`w-24 shrink-0 text-right text-xs tabular-nums ${best ? "font-semibold text-emerald-700" : "text-gray-500"}`}>{p != null ? fmtMoney(Math.round(it.qty * p * 100) / 100) : ""}</span>
                    </div>
                    {(opts.length > 0 || !readOnly) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {opts.map((opt, oi) => (
                          <span key={oi} className="inline-flex items-center gap-0.5 rounded bg-gray-100 dark:bg-white/5 px-1 py-0.5 text-[10px] text-gray-500">
                            {readOnly ? (
                              <span>{opt.label || "เกรด"}: {fmtMoney(opt.price)}</span>
                            ) : (
                              <>
                                <input value={opt.label} onChange={(e) => patchSupplier(s, updatePriceOption(sp, r, oi, { label: e.target.value }))} placeholder="เกรด" className="w-12 bg-transparent outline-none" />
                                <input inputMode="decimal" value={opt.price ?? ""} onChange={(e) => patchSupplier(s, updatePriceOption(sp, r, oi, { price: numOrNull(e.target.value) }))} placeholder="ราคา" className="w-14 bg-transparent text-right outline-none" />
                                <button type="button" title="ใช้ราคานี้แทน" onClick={() => patchSupplier(s, promotePriceOption(sp, r, oi))} className="font-medium text-[#1B8C4B] hover:underline">ใช้</button>
                                <button type="button" title="ลบตัวเลือกนี้" onClick={() => patchSupplier(s, removePriceOption(sp, r, oi))} className="text-gray-400 hover:text-red-600"><Trash2 size={9} /></button>
                              </>
                            )}
                          </span>
                        ))}
                        {!readOnly && (
                          <button type="button" onClick={() => patchSupplier(s, addPriceOption(sp, r, { label: "", price: null }))} className="text-[10px] font-medium text-[#0E7490] hover:underline">+เกรด</button>
                        )}
                      </div>
                    )}
                  </td>
                )
              })}
              {!readOnly && (
                <td className={`${td} text-center`}>{items.length > 1 && <button type="button" onClick={() => removeItem(r)} title="ลบแถว" className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}</td>
              )}
            </tr>
          ))}
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
          {suppliers.length > 1 && (mNet != null || bNet != null) && (
            <tr className="border-t border-dashed border-[#E2E8E4] dark:border-white/10">
              <td colSpan={cols} className="px-2 py-1.5 text-xs text-gray-500">
                <span className="mr-4 inline-flex items-center gap-1">
                  <Star size={10} className="text-[#1B8C4B]" fill="currentColor" />
                  ยอดรวมตามธงที่ปัก{mixed ? "" : " + ผู้ได้รับเลือกทั้งใบ (แถวที่ยังไม่ปักธง)"}:
                  <b className="text-gray-700 dark:text-gray-200">{mNet != null ? fmtMoney(mNet) : "—"}</b>
                </span>
                {bNet != null && <span className="inline-flex items-center gap-1">ถ้าปักธงถูกสุดทุกแถว: <b className="text-emerald-700">{fmtMoney(bNet)}</b></span>}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}
