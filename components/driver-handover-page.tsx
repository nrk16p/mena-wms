"use client"

// ส่งมอบรถ พจส.ใหม่ — จับคู่ "คนพร้อม" กับ "รถพร้อม" รายฟลีท/รายสัปดาห์
// ข้อมูลคน: Google Sheet Onboarding Mixer (เขียนสถานะ/เบอร์รถกลับได้)
// ข้อมูลรถ: fleet/current + repair-board/open-jobs (สถานะซ่อมสด)

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  RefreshCw, Search, Truck, UserRound, X, History, CircleAlert, ArrowRight, Filter,
} from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"
import {
  type HandoverData, type HandoverDriver, type HandoverTruck,
  ACTIVE_STATUSES, EDITABLE_STATUSES, driverStatusMeta, truckStepMeta, stepMetaFromLabel, bucketLabel,
} from "@/lib/driver-handover-meta"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }

const todayIso = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

function mondayIso(iso: string): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const isActive = (st: string) => (ACTIVE_STATUSES as readonly string[]).includes(st)

/* ---------- ช่วงเวลาแบบ BA: 4 ช่วงคงที่ + ติดปัญหา ---------- */
const PERIODS = ["now", "w0", "w1", "later"] as const
type PeriodKey = (typeof PERIODS)[number] | "stuck"
const PERIOD_LABELS: Record<string, string> = {
  now: "พร้อมตอนนี้ (รอรับรถ)", w0: "สัปดาห์นี้", w1: "สัปดาห์หน้า", later: "ถัดไป/ไม่ระบุ", stuck: "ติดปัญหา/ไม่มี ETA",
}

function bucketPeriod(bucket: string): PeriodKey {
  if (bucket === "พร้อมแล้ว") return "now"
  if (bucket === "เกินกำหนด" || bucket === "ไม่มี ETA") return "stuck"
  const w0 = mondayIso(todayIso())
  if (bucket === w0) return "w0"
  const n = new Date(w0); n.setUTCDate(n.getUTCDate() + 7)
  if (bucket === n.toISOString().slice(0, 10)) return "w1"
  return "later"
}
/** ช่วงเวลาของ "คน" — status ชีตมาก่อน: "พร้อมตอนนี้" = สถานะรอรับรถเท่านั้น
 *  สถานะฝึกที่เลยวันครบแล้ว (สถานะค้าง Q1) → นับสัปดาห์นี้ เพราะพอชีตอัปเดตจะกลายเป็นรอรับรถทันที */
function driverPeriod(d: HandoverDriver): PeriodKey {
  if (d.status === "รอรับรถ") return "now"
  if (!d.readyDate) return "later"
  const t = todayIso()
  if (d.readyDate <= t) return "w0"
  const m = mondayIso(d.readyDate)
  const w0 = mondayIso(t)
  if (m === w0) return "w0"
  const n = new Date(w0); n.setUTCDate(n.getUTCDate() + 7)
  if (m === n.toISOString().slice(0, 10)) return "w1"
  return "later"
}

/** Q1: ครบกำหนดฝึกแล้วแต่สถานะในชีตยังค้างเป็นฝึกงาน/รอฝึกงาน */
const isStale = (d: HandoverDriver) =>
  isActive(d.status) && d.status !== "รอรับรถ" && !!d.readyDate && d.readyDate <= todayIso()

/** ฟลีทที่จับคู่รถได้จริง (SPARE/ลูกค้าว่าง จับคู่ตามฟลีทไม่ได้) */
const matchableFleet = (f: string) => f !== "SPARE" && f !== "❓ไม่ระบุ"

/** เทียบเบอร์รถแบบไม่สนช่องว่าง — ให้ตรงกับ normTruckNum ฝั่ง server */
const normNum = (s: string) => s.toUpperCase().replace(/\s+/g, "")

function bucketOrder(b: string): number {
  if (b === "พร้อมแล้ว") return 0
  if (b === "เกินกำหนด") return 90
  if (b === "ไม่มี ETA") return 91
  return 1 // สัปดาห์ — เรียงด้วย string ISO อยู่แล้ว
}

/* ---------- modal พื้นฐาน ---------- */
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`max-h-[88vh] w-full ${wide ? "max-w-3xl" : "max-w-xl"} overflow-y-auto rounded-[16px] border border-[#EEF2F0] bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#151a10]`}
        style={sansThai}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-[#14271C] dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-[#6B7C72] hover:bg-[#EAF6EE] dark:text-white/60 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const chip = (cls: string) =>
  `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`

/* ช่องตารางแผนรายสัปดาห์: 👤คนในช่วงนั้น แยกตามสถานะรถ ✅เสร็จ 🔧กำลังซ่อม 🚫ไม่มีรถ */
function PlanCell({ people, done, fixing, none }: { people: number; done: number; fixing: number; none: number }) {
  if (people === 0)
    return <span className="text-[12px] text-[#C6CFC9] dark:text-white/20">—</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      <span className="text-[12.5px] font-bold text-[#14271C] dark:text-white">👤{people}</span>
      <span className="text-[#C6CFC9] dark:text-white/20">:</span>
      {done > 0 && (
        <span className="rounded-[7px] bg-emerald-50 px-1.5 py-0.5 text-[11.5px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">✅{done}</span>
      )}
      {fixing > 0 && (
        <span className="rounded-[7px] bg-sky-50 px-1.5 py-0.5 text-[11.5px] font-bold text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">🔧{fixing}</span>
      )}
      {none > 0 && (
        <span className="rounded-[7px] bg-rose-50 px-1.5 py-0.5 text-[11.5px] font-bold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">🚫{none}</span>
      )}
    </span>
  )
}

/* ================================================================== */

