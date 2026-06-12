"use client"

import { useState } from "react"
import { ClipboardList, Search, User, Truck, Gauge, Hash, Camera, X, Check } from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"

type TireChange = {
  _id:                string
  vehicle:            string
  tirePosition:       string
  product:            string
  serialNo:           string
  treadMm:            number
  mileageStart:       number
  mileageEnd:         number
  maintenanceRequest: string
  changeIn:           string | null
  changeOut:          string | null
  isLatest:           boolean
}

const fmtDate = (s: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const fmtNum = (n: number) => (n ?? 0).toLocaleString("th-TH")

// resize photo to max 1280px JPEG before upload
function resizeImage(file: File, maxSize = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width  = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านรูปไม่สำเร็จ")) }
    img.src = url
  })
}

// "F1ล้อหน้าข้างซ้าย" → { code: "F1", name: "ล้อหน้าข้างซ้าย" }
function splitPosition(pos: string): { code: string; name: string } {
  const m = (pos ?? "").trim().match(/^([A-Z]{1,3}\d{1,2})\s*(.*)$/i)
  if (!m) return { code: "", name: (pos ?? "").trim() }
  return { code: m[1].toUpperCase(), name: m[2] }
}

// today - changeIn → adaptive "วัน / สัปดาห์ / เดือน / ปี" + warning level by age
function tireAge(changeIn: string | null): { text: string; level: "normal" | "warn" | "danger" } | null {
  if (!changeIn) return null
  const d = new Date(changeIn)
  if (isNaN(d.getTime())) return null
  const days = Math.max(0, (Date.now() - d.getTime()) / 86400000)

  let text: string
  if (days < 7) text = `${Math.floor(days)} วัน`
  else if (days < 30.44) text = `${Math.floor(days / 7)} สัปดาห์`
  else if (days < 365.25) text = `${Math.floor(days / 30.44)} เดือน`
  else {
    const years  = Math.floor(days / 365.25)
    const months = Math.floor((days - years * 365.25) / 30.44)
    text = months > 0 ? `${years} ปี ${months} เดือน` : `${years} ปี`
  }

  const level = days >= 730.5 ? "danger" : days >= 365.25 ? "warn" : "normal"
  return { text, level }
}

const ageChip = {
  normal: "",
  warn:   "inline-block rounded-md px-2 py-0.5 text-[11px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  danger: "inline-block rounded-md px-2 py-0.5 text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
}

type VehicleInfo = {
  plate:       string
  vehicleType: string
  brand:       string
  model:       string
  fleet?:      string
  plant?:      string
}

type StockInfo = { unitPrice: number; distance: number }

// สถานะคำขอที่ค้างอยู่ของยางแต่ละเส้น (จากคำขอก่อนหน้า)
type SerialStatus = { itemStatus: string; requestStatus: string; appointmentDate?: string }

const REASON_OPTIONS = ["หมดดอก", "ยางระเบิด", "ยางฉีก", "ยางบวม", "รถกินยาง"]

const fmtPrice = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// same chip colors as the Vehicles page
function typeChip(type: string) {
  const isMixer   = type.includes("Mixer")
  const isTrailer = type.includes("หาง") || type.includes("หัวเบ้า") || type.includes("หัวเบาท์") || type.includes("ลากจูง")
  if (isMixer)   return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
  if (isTrailer) return "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
  return "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400"
}

