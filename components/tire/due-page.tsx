"use client"

// ===========================================================================
// แท็บ "ยางถึงกำหนดเปลี่ยน"
// ===========================================================================
// แท็บอื่นของหน้ายางตอบว่า "ตอนนี้เกิดอะไรขึ้น" (รถคันไหนมียางอะไร ใครขอเปลี่ยน)
// แท็บนี้ตอบคำถามที่ต้องรู้ "ก่อน" ยางหมด: เส้นไหนใกล้ครบระยะที่กำหนดแล้วบ้าง
// เพื่อสั่งซื้อ/นัดเข้าอู่ทัน ไม่ใช่รอให้คนขับแจ้งตอนยางระเบิด
//
// ตัวเลขทั้งหน้ามาจาก snapshot `tire_distance` ที่คำนวณรอบกลางคืน (ดู lib/tire-distance.ts)
// ไม่ได้คำนวณสดตอนเปิดหน้า — ปุ่ม "คำนวณใหม่" มีไว้สำหรับตอนเพิ่งแก้ระยะกำหนดที่ /tire/master

import React, { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  AlertTriangle, BellOff, BellRing, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet,
  RefreshCw, Search, Settings2, Truck, Undo2,
} from "lucide-react"
import { bkkToday } from "@/lib/bkk-time"
import {
  downloadExcelTable, xlsDate, XLS_DATE_FMT, type ExcelCol,
} from "@/lib/excel-table"
import Swal from "sweetalert2"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  DUE_LABEL, SNOOZE_OPTIONS, SOURCE_LABEL, dueBarCls, dueChipCls, positionOrder,
  type DistanceSource, type DueLevel,
} from "@/lib/tire-due"
import {
  StatCard, branchChipCls, branchLabel, btnSmall, card,
  fmtDateOnly, fmtNum, fontThai, inp, tdCls, thCls, theadCls,
} from "@/components/tire/shared"

type DueRow = {
  _id:          string
  branch:       string
  plate:        string
  unit:         "head" | "trailer"
  serialNo:     string
  tirePosition: string
  product:      string
  changeIn:     string | null
  kmUsed:       number
  source:       DistanceSource
  partial:      boolean
  specDistance: number
  usedPct:      number | null
  level:        DueLevel
  snoozedUntil: string | null
  snoozedBy?:   string
  acceptedAt?:  string | null
  acceptedBy?:  string
  fleetNo:      string
  vehicleType:  string
}

// คอลัมน์ไฟล์ Excel — เรียงตามลำดับที่คนอ่านใช้จริง: รถคันไหน → ยางเส้นไหน → เหลืออีกเท่าไหร่
const EXPORT_COLS: ExcelCol[] = [
  { key: "branch",   header: "สาขา",            width: 11, group: "รถ", align: "center" },
  { key: "plate",    header: "ทะเบียน",          width: 13, group: "รถ" },
  { key: "fleetNo",  header: "เบอร์รถ",          width: 10, group: "รถ", align: "center" },
  { key: "type",     header: "ประเภทรถ",         width: 26, group: "รถ" },

  { key: "pos",      header: "ตำแหน่งยาง",       width: 26, group: "ยาง" },
  { key: "product",  header: "รุ่นยาง",           width: 26, group: "ยาง" },
  { key: "serial",   header: "Serial",          width: 18, group: "ยาง" },
  { key: "changeIn", header: "เปลี่ยนเข้า",       width: 12, group: "ยาง", align: "center", numFmt: XLS_DATE_FMT },

  { key: "kmUsed",   header: "วิ่งไปแล้ว\n(กม.)",  width: 12, group: "ระยะ", align: "right", numFmt: "#,##0" },
  { key: "spec",     header: "ระยะกำหนด\n(กม.)",  width: 12, group: "ระยะ", align: "right", numFmt: "#,##0" },
  { key: "pct",      header: "ใช้ไป\n(%)",        width: 9,  group: "ระยะ", align: "right", numFmt: "#,##0" },
  { key: "level",    header: "สถานะ",            width: 16, group: "ระยะ", align: "center" },
  { key: "source",   header: "แหล่งข้อมูล",       width: 13, group: "ระยะ", align: "center" },
  { key: "partial",  header: "ระยะไม่ครบ",       width: 11, group: "ระยะ", align: "center" },

  { key: "acceptBy", header: "รับเรื่องโดย",      width: 18, group: "การดำเนินการ" },
  { key: "acceptAt", header: "รับเรื่องเมื่อ",     width: 12, group: "การดำเนินการ", align: "center", numFmt: XLS_DATE_FMT },
  { key: "snoozeTo", header: "พักเตือนถึง",       width: 12, group: "การดำเนินการ", align: "center", numFmt: XLS_DATE_FMT },
  { key: "snoozeBy", header: "ผู้กดพัก",          width: 18, group: "การดำเนินการ" },
]

