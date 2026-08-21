"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, Check, X, BookOpen } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"

type TireSpec = {
  _id: string
  brand: string
  tireSize: string
  tireModel: string
  distance: number
  productCode: string
  productName: string
}

const EMPTY: Omit<TireSpec, "_id"> = {
  brand: "", tireSize: "", tireModel: "", distance: 0, productCode: "", productName: "",
}

const fmtInt = (n: number) => (n ?? 0).toLocaleString("th-TH")

const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
const th  = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
const td  = "px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap"

export function TireSpecMasterPage() {
  const [specs, setSpecs]       = useState<TireSpec[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState<Omit<TireSpec, "_id">>(EMPTY)
  const [saving, setSaving]     = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/tire-spec-master")
    setSpecs(await res.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function openAdd() {
    setEditId(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  function openEdit(s: TireSpec) {
    setEditId(s._id)
    setForm({ brand: s.brand, tireSize: s.tireSize, tireModel: s.tireModel, distance: s.distance, productCode: s.productCode, productName: s.productName })
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const url    = editId ? `/api/tire-spec-master/${editId}` : "/api/tire-spec-master"
    const method = editId ? "PUT" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, distance: Number(form.distance) }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "บันทึกไม่สำเร็จ")
      return
    }
    setShowForm(false)
    swalToast("success", editId ? "อัปเดตสำเร็จ" : "เพิ่มสเปคสำเร็จ")
    load()
  }

  async function handleDelete(s: TireSpec) {
    const confirmed = await swalDeleteConfirm(`ลบ ${s.brand} ${s.tireSize} ${s.tireModel}?`)
    if (!confirmed) return
    await fetch(`/api/tire-spec-master/${s._id}`, { method: "DELETE" })
    swalToast("success", "ลบสำเร็จ")
    load()
  }

  const fields: { key: keyof Omit<TireSpec, "_id">; label: string; placeholder: string; type?: string }[] = [
    { key: "brand",       label: "ยี่ห้อ *",           placeholder: "Bridgestone" },
    { key: "tireSize",    label: "ขนาดยาง *",          placeholder: "295/80R22.5" },
    { key: "tireModel",   label: "รุ่นยาง *",           placeholder: "R249" },
    { key: "distance",    label: "ระยะทาง (กม.) *",    placeholder: "120000", type: "number" },
    { key: "productCode", label: "รหัสสินค้า",          placeholder: "BS-R249-29580" },
    { key: "productName", label: "ชื่อสินค้า",          placeholder: "Bridgestone R249 295/80R22.5" },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen size={20} className="text-gray-400" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">จัดการสเปคยาง</h1>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={14} /> เพิ่มสเปค
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="mb-6 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            {editId ? "แก้ไขสเปค" : "เพิ่มสเปคใหม่"}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
                <input
                  type={type ?? "text"}
                  value={form[key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  required={label.includes("*")}
                  className={inp}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              <Check size={14} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <X size={14} /> ยกเลิก
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>ยี่ห้อ</th>
                <th className={th}>ขนาดยาง</th>
                <th className={th}>รุ่นยาง</th>
                <th className={th + " text-right"}>ระยะทาง (กม.)</th>
                <th className={th}>รหัสสินค้า</th>
                <th className={th}>ชื่อสินค้า</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : specs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">ยังไม่มีสเปค — กด &quot;เพิ่มสเปค&quot; เพื่อเริ่มต้น</td></tr>
              ) : specs.map((s, i) => (
                <tr key={s._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                  <td className={td + " font-medium"}>{s.brand}</td>
                  <td className={td + " font-mono"}>{s.tireSize}</td>
                  <td className={td}>{s.tireModel}</td>
                  <td className={td + " text-right font-semibold"}>{fmtInt(s.distance)}</td>
                  <td className={td + " text-gray-500 dark:text-gray-400"}>{s.productCode || "—"}</td>
                  <td className={td}>{s.productName || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(s)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(s)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
