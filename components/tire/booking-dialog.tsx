"use client"

// ฟอร์ม "จองเปลี่ยนยาง" ฝั่งแอดมิน — รถ (ทะเบียน/เบอร์รถ) → เลือกยางที่จะเปลี่ยน → สาเหตุ · เลขไมล์ · มิลยาง · รูป · หมายเหตุ
// เลือกรถแล้วโชว์ยางทุกตำแหน่งของคันนั้น เรียงจากเส้นที่ต้องเปลี่ยนก่อน (ใช้ไปมากสุด) → ยังไม่ต้องเปลี่ยน
// % ใช้ไป = ตัวเลขเดียวกับแท็บ "ยางถึงกำหนดเปลี่ยน" และแอปคนขับ (tire_distance)
// ส่งแล้วข้ามขั้นอนุมัติ ขึ้นเป็น "รอเปลี่ยน" ทันที (ดู POST /api/tire-change-request/booking)

import React, { useEffect, useId, useMemo, useRef, useState } from "react"
import { CalendarClock, Check, ChevronDown, ImagePlus, RefreshCw, Search, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bkkToday } from "@/lib/bkk-time"
import { swalError, swalToast } from "@/lib/swal"
import { STATUS_LABEL, branchChipCls, branchLabel, fmtNum, fontThai } from "@/components/tire/shared"
import { DUE_LABEL, dueBarCls, dueChipCls, type DueLevel } from "@/lib/tire-due"

const MAX_PHOTOS = 3

// ย่อรูปเหลือด้านยาว 1280px JPEG ก่อนส่ง — กติกาเดียวกับฟอร์มขอเปลี่ยนยางของหน้ารถรายคัน
function resizeImage(file: File, maxSize = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านรูปไม่สำเร็จ")) }
    img.src = url
  })
}

// ── โทนฟอร์ม ─────────────────────────────────────────────────────────────────
// 3 ชั้นที่ต้องแยกกันออกด้วยตา: พื้นหลังโมดัล (เทาเขียวจาง) → การ์ดแต่ละขั้น (ขาว ขอบอ่อน)
// → ช่องกรอก (ขาว ขอบเข้มกว่าการ์ด + เงาใน) · ช่องที่กำลังพิมพ์ = ขอบเขียวแบรนด์ + วงแสง
const label = "mb-1.5 block text-[12px] font-semibold text-[#14271C] dark:text-gray-200"
const field =
  "h-9 rounded-[9px] border border-[#BFCDC4] bg-white px-2.5 text-[13px] text-[#14271C] placeholder-[#93A39A] " +
  "shadow-[inset_0_1px_2px_rgba(20,39,28,.06)] outline-none transition-colors " +
  "hover:border-[#9FB3A7] focus:border-[#1B8C4B] focus:ring-[3px] focus:ring-[#1B8C4B]/15 " +
  "dark:border-white/20 dark:bg-[#0f1510] dark:text-white dark:hover:border-white/30 dark:focus:border-green-500"