// สีตัวอักษรช่องสถานะให้ตรงกับชิปบนเว็บ
const LEVEL_INK: Record<string, string> = {
  over: "FFB91C1C", due: "FFC2410C", warn: "FFB45309", ok: "FF15803D", unknown: "FF6B7280",
}

// มุมมองรายคัน — คนวางแผนคิดเป็น "คัน" ไม่ใช่ "เส้น": รถคันนี้ต้องเข้าอู่ไหม เปลี่ยนกี่เส้น
type VehicleGroup = {
  branch:      string
  plate:       string
  fleetNo:     string
  vehicleType: string
  rows:        DueRow[]
  acceptedAt:  string | null
  acceptedBy:  string
  over:        number
  due:         number
  warn:        number
  maxPct:      number
}

type Summary = Record<string, number>
type Vehicles = { over: number; due: number; warn: number; alert: number }

// กลุ่มที่กดดูได้ — 3 กลุ่มแรกคือของที่ต้องลงมือ ที่เหลือเป็นของที่ยังใช้ไม่ได้/ไม่เกี่ยว
const GROUPS = [
  { key: "over",       label: "เกินกำหนด",          tone: "red"    as const, hint: "ใช้ระยะครบแล้ว ควรเปลี่ยนทันที" },
  { key: "due",        label: "ถึงกำหนดเปลี่ยน",     tone: "orange" as const, hint: "ใช้ไปแล้ว 90% ขึ้นไป วางแผนเปลี่ยนได้" },
  { key: "warn",       label: "เฝ้าระวัง",           tone: "amber"  as const, hint: "ใช้ไปแล้ว 80% ขึ้นไป" },
]

const OTHER_GROUPS = [
  { key: "nospec",     label: "ยังไม่ตั้งระยะกำหนด", hint: "รู้ระยะที่วิ่งแล้ว แต่รุ่นยางยังไม่มีระยะมาตรฐาน" },
  { key: "nodistance", label: "คำนวณระยะไม่ได้",    hint: "ไม่มีวันเปลี่ยนเข้า หรือทะเบียนไม่มีทั้ง GPS และค่าเที่ยว" },
  { key: "spare",      label: "ยางอะไหล่",          hint: "ยังไม่ได้ใช้งาน ไม่นับระยะ" },
  { key: "accepted",   label: "รับเรื่องแล้ว",        hint: "มีคนรับไปดำเนินการแล้ว — ยังนับอยู่ในที่ต้องจัดการ" },
  { key: "snoozed",    label: "พักการแจ้งเตือน",     hint: `เส้นที่กด "พักการแจ้งเตือน" ไว้` },
]

