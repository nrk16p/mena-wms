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
  ACTIVE_STATUSES, EDITABLE_STATUSES, driverStatusMeta, truckStepMeta, bucketLabel,
} from "@/lib/driver-handover-meta"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }

const todayIso = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

function mondayIso(iso: string): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** bucket ของ "คน" — พร้อมแล้ว / วันจันทร์ของสัปดาห์ที่จะพร้อม / ไม่ระบุ */
function driverBucket(d: HandoverDriver): string {
  if (!d.readyDate) return "ไม่มี ETA"
  return d.readyDate <= todayIso() ? "พร้อมแล้ว" : mondayIso(d.readyDate)
}

const isActive = (st: string) => (ACTIVE_STATUSES as readonly string[]).includes(st)

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

  /* ---------- Fleet Balance matrix ---------- */
  const matrix = useMemo(() => {
    const demand = drivers.filter((d) => isActive(d.status) && d.fleetKey !== "SPARE")
    const supply = trucks.filter((t) => !t.forSale)
    const buckets = new Set<string>(["พร้อมแล้ว"])
    demand.forEach((d) => buckets.add(driverBucket(d)))
    supply.forEach((t) => buckets.add(t.readyBucket))
    const cols = [...buckets].sort((a, b) => bucketOrder(a) - bucketOrder(b) || a.localeCompare(b))

    const fleets = [...new Set([...demand.map((d) => d.fleetKey), ...supply.map((t) => t.fleetKey)])]
    const rows = fleets.map((fleet) => {
      const cells = cols.map((bucket) => {
        const people = demand.filter((d) => d.fleetKey === fleet && driverBucket(d) === bucket)
        const trucksIn = supply.filter((t) => t.fleetKey === fleet && t.readyBucket === bucket)
        const free = trucksIn.filter((t) => !t.reservedBy)
        return { bucket, people: people.length, trucks: trucksIn.length, free: free.length }
      })
      const totalPeople = cells.reduce((s, c) => s + c.people, 0)
      const totalTrucks = cells.reduce((s, c) => s + c.trucks, 0)
      return { fleet, cells, totalPeople, totalTrucks }
    })
    rows.sort((a, b) => b.totalPeople - a.totalPeople || b.totalTrucks - a.totalTrucks)
    return { cols, rows: rows.filter((r) => r.totalPeople > 0 || r.totalTrucks > 0) }
  }, [drivers, trucks])

  /* ---------- รายชื่อคนหลังกรอง ---------- */
  const shownDrivers = useMemo(() => {
    let list = drivers
    if (statusTab === "active") list = list.filter((d) => isActive(d.status))
    else if (statusTab === "ฝึกงาน") list = list.filter((d) => d.status.startsWith("ฝึกงาน"))
    else list = list.filter((d) => d.status === statusTab)
    if (filterFleet) list = list.filter((d) => d.fleetKey === filterFleet)
    if (filterBucket) list = list.filter((d) => driverBucket(d) === filterBucket)
    if (noTruckOnly) list = list.filter((d) => !d.truckNum)
    const term = q.trim().toLowerCase()
    if (term)
      list = list.filter((d) =>
        [d.name, d.code, d.site, d.customer, d.truckNum, d.plate].some((v) => v.toLowerCase().includes(term)))
    const order: Record<string, number> = { "รอรับรถ": 0, "ฝึกงาน": 1, "ฝึกงาน 1-2 วัน": 2, "รอฝึกงาน": 3, "รับรถแล้ว": 4 }
    return [...list].sort((a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.waitDays - a.waitDays || (a.readyDate ?? "9") .localeCompare(b.readyDate ?? "9"))
  }, [drivers, statusTab, filterFleet, filterBucket, q, noTruckOnly])

  // จำนวนคนที่ยังไม่มีรถ ภายใต้ filter ปัจจุบัน (ไม่นับ filter ยังไม่มีรถเอง)
  const noTruckCount = useMemo(() => {
    let list = drivers
    if (statusTab === "active") list = list.filter((d) => isActive(d.status))
    else if (statusTab === "ฝึกงาน") list = list.filter((d) => d.status.startsWith("ฝึกงาน"))
    else list = list.filter((d) => d.status === statusTab)
    if (filterFleet) list = list.filter((d) => d.fleetKey === filterFleet)
    if (filterBucket) list = list.filter((d) => driverBucket(d) === filterBucket)
    return list.filter((d) => !d.truckNum).length
  }, [drivers, statusTab, filterFleet, filterBucket])

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

        {/* ---------- Fleet Balance matrix ---------- */}
        <div className="mb-6 overflow-x-auto rounded-[16px] border border-[#EEF2F0] bg-white dark:border-white/[0.07] dark:bg-[#151a10]">
          <div className="border-b border-[#F1F5F2] px-4 py-3 dark:border-white/5">
            <div className="text-[13px] font-bold text-[#14271C] dark:text-white">Fleet Balance — คนพร้อม vs รถพร้อม</div>
            <div className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">
              คน = พจส.ใหม่ที่จะพร้อมรับรถช่วงนั้น · รถ = ว่าง/รวม ที่คาดว่าพร้อมช่วงนั้น · คลิกช่องเพื่อกรองรายชื่อด้านล่าง
            </div>
          </div>
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase text-[#9AA8A0] dark:text-white/40">
                <th className="px-4 py-2 text-left">ฟลีท</th>
                {matrix.cols.map((c) => (
                  <th key={c} className="px-2 py-2 text-center">{bucketLabel(c)}</th>
                ))}
                <th className="px-3 py-2 text-center">รวม</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.fleet} className="border-t border-[#F1F5F2] dark:border-white/5">
                  <td className="px-4 py-2 font-bold text-[#14271C] dark:text-white">
                    <button
                      className={`hover:underline ${filterFleet === r.fleet ? "text-[#1B8C4B]" : ""}`}
                      onClick={() => { setFilterFleet(filterFleet === r.fleet ? "" : r.fleet); setFilterBucket("") }}
                    >{r.fleet}</button>
                  </td>
                  {r.cells.map((c) => {
                    const hasAny = c.people > 0 || c.trucks > 0
                    const short = c.people > c.free
                    const selected = filterFleet === r.fleet && filterBucket === c.bucket
                    return (
                      <td key={c.bucket} className="px-1.5 py-1.5 text-center">
                        {hasAny && (
                          <button
                            onClick={() => {
                              if (selected) { setFilterFleet(""); setFilterBucket("") }
                              else { setFilterFleet(r.fleet); setFilterBucket(c.bucket) }
                            }}
                            className={`w-full rounded-[8px] px-1.5 py-1 text-[11.5px] font-semibold ring-1 transition
                              ${selected ? "ring-2 ring-[#1B8C4B]" : "ring-transparent"}
                              ${c.people > 0 && short
                                ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                                : c.people > 0
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                  : "bg-[#F6FAF7] text-[#6B7C72] dark:bg-white/5 dark:text-white/50"}`}
                          >
                            {c.people > 0 && <span>👤{c.people}</span>}
                            {c.people > 0 && c.trucks > 0 && " · "}
                            {c.trucks > 0 && <span>🚛{c.free}/{c.trucks}</span>}
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className={`px-3 py-1.5 text-center text-[11.5px] font-bold ${r.totalPeople > r.totalTrucks ? "text-rose-600 dark:text-rose-300" : "text-[#6B7C72] dark:text-white/50"}`}>
                    {r.totalPeople}/{r.totalTrucks}
                  </td>
                </tr>
              ))}
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
            >{label}</button>
          ))}
          <button
            onClick={() => setNoTruckOnly(!noTruckOnly)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${noTruckOnly
              ? "bg-amber-500 text-white"
              : "bg-white text-amber-600 ring-1 ring-amber-200 hover:bg-amber-50 dark:bg-white/5 dark:text-amber-300 dark:ring-amber-500/30"}`}
          >🚨 ยังไม่มีรถ ({noTruckCount})</button>
          {(filterFleet || filterBucket) && (
            <button
              onClick={() => { setFilterFleet(""); setFilterBucket("") }}
              className="inline-flex items-center gap-1 rounded-full bg-[#EAF6EE] px-3 py-1.5 text-[12px] font-semibold text-[#1B8C4B] dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Filter className="h-3 w-3" />
              {filterFleet}{filterBucket && ` · ${bucketLabel(filterBucket)}`}
              <X className="h-3 w-3" />
            </button>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9AA8A0]" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / แพล้นท์ / เบอร์รถ"
              className="w-64 rounded-full border border-[#EEF2F0] bg-white py-1.5 pl-9 pr-3 text-[12.5px] text-[#14271C] outline-none focus:border-[#1B8C4B] dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
        </div>

        {/* ---------- driver table ---------- */}
        <div className="overflow-x-auto rounded-[16px] border border-[#EEF2F0] bg-white dark:border-white/[0.07] dark:bg-[#151a10]">
          <div className="grid min-w-[1080px] gap-3 border-b border-[#EEF2F0] px-4 py-2.5 text-[10.5px] font-bold uppercase text-[#9AA8A0] dark:border-white/5 dark:text-white/40"
            style={{ gridTemplateColumns: "70px 1.6fr 0.9fr 1.1fr 0.95fr 0.85fr 1.15fr 190px" }}>
            <div>รหัส</div><div>ชื่อ พจส.ใหม่</div><div>ฟลีท</div><div>แพล้นท์/สถานที่</div>
            <div>สถานะ</div><div>พร้อมรับรถ</div><div>รถที่จอง</div><div className="text-right">จัดการ</div>
          </div>

          {loading && !data && (
            <div className="px-4 py-10 text-center text-[13px] text-[#9AA8A0]">กำลังโหลดข้อมูลจากชีต + Mena-Next…</div>
          )}
          {!loading && shownDrivers.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-[#9AA8A0]">ไม่พบรายการตามเงื่อนไข</div>
          )}

          {shownDrivers.map((d) => {
            const meta = driverStatusMeta(d.status)
            const assignedTruck = trucks.find((t) => t.trucknum.toUpperCase() === d.truckNum.toUpperCase())
            const truckMeta = assignedTruck ? truckStepMeta(assignedTruck) : null
            return (
              <div key={`${d.row}-${d.code}`}
                className="grid min-w-[1080px] items-center gap-3 border-b border-[#F1F5F2] px-4 py-3 text-[12.5px] last:border-0 dark:border-white/5"
                style={{ gridTemplateColumns: "70px 1.6fr 0.9fr 1.1fr 0.95fr 0.85fr 1.15fr 190px" }}>
                <div className="font-mono text-[11.5px] text-[#6B7C72] dark:text-white/50">{d.code || "—"}</div>
                <div>
                  <div className="font-semibold text-[#14271C] dark:text-white">{d.name}</div>
                  <div className="text-[11px] text-[#9AA8A0] dark:text-white/40">{d.position}{d.phone && ` · ${d.phone}`}</div>
                </div>
                <div className="font-semibold text-[#14271C] dark:text-white">{d.fleetKey}</div>
                <div className="text-[#6B7C72] dark:text-white/60">{d.site || "—"}</div>
                <div><span className={chip(meta.cls)}>{meta.emoji} {d.status}</span></div>
                <div>
                  {d.status === "รอรับรถ" ? (
                    <span className={`text-[12px] font-bold ${d.waitDays >= 5 ? "text-rose-600 dark:text-rose-300" : "text-amber-600 dark:text-amber-300"}`}>
                      รอมา {d.waitDays} วัน
                    </span>
                  ) : d.status === "รับรถแล้ว" ? (
                    <span className="text-[11.5px] text-[#9AA8A0] dark:text-white/40">{d.receivedDate || "—"}</span>
                  ) : (
                    <span className="text-[11.5px] text-[#6B7C72] dark:text-white/60">{d.trainDue ? `ครบฝึก ${d.trainDue}` : d.readyDate ? `~${d.readyDate.slice(5).split("-").reverse().join("/")}` : "—"}</span>
                  )}
                </div>
                <div>
                  {d.truckNum ? (
                    <button
                      onClick={() => assignedTruck && setTimelineFor({ plate: assignedTruck.plate, label: `${d.truckNum} · ${assignedTruck.plate}` })}
                      className="text-left" disabled={!assignedTruck} title={assignedTruck ? "ดูประวัติซ่อม" : undefined}
                    >
                      <div className="font-mono text-[12px] font-bold text-[#14271C] dark:text-white">{d.truckNum} <span className="font-normal text-[#9AA8A0]">{d.plate}</span></div>
                      {truckMeta && <span className={chip(truckMeta.cls)}>{truckMeta.emoji} {truckMeta.label}{assignedTruck?.job?.expectedDone && ` · ${assignedTruck.job.expectedDone.slice(5).split("-").reverse().join("/")}`}</span>}
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
