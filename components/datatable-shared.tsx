"use client"

// ===========================================================================
// ชิ้นส่วนกลางของ "datatable ทางการ" — หน้าตาเดียวกับตารางในแท็บคำขอ/อนุมัติ V.2
// (components/tire/transaction-tracking.tsx) แต่ถอดออกมาเป็นตัวทั่วไปที่ผูกคีย์
// เรียง/กรองเป็น generic string ได้ หน้าอื่นจึงหยิบไปใช้ได้โดยไม่ต้องคัดลอกโค้ด
//
// หมายเหตุ: tire/transaction-tracking.tsx ยังถือสำเนาของตัวเองอยู่ (ยังไม่ย้ายมาใช้ตัวนี้)
// เพราะการแก้ไฟล์ 2,000 บรรทัดที่ใช้งานจริงอยู่ไม่ได้อยู่ในขอบเขตที่ขอมา — ย้ายทีหลังได้
// ===========================================================================

import { useState } from "react"
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Inbox, ListFilter, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fontThai } from "@/components/tire/shared"

// ── หน้าตาตาราง ─────────────────────────────────────────────────────────────
// หัวเข้มกว่าตัวกลาง + มีเส้นแบ่งคอลัมน์ทุกช่อง เพราะแถวเดียวมีคอลัมน์ต่างชนิดกันมาก
// ถ้าไม่มีเส้นตั้งกวาดตาแล้วหลงบรรทัด

export const dtTheadCls =
  "sticky top-0 z-20 border-b-2 border-[#1B8C4B]/30 bg-[#E4EFE8] dark:border-[#1B8C4B]/45 dark:bg-[#1B2419]"

export const dtThCls =
  "border-r border-[#1B8C4B]/15 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#14271C] " +
  "last:border-r-0 dark:border-white/8 dark:text-gray-100"

export const dtTdCls = "border-r border-[#F1F5F2] px-3 py-2.5 align-top last:border-r-0 dark:border-white/5"

export const PAGE_SIZES = [20, 50, 100] as const

// ── สถานะการเรียง / กรองรายคอลัมน์ ──────────────────────────────────────────

export type SortDir = "asc" | "desc"
export type SortState<K extends string> = { key: K; dir: SortDir } | null
export type FacetOption = { value: string; count: number }

/** บริบทที่หัวคอลัมน์ทุกช่องใช้ร่วมกัน — ส่งเป็นก้อนเดียวจะได้ไม่ต้องไล่ prop ทีละตัว */
export type HeadCtx<S extends string, F extends string> = {
  sort:    SortState<S>
  onSort:  (key: S, dir: SortDir | null) => void
  facets:  Record<F, string[]>
  options: Record<F, FacetOption[]>
  onPick:  (key: F, values: string[]) => void
}

/** ผ่านตัวกรองรายคอลัมน์ไหม — ข้ามคอลัมน์ที่ยังไม่ติ๊ก (ติ๊กว่าง = เอาหมด)
 *  `skip` ใช้ตอนนับตัวเลือกของคอลัมน์นั้นเอง เพื่อไม่ให้ค่าที่เพิ่งติ๊กหายไปจากรายการ (กติกาเดียวกับ Excel) */
export function passFacets<T, F extends string>(
  row: T,
  keys: readonly F[],
  facets: Record<F, string[]>,
  valueOf: Record<F, (r: T) => string>,
  skip?: F,
): boolean {
  for (const k of keys) {
    if (k === skip || facets[k].length === 0) continue
    if (!facets[k].includes(valueOf[k](row))) return false
  }
  return true
}

/** ค่าที่ให้ติ๊กในแต่ละคอลัมน์ + จำนวนแถวของค่านั้น
 *  นับจากของที่เหลือ "หลังกรองคอลัมน์อื่นแล้ว" แต่ไม่นับตัวเอง — เลขข้างค่าคือจำนวนที่จะได้จริงถ้าติ๊กเพิ่ม */
export function buildFacetOptions<T, F extends string>(
  rows: T[],
  keys: readonly F[],
  facets: Record<F, string[]>,
  valueOf: Record<F, (r: T) => string>,
): Record<F, FacetOption[]> {
  const out = {} as Record<F, FacetOption[]>
  for (const k of keys) {
    const tally = new Map<string, number>()
    for (const r of rows) {
      if (!passFacets(r, keys, facets, valueOf, k)) continue
      const v = valueOf[k](r)
      tally.set(v, (tally.get(v) ?? 0) + 1)
    }
    out[k] = [...tally]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value, "th"))
  }
  return out
}

// ── หัวคอลัมน์ ──────────────────────────────────────────────────────────────

