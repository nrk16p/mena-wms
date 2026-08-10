"use client"

import { useEffect, useState } from "react"
import {
  Bot, Truck, Search, Sparkles, ClipboardCheck, Wrench, Check, ChevronRight,
  AlertTriangle, Loader2, RotateCcw, ShieldAlert, PackageSearch, Settings2, Database, ChevronDown,
} from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"

// ── types (mirror JSON schema ฝั่ง lib/ai-mixer.ts) ──
type Vehicle = {
  plate: string; fleetNo: string; customer: string; plant: string
  vehicleType: string; vehicleAge: string; mileage: string
}
type Symptom = { symptom: string; system_group: string; severity: string; safety_risk: boolean; initial_note: string }
type Step1Result = { symptoms: Symptom[]; overall_urgency: string; questions_to_reporter: string[]; summary_for_confirm: string }
type ChecklistItem = { item: string; method: string; expected: string; related_symptom: string }
type ExpectedPart = { part_name: string; qty: string; condition: string }
type Step2Result = { checklist: ChecklistItem[]; expected_parts: ExpectedPart[]; safety_precautions: string[] }
type Part = { part_name: string; spec: string; qty: string }
type AnalysisItem = {
  symptom: string; probable_causes: string[]; priority: number; repair_now: boolean
  reason: string; impact: string; est_repair_hours: string; parts: Part[]
}
type Step3Result = { analysis: AnalysisItem[]; total_est_downtime: string; supervisor_notes: string }
type CheckResult = { result: "" | "ปกติ" | "พบปัญหา" | "ไม่ได้ตรวจ"; note: string }

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"
const cardCls =
  "rounded-[14px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a17] p-4 lg:p-5"
const labelCls = "mb-1 block text-[11px] font-bold text-[#4B5F54] dark:text-gray-400"

function severityCls(s: string) {
  if (s.startsWith("วิกฤต")) return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
  if (s === "เร่งด่วน")      return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
  if (s === "เฝ้าระวัง")     return "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
}

const STEPS = [
  { n: 1, label: "รับแจ้งซ่อม", icon: Truck },
  { n: 2, label: "QC ตรวจก่อนซ่อม", icon: ClipboardCheck },
  { n: 3, label: "Supervisor วิเคราะห์", icon: Wrench },
]