const sectionCls = "rounded-[12px] border border-[#DCE5DF] bg-white shadow-[0_1px_2px_rgba(20,39,28,.05)] dark:border-white/10 dark:bg-[#151a10]"
const req = <span className="ml-0.5 text-red-600 dark:text-red-400">*</span>

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={sectionCls}>
      <header className="flex items-center gap-2 border-b border-[#E7EEE9] px-4 py-2.5 dark:border-white/8">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#14271C] text-[11px] font-bold text-white dark:bg-white dark:text-[#14271C]">{n}</span>
        <h3 className="text-[13.5px] font-semibold text-[#14271C] dark:text-white">{title}</h3>
        {hint && <span className="ml-auto text-[11px] text-[#7A8B81] dark:text-gray-400">{hint}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

type Vehicle = { branch: string; plate: string; fleetNo: string; fleet: string; plant: string; vehicleType: string; unit: "head" | "trailer" }

const MAX_SHOWN = 60

// สาเหตุชุดเดียวกับปุ่ม "ขอเปลี่ยนยางเส้นนี้" ในหน้ารถรายคัน (fleet-page REASON_OPTIONS)
const REASONS = ["หมดดอก", "ยางระเบิด", "ยางฉีก", "ยางบวม", "รถกินยาง", "เช็คสภาพยาง"]

// ยางปัจจุบันของรถจาก /api/tire-fleet/vehicle (เฉพาะช่องที่ใช้)
type Tire = {
  tirePosition: string; positionCode: string; positionName: string; product: string; serialNo: string
  mileageStart: number; usedDistance: number | null; treadMm: number
  due: { level: DueLevel; usedPct: number | null; kmUsed: number; specDistance: number } | null
  request: { itemStatus: string; requestStatus: string } | null
}
const LEVEL_RANK: Record<DueLevel, number> = { over: 4, due: 3, warn: 2, ok: 1, unknown: 0 }
const tireKey = (t: Tire) => `${t.positionCode || t.tirePosition}|${t.serialNo}`
// ต้องเปลี่ยนก่อน = ระดับหนักกว่า แล้ว % ใช้ไปมากกว่า · ไม่มีข้อมูลระยะไปท้าย
const byNeed = (a: Tire, b: Tire) =>
  LEVEL_RANK[b.due?.level ?? "unknown"] - LEVEL_RANK[a.due?.level ?? "unknown"]
  || (b.due?.usedPct ?? -1) - (a.due?.usedPct ?? -1)
  || a.positionCode.localeCompare(b.positionCode, "en", { numeric: true })

function TirePicker({ tires, loading, picked, onToggle, onPickDue }: {
  tires:     Tire[]
  loading:   boolean
  picked:    Set<string>
  onToggle:  (k: string) => void
  onPickDue: () => void
}) {
  if (loading) {
    return <p className="flex items-center justify-center gap-1.5 rounded-[10px] border border-[#D5E0D9] bg-[#F7FAF8] py-6 text-[12px] text-[#9AA8A0] dark:border-white/10"><RefreshCw size={12} className="animate-spin" /> กำลังโหลดยางของรถคันนี้...</p>
  }
  if (tires.length === 0) {
    return <p className="rounded-[10px] border border-dashed border-[#BFCDC4] bg-[#F7FAF8] py-4 text-center text-[12px] text-[#9AA8A0] dark:border-white/15">ไม่พบข้อมูลยางของรถคันนี้ — จองแบบไม่ระบุตำแหน่งได้ (เขียนตำแหน่งในหมายเหตุ)</p>
  }
  const dueCount = tires.filter((t) => !t.request && (t.due?.level === "over" || t.due?.level === "due")).length
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#BFCDC4] dark:border-white/15">
      <div className="flex items-center gap-2 border-b border-[#D5E0D9] bg-[#EEF4F0] px-2.5 py-1.5 text-[11px] font-medium text-[#3C4B42] dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
        <span>ยาง {tires.length} เส้น · เรียงจากต้องเปลี่ยนก่อน</span>
        {picked.size > 0 && <span className="font-semibold text-[#1B8C4B]">เลือก {picked.size} เส้น</span>}
        {dueCount > 0 && (
          <button type="button" onClick={onPickDue} className="ml-auto font-semibold text-[#1B8C4B] underline-offset-2 hover:underline">
            เลือกทุกเส้นที่เกิน/ถึงกำหนด ({dueCount})
          </button>
        )}
      </div>
      <div className="max-h-[248px] divide-y divide-[#F1F5F2] overflow-y-auto dark:divide-white/5">
        {tires.map((t) => {
          const k = tireKey(t)
          const on = picked.has(k)
          const lv = t.due?.level ?? "unknown"
          const pct = t.due?.usedPct
          const busy = !!t.request
          return (
            <label key={k}
              className={`flex items-center gap-2.5 border-l-[3px] px-2.5 py-1.5 ${on ? "border-l-[#1B8C4B] bg-[#ECF8F0] dark:bg-[#1B8C4B]/15" : "border-l-transparent"} ${busy ? "cursor-not-allowed bg-[#F7F8F7] opacity-60 dark:bg-white/2" : on ? "cursor-pointer" : "cursor-pointer hover:bg-[#F6FAF7] dark:hover:bg-white/4"}`}>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] ${on ? "border-[#1B8C4B] bg-[#1B8C4B] text-white" : "border-[#9FB3A7] bg-white dark:border-white/30 dark:bg-transparent"}`}>
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <input type="checkbox" className="sr-only" checked={on} disabled={busy} onChange={() => onToggle(k)} />
              <span className="w-[112px] shrink-0">
                <span className="rounded bg-[#F0FDF4] px-1 py-px font-mono text-[12px] font-bold text-[#1B8C4B] dark:bg-green-500/10 dark:text-green-400">{t.positionCode || "—"}</span>
                <span className="mt-0.5 block truncate text-[10.5px] text-[#6B7C72] dark:text-gray-400" title={t.positionName}>{t.positionName}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] text-[#14271C] dark:text-gray-200" title={t.product}>{t.product || "ไม่ระบุรุ่น"}</span>
                <span className="block truncate font-mono text-[10px] text-[#9AA8A0]">{t.serialNo || "—"}</span>
              </span>
              <span className="w-[128px] shrink-0">
                {pct == null ? (
                  <span className="text-[10.5px] text-[#9AA8A0]">{t.due?.kmUsed ? `${fmtNum(t.due.kmUsed)} กม. · ไม่มีระยะกำหนด` : "ไม่มีข้อมูลระยะ"}</span>
                ) : (
                  <>
                    <span className="flex items-baseline justify-between tabular-nums">
                      <b className="text-[12px] text-[#14271C] dark:text-white">{pct}%</b>
                      <span className="text-[9.5px] text-[#9AA8A0]">{fmtNum(t.due!.kmUsed)}/{fmtNum(t.due!.specDistance)}</span>
                    </span>
                    <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-[#EEF2F0] dark:bg-white/10">
                      <span className={`block h-full ${dueBarCls[lv]}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </span>
                  </>
                )}
              </span>
              <span className="w-[92px] shrink-0 text-right">
                {busy ? (
                  <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-300">มีคำขอแล้ว · {STATUS_LABEL[t.request!.itemStatus] ?? t.request!.itemStatus}</span>
                ) : (
                  <span className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[10.5px] font-semibold ${dueChipCls[lv]}`}>{DUE_LABEL[lv]}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ช่องเลือกรถแบบพิมพ์ค้นหา — ค้นได้ทั้งทะเบียน เบอร์รถ แพล้นท์ · ลูกศรขึ้น/ลง + Enter เลือก · Esc ปิด
function VehiclePicker({ vehicles, loading, value, onChange }: {
  vehicles: Vehicle[]
  loading:  boolean
  value:    Vehicle | null
  onChange: (v: Vehicle | null) => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return vehicles
    const all = vehicles.filter((v) => v.plate.toLowerCase().includes(n) || v.fleetNo.toLowerCase().includes(n) || v.plant.toLowerCase().includes(n))
    // ตรงหัวคำก่อน (พิมพ์ "T-008" ควรเจอ T-0080 ก่อน XT-0081)
    const head = (v: Vehicle) => (v.plate.toLowerCase().startsWith(n) || v.fleetNo.toLowerCase().startsWith(n) ? 0 : 1)
    return [...all].sort((a, b) => head(a) - head(b))
  }, [vehicles, q])
  const shown = matches.slice(0, MAX_SHOWN)

  const pick = (v: Vehicle) => { onChange(v); setQ(""); setOpen(false) }
  const scrollTo = (i: number) => listRef.current?.children[i]?.scrollIntoView({ block: "nearest" })

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-[9px] border border-[#1B8C4B] bg-[#ECF8F0] px-2.5 dark:bg-[#1B8C4B]/15">
        <span className="font-mono text-[13px] font-bold text-[#14271C] dark:text-white">{value.plate}</span>
        {value.fleetNo && <span className="font-mono text-[12px] text-[#6B7C72] dark:text-gray-400">{value.fleetNo}</span>}
        <span className={`rounded px-1 py-px text-[10px] font-semibold ${branchChipCls(value.branch)}`}>{branchLabel(value.branch)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#9AA8A0]">{value.plant}</span>
        <button type="button" aria-label="เปลี่ยนรถ" onClick={() => { onChange(null); setOpen(true) }}
          className="rounded p-0.5 text-[#9AA8A0] hover:bg-white hover:text-[#14271C] dark:hover:bg-white/10 dark:hover:text-white">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
      <input
        autoFocus
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); const i = Math.min(hi + 1, shown.length - 1); setHi(i); scrollTo(i) }
          else if (e.key === "ArrowUp") { e.preventDefault(); const i = Math.max(hi - 1, 0); setHi(i); scrollTo(i) }
          else if (e.key === "Enter" && open && shown[hi]) { e.preventDefault(); pick(shown[hi]) }
          else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        }}
        placeholder={loading ? "กำลังโหลดรายชื่อรถ..." : "พิมพ์ค้นหาทะเบียน / เบอร์รถ / แพล้นท์"}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={field + " w-full pl-8 pr-8"}
      />
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9AA8A0]" />
      {open && (
        <div ref={listRef} id={listId} role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[260px] overflow-y-auto rounded-[10px] border border-[#BFCDC4] bg-white p-1 shadow-[0_8px_24px_-8px_rgba(20,39,28,.25)] dark:border-white/10 dark:bg-[#151a10]">
          {loading ? (
            <p className="flex items-center justify-center gap-1.5 py-4 text-[12px] text-[#9AA8A0]"><RefreshCw size={12} className="animate-spin" /> กำลังโหลด...</p>
          ) : shown.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-[#9AA8A0]">ไม่พบรถ &quot;{q}&quot;</p>
          ) : shown.map((v, i) => (
            <button
              key={`${v.branch}|${v.plate}`}
              type="button"
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(v)}
              className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left ${i === hi ? "bg-[#F0FDF4] dark:bg-white/5" : ""}`}
            >
              <span className="w-[92px] shrink-0 font-mono text-[12.5px] font-bold text-[#14271C] dark:text-white">{v.plate}</span>
              <span className="w-[62px] shrink-0 font-mono text-[11.5px] text-[#6B7C72] dark:text-gray-400">{v.fleetNo || "—"}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[#9AA8A0]">
                {v.unit === "trailer" ? "หาง · " : ""}{v.plant || v.fleet || "—"}
              </span>
              <span className={`shrink-0 rounded px-1 py-px text-[9.5px] font-semibold ${branchChipCls(v.branch)}`}>{branchLabel(v.branch)}</span>
            </button>
          ))}
          {matches.length > MAX_SHOWN && (
            <p className="px-2 py-1.5 text-center text-[10.5px] text-[#9AA8A0]">แสดง {MAX_SHOWN} จาก {matches.length} คัน — พิมพ์เพิ่มเพื่อกรอง</p>
          )}
        </div>
      )}
    </div>
  )
}

