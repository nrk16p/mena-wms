"use client"

import { useState } from "react"
import { ClipboardList, Search, User, Truck, Gauge, Hash } from "lucide-react"
import { swalError } from "@/lib/swal"

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
}

type StockInfo = { unitPrice: number; distance: number }

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
  const [items, setItems]             = useState<TireChange[]>([])
  const [submittedOdo, setSubmittedOdo] = useState(0)
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null)
  const [stockMap, setStockMap]       = useState<Record<string, StockInfo>>({})
  const [searched, setSearched]       = useState(false)
  const [loading, setLoading]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setSearched(false)

    // 1. save the request
    const saveRes = await fetch("/api/tire-change-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch,
        driverName,
        plate: plate.trim(),
        truckNumber,
        currentOdometer: odometer,
      }),
    })
    if (!saveRes.ok) {
      setLoading(false)
      const d = await saveRes.json().catch(() => ({}))
      swalError(d.error ?? "บันทึกคำขอไม่สำเร็จ")
      return
    }

    // 2. look up tire history + vehicle master in parallel
    const qs = new URLSearchParams({ branch, vehicle: plate.trim(), limit: "500" })
    const [res, vehRes] = await Promise.all([
      fetch(`/api/tire-change?${qs}`),
      fetch(`/api/vehicles?plates=${encodeURIComponent(plate.trim())}`),
    ])
    const d   = await res.json()
    const veh = await vehRes.json().catch(() => [])
    setVehicleInfo(Array.isArray(veh) && veh.length > 0 ? veh[0] : null)
    const rows: TireChange[] = Array.isArray(d.items) ? d.items : []
    // current tires (ล่าสุด = yes) first, then by position
    rows.sort((a, b) =>
      Number(b.isLatest) - Number(a.isLatest) ||
      a.tirePosition.localeCompare(b.tirePosition, "th")
    )
    // 3. join stock-tire data by serial no (unit price + ระยะทาง)
    const serials = [...new Set(rows.map((r) => r.serialNo.trim()).filter(Boolean))]
    let map: Record<string, StockInfo> = {}
    if (serials.length > 0) {
      const stockRes = await fetch(`/api/tire-stock?branch=${branch}&serials=${encodeURIComponent(serials.join(","))}&limit=2000`)
      const stock = await stockRes.json().catch(() => [])
      if (Array.isArray(stock)) {
        map = Object.fromEntries(
          stock.map((s: { serialNo: string; unitPrice: number; distance: number }) =>
            [s.serialNo.trim(), { unitPrice: s.unitPrice ?? 0, distance: s.distance ?? 0 }])
        )
      }
    }
    setStockMap(map)

    setItems(rows)
    setSubmittedOdo(Number(odometer.replace(/,/g, "")) || 0)
    setSearched(true)
    setLoading(false)
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
              <User size={11} /> 1. ชื่อคนขับ *
            </label>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inp} required placeholder="สมชาย ใจดี" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Truck size={11} /> 2. ทะเบียนรถ *
            </label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} className={inp} required placeholder="สบ.71-3569" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Hash size={11} /> 3. เบอร์รถ *
            </label>
            <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} className={inp} required placeholder="112" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
              <Gauge size={11} /> 4. เลขไมล์ปัจจุบัน *
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
                      <th className={th}>ตำแหน่งยาง</th>
                      <th className={th}>สินค้า</th>
                      <th className={th}>Serial No</th>
                      <th className={th + " text-right"}>Unit Price</th>
                      <th className={th + " text-right"}>ระยะทาง</th>
                      <th className={th + " text-right"}>มม.</th>
                      <th className={th + " text-right"}>ไมล์เริ่มต้น</th>
                      <th className={th + " text-right"}>ระยะทางใช้งาน</th>
                      <th className={th}>เปลี่ยนเข้า</th>
                      <th className={th}>ระยะเวลาใช้งาน</th>
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
                        <td className={td}>{t.tirePosition || "—"}</td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
