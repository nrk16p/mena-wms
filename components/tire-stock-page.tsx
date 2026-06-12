"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Search, Plus, Pencil, Trash2, Disc3, Download } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import * as XLSX from "xlsx"

type TireStock = {
  _id:         string
  branch:      string
  prCode:      string
  ddCode:      string
  depositDate: string
  productCode: string
  productName: string
  serialNo:    string
  unitPrice:   number
  brand:       string
  tireSize:    string
  tireModel:   string
  distance:    number
  status:      string
  tireType:      string
  warrantyUntil: string
}

const STATUS_OPTIONS = ["In Stock", "เบิกใช้แล้ว", "เคลม", "ขายแล้ว"]
const TIRE_TYPES     = ["เรเดียล", "ผ้าใบ"]

const EMPTY: Omit<TireStock, "_id" | "branch"> = {
  prCode: "", ddCode: "", depositDate: "", productCode: "", productName: "",
  serialNo: "", unitPrice: 0, brand: "", tireSize: "", tireModel: "",
  distance: 0, status: "In Stock", tireType: "", warrantyUntil: "",
}

const fmtNum = (n: number) =>
  (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtInt = (n: number) => (n ?? 0).toLocaleString("th-TH")

function statusChip(status: string) {
  switch (status) {
    case "In Stock":   return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    case "เบิกใช้แล้ว": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    case "เคลม":       return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
    case "ขายแล้ว":    return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
    default:           return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
  }
}

export function TireStockPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const [items, setItems]           = useState<TireStock[]>([])
  const [loading, setLoading]       = useState(true)
  const [q, setQ]                   = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [editId, setEditId]         = useState<string | null>(null)
  const [form, setForm]             = useState(EMPTY)
  const [saving, setSaving]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ branch })
    if (q)            qs.set("q", q)
    if (statusFilter) qs.set("status", statusFilter)
    const res  = await fetch(`/api/tire-stock?${qs}`)
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [branch, q, statusFilter])

  useEffect(() => { load() }, [load])

  const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"

  function setF(k: string, v: string | number) { setForm((p) => ({ ...p, [k]: v })) }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setSaving(true)
    const res = await fetch(`/api/tire-stock/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) { swalError("บันทึกไม่สำเร็จ"); return }
    setEditId(null)
    swalToast("success", "บันทึกสำเร็จ")
    load()
  }

  async function handleDelete(item: TireStock) {
    const result = await swalDeleteConfirm(`ลบรายการ Serial No "${item.serialNo}"?`)
    if (!result.isConfirmed) return
    await fetch(`/api/tire-stock/${item._id}`, { method: "DELETE" })
    swalToast("success", "ลบรายการสำเร็จ")
    load()
  }

  function startEdit(item: TireStock) {
    setEditId(item._id)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, branch: _b, ...rest } = item
    setForm({ ...EMPTY, ...rest })
  }

  function exportToExcel() {
    const rows = items.map((t) => ({
      "PR Code":      t.prCode,
      "DD Code":      t.ddCode,
      "Deposit Date": t.depositDate,
      "รหัสสินค้า":    t.productCode,
      "ชื่อสินค้า":    t.productName,
      "Serial No":    t.serialNo,
      "Unit Price":   t.unitPrice,
      "ยี่ห้อ":        t.brand,
      "ขนาดยาง":      t.tireSize,
      "รุ่นยาง":       t.tireModel,
      "ระยะทาง":      t.distance,
      "Status":       t.status,
      "ประเภทยาง":    t.tireType,
      "วันหมดประกัน":  t.warrantyUntil,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "TireStock")
    XLSX.writeFile(wb, `tire-stock-${branch}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // plain JSX (not a nested component) so inputs keep focus across re-renders
  const formFields = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">PR Code</label>
          <input value={form.prCode} onChange={(e) => setF("prCode", e.target.value)} className={inp} placeholder="PR-2026-001" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">DD Code</label>
          <input value={form.ddCode} onChange={(e) => setF("ddCode", e.target.value)} className={inp} placeholder="DD-2026-001" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Deposit Date</label>
          <input type="date" value={form.depositDate} onChange={(e) => setF("depositDate", e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Serial No *</label>
          <input value={form.serialNo} onChange={(e) => setF("serialNo", e.target.value)} className={inp} required placeholder="SN123456" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">รหัสสินค้า</label>
          <input value={form.productCode} onChange={(e) => setF("productCode", e.target.value)} className={inp} placeholder="TR-001" />
        </div>
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ชื่อสินค้า</label>
          <input value={form.productName} onChange={(e) => setF("productName", e.target.value)} className={inp} placeholder="ยางรถบรรทุก 11R22.5" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ยี่ห้อ</label>
          <input value={form.brand} onChange={(e) => setF("brand", e.target.value)} className={inp} placeholder="Bridgestone" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ขนาดยาง</label>
          <input value={form.tireSize} onChange={(e) => setF("tireSize", e.target.value)} className={inp} placeholder="11R22.5" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">รุ่นยาง</label>
          <input value={form.tireModel} onChange={(e) => setF("tireModel", e.target.value)} className={inp} placeholder="R150" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Status</label>
          <select value={form.status} onChange={(e) => setF("status", e.target.value)} className={inp}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Unit Price</label>
          <input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setF("unitPrice", Number(e.target.value))} className={inp} placeholder="0.00" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ระยะทาง</label>
          <input type="number" step="1" min="0" value={form.distance} onChange={(e) => setF("distance", Number(e.target.value))} className={inp} placeholder="20000" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ประเภทยาง</label>
          <select value={form.tireType} onChange={(e) => setF("tireType", e.target.value)} className={inp}>
            <option value="">— เลือก —</option>
            {!TIRE_TYPES.includes(form.tireType) && form.tireType && <option value={form.tireType}>{form.tireType}</option>}
            {TIRE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">วันหมดประกัน</label>
          <input type="date" value={form.warrantyUntil} onChange={(e) => setF("warrantyUntil", e.target.value)} className={inp} />
        </div>
      </div>
    </div>
  )

  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Disc3 size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Tire Stock — {branchLabel}</h1>
        <span className="text-sm text-gray-400">({items.length} รายการ)</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        สต๊อกยางสาขา{branchLabel} — ค้นหาด้วย PR Code / DD Code / รหัสสินค้า / Serial No / ยี่ห้อ
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา PR / DD / Serial / ยี่ห้อ..." className={inp + " pl-8"} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inp + " max-w-[180px]"}>
          <option value="">— ทุกสถานะ —</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={exportToExcel}
          disabled={items.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40 transition-colors"
        >
          <Download size={14} />
          Export Excel
        </button>
        <Link
          href={`/tire/${branch}/stock-tire/new`}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3.5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          เพิ่มรายการ
        </Link>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>PR Code</th>
                <th className={th}>DD Code</th>
                <th className={th}>Deposit Date</th>
                <th className={th}>รหัสสินค้า</th>
                <th className={th}>ชื่อสินค้า</th>
                <th className={th}>Serial No</th>
                <th className={th + " text-right"}>Unit Price</th>
                <th className={th}>ยี่ห้อ</th>
                <th className={th}>ขนาดยาง</th>
                <th className={th}>รุ่นยาง</th>
                <th className={th + " text-right"}>ระยะทาง</th>
                <th className={th}>Status</th>
                <th className={th}>ประเภทยาง</th>
                <th className={th}>วันหมดประกัน</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={15} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบรายการ</td></tr>
              ) : items.map((t, i) => (
                <tr
                  key={t._id}
                  className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}
                >
                  {editId === t._id ? (
                    <td colSpan={15} className="px-3 py-3">
                      <form onSubmit={handleEdit}>
                        {formFields}
                        <div className="flex gap-2 mt-3">
                          <button type="submit" disabled={saving} className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50">
                            {saving ? "บันทึก..." : "บันทึก"}
                          </button>
                          <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
                            ยกเลิก
                          </button>
                        </div>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.prCode || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.ddCode || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.depositDate || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.productCode || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.productName || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">{t.serialNo || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 text-right whitespace-nowrap">{fmtNum(t.unitPrice)}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.brand || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.tireSize || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.tireModel || "—"}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-900 dark:text-white text-right whitespace-nowrap">{fmtInt(t.distance)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(t.status)}`}>
                          {t.status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.tireType || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.warrantyUntil || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(t)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(t)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