export function TireDuePage({ branchFilter, onOpenVehicle }: {
  branchFilter: string
  onOpenVehicle: (v: { branch: string; plate: string }) => void
}) {
  const [rows, setRows]       = useState<DueRow[]>([])
  const [summary, setSummary] = useState<Summary>({})
  const [vehicles, setVehicles] = useState<Vehicles>({ over: 0, due: 0, warn: 0, alert: 0 })
  const [meta, setMeta]       = useState<{ computedAt: string | null; dataThrough: string | null }>({ computedAt: null, dataThrough: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [group, setGroup]     = useState("alert")
  const [unit, setUnit]       = useState<"head" | "trailer" | "all">("all")
  const [q, setQ]             = useState("")
  const [view, setView]       = useState<"vehicle" | "tire">("vehicle")
  // บันทึกไว้ว่าใครกดเลื่อน — ยางที่ถูกเลื่อนซ้ำ ๆ ต้องตามตัวคนตัดสินใจได้
  const { data: session } = useSession()
  const me = [session?.user?.employee?.firstname, session?.user?.employee?.lastname]
    .filter(Boolean).join(" ") || session?.user?.employee?.username || session?.user?.email || ""
  const [opened, setOpened]   = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ group })
    if (branchFilter) qs.set("branch", branchFilter)
    if (unit !== "all") qs.set("unit", unit)
    if (q) qs.set("q", q)
    try {
      const d = await fetch(`/api/tire-due?${qs}`).then((r) => r.json())
      setRows(Array.isArray(d.items) ? d.items : [])
      setSummary(d.summary ?? {})
      setVehicles(d.vehicles ?? { over: 0, due: 0, warn: 0, alert: 0 })
      setMeta({ computedAt: d.computedAt ?? null, dataThrough: d.dataThrough ?? null })
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [branchFilter, group, unit, q])

  useEffect(() => { load() }, [load])

  async function recalc() {
    const { isConfirmed } = await swalConfirm(
      "คำนวณระยะใหม่?",
      "ดึงระยะทางล่าสุดจาก GPS และค่าเที่ยวมาคำนวณใหม่ทั้งฟลีต ใช้เวลาราว 1–2 นาที",
    )
    if (!isConfirmed) return
    setBusy(true)
    try {
      const res = await fetch("/api/tire-due", { method: "POST" })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error ?? "คำนวณไม่สำเร็จ")
      swalToast("success", `คำนวณเสร็จ ${fmtNum(d.computed)} เส้น`)
      await load()
    } catch (e) {
      swalError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ถามว่าจะพักนานแค่ไหน — คืน null = ยกเลิก
  async function askSnoozeDays(title: string, text: string): Promise<number | null> {
    const { value } = await Swal.fire({
      title, text,
      input: "radio",
      inputOptions: Object.fromEntries(SNOOZE_OPTIONS.map((o) => [o.days, o.label])),
      inputValue: String(SNOOZE_OPTIONS[1].days),
      showCancelButton: true,
      confirmButtonText: "พักการแจ้งเตือน",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#1B8C4B",
      customClass: { input: "text-left" },
    })
    return value ? Number(value) : null
  }

  // พักทั้งคัน — ถามยืนยันก่อนเพราะกระทบยางหลายเส้นพร้อมกัน
  // รับเรื่อง = มีคนรับไปดำเนินการแล้ว (ยางยังไม่ได้เปลี่ยน จึงยังนับอยู่ในที่ต้องจัดการ)
  async function acceptVehicle(g: VehicleGroup, on: boolean) {
    if (on && !me) { swalError("ไม่ทราบชื่อผู้ใช้ — ลองเข้าสู่ระบบใหม่"); return }
    const res = await fetch("/api/tire-due", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ plate: g.plate, branch: g.branch, accept: on, by: me }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalError(d.error ?? "บันทึกไม่สำเร็จ"); return }
    swalToast("success", on ? `รับเรื่อง ${g.plate} แล้ว (${fmtNum(d.tires)} เส้น)` : `ยกเลิกรับเรื่อง ${g.plate}`)
    load()
  }

  async function exportExcel() {
    // ส่งออกตามที่กรองอยู่บนหน้าจอเสมอ — ไฟล์ที่ได้จะตรงกับสิ่งที่เห็น ไม่ใช่ทั้งฟลีต
    // เรียงแบบเดียวกับมุมมองรายคัน (คันที่หนักสุดก่อน แล้วไล่ตามตำแหน่งล้อ) เพราะเอาไปสั่งงานช่างต่อ
    const ordered = view === "vehicle" ? groups.flatMap((g) => g.rows) : rows
    if (ordered.length === 0) { swalError("ไม่มีรายการให้ส่งออก"); return }

    const scope  = branchFilter ? branchLabel(branchFilter) : "ทุกสาขา"
    const gLabel = [...GROUPS, ...OTHER_GROUPS].find((g) => g.key === group)?.label ?? "ต้องจัดการ"
    const filters = [
      gLabel,
      scope,
      unit === "head" ? "เฉพาะหัว" : unit === "trailer" ? "เฉพาะหาง" : null,
      q ? `ค้นหา "${q}"` : null,
    ].filter(Boolean).join(" · ")

    const n = await downloadExcelTable({
      fileName:  `ยางถึงกำหนดเปลี่ยน_${scope}_${bkkToday()}.xlsx`,
      sheetName: "ยางถึงกำหนดเปลี่ยน",
      title:     `ยางถึงกำหนดเปลี่ยน — ${scope}`,
      subtitle:  `${filters} · ${fmtNum(ordered.length)} เส้น จากรถ ${fmtNum(new Set(ordered.map((r) => r.plate)).size)} คัน` +
                 ` · ข้อมูลระยะถึง ${fmtDateOnly(meta.dataThrough)} · ส่งออก ${fmtDateOnly(new Date().toISOString())} โดยระบบ MENA WMS`,
      freezeCols: 3,
      columns: EXPORT_COLS,
      rows: ordered.map((r) => {
        const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
        return {
          tone: r.level === "over" ? "danger" as const : r.level === "due" ? "warn" as const : undefined,
          ink:  { level: LEVEL_INK[r.level] },
          cells: {
            branch:   branchLabel(r.branch),
            plate:    r.plate,
            fleetNo:  r.fleetNo || "",
            type:     r.vehicleType || "",
            pos:      r.tirePosition,
            product:  r.product,
            serial:   r.serialNo,
            changeIn: xlsDate(r.changeIn),
            kmUsed:   r.kmUsed || null,
            spec:     r.specDistance || null,
            pct:      r.usedPct,
            level:    DUE_LABEL[r.level],
            source:   SOURCE_LABEL[r.source],
            partial:  r.partial ? "ไม่ครบ" : "",
            acceptBy: r.acceptedBy ?? "",
            acceptAt: xlsDate(r.acceptedAt),
            snoozeTo: snoozedOn ? xlsDate(r.snoozedUntil) : null,
            snoozeBy: snoozedOn ? (r.snoozedBy ?? "") : "",
          },
        }
      }),
    })
    swalToast("success", `ส่งออก ${fmtNum(n)} รายการ`)
  }

  async function snoozeVehicle(g: { branch: string; plate: string; rows: DueRow[] }, on: boolean) {
    let days: number | null = null
    if (on) {
      days = await askSnoozeDays(
        `พักการแจ้งเตือน ${g.plate}`,
        `ยางทุกเส้นของคันนี้ (${g.rows.length} เส้น) จะเงียบไปตามที่เลือก แล้วกลับมาเตือนเองถ้ายังไม่ได้เปลี่ยน`,
      )
      if (!days) return
    }
    const res = await fetch("/api/tire-due", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ plate: g.plate, branch: g.branch, snooze: on, days, by: me }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalError(d.error ?? "บันทึกไม่สำเร็จ"); return }
    swalToast("success", on ? `พัก ${g.plate} ไป ${d.snoozeDays} วัน (${fmtNum(d.tires)} เส้น)` : `เปิดการแจ้งเตือน ${g.plate} อีกครั้ง`)
    load()
  }

  async function snooze(row: DueRow, on: boolean) {
    let days: number | null = null
    if (on) {
      days = await askSnoozeDays("พักการแจ้งเตือนยางเส้นนี้", `${row.plate} · ${row.tirePosition}`)
      if (!days) return
    }
    const res = await fetch(`/api/tire-due/${row._id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ snooze: on, days, by: me }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { swalError("บันทึกไม่สำเร็จ"); return }
    swalToast("success", on ? `พักการแจ้งเตือน ${d.snoozeDays} วัน` : "เปิดการแจ้งเตือนอีกครั้ง")
    load()
  }

  const alertTotal = (summary.over ?? 0) + (summary.due ?? 0)
  const showPct    = group !== "nodistance" && group !== "nospec"

  const groups = useMemo<VehicleGroup[]>(() => {
    const m = new Map<string, VehicleGroup>()
    for (const r of rows) {
      const key = `${r.branch}|${r.plate}`
      let g = m.get(key)
      if (!g) {
        g = { branch: r.branch, plate: r.plate, fleetNo: r.fleetNo ?? "", vehicleType: r.vehicleType ?? "",
              rows: [], acceptedAt: null, acceptedBy: "", over: 0, due: 0, warn: 0, maxPct: 0 }
        m.set(key, g)
      }
      // ยางของคันเดียวกันบางเส้นอาจเก็บเบอร์รถไม่ครบ — เอาค่าแรกที่เจอ
      if (!g.fleetNo     && r.fleetNo)     g.fleetNo     = r.fleetNo
      if (!g.vehicleType && r.vehicleType) g.vehicleType = r.vehicleType
      // รับเรื่องทีเดียวทั้งคัน — เส้นไหนมีข้อมูลก็ใช้ของเส้นนั้นแทนทั้งคันได้
      if (!g.acceptedAt && r.acceptedAt) { g.acceptedAt = r.acceptedAt; g.acceptedBy = r.acceptedBy ?? "" }
      g.rows.push(r)
      if (r.level === "over") g.over++
      else if (r.level === "due") g.due++
      else if (r.level === "warn") g.warn++
      if ((r.usedPct ?? 0) > g.maxPct) g.maxPct = r.usedPct ?? 0
    }
    for (const g of m.values()) g.rows.sort((a, b) => positionOrder(a.tirePosition) - positionOrder(b.tirePosition))
    return [...m.values()].sort(
      (a, b) => b.over - a.over || b.due - a.due || b.maxPct - a.maxPct || a.plate.localeCompare(b.plate, "th"),
    )
  }, [rows])

  const toggleOpen = (key: string) =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div>
      {/* แถบบอกความสดของข้อมูล — ตัวเลขทั้งหน้ามาจาก snapshot ต้องรู้ว่าเก่าแค่ไหน */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[#6B7C72] dark:text-gray-400" style={fontThai}>
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-[#E8A317]" />
          ระยะทางจาก GPS ก่อน ถ้าไม่มีใช้ค่าเที่ยว — เทียบกับระยะที่กำหนดของรุ่นยาง
        </span>
        {meta.dataThrough && <span>ข้อมูลระยะถึง {fmtDateOnly(meta.dataThrough)}</span>}
        {meta.computedAt  && <span>คำนวณล่าสุด {fmtDateOnly(meta.computedAt)}</span>}
        <button type="button" onClick={recalc} disabled={busy}
          className={btnSmall + " ml-auto inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10 text-[#14271C] dark:text-white disabled:opacity-50"}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          {busy ? "กำลังคำนวณ..." : "คำนวณใหม่"}
        </button>
      </div>

      {/* การ์ดสรุป — คลิกเพื่อกรอง */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="ต้องจัดการ" value={fmtNum(alertTotal)} tone="red"
          caption={`เส้น · ${fmtNum(vehicles.alert)} คัน`} sub="เกิน + ถึงกำหนด"
          active={group === "alert"} onClick={() => setGroup("alert")}
        />
        {GROUPS.map((g) => (
          <StatCard
            key={g.key} label={g.label} value={fmtNum(summary[g.key] ?? 0)} tone={g.tone}
            caption={`เส้น · ${fmtNum(vehicles[g.key as keyof Vehicles] ?? 0)} คัน`} sub={g.hint}
            active={group === g.key} onClick={() => setGroup(g.key)}
          />
        ))}
      </div>

      {/* กลุ่มรอง — ของที่ยังคำนวณไม่ได้ / ไม่เกี่ยว */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {OTHER_GROUPS.map((g) => (
          <button
            key={g.key} type="button" title={g.hint} onClick={() => setGroup(g.key)}
            className={[
              "rounded-[9px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              group === g.key
                ? "border-[#14271C]/25 bg-[#F6FAF7] text-[#14271C] dark:border-white/25 dark:bg-white/5 dark:text-white"
                : "border-[#EEF2F0] text-[#6B7C72] hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5",
            ].join(" ")}
            style={fontThai}
          >
            {g.label} <span className="text-[#9AA8A0]">{fmtNum(summary[g.key] ?? 0)}</span>
          </button>
        ))}
        {group === "nospec" && (
          <Link href="/tire/master" className={btnSmall + " inline-flex items-center gap-1 bg-[#1B8C4B] text-white"} style={fontThai}>
            <Settings2 size={11} /> ไปตั้งระยะกำหนด
          </Link>
        )}
      </div>

      {/* ตัวกรอง */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "all",     label: "ทั้งหมด" },
            { key: "head",    label: "หัว" },
            { key: "trailer", label: "หาง" },
          ] as const).map((o) => (
            <button
              key={o.key} type="button" onClick={() => setUnit(o.key)}
              className={[
                "rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                unit === o.key ? "bg-[#1B8C4B] text-white" : "text-[#6B7C72] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#151a10] p-0.5">
          {([
            { key: "vehicle", label: "รายคัน" },
            { key: "tire",    label: "รายเส้น" },
          ] as const).map((o) => (
            <button
              key={o.key} type="button" onClick={() => setView(o.key)}
              className={[
                "rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                view === o.key ? "bg-[#14271C] dark:bg-white text-white dark:text-gray-900" : "text-[#6B7C72] dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {o.label}
            </button>
          ))}
        </div>

        <button type="button" onClick={exportExcel}
          className={btnSmall + " inline-flex items-center gap-1.5 border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 text-[12px] text-[#14271C] dark:text-white"}
          style={fontThai}>
          <FileSpreadsheet size={12} className="text-[#1B8C4B]" /> Excel
        </button>

        <div className="relative ml-auto min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / เบอร์รถ..." className={inp + " w-full pl-8"} />
        </div>
      </div>

      {view === "vehicle" ? (
        <VehicleTable
          groups={groups} opened={opened} onToggle={toggleOpen} loading={loading}
          onOpenVehicle={onOpenVehicle} onSnooze={snooze} onSnoozeVehicle={snoozeVehicle}
          onAcceptVehicle={acceptVehicle} snoozedView={group === "snoozed"}
        />
      ) : (
        <TireTable
          rows={rows} showPct={showPct} loading={loading}
          onOpenVehicle={onOpenVehicle} onSnooze={snooze}
        />
      )}

      {rows.length >= 1000 && (
        <p className="mt-2 text-[11px] text-[#9AA8A0]" style={fontThai}>
          แสดง 1,000 แถวแรก — ใช้ตัวกรองสาขา/หัว-หาง หรือค้นหาทะเบียนเพื่อดูให้แคบลง
        </p>
      )}
    </div>
  )
}


// ── ตาราง "รายเส้น" — 1 แถว = ยาง 1 เส้น ────────────────────────────────────
function TireTable({ rows, showPct, loading, onOpenVehicle, onSnooze }: {
  rows:          DueRow[]
  showPct:       boolean
  loading:       boolean
  onOpenVehicle: (v: { branch: string; plate: string }) => void
  onSnooze:      (row: DueRow, on: boolean) => void
}) {
  return (
    <div className={card + " overflow-hidden"}>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full">
                <thead className={theadCls}>
                  <tr>
                    <th className={thCls} style={fontThai}>ทะเบียน</th>
                    <th className={thCls} style={fontThai}>ตำแหน่ง</th>
                    <th className={thCls} style={fontThai}>รุ่นยาง</th>
                    <th className={thCls} style={fontThai}>เปลี่ยนเข้า</th>
                    <th className={thCls + " text-right"} style={fontThai}>วิ่งไปแล้ว</th>
                    <th className={thCls + " text-right"} style={fontThai}>ระยะกำหนด</th>
                    {showPct && <th className={thCls} style={fontThai}>ใช้ไป</th>}
                    <th className={thCls} style={fontThai}>แหล่ง</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F0] dark:divide-white/8">
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>ไม่มีรายการในกลุ่มนี้</td></tr>
                  ) : rows.map((r) => {
                    const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                    return (
                      <tr key={r._id} className={"hover:bg-[#F6FAF7] dark:hover:bg-white/5" + (snoozedOn ? " opacity-55" : "")}>
                        <td className={tdCls}>
                          <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                            className="inline-flex items-center gap-1.5 font-semibold text-[#14271C] dark:text-white hover:text-[#1B8C4B]">
                            <Truck size={12} className="text-[#9AA8A0]" />
                            {r.plate}
                          </button>
                          <span className={`ml-1.5 rounded px-1 py-0.5 text-[9.5px] ${branchChipCls(r.branch)}`} style={fontThai}>
                            {branchLabel(r.branch)}
                          </span>
                        </td>
                        <td className={tdCls} style={fontThai}>{r.tirePosition || "—"}</td>
                        <td className={tdCls + " max-w-[240px] truncate"} style={fontThai} title={`${r.product}${r.serialNo ? ` · ${r.serialNo}` : ""}`}>
                          {r.product || "—"}
                          {r.serialNo && <span className="ml-1.5 font-mono text-[10.5px] text-[#9AA8A0]">{r.serialNo}</span>}
                        </td>
                        <td className={tdCls}>{fmtDateOnly(r.changeIn)}</td>
                        <td className={tdCls + " text-right font-mono"}>{r.kmUsed ? fmtNum(r.kmUsed) : "—"}</td>
                        <td className={tdCls + " text-right font-mono"}>{r.specDistance ? fmtNum(r.specDistance) : "—"}</td>
                        {showPct && (
                          <td className={tdCls}>
                            {r.usedPct == null ? "—" : (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EEF2F0] dark:bg-white/10">
                                  <div className={`h-full rounded-full ${dueBarCls[r.level]}`} style={{ width: `${Math.min(100, r.usedPct)}%` }} />
                                </div>
                                <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${dueChipCls[r.level]}`}>
                                  {r.usedPct}%
                                </span>
                              </div>
                            )}
                          </td>
                        )}
                        <td className={tdCls} style={fontThai}>
                          {SOURCE_LABEL[r.source]}
                          {/* ยางที่ใส่ก่อนวันที่ต้นทางเริ่มเก็บข้อมูล = ระยะที่ได้ต่ำกว่าจริง ต้องบอกไว้ */}
                          {r.partial && <span className="ml-1 text-[10px] text-[#E8A317]" title="ยางใส่ก่อนช่วงที่มีข้อมูล — ระยะจริงมากกว่านี้">(ไม่ครบ)</span>}
                        </td>
                        <td className={tdCls + " text-right"}>
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => onSnooze(r, !snoozedOn)}
                              title={snoozedOn ? "เปิดการแจ้งเตือนอีกครั้ง" : "พักการแจ้งเตือน"}
                              className={btnSmall + " inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10"}>
                              {snoozedOn ? <BellRing size={11} /> : <BellOff size={11} />}
                            </button>
                            <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                              className={btnSmall + " inline-flex items-center gap-0.5 border border-[#EEF2F0] dark:border-white/10 text-[#1B8C4B]"}
                              style={fontThai}>
                              เปิดหน้ารถ <ChevronRight size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
  )
}

