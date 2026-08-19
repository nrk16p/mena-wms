"use client"

// แท็บ "แผนซ่อม" — gantt ของใบงานอู่นอกที่มีอยู่ จัดกลุ่มตามสถานะเรียงลำดับ workflow
// แถว = ใบงานเดิม (ไม่ต้องกรอกใหม่ — คลิกแถวเพื่อนัดวัน/อู่) · แท่ง = แผนเข้าซ่อม (คันเดียวมีได้หลายแผน)
// + overlay ช่วงซ่อมจริง · แผนเก็บใน repair_plans ผูกใบงานผ่าน linkedRepairId
import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, X, ChevronLeft, ChevronRight, Trash2, ArrowRight, History, Search } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import { GarageCombobox, inputCls, type Garage } from "@/components/garage-combobox"
import { PLAN_STATUSES, PLAN_CONVERTED, planStatusMeta, type RepairPlan } from "@/lib/repair-plan"
import { jobTypeOf, JOB_TYPE_GARAGE, REPAIR_STATUSES, REPAIR_DONE_STATUS, jobStartDate, statusMeta, type RepairExternal } from "@/lib/repair-external"
import { bkkToday, bkkDate } from "@/lib/bkk-time"

const labelCls = "mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"

// สีแท่ง "เส้นทางสถานะ" — ต่อ 1 คัน 1 เส้น หลายสีตามช่วงเวลาที่อยู่ในแต่ละสถานะ (จาก log statusChange)
// คนละชุดกับสีแท่งแผน (PLAN_STATUSES.bar) เพื่อแยกสายตาว่าอันไหนคือ "แผน" อันไหนคือ "ประวัติจริง"
const JOB_STATUS_BAR: Record<string, string> = {
  "รอรถเข้า":         "bg-gray-400 dark:bg-gray-500",
  "รถเข้าอู่ซ่อม":     "bg-blue-500",
  "รอ PR":            "bg-amber-500",
  "ซ่อมไม่มีกำหนด":    "bg-orange-500",
  "ซ่อมมีกำหนดเสร็จ":  "bg-teal-500",
  "รถเสร็จ(ไม่มี PR)": "bg-lime-500",
  "รถเสร็จ":          "bg-green-600",
}
const jobStatusBar = (status: string) => JOB_STATUS_BAR[status] ?? "bg-gray-300 dark:bg-gray-600"

// ประวัติสถานะ → ช่วงเวลาแต่ละสี — จุดเริ่มเส้นยึด jobStartDate (min รับแจ้ง/เข้าอู่ ตามหน้าตารางหลัก)
// ไม่ใช่เวลา log แรกเพราะงานคีย์ย้อนหลังจะมี log ช้ากว่าวันจริงมาก; จุดต่อ ๆ ไปยึดเวลา log จริง
function jobStatusSegments(job: RepairExternal, events: { to: string; at: string }[], today: string) {
  const start0 = jobStartDate(job) || (events[0] ? bkkDate(events[0].at) : today)
  if (events.length === 0) return [{ status: job.status, start: start0, end: today }]
  return events.map((e, i) => {
    const segStart = i === 0 ? start0 : bkkDate(e.at)
    const segEndRaw = i + 1 < events.length ? bkkDate(events[i + 1].at) : today
    return { status: e.to, start: segStart, end: segEndRaw < segStart ? segStart : segEndRaw }
  })
}

// ── วันที่แบบ YYYY-MM-DD ล้วน (เลี่ยง timezone โดยคิดเป็นวันปฏิทิน) ──
const toDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) }
const toStr  = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const addDays = (s: string, n: number) => { const d = toDate(s); d.setDate(d.getDate() + n); return toStr(d) }
const dayDiff = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000)
const fmtShort = (s: string) => (s ? toDate(s).toLocaleDateString("th-TH", { day: "numeric", month: "short" }) : "—")

type PlanForm = Omit<RepairPlan, "_id" | "linkedRepairId" | "dateHistory" | "createdBy" | "editedBy">
const EMPTY_PLAN: PlanForm = {
  plate: "", fleetNo: "", repairItems: "", garage: "",
  plannedInDate: "", plannedOutDate: "", planStatus: PLAN_STATUSES[0].value, note: "",
}

