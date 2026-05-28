"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, Plus, Pencil, Trash2, Check, X, Car, ChevronDown, ChevronUp } from "lucide-react"

type Vehicle = {
  plate:        string
  fleetNo:      string
  fleet:        string
  brand:        string
  branch:       string
  vehicleType:  string
  model:        string
  engineNo:     string
  chassisNo:    string
  fuelType:     string
  year:         string
  ownership:    string
  note:         string
  hasPump:      boolean
  isTrailer:    boolean
}

const VEHICLE_TYPES = [
  "Mixer 10 ล้อ", "Mixer 6 ล้อ", "รถหลอก", "กล้วยหอม 3 เพลา", "กล้วยหอม 2 เพลา",
  "ลากจูง Oil", "ลากจูง Ngv", "ลากจูง OIL  ADBLUE",
  "หาง Side Curtain 3 เพลา (น้ำหนักหาง<10000)", "หาง Side Curtain 3 เพลา",
  "หางเบ้าท์ 2 เพลาขนอาหาร", "หางเบาท์ 3 เพลา ขนอาหารสัตว์",
  "หัวเบ้าท์ขนอาหาร", "หัวเบาท์ 12 ล้อ ขนอาหารสัตว์",
  "รถ 6 ล้อ ตู้แห้ง", "รถ 6 ล้อ ตู้แห้ง ท้ายลิฟท์",
  "รถ 10 ล้อตู้แห้ง 7.5 ม.", "รถ10ล้อ ตู้เย็น 9.5 เมตร", "รถ10ล้อ ตู้เย็น 7.5 เมตร",
  "รถ12ล้อ ตู้เย็น 9.5 เมตร", "รถสำนักงาน",
]
const FUEL_TYPES = ["ดีเซล", "NGV", "ไม่ใช้เชื้อเพลิง"]

const EMPTY: Omit<Vehicle, "plate"> = {
  fleetNo: "", fleet: "", brand: "", branch: "", vehicleType: "",
  model: "", engineNo: "", chassisNo: "", fuelType: "ดีเซล",
  year: "", ownership: "", note: "", hasPump: false, isTrailer: false,
}

