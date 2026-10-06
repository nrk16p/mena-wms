"use client"

import { useEffect, useId, useMemo, useRef } from "react"
import { Trash2 } from "lucide-react"
import { CodeSelect, Chip, Field, MultiCodeSelect, TagInput } from "@/components/sku-convert/ui"
import {
  LAB_UNITS, NO_L3_TYPES, NO_PRICE_TYPES, entryMissing, entryWrong, skuPreview,
} from "@/lib/sku-convert-core"
import type { CodeBook, CodeOption, Entry, Kind } from "@/lib/sku-convert-types"
import { cn } from "@/lib/utils"

export interface EntryCardProps {
  index: number
  entry: Entry
  book: CodeBook
  kind: Kind
  /** ATMS stock of the old code (30/09) — used for the "fill the remainder" shortcut. */
  atmsQty: number
  /** Σ qty of the other cards. */
  otherQty: number
  /** The old code of this row; locked as the first ATMS code. */
  rowCode: string
  readOnly: boolean
  /** Focus the first empty classification field on mount (card #1 of a row that has L1 already → L2). */
  autoFocus?: boolean
  onChange: (patch: Partial<Entry>) => void
  /** Present only when there is more than one card. */
  onRemove?: () => void
}

/** One new-SKU draft. Field order and rules mirror /sku/new (minus images). */
export function EntryCard({ index, entry: e, book, kind, atmsQty, otherQty, rowCode, readOnly, autoFocus, onChange, onRemove }: EntryCardProps) {
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const l1Ref = useRef<HTMLSelectElement>(null)
  const l2Ref = useRef<HTMLSelectElement>(null)
  const l3Ref = useRef<HTMLSelectElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const lab = e.type === "LAB"
  const noL3 = NO_L3_TYPES.includes(e.type)
  const noPrice = NO_PRICE_TYPES.includes(e.type)

  const missing = useMemo(() => entryMissing(e), [e])
  const wrong = useMemo(() => entryWrong(e, book), [e, book])
  const wrongHas = (s: string) => wrong.some((w) => w.startsWith(s))
  const preview = skuPreview(e)

  // dependent option lists (same rules as /sku/new)
  const l1Opts = useMemo<CodeOption[]>(() => {
    const allowed = book.l1ByType[e.type]
    return allowed && allowed.length ? book.l1.filter((o) => allowed.includes(o.code)) : book.l1
  }, [book, e.type])
  const l2Opts = (lab ? book.l2Lab : book.l2)[e.l1] ?? []
  const l3Opts = (lab ? book.l3Lab : book.l3)[`${e.l1}:${e.l2}`] ?? []
  const unitOpts = useMemo<CodeOption[]>(() => {
    if (!lab) return book.unit
    return book.unitLab.map((c) => book.unit.find((o) => o.code === c) ?? { code: c, th: c })
  }, [book, lab])
  const gradeOpts = lab ? book.gradeLab : book.grade

  useEffect(() => {
    if (!autoFocus) return
    const target = !e.l1 ? l1Ref : !e.l2 ? l2Ref : !e.l3 && !noL3 ? l3Ref : nameRef
    target.current?.focus()
    // mount only — later edits must not steal focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function changeType(type: string) {
    const patch: Partial<Entry> = { type }
    if (NO_L3_TYPES.includes(type)) patch.l3 = ""
    if (NO_PRICE_TYPES.includes(type)) patch.price = ""
    if (type === "LAB" && !LAB_UNITS.includes(e.unit)) patch.unit = "DAY"   // stale L1/L2/L3 picks stay visible and are flagged
    onChange(patch)
  }

  function commitBrand(v: string) {
    const t = v.trim()
    const hit = book.brand.find((o) => o.code.toLowerCase() === t.toLowerCase() || o.th.toLowerCase() === t.toLowerCase())
    onChange({ brand: hit ? hit.code : t })
  }

  const ok = !missing.length && !wrong.length
  const remainder = Math.max(0, Math.round((atmsQty - otherQty) * 1e6) / 1e6)

  return (
    <section
      aria-label={`รหัสใหม่ #${index + 1}`}
      className={cn("v2-card v2-card-in rounded-[24px] p-4 sm:p-5", ok && "ring-1 ring-[#86f3c6]")}
    >
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-8 min-w-8 place-items-center rounded-full px-2 text-sm font-bold text-white v2-tile-blue">#{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[#5b6f8f]">ตัวอย่างรหัส SKU</p>
          <p className="truncate font-mono text-sm font-semibold text-[#0f2748]">{preview || "— เลือกคลัง / ประเภท / L1 / L2 ให้ครบ —"}</p>
        </div>
        {ok ? <Chip tone="mint" dot>✓ ครบ</Chip> : (
          <span className="flex flex-wrap gap-1.5" aria-live="polite">
            {missing.length > 0 && <Chip tone="sun">ขาด: {missing.join(", ")}</Chip>}
            {wrong.map((w) => <Chip key={w} tone="red">{w}</Chip>)}
          </span>
        )}
        {onRemove && !readOnly && (
          <button type="button" onClick={onRemove} aria-label={`ลบรหัสใหม่ #${index + 1}`} className="grid h-9 w-9 place-items-center rounded-full text-[#b42318] hover:bg-[#fee8e6]">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </header>

      <fieldset disabled={readOnly} className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <legend className="sr-only">ข้อมูล SKU ใหม่ #{index + 1}</legend>

        <Field label="คลัง" htmlFor={id("wh")} required>
          <CodeSelect id={id("wh")} value={e.wh} options={book.wh} onChange={(v) => onChange({ wh: v })} />
        </Field>
        <Field label="ประเภท" htmlFor={id("type")} required>
          <CodeSelect id={id("type")} value={e.type} options={book.type} onChange={changeType} />
        </Field>

        <Field label="L1 ระบบ" htmlFor={id("l1")} required error={wrongHas("L1") ? "L1 ไม่ตรงประเภทที่เลือก" : undefined}>
          <CodeSelect id={id("l1")} selectRef={l1Ref} value={e.l1} options={l1Opts} invalid={wrongHas("L1")} onChange={(v) => onChange({ l1: v, l2: "", l3: "" })} />
        </Field>
        <Field label="L2 ชุดย่อย" htmlFor={id("l2")} required error={wrongHas("L2") ? "L2 ไม่อยู่ใต้ L1 นี้" : undefined}>
          <CodeSelect
            id={id("l2")} selectRef={l2Ref} value={e.l2} options={l2Opts} invalid={wrongHas("L2")} disabled={!e.l1 && !readOnly}
            placeholder={e.l1 ? "— เลือก —" : "— เลือก L1 ก่อน —"} onChange={(v) => onChange({ l2: v, l3: "" })}
          />
        </Field>
        <Field label={noL3 ? "L3 (ไม่ใช้กับประเภทนี้)" : "L3 ชิ้นส่วน"} htmlFor={id("l3")} required={!noL3} className="sm:col-span-2" error={wrongHas("L3") ? "L3 ไม่อยู่ใต้ L2 นี้" : undefined}>
          <CodeSelect
            id={id("l3")} selectRef={l3Ref} value={e.l3} options={l3Opts} invalid={wrongHas("L3")} disabled={noL3 || ((!e.l1 || !e.l2) && !readOnly)}
            placeholder={noL3 ? "—" : e.l2 ? "— เลือก —" : "— เลือก L2 ก่อน —"} onChange={(v) => onChange({ l3: v })}
          />
        </Field>

        <Field label="ชื่อสินค้า (ไทย)" htmlFor={id("nameTh")} required className="sm:col-span-2">
          <input id={id("nameTh")} ref={nameRef} className="v2-input" value={e.nameTh} onChange={(ev) => onChange({ nameTh: ev.target.value })} maxLength={200} />
        </Field>
        <Field label="ชื่อสินค้า (อังกฤษ)" htmlFor={id("nameEn")} className="sm:col-span-2">
          <input id={id("nameEn")} className="v2-input" value={e.nameEn} onChange={(ev) => onChange({ nameEn: ev.target.value })} maxLength={200} />
        </Field>

        <Field label="เบอร์อะไหล่ (Part No.)" htmlFor={id("partNo")}>
          <input id={id("partNo")} className="v2-input font-mono" value={e.partNo} onChange={(ev) => onChange({ partNo: ev.target.value })} maxLength={80} />
        </Field>
        <Field label="ตำแหน่งติดตั้ง" htmlFor={id("positions")}>
          <MultiCodeSelect id={id("positions")} values={e.positions} options={book.position} onChange={(v) => onChange({ positions: v })} />
        </Field>

        <Field label="ราคา (บาท)" htmlFor={id("price")} hint={noPrice ? "ประเภทนี้ไม่กรอกราคา" : undefined}>
          {noPrice ? (
            <input id={id("price")} className="v2-input" value="0 (กรอกตอน transaction)" disabled readOnly />
          ) : (
            <input id={id("price")} className="v2-input tabular-nums" inputMode="decimal" value={e.price} onChange={(ev) => onChange({ price: ev.target.value })} maxLength={20} />
          )}
        </Field>
        <Field label="หน่วย" htmlFor={id("unit")} required error={wrongHas("หน่วย") ? (lab ? "ค่าแรงใช้ได้เฉพาะ DAY / HR" : "หน่วยไม่ถูกต้อง") : undefined}>
          <CodeSelect id={id("unit")} value={e.unit} options={unitOpts} invalid={wrongHas("หน่วย")} onChange={(v) => onChange({ unit: v })} />
        </Field>

        <Field label="ยี่ห้อ" htmlFor={id("brand")}>
          <input
            id={id("brand")} className="v2-input" list={id("brands")} value={e.brand} maxLength={60}
            onChange={(ev) => onChange({ brand: ev.target.value })} onBlur={(ev) => commitBrand(ev.target.value)}
          />
          <datalist id={id("brands")}>
            {book.brand.map((o) => <option key={o.code} value={o.code}>{o.th}</option>)}
          </datalist>
        </Field>
        <Field label="Grade" htmlFor={id("grade")} error={wrongHas("Grade") ? "Grade ไม่ตรงประเภท" : undefined}>
          <CodeSelect id={id("grade")} value={e.grade} options={gradeOpts} invalid={wrongHas("Grade")} placeholder="— ไม่ระบุ —" onChange={(v) => onChange({ grade: v })} />
        </Field>

        <Field label="OEM Ref" htmlFor={id("oem")} className="sm:col-span-2">
          <input id={id("oem")} className="v2-input font-mono" value={e.oemRef} onChange={(ev) => onChange({ oemRef: ev.target.value })} maxLength={80} />
        </Field>
        <Field label="เบอร์เทียบ (Enter เพื่อเพิ่ม)" htmlFor={id("compat")} className="sm:col-span-2">
          <TagInput id={id("compat")} values={e.compatRefs} onChange={(v) => onChange({ compatRefs: v })} placeholder="พิมพ์เบอร์แล้วกด Enter" disabled={readOnly} />
        </Field>
        <Field label="รุ่นรถ" htmlFor={id("vehicles")} className="sm:col-span-2" hint="ไม่เลือก = ใช้ได้ทุกรุ่น">
          <MultiCodeSelect id={id("vehicles")} values={e.vehicles} options={book.vehicle} onChange={(v) => onChange({ vehicles: v })} placeholder="+ เพิ่มรุ่นรถ" />
        </Field>
        <Field label="รหัส ATMS (รหัสเดิม)" htmlFor={id("atms")} required className="sm:col-span-2" hint="รหัสแรกคือรหัสของแถวนี้ (ล็อก) — เพิ่มรหัสเดิมอื่นที่รวมเข้ามาได้">
          <TagInput id={id("atms")} values={e.atmsCodes} onChange={(v) => onChange({ atmsCodes: v })} lockedCount={e.atmsCodes[0] === rowCode ? 1 : 0} placeholder="พิมพ์รหัสแล้วกด Enter" disabled={readOnly} />
        </Field>

        {kind === "parts" && (
          <Field label="จำนวน (แบ่งจากยอด ATMS)" htmlFor={id("qty")} hint={`ยอด ATMS ที่ต้องแบ่งทั้งหมด ${atmsQty.toLocaleString("en-US", { maximumFractionDigits: 3 })}`}>
            <div className="flex gap-2">
              <input
                id={id("qty")} type="number" inputMode="decimal" min={0} step="any" className="v2-input tabular-nums"
                value={e.qty ?? ""} onChange={(ev) => onChange({ qty: ev.target.value === "" ? null : Number(ev.target.value) })}
              />
              <button type="button" className="v2-btn-soft shrink-0" onClick={() => onChange({ qty: remainder })} title={`ใส่ ${remainder} (ส่วนที่เหลือจากการ์ดอื่น)`}>
                เติมที่เหลือ
              </button>
            </div>
          </Field>
        )}
        <Field label="หมายเหตุ" htmlFor={id("note")} className="sm:col-span-2">
          <textarea id={id("note")} rows={2} className="v2-input" value={e.note} onChange={(ev) => onChange({ note: ev.target.value })} maxLength={500} />
        </Field>
      </fieldset>
    </section>
  )
}