// แท่งบน gantt — แผน (คลิกแก้ได้) หรือ ช่วงสถานะจริง (อ่านอย่างเดียว, หลายชิ้นรวมเป็น 1 เส้น)
// lane = ตำแหน่งแถวย่อยในบรรทัดนั้น (แผนแต่ละใบคนละ lane, ช่วงสถานะทุกชิ้นแชร์ lane เดียวกัน)
type Bar = { key: string; start: string; end: string; label: string; title: string; cls: string; lane: number; plan?: RepairPlan }
// แถว = ใบงาน 1 ใบ (หรือกลุ่มแผนลอยของทะเบียนที่ไม่มีใบงาน)
type Row = { key: string; plate: string; fleetNo: string; job?: RepairExternal; bars: Bar[]; lanes: number }

export function RepairPlanTab({
  garages, onConvert, refreshKey,
}: {
  garages: Garage[]
  onConvert: (p: RepairPlan) => void   // แผนผูกใบงาน→เปิดแก้ใบงานเดิม · แผนลอย→เปิดฟอร์มสร้างใบงานใหม่ (parent จัดการ)
  refreshKey: number                   // parent เพิ่มค่าเมื่อแปลงแผนสำเร็จ → โหลดใหม่
}) {
  const today = bkkToday()
  const [plans, setPlans]     = useState<RepairPlan[]>([])
  // ใบงาน active ดึงตรงจาก API (ไม่ใช้ rows ของหน้าใบงาน — อันนั้นถูกตัวกรองหน้าตารางกรองไว้)
  const [activeRepairs, setActiveRepairs] = useState<RepairExternal[]>([])
  // ประวัติเปลี่ยนสถานะต่อใบงาน (repairId → [{to, at}] เก่า→ใหม่) — ใช้วาดเส้นทางสถานะหลายสี
  const [historyByJob, setHistoryByJob] = useState<Record<string, { to: string; at: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [start, setStart]     = useState(addDays(today, -3))
  const [span, setSpan]       = useState<14 | 28>(14)
  const [showActual, setShowActual] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [plansRes, jobsRes] = await Promise.all([
        fetch("/api/repair-plans"),
        fetch("/api/repair-external?scope=active"),
      ])
      const plansData = await plansRes.json()
      const jobsData: RepairExternal[] = await jobsRes.json()
      setPlans(Array.isArray(plansData) ? plansData : [])
      const jobs = Array.isArray(jobsData) ? jobsData : []
      setActiveRepairs(jobs)
      const garageIds = jobs.filter((j) => jobTypeOf(j) === JOB_TYPE_GARAGE).map((j) => j._id)
      if (garageIds.length) {
        const hRes  = await fetch(`/api/repair-external/status-history?ids=${garageIds.join(",")}`)
        const hData = await hRes.json()
        setHistoryByJob(hData && typeof hData === "object" ? hData : {})
      } else setHistoryByJob({})
    } catch { swalError("โหลดแผนซ่อมไม่สำเร็จ") } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  const garageJobs = activeRepairs.filter((r) => jobTypeOf(r) === JOB_TYPE_GARAGE)

  // ── ฟอร์มเพิ่ม/แก้แผน ──
  const [open, setOpen]         = useState(false)
  const [editPlan, setEditPlan] = useState<RepairPlan | null>(null)
  const [form, setForm]         = useState<PlanForm>(EMPTY_PLAN)
  const [sourceJobId, setSourceJobId] = useState("")  // ใบงานที่แผนนี้ดึงมา/ผูกอยู่ (linkedRepairId ตอนสร้าง)
  const [saving, setSaving]     = useState(false)

  function openAdd() {
    setEditPlan(null)
    setSourceJobId("")
    setForm({ ...EMPTY_PLAN, plannedInDate: today })
    setOpen(true)
  }
  // วางแผนจากใบงานเดิม — prefill ทั้งฟอร์มจากใบแจ้งซ่อม ไม่ต้องกรอกใหม่
  function openAddFromJob(job: RepairExternal) {
    setEditPlan(null)
    setSourceJobId(job._id)
    setForm({
      plate: job.plate, fleetNo: job.fleetNo, repairItems: job.symptom, garage: job.garage,
      plannedInDate: today, plannedOutDate: job.dueDate || "", planStatus: PLAN_STATUSES[0].value, note: "",
    })
    setOpen(true)
  }
  function openEdit(p: RepairPlan) {
    setEditPlan(p)
    setSourceJobId(p.linkedRepairId || "")
    setForm({
      plate: p.plate, fleetNo: p.fleetNo, repairItems: p.repairItems, garage: p.garage,
      plannedInDate: p.plannedInDate, plannedOutDate: p.plannedOutDate, planStatus: p.planStatus, note: p.note,
    })
    setOpen(true)
  }

  // เติมเบอร์รถอัตโนมัติจากทะเบียน (เฉพาะตอนกรอกเอง) — debounce
  useEffect(() => {
    if (!open || !form.plate.trim() || form.fleetNo.trim()) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vehicle-daily?plate=${encodeURIComponent(form.plate.trim())}`)
        const d   = await res.json()
        if (d?.fleetNo) setForm((f) => (f.fleetNo ? f : { ...f, fleetNo: d.fleetNo }))
      } catch { /* ignore */ }
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.plate])

  async function save() {
    if (!form.plate.trim())         { swalError("กรุณาระบุทะเบียนรถ"); return }
    if (!form.repairItems.trim())   { swalError("กรุณาระบุรายการที่ต้องซ่อม"); return }
    if (!form.garage.trim())        { swalError("กรุณาระบุอู่"); return }
    if (!form.plannedInDate)        { swalError("กรุณาระบุวันนัดเข้าอู่"); return }
    if (form.plannedOutDate && form.plannedOutDate < form.plannedInDate) { swalError("วันคาดว่าเสร็จต้องไม่ก่อนวันนัดเข้าอู่"); return }
    setSaving(true)
    try {
      const res = await fetch(editPlan ? `/api/repair-plans/${editPlan._id}` : "/api/repair-plans", {
        method: editPlan ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        // PUT ไม่ส่ง linkedRepairId — ค่าที่ผูกไว้เดิมคงอยู่ (API $set เฉพาะฟิลด์ฟอร์ม)
        body: JSON.stringify(editPlan ? form : { ...form, linkedRepairId: sourceJobId }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "บันทึกไม่สำเร็จ") }
      setOpen(false)
      swalToast("success", editPlan ? "แก้ไขแผนแล้ว" : "เพิ่มแผนแล้ว")
      load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally { setSaving(false) }
  }

  async function remove(p: RepairPlan) {
    const ok = await swalDeleteConfirm(`ลบแผนเข้าซ่อมของ ${p.plate}?`)
    if (!ok.isConfirmed) return
    try {
      const res = await fetch(`/api/repair-plans/${p._id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      swalToast("success", "ลบแผนแล้ว")
      setOpen(false)
      load()
    } catch { swalError("ลบไม่สำเร็จ") }
  }

  // ── จัดแถว: กลุ่มตามสถานะใบงานเรียงลำดับ workflow · แผนเกาะแถวใบงานที่ผูก/ทะเบียนตรง ──
  const endDate = addDays(start, span - 1)
  const days = Array.from({ length: span }, (_, i) => addDays(start, i))
  const planEnd = (p: RepairPlan) => p.plannedOutDate || p.plannedInDate

  const planBar = (p: RepairPlan, lane: number): Bar => {
    const meta = planStatusMeta(p.planStatus)
    return {
      key: `plan-${p._id}`, lane,
      start: p.plannedInDate, end: planEnd(p),
      label: `${meta.emoji} ${p.garage}: ${p.repairItems.split("\n")[0]}`,
      title: `แผน: ${p.planStatus} · ${p.garage}\n${p.repairItems}\n${fmtShort(p.plannedInDate)}${p.plannedOutDate ? ` → ${fmtShort(p.plannedOutDate)}` : ""}`,
      cls: `${meta.bar} text-white cursor-pointer hover:opacity-85 rounded-md`,
      plan: p,
    }
  }

  // แผนของใบงานไหน: linkedRepairId ก่อน → ทะเบียนตรงกับใบงาน active → ไม่เจอ = แผนลอย
  const plansByJob = new Map<string, RepairPlan[]>()
  const floating: RepairPlan[] = []
  for (const p of plans) {
    const job = garageJobs.find((j) => j._id === p.linkedRepairId) ?? garageJobs.find((j) => j.plate === p.plate)
    if (job) {
      if (!plansByJob.has(job._id)) plansByJob.set(job._id, [])
      plansByJob.get(job._id)!.push(p)
    } else floating.push(p)
  }

  const jobRow = (job: RepairExternal): Row => {
    const planBars = (plansByJob.get(job._id) ?? []).map((p, i) => planBar(p, i))
    const historyLane = planBars.length
    // เส้นทางสถานะจริง — หลายชิ้นสี ต่อกันเป็นเส้นเดียวใน lane เดียวกัน (ไม่ใช่คนละแถว)
    const segments = showActual ? jobStatusSegments(job, historyByJob[job._id] ?? [], today) : []
    const historyBars: Bar[] = segments.map((seg, i) => ({
      key: `hist-${job._id}-${i}`, lane: historyLane,
      start: seg.start, end: seg.end,
      label: i === 0 ? `${statusMeta(seg.status).emoji} ${seg.status}` : statusMeta(seg.status).emoji,
      title: `${seg.status}\n${fmtShort(seg.start)} → ${fmtShort(seg.end)}`,
      // ต่อกันเป็นเส้นเดียว — โค้งมนแค่ปลายซ้ายสุด/ขวาสุดของเส้น ไม่ใช่ทุกชิ้น
      cls: `${jobStatusBar(seg.status)} text-white cursor-default ${i === 0 ? "rounded-l-md" : ""} ${i === segments.length - 1 ? "rounded-r-md" : ""}`,
    }))
    const bars = [...planBars, ...historyBars]
    return { key: job._id, plate: job.plate, fleetNo: job.fleetNo, job, bars, lanes: historyLane + (historyBars.length ? 1 : 0) }
  }

  // เรียงตามวันเริ่มเร็วสุดของแท่งในแถว (bars ไม่ได้เรียงตามเวลาแล้ว — ต้องหา min เอง)
  const earliestStart = (r: Row) => r.bars.reduce((min, b) => (b.start < min ? b.start : min), "9999")
  const sortRows = (a: Row, b: Row) => earliestStart(a).localeCompare(earliestStart(b)) || a.plate.localeCompare(b.plate)

  // แผนลอย (ทะเบียนไม่มีใบงาน active) — รวมแผนของทะเบียนเดียวกันไว้แถวเดียว
  const floatingRows: Row[] = (() => {
    const m = new Map<string, { plate: string; fleetNo: string; plans: RepairPlan[] }>()
    for (const p of floating) {
      if (!m.has(p.plate)) m.set(p.plate, { plate: p.plate, fleetNo: p.fleetNo, plans: [] })
      m.get(p.plate)!.plans.push(p)
    }
    return [...m.values()].map((v) => {
      const bars = v.plans.map((p, i) => planBar(p, i))
      return { key: `float-${v.plate}`, plate: v.plate, fleetNo: v.fleetNo, bars, lanes: bars.length }
    })
  })()

  // แถวเดียวกันหมด ไม่แยกกลุ่มตามสถานะ — เรียงตามเวลาที่เข้าสู่ระบบ (เส้นทางสถานะในแท่งบอกสถานะเองอยู่แล้ว)
  const allRows: Row[] = [...garageJobs.map(jobRow), ...floatingRows].sort(sortRows)

  const monthLabel = toDate(start).toLocaleDateString("th-TH", { month: "long", year: "numeric" }) +
    (toDate(start).getMonth() !== toDate(endDate).getMonth() ? ` – ${toDate(endDate).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}` : "")

  const dayCellCls = (d: string) => {
    const dt = toDate(d)
    if (d === today) return "bg-[#F0FDF4] dark:bg-[#1B8C4B]/10"
    return dt.getDay() === 0 || dt.getDay() === 6 ? "bg-[#FAFAF8] dark:bg-white/[0.03]" : ""
  }

  const renderRow = (row: Row) => {
    const rowH = Math.max(row.lanes, 1) * 30 + 8
    const planCount = row.bars.filter((b) => b.plan).length
    return (
      <div key={row.key} className="flex border-b border-[#F1F5F2] dark:border-white/5 last:border-b-0">
        <div className="sticky left-0 z-10 flex w-[150px] shrink-0 items-center justify-between gap-1 bg-white dark:bg-[#151a10] px-3 py-1.5" title={row.job?.symptom || ""}>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[#14271C] dark:text-white">{row.plate || "—"}</p>
            <p className="truncate text-[10px] text-[#9AA8A0]">{row.fleetNo ? `เบอร์ ${row.fleetNo}` : ""}{planCount ? `${row.fleetNo ? " · " : ""}${planCount} แผน` : ""}</p>
          </div>
          {row.job && (
            <button onClick={() => openAddFromJob(row.job!)} title="วางแผนนัดเข้าอู่ (ดึงข้อมูลจากใบงานนี้)"
              className="shrink-0 rounded-md p-1 text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-[#1B8C4B]/10">
              <Plus size={14} />
            </button>
          )}
        </div>
        <div className="relative flex-1" style={{ height: rowH }}>
          <div className="absolute inset-0 flex">
            {days.map((d) => <div key={d} className={`flex-1 border-l border-[#F1F5F2] dark:border-white/5 ${dayCellCls(d)}`} />)}
          </div>
          {row.bars.length === 0 && row.job && (
            <button onClick={() => openAddFromJob(row.job!)}
              className="absolute inset-y-1 left-1 rounded-md px-2 text-left text-[10px] text-gray-300 dark:text-gray-600 hover:text-[#1B8C4B] hover:bg-[#F0FDF4]/60 dark:hover:bg-[#1B8C4B]/10">
              ＋ วางแผนนัดเข้าอู่…
            </button>
          )}
          {row.bars.map((b) => {
            // แท่งอยู่นอกช่วงที่แสดงทั้งแท่ง → ป้ายเล็กชิดขอบบอกวันที่ (คลิกได้ถ้าเป็นแผน)
            if (b.end < start || b.start > endDate) {
              const before = b.end < start
              return (
                <button key={b.key} onClick={b.plan ? () => openEdit(b.plan!) : undefined} title={b.title}
                  className={`absolute flex items-center gap-0.5 rounded px-1 text-[9px] text-gray-400 dark:text-gray-500 ${b.plan ? "hover:text-[#1B8C4B] cursor-pointer" : "cursor-default"}`}
                  style={{ top: 8 + b.lane * 30, ...(before ? { left: 2 } : { right: 2 }) }}>
                  {before ? `◀ ${fmtShort(b.end)}` : `${fmtShort(b.start)} ▶`}
                </button>
              )
            }
            const sIdx = Math.max(0, dayDiff(start, b.start))
            const eIdx = Math.min(span - 1, dayDiff(start, b.end))
            return (
              <div key={b.key} onClick={b.plan ? () => openEdit(b.plan!) : undefined} title={b.title}
                className={`absolute flex items-center gap-1 overflow-hidden px-1.5 text-[10px] font-medium ${b.cls}`}
                style={{ left: `${(sIdx / span) * 100}%`, width: `${((eIdx - sIdx + 1) / span) * 100}%`, top: 4 + b.lane * 30, height: 26 }}>
                {b.start < start && <span className="shrink-0">◀</span>}
                <span className="truncate">{b.label}</span>
                {b.end > endDate && <span className="ml-auto shrink-0">▶</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* แถบควบคุมช่วงวัน + legend */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-white/10 p-0.5">
          <button onClick={() => setStart((s) => addDays(s, -7))} className="rounded-md px-2 py-1.5 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5" title="ถอยหลัง 1 สัปดาห์"><ChevronLeft size={15} /></button>
          <button onClick={() => setStart(addDays(today, -3))} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/5">วันนี้</button>
          <button onClick={() => setStart((s) => addDays(s, 7))} className="rounded-md px-2 py-1.5 text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5" title="เดินหน้า 1 สัปดาห์"><ChevronRight size={15} /></button>
        </div>
        <span className="text-sm font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>{monthLabel}</span>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/10 p-0.5 text-xs">
          {([14, 28] as const).map((n) => (
            <button key={n} onClick={() => setSpan(n)} className={`rounded-md px-2.5 py-1.5 font-medium transition ${span === n ? "bg-[#1B8C4B] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}>{n / 7} สัปดาห์</button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} className="accent-[#1B8C4B]" />
          แสดงเส้นทางสถานะ
        </label>
        <span className="text-[13px] font-semibold text-[#5B7568] dark:text-gray-400">{allRows.length} คัน</span>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0F6A3C] transition-colors">
          <Plus size={14} /> เพิ่มแผน
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-gray-400">สถานะ:</span>
          {REPAIR_STATUSES.filter((s) => s.value !== REPAIR_DONE_STATUS).map((s) => (
            <span key={s.value} className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 dark:text-gray-400">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${jobStatusBar(s.value)}`} /> {s.value}
            </span>
          ))}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] text-gray-400">แผน:</span>
          {PLAN_STATUSES.filter((s) => s.value !== "ยกเลิก").map((s) => (
            <span key={s.value} className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 dark:text-gray-400">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.bar}`} /> {s.value}
            </span>
          ))}
        </span>
      </div>

      {/* Gantt — กลุ่มตามสถานะใบงาน เรียงลำดับ workflow */}
      <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <div style={{ minWidth: 150 + span * 36 }}>
          {/* header วัน */}
          <div className="flex border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16]">
            <div className="sticky left-0 z-10 w-[150px] shrink-0 bg-[#F6FAF7] dark:bg-[#1a1f16] px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">ทะเบียน</div>
            {days.map((d) => {
              const dt = toDate(d)
              const isToday = d === today
              return (
                <div key={d} className={`flex-1 border-l border-[#F1F5F2] dark:border-white/5 px-0.5 py-1.5 text-center ${dayCellCls(d)}`}>
                  <div className={`text-[9px] ${isToday ? "font-bold text-[#1B8C4B]" : "text-[#9AA8A0]"}`}>{dt.toLocaleDateString("th-TH", { weekday: "narrow" })}</div>
                  <div className={`text-[11px] leading-tight ${isToday ? "font-bold text-[#1B8C4B]" : "text-gray-600 dark:text-gray-300"}`}>{dt.getDate()}</div>
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100 dark:bg-white/5" />)}
            </div>
          ) : allRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <p className="text-sm font-semibold text-[#14271C] dark:text-white">ไม่มีใบงานอู่นอกที่กำลังดำเนินการ</p>
              <p className="text-xs text-gray-400">กด “เพิ่มแผน” เพื่อวางแผนรถเข้าอู่ล่วงหน้าได้</p>
            </div>
          ) : (
            allRows.map(renderRow)
          )}
        </div>
      </div>

      {/* Modal เพิ่ม/แก้แผน */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 backdrop-blur-sm sm:p-4">
          <div className="my-2 flex max-h-[94vh] w-full max-w-lg flex-col rounded-2xl border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] shadow-xl sm:my-8">
            <div className="flex items-center justify-between border-b border-[#EEF2F0] dark:border-white/8 px-5 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
                  {editPlan ? "แก้ไขแผนเข้าซ่อม" : "เพิ่มแผนเข้าซ่อม"}
                </h2>
                {editPlan && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${planStatusMeta(form.planStatus).cls}`}>
                    {planStatusMeta(form.planStatus).emoji} {form.planStatus}
                  </span>
                )}
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5"><X size={17} /></button>
            </div>

            <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
              {/* ดึงข้อมูลจากใบแจ้งซ่อมเดิม — ไม่ต้องกรอกใหม่ */}
              {!editPlan && (
                <div>
                  <label className={labelCls}>📋 ดึงจากใบแจ้งซ่อมเดิม (ไม่ต้องกรอกใหม่)</label>
                  {sourceJobId ? (() => {
                    const job = garageJobs.find((j) => j._id === sourceJobId)
                    return (
                      <div className="flex items-center gap-2 rounded-[11px] border border-[#1B8C4B]/40 bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 px-3 py-2 text-xs">
                        <span className="font-semibold text-[#0F6A3C] dark:text-[#4ade80]">🚚 {form.plate}{form.fleetNo ? ` · ${form.fleetNo}` : ""}</span>
                        {job && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusMeta(job.status).cls}`}>{statusMeta(job.status).emoji} {job.status}</span>}
                        <button onClick={() => setSourceJobId("")} title="ยกเลิกการผูกใบงาน (ข้อมูลที่เติมไว้ยังอยู่)" className="ml-auto rounded p-0.5 text-gray-400 hover:text-red-500"><X size={13} /></button>
                      </div>
                    )
                  })() : (
                    <JobPicker jobs={garageJobs} onPick={(job) => {
                      setSourceJobId(job._id)
                      setForm((f) => ({
                        ...f,
                        plate: job.plate, fleetNo: job.fleetNo,
                        repairItems: job.symptom || f.repairItems,
                        garage: job.garage || f.garage,
                        plannedOutDate: job.dueDate || f.plannedOutDate,
                      }))
                    }} />
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>ทะเบียนรถ *</label>
                  <input value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))} placeholder="เช่น 70-1234" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>เบอร์รถ</label>
                  <input value={form.fleetNo} onChange={(e) => setForm((f) => ({ ...f, fleetNo: e.target.value }))} placeholder="เติมอัตโนมัติจากทะเบียน" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>รายการที่ต้องซ่อม * (ขึ้นบรรทัดใหม่ = หลายรายการ)</label>
                <textarea value={form.repairItems} onChange={(e) => setForm((f) => ({ ...f, repairItems: e.target.value }))} rows={3} placeholder={"เช่น เกียร์มีเสียงดัง\nเบรกหน้าไม่อยู่"} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>อู่ *</label>
                <GarageCombobox value={form.garage} garages={garages} onChange={(name) => setForm((f) => ({ ...f, garage: name }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>วันนัดเข้าอู่ *</label>
                  <input type="date" value={form.plannedInDate} onChange={(e) => setForm((f) => ({ ...f, plannedInDate: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>วันคาดว่าเสร็จ</label>
                  <input type="date" value={form.plannedOutDate} min={form.plannedInDate || undefined} onChange={(e) => setForm((f) => ({ ...f, plannedOutDate: e.target.value }))} className={inputCls} />
                </div>
              </div>
              {editPlan && (
                <div>
                  <label className={labelCls}>สถานะแผน</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PLAN_STATUSES.map((s) => (
                      <button key={s.value} type="button" onClick={() => setForm((f) => ({ ...f, planStatus: s.value }))}
                        className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition ${form.planStatus === s.value ? s.cls + " ring-1 ring-current" : "bg-gray-50 text-gray-400 dark:bg-white/5 hover:text-gray-600"}`}>
                        {s.emoji} {s.value}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>หมายเหตุ</label>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputCls} />
              </div>
              {editPlan && (editPlan.dateHistory?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                  <p className="mb-1 flex items-center gap-1 font-semibold"><History size={12} /> ประวัติเลื่อนนัด</p>
                  {editPlan.dateHistory!.map((h, i) => (
                    <p key={i}>{fmtShort(h.from)} → {fmtShort(h.to)}{h.by ? ` · โดย ${h.by}` : ""}</p>
                  ))}
                </div>
              )}
              {editPlan?.linkedRepairId && (
                <a href={`/repair-external?id=${editPlan.linkedRepairId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1B8C4B] hover:underline">
                  🔧 เปิดใบงานที่ผูกกับแผนนี้ <ArrowRight size={12} />
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[#EEF2F0] dark:border-white/8 px-5 py-3.5">
              {editPlan && (
                <button onClick={() => remove(editPlan)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-500/30 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                  <Trash2 size={13} /> ลบแผน
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {editPlan && form.planStatus !== PLAN_CONVERTED && (
                  <button onClick={() => { setOpen(false); onConvert(editPlan) }} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B8C4B] px-3.5 py-2 text-xs font-semibold text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-[#1B8C4B]/10">
                    🔧 รถเข้าอู่แล้ว → {editPlan.linkedRepairId ? "อัพเดทใบงาน" : "สร้างใบงาน"}
                  </button>
                )}
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-60">
                  {saving ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── เลือกใบแจ้งซ่อมเดิมมา prefill ฟอร์มแผน — ค้นหาจากทะเบียน/เบอร์รถ/อาการ/อู่ ── */
function JobPicker({ jobs, onPick }: { jobs: RepairExternal[]; onPick: (j: RepairExternal) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const q = text.trim().toLowerCase()
  const filtered = (q
    ? jobs.filter((j) => `${j.plate} ${j.fleetNo} ${j.symptom} ${j.garage}`.toLowerCase().includes(q))
    : jobs
  ).slice(0, 30)

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true) }}
          placeholder="ค้นหาใบแจ้งซ่อม — ทะเบียน / เบอร์รถ / อาการ"
          className={inputCls + " pl-9"}
        />
      </div>
      {open && (
        <div className="absolute z-[60] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] py-1 shadow-lg">
          {filtered.map((j) => (
            <button key={j._id} type="button" onClick={() => { onPick(j); setOpen(false); setText("") }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#F0FDF4] dark:hover:bg-white/5">
              <span className="shrink-0 text-[12.5px] font-semibold text-[#14271C] dark:text-white">{j.plate}</span>
              {j.fleetNo && <span className="shrink-0 text-[10.5px] text-[#9AA8A0]">เบอร์ {j.fleetNo}</span>}
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold ${statusMeta(j.status).cls}`}>{statusMeta(j.status).emoji} {j.status}</span>
              <span className="truncate text-[10.5px] text-gray-400">{j.symptom}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">ไม่พบใบแจ้งซ่อม</p>}
        </div>
      )}
    </div>
  )
}