export default function VehiclesPage() {
  const [items, setItems]         = useState<Vehicle[]>([])
  const [loading, setLoading]     = useState(true)
  const [q, setQ]                 = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [showAdd, setShowAdd]     = useState(false)
  const [editPlate, setEditPlate] = useState<string | null>(null)
  const [form, setForm]           = useState<Omit<Vehicle, "plate"> & { plate?: string }>(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [addError, setAddError]   = useState("")
  const [expandedPlate, setExpandedPlate] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (q)          qs.set("q", q)
    if (typeFilter) qs.set("type", typeFilter)
    qs.set("limit", "200")
    const res = await fetch(`/api/vehicles?${qs}`)
    const data = await res.json()
    setItems(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [q, typeFilter])

  useEffect(() => { load() }, [load])

  const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"

  function setF(k: string, v: string | boolean) { setForm((p) => ({ ...p, [k]: v })) }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError("")
    setSaving(true)
    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json(); setAddError(d.error ?? "เกิดข้อผิดพลาด"); return }
    setShowAdd(false)
    setForm(EMPTY)
    load()
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editPlate) return
    setSaving(true)
    await fetch(`/api/vehicles/${encodeURIComponent(editPlate)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setEditPlate(null)
    load()
  }

  async function handleDelete(plate: string) {
    if (!confirm(`ลบยานพาหนะ "${plate}"?`)) return
    await fetch(`/api/vehicles/${encodeURIComponent(plate)}`, { method: "DELETE" })
    load()
  }

  function startEdit(v: Vehicle) {
    setEditPlate(v.plate)
    setForm({ ...v })
    setShowAdd(false)
  }

  function cancelEdit() { setEditPlate(null) }

  const typeChip = (type: string) => {
    const isMixer   = type.includes("Mixer")
    const isTrailer = type.includes("หาง") || type.includes("หัวเบ้า") || type.includes("หัวเบาท์") || type.includes("ลากจูง")
    if (isMixer)   return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    if (isTrailer) return "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
    return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
  }

  const FormFields = ({ isEdit }: { isEdit: boolean }) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {!isEdit && (
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">ทะเบียน *</label>
            <input value={form.plate ?? ""} onChange={(e) => setF("plate", e.target.value)} className={inp} required placeholder="สบ.71-1234" />
          </div>
        )}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">เลขรถ</label>
          <input value={form.fleetNo} onChange={(e) => setF("fleetNo", e.target.value)} className={inp} placeholder="112" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ประเภทยานพาหนะ *</label>
          <select value={form.vehicleType} onChange={(e) => setF("vehicleType", e.target.value)} className={inp} required>
            <option value="">— เลือก —</option>
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ยี่ห้อ</label>
          <input value={form.brand} onChange={(e) => setF("brand", e.target.value)} className={inp} placeholder="SANY" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">รุ่น</label>
          <input value={form.model} onChange={(e) => setF("model", e.target.value)} className={inp} placeholder="SY5250GJB3C" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ปี</label>
          <input value={form.year} onChange={(e) => setF("year", e.target.value)} className={inp} placeholder="2013" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ประเภทเชื้อเพลิง</label>
          <select value={form.fuelType} onChange={(e) => setF("fuelType", e.target.value)} className={inp}>
            {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">สาขา</label>
          <input value={form.branch} onChange={(e) => setF("branch", e.target.value)} className={inp} placeholder="ลาดกระบัง" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">กรรมสิทธิ์</label>
          <input value={form.ownership} onChange={(e) => setF("ownership", e.target.value)} className={inp} placeholder="MT" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">เลขเครื่องยนต์</label>
          <input value={form.engineNo} onChange={(e) => setF("engineNo", e.target.value)} className={inp} placeholder="P11C-UHP40876" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">เลขตัวถัง</label>
          <input value={form.chassisNo} onChange={(e) => setF("chassisNo", e.target.value)} className={inp} placeholder="LFCDH65P5C1007450" />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">หมายเหตุ</label>
        <input value={form.note} onChange={(e) => setF("note", e.target.value)} className={inp} />
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={form.hasPump} onChange={(e) => setF("hasPump", e.target.checked)} className="rounded" />
          มีปั๊ม
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={form.isTrailer} onChange={(e) => setF("isTrailer", e.target.checked)} className="rounded" />
          เป็นหาง
        </label>
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Car size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ยานพาหนะ</h1>
        <span className="text-sm text-gray-400">({items.length} รายการ)</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        ทะเบียนยานพาหนะทั้งหมด — ค้นหาด้วยทะเบียน / เลขรถ / ประเภท / เลขเครื่องยนต์
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / เลขรถ / เลขเครื่อง..." className={inp + " pl-8"} />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inp + " max-w-[200px]"}>
          <option value="">— ทุกประเภท —</option>
          {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => { setShowAdd(!showAdd); setEditPlate(null); setForm(EMPTY); setAddError("") }}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3.5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          เพิ่มยานพาหนะ
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-4 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-3">เพิ่มยานพาหนะใหม่</p>
          <FormFields isEdit={false} />
          {addError && <p className="mt-2 text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2 mt-3">
            <button type="submit" disabled={saving} className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ทะเบียน</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">เลขรถ</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ประเภท</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ยี่ห้อ / รุ่น</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">เชื้อเพลิง</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">ปี</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">สาขา</th>
                <th className="px-3 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบรายการ</td></tr>
              ) : items.map((v, i) => (
                <>
                  <tr
                    key={v.plate}
                    className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}
                  >
                    {editPlate === v.plate ? (
                      <td colSpan={7} className="px-3 py-3">
                        <form onSubmit={handleEdit}>
                          <FormFields isEdit={true} />
                          <div className="flex gap-2 mt-3">
                            <button type="submit" disabled={saving} className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50">
                              {saving ? "บันทึก..." : "บันทึก"}
                            </button>
                            <button type="button" onClick={cancelEdit} className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
                              ยกเลิก
                            </button>
                          </div>
                        </form>
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedPlate(expandedPlate === v.plate ? null : v.plate)}
                            className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {v.plate}
                            {expandedPlate === v.plate ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{v.fleetNo || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${typeChip(v.vehicleType)}`}>
                            {v.vehicleType || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-xs">
                          {v.brand}{v.model ? ` · ${v.model}` : ""}
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{v.fuelType || "—"}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{v.year || "—"}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{v.branch || "—"}</td>
                      </>
                    )}
                    {editPlate !== v.plate && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(v)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(v.plate)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {expandedPlate === v.plate && editPlate !== v.plate && (
                    <tr key={v.plate + "-detail"} className="border-b border-gray-100 dark:border-white/5 bg-blue-50/30 dark:bg-blue-950/10">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                          <div><span className="text-gray-400">เลขเครื่องยนต์:</span> <span className="font-mono text-gray-700 dark:text-gray-300">{v.engineNo || "—"}</span></div>
                          <div><span className="text-gray-400">เลขตัวถัง:</span> <span className="font-mono text-gray-700 dark:text-gray-300">{v.chassisNo || "—"}</span></div>
                          <div><span className="text-gray-400">กรรมสิทธิ์:</span> <span className="text-gray-700 dark:text-gray-300">{v.ownership || "—"}</span></div>
                          <div><span className="text-gray-400">ฟลีท:</span> <span className="text-gray-700 dark:text-gray-300">{v.fleet || "—"}</span></div>
                          {v.hasPump  && <div><span className="text-blue-500">✓ มีปั๊ม</span></div>}
                          {v.isTrailer && <div><span className="text-orange-500">✓ เป็นหาง</span></div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
