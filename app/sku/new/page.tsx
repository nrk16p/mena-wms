"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1,
  POSITION, UNIT, GRADE, VEHICLE_TYPE, EXPENSE_TYPES_NO_PRICE,
} from "@/lib/codes"

type CodeMap = Record<string, { th: string; en: string }>

// Convert static code dicts to CodeMap — handles both string values and {th,en} objects
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStaticMap(obj: Record<string, any>): CodeMap {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === "string" ? { th: v, en: "" } : { th: v.th ?? "", en: v.en ?? "" },
    ])
  )
}

export default function NewSkuPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const [wh, setWh]           = useState("LK")
  const [type, setType]       = useState("PRT")
  const [l1, setL1]           = useState("")
  const [l2, setL2]           = useState("")
  const [l3, setL3]           = useState("")
  const [nameTh, setNameTh]   = useState("")
  const [nameEn, setNameEn]   = useState("")
  const [partNo, setPartNo]   = useState("")
  const [position, setPosition] = useState("GN")
  const [price, setPrice]     = useState("")
  const [unit, setUnit]       = useState("PC")
  const [brand, setBrand]     = useState("")
  const [oemRef, setOemRef]   = useState("")
  const [compatRef, setCompatRef] = useState("")
  const [vehicle, setVehicle] = useState("")
  const [grade, setGrade]     = useState("OEM")
  const [atmsCodes, setAtmsCodes] = useState<string[]>([])
  const [atmsInput, setAtmsInput] = useState("")

  const [previewSku, setPreviewSku] = useState("")
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState("")

  // All fetched from MongoDB — static codes are fallback only
  const [whOptions,      setWhOptions]      = useState<CodeMap>(toStaticMap(WAREHOUSE))
  const [typeOptions,    setTypeOptions]    = useState<CodeMap>(toStaticMap(EXPENSE_TYPE))
  const [l1Options,      setL1Options]      = useState<CodeMap>(toStaticMap(SYSTEM_L1))
  const [l2Options,      setL2Options]      = useState<CodeMap>({})
  const [l3Options,      setL3Options]      = useState<CodeMap>({})
  const [posOptions,     setPosOptions]     = useState<CodeMap>(toStaticMap(POSITION))
  const [unitOptions,    setUnitOptions]    = useState<CodeMap>(toStaticMap(UNIT))
  const [gradeOptions,   setGradeOptions]   = useState<CodeMap>(toStaticMap(GRADE))
  const [vehicleOptions, setVehicleOptions] = useState<CodeMap>(toStaticMap(VEHICLE_TYPE))
  const [brandOptions,   setBrandOptions]   = useState<CodeMap>({})

  type Row = { code: string; th: string; en: string }
  const toMap = (rows: Row[]): CodeMap =>
    Object.fromEntries(rows.map((r) => [r.code, { th: r.th, en: r.en }]))

  // Load all static dicts from MongoDB on mount
  useEffect(() => {
    const load = (dict: string, set: (m: CodeMap) => void) =>
      fetch(`/api/codes/${dict}`)
        .then((r) => r.json())
        .then((rows: Row[]) => { if (rows.length) set(toMap(rows)) })
        .catch(() => {})

    load("WAREHOUSE",    setWhOptions)
    load("EXPENSE_TYPE", setTypeOptions)
    load("SYSTEM_L1",    setL1Options)
    load("POSITION",     setPosOptions)
    load("UNIT",         setUnitOptions)
    load("GRADE",        setGradeOptions)
    load("VEHICLE_TYPE", setVehicleOptions)
    load("BRAND",        setBrandOptions)
  }, [])

  // Load L2 from MongoDB when L1 changes
  useEffect(() => {
    if (!l1) { setL2Options({}); return }
    fetch(`/api/codes/SUB_ASSEMBLY_L2?parent=${l1}`)
      .then((r) => r.json())
      .then((rows: Row[]) => setL2Options(toMap(rows)))
      .catch(() => setL2Options({}))
  }, [l1])

  // Load L3 from MongoDB when L1+L2 changes
  useEffect(() => {
    if (!l1 || !l2) { setL3Options({}); setL3(""); return }
    fetch(`/api/codes/COMPONENT_L3?parent=${l1}:${l2}`)
      .then((r) => r.json())
      .then((rows: Row[]) => setL3Options(toMap(rows)))
      .catch(() => setL3Options({}))
  }, [l1, l2])

  // Reset downstream when L1 changes
  useEffect(() => { setL2(""); setL3("") }, [l1])
  useEffect(() => { setL3("") }, [l2])

  // Preview SKU
  useEffect(() => {
    if (!wh || !type || !l1 || !l2 || !l3) { setPreviewSku(""); return }
    fetch(`/api/sku/next-seq?wh=${wh}&type=${type}&l1=${l1}&l2=${l2}&l3=${l3}`)
      .then((r) => r.json())
      .then((d) => setPreviewSku(d.sku ?? ""))
  }, [wh, type, l1, l2, l3])

  const noPrice = EXPENSE_TYPES_NO_PRICE.includes(type)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!l1 || !l2 || !l3) { setError("กรุณาเลือก L1, L2, L3"); return }
    setError("")
    setSaving(true)

    const res = await fetch("/api/sku", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wh, type, l1, l2, l3, nameTh, nameEn, partNo, position, price: noPrice ? "0" : price, unit, brand, oemRef, compatRef, vehicle, grade, atmsCodes }),
    })

    setSaving(false)
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? "เกิดข้อผิดพลาด")
      return
    }

    const d = await res.json()
    if (d.status === "pending") {
      router.push("/sku/pending-submitted")
    } else {
      router.push(`/sku?highlight=${d.sku}`)
    }
  }

  const labelCls = "block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1"
  const inputCls = "w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
  const selectCls = inputCls

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">เพิ่ม SKU ใหม่</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">กรอกข้อมูลด้านล่าง ระบบจะสร้าง SKU ให้อัตโนมัติ</p>
        {!isAdmin && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <span className="shrink-0">⏳</span>
            SKU ที่สร้างจะต้องรอ Admin อนุมัติก่อนจึงจะปรากฏในรายการ
          </div>
        )}
      </div>

      {/* SKU Preview + ATMS Code side-by-side */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-1">SKU ที่จะสร้าง</p>
          <p className="font-mono text-lg font-semibold text-gray-900 dark:text-white">
            {previewSku || <span className="text-gray-400 dark:text-gray-600">เลือก WH + Type + L1 + L2 + L3 ก่อน</span>}
          </p>
        </div>
        <div className="rounded-xl border-2 border-dashed border-blue-200 dark:border-blue-800/60 bg-blue-50/50 dark:bg-blue-950/20 px-5 py-4">
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-2">
            รหัสสินค้า ATMS <span className="normal-case font-normal">(รองรับหลายรหัส)</span>
          </label>
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {atmsCodes.map((code) => (
              <span key={code} className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-mono">
                {code}
                <button type="button" onClick={() => setAtmsCodes((p) => p.filter((c) => c !== code))} className="hover:text-red-500 transition-colors">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={atmsInput}
              onChange={(e) => setAtmsInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && atmsInput.trim()) {
                  e.preventDefault()
                  const v = atmsInput.trim()
                  if (!atmsCodes.includes(v)) setAtmsCodes((p) => [...p, v])
                  setAtmsInput("")
                }
              }}
              placeholder="พิมพ์รหัส แล้วกด Enter หรือ ,"
              className="flex-1 rounded-lg border border-blue-200 dark:border-blue-700/50 bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 placeholder-gray-400"
            />
            <button
              type="button"
              onClick={() => { if (atmsInput.trim() && !atmsCodes.includes(atmsInput.trim())) { setAtmsCodes((p) => [...p, atmsInput.trim()]); setAtmsInput("") } }}
              className="rounded-lg bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              เพิ่ม
            </button>
          </div>
          <p className="text-[10px] text-blue-400 dark:text-blue-600 mt-1.5">รหัสอ้างอิงจากระบบ ATMS — เพิ่มได้หลายรหัส</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Row 1: WH + Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>คลังสินค้า *</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={selectCls} required>
              {Object.entries(whOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ประเภทค่าใช้จ่าย *</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls} required>
              {Object.entries(typeOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: L1 + L2 + L3 */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>ระบบ L1 *</label>
            <select value={l1} onChange={(e) => setL1(e.target.value)} className={selectCls} required>
              <option value="">— เลือก L1 —</option>
              {Object.entries(l1Options).map(([k, v]) => <option key={k} value={k}>{k} {v.th}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ชุดประกอบ L2 *</label>
            <select value={l2} onChange={(e) => setL2(e.target.value)} className={selectCls} required disabled={!l1}>
              <option value="">— เลือก L2 —</option>
              {Object.entries(l2Options).map(([k, v]) => <option key={k} value={k}>{k} {v.th}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ชิ้นส่วน L3 *</label>
            <select value={l3} onChange={(e) => setL3(e.target.value)} className={selectCls} required disabled={!l2}>
              <option value="">— เลือก L3 —</option>
              {Object.entries(l3Options).map(([k, v]) => <option key={k} value={k}>{k} {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 3: Names */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ชื่ออะไหล่ (TH) *</label>
            <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} className={inputCls} placeholder="กรองน้ำมันเครื่อง Isuzu 6HK1" required />
          </div>
          <div>
            <label className={labelCls}>Part Name (EN)</label>
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} placeholder="Oil Filter Isuzu 6HK1" />
          </div>
        </div>

        {/* Row 4: Part No + Position */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์อะไหล่</label>
            <input value={partNo} onChange={(e) => setPartNo(e.target.value)} className={inputCls} placeholder="8-97306044-0" />
          </div>
          <div>
            <label className={labelCls}>ตำแหน่ง</label>
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={selectCls}>
              {Object.entries(posOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 5: Price + Unit */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ราคาต่อหน่วย (บาท)</label>
            <input
              value={noPrice ? "0 (กรอกตอน transaction)" : price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={noPrice}
              type={noPrice ? "text" : "number"}
              min="0"
              step="0.01"
              className={inputCls + (noPrice ? " opacity-50 cursor-not-allowed" : "")}
              placeholder="0"
            />
          </div>
          <div>
            <label className={labelCls}>หน่วย *</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={selectCls} required>
              {Object.entries(unitOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 6: Brand + Grade */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ยี่ห้อ</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectCls}>
              <option value="">— ไม่ระบุ —</option>
              {Object.keys(brandOptions).length === 0
                ? <option disabled>ยังไม่มียี่ห้อ — เพิ่มใน Code Dictionary</option>
                : Object.entries(brandOptions).map(([k, v]) => <option key={k} value={k}>{v.th || k}</option>)
              }
            </select>
          </div>
          <div>
            <label className={labelCls}>Grade</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className={selectCls}>
              {Object.entries(gradeOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 7: OEM Ref + Compat Ref */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์แท้อ้างอิง (OEM Ref)</label>
            <input value={oemRef} onChange={(e) => setOemRef(e.target.value)} className={inputCls} placeholder="8-97306044-0" />
          </div>
          <div>
            <label className={labelCls}>เบอร์เทียบอ้างอิง</label>
            <input value={compatRef} onChange={(e) => setCompatRef(e.target.value)} className={inputCls} placeholder="SO-7660 / C-110" />
          </div>
        </div>

        {/* Row 8: Vehicle */}
        <div>
          <label className={labelCls}>ทะเบียนหรือรุ่นรถ</label>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={selectCls}>
            <option value="">— ทุกรุ่น / ไม่ระบุ —</option>
            {Object.entries(vehicleOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? "กำลังบันทึก..." : "บันทึก SKU"}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-200 dark:border-white/10 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  )
}