export function TireChangeRequestPage({ branch, branchLabel }: { branch: string; branchLabel: string }) {
  const [driverName, setDriverName]   = useState("")
  const [plate, setPlate]             = useState("")
  const [truckNumber, setTruckNumber] = useState("")
  const [odometer, setOdometer]       = useState("")
  const [fleet, setFleet]             = useState("")
  const [plant, setPlant]             = useState("")
  const [items, setItems]             = useState<TireChange[]>([])
  const [submittedOdo, setSubmittedOdo] = useState(0)
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null)
  const [stockMap, setStockMap]       = useState<Record<string, StockInfo>>({})
  const [searched, setSearched]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [requestId, setRequestId]     = useState<string | null>(null)
  const [modalTire, setModalTire]     = useState<TireChange | null>(null)
  const [reason, setReason]           = useState("")
  const [note, setNote]               = useState("")
  const [treadMm, setTreadMm]         = useState("")
  const [photos, setPhotos]           = useState<string[]>([])
  const [savingItem, setSavingItem]   = useState(false)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())
  const [serialStatus, setSerialStatus] = useState<Record<string, SerialStatus>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSearched(false)
    // request is only created when the user actually submits a tire item (ขอเปลี่ยนยาง)
    setRequestId(null)
    setRequestedIds(new Set())

    // look up tire history + vehicle master in parallel
    const qs = new URLSearchParams({ branch, vehicle: plate.trim(), limit: "500" })
    const [res, vehRes] = await Promise.all([
      fetch(`/api/tire-change?${qs}`),
      fetch(`/api/vehicles?plates=${encodeURIComponent(plate.trim())}`),
    ])
    const d   = await res.json()
    const veh = await vehRes.json().catch(() => [])
    const vInfo: VehicleInfo | null = Array.isArray(veh) && veh.length > 0 ? veh[0] : null
    setVehicleInfo(vInfo)
    // pre-fill fleet/plant from vehicle master — driver can edit before requesting
    setFleet(vInfo?.fleet ?? "")
    setPlant(vInfo?.plant ?? "")
    const rows: TireChange[] = Array.isArray(d.items) ? d.items : []
    // current tires (ล่าสุด = yes) first, then by position
    rows.sort((a, b) =>
      Number(b.isLatest) - Number(a.isLatest) ||
      a.tirePosition.localeCompare(b.tirePosition, "th")
    )
    // join stock-tire data by serial no (unit price + ระยะทาง) + existing requests for this plate
    const serials = [...new Set(rows.map((r) => r.serialNo.trim()).filter(Boolean))]
    const [stock, existing] = await Promise.all([
      serials.length > 0
        ? fetch(`/api/tire-stock?branch=${branch}&serials=${encodeURIComponent(serials.join(","))}&limit=2000`).then((r) => r.json()).catch(() => [])
        : Promise.resolve([]),
      fetch(`/api/tire-change-request?branch=${branch}&plate=${encodeURIComponent(plate.trim())}&limit=100`).then((r) => r.json()).catch(() => ({})),
    ])

    let map: Record<string, StockInfo> = {}
    if (Array.isArray(stock)) {
      map = Object.fromEntries(
        stock.map((s: { serialNo: string; unitPrice: number; distance: number }) =>
          [s.serialNo.trim(), { unitPrice: s.unitPrice ?? 0, distance: s.distance ?? 0 }])
      )
    }
    setStockMap(map)

    // serial → สถานะคำขอที่ยังค้างอยู่ (pending/approved/appointment) — ยกเว้น done และเส้นที่ถูกปฏิเสธ
    const statusMap: Record<string, SerialStatus> = {}
    type ExistingItem = { serialNo?: string; status?: string }
    type ExistingReq  = { status?: string; appointmentDate?: string; items?: ExistingItem[] }
    const reqs: ExistingReq[] = Array.isArray(existing?.items) ? existing.items : []
    for (const er of reqs) {
      const rStatus = er.status ?? "pending"
      if (rStatus === "done" || rStatus === "rejected") continue
      for (const it of er.items ?? []) {
        const iStatus = it.status ?? "pending"
        if (iStatus === "rejected" || !it.serialNo) continue
        const key = it.serialNo.trim()
        if (statusMap[key]) continue // list is newest-first — keep the latest request's status
        statusMap[key] = { itemStatus: iStatus, requestStatus: rStatus, appointmentDate: er.appointmentDate }
      }
    }
    setSerialStatus(statusMap)

    setItems(rows)
    setSubmittedOdo(Number(odometer.replace(/,/g, "")) || 0)
    setSearched(true)
    setLoading(false)
  }

  function openModal(t: TireChange) {
    setModalTire(t)
    setReason("")
    setNote("")
    setTreadMm("")
    setPhotos([])
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow picking the same file again
    if (!file) return
    try {
      const img = await resizeImage(file)
      setPhotos((prev) => (prev.length >= 2 ? prev : [...prev, img]))
    } catch {
      swalError("อ่านรูปไม่สำเร็จ กรุณาลองใหม่")
    }
  }

  async function handleItemSave(e: React.FormEvent) {
    e.preventDefault()
    if (!modalTire) return
    setSavingItem(true)

    // create the parent request on the first tire item (not on search)
    let rid = requestId
    if (!rid) {
      const saveRes = await fetch("/api/tire-change-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          driverName,
          plate: plate.trim(),
          truckNumber,
          currentOdometer: submittedOdo,
          // pre-filled from vehicle master, editable by the driver
          fleet,
          plant,
          vehicleType: vehicleInfo?.vehicleType ?? "",
        }),
      })
      if (!saveRes.ok) {
        setSavingItem(false)
        const d = await saveRes.json().catch(() => ({}))
        swalError(d.error ?? "บันทึกคำขอไม่สำเร็จ")
        return
      }
      const saved = await saveRes.json().catch(() => ({}))
      rid = saved._id ?? null
      if (!rid) { setSavingItem(false); swalError("บันทึกคำขอไม่สำเร็จ"); return }
      setRequestId(rid)
    }

    const pos  = splitPosition(modalTire.tirePosition)
    const used = submittedOdo > 0 && modalTire.mileageStart > 0 ? submittedOdo - modalTire.mileageStart : 0
    const res = await fetch(`/api/tire-change-request/${rid}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tirePosition: modalTire.tirePosition,
        positionCode: pos.code,
        positionName: pos.name,
        serialNo:     modalTire.serialNo,
        product:      modalTire.product,
        reason,
        note,
        photos,
        currentTreadMm: Number(treadMm) || 0,
        mileageStart: modalTire.mileageStart,
        usedDistance: used,
      }),
    })
    setSavingItem(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "ส่งคำขอไม่สำเร็จ")
      return
    }
    setRequestedIds((prev) => new Set(prev).add(modalTire._id))
    setModalTire(null)
    swalToast("success", `ส่งคำขอเปลี่ยนยาง ${splitPosition(modalTire.tirePosition).code || modalTire.serialNo} สำเร็จ`)
  }

  const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
  const th  = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
  const td  = "px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap"

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <ClipboardList size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Change Tire Request — {branchLabel}</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        กรอกข้อมูลคนขับและรถ จากนั้นระบบจะแสดงประวัติยางของทะเบียนนั้นจาก Change History
      </p>

      {/* Request form */}
      <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <User size={11} /> ชื่อคนขับ *
            </label>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inp} required placeholder="สมชาย ใจดี" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Truck size={11} /> ทะเบียนรถ *
            </label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} className={inp} required placeholder="สบ.71-3569" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Hash size={11} /> เบอร์รถ *
            </label>
            <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} className={inp} required placeholder="112" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Gauge size={11} /> เลขไมล์ปัจจุบัน *
            </label>
            <input
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              className={inp}
              required
              inputMode="numeric"
              placeholder="250000"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Truck size={11} /> ฟลีท
            </label>
            <input value={fleet} onChange={(e) => setFleet(e.target.value)} className={inp} placeholder="เติมอัตโนมัติหลังค้นหา" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Hash size={11} /> Plant
            </label>
            <input value={plant} onChange={(e) => setPlant(e.target.value)} className={inp} placeholder="เติมอัตโนมัติหลังค้นหา" />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-4 flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Search size={14} />
          {loading ? "กำลังค้นหา..." : "บันทึกคำขอ & ดูประวัติยาง"}
        </button>
      </form>

      {/* History result */}
      {searched && (
        <>
          {/* Vehicle info from vehicle master */}
          <div className="mb-4 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-3">
            {vehicleInfo ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-[11px] text-gray-400 mr-1.5">ทะเบียน</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">{vehicleInfo.plate}</span>
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 mr-1.5">ประเภท</span>
                  <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${typeChip(vehicleInfo.vehicleType || "")}`}>
                    {vehicleInfo.vehicleType || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-gray-400 mr-1.5">ยี่ห้อ / รุ่น</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {vehicleInfo.brand || "—"}{vehicleInfo.model ? ` · ${vehicleInfo.model}` : ""}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ทะเบียน &quot;{plate.trim()}&quot; ไม่พบในทะเบียนยานพาหนะ
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              ประวัติยาง — {plate.trim()}
            </h2>
            <span className="text-sm text-gray-400">({items.length} รายการ)</span>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-4 py-10 text-center text-sm text-gray-400">
              ไม่พบทะเบียน &quot;{plate.trim()}&quot; ใน Change History สาขา{branchLabel} — ตรวจสอบทะเบียน หรือกด Sync from ATMS ที่หน้า Change History
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                      <th className={th}>ยานพาหนะ</th>
                      <th className={th}>Position</th>
                      <th className={th}>ชื่อตำแหน่ง</th>
                      <th className={th}>สินค้า</th>
                      <th className={th}>Serial No</th>
                      <th className={th + " text-right"}>Unit Price</th>
                      <th className={th + " text-right"}>ระยะทาง</th>
                      <th className={th + " text-right"}>มม.</th>
                      <th className={th + " text-right"}>ไมล์เริ่มต้น</th>
                      <th className={th + " text-right"}>ระยะทางใช้งาน</th>
                      <th className={th + " text-right"}>ประสิทธิภาพคงเหลือ</th>
                      <th className={th + " text-right"}>บาทต่อกิโล</th>
                      <th className={th}>เปลี่ยนเข้า</th>
                      <th className={th}>ระยะเวลาใช้งาน</th>
                      <th className={th}>ขอเปลี่ยน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t, i) => (
                      <tr
                        key={t._id}
                        className={[
                          "border-b border-gray-100 dark:border-white/5",
                          t.isLatest
                            ? "bg-green-50/60 dark:bg-green-950/15"
                            : i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : "",
                        ].join(" ")}
                      >
                        <td className={td + " font-mono font-semibold text-gray-900 dark:text-white"}>
                          {t.vehicle}
                        </td>
                        <td className={td + " font-mono font-semibold"}>{splitPosition(t.tirePosition).code || "—"}</td>
                        <td className={td}>{splitPosition(t.tirePosition).name || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.product || "—"}</td>
                        <td className={td + " font-mono"}>{t.serialNo || "—"}</td>
                        <td className={td + " text-right"}>
                          {stockMap[t.serialNo.trim()] ? fmtPrice(stockMap[t.serialNo.trim()].unitPrice) : "—"}
                        </td>
                        <td className={td + " text-right"}>
                          {stockMap[t.serialNo.trim()] ? fmtNum(stockMap[t.serialNo.trim()].distance) : "—"}
                        </td>
                        <td className={td + " text-right"}>{t.treadMm || "—"}</td>
                        <td className={td + " text-right"}>{fmtNum(t.mileageStart)}</td>
                        <td className={td + " text-right font-semibold text-gray-900 dark:text-white"}>
                          {submittedOdo > 0 && t.mileageStart > 0 ? fmtNum(submittedOdo - t.mileageStart) : "—"}
                        </td>
                        <td className={td + " text-right"}>
                          {(() => {
                            const stock = stockMap[t.serialNo.trim()]
                            const used  = submittedOdo > 0 && t.mileageStart > 0 ? submittedOdo - t.mileageStart : null
                            if (!stock || stock.distance <= 0 || used === null) return "—"
                            const remaining = Math.round((1 - used / stock.distance) * 100)
                            const chip =
                              remaining <= 20 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                              : remaining <= 50 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                              : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                            return (
                              <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${chip}`}>
                                {remaining}%
                              </span>
                            )
                          })()}
                        </td>
                        <td className={td + " text-right"}>
                          {(() => {
                            const stock = stockMap[t.serialNo.trim()]
                            const used  = submittedOdo > 0 && t.mileageStart > 0 ? submittedOdo - t.mileageStart : null
                            if (!stock || stock.unitPrice <= 0 || used === null || used <= 0) return "—"
                            return (stock.unitPrice / used).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                          })()}
                        </td>
                        <td className={td}>{fmtDate(t.changeIn)}</td>
                        <td className={td}>
                          {(() => {
                            const age = tireAge(t.changeIn)
                            if (!age) return "—"
                            return age.level === "normal"
                              ? age.text
                              : <span className={ageChip[age.level]}>{age.text}</span>
                          })()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {(() => {
                            if (requestedIds.has(t._id)) {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-300">
                                  <Check size={11} /> ส่งคำขอแล้ว
                                </span>
                              )
                            }
                            const st = serialStatus[t.serialNo.trim()]
                            if (st) {
                              if (st.requestStatus === "appointment") {
                                return (
                                  <span className="inline-block rounded-md bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300">
                                    นัดหมาย {st.appointmentDate ? fmtDate(st.appointmentDate) : ""}
                                  </span>
                                )
                              }
                              if (st.itemStatus === "approved") {
                                return (
                                  <span className="inline-block rounded-md bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                                    อนุมัติแล้ว
                                  </span>
                                )
                              }
                              return (
                                <span className="inline-block rounded-md bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  รออนุมัติ
                                </span>
                              )
                            }
                            return (
                              <button
                                onClick={() => openModal(t)}
                                className="rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-2.5 py-1 text-[11px] font-medium hover:opacity-90 transition-opacity"
                              >
                                ขอเปลี่ยนยาง
                              </button>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Per-tire request modal ── */}
      {modalTire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !savingItem && setModalTire(null)}>
          <form
            onSubmit={handleItemSave}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0f1117] border border-gray-200 dark:border-white/10 p-5 shadow-xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">ขอเปลี่ยนยาง</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  <span className="font-mono font-semibold">{splitPosition(modalTire.tirePosition).code || "—"}</span>
                  {" "}{splitPosition(modalTire.tirePosition).name}
                  {" · "}<span className="font-mono">{modalTire.serialNo}</span>
                </p>
              </div>
              <button type="button" onClick={() => setModalTire(null)} disabled={savingItem}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* photos (max 2) */}
            <div className="mb-3">
              <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                <Camera size={11} /> รูปถ่าย (สูงสุด 2 รูป) — {photos.length}/2
              </span>
              <div className="grid grid-cols-2 gap-2">
                {photos.map((p, pi) => (
                  <div key={pi} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt={`รูปยาง ${pi + 1}`} className="h-28 w-full rounded-lg object-cover bg-gray-50 dark:bg-white/5" />
                    <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== pi))}
                      className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {photos.length < 2 && (
                  <label className="flex h-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 text-sm text-gray-400 hover:border-gray-400 dark:hover:border-white/30 transition-colors">
                    <span className="flex items-center gap-1.5 text-xs"><Camera size={14} /> ถ่ายรูป / เลือกรูป</span>
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
                  </label>
                )}
              </div>
            </div>

            {/* tread mm */}
            <label className="block mb-3">
              <span className="block text-[11px] font-medium text-gray-500 mb-1">มิลยาง (มม.)</span>
              <input
                type="number"
                step="0.5"
                min="0"
                inputMode="decimal"
                value={treadMm}
                onChange={(e) => setTreadMm(e.target.value)}
                placeholder="เช่น 3.5"
                className={inp}
              />
            </label>

            {/* reason */}
            <label className="block mb-3">
              <span className="block text-[11px] font-medium text-gray-500 mb-1">สาเหตุ *</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                className={inp}
              >
                <option value="">— เลือกสาเหตุ —</option>
                {REASON_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            {/* note */}
            <label className="block mb-4">
              <span className="block text-[11px] font-medium text-gray-500 mb-1">หมายเหตุ</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                className={inp + " resize-none"}
              />
            </label>

            <div className="flex gap-2">
              <button type="submit" disabled={savingItem || !reason.trim()}
                className="flex-1 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
                {savingItem ? "กำลังส่ง..." : "ส่งคำขอ"}
              </button>
              <button type="button" onClick={() => setModalTire(null)} disabled={savingItem}
                className="rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8">
                ยกเลิก
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