export function AiMixerMaintenancePage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState("")

  // ขั้น 1
  const [notifyText, setNotifyText] = useState("")
  const [vehicle, setVehicle] = useState<Vehicle>({ plate: "", fleetNo: "", customer: "", plant: "", vehicleType: "", vehicleAge: "", mileage: "" })
  const [lookingUp, setLookingUp] = useState(false)
  const [step1, setStep1] = useState<Step1Result | null>(null)

  // ขั้น 2
  const [step2, setStep2] = useState<Step2Result | null>(null)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [symptomFound, setSymptomFound] = useState<boolean[]>([])
  const [extraFindings, setExtraFindings] = useState("")

  // ขั้น 3
  const [step3, setStep3] = useState<Step3Result | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // ตั้งค่า Mixer Repair KB API (ฐานความรู้ประวัติซ่อมจริง) — เก็บใน localStorage เพราะ URL ngrok เปลี่ยนบ่อย
  const [kbOpen, setKbOpen] = useState(false)
  const [kbUrl, setKbUrl] = useState("")
  const [kbKey, setKbKey] = useState("")
  const [kbStatus, setKbStatus] = useState<"" | "testing" | "ok" | "fail">("")
  const [kbUsed, setKbUsed] = useState(false)
  // engine: "claude" = Claude AI (+KB ประกอบ) · "kb" = ฐานความรู้อย่างเดียว ไม่ใช้ LLM (ฟรี)
  // default = kb เพราะใช้ได้ทันทีโดยไม่ต้องมี ANTHROPIC_API_KEY
  const [engine, setEngine] = useState<"claude" | "kb">("kb")

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("aiMixerKb") ?? "{}")
      if (saved.url) setKbUrl(saved.url)
      if (saved.key) setKbKey(saved.key)
      if (saved.engine === "kb" || saved.engine === "claude") setEngine(saved.engine)
    } catch { /* ignore */ }
  }, [])
  function saveEngine(v: "claude" | "kb") {
    setEngine(v)
    try { localStorage.setItem("aiMixerKb", JSON.stringify({ url: kbUrl, key: kbKey, engine: v })) } catch { /* ignore */ }
  }
  function saveKb(url: string, key: string) {
    setKbUrl(url); setKbKey(key); setKbStatus("")
    try { localStorage.setItem("aiMixerKb", JSON.stringify({ url, key, engine })) } catch { /* ignore */ }
  }
  async function testKb() {
    setKbStatus("testing")
    try {
      const res = await fetch("/api/ai-mixer-maintenance/kb-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kb: { url: kbUrl, key: kbKey } }),
      })
      const data = await res.json()
      setKbStatus(data.ok ? "ok" : "fail")
      if (!data.ok) swalError(data.error || "เชื่อมต่อ KB ไม่สำเร็จ")
    } catch {
      setKbStatus("fail")
      swalError("เชื่อมต่อ KB ไม่สำเร็จ")
    }
  }

  const setV = (k: keyof Vehicle, v: string) => setVehicle((p) => ({ ...p, [k]: v }))

  async function lookupVehicle() {
    const plate = vehicle.plate.trim()
    if (!plate) return
    setLookingUp(true)
    try {
      const res = await fetch(`/api/vehicles?plates=${encodeURIComponent(plate)}`)
      const data = await res.json()
      const v = Array.isArray(data) ? data[0] : null
      if (!v) { swalToast("warning", "ไม่พบทะเบียนนี้ใน Vehicle Master — กรอกข้อมูลเองได้"); return }
      // ปี ค.ศ./พ.ศ. → อายุรถโดยประมาณ
      let age = ""
      const y = Number(v.year)
      if (y > 2400) age = `${new Date().getFullYear() + 543 - y} ปี`
      else if (y > 1900) age = `${new Date().getFullYear() - y} ปี`
      setVehicle((p) => ({
        ...p,
        fleetNo:     v.fleetNo ?? p.fleetNo,
        vehicleType: v.vehicleType ?? p.vehicleType,
        plant:       v.plant ?? p.plant,
        customer:    v.fleet ?? p.customer,
        vehicleAge:  age || p.vehicleAge,
      }))
      swalToast("success", "ดึงข้อมูลรถแล้ว — ตรวจสอบ/เติมส่วนที่ขาดได้")
    } catch {
      swalError("ดึงข้อมูลรถไม่สำเร็จ")
    } finally {
      setLookingUp(false)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function analyze(payload: Record<string, unknown>, msg: string): Promise<any | null> {
    setLoading(true)
    setLoadingMsg(msg)
    try {
      const res = await fetch("/api/ai-mixer-maintenance/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, vehicle, engine, kb: kbUrl.trim() ? { url: kbUrl.trim(), key: kbKey.trim() } : undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "วิเคราะห์ไม่สำเร็จ")
      setKbUsed(Boolean(data.kbUsed))
      if (data.kbError) swalToast("warning", `KB API ใช้ไม่ได้ (${data.kbError}) — วิเคราะห์โดยไม่มีข้อมูลอ้างอิง`)
      if (data.fallbackToKb) swalToast("info", "เซิร์ฟเวอร์ยังไม่มี Claude API key — ใช้โหมดฐานความรู้ให้อัตโนมัติ")
      return data.result
    } catch (e) {
      swalError(e instanceof Error ? e.message : "วิเคราะห์ไม่สำเร็จ")
      return null
    } finally {
      setLoading(false)
    }
  }

  async function runStep1() {
    if (!notifyText.trim()) { swalError("กรุณากรอกข้อความแจ้งซ่อม"); return }
    if (!vehicle.plate.trim()) { swalError("กรุณากรอกทะเบียนรถ"); return }
    const result = await analyze({ step: 1, notifyText }, engine === "kb" ? "กำลังค้นฐานความรู้ประวัติซ่อม..." : "AI กำลังวิเคราะห์การแจ้งซ่อม...")
    if (result) setStep1(result)
  }

  async function confirmStep1() {
    if (!step1) return
    const result = await analyze(
      { step: 2, confirmedTicket: { notifyText, symptoms: step1.symptoms, overall_urgency: step1.overall_urgency } },
      engine === "kb" ? "กำลังดึง Checklist จากฐานความรู้..." : "AI กำลังสร้าง Checklist สำหรับ QC...",
    )
    if (!result) return
    setStep2(result)
    setCheckResults((result.checklist as ChecklistItem[]).map(() => ({ result: "", note: "" })))
    setSymptomFound(step1.symptoms.map(() => true))
    setStep(2)
  }

  async function confirmStep2() {
    if (!step1 || !step2) return
    if (checkResults.some((c) => !c.result)) { swalError("กรุณาบันทึกผลตรวจให้ครบทุกข้อ"); return }
    const qcResult = {
      confirmed_symptoms: step1.symptoms.map((s, i) => ({ ...s, qc_confirmed: symptomFound[i] ? "พบจริง" : "ไม่พบ" })),
      checklist_results: step2.checklist.map((c, i) => ({ ...c, result: checkResults[i].result, note: checkResults[i].note })),
      extra_findings: extraFindings.trim() || "-",
      expected_parts: step2.expected_parts,
    }
    const result = await analyze({ step: 3, qcResult }, engine === "kb" ? "กำลังสรุปแผนซ่อมจากสถิติประวัติจริง..." : "AI กำลังวิเคราะห์อาการ จัดลำดับงาน และสรุปอะไหล่...")
    if (!result) return
    ;(result.analysis as AnalysisItem[]).sort((a, b) => a.priority - b.priority)
    setStep3(result)
    setStep(3)
  }

  async function confirmStep3() {
    if (!step1 || !step3) return
    setLoading(true)
    setLoadingMsg("กำลังบันทึกผล...")
    try {
      const res = await fetch("/api/ai-mixer-maintenance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle, notifyText,
          step1,
          step2: step2 ? {
            ...step2,
            checklist_results: checkResults,
            symptom_found: symptomFound,
            extra_findings: extraFindings,
          } : null,
          step3,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ")
      setSavedId(String(data.id))
      setStep(4)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }

  function resetAll() {
    setStep(1); setStep1(null); setStep2(null); setStep3(null)
    setNotifyText(""); setExtraFindings(""); setSavedId(null)
    setCheckResults([]); setSymptomFound([])
    setVehicle({ plate: "", fleetNo: "", customer: "", plant: "", vehicleType: "", vehicleAge: "", mileage: "" })
  }

  return (
    <div className="mx-auto max-w-5xl" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-[#1B8C4B]/10">
          <Bot size={22} className="text-[#1B8C4B]" />
        </div>
        <div>
          <h1 className="text-[17px] font-bold text-[#14271C] dark:text-white">AI ช่วยจัดการงานซ่อมรถโม่</h1>
          <p className="text-[12px] text-[#9AA8A0]">ทดสอบระบบ · Fleet Mixer Truck Maintenance — ผล AI เป็นข้อเสนอ ผู้ใช้ยืนยันทุกขั้น</p>
        </div>
      </div>

      {/* ตั้งค่า KB API */}
      <div className="mb-4 rounded-[14px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a17]">
        <button onClick={() => setKbOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3">
          <Settings2 size={14} className="text-[#1B8C4B]" />
          <span className="flex-1 text-left text-[12.5px] font-bold text-[#14271C] dark:text-white">
            ตั้งค่าฐานความรู้ (Mixer Repair KB API)
          </span>
          {kbUrl ? (
            <span className={[
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
              kbStatus === "ok" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : kbStatus === "fail" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400",
            ].join(" ")}>
              <Database size={10} />
              {kbStatus === "ok" ? "เชื่อมต่อได้" : kbStatus === "fail" ? "เชื่อมต่อไม่ได้" : "ตั้งค่าแล้ว"}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400 dark:bg-white/10">ยังไม่ได้ตั้งค่า</span>
          )}
          <ChevronDown size={14} className={`text-[#9AA8A0] transition-transform ${kbOpen ? "rotate-180" : ""}`} />
        </button>
        {kbOpen && (
          <div className="border-t border-[#EEF2F0] px-4 py-3 dark:border-white/[0.07]">
            {/* โหมดวิเคราะห์ */}
            <div className="mb-3">
              <label className={labelCls}>โหมดวิเคราะห์</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => saveEngine("claude")}
                  className={[
                    "rounded-[11px] border px-3.5 py-2 text-left text-[12px] transition-colors",
                    engine === "claude" ? "border-[#1B8C4B] bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10 opacity-70",
                  ].join(" ")}>
                  <span className="font-bold text-[#14271C] dark:text-white">🤖 Claude AI + ฐานความรู้</span>
                  <span className="block text-[11px] text-[#9AA8A0]">คุณภาพสูงสุด · ต้องมี ANTHROPIC_API_KEY · มีค่าใช้จ่าย</span>
                </button>
                <button onClick={() => saveEngine("kb")}
                  className={[
                    "rounded-[11px] border px-3.5 py-2 text-left text-[12px] transition-colors",
                    engine === "kb" ? "border-[#1B8C4B] bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : "border-[#E2E8E4] dark:border-white/10 opacity-70",
                  ].join(" ")}>
                  <span className="font-bold text-[#14271C] dark:text-white">📚 ฐานความรู้อย่างเดียว</span>
                  <span className="block text-[11px] text-[#9AA8A0]">ฟรี 100% ไม่ใช้ LLM · สรุปจากสถิติประวัติซ่อมจริงตรงๆ</span>
                </button>
              </div>
            </div>
            <p className="mb-2 text-[11.5px] text-[#9AA8A0]">
              เมื่อตั้งค่าแล้ว AI จะดึงข้อมูลจากประวัติซ่อมจริง (/diagnose) มาประกอบการวิเคราะห์ขั้น 1 และ 3 · ค่าเก็บในเครื่องนี้เท่านั้น (localStorage) — URL ngrok เปลี่ยนเมื่อไหร่มาแก้ตรงนี้ได้เลย
            </p>
            <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className={labelCls}>KB API URL</label>
                <input className={inputCls} placeholder="https://xxxx.ngrok-free.app" value={kbUrl}
                  onChange={(e) => saveKb(e.target.value, kbKey)} />
              </div>
              <div>
                <label className={labelCls}>API Key (X-API-Key)</label>
                <input className={inputCls} type="password" placeholder="mxk_..." value={kbKey}
                  onChange={(e) => saveKb(kbUrl, e.target.value)} />
              </div>
              <div className="flex items-end">
                <button onClick={testKb} disabled={kbStatus === "testing" || !kbUrl.trim() || !kbKey.trim()}
                  className="flex h-[42px] items-center gap-1.5 rounded-[11px] border border-[#1B8C4B] px-3.5 text-[12.5px] font-bold text-[#1B8C4B] hover:bg-[#F0FDF4] disabled:opacity-50 dark:hover:bg-[#1B8C4B]/10">
                  {kbStatus === "testing" ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                  ทดสอบการเชื่อมต่อ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* stepper */}
      <div className="mb-5 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const active = step === s.n
          const done = step > s.n
          return (
            <div key={s.n} className="flex shrink-0 items-center gap-2">
              {i > 0 && <ChevronRight size={14} className="text-[#B3C0B8]" />}
              <div className={[
                "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold",
                active ? "bg-[#1B8C4B] text-white" : done ? "bg-[#F0FDF4] text-[#1B8C4B] dark:bg-[#1B8C4B]/10" : "bg-gray-100 text-gray-400 dark:bg-white/5",
              ].join(" ")}>
                {done ? <Check size={13} /> : <Icon size={13} />}
                {s.n}. {s.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* loading overlay */}
      {loading && (
        <div className={`${cardCls} mb-4 flex items-center gap-3 border-[#1B8C4B]/30`}>
          <Loader2 size={18} className="animate-spin text-[#1B8C4B]" />
          <p className="text-sm font-semibold text-[#14271C] dark:text-white">{loadingMsg}</p>
        </div>
      )}

      {/* ── STEP 1: รับแจ้งซ่อม ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className={cardCls}>
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-[#14271C] dark:text-white">
              <Truck size={15} className="text-[#1B8C4B]" /> ข้อมูลแจ้งซ่อม
            </h2>
            <div className="mb-3">
              <label className={labelCls}>อาการเสียที่แจ้ง *</label>
              <textarea rows={3} className={inputCls} placeholder="เช่น ลูกปืนล้อหน้าข้างซ้ายแตกและฝาครอบหลุดหาย"
                value={notifyText} onChange={(e) => setNotifyText(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="col-span-2 lg:col-span-1">
                <label className={labelCls}>ทะเบียนรถ *</label>
                <div className="flex gap-1.5">
                  <input className={inputCls} placeholder="สบ.71-1256" value={vehicle.plate} onChange={(e) => setV("plate", e.target.value)} />
                  <button onClick={lookupVehicle} disabled={lookingUp} title="ดึงข้อมูลจาก Vehicle Master"
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#1B8C4B] text-white hover:bg-[#0F6A3C] disabled:opacity-50">
                    {lookingUp ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  </button>
                </div>
              </div>
              <div><label className={labelCls}>เลขรถ</label><input className={inputCls} value={vehicle.fleetNo} onChange={(e) => setV("fleetNo", e.target.value)} /></div>
              <div><label className={labelCls}>ลูกค้า</label><input className={inputCls} placeholder="SCCO" value={vehicle.customer} onChange={(e) => setV("customer", e.target.value)} /></div>
              <div><label className={labelCls}>แพล้นท์</label><input className={inputCls} placeholder="บางนา2" value={vehicle.plant} onChange={(e) => setV("plant", e.target.value)} /></div>
              <div><label className={labelCls}>ประเภทรถ</label><input className={inputCls} placeholder="MS" value={vehicle.vehicleType} onChange={(e) => setV("vehicleType", e.target.value)} /></div>
              <div><label className={labelCls}>อายุรถ</label><input className={inputCls} placeholder="13 ปี 6 เดือน" value={vehicle.vehicleAge} onChange={(e) => setV("vehicleAge", e.target.value)} /></div>
              <div><label className={labelCls}>เลขไมล์ล่าสุด</label><input className={inputCls} placeholder="153,656 km" value={vehicle.mileage} onChange={(e) => setV("mileage", e.target.value)} /></div>
            </div>
            <button onClick={runStep1} disabled={loading}
              className="mt-4 flex items-center gap-2 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
              <Sparkles size={15} /> วิเคราะห์ด้วย AI
            </button>
          </div>

          {step1 && (
            <div className={cardCls}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[14px] font-bold text-[#14271C] dark:text-white">
                  <Sparkles size={15} className="text-[#1B8C4B]" /> ผลวิเคราะห์ — ตรวจสอบและยืนยัน
                </h2>
                <div className="flex items-center gap-1.5">
                  {kbUsed && (
                    <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-[11px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                      <Database size={10} /> อ้างอิงประวัติซ่อมจริง
                    </span>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${severityCls(step1.overall_urgency)}`}>{step1.overall_urgency}</span>
                </div>
              </div>
              <p className="mb-3 rounded-[11px] bg-[#F6FAF7] p-3 text-[13px] text-[#4B5F54] dark:bg-white/5 dark:text-gray-300">{step1.summary_for_confirm}</p>
              <div className="space-y-2.5">
                {step1.symptoms.map((s, i) => (
                  <div key={i} className="rounded-[11px] border border-[#EEF2F0] p-3 dark:border-white/10">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-[#1B8C4B]/10 px-2 py-0.5 text-[11px] font-bold text-[#1B8C4B]">{s.system_group}</span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${severityCls(s.severity)}`}>{s.severity}</span>
                      {s.safety_risk && <span className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-400"><ShieldAlert size={11} /> เสี่ยงความปลอดภัย</span>}
                    </div>
                    <input className={inputCls} value={s.symptom}
                      onChange={(e) => setStep1((p) => p && ({ ...p, symptoms: p.symptoms.map((x, j) => j === i ? { ...x, symptom: e.target.value } : x) }))} />
                    <p className="mt-1.5 text-[12px] text-[#9AA8A0]">{s.initial_note}</p>
                  </div>
                ))}
              </div>
              {step1.questions_to_reporter.length > 0 && (
                <div className="mt-3 rounded-[11px] bg-amber-50 p-3 dark:bg-amber-950/20">
                  <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle size={12} /> คำถามที่ควรถามผู้แจ้งเพิ่ม</p>
                  <ul className="list-inside list-disc text-[12px] text-amber-800 dark:text-amber-300">
                    {step1.questions_to_reporter.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
              <button onClick={confirmStep1} disabled={loading}
                className="mt-4 flex items-center gap-2 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
                <Check size={15} /> ยืนยันอาการ → สร้าง Checklist QC
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2: QC ── */}
      {step === 2 && step2 && step1 && (
        <div className="space-y-4">
          {step2.safety_precautions.length > 0 && (
            <div className="rounded-[14px] border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
              <p className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-red-700 dark:text-red-400"><ShieldAlert size={14} /> ข้อควรระวังก่อนตรวจ</p>
              <ul className="list-inside list-disc text-[12.5px] text-red-800 dark:text-red-300">
                {step2.safety_precautions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          <div className={cardCls}>
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-[#14271C] dark:text-white">
              <ClipboardCheck size={15} className="text-[#1B8C4B]" /> Checklist ตรวจสภาพก่อนซ่อม — บันทึกผลทุกข้อ
            </h2>
            <div className="space-y-2.5">
              {step2.checklist.map((c, i) => (
                <div key={i} className="rounded-[11px] border border-[#EEF2F0] p-3 dark:border-white/10">
                  <p className="text-[13px] font-bold text-[#14271C] dark:text-white">{i + 1}. {c.item}</p>
                  <p className="mt-0.5 text-[12px] text-[#4B5F54] dark:text-gray-400">วิธีตรวจ: {c.method}</p>
                  <p className="text-[12px] text-[#9AA8A0]">เกณฑ์ปกติ: {c.expected} · โยงอาการ: {c.related_symptom}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(["ปกติ", "พบปัญหา", "ไม่ได้ตรวจ"] as const).map((opt) => (
                      <button key={opt}
                        onClick={() => setCheckResults((p) => p.map((x, j) => j === i ? { ...x, result: opt } : x))}
                        className={[
                          "rounded-full px-3 py-1 text-[12px] font-bold transition-colors",
                          checkResults[i]?.result === opt
                            ? opt === "พบปัญหา" ? "bg-red-500 text-white" : opt === "ปกติ" ? "bg-[#1B8C4B] text-white" : "bg-gray-500 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-400",
                        ].join(" ")}>
                        {opt}
                      </button>
                    ))}
                    <input className={`${inputCls} !w-auto flex-1 !py-1.5 text-[12px]`} placeholder="หมายเหตุ (ถ้ามี)"
                      value={checkResults[i]?.note ?? ""}
                      onChange={(e) => setCheckResults((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-[#14271C] dark:text-white">
              <PackageSearch size={15} className="text-[#1B8C4B]" /> อะไหล่ที่คาดว่าต้องใช้ (เช็คสต็อกล่วงหน้า)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="border-b border-[#EEF2F0] text-left text-[11px] text-[#9AA8A0] dark:border-white/10">
                  <th className="py-1.5 pr-3">อะไหล่</th><th className="py-1.5 pr-3">จำนวน</th><th className="py-1.5">เงื่อนไข</th>
                </tr></thead>
                <tbody>
                  {step2.expected_parts.map((p, i) => (
                    <tr key={i} className="border-b border-[#F6FAF7] dark:border-white/5">
                      <td className="py-2 pr-3 font-semibold text-[#14271C] dark:text-white">{p.part_name}</td>
                      <td className="py-2 pr-3">{p.qty}</td>
                      <td className="py-2 text-[#4B5F54] dark:text-gray-400">{p.condition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="mb-2 text-[14px] font-bold text-[#14271C] dark:text-white">ยืนยันอาการเสีย (QA อาการซ่อม)</h2>
            <div className="space-y-2">
              {step1.symptoms.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-[#EEF2F0] p-2.5 dark:border-white/10">
                  <p className="text-[13px] text-[#14271C] dark:text-white">{s.symptom}</p>
                  <div className="flex gap-1.5">
                    {[true, false].map((v) => (
                      <button key={String(v)}
                        onClick={() => setSymptomFound((p) => p.map((x, j) => j === i ? v : x))}
                        className={[
                          "rounded-full px-3 py-1 text-[12px] font-bold",
                          symptomFound[i] === v
                            ? v ? "bg-[#1B8C4B] text-white" : "bg-red-500 text-white"
                            : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400",
                        ].join(" ")}>
                        {v ? "พบจริง" : "ไม่พบ"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className={labelCls}>อาการ/ความเสียหายที่พบเพิ่มเติมระหว่างตรวจ (ถ้ามี)</label>
              <textarea rows={2} className={inputCls} value={extraFindings} onChange={(e) => setExtraFindings(e.target.value)} />
            </div>
            <button onClick={confirmStep2} disabled={loading}
              className="mt-4 flex items-center gap-2 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
              <Check size={15} /> ยืนยันผลตรวจ → ส่งให้ Supervisor วิเคราะห์
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Supervisor ── */}
      {step === 3 && step3 && (
        <div className="space-y-4">
          <div className={cardCls}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[14px] font-bold text-[#14271C] dark:text-white">
                <Wrench size={15} className="text-[#1B8C4B]" /> ผลวิเคราะห์สำหรับ Supervisor — เรียงตามลำดับความสำคัญ
              </h2>
              <div className="flex items-center gap-1.5">
                {kbUsed && (
                  <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-[11px] font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                    <Database size={10} /> อ้างอิงประวัติซ่อมจริง
                  </span>
                )}
                <span className="rounded-full bg-[#1B8C4B]/10 px-2.5 py-1 text-[11px] font-bold text-[#1B8C4B]">เวลาซ่อมรวมโดยประมาณ: {step3.total_est_downtime}</span>
              </div>
            </div>
            <div className="space-y-3">
              {step3.analysis.map((a, i) => (
                <div key={i} className={`rounded-[11px] border p-3.5 ${a.repair_now ? "border-[#1B8C4B]/40" : "border-[#EEF2F0] opacity-80 dark:border-white/10"}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1B8C4B] text-[12px] font-bold text-white">{a.priority}</span>
                    <p className="flex-1 text-[13.5px] font-bold text-[#14271C] dark:text-white">{a.symptom}</p>
                    <button
                      onClick={() => setStep3((p) => p && ({ ...p, analysis: p.analysis.map((x, j) => j === i ? { ...x, repair_now: !x.repair_now } : x) }))}
                      className={`rounded-full px-3 py-1 text-[12px] font-bold ${a.repair_now ? "bg-[#1B8C4B] text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"}`}>
                      {a.repair_now ? "ซ่อมรอบนี้" : "เลื่อนได้/เฝ้าระวัง"}
                    </button>
                  </div>
                  <div className="grid gap-2 text-[12.5px] lg:grid-cols-2">
                    <div>
                      <p className="font-bold text-[#4B5F54] dark:text-gray-300">สาเหตุที่เป็นไปได้ (เรียงตามความน่าจะเป็น)</p>
                      <ol className="list-inside list-decimal text-[#4B5F54] dark:text-gray-400">
                        {a.probable_causes.map((c, j) => <li key={j}>{c}</li>)}
                      </ol>
                    </div>
                    <div className="space-y-1 text-[#4B5F54] dark:text-gray-400">
                      <p><span className="font-bold">Impact:</span> {a.impact}</p>
                      <p><span className="font-bold">เวลาซ่อม:</span> {a.est_repair_hours}</p>
                      <p><span className="font-bold">เหตุผล:</span> {a.reason}</p>
                    </div>
                  </div>
                  {a.parts.length > 0 && (
                    <div className="mt-2 overflow-x-auto rounded-[9px] bg-[#F6FAF7] p-2.5 dark:bg-white/5">
                      <table className="w-full text-[12px]">
                        <thead><tr className="text-left text-[11px] text-[#9AA8A0]">
                          <th className="pb-1 pr-3">อะไหล่</th><th className="pb-1 pr-3">Spec</th><th className="pb-1">จำนวน</th>
                        </tr></thead>
                        <tbody>
                          {a.parts.map((p, j) => (
                            <tr key={j}>
                              <td className="py-0.5 pr-3 font-semibold text-[#14271C] dark:text-white">{p.part_name}</td>
                              <td className="py-0.5 pr-3 text-[#4B5F54] dark:text-gray-400">{p.spec}</td>
                              <td className="py-0.5">{p.qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[11px] bg-[#F0FDF4] p-3 text-[12.5px] text-[#0F6A3C] dark:bg-[#1B8C4B]/10 dark:text-[#7BC89B]">
              <span className="font-bold">ข้อเสนอแนะ:</span> {step3.supervisor_notes}
            </div>
            <button onClick={confirmStep3} disabled={loading}
              className="mt-4 flex items-center gap-2 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
              <Check size={15} /> ยืนยันแผนซ่อม & บันทึก
            </button>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === 4 && (
        <div className={`${cardCls} flex flex-col items-center py-10 text-center`}>
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#1B8C4B]/10">
            <Check size={26} className="text-[#1B8C4B]" />
          </div>
          <h2 className="text-[16px] font-bold text-[#14271C] dark:text-white">บันทึกแผนซ่อมเรียบร้อย</h2>
          <p className="mt-1 text-[12.5px] text-[#9AA8A0]">Session ID: {savedId} · ข้อมูลทั้ง 3 ขั้น (ผล AI + ที่ยืนยัน) ถูกเก็บเป็น audit trail แล้ว</p>
          <p className="mt-0.5 text-[12.5px] text-[#9AA8A0]">ขั้นถัดไป (เปิดงานซ่อมจริง) จะเชื่อมกับระบบ openjob ในเฟสต่อไป</p>
          <button onClick={resetAll}
            className="mt-5 flex items-center gap-2 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0F6A3C]">
            <RotateCcw size={15} /> เริ่มงานแจ้งซ่อมใหม่
          </button>
        </div>
      )}
    </div>
  )
}
