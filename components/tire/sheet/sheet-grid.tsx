"use client"

/**
 * ตารางแก้ได้แบบชีต — ใช้ร่วมกันทุกแท็บของทะเบียนยางสระบุรี (เตรียมข้อมูล / 11R22.5 / 1000-20 / จัดเก็บ / ขายเหมา)
 * พิมพ์ทับในช่องแล้วออกจากช่อง = บันทึกทันที (เหมือนชีต) · ช่องสีเทา = ระบบคิดให้ แก้ไม่ได้
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Plus, Trash2, Send, DatabaseZap, Search, ChevronLeft, ChevronRight, Download } from "lucide-react"
import * as XLSX from "xlsx"
import { swalToast, swalDeleteConfirm } from "@/lib/swal"
import {
  KIND_COLS, atmsFill, atmsHints, fmtDate, toNum, sizeFromText,
  type AnyRow, type SheetCol, type SheetKind, type SheetOptions, type AtmsSnapshot,
} from "@/lib/tyre-sheet"

type Props = {
  kind: SheetKind
  stage?: "prep" | "sent"
  size?: string
  /** ตารางยางนอกรวม: มีปุ่มกรองตามประเภทยาง */
  sizeFilter?: boolean
  options: SheetOptions
  title: string
}

const fmtNum = (n: unknown, digits = 0) => {
  const v = toNum(n)
  if (v === null) return ""
  return v.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** ค่าที่โชว์ในช่อง (แบบเดียวกับที่ชีตโชว์) */
function display(c: SheetCol, v: unknown): string {
  if (v === null || v === undefined) return ""
  if (c.type === "date") return fmtDate(v)
  if (c.type === "num") {
    if (c.key === "bpk") return fmtNum(v, 4)
    if (c.key === "summary") { const n = toNum(v); return n === null ? "" : `${(n * 100).toFixed(2)}%` }
    if (c.key === "price" || c.key === "salePrice" || c.key === "unitPrice" || c.key === "total" || c.key === "lumpPrice" || c.key === "refPrice" || c.key === "marketPrice") return fmtNum(v, 2)
    if (c.key === "expectedKm") return fmtNum(v, 0)
    return String(toNum(v) ?? "")
  }
  return String(v)
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `ทำรายการไม่สำเร็จ (${res.status})`)
  return data as T
}

