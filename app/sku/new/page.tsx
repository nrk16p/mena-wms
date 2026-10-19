"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1,
  POSITION, UNIT, GRADE, VEHICLE_TYPE, EXPENSE_TYPES_NO_PRICE,
} from "@/lib/codes"
import { BrandCombobox } from "@/components/brand-combobox"
import { VehicleMultiSelect } from "@/components/vehicle-multi-select"
import { ImageUpload } from "@/components/image-upload"
import { swalError } from "@/lib/swal"
import type { SkuImage } from "@/lib/media"
import PartsPage from "@/app/codes/parts/page"
import { L1_FILTER } from "@/lib/sku-convert-core"
import { AtmsCodePicker } from "@/components/atms-code-picker"
import { SkuSuggestBox } from "@/components/sku-suggest-box"
import type { AtmsLookupResult } from "@/app/api/sku/atms-lookup/route"

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
  const [positions, setPositions] = useState<string[]>(["GN"])
  const [price, setPrice]     = useState("")
  const [unit, setUnit]       = useState("PC")
  const [brand, setBrand]           = useState("")
  const [oemRef, setOemRef]         = useState("")
  const [compatRefs, setCompatRefs] = useState<string[]>([])
  const [compatInput, setCompatInput] = useState("")
  const [vehicles, setVehicles] = useState<string[]>([])
  const [grade, setGrade]     = useState("OEM")
  const [atmsCodes, setAtmsCodes] = useState<string[]>([])
  /** ผลอ่านทะเบียนสินค้า ATMS ของรหัสที่เพิ่งเลือก — เอาไว้โชว์ว่าเติมช่องไหนให้ และใช้เป็นเบาะแสของตัวช่วยจัดหมวด */
  const [atmsInfo, setAtmsInfo] = useState<AtmsLookupResult | null>(null)
  const [atmsFilled, setAtmsFilled] = useState<string[]>([])
  const [atmsError, setAtmsError] = useState("")
  /** ช่องที่ผู้ใช้แก้เองแล้ว — ของ ATMS จะไม่เขียนทับ (ช่องพวกนี้มีค่าตั้งต้นอยู่ เช็กว่า "ว่าง" ไม่ได้) */
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  /** หมวดที่เลือกจากตัวช่วยและยังตั้งค่าไม่ครบสามชั้น — เก็บใน ref เพราะไม่ได้เอาไปแสดงผล
   *  ตั้งค่าต่อเมื่อตัวเลือกของชั้นถัดไปโหลดเสร็จ (ดูใน .then ของ L2/L3) */
  const pendingPickRef = useRef<{ l1: string; l2: string; l3: string } | null>(null)
  const [images, setImages] = useState<SkuImage[]>([])

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

  // Which L1 codes are appropriate per expense type — single source shared with /sku/convert

  // All L1 options fetched from DB, filtered by expense type in the component
  const [allL1Options, setAllL1Options] = useState<CodeMap>({})

  // Load all static dicts from MongoDB on mount
  useEffect(() => {
    const load = (dict: string, set: (m: CodeMap) => void) =>
      fetch(`/api/codes/${dict}`)
        .then((r) => r.json())
        .then((rows: Row[]) => { if (rows.length) set(toMap(rows)) })
        .catch(() => {})

    load("WAREHOUSE",    setWhOptions)
    load("EXPENSE_TYPE", setTypeOptions)
    load("SYSTEM_L1",    setAllL1Options)
    load("POSITION",     setPosOptions)
    load("UNIT",         setUnitOptions)
    load("VEHICLE_TYPE", setVehicleOptions)
    load("BRAND",        setBrandOptions)
  }, [])

  // Filter L1 options by expense type
  useEffect(() => {
    const allowed = L1_FILTER[type]
    if (!allowed) { setL1Options(allL1Options); return }
    const filtered = Object.fromEntries(
      Object.entries(allL1Options).filter(([code]) => allowed.includes(code))
    )
    setL1Options(filtered)
    // Reset L1 if current value not in new filtered list
    if (l1 && !allowed.includes(l1)) { setL1(""); setL2(""); setL3("") }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, allL1Options])

  // Load L2 from MongoDB when L1 or expense type changes
  useEffect(() => {
    if (!l1) { setL2Options({}); return }
    fetch(`/api/codes/SUB_ASSEMBLY_L2?parent=${l1}&expenseType=${type}`)
      .then((r) => r.json())
      .then((rows: Row[]) => {
        const map = toMap(rows)
        setL2Options(map)
        // หมวดที่เลือกจากตัวช่วยจัดหมวด — ตั้ง L2 ได้แล้วเมื่อรายการของ L1 นี้มาถึง
        const p = pendingPickRef.current
        if (p && p.l1 === l1 && p.l2 && map[p.l2]) setL2(p.l2)
      })
      .catch(() => setL2Options({}))
  }, [l1, type])

  // Load L3 from MongoDB when L1+L2 or expense type changes
  useEffect(() => {
    if (!l1 || !l2) { setL3Options({}); setL3(""); return }
    fetch(`/api/codes/COMPONENT_L3?parent=${l1}:${l2}&expenseType=${type}`)
      .then((r) => r.json())
      .then((rows: Row[]) => {
        const map = toMap(rows)
        setL3Options(map)
        const p = pendingPickRef.current
        if (p && p.l1 === l1 && p.l2 === l2) {
          if (p.l3 && map[p.l3]) setL3(p.l3)
          pendingPickRef.current = null        // ครบสามชั้นแล้ว (หรือหา L3 ที่เสนอมาไม่เจอ)
        }
      })
      .catch(() => setL3Options({}))
  }, [l1, l2, type])

  // Load grade options filtered by expense type + reset grade default
  useEffect(() => {
    fetch(`/api/codes/GRADE?expenseType=${type}`)
      .then((r) => r.json())
      .then((rows: Row[]) => {
        if (rows.length) {
          setGradeOptions(toMap(rows))
          setGrade(rows[0].code) // default to first option for that type
        }
      })
      .catch(() => {})
  }, [type])

  // Reset downstream when L1 changes
  useEffect(() => { setL2(""); setL3("") }, [l1])
  useEffect(() => { setL3("") }, [l2])

  // Preview SKU
  useEffect(() => {
    if (!wh || !type || !l1 || !l2 || (l3Required && !l3)) { setPreviewSku(""); return }
    fetch(`/api/sku/next-seq?wh=${wh}&type=${type}&l1=${l1}&l2=${l2}&l3=${l3}`)
      .then((r) => r.json())
      .then((d) => setPreviewSku(d.sku ?? ""))
  }, [wh, type, l1, l2, l3])

  const noPrice    = EXPENSE_TYPES_NO_PRICE.includes(type)
  const l3Required = !["LAB", "SVC", "CLN", "TRP"].includes(type)

  const LAB_UNITS = ["DAY", "HR"]
  const filteredUnitOptions = type === "LAB"
    ? Object.fromEntries(Object.entries(unitOptions).filter(([k]) => LAB_UNITS.includes(k)))
    : unitOptions

  // Reset unit to DAY when switching to LAB and current unit is not valid
  useEffect(() => {
    if (type === "LAB" && !LAB_UNITS.includes(unit)) setUnit("DAY")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  /** เลือกรหัส ATMS แล้วเติมฟอร์มให้ — เขียนเฉพาะช่องที่ยังไม่ถูกแตะ ของที่คนกรอกไว้ถือว่าถูกต้องกว่า */
  function applyAtms(code: string, result: AtmsLookupResult | null) {
    if (!result || !result.found || !result.prefill) {
      setAtmsInfo(null)
      setAtmsFilled([])
      setAtmsError(`หารหัส ${code} ในทะเบียนสินค้า ATMS ไม่พบ — รหัสยังใช้ได้ แต่ต้องกรอกข้อมูลเอง`)
      return
    }
    const p = result.prefill
    const filled: string[] = []
    if (p.nameTh && !nameTh.trim()) { setNameTh(p.nameTh); filled.push("ชื่อ (TH)") }
    if (p.brand && !brand.trim()) { setBrand(p.brand); filled.push("ยี่ห้อ") }
    if (p.partNo && !partNo.trim()) { setPartNo(p.partNo); filled.push("เบอร์อะไหล่") }
    if (p.wh && !touched.wh) { setWh(p.wh); filled.push("คลัง") }
    if (p.type && !touched.type) { setType(p.type); filled.push("ประเภท") }
    if (p.unit && !touched.unit) { setUnit(p.unit); filled.push("หน่วย") }
    // L1 เติมเฉพาะกลุ่มที่ชี้ระบบมาตัวเดียว · กลุ่มที่คร่อมหลายระบบปล่อยให้ตัวช่วยจัดหมวด/คนเลือก
    if (p.l1 && !l1) { setL1(p.l1); filled.push("ระบบ L1") }
    setAtmsInfo(result)
    setAtmsFilled(filled)
    setAtmsError("")
  }

  /** เลือกหมวดจากตัวช่วย — ตั้ง L1 ไว้ก่อน ส่วน L2/L3 รอให้ตัวเลือกของชั้นนั้นโหลดมาก่อน (ดู useEffect ด้านล่าง)
   *  ตั้งทั้งสามชั้นพร้อมกันไม่ได้ เพราะ effect ของ L1/L2 ล้างชั้นล่างทิ้งทุกครั้งที่ชั้นบนเปลี่ยน */
  function applySuggestion(o: { l1: string; l2: string; l3: string }) {
    pendingPickRef.current = o
    setL1(o.l1)
    if (o.l1 === l1 && l2Options[o.l2]) setL2(o.l2)   // L1 เดิม = รายการ L2 มีอยู่แล้ว ไม่มี fetch ใหม่มาปลุก
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!l1 || !l2 || (l3Required && !l3)) { setError(l3Required ? "กรุณาเลือก L1, L2, L3" : "กรุณาเลือก L1, L2"); return }
    if (atmsCodes.length === 0) { setError("กรุณาระบุรหัส ATMS อย่างน้อย 1 รหัส"); return }
    setError("")
    setSaving(true)

    const res = await fetch("/api/sku", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wh, type, l1, l2, l3, nameTh, nameEn, partNo, positions, price: noPrice ? "0" : price, unit, brand, oemRef, compatRefs, vehicles, grade, atmsCodes, images }),
    })

    setSaving(false)
    if (!res.ok) {
      const d = await res.json()
      const msg = d.error ?? "เกิดข้อผิดพลาด"
      setError(msg)
      swalError(msg)
      return
    }

    const d = await res.json()
    if (d.status === "pending") {
      router.push("/sku/pending-submitted")
    } else {
      router.push(`/sku?highlight=${d.sku}`)
    }
  }

  const NAME_LABEL: Record<string, { th: string; en: string; placeholder: string }> = {
    PRT: { th: "ชื่ออะไหล่ (TH) *",    en: "Part Name (EN)",    placeholder: "กรองน้ำมันเครื่อง Isuzu 6HK1" },
    PM:  { th: "ชื่อรายการ PM (TH) *", en: "Item Name (EN)",    placeholder: "เปลี่ยนถ่ายน้ำมันเครื่อง" },
    LAB: { th: "ชื่องาน/บริการ (TH) *", en: "Service Name (EN)", placeholder: "ถอดประกอบเครื่องยนต์ทั้งตัว" },
    SVC: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)", placeholder: "ค่าบริการตรวจสภาพ" },
    CLN: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)", placeholder: "ล้างรถ-ดูดฝุ่นห้องโดยสาร" },
    TRP: { th: "ชื่อบริการ (TH) *",    en: "Service Name (EN)", placeholder: "ค่าลากจูงฉุกเฉิน" },
    ACC: { th: "ชื่อรายการซ่อม (TH) *", en: "Repair Item (EN)", placeholder: "ซ่อมตัวถังหน้า-ชน" },
  }
  const nameLabel = NAME_LABEL[type] ?? NAME_LABEL.PRT

  const labelCls = "block text-[12px] font-medium text-[#6B7C72] dark:text-gray-400 mb-1"
  const inputCls = "w-full rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30 placeholder-[#9AA8A0]"
  const selectCls = inputCls

  return (
    <div className="flex gap-8 items-start">
    <div className="w-[600px] shrink-0">
      <div className="mb-6">
        <h1 className="text-[22px] text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}>เพิ่ม SKU ใหม่</h1>
        <p className="text-[13px] text-[#6B7C72] mt-0.5" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>กรอกข้อมูลด้านล่าง ระบบจะสร้าง SKU ให้อัตโนมัติ</p>
        {!isAdmin && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <span className="shrink-0">⏳</span>
            SKU ที่สร้างจะต้องรอ Admin อนุมัติก่อนจึงจะปรากฏในรายการ
          </div>
        )}
      </div>

      {/* SKU Preview + ATMS Code side-by-side */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-white/3 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-1">SKU ที่จะสร้าง</p>
          <p className="font-mono text-lg font-semibold text-gray-900 dark:text-white">
            {previewSku || <span className="text-gray-400 dark:text-gray-600">{l3Required ? "เลือก WH + Type + L1 + L2 + L3 ก่อน" : "เลือก WH + Type + L1 + L2 ก่อน"}</span>}
          </p>
        </div>
        <div className={`rounded-xl border-2 border-dashed px-5 py-4 ${atmsCodes.length === 0 && error ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20" : "border-blue-200 dark:border-blue-800/60 bg-blue-50/50 dark:bg-blue-950/20"}`}>
          <label className={`block text-[11px] font-semibold uppercase tracking-widest mb-2 ${atmsCodes.length === 0 && error ? "text-red-500 dark:text-red-400" : "text-blue-500 dark:text-blue-400"}`}>
            รหัสสินค้า ATMS <span className="normal-case font-normal">(จำเป็น — อย่างน้อย 1 รหัส)</span>
          </label>
          <AtmsCodePicker
            codes={atmsCodes}
            onAdd={(c) => setAtmsCodes((prev) => (prev.includes(c) ? prev : [...prev, c]))}
            onRemove={(c) => setAtmsCodes((prev) => prev.filter((x) => x !== c))}
            onResolved={applyAtms}
            invalid={atmsCodes.length === 0 && !!error}
          />
          {atmsError && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">{atmsError}</p>}
          {atmsInfo?.row && (
            <div className="mt-2 rounded-lg bg-white/70 dark:bg-white/5 border border-blue-100 dark:border-white/10 px-2.5 py-2">
              <p className="text-[11px] text-gray-700 dark:text-gray-200 leading-relaxed">
                <span className="font-medium">{atmsInfo.row.name || "(ไม่มีชื่อใน ATMS)"}</span>
                {atmsInfo.row.group && <span className="text-gray-500"> · {atmsInfo.row.group}</span>}
                {atmsInfo.row.unit && <span className="text-gray-500"> · หน่วย {atmsInfo.row.unit}</span>}
                {atmsInfo.row.warehouse && <span className="text-gray-500"> · {atmsInfo.row.warehouse}</span>}
              </p>
              <p className="text-[10px] mt-1">
                {atmsInfo.source === "atms"
                  ? <span className="text-green-600 dark:text-green-400">อ่านสดจาก ATMS เมื่อสักครู่</span>
                  : <span className="text-amber-600 dark:text-amber-400">ATMS ไม่ตอบ — ใช้ข้อมูลที่ซิงก์ไว้รอบล่าสุด</span>}
                {atmsFilled.length > 0
                  ? <span className="text-gray-500"> · เติมให้แล้ว: {atmsFilled.join(", ")}</span>
                  : <span className="text-gray-400"> · ไม่ได้เติมช่องไหน (กรอกไว้แล้วทั้งหมด)</span>}
              </p>
              {atmsInfo.prefill && (atmsInfo.prefill.unmapped.unit || atmsInfo.prefill.unmapped.warehouse) && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  เทียบรหัสของเราไม่ได้ ต้องเลือกเอง:
                  {atmsInfo.prefill.unmapped.unit ? ` หน่วย "${atmsInfo.prefill.unmapped.unit}"` : ""}
                  {atmsInfo.prefill.unmapped.warehouse ? ` คลัง "${atmsInfo.prefill.unmapped.warehouse}"` : ""}
                </p>
              )}
            </div>
          )}
          <p className="text-[10px] text-blue-400 dark:text-blue-600 mt-1.5">รหัสอ้างอิงจากระบบ ATMS — เพิ่มได้หลายรหัส · เลือกแล้วระบบดึงข้อมูลมาช่วยกรอก</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Row 1: WH + Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>คลังสินค้า *</label>
            <select value={wh} onChange={(e) => { setWh(e.target.value); setTouched((t) => ({ ...t, wh: true })) }} className={selectCls} required>
              {Object.entries(whOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ประเภทค่าใช้จ่าย *</label>
            <select value={type} onChange={(e) => { setType(e.target.value); setTouched((t) => ({ ...t, type: true })) }} className={selectCls} required>
              {Object.entries(typeOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        <SkuSuggestBox
          name={nameTh.trim() || atmsInfo?.row?.name || ""}
          group={atmsInfo?.row?.group ?? ""}
          type={type}
          brand={brand}
          l1Hint={atmsInfo?.prefill?.l1Options ?? []}
          onPick={applySuggestion}
          onUseName={(th, en) => { setNameTh(th); if (en) setNameEn(en) }}
        />

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
            <label className={labelCls}>ชิ้นส่วน L3 {l3Required ? "*" : <span className="font-normal text-gray-400">(ไม่บังคับ)</span>}</label>
            <select value={l3} onChange={(e) => setL3(e.target.value)} className={selectCls} required={l3Required} disabled={!l2}>
              <option value="">— เลือก L3 —</option>
              {Object.entries(l3Options).map(([k, v]) => <option key={k} value={k}>{k} {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 3: Names */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{nameLabel.th}</label>
            <input value={nameTh} onChange={(e) => setNameTh(e.target.value)} className={inputCls} placeholder={nameLabel.placeholder} required />
          </div>
          <div>
            <label className={labelCls}>{nameLabel.en}</label>
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} placeholder="" />
          </div>
        </div>

        {/* Row 4: Part No + Position */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์อะไหล่</label>
            <input value={partNo} onChange={(e) => setPartNo(e.target.value)} className={inputCls} placeholder="8-97306044-0" />
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
            <select value={unit} onChange={(e) => { setUnit(e.target.value); setTouched((t) => ({ ...t, unit: true })) }} className={selectCls} required>
              {Object.entries(filteredUnitOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 6: Brand + Grade */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ยี่ห้อ</label>
            <BrandCombobox
              options={brandOptions}
              value={brand}
              onChange={setBrand}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Grade</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className={selectCls}>
              {Object.entries(gradeOptions).map(([k, v]) => <option key={k} value={k}>{k} — {v.th}</option>)}
            </select>
          </div>
        </div>

        {/* Row 7: OEM Ref + Compat Refs */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>เบอร์แท้อ้างอิง (OEM Ref)</label>
            <input value={oemRef} onChange={(e) => setOemRef(e.target.value)} className={inputCls} placeholder="8-97306044-0" />
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

        {/* Row 8: Vehicle */}
        <div>
          <label className={labelCls}>ทะเบียนหรือรุ่นรถ <span className="font-normal text-gray-400">(เลือกได้หลายคัน)</span></label>
          <VehicleMultiSelect
            values={vehicles}
            onChange={setVehicles}
            className={inputCls}
          />
        </div>

        {/* Row 9: Images */}
        <div>
          <label className={labelCls}>
            รูปภาพประกอบ <span className="font-normal text-gray-400">(ไม่บังคับ — แนบได้หลายรูป)</span>
          </label>
          <ImageUpload onChange={setImages} />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="flex-1 rounded-[13px] text-white py-3 text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: "#1B8C4B", boxShadow: "0 5px 12px -3px rgba(27,140,75,.5)", fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
            {saving ? "กำลังบันทึก..." : "บันทึก SKU"}
          </button>
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-200 dark:border-white/10 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>

    {/* Parts catalog reference panel */}
    <div className="flex-1 min-w-0 border-l border-gray-200 dark:border-white/8 pl-8">
      <PartsPage allowAdminMode={isAdmin} />
    </div>
    </div>
  )
}
