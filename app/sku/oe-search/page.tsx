"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { Search, X, ExternalLink, Tag, Layers, CheckCircle } from "lucide-react"

type MatchedItem = {
  SKU: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  เบอร์อะไหล่: string
  เบอร์แท้อ้างอิง: string
  เบอร์เทียบอ้างอิง: string[]
  ประเภทค่าใช้จ่าย: string
  คลังสินค้า: string
  ยี่ห้อ: string
  Grade: string
  ราคาต่อหน่วย: number
  หน่วย: string
  ระบบ_L1: string
  ชุดประกอบ_L2: string
  ชิ้นส่วน_L3: string
  matchedFields: string[]
  isExact: boolean
}

const TYPE_COLOR: Record<string, string> = {
  PRT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PM:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  LAB: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  SVC: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  CLN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  TRP: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACC: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const FIELD_LABEL: Record<string, { label: string; color: string }> = {
  "เบอร์อะไหล่":        { label: "เบอร์ตรง",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  "เบอร์แท้อ้างอิง":   { label: "OEM ref",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  "เบอร์เทียบอ้างอิง": { label: "เทียบได้",    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
}

function highlight(text: string, q: string) {
  if (!q || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function OeSearchPage() {
  const [q,       setQ]       = useState("")
  const [input,   setInput]   = useState("")
  const [items,   setItems]   = useState<MatchedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function doSearch(val: string) {
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim()) { setItems([]); setSearched(false); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      setQ(val.trim())
      const res  = await fetch(`/api/sku/oe-search?q=${encodeURIComponent(val.trim())}`)
      const data = await res.json()
      setItems(data.items ?? [])
      setSearched(true)
      setLoading(false)
    }, 350)
  }

  function clear() { setInput(""); setQ(""); setItems([]); setSearched(false) }

  const exactMatches  = items.filter((i) => i.isExact)
  const partialMatches = items.filter((i) => !i.isExact)

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">OE Cross-Reference Search</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          ค้นหาอะไหล่จากเบอร์อะไหล่, เบอร์แท้อ้างอิง (OEM), หรือเบอร์เทียบ — ระบบจะหา SKU ที่มีเบอร์เดียวกัน
        </p>
      </div>

      {/* Search box */}
      <div className="relative max-w-xl mb-6">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          autoFocus
          value={input}
          onChange={(e) => { setInput(e.target.value); doSearch(e.target.value) }}
          placeholder="พิมพ์เบอร์อะไหล่ เช่น 23401-E0300, 16010-E0170 ..."
          className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 shadow-sm"
        />
        {input && (
          <button onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-xs text-gray-400 dark:text-gray-500">ประเภทการจับคู่:</span>
        {Object.entries(FIELD_LABEL).map(([, { label, color }]) => (
          <span key={label} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${color}`}>
            <Tag size={9} />{label}
          </span>
        ))}
      </div>

      {/* Results */}
      {loading && (
        <div className="text-sm text-gray-400 py-8 text-center">กำลังค้นหา...</div>
      )}

      {!loading && searched && items.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-6 py-16 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">ไม่พบ SKU ที่มีเบอร์ <span className="font-mono font-semibold text-gray-900 dark:text-white">{q}</span></p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">ลองค้นด้วยเบอร์บางส่วน เช่น "E0300" แทน "23401-E0300"</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-6">
          {/* Summary bar */}
          <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
            <CheckCircle size={14} className="text-emerald-500 shrink-0" />
            พบ <span className="font-semibold text-gray-900 dark:text-white">{items.length}</span> รายการที่มีเบอร์
            <span className="font-mono font-semibold text-gray-900 dark:text-white">{q}</span>
            {exactMatches.length > 0 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">({exactMatches.length} ตรงเป๊ะ)</span>
            )}
          </div>

          {/* Exact matches */}
          {exactMatches.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">
                ตรงเป๊ะ ({exactMatches.length})
              </h2>
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
                <ResultTable items={exactMatches} q={q} />
              </div>
            </section>
          )}

          {/* Partial matches */}
          {partialMatches.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                เบอร์ใกล้เคียง ({partialMatches.length})
              </h2>
              <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
                <ResultTable items={partialMatches} q={q} />
              </div>
            </section>
          )}
        </div>
      )}

      {/* Empty state — before search */}
      {!loading && !searched && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/8 px-6 py-16 text-center">
          <Layers size={36} className="mx-auto mb-3 text-gray-300 dark:text-gray-700" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">พิมพ์เบอร์อะไหล่เพื่อค้นหา Cross-Reference</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            ระบบจะค้นหาจาก เบอร์อะไหล่ · เบอร์แท้อ้างอิง · เบอร์เทียบ
          </p>
        </div>
      )}
    </div>
  )
}

function ResultTable({ items, q }: { items: MatchedItem[]; q: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
            {["SKU", "ชื่ออะไหล่", "เบอร์อะไหล่", "เบอร์แท้", "เบอร์เทียบ", "ประเภท", "ยี่ห้อ", "ราคา", "จับคู่จาก", ""].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => {
            const compatArr = Array.isArray(row.เบอร์เทียบอ้างอิง) ? row.เบอร์เทียบอ้างอิง : row.เบอร์เทียบอ้างอิง ? [row.เบอร์เทียบอ้างอิง] : []
            return (
              <tr key={row.SKU} className={`border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-white/1"}`}>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-900 dark:text-white whitespace-nowrap">{row.SKU}</td>
                <td className="px-3 py-2.5 text-gray-900 dark:text-white max-w-[180px] truncate">{row.ชื่ออะไหล่_TH}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  {highlight(row.เบอร์อะไหล่ ?? "—", q)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {row.เบอร์แท้อ้างอิง ? highlight(row.เบอร์แท้อ้างอิง, q) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {compatArr.length > 0
                    ? <div className="flex flex-wrap gap-1">{compatArr.map((c) => <span key={c} className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300">{highlight(c, q)}</span>)}</div>
                    : <span className="text-gray-300 dark:text-gray-700 text-xs">—</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? ""}`}>{row.ประเภทค่าใช้จ่าย}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.ยี่ห้อ || "—"}</td>
                <td className="px-3 py-2.5 text-right text-xs text-gray-900 dark:text-white whitespace-nowrap">
                  {row.ราคาต่อหน่วย > 0 ? row.ราคาต่อหน่วย.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                    {row.matchedFields.map((f) => {
                      const cfg = FIELD_LABEL[f]
                      return cfg ? (
                        <span key={f} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.color}`}>
                          <Tag size={8} />{cfg.label}
                        </span>
                      ) : null
                    })}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/sku/${row.SKU}`} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                    <ExternalLink size={13} />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