// ── ตาราง "รายคัน" — 1 แถว = รถ 1 คัน กางดูยางรายเส้นได้ ───────────────────
// คนวางแผนสั่งซื้อ/จัดคิวเข้าอู่คิดเป็นคัน: คันนี้ต้องเปลี่ยนกี่เส้น ไม่ใช่ไล่อ่านทีละเส้น
function VehicleTable({ groups, opened, onToggle, loading, onOpenVehicle, onSnooze, onSnoozeVehicle, onAcceptVehicle, snoozedView }: {
  groups:          VehicleGroup[]
  opened:          Set<string>
  onToggle:        (key: string) => void
  loading:         boolean
  onOpenVehicle:   (v: { branch: string; plate: string }) => void
  onSnooze:        (row: DueRow, on: boolean) => void
  onSnoozeVehicle: (g: VehicleGroup, on: boolean) => void
  onAcceptVehicle: (g: VehicleGroup, on: boolean) => void
  snoozedView:     boolean
}) {
  return (
    <div className={card + " overflow-hidden"}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full">
          <thead className={theadCls}>
            <tr>
              <th className={thCls} style={fontThai}>ทะเบียน</th>
              <th className={thCls} style={fontThai}>เบอร์รถ</th>
              <th className={thCls} style={fontThai}>ประเภทรถ</th>
              <th className={thCls} style={fontThai}>ยางที่ต้องเปลี่ยน</th>
              <th className={thCls} style={fontThai}>ใช้ไปมากสุด</th>
              <th className={thCls} style={fontThai}>รับเรื่อง</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF2F0] dark:divide-white/8">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>ไม่มีรายการในกลุ่มนี้</td></tr>
            ) : groups.map((g) => {
              const key    = `${g.branch}|${g.plate}`
              const isOpen = opened.has(key)
              const level  = g.over > 0 ? "over" : g.due > 0 ? "due" : g.warn > 0 ? "warn" : "ok"
              return (
                <React.Fragment key={key}>
                  <tr className="cursor-pointer hover:bg-[#F6FAF7] dark:hover:bg-white/5" onClick={() => onToggle(key)}>
                    <td className={tdCls}>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#14271C] dark:text-white">
                        {isOpen ? <ChevronDown size={13} className="text-[#9AA8A0]" /> : <ChevronRight size={13} className="text-[#9AA8A0]" />}
                        {g.plate}
                      </span>
                      <span className={`ml-1.5 rounded px-1 py-0.5 text-[9.5px] ${branchChipCls(g.branch)}`} style={fontThai}>
                        {branchLabel(g.branch)}
                      </span>
                    </td>
                    <td className={tdCls + " font-mono text-[#14271C] dark:text-white"}>{g.fleetNo || "—"}</td>
                    <td className={tdCls + " max-w-[220px] truncate"} style={fontThai} title={g.vehicleType}>{g.vehicleType || "—"}</td>
                    <td className={tdCls}>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-semibold text-[#14271C] dark:text-white">{fmtNum(g.rows.length)} เส้น</span>
                        {g.over > 0 && <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${dueChipCls.over}`} style={fontThai}>เกิน {g.over}</span>}
                        {g.due  > 0 && <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${dueChipCls.due}`}  style={fontThai}>ถึงกำหนด {g.due}</span>}
                        {g.warn > 0 && <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${dueChipCls.warn}`} style={fontThai}>เฝ้าระวัง {g.warn}</span>}
                      </div>
                    </td>
                    <td className={tdCls}>
                      {g.maxPct > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#EEF2F0] dark:bg-white/10">
                            <div className={`h-full rounded-full ${dueBarCls[level]}`} style={{ width: `${Math.min(100, g.maxPct)}%` }} />
                          </div>
                          <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${dueChipCls[level]}`}>{g.maxPct}%</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className={tdCls}>
                      {g.acceptedAt ? (
                        <span className="inline-flex flex-col leading-tight" style={fontThai}>
                          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#1B8C4B]">
                            <CheckCircle2 size={12} /> {g.acceptedBy || "รับเรื่องแล้ว"}
                          </span>
                          <span className="text-[10px] text-[#9AA8A0]">{fmtDateOnly(g.acceptedAt)}</span>
                        </span>
                      ) : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onAcceptVehicle(g, true) }}
                          className={btnSmall + " inline-flex items-center gap-1 border border-[#1B8C4B]/30 text-[#1B8C4B] hover:bg-[#F0FDF4]"}
                          style={fontThai}>
                          <CheckCircle2 size={11} /> รับเรื่อง
                        </button>
                      )}
                    </td>
                    <td className={tdCls + " text-right"}>
                      <div className="flex items-center justify-end gap-1">
                        {g.acceptedAt && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onAcceptVehicle(g, false) }}
                            title="ยกเลิกรับเรื่อง"
                            className={btnSmall + " inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10"}>
                            <Undo2 size={11} />
                          </button>
                        )}
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSnoozeVehicle(g, !snoozedView) }}
                          title={snoozedView ? "เปิดการแจ้งเตือนทั้งคัน" : "พักการแจ้งเตือนทั้งคัน"}
                          className={btnSmall + " inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10"}
                          style={fontThai}>
                          {snoozedView ? <BellRing size={11} /> : <BellOff size={11} />}
                          {snoozedView ? "เปิดเตือน" : "พักทั้งคัน"}
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenVehicle({ branch: g.branch, plate: g.plate }) }}
                          className={btnSmall + " inline-flex items-center gap-0.5 border border-[#EEF2F0] dark:border-white/10 text-[#1B8C4B]"}
                          style={fontThai}>
                          เปิดหน้ารถ <ChevronRight size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isOpen && g.rows.map((r) => {
                    const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                    return (
                      <tr key={r._id} className={"bg-[#FAFCFB] dark:bg-white/[0.02]" + (snoozedOn ? " opacity-55" : "")}>
                        <td className={tdCls + " pl-8"} style={fontThai}>{r.tirePosition || "—"}</td>
                        <td className={tdCls + " max-w-[200px] truncate"} style={fontThai} title={`${r.product} ${r.serialNo}`} colSpan={2}>
                          {r.product || "—"}
                          {r.serialNo && <span className="ml-1.5 font-mono text-[10.5px] text-[#9AA8A0]">{r.serialNo}</span>}
                        </td>
                        <td className={tdCls} style={fontThai}>
                          เปลี่ยนเข้า {fmtDateOnly(r.changeIn)} · วิ่ง <span className="font-mono">{fmtNum(r.kmUsed)}</span>
                          {r.specDistance > 0 && <> / <span className="font-mono">{fmtNum(r.specDistance)}</span></>} กม.
                          <span className="ml-1.5 text-[#9AA8A0]">{SOURCE_LABEL[r.source]}{r.partial ? " (ไม่ครบ)" : ""}</span>
                        </td>
                        <td className={tdCls}>
                          {r.usedPct == null ? "—" : (
                            <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${dueChipCls[r.level]}`}>{r.usedPct}%</span>
                          )}
                        </td>
                        <td className={tdCls + " text-right"}>
                          <button type="button" onClick={() => onSnooze(r, !snoozedOn)}
                            title={snoozedOn ? "เปิดการแจ้งเตือนอีกครั้ง" : "พักการแจ้งเตือน"}
                            className={btnSmall + " inline-flex items-center gap-1 border border-[#EEF2F0] dark:border-white/10"}>
                            {snoozedOn ? <BellRing size={11} /> : <BellOff size={11} />}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