function SortItem({ dir, label, on, onClick }: {
  dir: SortDir
  label: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full cursor-pointer items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[11.5px] transition-colors",
        on
          ? "bg-[#F0FDF4] font-semibold text-[#1B8C4B] dark:bg-green-500/12 dark:text-green-300"
          : "text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5",
      ].join(" ")}
      style={fontThai}
    >
      {dir === "asc" ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {on && <Check size={12} className="shrink-0" />}
    </button>
  )
}

/**
 * หัวคอลัมน์แบบ Google Sheets/Excel — ปุ่มไอคอนเปิดเมนู "เรียง + ติ๊กค่าที่ต้องการ"
 *
 * ต่างจาก Excel หนึ่งข้อ: ช่องติ๊กเริ่มต้นเป็น "ไม่ติ๊กเลย" ซึ่งหมายถึงเอาทุกค่า
 * (Excel เริ่มด้วยติ๊กครบแล้วให้ไล่เอาออก ซึ่งกลายเป็นงานเยอะกว่าตอนอยากดูค่าเดียว)
 * ปุ่มจะเปลี่ยนเป็นสีเขียวพร้อมเลขจำนวนค่าที่ติ๊กไว้ คอลัมน์ที่ถูกกรองจึงเห็นได้จากที่เดียว
 */
