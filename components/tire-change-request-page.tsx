"use client"

import { useState } from "react"
import { ClipboardList, Search, User, Truck, Gauge, Hash, Camera, X, Check } from "lucide-react"
import { swalToast, swalError } from "@/lib/swal"

// แถวจาก /api/tire-change-request/lookup — ค่าคำนวณทั้งหมดมาจาก API
type LookupRow = {
  _id:            string
  vehicle:        string
  tirePosition:   string
  positionCode:   string
  positionName:   string
  product:        string
  serialNo:       string
  treadMm:        number
  mileageStart:   number
  changeIn:       string | null
  isLatest:       boolean
  unitPrice:      number | null
  stockDistance:  number | null
  usedDistance:   number | null
  remainingPct:   number | null
  remainingLevel: "green" | "amber" | "red" | null
  bahtPerKm:      number | null
  age:            { text: string; level: "normal" | "warn" | "danger" } | null
  request:        { itemStatus: string; requestStatus: string; appointmentDate?: string | null } | null
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

const REASON_OPTIONS = ["หมดดอก", "ยางระเบิด", "ยางฉีก", "ยางบวม", "รถกินยาง"]

const remainingChip = {
  red:   "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  amber: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  green: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
}

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
  const [items, setItems]             = useState<LookupRow[]>([])
  const [submittedOdo, setSubmittedOdo] = useState(0)
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null)
  const [searched, setSearched]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [requestId, setRequestId]     = useState<string | null>(null)
  const [modalTire, setModalTire]     = useState<LookupRow | null>(null)
  const [reason, setReason]           = useState("")
  const [note, setNote]               = useState("")
  const [treadMm, setTreadMm]         = useState("")
  const [photos, setPhotos]           = useState<string[]>([])
  const [odometerPhoto, setOdometerPhoto] = useState<string | null>(null)
  const [savingItem, setSavingItem]   = useState(false)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSearched(false)
    // request is only created when the user actually submits a tire item (ขอเปลี่ยนยาง)
    setRequestId(null)
    setRequestedIds(new Set())

    // endpoint เดียวจบ — ประวัติยาง + ข้อมูลรถ + สต๊อก + สถานะคำขอ + ค่าคำนวณทุกคอลัมน์
    const odo = Number(odometer.replace(/,/g, "")) || 0
    const qs = new URLSearchParams({ branch, plate: plate.trim(), odometer: String(odo) })
    const res = await fetch(`/api/tire-change-request/lookup?${qs}`)
    const d   = await res.json().catch(() => ({}))

    const vInfo: VehicleInfo | null = d.vehicle ?? null
    setVehicleInfo(vInfo)
    // pre-fill fleet/plant from vehicle master — driver can edit before requesting
    setFleet(vInfo?.fleet ?? "")
    setPlant(vInfo?.plant ?? "")
    setItems(Array.isArray(d.items) ? d.items : [])
    setSubmittedOdo(odo)
    setSearched(true)
    setLoading(false)

  }

  function openModal(t: LookupRow) {
    setModalTire(t)
    setReason("")
    setNote("")
    setTreadMm("")
    setPhotos([])
  }

  async function handleOdometerPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const img = await resizeImage(file)
      setOdometerPhoto(img)
    } catch {
      swalError("อ่านรูปไม่สำเร็จ กรุณาลองใหม่")
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow picking the same file again
    if (!file) return
    try {
      const img = await resizeImage(file)
      setPhotos((prev) => (prev.length >= 3 ? prev : [...prev, img]))
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
          odometerPhoto: odometerPhoto ?? "",
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

    const res = await fetch(`/api/tire-change-request/${rid}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tirePosition: modalTire.tirePosition,
        positionCode: modalTire.positionCode,
        positionName: modalTire.positionName,
        serialNo:     modalTire.serialNo,
        product:      modalTire.product,
        reason,
        note,
        photos,
        currentTreadMm: Number(treadMm) || 0,
        mileageStart: modalTire.mileageStart,
        usedDistance: modalTire.usedDistance ?? 0,
      }),
    })
    setSavingItem(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "ส่งคำขอไม่สำเร็จ")
      return
    }
    setRequestedIds((prev) => new Set(prev).add(modalTire._id))

    swalToast("success", `ส่งคำขอเปลี่ยนยาง ${modalTire.positionCode || modalTire.serialNo} สำเร็จ`)

    setModalTire(null)
  }

  const inp = "w-full rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] text-[#14271C] dark:text-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B8C4B]/30 placeholder-[#9AA8A0]"
  const th  = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#9AA8A0] whitespace-nowrap"
  const td  = "px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap"

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <ClipboardList size={20} className="text-gray-400" />
        <h1 className="text-[22px] text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}>คำขอเปลี่ยนยาง — {branchLabel}</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        กรอกข้อมูลคนขับและรถ จากนั้นระบบจะแสดงประวัติยางของทะเบียนนั้นจาก Change History
      </p>

      {/* Request form */}
      <form onSubmit={handleSubmit} className="mb-6 rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-4">
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
        {/* odometer photo — upload once, shown in every tire-change modal */}
        <div className="mt-3">
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
            <Camera size={11} /> รูปเลขไมล์รถ
          </span>
          <div className="flex items-start gap-2">
            {odometerPhoto ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={odometerPhoto} alt="รูปเลขไมล์รถ" className="h-24 w-36 rounded-lg object-cover bg-gray-50 dark:bg-white/5" />
                <button type="button" onClick={() => setOdometerPhoto(null)}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <label className="flex h-24 w-36 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 text-sm text-gray-400 hover:border-gray-400 dark:hover:border-white/30 transition-colors">
                <span className="flex items-center gap-1.5 text-xs"><Camera size={14} /> ถ่ายรูป</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleOdometerPhotoChange} className="hidden" />
              </label>
            )}
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-4 flex items-center gap-1.5 rounded-[13px] text-white px-[22px] py-3 text-[14px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ background: "#1B8C4B", boxShadow: "0 5px 12px -3px rgba(27,140,75,.5)", fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
        >
          <Search size={14} />
          {loading ? "กำลังค้นหา..." : "บันทึกคำขอ & ดูประวัติยาง"}
        </button>
      </form>

      {/* History result */}
      {searched && (
        <>
          {/* Vehicle info from vehicle master */}
          <div className="mb-4 rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-3">
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
            <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-10 text-center text-sm text-gray-400">
              ไม่พบทะเบียน &quot;{plate.trim()}&quot; ใน Change History สาขา{branchLabel} — ตรวจสอบทะเบียน หรือกด Sync from ATMS ที่หน้า Change History
            </div>
          ) : (
            <div className="rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#EEF2F0] dark:border-white/8 bg-[#F6FAF7] dark:bg-white/3">
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
                        <td className={td + " font-mono font-semibold"}>{t.positionCode || "—"}</td>
                        <td className={td}>{t.positionName || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300">{t.product || "—"}</td>
                        <td className={td + " font-mono"}>{t.serialNo || "—"}</td>
                        <td className={td + " text-right"}>
                          {t.unitPrice !== null ? fmtPrice(t.unitPrice) : "—"}
                        </td>
                        <td className={td + " text-right"}>
                          {t.stockDistance !== null ? fmtNum(t.stockDistance) : "—"}
                        </td>
                        <td className={td + " text-right"}>{t.treadMm || "—"}</td>
                        <td className={td + " text-right"}>{fmtNum(t.mileageStart)}</td>
                        <td className={td + " text-right font-semibold text-gray-900 dark:text-white"}>
                          {t.usedDistance !== null ? fmtNum(t.usedDistance) : "—"}
                        </td>
                        <td className={td + " text-right"}>
                          {t.remainingPct !== null && t.remainingLevel ? (
                            <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${remainingChip[t.remainingLevel]}`}>
                              {t.remainingPct}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className={td + " text-right"}>
                          {t.bahtPerKm !== null
                            ? t.bahtPerKm.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                            : "—"}
                        </td>
                        <td className={td}>{fmtDate(t.changeIn)}</td>
                        <td className={td}>
                          {t.age
                            ? t.age.level === "normal"
                              ? t.age.text
                              : <span className={ageChip[t.age.level]}>{t.age.text}</span>
                            : "—"}
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
                            const st = t.request
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
                  <span className="font-mono font-semibold">{modalTire.positionCode || "—"}</span>
                  {" "}{modalTire.positionName}
                  {" · "}<span className="font-mono">{modalTire.serialNo}</span>
                </p>
              </div>
              <button type="button" onClick={() => setModalTire(null)} disabled={savingItem}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* photos (max 3) */}
            <div className="mb-3">
              <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                <Camera size={11} /> รูปถ่าย (สูงสุด 3 รูป) — {photos.length}/3
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
                {photos.length < 3 && (
                  <label className="flex h-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-white/15 text-sm text-gray-400 hover:border-gray-400 dark:hover:border-white/30 transition-colors">
                    <span className="flex items-center gap-1.5 text-xs"><Camera size={14} /> ถ่ายรูป / เลือกรูป</span>
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
                  </label>
                )}
              </div>
            </div>

            {/* odometer photo — read-only preview, uploaded in the main form */}
            {odometerPhoto && (
              <div className="mb-3">
                <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                  <Camera size={11} /> รูปเลขไมล์รถ
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={odometerPhoto} alt="รูปเลขไมล์รถ" className="h-28 w-full rounded-lg object-cover bg-gray-50 dark:bg-white/5" />
              </div>
            )}

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
                className="flex-1 rounded-[13px] text-white px-4 py-2 text-[14px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ background: "#1B8C4B", boxShadow: "0 5px 12px -3px rgba(27,140,75,.5)", fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
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
