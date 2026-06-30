"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { ClipboardCheck, Search, ChevronDown, ChevronUp, Check, X, Flag } from "lucide-react"
import Swal from "sweetalert2"
import { swalConfirm, swalToast, swalError } from "@/lib/swal"

type RequestItem = {
  _id:            string
  tirePosition:   string
  positionCode:   string
  positionName:   string
  serialNo:       string
  product:        string
  reason:         string
  note?:          string
  photoUrl:       string
  photoUrls?:     string[]
  currentTreadMm: number
  mileageStart:   number
  usedDistance:   number
  unitPrice:      number | null
  stockDistance:  number | null
  remainingPct:   number | null
  bahtPerKm:      number | null
  bahtPerKmStock: number | null
  lastPR:         string | null
  lastChangeIn:   string | null
  createdAt:      string
  status?:        string
  approvedBy?:    string
  rejectedBy?:    string
  rejectReason?:  string
}

type TireRequest = {
  _id:             string
  branch:          string
  driverName:      string
  plate:           string
  truckNumber:     string
  currentOdometer: number
  fleet?:          string
  plant?:          string
  vehicleType?:    string
  status?:         string
  createdAt:       string
  items?:          RequestItem[]
  approvedBy?:     string
  approvedAt?:     string
  rejectedBy?:     string
  rejectedAt?:     string
  rejectReason?:   string
  appointmentDate?: string
  appointmentNote?: string
  doneBy?:         string
  doneAt?:         string
}


const STATUS_TABS = [
  { value: "",            label: "ทั้งหมด" },
  { value: "pending",     label: "Pending" },
  { value: "approved",    label: "Approved" },
  { value: "done",        label: "Done" },
  { value: "rejected",    label: "Rejected" },
]

function statusChip(status: string) {
  switch (status) {
    case "approved":    return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
    case "done":        return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    case "rejected":    return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
    default:            return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" // pending
  }
}