export function ColHead<S extends string, F extends string>({
  label, width = "", align, sortKey, sortLabels, facetKey, ctx, hint,
}: {
  label:       string
  width?:      string
  align?:      "right" | "center"
  sortKey?:    S
  /** ป้ายของทิศทางเรียง [น้อย→มาก, มาก→น้อย] — เขียนตามความหมายของคอลัมน์นั้นตรง ๆ */
  sortLabels?: [string, string]
  facetKey?:   F
  hint?:       string
  ctx:         HeadCtx<S, F>
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState("")

  const dir     = sortKey && ctx.sort?.key === sortKey ? ctx.sort.dir : null
  const picked  = facetKey ? ctx.facets[facetKey] : []
  const options = facetKey ? ctx.options[facetKey] : []
  const active  = Boolean(dir) || picked.length > 0

  const needle = find.trim().toLowerCase()
  const shown = needle ? options.filter((o) => o.value.toLowerCase().includes(needle)) : options
  const allPicked = options.length > 0 && picked.length === options.length

  function toggle(value: string) {
    if (!facetKey) return
    ctx.onPick(facetKey, picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value])
  }

  return (
    <th className={`${dtThCls} ${width}`} title={hint}>
      <span className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="truncate">{label}</span>
        {dir === "asc"  && <ArrowUp   size={11} className="shrink-0 text-[#1B8C4B] dark:text-green-400" aria-hidden />}
        {dir === "desc" && <ArrowDown size={11} className="shrink-0 text-[#1B8C4B] dark:text-green-400" aria-hidden />}

        <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setFind("") }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`เรียงหรือกรองคอลัมน์ ${label}`}
              title={`เรียง / กรอง — ${label}`}
              className={[
                "inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-1 transition-colors",
                align === "right" ? "mr-auto" : "ml-auto",
                active
                  ? "bg-[#1B8C4B] text-white"
                  : "text-[#6B7C72] hover:bg-white hover:text-[#1B8C4B] dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-green-400",
              ].join(" ")}
            >
              <ListFilter size={11} strokeWidth={2.5} />
              {picked.length > 0 && <span className="text-[9.5px] font-bold leading-none">{picked.length}</span>}
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-56 rounded-[12px] border-[#EEF2F0] bg-white p-0 shadow-lg dark:border-white/10 dark:bg-[#151a10]"
          >
            {sortKey && (
              <div className="border-b border-[#EEF2F0] p-1 dark:border-white/8">
                <SortItem dir="asc" on={dir === "asc"} label={sortLabels?.[0] ?? "น้อย → มาก"}
                  onClick={() => ctx.onSort(sortKey, dir === "asc" ? null : "asc")} />
                <SortItem dir="desc" on={dir === "desc"} label={sortLabels?.[1] ?? "มาก → น้อย"}
                  onClick={() => ctx.onSort(sortKey, dir === "desc" ? null : "desc")} />
              </div>
            )}

            {facetKey && (
              <>
                {/* ช่องค้นหาในเมนู — คอลัมน์อย่างยี่ห้อ/ชื่อสินค้ามีค่าเป็นสิบเป็นร้อย ไถหาเองไม่ไหว */}
                <div className="p-1.5">
                  <div className="relative">
                    <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={find}
                      onChange={(e) => setFind(e.target.value)}
                      placeholder="ค้นหาค่า..."
                      className="w-full rounded-[8px] border border-[#EEF2F0] bg-white py-1 pl-6 pr-2 text-[11.5px] text-[#14271C] placeholder-[#9AA8A0] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/25 dark:border-white/10 dark:bg-[#0f130d] dark:text-white"
                      style={fontThai}
                    />
                  </div>
                </div>

                <div className="max-h-52 overflow-y-auto px-1 pb-1">
                  {options.length > 1 && !needle && (
                    <label className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] font-semibold text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-100 dark:hover:bg-white/5" style={fontThai}>
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={() => ctx.onPick(facetKey, allPicked ? [] : options.map((o) => o.value))}
                        className="size-3.5 shrink-0 cursor-pointer accent-[#1B8C4B]"
                      />
                      เลือกทั้งหมด
                    </label>
                  )}

                  {shown.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[11px] text-[#9AA8A0]" style={fontThai}>ไม่พบค่าที่ค้นหา</p>
                  ) : shown.map((o) => (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5"
                      style={fontThai}
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(o.value)}
                        onChange={() => toggle(o.value)}
                        className="size-3.5 shrink-0 cursor-pointer accent-[#1B8C4B]"
                      />
                      <span className="flex-1 truncate" title={o.value}>{o.value}</span>
                      <span className="shrink-0 text-[10px] text-[#9AA8A0]">{o.count}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[#EEF2F0] px-2 py-1.5 dark:border-white/8">
                  <span className="text-[10px] text-[#9AA8A0]" style={fontThai}>ไม่ติ๊ก = แสดงทั้งหมด</span>
                  <button
                    type="button"
                    disabled={picked.length === 0}
                    onClick={() => ctx.onPick(facetKey, [])}
                    className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#1B8C4B] transition-colors hover:bg-[#F0FDF4] disabled:cursor-default disabled:text-[#C9D3CD] disabled:hover:bg-transparent dark:text-green-400 dark:hover:bg-white/10 dark:disabled:text-gray-600"
                    style={fontThai}
                  >
                    ล้าง
                  </button>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      </span>
    </th>
  )
}

// ── สถานะว่าง ───────────────────────────────────────────────────────────────

export function Empty({ hint, onClear }: { hint: string; onClear?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#F0FDF4] text-[#1B8C4B] dark:bg-white/5">
        <Inbox size={20} strokeWidth={1.7} aria-hidden />
      </span>
      <p className="text-[13px] text-gray-400" style={fontThai}>{hint}</p>
      {onClear && (
        <button type="button" onClick={onClear}
          className="rounded-full border border-[#EEF2F0] px-3.5 py-1.5 text-[12px] text-[#6B7C72] transition-colors hover:border-[#1B8C4B]/30 hover:text-[#14271C] dark:border-white/10 dark:text-gray-400 dark:hover:text-white"
          style={fontThai}>
          ล้างตัวกรอง
        </button>
      )}
    </div>
  )
}

// ── แบ่งหน้า ────────────────────────────────────────────────────────────────

/** หน้าต่างเลขหน้า — แสดงหน้าแรก/สุดท้ายเสมอ ความกว้างจึงคงที่ไม่ว่าจะมีกี่หน้า */
function pageWindow(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const around = [current - 1, current, current + 1].filter((n) => n > 1 && n < count)
  const pages = [1, ...around, count]
  const out: (number | "gap")[] = []
  for (const [i, n] of pages.entries()) {
    if (i && n - (pages[i - 1] as number) > 1) out.push("gap")
    out.push(n)
  }
  return out
}

export function Pager({ current, count, onGo }: { current: number; count: number; onGo: (page: number) => void }) {
  if (count <= 1) return null

  const step = "flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-[#EEF2F0] text-[#6B7C72] transition-colors hover:border-[#1B8C4B]/30 hover:text-[#14271C] disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:text-gray-400 dark:hover:text-white"

  return (
    <nav aria-label="แบ่งหน้า" className="flex items-center gap-1">
      <button type="button" aria-label="หน้าก่อนหน้า" disabled={current <= 1} onClick={() => onGo(current - 1)} className={step}>
        <ChevronLeft size={15} />
      </button>
      {pageWindow(current, count).map((n, i) => n === "gap" ? (
        <span key={`gap-${i}`} aria-hidden className="px-1 text-[12px] text-[#9AA8A0]">…</span>
      ) : (
        <button
          key={n}
          type="button"
          onClick={() => onGo(n)}
          aria-label={`หน้า ${n}`}
          aria-current={n === current ? "page" : undefined}
          className={[
            "size-8 shrink-0 rounded-[9px] border text-[12px] transition-colors",
            n === current
              ? "border-[#1B8C4B] bg-[#1B8C4B] font-semibold text-white"
              : "border-[#EEF2F0] text-[#6B7C72] hover:border-[#1B8C4B]/30 hover:text-[#14271C] dark:border-white/10 dark:text-gray-400 dark:hover:text-white",
          ].join(" ")}
        >
          {n}
        </button>
      ))}
      <button type="button" aria-label="หน้าถัดไป" disabled={current >= count} onClick={() => onGo(current + 1)} className={step}>
        <ChevronRight size={15} />
      </button>
    </nav>
  )
}
