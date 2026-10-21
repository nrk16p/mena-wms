"use client"

// ===========================================================================
// หัวคอลัมน์ที่เรียง/กรองได้ (แบบ Google Sheets/Excel) — ใช้ร่วมกันได้ทุกตาราง
// ===========================================================================
// หน้าตาและกติกาเดียวกับหัวคอลัมน์ของแท็บ "คำขอ / อนุมัติ V.2" (transaction-tracking.tsx)
// แต่ไม่ผูกกับชนิดแถว — ตารางไหนอยากได้ก็ประกาศ facet/sort ของตัวเองแล้วเรียก useColFilter
//
// กติกา: ไม่ติ๊กอะไรเลย = เอาทุกค่า (ไม่ใช่ติ๊กครบแบบ Excel) และตัวเลขข้างค่าคือจำนวนที่จะได้จริง
// หลังกรองคอลัมน์อื่นแล้ว โดยไม่นับคอลัมน์ตัวเอง

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Check, ListFilter, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fontThai } from "@/components/tire/shared"

export type SortDir = "asc" | "desc"
export type ColSort = { key: string; dir: SortDir } | null
export type FacetOption = { value: string; count: number }

/** ค่าที่ให้ติ๊ก — ต้องเป็นข้อความเดียวกับที่เห็นในเซลล์ ไม่งั้นติ๊กแล้วหาไม่เจอว่าตรงกับแถวไหน */
export type FacetDef<T> = { label: string; value: (r: T) => string }
export type SortDef<T>  = (r: T) => number | string

export type ColHeadCtx = {
  sort:    ColSort
  onSort:  (key: string, dir: SortDir | null) => void
  facets:  Record<string, string[]>
  options: Record<string, FacetOption[]>
  onPick:  (key: string, values: string[]) => void
}

/**
 * สถานะเรียง/กรองของตารางหนึ่งตาราง — `facetDefs`/`sortDefs` ควรเป็นค่าคงที่ระดับโมดูล
 * (ถ้าสร้างใหม่ทุก render จะคำนวณใหม่ทุกครั้ง)
 * ไม่ได้เลือกการเรียง = คงลำดับเดิมของ `rows` ไว้
 */
export function useColFilter<T>(
  rows: T[],
  facetDefs: Record<string, FacetDef<T>>,
  sortDefs: Record<string, SortDef<T>>,
) {
  const [sort, setSort]     = useState<ColSort>(null)
  const [facets, setFacets] = useState<Record<string, string[]>>({})

  const filtered = useMemo(() => {
    const keys = Object.keys(facetDefs)
    const pass = (r: T, skip?: string) => {
      for (const k of keys) {
        const picked = facets[k]
        if (k === skip || !picked?.length) continue
        if (!picked.includes(facetDefs[k].value(r))) return false
      }
      return true
    }

    const options: Record<string, FacetOption[]> = {}
    for (const k of keys) {
      const tally = new Map<string, number>()
      for (const r of rows) {
        if (!pass(r, k)) continue
        const v = facetDefs[k].value(r)
        tally.set(v, (tally.get(v) ?? 0) + 1)
      }
      options[k] = [...tally]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "th", { numeric: true }))
    }

    const kept = rows.filter((r) => pass(r))
    const valueOf = sort ? sortDefs[sort.key] : undefined
    if (!sort || !valueOf) return { rows: kept, options }
    const sign = sort.dir === "asc" ? 1 : -1
    // sort ของ JS เสถียร — แถวที่ค่าเท่ากันยังอยู่ตามลำดับเดิม
    const sorted = [...kept].sort((a, b) => {
      const x = valueOf(a), y = valueOf(b)
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "th", { numeric: true })
      return cmp * sign
    })
    return { rows: sorted, options }
  }, [rows, facets, sort, facetDefs, sortDefs])

  const picked = Object.entries(facets).filter(([, v]) => v.length > 0)
  const active = sort !== null || picked.length > 0

  const ctx: ColHeadCtx = {
    sort,
    facets,
    options: filtered.options,
    onSort: (key, dir) => setSort(dir ? { key, dir } : null),
    onPick: (key, values) => setFacets((f) => ({ ...f, [key]: values })),
  }

  /** สรุปตัวกรองไว้เขียนในไฟล์ Excel — คนเปิดไฟล์ทีหลังต้องรู้ว่ากรองอะไรมา */
  const describe = () => picked.map(([k, v]) =>
    `${facetDefs[k]?.label ?? k}: ${v.slice(0, 3).join(", ")}${v.length > 3 ? ` +${v.length - 3}` : ""}`,
  )

  const clear = () => { setFacets({}); setSort(null) }

  return { rows: filtered.rows, ctx, active, clear, describe }
}

/** รายการเรียงในเมนู — ติ๊กอยู่แล้วกดซ้ำ = ยกเลิกการเรียง กลับไปลำดับเดิม */
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
 * หัวคอลัมน์ — ปุ่มไอคอนเปิดเมนู "เรียง + ติ๊กค่าที่ต้องการ"
 * ปุ่มเป็นสีเขียวพร้อมเลขจำนวนค่าที่ติ๊กไว้ คอลัมน์ที่ถูกกรองจึงเห็นได้จากที่เดียว
 */
export function ColHead({ label, className = "", sortKey, sortLabels, facetKey, ctx }: {
  label:       string
  /** คลาสของ <th> — ส่งคลาสหัวตารางของหน้านั้นมาเอง */
  className?:  string
  sortKey?:    string
  /** ป้ายของทิศทางเรียง [น้อย→มาก, มาก→น้อย] — เขียนตามความหมายของคอลัมน์นั้นตรง ๆ */
  sortLabels?: [string, string]
  facetKey?:   string
  ctx:         ColHeadCtx
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState("")

  const dir     = sortKey && ctx.sort?.key === sortKey ? ctx.sort.dir : null
  const picked  = facetKey ? ctx.facets[facetKey] ?? [] : []
  const options = facetKey ? ctx.options[facetKey] ?? [] : []
  const active  = Boolean(dir) || picked.length > 0

  const needle = find.trim().toLowerCase()
  const shown = needle ? options.filter((o) => o.value.toLowerCase().includes(needle)) : options
  const allPicked = options.length > 0 && picked.length === options.length

  function toggle(value: string) {
    if (!facetKey) return
    ctx.onPick(facetKey, picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value])
  }

  return (
    <th className={className} style={fontThai}>
      <span className="flex items-center gap-1">
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
                "ml-auto inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1 py-1 transition-colors",
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
            className="w-56 rounded-[12px] border-[#EEF2F0] bg-white p-0 normal-case tracking-normal shadow-lg dark:border-white/10 dark:bg-[#151a10]"
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
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] font-normal text-[#14271C] hover:bg-[#F6FAF7] dark:text-gray-200 dark:hover:bg-white/5"
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