const fmtDate = (s?: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const fmtNum = (n: number) => (n ?? 0).toLocaleString("th-TH")

type VehicleMeta = { fleet: string; plant: string }

export function TireRequestsAdminPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const [items, setItems]     = useState<TireRequest[]>([])
  const [vehicleMap, setVehicleMap] = useState<Record<string, VehicleMeta>>({})
  const [total, setTotal]     = useState(0)
  const [pages, setPages]     = useState(1)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState("pending")
  const [q, setQ]             = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acting, setActing]       = useState(false)
  // internal MR: plate → { mrId, status, note, updatedAt } | null (null = no MR created yet)
  const [mrMap, setMrMap] = useState<Record<string, { mrId: string; status: string; note: string; updatedAt: string } | null>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ branch, page: String(page), limit: "50" })
    if (statusTab) qs.set("status", statusTab)
    if (q)         qs.set("q", q)
    const res = await fetch(`/api/tire-change-request?${qs}`)
    const d   = await res.json()
    const reqs: TireRequest[] = Array.isArray(d.items) ? d.items : []
    setItems(reqs)
    setTotal(d.total ?? 0)
    setPages(d.pages ?? 1)

    // enrich with fleet/plant from vehicle master
    const plates = [...new Set(reqs.map((r) => r.plate.trim()).filter(Boolean))]
    if (plates.length > 0) {
      const veh = await fetch(`/api/vehicles?plates=${encodeURIComponent(plates.join(","))}`)
        .then((r) => r.json()).catch(() => [])
      if (Array.isArray(veh)) {
        setVehicleMap(Object.fromEntries(
          veh.map((v: { plate: string; fleet?: string; plant?: string }) =>
            [v.plate.trim(), { fleet: v.fleet ?? "", plant: v.plant ?? "" }])
        ))
      }
    } else {
      setVehicleMap({})
    }
    setLoading(false)
  }, [branch, statusTab, q, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [statusTab, q])

  // fetch internal MR when expanding a row with a รถกินยาง item
  useEffect(() => {
    if (!expanded) return
    const req = items.find((r) => r._id === expanded)
    if (!req) return
    if (!(req.items ?? []).some((it) => it.reason === "รถกินยาง")) return
    const plate = req.plate
    fetch(`/api/tire-mr/latest?branch=${encodeURIComponent(req.branch)}&plates=${encodeURIComponent(plate)}`)
      .then((r) => r.json())
      .then((data: Record<string, { mrId: string; status: string; note: string; updatedAt: string }>) => {
        setMrMap((prev) => ({ ...prev, [plate]: data[plate] ?? null }))
      })
      .catch(() => {})
  }, [expanded, items])

  async function patch(id: string, body: Record<string, unknown>, successMsg: string) {
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "ดำเนินการไม่สำเร็จ")
      return false
    }
    swalToast("success", successMsg)
    load()
    return true
  }

  async function itemPatch(requestId: string, itemId: string, body: Record<string, unknown>, successMsg: string) {
    setActing(true)
    const res = await fetch(`/api/tire-change-request/${requestId}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setActing(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "ดำเนินการไม่สำเร็จ")
      return
    }
    swalToast("success", successMsg)
    load()
  }

  function mrChip(status: string) {
    if (status === "completed")  return { label: "ซ่อมเสร็จแล้ว", cls: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" }
    if (status === "in_progress") return { label: "กำลังซ่อม",     cls: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" }
    return { label: "รอดำเนินการ",    cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" }
  }

  async function handleCreateMr(r: TireRequest) {
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "สร้าง MR",
      html: `<div style="font-size:0.85rem;margin-bottom:6px">ทะเบียน <b>${r.plate}</b></div>`,
      input: "textarea",
      inputLabel: "หมายเหตุ (ไม่บังคับ)",
      inputAttributes: { rows: "3", placeholder: "ระบุรายละเอียดการซ่อม..." },
      showCancelButton: true,
      confirmButtonText: "สร้าง MR",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    const res = await fetch("/api/tire-mr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: r.branch, plate: r.plate, requestId: r._id, note: value ?? "", createdBy: session?.user?.name ?? "" }),
    })
    if (!res.ok) { swalError("สร้าง MR ไม่สำเร็จ"); return }
    const data = await res.json()
    setMrMap((prev) => ({ ...prev, [r.plate]: { mrId: String(data._id), status: "pending", note: value ?? "", updatedAt: new Date().toISOString() } }))
    swalToast("success", "สร้าง MR แล้ว")
  }

  async function handleMrStatusUpdate(r: TireRequest, nextStatus: string) {
    const mr = mrMap[r.plate]
    if (!mr) return
    const label = nextStatus === "in_progress" ? "เริ่มดำเนินการซ่อม" : "ปิด MR — ซ่อมเสร็จแล้ว"
    const { value, isConfirmed } = await Swal.fire<string>({
      title: label,
      html: `<div style="font-size:0.85rem;margin-bottom:6px">ทะเบียน <b>${r.plate}</b></div>`,
      input: "textarea",
      inputLabel: "หมายเหตุ (ไม่บังคับ)",
      inputAttributes: { rows: "2" },
      showCancelButton: true,
      confirmButtonText: "ยืนยัน",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    const res = await fetch(`/api/tire-mr/${mr.mrId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, note: value ?? "", updatedBy: session?.user?.name ?? "" }),
    })
    if (!res.ok) { swalError("อัปเดตไม่สำเร็จ"); return }
    setMrMap((prev) => ({ ...prev, [r.plate]: { ...mr, status: nextStatus, updatedAt: new Date().toISOString() } }))
    swalToast("success", `อัปเดต MR เป็น "${mrChip(nextStatus).label}" แล้ว`)
  }

  async function handleItemApprove(r: TireRequest, it: RequestItem) {
    // Gate: รถกินยาง requires MR completed before tire change is approved
    if (it.reason === "รถกินยาง") {
      const mr = mrMap[r.plate]
      if (!mr || mr.status !== "completed") {
        await Swal.fire({
          icon: "warning",
          title: "รอ MR ซ่อมเสร็จก่อน",
          html: `ยางเส้นนี้สาเหตุ <b>รถกินยาง</b><br>ต้องปิด MR ก่อนจึงจะอนุมัติเปลี่ยนยางได้<br><br>สถานะ MR ปัจจุบัน: <b>${mr ? mrChip(mr.status).label : "ยังไม่มี MR"}</b>`,
          confirmButtonText: "รับทราบ",
        })
        return
      }
    }
    const result = await swalConfirm(
      "อนุมัติยางเส้นนี้?",
      `คนขับ: ${r.driverName} · ${r.plate}\n${it.positionCode} ${it.positionName} · ${it.serialNo}`
    )
    if (!result.isConfirmed) return
    itemPatch(r._id, it._id, { action: "approve" }, `อนุมัติ ${it.serialNo} แล้ว`)
  }

  async function handleItemReject(r: TireRequest, it: RequestItem) {
    const { value, isConfirmed } = await Swal.fire<string>({
      title: "ปฏิเสธยางเส้นนี้?",
      html: `<div style="font-size:0.85rem;margin-bottom:4px">คนขับ: <b>${r.driverName}</b> · ${r.plate}</div><code style="font-size:0.8rem;opacity:0.65">${it.positionCode} ${it.positionName} · ${it.serialNo}</code>`,
      input: "textarea",
      inputLabel: "เหตุผลการปฏิเสธ (ไม่บังคับ)",
      inputAttributes: { rows: "3" },
      showCancelButton: true,
      confirmButtonText: "ยืนยันปฏิเสธ",
      confirmButtonColor: "#dc2626",
      cancelButtonText: "ยกเลิก",
      reverseButtons: true,
    })
    if (!isConfirmed) return
    itemPatch(r._id, it._id, { action: "reject", reason: value ?? "" }, `ปฏิเสธ ${it.serialNo} แล้ว`)
  }

  async function handleDone(r: TireRequest) {
    const result = await swalConfirm("ปิดงานเปลี่ยนยาง?", `${r.plate} · ${r.driverName}`)
    if (!result.isConfirmed) return
    patch(r._id, { action: "done" }, "ปิดงานแล้ว")
  }

  const inp = "rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
  const th  = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
  const td  = "px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap"
  const btn = "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"

  if (session && !isAdmin) {
    return (
      <div className="px-4 py-16 text-center text-sm text-gray-400">
        หน้านี้สำหรับ admin เท่านั้น
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <ClipboardCheck size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">อนุมัติคำขอเปลี่ยนยาง — {branchLabel}</h1>
        <span className="text-sm text-gray-400">({total.toLocaleString()} คำขอ)</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Pending → Approve/Reject → Done — คลิกแถวเพื่อดูรายละเอียดยางแต่ละเส้น
      </p>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusTab(t.value)}
            className={[
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              statusTab === t.value
                ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900"
                : "border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / คนขับ / เบอร์รถ..." className={inp + " w-full pl-8"} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>วันที่</th>
                <th className={th}>ทะเบียน</th>
                <th className={th}>เบอร์รถ</th>
                <th className={th}>คนขับ</th>
                <th className={th}>ฟลีท</th>
                <th className={th}>Plant</th>
                <th className={th + " text-right"}>เลขไมล์</th>
                <th className={th + " text-center"}>ยางที่ขอ</th>
                <th className={th}>Status</th>
                <th className={th + " w-48"}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบคำขอ</td></tr>
              ) : items.map((r, i) => {
                const status = r.status ?? "pending"
                const tireCount = (r.items ?? []).length
                const isOpen = expanded === r._id
                return (
                  <React.Fragment key={r._id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : r._id)}
                      className={`cursor-pointer border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""} hover:bg-blue-50/40 dark:hover:bg-blue-950/10`}
                    >
                      <td className={td}>{fmtDate(r.createdAt)}</td>
                      <td className={td + " font-mono font-semibold text-gray-900 dark:text-white"}>
                        <span className="inline-flex items-center gap-1">
                          {r.plate}
                          {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </span>
                      </td>
                      <td className={td}>{r.truckNumber || "—"}</td>
                      <td className={td}>{r.driverName || "—"}</td>
                      <td className={td}>{r.fleet || vehicleMap[r.plate.trim()]?.fleet || "—"}</td>
                      <td className={td}>{r.plant || vehicleMap[r.plate.trim()]?.plant || "—"}</td>
                      <td className={td + " text-right"}>{fmtNum(r.currentOdometer)}</td>
                      <td className={td + " text-center font-semibold"}>{tireCount}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(status)}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {status === "pending" && (
                            <span className="text-[11px] text-gray-400">อนุมัติรายเส้น ↓ คลิกแถว</span>
                          )}
                          {status === "approved" && (
                            <button disabled={acting} onClick={() => handleDone(r)}
                              className={btn + " bg-green-600 text-white inline-flex items-center gap-1"}>
                              <Flag size={11} /> เสร็จสิ้น
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded: tire items */}
                    {isOpen && (
                      <tr className="border-b border-gray-100 dark:border-white/5 bg-blue-50/30 dark:bg-blue-950/10">
                        <td colSpan={10} className="px-4 py-3">
                          {tireCount === 0 ? (
                            <p className="text-xs text-gray-400">ไม่มีรายการยาง (คนขับยังไม่ได้กดขอเปลี่ยนรายเส้น)</p>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117]">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                                    <th className={th}>Position</th>
                                    <th className={th}>ชื่อตำแหน่ง</th>
                                    <th className={th}>สินค้า</th>
                                    <th className={th}>Serial No</th>
                                    <th className={th}>สาเหตุ</th>
                                    <th className={th}>หมายเหตุ</th>
                                    <th className={th + " text-right"}>มิลยาง (มม.)</th>
                                    <th className={th + " text-right"}>ไมล์เริ่มต้น</th>
                                    <th className={th + " text-right"}>ระยะทางใช้งาน</th>
                                    <th className={th + " text-right"}>ประสิทธิภาพคงเหลือ</th>
                                    <th className={th + " text-right"}>บาทต่อกิโล<br/><span className="font-normal normal-case opacity-60">มาตรฐาน / ใช้จริง</span></th>
                                    <th className={th}>รูปถ่าย</th>
                                    <th className={th}>เวลาที่ขอ</th>
                                    <th className={th}>Status</th>
                                    <th className={th + " w-40"}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(r.items ?? []).map((it, ii) => (
                                    <tr key={it._id} className={`border-b border-gray-100 dark:border-white/5 last:border-0 ${ii % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                                      <td className={td + " font-mono font-semibold text-gray-900 dark:text-white"}>{it.positionCode || "—"}</td>
                                      <td className={td}>{it.positionName || "—"}</td>
                                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{it.product || "—"}</td>
                                      <td className={td + " font-mono"}>{it.serialNo || "—"}</td>
                                      <td className={td + " font-medium"}>
                                        <div className="flex flex-col gap-1.5">
                                          <span>{it.reason}</span>
                                          {it.reason === "รถกินยาง" && (() => {
                                            const mr = mrMap[r.plate]
                                            // still loading
                                            if (mr === undefined) return <span className="text-[10px] text-gray-400">กำลังตรวจ MR...</span>
                                            // no MR yet
                                            if (mr === null) return (
                                              <button
                                                type="button"
                                                onClick={() => handleCreateMr(r)}
                                                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-blue-600 text-white hover:opacity-90 transition-opacity"
                                              >
                                                + สร้าง MR
                                              </button>
                                            )
                                            const { label, cls } = mrChip(mr.status)
                                            return (
                                              <div className="flex flex-col gap-1">
                                                <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${cls}`}>MR: {label}</span>
                                                {mr.status === "pending" && (
                                                  <button type="button" onClick={() => handleMrStatusUpdate(r, "in_progress")}
                                                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-orange-500 text-white hover:opacity-90 transition-opacity">
                                                    เริ่มซ่อม
                                                  </button>
                                                )}
                                                {mr.status === "in_progress" && (
                                                  <button type="button" onClick={() => handleMrStatusUpdate(r, "completed")}
                                                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-green-600 text-white hover:opacity-90 transition-opacity">
                                                    ซ่อมเสร็จ ✓
                                                  </button>
                                                )}
                                              </div>
                                            )
                                          })()}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={it.note || undefined}>{it.note || "—"}</td>
                                      <td className={td + " text-right"}>{it.currentTreadMm > 0 ? it.currentTreadMm : "—"}</td>
                                      <td className={td + " text-right"}>{fmtNum(it.mileageStart)}</td>
                                      <td className={td + " text-right"}>{it.usedDistance > 0 ? fmtNum(it.usedDistance) : "—"}</td>
                                      <td className={td + " text-right"}>
                                        {it.remainingPct !== null ? (
                                          <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                            it.remainingPct <= 20 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                                            : it.remainingPct <= 50 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                            : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                          }`}>{it.remainingPct}%</span>
                                        ) : "—"}
                                      </td>
                                      <td className={td + " text-right"}>
                                        <div className="text-gray-400 text-[10px]">
                                          {it.bahtPerKmStock !== null
                                            ? it.bahtPerKmStock.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                                            : "—"}
                                        </div>
                                        <div className={`font-semibold ${it.bahtPerKm !== null && it.bahtPerKmStock !== null && it.bahtPerKm > it.bahtPerKmStock ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                                          {it.bahtPerKm !== null
                                            ? it.bahtPerKm.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                                            : "—"}
                                        </div>
                                      </td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">
                                        {(() => {
                                          const urls = it.photoUrls?.length ? it.photoUrls : it.photoUrl ? [it.photoUrl] : []
                                          if (urls.length === 0) return <span className="text-xs text-gray-400">—</span>
                                          return (
                                            <div className="flex gap-1.5">
                                              {urls.map((u, ui) => (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  key={ui}
                                                  src={u}
                                                  alt={`รูปยาง ${ui + 1}`}
                                                  onClick={() => window.open(u, "_blank")}
                                                  className="h-10 w-10 cursor-zoom-in rounded-md object-cover ring-1 ring-gray-200 dark:ring-white/10"
                                                />
                                              ))}
                                            </div>
                                          )
                                        })()}
                                      </td>
                                      <td className={td + " text-gray-500 dark:text-gray-400"}>{fmtDate(it.createdAt)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${statusChip(it.status ?? "pending")}`}
                                          title={it.rejectReason ? `เหตุผล: ${it.rejectReason}` : undefined}>
                                          {it.status ?? "pending"}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        {(status === "pending" || status === "approved" || status === "rejected") && (
                                          <div className="flex items-center gap-1.5">
                                            {(it.status ?? "pending") !== "approved" && (() => {
                                              const mrBlocked = it.reason === "รถกินยาง" && mrMap[r.plate]?.status !== "completed"
                                              return (
                                                <button
                                                  disabled={acting}
                                                  onClick={() => handleItemApprove(r, it)}
                                                  title={mrBlocked ? "รอ MR ซ่อมเสร็จก่อน" : undefined}
                                                  className={btn + " inline-flex items-center gap-1 " + (mrBlocked ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed" : "bg-green-600 text-white")}
                                                >
                                                  <Check size={11} /> อนุมัติ
                                                </button>
                                              )
                                            })()}
                                            {(it.status ?? "pending") !== "rejected" && (
                                              <button disabled={acting} onClick={() => handleItemReject(r, it)}
                                                className={btn + " bg-red-600 text-white inline-flex items-center gap-1"}>
                                                <X size={11} /> ปฏิเสธ
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {r.rejectReason && (
                            <p className="mt-2 text-xs text-red-500">เหตุผลปฏิเสธ: {r.rejectReason}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-white/8 px-4 py-2.5">
            <span className="text-xs text-gray-400">หน้า {page} / {pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40">
                ก่อนหน้า
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="rounded-lg border border-gray-200 dark:border-white/10 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/8 disabled:opacity-40">
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