export function DriverHandoverPage() {
  const [data, setData] = useState<HandoverData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [statusTab, setStatusTab] = useState<"active" | "รอรับรถ" | "ฝึกงาน" | "รอฝึกงาน" | "รับรถแล้ว">("active")
  const [q, setQ] = useState("")
  const [filterFleet, setFilterFleet] = useState("")
  const [filterBucket, setFilterBucket] = useState("")
  const [noTruckOnly, setNoTruckOnly] = useState(false)
  const [staleOnly, setStaleOnly] = useState(false)       // ⏰ ครบฝึกแล้วสถานะค้าง
  const [blankCustOnly, setBlankCustOnly] = useState(false) // ❓ ไม่ระบุลูกค้า
  const [readyTrucksView, setReadyTrucksView] = useState(false)

  const [pickFor, setPickFor] = useState<HandoverDriver | null>(null) // เปิด modal เลือกรถ
  const [pickAllFleet, setPickAllFleet] = useState(false)
  const [statusFor, setStatusFor] = useState<HandoverDriver | null>(null) // เปิด modal อัปเดตสถานะ
  const [timelineFor, setTimelineFor] = useState<{ plate: string; label: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/driver-handover")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) { setData(d); setLoadError("") }
        else setLoadError(d?.error ?? "โหลดข้อมูลไม่สำเร็จ")
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const drivers = data?.drivers ?? []
  const trucks = data?.trucks ?? []

  /* ---------- แผนรายสัปดาห์: คนในช่วงนั้นแยกตามสถานะรถ ✅เสร็จ 🔧ซ่อมอยู่ 🚫ไม่มีรถ ---------- */
  const weeklyPlan = useMemo(() => {
    const truckDone = (d: HandoverDriver) =>
      !!d.truckStatus && (d.truckStatus.step === "รถซ่อมเสร็จสิ้น" || d.truckStatus.step === "ไม่มีงานซ่อมเปิด" || /พร้อมใช้/.test(d.truckStatus.step))
    const breakdown = (list: HandoverDriver[]) => ({
      people: list.length,
      done: list.filter((d) => d.truckNum && truckDone(d)).length,
      fixing: list.filter((d) => d.truckNum && !truckDone(d)).length,
      none: list.filter((d) => !d.truckNum).length,
    })
    // รวมแถว SPARE/❓ไม่ระบุ ด้วย เพื่อให้ผลรวมคอลัมน์ "พร้อมตอนนี้" = KPI = แท็บ เสมอ
    const demand = drivers.filter((d) => isActive(d.status))
    const supply = trucks.filter((t) => !t.forSale && !t.reservedBy)
    const fleets = [...new Set([...demand.map((d) => d.fleetKey), ...supply.map((t) => t.fleetKey)])]
      .filter((f) => f.trim())
    const rows = fleets.map((fleet) => {
      const dm = demand.filter((d) => d.fleetKey === fleet)
      const cells = PERIODS.map((p) => ({ p, ...breakdown(dm.filter((d) => driverPeriod(d) === p)) }))
      const stuck = supply.filter((t) => t.fleetKey === fleet && bucketPeriod(t.readyBucket) === "stuck").length
      const freeNow = supply.filter((t) => t.fleetKey === fleet && bucketPeriod(t.readyBucket) === "now").length
      return { fleet, cells, stuck, freeNow, total: breakdown(dm) }
    }).filter((r) => r.total.people > 0 || r.stuck > 0 || r.freeNow > 0)
    rows.sort((a, b) => a.fleet.localeCompare(b.fleet, "th"))
    const sumCells = (i: number) => ({
      people: rows.reduce((s, r) => s + r.cells[i].people, 0),
      done: rows.reduce((s, r) => s + r.cells[i].done, 0),
      fixing: rows.reduce((s, r) => s + r.cells[i].fixing, 0),
      none: rows.reduce((s, r) => s + r.cells[i].none, 0),
    })
    return {
      rows,
      totCells: PERIODS.map((_, i) => sumCells(i)),
      total: {
        people: rows.reduce((s, r) => s + r.total.people, 0),
        done: rows.reduce((s, r) => s + r.total.done, 0),
        fixing: rows.reduce((s, r) => s + r.total.fixing, 0),
        none: rows.reduce((s, r) => s + r.total.none, 0),
      },
      totalStuck: rows.reduce((s, r) => s + r.stuck, 0),
      totalFreeNow: rows.reduce((s, r) => s + r.freeNow, 0),
    }
  }, [drivers, trucks])

  /* ---------- KPI สรุปบนสุด: นับตามสถานะชีตล้วน → เท่ากับแท็บ "รอรับรถ" เสมอ ---------- */
  const kpi = useMemo(() => {
    const demandNow = drivers.filter((d) => d.status === "รอรับรถ")
    const noTruckPeople = demandNow.filter((d) => !d.truckNum)
    const freeTrucks = trucks.filter((t) => !t.forSale && !t.reservedBy && bucketPeriod(t.readyBucket) === "now")
    // ขาดรถ = จับคู่ตามฟลีทแล้ว คนที่ยังเหลือไม่มีรถ (เฉพาะฟลีทที่จับคู่ได้จริง)
    const fleets = [...new Set(noTruckPeople.map((d) => d.fleetKey))].filter(matchableFleet)
    const shortByFleet = fleets
      .map((f) => ({ fleet: f, short: Math.max(0, noTruckPeople.filter((d) => d.fleetKey === f).length - freeTrucks.filter((t) => t.fleetKey === f).length) }))
      .filter((x) => x.short > 0)
      .sort((a, b) => b.short - a.short)
    return {
      waiting: demandNow.length,
      matched: demandNow.length - noTruckPeople.length,
      noTruck: noTruckPeople.length,
      freeNow: freeTrucks.length,
      shortage: shortByFleet.reduce((s, x) => s + x.short, 0),
      shortText: shortByFleet.slice(0, 3).map((x) => `${x.fleet} ขาด ${x.short}`).join(" · "),
    }
  }, [drivers, trucks])

  /* ---------- รายชื่อคนหลังกรอง ---------- */
  // ใช้ตัวกรองชุดเดียวกับ chip นับจำนวน เพื่อให้เลข chip = แถวที่เห็นเสมอ
  const applyFilters = useCallback((list: HandoverDriver[], opts?: { skipNoTruck?: boolean }) => {
    if (statusTab === "active") list = list.filter((d) => isActive(d.status))
    else if (statusTab === "ฝึกงาน") list = list.filter((d) => d.status.startsWith("ฝึกงาน"))
    else list = list.filter((d) => d.status === statusTab)
    if (filterFleet) list = list.filter((d) => d.fleetKey === filterFleet)
    if (filterBucket) list = list.filter((d) => driverPeriod(d) === filterBucket)
    if (!opts?.skipNoTruck && noTruckOnly) list = list.filter((d) => !d.truckNum)
    if (staleOnly) list = list.filter(isStale)
    if (blankCustOnly) list = list.filter((d) => !d.customer.trim())
    const term = q.trim().toLowerCase()
    if (term)
      list = list.filter((d) =>
        [d.name, d.code, d.site, d.customer, d.truckNum, d.plate].some((v) => v.toLowerCase().includes(term)))
    return list
  }, [statusTab, filterFleet, filterBucket, noTruckOnly, staleOnly, blankCustOnly, q])

  const shownDrivers = useMemo(() => {
    const order: Record<string, number> = { "รอรับรถ": 0, "ฝึกงาน": 1, "ฝึกงาน 1-2 วัน": 2, "รอฝึกงาน": 3, "รับรถแล้ว": 4 }
    return [...applyFilters(drivers)].sort((a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.waitDays - a.waitDays || (a.readyDate ?? "9") .localeCompare(b.readyDate ?? "9"))
  }, [drivers, applyFilters])

  // จำนวนของ chip ต่าง ๆ ภายใต้ filter ปัจจุบัน (ไม่นับ filter ของ chip ตัวเอง)
  const noTruckCount = useMemo(
    () => applyFilters(drivers, { skipNoTruck: true }).filter((d) => !d.truckNum).length,
    [drivers, applyFilters])
  const staleCount = useMemo(() => drivers.filter(isStale).length, [drivers])
  // เบอร์รถที่ถูกจองซ้ำ (คน active มากกว่า 1 คนจองเบอร์เดียวกัน) → เบอร์รถ -> รายชื่อ
  const dupTruckHolders = useMemo(() => {
    const by = new Map<string, string[]>()
    for (const d of drivers)
      if (d.truckNum && isActive(d.status)) {
        const k = normNum(d.truckNum)
        by.set(k, [...(by.get(k) ?? []), d.name])
      }
    return new Map([...by].filter(([, v]) => v.length > 1).map(([k, v]) => [k, v.join(", ")]))
  }, [drivers])
  const blankCustCount = useMemo(
    () => drivers.filter((d) => isActive(d.status) && !d.customer.trim()).length,
    [drivers])
  const tabCounts = useMemo(() => ({
    active: drivers.filter((d) => isActive(d.status)).length,
    "รอรับรถ": drivers.filter((d) => d.status === "รอรับรถ").length,
    "ฝึกงาน": drivers.filter((d) => d.status.startsWith("ฝึกงาน")).length,
    "รอฝึกงาน": drivers.filter((d) => d.status === "รอฝึกงาน").length,
    "รับรถแล้ว": drivers.filter((d) => d.status === "รับรถแล้ว").length,
  }), [drivers])

  /* ---------- รายชื่อฟลีทสำหรับ dropdown กรอง ---------- */
  const fleetOptions = useMemo(() => {
    const count = new Map<string, number>()
    for (const d of drivers) if (isActive(d.status)) count.set(d.fleetKey, (count.get(d.fleetKey) ?? 0) + 1)
    for (const t of trucks) if (!t.forSale && !count.has(t.fleetKey)) count.set(t.fleetKey, 0)
    return [...count.entries()]
      .filter(([f]) => f.trim() && f !== "SPARE" && f !== "❓ไม่ระบุ")
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [drivers, trucks])

  /* ---------- รถเสร็จที่ยังไม่มีคน ---------- */
  const readyFreeTrucks = useMemo(() => {
    let list = trucks.filter((t) => !t.forSale && !t.reservedBy && bucketPeriod(t.readyBucket) === "now")
    if (filterFleet) list = list.filter((t) => t.fleetKey === filterFleet)
    const term = q.trim().toLowerCase()
    if (term) list = list.filter((t) => [t.trucknum, t.plate, t.plant, t.fleetKey].some((v) => v.toLowerCase().includes(term)))
    return [...list].sort((a, b) => b.parkedDays - a.parkedDays)
  }, [trucks, filterFleet, q])

  // จำนวนคนสถานะรอรับรถที่ยังไม่มีรถ ต่อฟลีท — จับคู่ได้ทันทีจริง ๆ
  const waitingNoTruckByFleet = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of drivers)
      if (d.status === "รอรับรถ" && !d.truckNum) m.set(d.fleetKey, (m.get(d.fleetKey) ?? 0) + 1)
    return m
  }, [drivers])

  /* ---------- รถใน modal เลือกรถ ---------- */
  const pickerTrucks = useMemo(() => {
    if (!pickFor) return []
    let list = trucks.filter((t) => !t.forSale)
    if (!pickAllFleet) list = list.filter((t) => t.fleetKey === pickFor.fleetKey)
    return [...list].sort((a, b) => {
      const free = Number(!!a.reservedBy) - Number(!!b.reservedBy)
      if (free !== 0) return free
      const ord = bucketOrder(a.readyBucket) - bucketOrder(b.readyBucket)
      if (ord !== 0) return ord
      if (a.readyBucket !== b.readyBucket) return a.readyBucket.localeCompare(b.readyBucket)
      return b.parkedDays - a.parkedDays
    })
  }, [pickFor, pickAllFleet, trucks])

  /* ---------- actions ---------- */
  const doAssign = async (t: HandoverTruck) => {
    if (!pickFor || saving) return
    if (t.reservedBy) { swalError(`รถ ${t.trucknum} ถูกจองให้ ${t.reservedBy} แล้ว`); return }
    setSaving(true)
    try {
      const res = await fetch("/api/driver-handover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row: pickFor.row, code: pickFor.code, name: pickFor.name,
          trucknum: t.trucknum, plate: t.plate,
        }),
      })
      const d = await res.json()
      if (!res.ok) { swalError(d?.error ?? "บันทึกไม่สำเร็จ"); return }
      swalToast("success", `ยืนยันรถ ${t.trucknum} ให้ ${pickFor.name} แล้ว — บันทึกลงชีตเรียบร้อย`)
      setPickFor(null)
      load()
    } finally { setSaving(false) }
  }

  const doUpdateStatus = async (toStatus: string, note: string) => {
    if (!statusFor || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/driver-handover", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row: statusFor.row, code: statusFor.code, name: statusFor.name,
          fromStatus: statusFor.status, toStatus, note,
        }),
      })
      const d = await res.json()
      if (!res.ok) { swalError(d?.error ?? "บันทึกไม่สำเร็จ"); return }
      swalToast("success", `อัปเดต ${statusFor.name} → ${toStatus} แล้ว`)
      setStatusFor(null)
      load()
    } finally { setSaving(false) }
  }

  /* ================================================================ */
  return (
    <div className="min-h-screen bg-[#F6FAF7] px-4 py-6 dark:bg-[#0a0a10] sm:px-6" style={sansThai}>
      <div className="mx-auto max-w-[1400px]">

        {/* header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-[#14271C] dark:text-white">ส่งมอบรถ พจส.ใหม่ 🚛</h1>
            <p className="text-[12.5px] text-[#6B7C72] dark:text-white/50">
              จับคู่คนขับใหม่กับรถให้พร้อมตรงกัน · คนจากชีต Onboarding · สถานะรถสดจาก Mena-Next
              {data && <> · อัปเดต {new Date(data.fetchedAt).toLocaleTimeString("th-TH")}</>}
            </p>
          </div>
          <button
            onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-[#1B8C4B] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> รีเฟรช
          </button>
        </div>

        {loadError && (
          <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <CircleAlert className="h-4 w-4 shrink-0" /> {loadError}
          </div>
        )}

        {/* ---------- KPI สรุป: อ่านซ้ายไปขวาจบในบรรทัดเดียว ---------- */}
        <div className="mb-4 rounded-[16px] border border-[#EEF2F0] bg-white px-4 py-3.5 dark:border-white/[0.07] dark:bg-[#151a10]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-[#14271C] dark:text-white">👤 {kpi.waiting}</span>
              <span className="text-[12.5px] font-semibold text-[#6B7C72] dark:text-white/50">คนรอรับรถ</span>
            </div>
            <div className="text-[#C6CFC9] dark:text-white/20">=</div>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-emerald-600 dark:text-emerald-300">{kpi.matched}</span>
              <span className="text-[12.5px] font-semibold text-[#6B7C72] dark:text-white/50">จับคู่รถแล้ว</span>
            </div>
            <div className="text-[#C6CFC9] dark:text-white/20">+</div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[28px] font-bold ${kpi.noTruck > 0 ? "text-rose-600 dark:text-rose-300" : "text-[#14271C] dark:text-white"}`}>{kpi.noTruck}</span>
              <span className="text-[12.5px] font-semibold text-[#6B7C72] dark:text-white/50">ยังไม่มีรถ</span>
            </div>
            <div className="mx-1 hidden h-8 w-px bg-[#EEF2F0] dark:bg-white/10 sm:block" />
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-[#1B8C4B] dark:text-emerald-300">🚛 {kpi.freeNow}</span>
              <span className="text-[12.5px] font-semibold text-[#6B7C72] dark:text-white/50">รถว่างพร้อมจับคู่</span>
            </div>
            <div className="text-[#C6CFC9] dark:text-white/20">→</div>
            {kpi.shortage > 0 ? (
              <div className="flex items-baseline gap-2 rounded-[12px] bg-rose-50 px-3 py-1 dark:bg-rose-500/10">
                <span className="text-[28px] font-bold text-rose-600 dark:text-rose-300">ขาด {kpi.shortage}</span>
                <span className="text-[12.5px] font-semibold text-rose-500 dark:text-rose-300/80">{kpi.shortText}</span>
              </div>
            ) : (
              <div className="flex items-baseline gap-2 rounded-[12px] bg-emerald-50 px-3 py-1 dark:bg-emerald-500/10">
                <span className="text-[28px] font-bold text-emerald-600 dark:text-emerald-300">🟢 รถพอ</span>
              </div>
            )}
          </div>
        </div>

        {/* ---------- ตารางรายสัปดาห์: คนต่อช่วงเวลา แยกตามสถานะรถ (per-period) ---------- */}
        <div className="mb-6 overflow-x-auto rounded-[16px] border border-[#EEF2F0] bg-white dark:border-white/[0.07] dark:bg-[#151a10]">
          <div className="border-b border-[#F1F5F2] px-4 py-3 dark:border-white/5">
            <div className="text-[13px] font-bold text-[#14271C] dark:text-white">แผนรายสัปดาห์ — คนพร้อมช่วงไหน รถอยู่สถานะอะไร</div>
            <div className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">
              👤 คนที่พร้อมช่วงนั้น แยกเป็น <span className="font-semibold text-emerald-600 dark:text-emerald-300">✅ รถเสร็จแล้ว</span> · <span className="font-semibold text-sky-600 dark:text-sky-300">🔧 รถกำลังซ่อม (ยานยนต์ต้องเร่งให้ทัน)</span> · <span className="font-semibold text-rose-600 dark:text-rose-300">🚫 ยังไม่มีรถ (จัดส่งต้องหา)</span> · คลิกช่องเพื่อกรองรายชื่อ
            </div>
          </div>
          <table className="w-full min-w-[960px] text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase text-[#9AA8A0] dark:text-white/40">
                <th className="px-4 py-2.5 text-left">ฟลีท</th>
                <th className="px-2 py-2.5 text-center">รวมทั้งหมด</th>
                {PERIODS.map((p) => (
                  <th key={p} className="px-2 py-2.5 text-center">{PERIOD_LABELS[p]}</th>
                ))}
                <th className="px-2 py-2.5 text-center">🚛 รถว่าง<div className="text-[9px] font-medium normal-case text-[#C6CFC9] dark:text-white/25">เสร็จแล้ว ยังไม่จอง</div></th>
                <th className="px-3 py-2.5 text-center">⚠️ รถค้างซ่อม<div className="text-[9px] font-medium normal-case text-[#C6CFC9] dark:text-white/25">เกินกำหนด/ไม่มีวันเสร็จ</div></th>
              </tr>
            </thead>
            <tbody>
              {weeklyPlan.rows.map((r) => (
                <tr key={r.fleet} className="border-t border-[#F1F5F2] dark:border-white/5">
                  <td className="px-4 py-2.5 font-bold text-[13px] text-[#14271C] dark:text-white">
                    <button
                      className={`hover:underline ${filterFleet === r.fleet ? "text-[#1B8C4B] dark:text-emerald-300" : ""}`}
                      onClick={() => { setFilterFleet(filterFleet === r.fleet ? "" : r.fleet); setFilterBucket("") }}
                    >{r.fleet}</button>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <PlanCell people={r.total.people} done={r.total.done} fixing={r.total.fixing} none={r.total.none} />
                  </td>
                  {r.cells.map((c) => {
                    const selected = filterFleet === r.fleet && filterBucket === c.p
                    return (
                      <td key={c.p} className="px-1.5 py-1.5 text-center">
                        <button
                          onClick={() => {
                            if (selected) { setFilterFleet(""); setFilterBucket("") }
                            else { setFilterFleet(r.fleet); setFilterBucket(c.p) }
                          }}
                          className={`w-full rounded-[8px] px-1 py-1 transition hover:bg-[#F6FAF7] dark:hover:bg-white/5 ${selected ? "ring-2 ring-[#1B8C4B] bg-[#EAF6EE] dark:bg-emerald-500/10" : ""}`}
                        >
                          <PlanCell people={c.people} done={c.done} fixing={c.fixing} none={c.none} />
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-center">
                    {r.freeNow > 0
                      ? <span className="rounded-[7px] bg-emerald-50 px-1.5 py-0.5 text-[12px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">{r.freeNow} คัน</span>
                      : <span className="text-[#C6CFC9] dark:text-white/20">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.stuck > 0
                      ? <span className="text-[12px] font-bold text-amber-600 dark:text-amber-300">{r.stuck} คัน</span>
                      : <span className="text-[#C6CFC9] dark:text-white/20">—</span>}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#EEF2F0] bg-[#FAFCFA] dark:border-white/10 dark:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-bold text-[13px] text-[#14271C] dark:text-white">รวมทั้งหมด</td>
                <td className="px-2 py-2 text-center">
                  <PlanCell people={weeklyPlan.total.people} done={weeklyPlan.total.done} fixing={weeklyPlan.total.fixing} none={weeklyPlan.total.none} />
                </td>
                {weeklyPlan.totCells.map((c, i) => (
                  <td key={i} className="px-1.5 py-2 text-center">
                    <PlanCell people={c.people} done={c.done} fixing={c.fixing} none={c.none} />
                  </td>
                ))}
                <td className="px-2 py-2 text-center text-[12px] font-bold text-emerald-600 dark:text-emerald-300">{weeklyPlan.totalFreeNow} คัน</td>
                <td className="px-3 py-2 text-center text-[12px] font-bold text-amber-600 dark:text-amber-300">{weeklyPlan.totalStuck} คัน</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ---------- filter bar ---------- */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([
            ["active", "กำลังดำเนินการ"], ["รอรับรถ", "รอรับรถ"], ["ฝึกงาน", "ฝึกงาน"],
            ["รอฝึกงาน", "รอฝึกงาน"], ["รับรถแล้ว", "รับรถแล้ว"],
          ] as const).map(([key, label]) => (
            <button
              key={key} onClick={() => setStatusTab(key)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${statusTab === key
                ? "bg-[#1B8C4B] text-white"
                : "bg-white text-[#6B7C72] ring-1 ring-[#EEF2F0] hover:bg-[#EAF6EE] dark:bg-white/5 dark:text-white/60 dark:ring-white/10"}`}
            >{label} ({tabCounts[key]})</button>
          ))}
          <button
            onClick={() => setNoTruckOnly(!noTruckOnly)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${noTruckOnly
              ? "bg-amber-500 text-white"
              : "bg-white text-amber-600 ring-1 ring-amber-200 hover:bg-amber-50 dark:bg-white/5 dark:text-amber-300 dark:ring-amber-500/30"}`}
          >🚨 ยังไม่มีรถ ({noTruckCount})</button>
          {staleCount > 0 && (
            <button
              onClick={() => setStaleOnly(!staleOnly)}
              title="ครบกำหนดฝึกงานแล้ว แต่สถานะในชีตยังไม่ถูกอัปเดต — กดดูรายชื่อแล้วอัปเดตสถานะได้เลย"
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${staleOnly
                ? "bg-orange-500 text-white"
                : "bg-white text-orange-600 ring-1 ring-orange-200 hover:bg-orange-50 dark:bg-white/5 dark:text-orange-300 dark:ring-orange-500/30"}`}
            >⏰ ครบฝึกแต่สถานะค้าง ({staleCount})</button>
          )}
          {blankCustCount > 0 && (
            <button
              onClick={() => setBlankCustOnly(!blankCustOnly)}
              title="ช่องลูกค้าในชีตว่าง — จับคู่รถไม่ได้จนกว่าจะเติมข้อมูล"
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${blankCustOnly
                ? "bg-slate-500 text-white"
                : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-white/5 dark:text-white/50 dark:ring-white/15"}`}
            >❓ ไม่ระบุลูกค้า ({blankCustCount})</button>
          )}
          <button
            onClick={() => setReadyTrucksView(!readyTrucksView)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${readyTrucksView
              ? "bg-emerald-600 text-white"
              : "bg-white text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 dark:bg-white/5 dark:text-emerald-300 dark:ring-emerald-500/30"}`}
          >🟢 รถเสร็จไม่มีคน ({readyFreeTrucks.length})</button>
          {filterBucket && (
            <button
              onClick={() => setFilterBucket("")}
              className="inline-flex items-center gap-1 rounded-full bg-[#EAF6EE] px-3 py-1.5 text-[12px] font-semibold text-[#1B8C4B] dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Filter className="h-3 w-3" />
              {PERIOD_LABELS[filterBucket] ?? bucketLabel(filterBucket)}
              <X className="h-3 w-3" />
            </button>
          )}
          <select
            value={filterFleet}
            onChange={(e) => setFilterFleet(e.target.value)}
            className={`ml-auto rounded-full border py-1.5 pl-3 pr-8 text-[12.5px] font-semibold outline-none focus:border-[#1B8C4B] ${filterFleet
              ? "border-[#1B8C4B] bg-[#EAF6EE] text-[#1B8C4B] dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-[#EEF2F0] bg-white text-[#6B7C72] dark:border-white/10 dark:bg-white/5 dark:text-white/60"}`}
          >
            <option value="">ทุกฟลีท</option>
            {fleetOptions.map(([f, n]) => (
              <option key={f} value={f}>{f}{n > 0 ? ` (${n} คน)` : ""}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9AA8A0]" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / แพล้นท์ / เบอร์รถ"
              className="w-64 rounded-full border border-[#EEF2F0] bg-white py-1.5 pl-9 pr-3 text-[12.5px] text-[#14271C] outline-none focus:border-[#1B8C4B] dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        {/* ---------- ตารางรถเสร็จที่ยังไม่มีคน ---------- */}
        {readyTrucksView && (
          <div className="mb-4 overflow-x-auto rounded-[16px] border border-emerald-200 bg-white dark:border-emerald-500/25 dark:bg-[#151a10]">
            <div className="border-b border-[#F1F5F2] px-4 py-2.5 text-[12.5px] font-bold text-emerald-700 dark:border-white/5 dark:text-emerald-300">
              🟢 รถซ่อมเสร็จ/พร้อมใช้ ที่ยังไม่มีคนจอง — {readyFreeTrucks.length} คัน
            </div>
            <div className="grid min-w-[860px] gap-3 border-b border-[#EEF2F0] px-4 py-2.5 text-[10.5px] font-bold uppercase text-[#9AA8A0] dark:border-white/5 dark:text-white/40"
              style={{ gridTemplateColumns: "90px 120px 0.8fr 1fr 1.1fr 0.8fr 1fr 110px" }}>
              <div>เบอร์รถ</div><div>ทะเบียน</div><div>ฟลีท</div><div>จุดจอด</div>
              <div>สถานะ</div><div>จอดมาแล้ว</div><div>คนรอในฟลีทนี้</div><div className="text-right">ประวัติ</div>
            </div>
            {readyFreeTrucks.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-[#9AA8A0]">ไม่มีรถเสร็จที่ว่างตามเงื่อนไข</div>
            )}
            {readyFreeTrucks.map((t) => {
              const m = truckStepMeta(t)
              const waitingHere = waitingNoTruckByFleet.get(t.fleetKey) ?? 0
              return (
                <div key={t.plate}
                  className="grid min-w-[860px] items-center gap-3 border-b border-[#F1F5F2] px-4 py-3 text-[12.5px] last:border-0 dark:border-white/5"
                  style={{ gridTemplateColumns: "90px 120px 0.8fr 1fr 1.1fr 0.8fr 1fr 110px" }}>
                  <div className="font-mono text-[13px] font-bold text-[#14271C] dark:text-white">{t.trucknum}</div>
                  <div className="font-mono text-[11.5px] text-[#6B7C72] dark:text-white/50">{t.plate}</div>
                  <div className="font-semibold text-[#14271C] dark:text-white">{t.fleetKey}</div>
                  <div className="text-[#6B7C72] dark:text-white/60">{t.plant || "—"}</div>
                  <div><span className={chip(m.cls)}>{m.emoji} {m.label}</span></div>
                  <div className={`font-bold ${t.parkedDays >= 30 ? "text-rose-600 dark:text-rose-300" : "text-[#6B7C72] dark:text-white/60"}`}>{t.parkedDays} วัน</div>
                  <div>
                    {waitingHere > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">👤 รอรับรถ {waitingHere} คน — จับคู่ได้เลย</span>
                    ) : (
                      <span className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">ไม่มีคนรอ</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setTimelineFor({ plate: t.plate, label: `${t.trucknum} · ${t.plate}` })}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#6B7C72] ring-1 ring-[#EEF2F0] hover:bg-[#EAF6EE] dark:bg-white/5 dark:text-white/60 dark:ring-white/10"
                    ><History className="h-3 w-3" /> ดูประวัติ</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ---------- driver table ---------- */}
        <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] bg-white dark:border-white/[0.07] dark:bg-[#151a10]">
          <div className="grid min-w-[1160px] gap-3 border-b border-[#EEF2F0] px-4 py-2.5 text-[10.5px] font-bold uppercase text-[#9AA8A0] dark:border-white/5 dark:text-white/40"
            style={{ gridTemplateColumns: "70px 1.5fr 0.85fr 1fr 0.9fr 0.95fr 0.8fr 1.1fr 190px" }}>
            <div>รหัส</div><div>ชื่อ พจส.ใหม่</div><div>ฟลีท</div><div>แพล้นท์/สถานที่</div>
            <div>สถานะ</div><div>ฝึกงาน เริ่ม→ครบ</div><div>พร้อมรับรถ</div><div>รถที่จอง</div><div className="text-right">จัดการ</div>
          </div>

          {loading && !data && (
            <div className="px-4 py-10 text-center text-[13px] text-[#9AA8A0]">กำลังโหลดข้อมูลจากชีต + Mena-Next…</div>
          )}
          {!loading && shownDrivers.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-[#9AA8A0]">ไม่พบรายการตามเงื่อนไข</div>
          )}

          {shownDrivers.map((d) => {
            const meta = driverStatusMeta(d.status)
            const truckMeta = d.truckStatus ? stepMetaFromLabel(d.truckStatus.step) : null
            const dupBooking = d.truckNum ? dupTruckHolders.get(normNum(d.truckNum)) ?? "" : ""
            return (
              <div key={`${d.row}-${d.code}`}
                className="grid min-w-[1160px] items-center gap-3 border-b border-[#F1F5F2] px-4 py-3 text-[12.5px] last:border-0 dark:border-white/5"
                style={{ gridTemplateColumns: "70px 1.5fr 0.85fr 1fr 0.9fr 0.95fr 0.8fr 1.1fr 190px" }}>
                <div className="font-mono text-[11.5px] text-[#6B7C72] dark:text-white/50">{d.code || "—"}</div>
                <div>
                  <div className="font-semibold text-[#14271C] dark:text-white">{d.name}</div>
                  <div className="text-[11px] text-[#9AA8A0] dark:text-white/40">{d.position}{d.phone && ` · ${d.phone}`}</div>
                </div>
                <div className="font-semibold text-[#14271C] dark:text-white">{d.fleetKey}</div>
                <div className="text-[#6B7C72] dark:text-white/60">{d.site || "—"}</div>
                <div><span className={chip(meta.cls)}>{meta.emoji} {d.status}</span></div>
                <div className="text-[11.5px]">
                  <div className="text-[#9AA8A0] dark:text-white/40">เริ่ม {d.trainStart || "—"}</div>
                  <div className="font-semibold text-[#14271C] dark:text-white">
                    ครบ {d.trainDue || (d.readyDate && d.readyEstimated ? `~${d.readyDate.slice(5).split("-").reverse().join("/")}` : "—")}
                    {d.readyEstimated && !d.trainDue && (
                      <span className="ml-1 text-[10px] font-normal text-[#9AA8A0] dark:text-white/35" title="ชีตไม่ได้กรอกวันครบกำหนดฝึก — ประมาณจากวันเริ่มฝึก + 10 วัน">ประมาณ</span>
                    )}
                  </div>
                  {isStale(d) && (
                    <div className="text-[10px] font-bold text-orange-600 dark:text-orange-300" title="ครบกำหนดฝึกแล้ว แต่สถานะยังไม่ถูกอัปเดตในชีต">⏰ สถานะค้าง</div>
                  )}
                </div>
                <div>
                  {d.status === "รอรับรถ" ? (
                    <span className={`text-[12px] font-bold ${d.waitDays >= 5 ? "text-rose-600 dark:text-rose-300" : "text-amber-600 dark:text-amber-300"}`}>
                      รอมา {d.waitDays} วัน
                    </span>
                  ) : d.status === "รับรถแล้ว" ? (
                    <span className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">{d.receivedDate || "—"}</span>
                  ) : d.readyDate ? (
                    (() => {
                      const days = Math.ceil((new Date(d.readyDate).getTime() - new Date(todayIso()).getTime()) / 86400000)
                      return <span className={`text-[11.5px] font-semibold ${days <= 2 ? "text-amber-600 dark:text-amber-300" : "text-[#6B7C72] dark:text-white/60"}`}>{days <= 0 ? "พร้อมแล้ว" : `อีก ${days} วัน`}</span>
                    })()
                  ) : (
                    <span className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">—</span>
                  )}
                </div>
                <div>
                  {d.truckNum ? (
                    <button
                      onClick={() => d.plate && setTimelineFor({ plate: d.plate, label: `${d.truckNum} · ${d.plate}` })}
                      className="text-left" disabled={!d.plate} title={d.plate ? "ดูประวัติซ่อม" : undefined}
                    >
                      <div className="font-mono text-[12px] font-bold text-[#14271C] dark:text-white">
                        {d.truckNum} <span className="font-normal text-[#9AA8A0]">{d.plate}</span>
                        {dupBooking && (
                          <span className="ml-1 rounded bg-rose-100 px-1 py-0.5 font-sans text-[9.5px] font-bold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" title={`เบอร์รถนี้ถูกจองซ้ำ: ${dupBooking}`}>🔁 จองซ้ำ</span>
                        )}
                      </div>
                      {truckMeta && (
                        <span className={chip(truckMeta.cls)}>
                          {truckMeta.emoji} {truckMeta.label}
                          {d.truckStatus?.expectedDone && ` · ${d.truckStatus.expectedDone.slice(5).split("-").reverse().join("/")}`}
                          {d.truckStatus?.parked && d.truckStatus.parkedDays > 0 && ` · จอด ${d.truckStatus.parkedDays}วัน`}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">ยังไม่ระบุรถ</span>
                  )}
                </div>
                <div className="flex justify-end gap-1.5">
                  {isActive(d.status) && (
                    <button
                      onClick={() => { setPickFor(d); setPickAllFleet(false) }}
                      className="inline-flex items-center gap-1 rounded-full bg-[#1B8C4B] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:opacity-90"
                    ><Truck className="h-3 w-3" /> {d.truckNum ? "เปลี่ยนรถ" : "เลือกรถ"}</button>
                  )}
                  <button
                    onClick={() => setStatusFor(d)}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#6B7C72] ring-1 ring-[#EEF2F0] hover:bg-[#EAF6EE] dark:bg-white/5 dark:text-white/60 dark:ring-white/10"
                  ><UserRound className="h-3 w-3" /> สถานะ</button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 text-[11.5px] text-[#9AA8A0] dark:text-white/40">
          แสดง {shownDrivers.length} รายการ · การยืนยันรถ/สถานะจะบันทึกกลับชีต Onboarding ทันที
        </div>
      </div>

      {/* ---------- modal เลือกรถ ---------- */}
      {pickFor && (
        <Modal wide title={`เลือกรถให้ ${pickFor.name} · ${pickFor.fleetKey} · ${pickFor.site}`} onClose={() => setPickFor(null)}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[12px] text-[#6B7C72] dark:text-white/50">
              {pickFor.status === "รอรับรถ" ? `รอมาแล้ว ${pickFor.waitDays} วัน` : pickFor.trainDue ? `ครบฝึก ${pickFor.trainDue}` : ""}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-[#6B7C72] dark:text-white/60">
              <input type="checkbox" checked={pickAllFleet} onChange={(e) => setPickAllFleet(e.target.checked)} />
              แสดงทุกฟลีท (ข้ามฟลีทต้องยืนยันเอง)
            </label>
          </div>
          {pickerTrucks.length === 0 && (
            <div className="py-8 text-center text-[13px] text-[#9AA8A0]">ไม่มีรถของฟลีท {pickFor.fleetKey} ในรายการรถจอด — ลองติ๊ก “แสดงทุกฟลีท”</div>
          )}
          <div className="space-y-2">
            {pickerTrucks.map((t) => {
              const m = truckStepMeta(t)
              return (
                <div key={t.plate}
                  className={`rounded-[12px] border px-3.5 py-2.5 ${t.reservedBy
                    ? "border-[#F1F5F2] bg-[#FAFBFA] opacity-60 dark:border-white/5 dark:bg-white/[0.02]"
                    : "border-[#EEF2F0] bg-white hover:border-[#1B8C4B]/40 dark:border-white/10 dark:bg-white/[0.04]"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-mono text-[13.5px] font-bold text-[#14271C] dark:text-white">
                          {t.trucknum} <span className="font-normal text-[#9AA8A0]">{t.plate}</span>
                          {t.fleetKey !== pickFor.fleetKey && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{t.fleetKey}</span>}
                        </div>
                        <div className="text-[11px] text-[#9AA8A0] dark:text-white/40">
                          {t.plant || "—"} · จอดมา {t.parkedDays} วัน{t.job?.repairMode && ` · ${t.job.repairMode}`}{t.job?.vendor && ` · ${t.job.vendor}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className={chip(m.cls)}>{m.emoji} {m.label}</span>
                        <div className="mt-0.5 text-[10.5px] text-[#9AA8A0] dark:text-white/40">
                          {t.readyBucket === "พร้อมแล้ว" ? "พร้อมส่งมอบ"
                            : t.readyBucket === "เกินกำหนด" ? `เกินกำหนด (คาด ${t.job?.expectedDone ?? "?"})`
                            : t.readyBucket === "ไม่มี ETA" ? "ไม่มีวันคาดเสร็จ"
                            : `คาดเสร็จ ${t.job?.expectedDone?.slice(5).split("-").reverse().join("/")}`}
                        </div>
                      </div>
                      {t.reservedBy ? (
                        <span className="text-[11px] font-semibold text-[#9AA8A0]">จองแล้ว: {t.reservedBy}</span>
                      ) : (
                        <button
                          onClick={() => doAssign(t)} disabled={saving}
                          className="inline-flex items-center gap-1 rounded-full bg-[#1B8C4B] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >ยืนยัน <ArrowRight className="h-3 w-3" /></button>
                      )}
                    </div>
                  </div>
                  {(t.job?.stepNote || t.job?.partsInfo) && (
                    <div className="mt-1.5 border-t border-dashed border-[#F1F5F2] pt-1.5 text-[11px] text-[#6B7C72] dark:border-white/5 dark:text-white/50">
                      {t.job?.partsInfo && <span className="mr-2 font-semibold">{t.job.partsInfo}</span>}
                      {t.job?.stepNote}
                    </div>
                  )}
                  <button
                    onClick={() => setTimelineFor({ plate: t.plate, label: `${t.trucknum} · ${t.plate}` })}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B8C4B] hover:underline dark:text-emerald-300"
                  ><History className="h-3 w-3" /> ดูประวัติซ่อมปีนี้</button>
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {/* ---------- modal อัปเดตสถานะ ---------- */}
      {statusFor && (
        <StatusModal driver={statusFor} saving={saving} onClose={() => setStatusFor(null)} onSave={doUpdateStatus} />
      )}

      {/* ---------- modal timeline ---------- */}
      {timelineFor && (
        <TimelineModal plate={timelineFor.plate} label={timelineFor.label} onClose={() => setTimelineFor(null)} />
      )}
    </div>
  )
}

/* ================= modal อัปเดตสถานะคน ================= */
function StatusModal({ driver, saving, onClose, onSave }: {
  driver: HandoverDriver; saving: boolean
  onClose: () => void; onSave: (toStatus: string, note: string) => void
}) {
  const [toStatus, setToStatus] = useState(driver.status === "ฝึกงาน 1-2 วัน" ? "ฝึกงาน" : driver.status)
  const [note, setNote] = useState("")
  const meta = driverStatusMeta(driver.status)
  return (
    <Modal title={`อัปเดตสถานะ — ${driver.name}`} onClose={onClose}>
      <div className="mb-3 text-[12.5px] text-[#6B7C72] dark:text-white/60">
        สถานะปัจจุบัน: <span className={chip(meta.cls)}>{meta.emoji} {driver.status}</span>
        <span className="ml-2 text-[11px] text-[#9AA8A0]">({driver.fleetKey} · {driver.site})</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {EDITABLE_STATUSES.map((st) => {
          const m = driverStatusMeta(st)
          return (
            <button key={st} onClick={() => setToStatus(st)}
              className={`rounded-[10px] px-2 py-2 text-[12px] font-semibold ring-1 transition ${toStatus === st
                ? "bg-[#1B8C4B] text-white ring-[#1B8C4B]"
                : "bg-white text-[#6B7C72] ring-[#EEF2F0] hover:bg-[#EAF6EE] dark:bg-white/5 dark:text-white/60 dark:ring-white/10"}`}
            >{m.emoji} {st}</button>
          )
        })}
      </div>
      <input
        value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ถ้ามี)"
        className="mb-4 w-full rounded-[10px] border border-[#EEF2F0] bg-white px-3 py-2 text-[12.5px] text-[#14271C] outline-none focus:border-[#1B8C4B] dark:border-white/10 dark:bg-white/5 dark:text-white"
      />
      {toStatus === "รับรถแล้ว" && !driver.truckNum && (
        <div className="mb-3 rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          ⚠️ ยังไม่ได้ระบุเบอร์รถ — ควรเลือกรถก่อนบันทึก “รับรถแล้ว”
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-full px-4 py-2 text-[13px] font-semibold text-[#6B7C72] hover:bg-[#EAF6EE] dark:text-white/60 dark:hover:bg-white/10">ยกเลิก</button>
        <button
          onClick={() => onSave(toStatus, note)} disabled={saving || toStatus === driver.status}
          className="rounded-full bg-[#1B8C4B] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >{saving ? "กำลังบันทึก…" : "บันทึกลงชีต"}</button>
      </div>
    </Modal>
  )
}

/* ================= modal timeline ประวัติซ่อม ================= */
/* eslint-disable @typescript-eslint/no-explicit-any */
function TimelineModal({ plate, label, onClose }: { plate: string; label: string; onClose: () => void }) {
  const [tl, setTl] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/driver-handover/timeline?plate=${encodeURIComponent(plate)}`)
      .then((r) => r.json())
      .then((d) => setTl(d?.ok ? d.data : { error: d?.error }))
      .catch((e) => setTl({ error: String(e) }))
      .finally(() => setLoading(false))
  }, [plate])

  const items: any[] = tl?.items ?? []
  return (
    <Modal wide title={`ประวัติซ่อมปีนี้ — ${label}`} onClose={onClose}>
      {loading && <div className="py-8 text-center text-[13px] text-[#9AA8A0]">กำลังโหลด timeline…</div>}
      {!loading && tl?.error && <div className="py-4 text-[13px] text-rose-600">{tl.error}</div>}
      {!loading && !tl?.error && (
        <>
          <div className="mb-3 text-[12.5px] text-[#6B7C72] dark:text-white/60">
            {items.length} งานซ่อมปี {new Date().getFullYear()}
            {tl?.total_repair_amount ? <> · ยอดซ่อมรวม {Number(tl.total_repair_amount).toLocaleString()} บาท</> : null}
          </div>
          <div className="space-y-2">
            {[...items].reverse().map((mr: any) => (
              <div key={mr.code} className="rounded-[12px] border border-[#EEF2F0] px-3.5 py-2.5 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-[12px] font-bold text-[#14271C] dark:text-white">{mr.code}</div>
                  <div className="text-[11px] text-[#9AA8A0]">
                    {(mr.garage_entry_at ?? mr.schedule_at ?? "").slice(0, 10)} → {(mr.garage_finish_at ?? "").slice(0, 10) || "ยังไม่เสร็จ"}
                    {mr.flow && <span className="ml-2 rounded bg-[#EAF6EE] px-1.5 py-0.5 font-semibold text-[#1B8C4B] dark:bg-emerald-500/10 dark:text-emerald-300">{mr.flow}</span>}
                  </div>
                </div>
                {(mr.tasks ?? []).slice(0, 4).map((t: any, i: number) => (
                  <div key={i} className="mt-1 text-[11.5px] text-[#6B7C72] dark:text-white/50">
                    • {(t.problem ?? "").replace(/["\r\n]+/g, " ").slice(0, 120)}
                    {t.maintenance_type && <span className="ml-1 text-[10px] text-[#9AA8A0]">[{t.maintenance_type}]</span>}
                  </div>
                ))}
                {(mr.tasks ?? []).length > 4 && (
                  <div className="mt-0.5 text-[10.5px] text-[#9AA8A0]">…และอีก {(mr.tasks ?? []).length - 4} รายการ</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
