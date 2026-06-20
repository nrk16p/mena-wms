"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1, SUB_ASSEMBLY_L2, POSITION, UNIT, GRADE, VEHICLE_TYPE, EXPENSE_TYPES_NO_PRICE } from "@/lib/codes"
import { COMPONENT_L3 } from "@/lib/codes-l3"
import { BrandCombobox } from "@/components/brand-combobox"
import { VehicleMultiSelect } from "@/components/vehicle-multi-select"
import { ImageUpload } from "@/components/image-upload"
import type { SkuImage } from "@/lib/media"
import { swalToast, swalError } from "@/lib/swal"

type SkuDoc = Record<string, unknown>
type CodeMap = Record<string, { th: string; en: string }>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStaticMap(obj: Record<string, any>): CodeMap {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === "string" ? { th: v, en: "" } : { th: v.th ?? "", en: v.en ?? "" },
    ])
  )
}

export default function EditSkuPage() {
  const { sku } = useParams<{ sku: string }>()
  const router  = useRouter()

  const [doc, setDoc]         = useState<SkuDoc | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState("")
  const [atmsCodes, setAtmsCodes]     = useState<string[]>([])
  const [atmsInput, setAtmsInput]     = useState("")
  const [brandValue, setBrandValue]   = useState("")
  const [compatRefs, setCompatRefs]   = useState<string[]>([])
  const [compatInput, setCompatInput] = useState("")
  const [vehicles, setVehicles]       = useState<string[]>([])
  const [positions, setPositions]     = useState<string[]>([])
  const [images, setImages]           = useState<SkuImage[]>([])

  // Code dict options fetched from MongoDB
  const [whOptions,      setWhOptions]      = useState<CodeMap>(toStaticMap(WAREHOUSE))
  const [posOptions,     setPosOptions]     = useState<CodeMap>(toStaticMap(POSITION))
  const [unitOptions,    setUnitOptions]    = useState<CodeMap>(toStaticMap(UNIT))
  const [gradeOptions,   setGradeOptions]   = useState<CodeMap>(toStaticMap(GRADE))
  const [vehicleOptions, setVehicleOptions] = useState<CodeMap>(toStaticMap(VEHICLE_TYPE))
  const [brandOptions,   setBrandOptions]   = useState<CodeMap>({})

  useEffect(() => {
    type Row = { code: string; th: string; en: string }
    const toMap = (rows: Row[]): CodeMap =>
      Object.fromEntries(rows.map((r) => [r.code, { th: r.th, en: r.en }]))
    const load = (dict: string, set: (m: CodeMap) => void) =>
      fetch(`/api/codes/${dict}`).then((r) => r.json())
        .then((rows: Row[]) => { if (rows.length) set(toMap(rows)) }).catch(() => {})

    load("WAREHOUSE",    setWhOptions)
    load("POSITION",     setPosOptions)
    load("UNIT",         setUnitOptions)
    load("VEHICLE_TYPE", setVehicleOptions)
    load("BRAND",        setBrandOptions)
  }, [])

  useEffect(() => {
    fetch(`/api/sku/${sku}`)
      .then((r) => r.json())
      .then((d) => {
        setDoc(d)
        const raw = d["รหัสATMS"]
        setAtmsCodes(Array.isArray(raw) ? raw : raw ? [raw] : [])
        setBrandValue(String(d["ยี่ห้อ"] ?? ""))
        const rawCompat = d["เบอร์เทียบอ้างอิง"]
        setCompatRefs(Array.isArray(rawCompat) ? rawCompat : rawCompat ? [String(rawCompat)] : [])
        const rawVehicles = d["ทะเบียนหรือรุ่นรถ"]
        setVehicles(Array.isArray(rawVehicles) ? rawVehicles : rawVehicles ? [String(rawVehicles)] : [])
        const rawPositions = d["ตำแหน่ง"]
        setPositions(Array.isArray(rawPositions) ? rawPositions : rawPositions ? [String(rawPositions)] : ["GN"])
        // Load grades filtered by this SKU's expense type
        const expenseType = String(d["ประเภทค่าใช้จ่าย"] ?? "PRT")
        type Row = { code: string; th: string; en: string }
        fetch(`/api/codes/GRADE?expenseType=${expenseType}`)
          .then((r) => r.json())
          .then((rows: Row[]) => {
            if (rows.length) setGradeOptions(Object.fromEntries(rows.map((r) => [r.code, { th: r.th, en: r.en }])))
          }).catch(() => {})
      })
  }, [sku])

  if (!doc) return <div className="text-sm text-gray-400 p-6">กำลังโหลด...</div>

  const type = String(doc["ประเภทค่าใช้จ่าย"] ?? "")
  const l1   = String(doc["ระบบ_L1"] ?? "")
  const l2   = String(doc["ชุดประกอบ_L2"] ?? "")
  const l3   = String(doc["ชิ้นส่วน_L3"] ?? "")
  const noPrice = EXPENSE_TYPES_NO_PRICE.includes(type)

  const l2Options = l1 ? (SUB_ASSEMBLY_L2[l1] ?? {}) : {}
  const l3Options = l1 && l2 ? ((COMPONENT_L3[l1] ?? {})[l2] ?? {}) : {}

  const initialImages: SkuImage[] = Array.isArray(doc["images"]) ? (doc["images"] as SkuImage[]) : []

  function field(key: string) { return String((doc as SkuDoc)[key] ?? "") }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (atmsCodes.length === 0) { setError("กรุณาระบุรหัส ATMS อย่างน้อย 1 รหัส"); return }
    setSaving(true)
    setError("")

    const form = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {}
    form.forEach((v, k) => { body[k] = String(v) })
    body["ประเภทค่าใช้จ่าย"] = type
    body["รหัสATMS"] = atmsCodes
    body["เบอร์เทียบอ้างอิง"] = compatRefs
    body["ทะเบียนหรือรุ่นรถ"] = vehicles
    body["ตำแหน่ง"] = positions
    body["images"] = images
    if (noPrice) body["ราคาต่อหน่วย"] = "0"

    const res = await fetch(`/api/sku/${sku}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    setSaving(false)
    if (!res.ok) {
      const msg = "บันทึกไม่สำเร็จ"
      setError(msg)
      swalError(msg)
      return
    }

    await swalToast("success", "บันทึก SKU สำเร็จ")
    router.push("/sku")
  }

  const NAME_LABEL: Record<string, { th: string; en: string }> = {
    PRT: { th: "ชื่ออะไหล่ (TH) *",    en: "Part Name (EN)" },
    PM:  { th: "ชื่อรายการ PM (TH) *", en: "Item Name (EN)" },
    LAB: { th: "ชื่องาน/บริการ (TH) *", en: "Service Name (EN)" },
    SVC: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)" },
    CLN: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)" },
    TRP: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)" },
    ACC: { th: "ชื่อรายการซ่อม (TH) *", en: "Repair Item (EN)" },
  }
  const nameLabel = NAME_LABEL[type] ?? NAME_LABEL.PRT

  const labelCls  = "block text-[12px] font-medium text-gray-600 dark:text-gray-400 mb-1"
  const inputCls  = "w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30"
  const selectCls = inputCls

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">แก้ไข SKU</h1>
        <p className="font-mono text-sm text-gray-500 dark:text-gray-400 mt-0.5">{sku}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>คลังสินค้า</label>
            <select name="คลังสินค้า" defaultValue={field("คลังสินค้า")} className={selectCls}>
              {Object.entries(whOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ประเภทค่าใช้จ่าย</label>
            <input value={EXPENSE_TYPE[type]?.th ?? type} disabled className={inputCls + " opacity-50 cursor-not-allowed"} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>ระบบ L1</label>
            <input value={`${l1} — ${SYSTEM_L1[l1]?.th ?? l1}`} disabled className={inputCls + " opacity-50 cursor-not-allowed"} />
          </div>
          <div>
            <label className={labelCls}>ชุดประกอบ L2</label>
            <input value={`${l2} — ${l2Options[l2]?.th ?? l2}`} disabled className={inputCls + " opacity-50 cursor-not-allowed"} />
          </div>
          <div>
            <label className={labelCls}>ชิ้นส่วน L3</label>
            <input value={`${l3} — ${l3Options[l3]?.th ?? l3}`} disabled className={inputCls + " opacity-50 cursor-not-allowed"} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{nameLabel.th}</label>
            <input name="ชื่ออะไหล่_TH" defaultValue={field("ชื่ออะไหล่_TH")} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>{nameLabel.en}</label>
            <input name="Part_Name_EN" defaultValue={field("Part_Name_EN")} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์อะไหล่</label>
            <input name="เบอร์อะไหล่" defaultValue={field("เบอร์อะไหล่")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ตำแหน่ง <span className="font-normal text-gray-400">(เลือกได้หลายตำแหน่ง)</span></label>
            <div className={inputCls + " min-h-[38px] flex flex-wrap gap-1 items-center py-1.5"}>
              {positions.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 text-xs font-mono">
                  {p} — {posOptions[p]?.th ?? p}
                  <button type="button" onClick={() => setPositions((prev) => prev.filter((x) => x !== p))} className="hover:text-red-500">×</button>
                </span>
              ))}
              <select
                value=""
                onChange={(e) => { const v = e.target.value; if (v && !positions.includes(v)) setPositions((prev) => [...prev, v]) }}
                className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-gray-500 dark:text-gray-400"
              >
                <option value="">+ เพิ่มตำแหน่ง</option>
                {Object.entries(posOptions).filter(([k]) => !positions.includes(k)).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ราคาต่อหน่วย</label>
            <input name="ราคาต่อหน่วย" defaultValue={noPrice ? "0" : field("ราคาต่อหน่วย")} disabled={noPrice} type="number" min="0" step="0.01" className={inputCls + (noPrice ? " opacity-50 cursor-not-allowed" : "")} />
          </div>
          <div>
            <label className={labelCls}>หน่วย</label>
            <select name="หน่วย" defaultValue={field("หน่วย")} className={selectCls}>
              {Object.entries(unitOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ยี่ห้อ</label>
            <input type="hidden" name="ยี่ห้อ" value={brandValue} />
            <BrandCombobox
              options={brandOptions}
              value={brandValue}
              onChange={setBrandValue}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Grade</label>
            <select name="Grade" defaultValue={field("Grade")} className={selectCls}>
              {Object.entries(gradeOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์แท้อ้างอิง</label>
            <input name="เบอร์แท้อ้างอิง" defaultValue={field("เบอร์แท้อ้างอิง")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>เบอร์เทียบอ้างอิง <span className="font-normal text-gray-400">(ใส่ได้หลายเบอร์)</span></label>
            <div className={inputCls + " min-h-[38px] flex flex-wrap gap-1 items-center py-1.5"}>
              {compatRefs.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 text-xs font-mono">
                  {c}
                  <button type="button" onClick={() => setCompatRefs((p) => p.filter((x) => x !== c))} className="hover:text-red-500">×</button>
                </span>
              ))}
              <input
                value={compatInput}
                onChange={(e) => setCompatInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && compatInput.trim()) {
                    e.preventDefault()
                    const v = compatInput.trim()
                    if (!compatRefs.includes(v)) setCompatRefs((p) => [...p, v])
                    setCompatInput("")
                  }
                }}
                placeholder={compatRefs.length === 0 ? "SO-7660 แล้วกด Enter" : ""}
                className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>ทะเบียนหรือรุ่นรถ <span className="font-normal text-gray-400">(เลือกได้หลายคัน)</span></label>
          <VehicleMultiSelect
            values={vehicles}
            onChange={setVehicles}
            className={inputCls}
          />
        </div>

        {/* Images — existing ones are loaded for view / delete, can add more */}
        <div>
          <label className={labelCls}>รูปภาพประกอบ <span className="font-normal text-gray-400">(แนบได้หลายรูป)</span></label>
          <ImageUpload onChange={setImages} initial={initialImages} />
        </div>

        {/* ATMS Code — tags */}
        <div className={`rounded-xl border-2 border-dashed px-5 py-4 ${atmsCodes.length === 0 && error ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20" : "border-blue-200 dark:border-blue-800/60 bg-blue-50/50 dark:bg-blue-950/20"}`}>
          <label className={`block text-[11px] font-semibold uppercase tracking-widest mb-2 ${atmsCodes.length === 0 && error ? "text-red-500 dark:text-red-400" : "text-blue-500 dark:text-blue-400"}`}>
            รหัสสินค้า ATMS <span className="normal-case font-normal">(จำเป็น — อย่างน้อย 1 รหัส)</span>
          </label>
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

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-200 dark:border-white/10 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  )
}
