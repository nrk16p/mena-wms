"use client"

import { useState } from "react"
import { Search, X } from "lucide-react"
import { looksLikeMrCode, parseMrHead, parseMrRow, type MrHead, type MrRow } from "@/lib/store-withdraw/mr-row"
import { useLookup } from "./use-lookup"

export type MrItem = MrRow

type Row = Record<string, unknown>

const inputCls =
  "w-full rounded-md border border-[#D5DCD8] dark:border-white/10 bg-white dark:bg-[#0f1117] pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

/** ค้น MR (ใบแจ้งซ่อม) แล้วเลือกรายการใน MR · onPick ส่งรายการทุกบรรทัดของ MR เดียวกับที่เลือกกลับไป */
export function MrPicker({ mrCode, plate = "", onPick, onClear }: {
  mrCode: string
  plate?: string
  onPick: (mrCode: string, items: MrItem[]) => void
  onClear: () => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickErr, setPickErr] = useState("")
  const typed = q.trim()
  const byCode = looksLikeMrCode(typed)
  // ว่างไว้ = ใช้ทะเบียนจากช่องด้านบน · พิมพ์เลข MR = ค้นรายการแบบเดิม · พิมพ์อย่างอื่น = ทะเบียน/เบอร์รถอื่น
  const headTerm = byCode ? "" : typed || plate.trim()
  const item = useLookup<Row>("mr", byCode ? typed : "")
  const head = useLookup<Row>("mrv", headTerm)
  const { loading, error, tooShort } = byCode ? item : head
  const items = byCode ? item.rows.map(parseMrRow).filter((x): x is MrItem => x !== null) : []
  const heads = byCode ? [] : head.rows.map(parseMrHead).filter((x): x is MrHead => x !== null).slice(0, 5)

  // เลือกหัว MR แล้วค่อยโหลดรายการในใบ ด้วยการค้นรายการเดิม (เอาเฉพาะแถวที่เลข MR ตรง)
  async function pickHead(h: MrHead) {
    setPicking(true); setPickErr("")
    try {
      const r = await fetch(`/api/store-withdraw/lookup/mr?${new URLSearchParams({ q: h.code, limit: "50" })}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดรายการใน MR ไม่สำเร็จ")
      const rows = ((j.results ?? []) as Row[]).map(parseMrRow).filter((x): x is MrItem => x !== null && x.mrCode === h.code)
      onPick(h.code, rows)
      setQ(""); setOpen(false)
    } catch (e) {
      setPickErr(e instanceof Error ? e.message : "โหลดรายการใน MR ไม่สำเร็จ")
    } finally { setPicking(false) }
  }

  if (mrCode) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-[#1B8C4B]/40 bg-[#1B8C4B]/5 px-3.5 py-2.5 text-sm">
        <span className="font-medium text-[#14271C] dark:text-white">{mrCode}</span>
        <button type="button" onClick={onClear} aria-label="ล้าง MR" className="text-gray-500 hover:text-red-600"><X size={16} /></button>
      </div>
    )
  }

  const pickManual = () => { const c = typed; if (c) { onPick(c, []); setQ(""); setOpen(false) } }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        className={inputCls}
        placeholder={plate.trim() ? "เลือก MR ของรถคันนี้" : "ค้นเลข MR หรือทะเบียนรถ"}
        value={q}
        onChange={(e) => { setQ(e.target.value); setPickErr(""); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (typed.length > 0 || headTerm.length > 0) && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[#D5DCD8] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
          {tooShort && <p className="px-3 py-2 text-xs text-gray-500">พิมพ์อีกนิดนะ ต้อง 2 ตัวขึ้นไป</p>}
          {!tooShort && loading && <p className="px-3 py-2 text-xs text-gray-500">กำลังค้น…</p>}
          {!tooShort && !loading && error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
          {!tooShort && !loading && !error && items.length === 0 && heads.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">ไม่เจอ MR ที่ค้น</p>}
          {pickErr && <p className="px-3 py-2 text-xs text-red-600">{pickErr}</p>}
          {picking && <p className="px-3 py-2 text-xs text-gray-500">กำลังโหลดรายการใน MR…</p>}
          {!loading && heads.map((h) => (
            <button key={h.code} type="button" disabled={picking} onMouseDown={(e) => e.preventDefault()} onClick={() => pickHead(h)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10 disabled:opacity-60">
              <span className="block truncate font-medium text-gray-900 dark:text-white">{h.code}{h.date && <span className="font-normal text-gray-500"> · {h.date}</span>}</span>
              <span className="block truncate text-xs text-gray-500">
                {[h.plate, h.step, h.driver && `คนขับ ${h.driver}`, h.mechanic && `ช่าง ${h.mechanic}`].filter(Boolean).join(" · ")}
              </span>
              {h.items.length > 0 ? (
                <span className="mt-1 block space-y-1">
                  {h.items.slice(0, 3).map((i, n) => (
                    <span key={n} className="block whitespace-normal break-words text-xs">
                      {i.type && <span className="block font-medium text-gray-800 dark:text-gray-200">{i.type}</span>}
                      {i.detail && <span className="block line-clamp-2 text-gray-500">{i.detail}</span>}
                    </span>
                  ))}
                  {h.items.length > 3 && <span className="block text-xs text-gray-400">และอีก {h.items.length - 3} รายการ</span>}
                </span>
              ) : h.remark && <span className="mt-0.5 line-clamp-3 whitespace-normal break-words text-xs text-gray-500">{h.remark}</span>}
            </button>
          ))}
          {!loading && items.map((it) => (
            <button
              key={it.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const code = it.mrCode || typed
                const same = items.filter((x) => (x.mrCode || typed) === code)
                onPick(code, same)
                setQ(""); setOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#1B8C4B]/10"
            >
              <span className="block truncate text-gray-900 dark:text-white">{it.label}</span>
              {it.mrCode && <span className="block text-xs text-gray-500">{it.mrCode}</span>}
            </button>
          ))}
          {typed && !tooShort && !loading && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={pickManual}
              className="mt-1 block w-full rounded-lg border-t border-[#EEF2F0] px-3 py-2 text-left text-xs text-[#1B8C4B] hover:bg-[#1B8C4B]/10 dark:border-white/10">
              ใช้เลข &quot;{q.trim()}&quot; ตามที่พิมพ์
            </button>
          )}
        </div>
      )}
    </div>
  )
}
