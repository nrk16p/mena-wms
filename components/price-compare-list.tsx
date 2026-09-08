"use client"
// components/price-compare-list.tsx — รายการใบเทียบราคา (ดึงครั้งเดียว กรอง client-side)
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Scale, Search, Plus, Loader2 } from "lucide-react"
import { fmtMoney, PC_STATUSES, type PcStatus } from "@/lib/price-compare"
import { swalError } from "@/lib/swal"

export type PcListRow = {
  _id: string; docNo: string; title: string; requestDept: string; status: PcStatus
  preparedBy: { name: string; email: string }; updatedAt: string; createdAt: string; revision: number
  supplierCount: number; selectedSupplier: number | null; selectedName: string
  selectedNet: number | null; lowestNet: number | null
}

export const STATUS_STYLE: Record<PcStatus, string> = {
  "ร่าง":      "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200",
  "รอลงนาม":   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "เสร็จสิ้น": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
}
export function StatusChip({ status }: { status: PcStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>
}

const fmtDate = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "")
const monthOf = (docNo: string) => docNo.split("-")[1] ?? ""   // "2609"
const monthLabel = (yymm: string) => `${yymm.slice(2)}/25${yymm.slice(0, 2)}`   // "09/2569"

export function PriceCompareList() {
  const router = useRouter()
  const [rows, setRows] = useState<PcListRow[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [q, setQ] = useState("")
  const [fStatus, setFStatus] = useState("")
  const [fMonth, setFMonth] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch("/api/price-compare?limit=500")
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error((d && d.error) || `โหลดไม่สำเร็จ (${r.status})`)
        setRows(Array.isArray(d) ? d : [])
      })
      .catch((e) => { setRows([]); setLoadError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ") })
  }, [])

  const months = useMemo(() => Array.from(new Set((rows ?? []).map((r) => monthOf(r.docNo)))).sort().reverse(), [rows])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (rows ?? []).filter((r) =>
      (!fStatus || r.status === fStatus) &&
      (!fMonth || monthOf(r.docNo) === fMonth) &&
      (!t || [r.docNo, r.title, r.requestDept, r.selectedName, r.preparedBy?.name].some((v) => (v ?? "").toLowerCase().includes(t))))
  }, [rows, q, fStatus, fMonth])

  function open(r: PcListRow) {
    router.push(`/price-compare/${r.docNo}`)
  }

  async function create() {
    setCreating(true)
    try {
      const res = await fetch("/api/price-compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "สร้างไม่สำเร็จ")
      router.push(`/price-compare/${d.docNo}`)
    } catch (e) { swalError(e instanceof Error ? e.message : "สร้างไม่สำเร็จ"); setCreating(false) }
  }

  const inputCls = "rounded-lg border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2 text-sm focus:border-[#1B8C4B] focus:outline-none"

  return (
    <div className="w-full px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0E7490]/10 text-[#0E7490]"><Scale size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>ใบเทียบราคา</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">แบบบันทึกผลการเปรียบเทียบราคา (ราคา 5,000 บาทขึ้นไป)</p>
          </div>
        </div>
        <button onClick={create} disabled={creating} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} สร้างใบเทียบราคา
        </button>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เลขที่ / ชื่องาน / supplier / ผู้จัดทำ" className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
          <option value="">ทุกสถานะ</option>
          {PC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={inputCls}>
          <option value="">ทุกเดือน</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-500">
            <tr>
              {["เลขที่", "ชื่อสินค้า / งานซ่อม", "หน่วยงาน", "Supplier", "ผู้ได้รับเลือก", "สุทธิ (บาท)", "สถานะ", "ผู้จัดทำ", "แก้ไขล่าสุด"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" size={16} /> กำลังโหลด…</td></tr>}
            {rows !== null && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className={`px-3 py-8 text-center ${loadError ? "text-red-600" : "text-gray-400"}`}>
                  {loadError ? `⚠ ${loadError}` : "ไม่มีรายการ"}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr
                key={r._id}
                tabIndex={0}
                role="link"
                aria-label={`เปิด ${r.docNo}`}
                onClick={() => open(r)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(r) } }}
                className="cursor-pointer border-t border-[#EEF2F0] dark:border-white/8 hover:bg-[#F6FAF7] dark:hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B]"
              >
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.docNo}</td>
                <td className="px-3 py-2 font-medium">{r.title || <span className="text-gray-400">(ยังไม่ระบุ)</span>}</td>
                <td className="px-3 py-2">{r.requestDept}</td>
                <td className="px-3 py-2 text-center">{r.supplierCount}</td>
                <td className="px-3 py-2">{r.selectedSupplier ? `${r.selectedSupplier}. ${r.selectedName}` : <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.selectedNet != null ? fmtMoney(r.selectedNet) : r.lowestNet != null ? <span className="text-gray-400" title="สุทธิต่ำสุด (ยังไม่เลือก)">{fmtMoney(r.lowestNet)}</span> : ""}
                </td>
                <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.preparedBy?.name}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{fmtDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
