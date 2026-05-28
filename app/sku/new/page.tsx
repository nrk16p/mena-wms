"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  WAREHOUSE, EXPENSE_TYPE, SYSTEM_L1,
  POSITION, UNIT, GRADE, VEHICLE_TYPE, EXPENSE_TYPES_NO_PRICE,
} from "@/lib/codes"
import { BrandCombobox } from "@/components/brand-combobox"
import { VehicleMultiSelect } from "@/components/vehicle-multi-select"
import { ChevronRight, CheckCircle2, Circle, Info, Tag } from "lucide-react"

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

// ── Styling constants ──────────────────────────────────────────────────────────
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5"
const inputCls =
  "w-full rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/4 text-gray-900 dark:text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400 transition-colors"
const selectCls = inputCls
const sectionCard =
  "rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden"
const sectionHeader =
  "px-5 py-3.5 border-b border-gray-100 dark:border-white/6 bg-gray-50/60 dark:bg-white/2"
const sectionBody = "px-5 py-5 space-y-4"

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
  const [brand, setBrand]           = useState("")
  const [oemRef, setOemRef]         = useState("")
  const [compatRefs, setCompatRefs] = useState<string[]>([])
  const [compatInput, setCompatInput] = useState("")
  const [vehicles, setVehicles] = useState<string[]>([])
  const [grade, setGrade]     = useState("OEM")
  const [atmsCodes, setAtmsCodes] = useState<string[]>([])
  const [atmsInput, setAtmsInput] = useState("")

  const [previewSku, setPreviewSku] = useState("")
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState("")
  const [submitted, setSubmitted]   = useState(false)

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

  // Which L1 codes are appropriate per expense type
  const L1_FILTER: Record<string, string[]> = {
    PRT: ["ENG","COL","FUL","TRN","SUS","BRK","STR","ELC","EXH","TYR","LUB","MXS","REF","PTO","TRL","BOD","SAF","CSM","ACS"],
    PM:  ["ENG","COL","FUL","TRN","SUS","BRK","STR","ELC","TYR","LUB","MXS","PTO","ACS"],
    LAB: ["ENG","TRN","BRK","SUS","STR","ELC","MXS","TRL","BOD","TYR","PTO","ACS"],
    SVC: ["SVC"],
    CLN: ["CLN"],
    TRP: ["TRP"],
    ACC: ["BOD","ENG","TRN","BRK","SUS"],
  }

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
      .then((rows: Row[]) => setL2Options(toMap(rows)))
      .catch(() => setL2Options({}))
  }, [l1, type])

  // Load L3 from MongoDB when L1+L2 or expense type changes
  useEffect(() => {
    if (!l1 || !l2) { setL3Options({}); setL3(""); return }
    fetch(`/api/codes/COMPONENT_L3?parent=${l1}:${l2}&expenseType=${type}`)
      .then((r) => r.json())
      .then((rows: Row[]) => setL3Options(toMap(rows)))
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
    if (!wh || !type || !l1 || !l2 || !l3) { setPreviewSku(""); return }
    fetch(`/api/sku/next-seq?wh=${wh}&type=${type}&l1=${l1}&l2=${l2}&l3=${l3}`)
      .then((r) => r.json())
      .then((d) => setPreviewSku(d.sku ?? ""))
  }, [wh, type, l1, l2, l3])

  const noPrice = EXPENSE_TYPES_NO_PRICE.includes(type)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!l1 || !l2 || !l3) { setError("กรุณาเลือก L1, L2, L3"); return }
    if (atmsCodes.length === 0) { setError("กรุณาระบุรหัส ATMS อย่างน้อย 1 รหัส"); return }
    setError("")
    setSaving(true)

    const res = await fetch("/api/sku", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wh, type, l1, l2, l3, nameTh, nameEn, partNo, position, price: noPrice ? "0" : price, unit, brand, oemRef, compatRefs, vehicles, grade, atmsCodes }),
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

  // ── Checklist completion flags ────────────────────────────────────────────────
  const doneClassification = Boolean(wh && type && l1 && l2 && l3)
  const doneName           = Boolean(nameTh.trim())
  const doneAtms           = atmsCodes.length > 0

  // Suppress vehicleOptions lint warning — state is set from DB load, intentionally kept
  void vehicleOptions

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">เพิ่ม SKU ใหม่</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          กรอกข้อมูลด้านล่าง ระบบจะสร้าง SKU ให้อัตโนมัติ
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-6 items-start">

          {/* ── LEFT COLUMN — form sections ───────────────────────────────────── */}
          <div className="flex-1 space-y-5">

            {/* ── Section 1: Classification ──────────────────────────────────── */}
            <div className={sectionCard}>
              <div className={sectionHeader}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-bold">
                    1
                  </span>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Classification</h2>
                </div>
              </div>
              <div className={sectionBody}>
                {/* WH + Type row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>คลังสินค้า *</label>
                    <select
                      value={wh}
                      onChange={(e) => setWh(e.target.value)}
                      className={selectCls}
                      required
                    >
                      {Object.entries(whOptions).map(([k, v]) => (
                        <option key={k} value={k}>{k} — {v.th}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>ประเภทค่าใช้จ่าย *</label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className={selectCls}
                      required
                    >
                      {Object.entries(typeOptions).map(([k, v]) => (
                        <option key={k} value={k}>{k} — {v.th}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* L1 → L2 → L3 cascade */}
                <div className="flex items-start gap-2">
                  {/* L1 */}
                  <div className="flex-1">
                    <label className={labelCls}>
                      ระบบ L1{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={l1}
                      onChange={(e) => setL1(e.target.value)}
                      className={
                        selectCls +
                        (submitted && !l1
                          ? " border-red-400 dark:border-red-500 ring-1 ring-red-400"
                          : "")
                      }
                      required
                    >
                      <option value="">— เลือก L1 —</option>
                      {Object.entries(l1Options).map(([k, v]) => (
                        <option key={k} value={k}>{k} {v.th}</option>
                      ))}
                    </select>
                    {l1 && (
                      <p className="text-[11px] text-gray-400 mt-1">{l1Options[l1]?.th}</p>
                    )}
                  </div>

                  <ChevronRight
                    size={16}
                    className="mt-8 shrink-0 text-gray-300 dark:text-gray-700"
                  />

                  {/* L2 */}
                  <div
                    className={`flex-1 transition-opacity ${
                      l1 ? "opacity-100" : "opacity-30 pointer-events-none"
                    }`}
                  >
                    <label className={labelCls}>
                      ชุดประกอบ L2{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={l2}
                      onChange={(e) => setL2(e.target.value)}
                      className={
                        selectCls +
                        (submitted && l1 && !l2
                          ? " border-red-400 dark:border-red-500 ring-1 ring-red-400"
                          : "")
                      }
                      disabled={!l1}
                    >
                      <option value="">— เลือก L2 —</option>
                      {Object.entries(l2Options).map(([k, v]) => (
                        <option key={k} value={k}>{k} {v.th}</option>
                      ))}
                    </select>
                    {l2 && (
                      <p className="text-[11px] text-gray-400 mt-1">{l2Options[l2]?.th}</p>
                    )}
                  </div>

                  <ChevronRight
                    size={16}
                    className="mt-8 shrink-0 text-gray-300 dark:text-gray-700"
                  />

                  {/* L3 */}
                  <div
                    className={`flex-1 transition-opacity ${
                      l2 ? "opacity-100" : "opacity-30 pointer-events-none"
                    }`}
                  >
                    <label className={labelCls}>
                      ชิ้นส่วน L3{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={l3}
                      onChange={(e) => setL3(e.target.value)}
                      className={
                        selectCls +
                        (submitted && l2 && !l3
                          ? " border-red-400 dark:border-red-500 ring-1 ring-red-400"
                          : "")
                      }
                      disabled={!l2}
                    >
                      <option value="">— เลือก L3 —</option>
                      {Object.entries(l3Options).map(([k, v]) => (
                        <option key={k} value={k}>{k} {v.th}</option>
                      ))}
                    </select>
                    {l3 && (
                      <p className="text-[11px] text-gray-400 mt-1">{l3Options[l3]?.th}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section 2: รายละเอียด ──────────────────────────────────────── */}
            <div className={sectionCard}>
              <div className={sectionHeader}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-bold">
                    2
                  </span>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">รายละเอียด</h2>
                </div>
              </div>
              <div className={sectionBody}>
                {/* ชื่อ TH */}
                <div>
                  <label className={labelCls}>{nameLabel.th}</label>
                  <input
                    value={nameTh}
                    onChange={(e) => setNameTh(e.target.value)}
                    className={inputCls}
                    placeholder={nameLabel.placeholder}
                    required
                  />
                </div>

                {/* ชื่อ EN */}
                <div>
                  <label className={labelCls}>{nameLabel.en}</label>
                  <input
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className={inputCls}
                    placeholder=""
                  />
                </div>

                {/* Part No + Position */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>เบอร์อะไหล่</label>
                    <input
                      value={partNo}
                      onChange={(e) => setPartNo(e.target.value)}
                      className={inputCls}
                      placeholder="8-97306044-0"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>ตำแหน่ง</label>
                    <select
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      className={selectCls}
                    >
                      {Object.entries(posOptions).map(([k, v]) => (
                        <option key={k} value={k}>{k} — {v.th}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section 3: ราคา & หน่วย ───────────────────────────────────── */}
            <div className={sectionCard}>
              <div className={sectionHeader}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-bold">
                    3
                  </span>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">ราคา &amp; หน่วย</h2>
                </div>
              </div>
              <div className={sectionBody}>
                {noPrice ? (
                  /* No-price info box */
                  <div className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3 px-4 py-3">
                    <Info
                      size={15}
                      className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500"
                    />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      ประเภท{" "}
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {type}
                      </span>{" "}
                      — ราคากรอกตอนทำ transaction ไม่ต้องระบุล่วงหน้า
                    </p>
                  </div>
                ) : (
                  /* Price + Unit row */
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>ราคาต่อหน่วย (บาท)</label>
                      <input
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputCls}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>หน่วย *</label>
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        className={selectCls}
                        required
                      >
                        {Object.entries(unitOptions).map(([k, v]) => (
                          <option key={k} value={k}>{k} — {v.th}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Section 4: คุณสมบัติ ──────────────────────────────────────── */}
            <div className={sectionCard}>
              <div className={sectionHeader}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-bold">
                    4
                  </span>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">คุณสมบัติ</h2>
                </div>
              </div>
              <div className={sectionBody}>
                {/* Brand + Grade */}
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
                    <select
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                      className={selectCls}
                    >
                      {Object.entries(gradeOptions).map(([k, v]) => (
                        <option key={k} value={k}>{k} — {v.th}</option>
                      ))}
                    </select>
                    {grade && gradeOptions[grade]?.th && (
                      <p className="text-[11px] text-gray-400 italic mt-1">
                        {gradeOptions[grade]?.th}
                      </p>
                    )}
                  </div>
                </div>

                {/* OEM Ref + Compat Refs */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>เบอร์แท้อ้างอิง (OEM Ref)</label>
                    <input
                      value={oemRef}
                      onChange={(e) => setOemRef(e.target.value)}
                      className={inputCls}
                      placeholder="8-97306044-0"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      เบอร์เทียบอ้างอิง{" "}
                      <span className="normal-case font-normal text-gray-400">(ใส่ได้หลายเบอร์)</span>
                    </label>
                    <div
                      className={
                        inputCls +
                        " min-h-[42px] flex flex-wrap gap-1 items-center py-1.5 cursor-text"
                      }
                    >
                      {compatRefs.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 text-xs font-mono"
                        >
                          {c}
                          <button
                            type="button"
                            onClick={() => setCompatRefs((p) => p.filter((x) => x !== c))}
                            className="hover:text-red-500 transition-colors"
                          >
                            ×
                          </button>
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

                {/* Vehicle multi-select */}
                <div>
                  <label className={labelCls}>
                    ทะเบียนหรือรุ่นรถ{" "}
                    <span className="normal-case font-normal text-gray-400">(เลือกได้หลายคัน)</span>
                  </label>
                  <VehicleMultiSelect
                    values={vehicles}
                    onChange={setVehicles}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN — sticky summary panel ───────────────────────────── */}
          <div className="w-72 shrink-0 sticky top-6 space-y-3">

            {/* Summary card — SKU preview + checklist + ATMS */}
            <div className={sectionCard}>

              {/* SKU Preview */}
              <div className="px-5 pt-5 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                  SKU ที่จะสร้าง
                </p>
                {previewSku ? (
                  <p className="font-mono text-lg font-bold text-gray-900 dark:text-white break-all">
                    {previewSku}
                  </p>
                ) : (
                  <p className="font-mono text-sm text-gray-300 dark:text-gray-600">
                    เลือก WH · Type · L1 · L2 · L3
                  </p>
                )}
              </div>

              <div className="border-t border-gray-100 dark:border-white/6" />

              {/* Completion checklist */}
              <div className="px-5 py-4 space-y-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">
                  ความสมบูรณ์
                </p>

                {/* Classification */}
                <div className="flex items-center gap-2.5">
                  {doneClassification ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  ) : (
                    <Circle size={15} className="shrink-0 text-gray-300 dark:text-gray-600" />
                  )}
                  <span
                    className={`text-sm ${
                      doneClassification
                        ? "text-gray-700 dark:text-gray-200"
                        : "text-gray-400 dark:text-gray-600"
                    }`}
                  >
                    Classification
                  </span>
                </div>

                {/* Name TH */}
                <div className="flex items-center gap-2.5">
                  {doneName ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  ) : (
                    <Circle size={15} className="shrink-0 text-gray-300 dark:text-gray-600" />
                  )}
                  <span
                    className={`text-sm ${
                      doneName
                        ? "text-gray-700 dark:text-gray-200"
                        : "text-gray-400 dark:text-gray-600"
                    }`}
                  >
                    ชื่ออะไหล่
                  </span>
                </div>

                {/* ATMS codes */}
                <div className="flex items-center gap-2.5">
                  {doneAtms ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  ) : (
                    <Circle size={15} className="shrink-0 text-gray-300 dark:text-gray-600" />
                  )}
                  <span
                    className={`text-sm ${
                      doneAtms
                        ? "text-gray-700 dark:text-gray-200"
                        : "text-gray-400 dark:text-gray-600"
                    }`}
                  >
                    รหัส ATMS
                  </span>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-white/6" />

              {/* ATMS codes input */}
              <div
                className={`px-5 py-4 ${
                  submitted && atmsCodes.length === 0
                    ? "bg-red-50/60 dark:bg-red-950/20"
                    : ""
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Tag size={12} className="shrink-0 text-blue-500" />
                  <label
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      submitted && atmsCodes.length === 0
                        ? "text-red-500 dark:text-red-400"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    รหัสสินค้า ATMS{" "}
                    <span className="text-red-500">*</span>
                  </label>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-600 mb-2.5">
                  อย่างน้อย 1 รหัส
                </p>

                {/* Tags */}
                {atmsCodes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {atmsCodes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-mono"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={() => setAtmsCodes((p) => p.filter((c) => c !== code))}
                          className="hover:text-red-500 transition-colors"
                          aria-label={`ลบรหัส ${code}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Input row */}
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
                    placeholder="พิมพ์รหัส แล้วกด Enter"
                    className={`flex-1 rounded-lg border text-sm font-mono px-3 py-1.5 focus:outline-none focus:ring-2 placeholder-gray-400 bg-gray-50 dark:bg-white/4 text-gray-900 dark:text-white transition-colors ${
                      submitted && atmsCodes.length === 0
                        ? "border-red-300 dark:border-red-500 focus:ring-red-400"
                        : "border-gray-200 dark:border-white/10 focus:ring-blue-500 dark:focus:ring-blue-400"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (atmsInput.trim() && !atmsCodes.includes(atmsInput.trim())) {
                        setAtmsCodes((p) => [...p, atmsInput.trim()])
                        setAtmsInput("")
                      }
                    }}
                    className="rounded-lg bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    เพิ่ม
                  </button>
                </div>

                <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1.5">
                  รหัสอ้างอิงจากระบบ ATMS — เพิ่มได้หลายรหัส
                </p>
              </div>

              <div className="border-t border-gray-100 dark:border-white/6" />

              {/* Submit area */}
              <div className="px-5 py-4 space-y-3">
                {error && (
                  <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
                )}

                {!isAdmin && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-3 py-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" />
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      รอ Admin อนุมัติก่อนปรากฏในรายการ
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? "กำลังบันทึก..." : "บันทึก SKU"}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