export function SheetGrid({ kind, stage, size: sizeProp, sizeFilter = false, options, title }: Props) {
  const cols = KIND_COLS[kind]
  const [rows, setRows] = useState<AnyRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [q, setQ] = useState("")
  const [qInput, setQInput] = useState("")
  const [month, setMonth] = useState("")
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mrInput, setMrInput] = useState("")
  const [busy, setBusy] = useState("")
  const [size, setSize] = useState(sizeProp ?? "")

  const isPrep = kind === "rows" && stage === "prep"
  const isRows = kind === "rows"

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ page: String(page), limit: isPrep ? "500" : "200" })
      if (stage) sp.set("stage", stage)
      if (size) sp.set("size", size)
      if (q) sp.set("q", q)
      if (month) sp.set("month", month)
      const d = await api<{ rows: AnyRow[]; total: number; pages: number }>(`/api/tyre-sheet/${kind}?${sp}`)
      setRows(d.rows); setTotal(d.total); setPages(d.pages)
    } catch (e) {
      swalToast("error", (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [kind, stage, size, q, month, page, isPrep])

  // เรียกผ่าน setTimeout(0) ตาม lint rule ของ repo: react-hooks/set-state-in-effect
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const replaceRow = (row: AnyRow) => setRows((rs) => rs.map((r) => (String(r._id) === String(row._id) ? row : r)))

  const saveCell = async (row: AnyRow, c: SheetCol, value: string) => {
    if (value === display(c, row[c.key])) return
    try {
      const d = await api<{ row: AnyRow }>(`/api/tyre-sheet/${kind}/${row._id}`, { method: "PATCH", body: JSON.stringify({ [c.key]: value }) })
      // แถวที่ส่งแล้วแต่แก้ชนิดยางเป็นอีกไซซ์ จะย้ายไปอีกตาราง
      if (!isPrep && size && d.row.size && d.row.size !== size) {
        setRows((rs) => rs.filter((r) => String(r._id) !== String(row._id)))
        swalToast("info", `ย้ายไปตาราง ${d.row.size} แล้ว`)
      } else replaceRow(d.row)
    } catch (e) {
      swalToast("error", (e as Error).message)
      load()
    }
  }

  const addRow = async () => {
    try {
      await api(`/api/tyre-sheet/${kind}`, { method: "POST", body: JSON.stringify({ rows: [{}] }) })
      await load()
    } catch (e) { swalToast("error", (e as Error).message) }
  }

  const delRow = async (row: AnyRow) => {
    const label = isRows ? `${row.plate || "-"} ${row.position || ""} ${row.mrNo || ""}` : (row.serial || row.item || "แถวนี้")
    const ok = await swalDeleteConfirm(`ลบแถว ${label} ?`)
    if (!ok.isConfirmed) return
    try {
      await api(`/api/tyre-sheet/${kind}/${row._id}`, { method: "DELETE" })
      setRows((rs) => rs.filter((r) => String(r._id) !== String(row._id)))
    } catch (e) { swalToast("error", (e as Error).message) }
  }

  /** ปุ่ม ATMS ต่อแถว: เติมเฉพาะช่องที่ว่าง ช่องที่กรอกแล้วแต่ไม่ตรง = ขึ้นคำแนะนำ */
  const fillFromAtms = async (row: AnyRow) => {
    if (!row.mrNo) { swalToast("warning", "ใส่ NO.ใบแจ้งซ่อม ก่อน แล้วค่อยกดดึงจาก ATMS"); return }
    setBusy(String(row._id))
    try {
      const sp = new URLSearchParams({ mr: row.mrNo, plate: row.plate ?? "", position: row.position ?? "" })
      const d = await api<{ found: boolean; snapshot: AtmsSnapshot | null }>(`/api/tyre-sheet/atms?${sp}`)
      if (!d.found || !d.snapshot) { swalToast("warning", `ไม่เจอ ${row.mrNo} ใน ATMS`); return }
      const patch = atmsFill(row, d.snapshot)
      const r = await api<{ row: AnyRow }>(`/api/tyre-sheet/rows/${row._id}`, { method: "PATCH", body: JSON.stringify({ ...patch, atms: d.snapshot }) })
      replaceRow(r.row)
      const n = Object.keys(patch).length
      const hints = atmsHints(r.row).length
      swalToast("success", `เติม ${n} ช่องจาก ATMS${hints ? ` · มี ${hints} ช่องที่ไม่ตรงกับ ATMS (ดูตัวสีส้ม)` : ""}`)
    } catch (e) {
      swalToast("error", (e as Error).message)
    } finally { setBusy("") }
  }

  /** เพิ่มแถวจาก MR: 1 แถวต่อยาง 1 เส้นที่เบิกในใบนั้น (ตำแหน่ง/ยางเก่า/มิลยาง ยังกรอกเอง) */
  const addFromMr = async () => {
    const mr = mrInput.trim().toUpperCase()
    if (!mr) return
    setBusy("mr")
    try {
      const d = await api<{ found: boolean; snapshot: AtmsSnapshot | null; tyres: { serial: string; price: number | null; product: string }[] }>(`/api/tyre-sheet/atms?mr=${encodeURIComponent(mr)}`)
      if (!d.found || !d.snapshot) { swalToast("warning", `ไม่เจอ ${mr} ใน ATMS`); return }
      const s = d.snapshot
      const base = { mrNo: mr, bookingDate: s.bookingDate, driver: s.driver, plate: s.plate, mileageBooking: s.mileageBooking, mileageChange: s.mileageChange }
      const list = d.tyres.length ? d.tyres : [{ serial: "", price: s.price ?? null, product: s.tyreType ?? "" }]
      const newRows = list.map((t) => ({ ...base, tyreType: t.product, price: t.price, newSerial: t.serial, atms: { ...s, price: t.price ?? s.price } }))
      await api(`/api/tyre-sheet/rows`, { method: "POST", body: JSON.stringify({ rows: newRows }) })
      setMrInput("")
      swalToast("success", `เพิ่ม ${newRows.length} แถวจาก ${mr} · กรอกตำแหน่ง เบอร์ยางเก่า มิลยาง กลุ่มอาการต่อได้เลย`)
      await load()
    } catch (e) {
      swalToast("error", (e as Error).message)
    } finally { setBusy("") }
  }

  const sendSelected = async () => {
    const ids = [...selected]
    if (!ids.length) { swalToast("warning", "ติ๊กเลือกแถวที่จะส่งก่อน"); return }
    setBusy("send")
    try {
      const d = await api<{ total: number; bySize: Record<string, number>; skipped: string[] }>(`/api/tyre-sheet/send`, { method: "POST", body: JSON.stringify({ ids }) })
      const parts = Object.entries(d.bySize).map(([k, v]) => `${k}: ${v}`).join(" · ")
      swalToast(d.skipped.length ? "warning" : "success", `ส่งแล้ว ${d.total} แถว${parts ? ` (${parts})` : ""}${d.skipped.length ? ` · ข้าม ${d.skipped.length} แถวที่ยังไม่เลือกชนิดยาง` : ""}`)
      setSelected(new Set())
      await load()
    } catch (e) {
      swalToast("error", (e as Error).message)
    } finally { setBusy("") }
  }

  const exportXlsx = () => {
    const aoa = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => {
      const v = r[c.key]
      if (c.type === "date") return fmtDate(v)
      if (c.type === "num") return toNum(v)
      return v ?? ""
    }))]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "data")
    XLSX.writeFile(wb, `${(size ? `${title} ${size}` : title).replace(/[\\/:*?"<>|]/g, "-")}.xlsx`)
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(String(r._id)))
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => String(r._id))))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const datalists = useMemo(() => {
    const keys = [...new Set(cols.map((c) => c.options).filter(Boolean))] as (keyof SheetOptions)[]
    return keys.map((k) => {
      const list = options[k]
      return Array.isArray(list) ? (
        <datalist key={k} id={`tyre-opt-${k}`}>{list.map((o) => <option key={o} value={o} />)}</datalist>
      ) : null
    })
  }, [cols, options])

  return (
    <div className="space-y-3">
      {datalists}
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(1) }}>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={isRows ? "ค้นหา ทะเบียน / MR / เบอร์ยาง / พจส. / PR" : "ค้นหา"}
              className="pl-7 pr-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5 w-72" />
          </div>
        </form>
        {sizeFilter && (
          <div className="inline-flex rounded-md border border-gray-300 dark:border-white/15 overflow-hidden text-sm">
            {["", ...options.tyreTypes.map((t) => sizeFromText(t)).filter((s, i, a): s is NonNullable<typeof s> => !!s && a.indexOf(s) === i).sort((x, y) => (x === "11R22.5" ? -1 : y === "11R22.5" ? 1 : 0))].map((s) => (
              <button key={s || "all"} onClick={() => { setSize(s); setPage(1) }}
                className={`px-3 py-1.5 ${size === s ? "bg-blue-600 text-white" : "hover:bg-gray-50 dark:hover:bg-white/10"}`}>
                {s || "ทุกประเภท"}
              </button>
            ))}
          </div>
        )}
        {isRows && !isPrep && (
          <label className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
            เดือนที่จอง
            <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }}
              className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5" />
          </label>
        )}
        <button onClick={load} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> โหลดใหม่
        </button>
        <button onClick={exportXlsx} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10">
          <Download className="w-4 h-4" /> Excel (หน้านี้)
        </button>
        <div className="flex-1" />
        {isPrep && (
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); addFromMr() }}>
            <input value={mrInput} onChange={(e) => setMrInput(e.target.value)} placeholder="SBMR26100329"
              className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5 w-36 uppercase" />
            <button type="submit" disabled={busy === "mr"} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-blue-300 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50">
              <DatabaseZap className="w-4 h-4" /> เพิ่มแถวจาก MR (ATMS)
            </button>
          </form>
        )}
        {(isPrep || kind !== "rows") && (
          <button onClick={addRow} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/10">
            <Plus className="w-4 h-4" /> เพิ่มแถวว่าง
          </button>
        )}
        {isPrep && (
          <button onClick={sendSelected} disabled={busy === "send" || !selected.size}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            <Send className="w-4 h-4" /> ส่งข้อมูล ({selected.size})
          </button>
        )}
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">
        {total.toLocaleString("th-TH")} แถว · พิมพ์ทับแล้วกดออกจากช่องเพื่อบันทึก · ช่องสีเทาระบบคิดให้
        {isPrep && " · ปุ่ม ATMS เติมเฉพาะช่องที่ยังว่าง ช่องที่กรอกแล้วไม่ตรงจะขึ้นตัวสีส้มให้ดู"}
      </div>

      <div className="overflow-auto max-h-[70vh] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02]">
        <table className="text-xs border-collapse" style={{ minWidth: cols.reduce((a, c) => a + (c.width ?? 100), 120) }}>
          <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-[#1f2430]">
            <tr>
              {isPrep && (
                <th className="border border-gray-200 dark:border-white/10 px-1 w-8">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="เลือกทั้งหมด" />
                </th>
              )}
              <th className="border border-gray-200 dark:border-white/10 px-1 w-[72px]"></th>
              {cols.map((c) => (
                <th key={c.key} style={{ width: c.width, minWidth: c.width }}
                  className={`border border-gray-200 dark:border-white/10 px-1.5 py-1.5 font-semibold text-left align-bottom leading-tight ${c.computed ? "text-gray-500" : ""} ${c.key === "newSerial" ? "text-blue-700 dark:text-blue-300" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = String(r._id)
              const hints = isRows ? atmsHints(r) : []
              const hintOf = (k: string) => hints.find((h) => h.key === k)
              return (
                <tr key={`${id}-${r.updatedAt ?? ""}`} className="hover:bg-blue-50/40 dark:hover:bg-white/5">
                  {isPrep && (
                    <td className="border border-gray-200 dark:border-white/10 text-center">
                      <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label="เลือกแถว" />
                    </td>
                  )}
                  <td className="border border-gray-200 dark:border-white/10 px-1 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {isRows && (
                        <button onClick={() => fillFromAtms(r)} disabled={busy === id} title="ดึงจาก ATMS (เติมเฉพาะช่องที่ว่าง)"
                          className="px-1 py-0.5 rounded text-[10px] font-semibold border border-blue-300 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-40">
                          {busy === id ? "…" : "ATMS"}
                        </button>
                      )}
                      <button onClick={() => delRow(r)} title="ลบแถว" className="p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  {cols.map((c) => {
                    const v = display(c, r[c.key])
                    if (c.computed) {
                      return (
                        <td key={c.key} className="border border-gray-200 dark:border-white/10 px-1.5 py-1 bg-gray-50 dark:bg-white/[0.03] text-gray-600 dark:text-gray-400 text-right whitespace-nowrap">
                          {v}
                        </td>
                      )
                    }
                    const h = hintOf(c.key)
                    return (
                      <td key={c.key} className={`border border-gray-200 dark:border-white/10 p-0 align-top ${h ? "bg-amber-50 dark:bg-amber-900/20" : ""}`}>
                        <input
                          defaultValue={v}
                          list={c.options ? `tyre-opt-${c.options}` : undefined}
                          placeholder={c.type === "date" ? "วว/ดด/ปปปป" : undefined}
                          onBlur={(e) => saveCell(r, c, e.currentTarget.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur() }}
                          className={`w-full bg-transparent px-1.5 py-1 outline-none focus:bg-blue-50 dark:focus:bg-blue-900/30 focus:ring-1 focus:ring-blue-400 ${c.type === "num" ? "text-right" : ""}`}
                        />
                        {h && (
                          <button
                            title={`ATMS บอก ${h.atms} · กดเพื่อใช้ค่าของ ATMS`}
                            onClick={() => saveCell(r, c, String(h.atms).replace(/,/g, ""))}
                            className="block w-full text-left px-1.5 pb-0.5 text-[10px] text-amber-700 dark:text-amber-300 hover:underline">
                            ATMS: {h.atms}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={cols.length + 2} className="text-center text-gray-400 py-10">ยังไม่มีข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1 rounded border border-gray-300 dark:border-white/15 disabled:opacity-40" aria-label="หน้าก่อน"><ChevronLeft className="w-4 h-4" /></button>
          หน้า {page} / {pages}
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1 rounded border border-gray-300 dark:border-white/15 disabled:opacity-40" aria-label="หน้าถัดไป"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  )
}
