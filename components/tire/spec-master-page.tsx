"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, Check, X, BookOpen, AlertCircle } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"

type TireSpec = {
  _id: string
  /** ว่าง = สเปคกลางใช้ทุกสาขา · มีค่า = ใช้เฉพาะสาขานั้น (ทับสเปคกลาง) */
  branch?: string
  /** ระยะกำหนดแยกล้อหน้า/หลัง — ล้อหน้าเป็นล้อบังคับเลี้ยว สึกเร็วกว่าราวเท่าตัว */
  distanceFront?: number
  distanceRear?: number
  brand: string
  tireSize: string
  tireModel: string
  distance: number
  productCode: string
  productName: string
  /** ระยะที่ระบบเติมให้อัตโนมัติตามชนิดยาง ยังไม่มีคนยืนยัน */
  needsReview?: boolean
  /** จำนวนยางที่ใช้อยู่จริงของรุ่นนี้ (มาจาก ?withUsage=1) */
  tires?: number
}

// ฟอร์มแก้ได้เฉพาะ 6 ช่องนี้ — needsReview/tires เป็นข้อมูลที่ระบบคำนวณให้ ไม่ใช่ช่องกรอก
type SpecForm = Pick<TireSpec, "brand" | "tireSize" | "tireModel" | "distance" | "productCode" | "productName"> & { branch: string; distanceFront: number | string; distanceRear: number | string }

const EMPTY: SpecForm = {
  brand: "", tireSize: "", tireModel: "", distance: 0, productCode: "", productName: "",
  branch: "", distanceFront: "", distanceRear: "",
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
  const [form, setForm]         = useState<SpecForm>(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [onlyReview, setOnlyReview] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/tire-spec-master?withUsage=1")
    const data: TireSpec[] = await res.json()
    // เรียงตามจำนวนเส้นที่ใช้อยู่ — รุ่นที่ตั้งผิดแล้วกระทบมากที่สุดต้องอยู่บนสุด
    data.sort((a, b) => (b.tires ?? 0) - (a.tires ?? 0) || a.brand.localeCompare(b.brand))
    setSpecs(data)
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
    setForm({ brand: s.brand, tireSize: s.tireSize, tireModel: s.tireModel, distance: s.distance,
              productCode: s.productCode, productName: s.productName, branch: s.branch ?? "",
              distanceFront: s.distanceFront || "", distanceRear: s.distanceRear || "" })
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
      // คนกดบันทึกเอง = ยืนยันตัวเลขแล้ว ป้าย "รอยืนยัน" ต้องหายไป
      body: JSON.stringify({ ...form, distance: Number(form.distance) || 0,
        distanceFront: Number(form.distanceFront) || 0, distanceRear: Number(form.distanceRear) || 0,
        needsReview: false }),
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

  const fields: { key: keyof SpecForm; label: string; placeholder: string; type?: string }[] = [
    { key: "brand",       label: "ยี่ห้อ *",           placeholder: "Bridgestone" },
    { key: "tireSize",    label: "ขนาดยาง *",          placeholder: "295/80R22.5" },
    { key: "tireModel",   label: "รุ่นยาง *",           placeholder: "R249" },
    { key: "distance",    label: "ระยะทาง (กม.) *",    placeholder: "120000", type: "number" },
    { key: "distanceFront", label: "ระยะล้อหน้า (กม.)", placeholder: "20000", type: "number" },
    { key: "distanceRear",  label: "ระยะล้อหลัง (กม.)", placeholder: "40000", type: "number" },
    { key: "branch",      label: "เฉพาะสาขา",          placeholder: "latkrabang / saraburi (ว่าง = ทุกสาขา)" },
    { key: "productCode", label: "รหัสสินค้า",          placeholder: "BS-R249-29580" },
    { key: "productName", label: "ชื่อสินค้า",          placeholder: "Bridgestone R249 295/80R22.5" },
  ]

  const shown = onlyReview ? specs.filter((s) => s.needsReview) : specs

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

      {!loading && specs.some((s) => s.needsReview) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-500/10 px-3.5 py-2.5">
          <AlertCircle size={15} className="text-amber-600 dark:text-amber-400" />
          <span className="text-[12.5px] text-amber-800 dark:text-amber-200">
            มี {specs.filter((s) => s.needsReview).length} รุ่นที่ระบบเติมระยะให้ตามชนิดยาง (
            {fmtInt(specs.filter((s) => s.needsReview).reduce((a, s) => a + (s.tires ?? 0), 0))} เส้น) — ยืนยันหรือแก้ตัวเลขให้ตรงกับที่ใช้จริง
            แล้วแท็บ &quot;ยางถึงกำหนดเปลี่ยน&quot; จะเตือนได้แม่นขึ้น
          </span>
          <button onClick={() => setOnlyReview((v) => !v)}
            className="ml-auto rounded-lg border border-amber-400/60 px-2.5 py-1 text-[11.5px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors">
            {onlyReview ? "ดูทั้งหมด" : "ดูเฉพาะที่รอยืนยัน"}
          </button>
        </div>
      )}

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
                <th className={th + " text-right"}>ใช้อยู่</th>
                <th className={th}>สาขา</th>
                <th className={th}>ยี่ห้อ</th>
                <th className={th}>ขนาดยาง</th>
                <th className={th}>รุ่นยาง</th>
                <th className={th + " text-right"}>ระยะทาง (กม.)</th>
                <th className={th + " text-right"}>หน้า / หลัง</th>
                <th className={th}>รหัสสินค้า</th>
                <th className={th}>ชื่อสินค้า</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : specs.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">ยังไม่มีสเปค — กด &quot;เพิ่มสเปค&quot; เพื่อเริ่มต้น</td></tr>
              ) : shown.map((s, i) => (
                <tr key={s._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                  <td className={td + " text-right font-mono text-gray-500 dark:text-gray-400"}>{s.tires ? fmtInt(s.tires) : "—"}</td>
                  <td className={td}>
                    {s.branch
                      ? <span className="rounded bg-[#1B8C4B]/10 px-1.5 py-0.5 text-[10.5px] font-medium text-[#1B8C4B]">
                          {s.branch === "latkrabang" ? "ลาดกระบัง" : s.branch === "saraburi" ? "สระบุรี" : s.branch}
                        </span>
                      : <span className="text-[11px] text-gray-400">ทุกสาขา</span>}
                  </td>
                  <td className={td + " font-medium"}>{s.brand}</td>
                  <td className={td + " font-mono"}>{s.tireSize}</td>
                  <td className={td}>{s.tireModel}</td>
                  <td className={td + " text-right font-semibold"}>
                    {s.distance ? fmtInt(s.distance) : <span className="text-red-500">ยังไม่ตั้ง</span>}
                    {s.needsReview && (
                      <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        รอยืนยัน
                      </span>
                    )}
                  </td>
                  <td className={td + " text-right font-mono text-[12px] text-gray-500 dark:text-gray-400"}>
                    {s.distanceFront || s.distanceRear
                      ? `${s.distanceFront ? fmtInt(s.distanceFront) : "—"} / ${s.distanceRear ? fmtInt(s.distanceRear) : "—"}`
                      : "—"}
                  </td>
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