export function BookingDialog({ open, onClose, onSaved, branches }: {
  open:     boolean
  onClose:  () => void
  onSaved:  () => void
  /** สาขาที่ผู้ใช้เห็นได้ — มีสาขาเดียวไม่ต้องเลือก */
  branches: string[]
}) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [list, setList]       = useState<{ key: string; items: Vehicle[] }>({ key: "", items: [] })
  const [tires, setTires]     = useState<{ key: string; items: Tire[]; odometer: number }>({ key: "", items: [], odometer: 0 })
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const [reason, setReason]   = useState("")
  const [odo, setOdo]         = useState("")
  const [tread, setTread]     = useState("")
  const [date, setDate]       = useState(bkkToday())
  const [note, setNote]       = useState("")
  const [photos, setPhotos]   = useState<string[]>([])
  const [saving, setSaving]   = useState(false)

  // รายชื่อรถโหลดตอนเปิดฟอร์มครั้งแรกของแต่ละชุดสาขา — สาขาเดียวขอเฉพาะสาขานั้น
  const listKey = branches.join(",")
  const listLoading = open && list.key !== listKey
  useEffect(() => {
    if (!open || list.key === listKey) return
    let cancelled = false
    const bs = listKey.split(",")
    const one = bs.length === 1 ? `?branch=${encodeURIComponent(bs[0])}` : ""
    fetch(`/api/tire-change-request/booking${one}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const items = (Array.isArray(d.items) ? d.items : []) as Vehicle[]
        setList({ key: listKey, items: items.filter((v) => bs.includes(v.branch)) })
      })
      .catch(() => { if (!cancelled) setList({ key: listKey, items: [] }) })
    return () => { cancelled = true }
  }, [open, listKey, list.key])

  // เลือกรถแล้วดึงยางทุกตำแหน่งของคันนั้น (พร้อม % ใช้ไป + คำขอที่ค้าง) — ตัวเดียวกับหน้ารถรายคัน
  const vKey = vehicle ? `${vehicle.branch}|${vehicle.plate}` : ""
  const tiresLoading = !!vehicle && tires.key !== vKey
  useEffect(() => {
    if (!vKey || tires.key === vKey) return
    let cancelled = false
    const [branch, plate] = vKey.split("|")
    fetch(`/api/tire-fleet/vehicle?${new URLSearchParams({ branch, plate })}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const items = ((Array.isArray(d?.current) ? d.current : []) as Tire[]).sort(byNeed)
        setTires({ key: vKey, items, odometer: Number(d?.odometer) || 0 })
        // เลขไมล์ตั้งต้นจากระบบ (คำขอล่าสุด/ประวัติ) — ยังแก้เองได้
        if (d?.odometer > 0) setOdo((o) => o || String(d.odometer))
      })
      .catch(() => { if (!cancelled) setTires({ key: vKey, items: [], odometer: 0 }) })
    return () => { cancelled = true }
  }, [vKey, tires.key])

  const pickVehicle = (v: Vehicle | null) => { setVehicle(v); setPicked(new Set()); setOdo("") }
  const togglePick = (k: string) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const pickDue = () => setPicked(new Set(
    tires.items.filter((t) => !t.request && (t.due?.level === "over" || t.due?.level === "due")).map(tireKey),
  ))

  const reset = () => {
    setVehicle(null); setPicked(new Set()); setReason(""); setOdo(""); setTread(""); setDate(bkkToday()); setNote(""); setPhotos([])
  }
  const close = () => { if (!saving) { reset(); onClose() } }

  async function addPhotos(files: FileList | null) {
    if (!files) return
    const room = MAX_PHOTOS - photos.length
    try {
      const next = await Promise.all([...files].slice(0, room).map((f) => resizeImage(f)))
      setPhotos((p) => [...p, ...next])
    } catch (e) {
      swalError((e as Error).message)
    }
  }

  async function submit() {
    if (!vehicle) { swalError("กรุณาเลือกรถ"); return }
    const chosen = tires.items.filter((t) => picked.has(tireKey(t)))
    if (tires.items.length > 0 && chosen.length === 0) { swalError("กรุณาเลือกยางที่จะเปลี่ยนอย่างน้อย 1 เส้น"); return }
    if (!reason) { swalError("กรุณาเลือกสาเหตุ"); return }
    if (!(Number(odo.replace(/,/g, "")) > 0)) { swalError("กรุณาระบุเลขไมล์"); return }
    setSaving(true)
    const res = await fetch("/api/tire-change-request/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle: vehicle.plate,
        branch: vehicle.branch,
        currentOdometer: odo,
        currentTreadMm: tread,
        reason,
        tires: chosen.map((t) => ({
          tirePosition: t.tirePosition, positionCode: t.positionCode, positionName: t.positionName,
          serialNo: t.serialNo, product: t.product, mileageStart: t.mileageStart, usedDistance: t.usedDistance ?? 0,
        })),
        // วันนัดเป็นเที่ยงวันเวลาไทย — ตัดเป็นวันที่แล้วไม่เลื่อนข้ามวันไม่ว่าเครื่องตั้ง timezone อะไร
        appointmentDate: `${date}T12:00:00+07:00`,
        note,
        photos,
      }),
    }).catch(() => null)
    setSaving(false)
    const d = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { swalError(d.error ?? "จองไม่สำเร็จ"); return }
    swalToast("success", `จองเปลี่ยนยาง ${d.plate}${d.truckNumber ? ` (${d.truckNumber})` : ""} ${fmtNum(d.items ?? 1)} เส้นแล้ว — รอเปลี่ยน`)
    reset()
    onSaved()
    onClose()
  }

  const reasonCls = (on: boolean) =>
    `h-8 rounded-[8px] border px-3 text-[12.5px] transition-colors ${on
      ? "border-[#1B8C4B] bg-[#1B8C4B] font-semibold text-white shadow-[0_1px_2px_rgba(27,140,75,.35)]"
      : "border-[#BFCDC4] bg-white text-[#2C3B32] hover:border-[#1B8C4B]/60 hover:bg-[#F3FAF5] dark:border-white/20 dark:bg-transparent dark:text-gray-200 dark:hover:bg-white/5"}`

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden bg-[#F1F5F2] p-0 sm:max-w-[700px] dark:bg-[#0b0f09]"
        style={fontThai}
      >
        {/* หัว: พื้นขาว แยกจากพื้นฟอร์มด้วยเส้นล่าง */}
        <DialogHeader className="shrink-0 border-b border-[#DCE5DF] bg-white px-6 py-4 text-left dark:border-white/10 dark:bg-[#151a10]">
          <DialogTitle className="flex items-center gap-2.5 text-[17px] text-[#14271C] dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#1B8C4B] text-white"><CalendarClock size={16} /></span>
            จองเปลี่ยนยาง
          </DialogTitle>
          <p className="mt-1 text-[12px] text-[#5B6C62] dark:text-gray-400">
            จองโดยแอดมิน ไม่ต้องกดอนุมัติ — บันทึกแล้วขึ้นสถานะ
            <span className="ml-1 inline-flex items-center rounded-md bg-purple-100 px-1.5 py-px text-[11px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">รอเปลี่ยน</span>
            <span className="ml-1">ทันที</span>
          </p>
        </DialogHeader>

        {/* เนื้อฟอร์ม: เลื่อนเฉพาะตรงนี้ หัว/ท้ายอยู่กับที่ */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <Section n={1} title="รถและยางที่จะเปลี่ยน" hint={vehicle ? "เรียงจากเส้นที่ต้องเปลี่ยนก่อน" : "ค้นจากทะเบียน / เบอร์รถ / แพล้นท์"}>
            <span className={label}>ทะเบียนรถ หรือ เบอร์รถ{req}</span>
            <VehiclePicker vehicles={list.items} loading={listLoading} value={vehicle} onChange={pickVehicle} />
            {vehicle && (
              <div className="mt-3.5">
                <span className={label}>ยางที่จะเปลี่ยน{req}</span>
                <TirePicker tires={tires.items} loading={tiresLoading} picked={picked} onToggle={togglePick} onPickDue={pickDue} />
              </div>
            )}
          </Section>

          <Section n={2} title="รายละเอียดการเปลี่ยน">
            <span className={label}>สาเหตุ{req}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="สาเหตุ">
              {REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={reasonCls(reason === r)}>
                  {r}
                </button>
              ))}
            </div>
            {reason === "รถกินยาง" && (
              <p className="mt-2 rounded-[8px] border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[11.5px] text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
                รถกินยาง: อย่าลืมเปิด MR ซ่อมช่วงล่างควบคู่ — ใบจองนี้อนุมัติในตัว ไม่รอ MR
              </p>
            )}

            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <span className={label}>เลขไมล์ (กม.){req}</span>
                <input value={odo} inputMode="numeric" onChange={(e) => setOdo(e.target.value.replace(/[^\d,]/g, ""))} placeholder="0"
                  className={field + " w-full text-right font-mono"} />
                {tires.odometer > 0 && odo === String(tires.odometer) && (
                  <span className="mt-1 block text-[10.5px] text-[#7A8B81]">ค่าจากระบบ · แก้ได้</span>
                )}
              </div>
              <div>
                <span className={label}>เลขมิลยาง (มม.)</span>
                <input value={tread} inputMode="decimal" onChange={(e) => setTread(e.target.value.replace(/[^\d.]/g, ""))} placeholder="—"
                  className={field + " w-full text-right font-mono"} />
              </div>
              <div>
                <span className={label}>วันนัดเปลี่ยน</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value || bkkToday())} className={field + " w-full"} />
              </div>
            </div>
          </Section>

          <Section n={3} title="รูปภาพและหมายเหตุ" hint={`ไม่บังคับ · รูปสูงสุด ${MAX_PHOTOS} รูป`}>
            <div className="flex flex-wrap gap-2">
              {photos.map((src, i) => (
                <span key={i} className="relative h-[72px] w-[72px] overflow-hidden rounded-[9px] border border-[#BFCDC4] dark:border-white/15">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label="ลบรูป" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 rounded-full bg-black/65 p-0.5 text-white hover:bg-black/85">
                    <X size={11} />
                  </button>
                </span>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label className="flex h-[72px] w-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[9px] border-[1.5px] border-dashed border-[#9FB3A7] bg-[#F7FAF8] text-[11px] font-medium text-[#3C4B42] transition-colors hover:border-[#1B8C4B] hover:bg-[#ECF8F0] hover:text-[#17793F] dark:border-white/25 dark:bg-white/3 dark:text-gray-300">
                  <ImagePlus size={17} /> เพิ่มรูป
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { addPhotos(e.target.files); e.target.value = "" }} />
                </label>
              )}
            </div>
            <span className={label + " mt-3.5"}>หมายเหตุ</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="เช่น อาการที่พบ / รายละเอียดเพิ่มเติม"
              className={field + " h-auto w-full resize-none py-2"} />
          </Section>
        </div>

        {/* ท้าย: สรุปสิ่งที่จะบันทึก + ปุ่ม — พื้นขาว ติดล่างเสมอ */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[#DCE5DF] bg-white px-6 py-3 dark:border-white/10 dark:bg-[#151a10]">
          <p className="min-w-0 flex-1 truncate text-[12px] text-[#5B6C62] dark:text-gray-400">
            {vehicle
              ? <>
                  <b className="font-mono text-[#14271C] dark:text-white">{vehicle.plate}</b>
                  {" · "}{picked.size > 0 ? `${picked.size} เส้น` : tires.items.length === 0 && !tiresLoading ? "ไม่ระบุตำแหน่ง" : "ยังไม่เลือกยาง"}
                  {reason ? ` · ${reason}` : ""}
                </>
              : "ยังไม่ได้เลือกรถ"}
          </p>
          <button type="button" onClick={close} disabled={saving}
            className="h-9 rounded-[9px] border border-[#BFCDC4] bg-white px-4 text-[13px] font-medium text-[#3C4B42] transition-colors hover:bg-[#F3F6F4] disabled:opacity-50 dark:border-white/20 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/5">
            ยกเลิก
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#1B8C4B] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(20,39,28,.2)] transition-colors hover:bg-[#17793F] disabled:opacity-50">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <CalendarClock size={13} />}
            {saving ? "กำลังบันทึก..." : "จองเปลี่ยนยาง"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
