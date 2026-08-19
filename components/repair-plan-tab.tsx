"use client"

// แท็บ "แผนซ่อม" — gantt รายคันของแผนเข้าซ่อมอู่นอก (repair_plans)
// แถว = ทะเบียน · แท่ง = แผนแต่ละใบ (คันเดียวมีได้หลายแผน) · overlay งานซ่อมจริงที่ยัง active
import { useState, useEffect, useCallback } from "react"
import { Plus, X, ChevronLeft, ChevronRight, Trash2, ArrowRight, History } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"
import { GarageCombobox, inputCls, type Garage } from "@/components/garage-combobox"
import { PLAN_STATUSES, PLAN_CONVERTED, planStatusMeta, type RepairPlan } from "@/lib/repair-plan"
import { jobTypeOf, JOB_TYPE_GARAGE, type RepairExternal } from "@/lib/repair-external"
import { bkkToday } from "@/lib/bkk-time"

const labelCls = "mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"

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

// แท่งบน gantt — แผน หรือ งานซ่อมจริง (overlay อ่านอย่างเดียว)
type Bar = { key: string; start: string; end: string; label: string; title: string; cls: string; plan?: RepairPlan }

export function RepairPlanTab({
  garages, onConvert, refreshKey,
}: {
  garages: Garage[]
  onConvert: (p: RepairPlan) => void   // เปิดฟอร์มสร้างใบงานจริง (parent ผูก linkedRepairId หลังบันทึก)
  refreshKey: number                   // parent เพิ่มค่าเมื่อแปลงแผนสำเร็จ → โหลดแผนใหม่
}) {
  const today = bkkToday()
  const [plans, setPlans]     = useState<RepairPlan[]>([])
  // ใบงาน active ดึงตรงจาก API (ไม่ใช้ rows ของหน้าใบงาน — อันนั้นถูกตัวกรองหน้าตารางกรองไว้)
  const [activeRepairs, setActiveRepairs] = useState<RepairExternal[]>([])
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
      const jobsData  = await jobsRes.json()
      setPlans(Array.isArray(plansData) ? plansData : [])
      setActiveRepairs(Array.isArray(jobsData) ? jobsData : [])
    } catch { swalError("โหลดแผนซ่อมไม่สำเร็จ") } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  // ── ฟอร์มเพิ่ม/แก้แผน ──
  const [open, setOpen]       = useState(false)
  const [editPlan, setEditPlan] = useState<RepairPlan | null>(null)
  const [form, setForm]       = useState<PlanForm>(EMPTY_PLAN)
  const [saving, setSaving]   = useState(false)

  function openAdd(prefillDate?: string) {
    setEditPlan(null)
    setForm({ ...EMPTY_PLAN, plannedInDate: prefillDate ?? today })
    setOpen(true)
  }
  function openEdit(p: RepairPlan) {
    setEditPlan(p)
    setForm({
      plate: p.plate, fleetNo: p.fleetNo, repairItems: p.repairItems, garage: p.garage,
      plannedInDate: p.plannedInDate, plannedOutDate: p.plannedOutDate, planStatus: p.planStatus, note: p.note,
    })
    setOpen(true)
  }

  // เติมเบอร์รถอัตโนมัติจากทะเบียน (แหล่งเดียวกับฟอร์มใบแจ้งซ่อม) — debounce
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
        body: JSON.stringify(form),
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

  // ── คำนวณช่วงวัน + จัดแถว ──
  const end  = addDays(start, span - 1)
  const days = Array.from({ length: span }, (_, i) => addDays(start, i))

  const planEnd = (p: RepairPlan) => p.plannedOutDate || p.plannedInDate
  const visible = plans.filter((p) => p.plannedInDate <= end && planEnd(p) >= start)
  const offWindow = plans.length - visible.length

  // แถวต่อทะเบียน: แท่งแผน + แท่งงานซ่อมจริง (เฉพาะอู่นอกที่เข้าอู่แล้วและคาบเกี่ยวช่วงที่แสดง)
  const plateRows = (() => {
    const map = new Map<string, { fleetNo: string; bars: Bar[] }>()
    for (const p of visible) {
      if (!map.has(p.plate)) map.set(p.plate, { fleetNo: p.fleetNo, bars: [] })
      const meta = planStatusMeta(p.planStatus)
      map.get(p.plate)!.bars.push({
        key: `plan-${p._id}`,
        start: p.plannedInDate, end: planEnd(p),
        label: `${meta.emoji} ${p.garage}: ${p.repairItems.split("\n")[0]}`,
        title: `${p.planStatus} · ${p.garage}\n${p.repairItems}\n${fmtShort(p.plannedInDate)}${p.plannedOutDate ? ` → ${fmtShort(p.plannedOutDate)}` : ""}`,
        cls: `${meta.bar} text-white cursor-pointer hover:opacity-85`,
        plan: p,
      })
    }
    if (showActual) {
      for (const r of activeRepairs) {
        if (jobTypeOf(r) !== JOB_TYPE_GARAGE || !r.garageInDate || !map.has(r.plate)) continue
        const rEnd = r.dueDate && r.dueDate >= r.garageInDate ? r.dueDate : today
        if (r.garageInDate > end || rEnd < start) continue
        map.get(r.plate)!.bars.push({
          key: `job-${r._id}`,
          start: r.garageInDate, end: rEnd,
          label: `🔧 กำลังซ่อม · ${r.garage || "ไม่ระบุอู่"}`,
          title: `งานจริง: ${r.status} · ${r.garage || "ไม่ระบุอู่"}\n${r.symptom}`,
          cls: "bg-[#14271C] dark:bg-[#0b0e08] text-white/90 cursor-default border border-white/20",
        })
      }
    }
    return [...map.entries()]
      .map(([plate, v]) => ({ plate, ...v, bars: v.bars.sort((a, b) => a.start.localeCompare(b.start)) }))
      .sort((a, b) => a.bars[0].start.localeCompare(b.bars[0].start) || a.plate.localeCompare(b.plate))
  })()

  const monthLabel = toDate(start).toLocaleDateString("th-TH", { month: "long", year: "numeric" }) +
    (toDate(start).getMonth() !== toDate(end).getMonth() ? ` – ${toDate(end).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}` : "")

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
          แสดงงานซ่อมจริง
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {PLAN_STATUSES.filter((s) => s.value !== "ยกเลิก").map((s) => (
            <span key={s.value} className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 dark:text-gray-400">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.bar}`} /> {s.value}
            </span>
          ))}
          {showActual && <span className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 dark:text-gray-400"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#14271C] dark:bg-black border border-gray-400" /> กำลังซ่อมจริง</span>}
          <button onClick={() => openAdd()} className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0F6A3C] transition-colors">
            <Plus size={14} /> เพิ่มแผน
          </button>
        </div>
      </div>

      {/* Gantt */}
      <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        <div style={{ minWidth: 150 + span * 36 }}>
          {/* header วัน */}
          <div className="flex border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-[#1a1f16]">
            <div className="sticky left-0 z-10 w-[150px] shrink-0 bg-[#F6FAF7] dark:bg-[#1a1f16] px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-[#9AA8A0]">ทะเบียน</div>
            {days.map((d) => {
              const dt = toDate(d)
              const isToday = d === today
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
              return (
                <div key={d} className={`flex-1 border-l border-[#F1F5F2] dark:border-white/5 px-0.5 py-1.5 text-center ${isToday ? "bg-[#F0FDF4] dark:bg-[#1B8C4B]/15" : isWeekend ? "bg-[#FAFAF8] dark:bg-white/[0.03]" : ""}`}>
                  <div className={`text-[9px] ${isToday ? "font-bold text-[#1B8C4B]" : "text-[#9AA8A0]"}`}>{dt.toLocaleDateString("th-TH", { weekday: "narrow" })}</div>
                  <div className={`text-[11px] leading-tight ${isToday ? "font-bold text-[#1B8C4B]" : "text-gray-600 dark:text-gray-300"}`}>{dt.getDate()}</div>
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100 dark:bg-white/5" />)}
            </div>
          ) : plateRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <p className="text-sm font-semibold text-[#14271C] dark:text-white">ยังไม่มีแผนเข้าซ่อมในช่วงนี้</p>
              <p className="text-xs text-gray-400">กด “เพิ่มแผน” เพื่อวางแผนรถเข้าอู่ล่วงหน้า — คันเดียววางได้หลายแผน{offWindow > 0 ? ` · มีอีก ${offWindow} แผนนอกช่วงที่แสดง` : ""}</p>
            </div>
          ) : (
            <>
              {plateRows.map((row) => {
                const rowH = row.bars.length * 30 + 8
                return (
                  <div key={row.plate} className="flex border-b border-[#F1F5F2] dark:border-white/5 last:border-b-0">
                    <div className="sticky left-0 z-10 flex w-[150px] shrink-0 flex-col justify-center bg-white dark:bg-[#151a10] px-3 py-1.5">
                      <span className="truncate text-[13px] font-semibold text-[#14271C] dark:text-white">{row.plate}</span>
                      <span className="text-[10px] text-[#9AA8A0]">{row.fleetNo ? `เบอร์ ${row.fleetNo} · ` : ""}{row.bars.filter((b) => b.plan).length} แผน</span>
                    </div>
                    <div className="relative flex-1" style={{ height: rowH }}>
                      {/* เส้นตาราง + แรเงาเสาร์อาทิตย์/วันนี้ */}
                      <div className="absolute inset-0 flex">
                        {days.map((d) => {
                          const dt = toDate(d)
                          const isToday = d === today
                          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6
                          return <div key={d} className={`flex-1 border-l border-[#F1F5F2] dark:border-white/5 ${isToday ? "bg-[#F0FDF4] dark:bg-[#1B8C4B]/10" : isWeekend ? "bg-[#FAFAF8] dark:bg-white/[0.03]" : ""}`} />
                        })}
                      </div>
                      {/* แท่งแผน/งานจริง */}
                      {row.bars.map((b, i) => {
                        const sIdx = Math.max(0, dayDiff(start, b.start))
                        const eIdx = Math.min(span - 1, dayDiff(start, b.end))
                        const clipL = b.start < start
                        const clipR = b.end > end
                        return (
                          <div
                            key={b.key}
                            onClick={b.plan ? () => openEdit(b.plan!) : undefined}
                            title={b.title}
                            className={`absolute flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-[10px] font-medium ${b.cls}`}
                            style={{ left: `${(sIdx / span) * 100}%`, width: `${((eIdx - sIdx + 1) / span) * 100}%`, top: 4 + i * 30, height: 26 }}
                          >
                            {clipL && <span className="shrink-0">◀</span>}
                            <span className="truncate">{b.label}</span>
                            {clipR && <span className="ml-auto shrink-0">▶</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {offWindow > 0 && (
                <p className="px-3 py-2 text-center text-[11px] text-gray-400">มีอีก {offWindow} แผนนอกช่วงที่แสดง — เลื่อน ◀ ▶ เพื่อดู</p>
              )}
            </>
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
                {editPlan && form.planStatus !== PLAN_CONVERTED && !editPlan.linkedRepairId && (
                  <button onClick={() => { setOpen(false); onConvert(editPlan) }} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1B8C4B] px-3.5 py-2 text-xs font-semibold text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-[#1B8C4B]/10">
                    🔧 รถเข้าอู่แล้ว → สร้างใบงาน
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
