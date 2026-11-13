"use client"

// ===========================================================================
// แท็บ "ยางถึงกำหนดเปลี่ยน"
// ===========================================================================
// แท็บอื่นของหน้ายางตอบว่า "ตอนนี้เกิดอะไรขึ้น" (รถคันไหนมียางอะไร ใครขอเปลี่ยน)
// แท็บนี้ตอบคำถามที่ต้องรู้ "ก่อน" ยางหมด: เส้นไหนใกล้ครบระยะที่กำหนดแล้วบ้าง
// เพื่อสั่งซื้อ/นัดเข้าอู่ทัน ไม่ใช่รอให้คนขับแจ้งตอนยางระเบิด
//
// ตัวเลขทั้งหน้ามาจาก snapshot `tire_distance` ที่คำนวณรอบกลางคืน (ดู lib/tire-distance.ts)
// ไม่ได้คำนวณสดตอนเปิดหน้า — ปุ่ม "คำนวณระยะทาง GPS ใหม่" มีไว้สำหรับตอนเพิ่งแก้ระยะกำหนดที่ /tire/master

import React, { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  ArrowUpRight, BellOff, BellRing, CheckCircle2, ChevronDown, CloudDownload, ChevronRight, ChevronsUpDown,
  FileSpreadsheet, LayoutDashboard, RefreshCw, Search, Settings2, Truck, Undo2,
} from "lucide-react"
import { bkkToday } from "@/lib/bkk-time"
import {
  downloadExcelTable, xlsDate, XLS_DATE_FMT, type ExcelCol,
} from "@/lib/excel-table"
import Swal from "sweetalert2"
import { askAtmsAuth } from "@/lib/atms-auth-dialog"
import { swalConfirm, swalError, swalToast } from "@/lib/swal"
import {
  DUE_LABEL, SNOOZE_OPTIONS, SOURCE_LABEL, dueBarCls, dueChipCls, positionOrder,
  type DistanceSource, type DueLevel,
} from "@/lib/tire-due"
import {
  FreshnessBar, IconAction, RowMenu, oldestTime, branchChipCls, branchLabel, branchesFor, btnSmall, card,
  fmtDateOnly, fmtNum, fontHead, fontThai, freshBtn, inp, tdCls, thCls, theadCls,
} from "@/components/tire/shared"
import {
  ColHead, useColFilter, type ColHeadCtx, type FacetDef, type SortDef,
} from "@/components/tire/col-filter"
import { TireDueDashboard } from "@/components/tire/due-dashboard"

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
  fleet:        string
  plant:        string
}

// คอลัมน์ไฟล์ Excel — เรียงตามลำดับที่คนอ่านใช้จริง: รถคันไหน → ยางเส้นไหน → เหลืออีกเท่าไหร่
const EXPORT_COLS: ExcelCol[] = [
  { key: "branch",   header: "สาขา",            width: 11, group: "รถ", align: "center" },
  { key: "plate",    header: "ทะเบียน",          width: 13, group: "รถ" },
  { key: "fleetNo",  header: "เบอร์รถ",          width: 10, group: "รถ", align: "center" },
  { key: "fleet",    header: "ฟลีท",             width: 14, group: "รถ" },
  { key: "plant",    header: "แพล้นท์",           width: 18, group: "รถ" },
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
  fleet:       string
  plant:       string
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
  { key: "over",       label: "เกินกำหนด",          hint: "ใช้ระยะครบแล้ว ควรเปลี่ยนทันที" },
  { key: "due",        label: "ถึงกำหนดเปลี่ยน",     hint: "ใช้ไปแล้ว 90% ขึ้นไป วางแผนเปลี่ยนได้" },
  { key: "warn",       label: "เฝ้าระวัง",           hint: "ใช้ไปแล้ว 80% ขึ้นไป" },
]

const OTHER_GROUPS = [
  { key: "nospec",     label: "ยังไม่ตั้งระยะกำหนด", hint: "รู้ระยะที่วิ่งแล้ว แต่รุ่นยางยังไม่มีระยะมาตรฐาน" },
  { key: "spare",      label: "ยางอะไหล่",          hint: "ยังไม่ได้ใช้งาน ไม่นับระยะ" },
  { key: "accepted",   label: "รับเรื่องแล้ว",        hint: "มีคนรับไปดำเนินการแล้ว — ยังนับอยู่ในที่ต้องจัดการ" },
  { key: "snoozed",    label: "พักการแจ้งเตือน",     hint: `เส้นที่กด "พักการแจ้งเตือน" ไว้` },
]

// ── เรียง/กรองจากหัวคอลัมน์ (แบบเดียวกับแท็บคำขอ V.2) ─────────────────────────
// ค่าที่ให้ติ๊กต้องเป็นข้อความเดียวกับที่เห็นในเซลล์ — ค่าว่างจึงตั้งชื่อให้ติ๊กได้
const vehicleLevel = (g: VehicleGroup): DueLevel =>
  g.over > 0 ? "over" : g.due > 0 ? "due" : g.warn > 0 ? "warn" : "ok"

const VEHICLE_FACETS: Record<string, FacetDef<VehicleGroup>> = {
  plate:   { label: "ทะเบียน",  value: (g) => g.plate || "—" },
  fleetNo: { label: "เบอร์รถ",  value: (g) => g.fleetNo || "ไม่ระบุเบอร์รถ" },
  fleet:   { label: "ฟลีท",     value: (g) => g.fleet || "ไม่ระบุฟลีท" },
  plant:   { label: "แพล้นท์",   value: (g) => g.plant || "ไม่ระบุแพล้นท์" },
  type:    { label: "ประเภทรถ", value: (g) => g.vehicleType || "ไม่ระบุประเภท" },
  level:   { label: "ระดับ",     value: (g) => DUE_LABEL[vehicleLevel(g)] },
  accept:  { label: "รับเรื่อง",  value: (g) => g.acceptedAt ? (g.acceptedBy || "รับเรื่องแล้ว") : "ยังไม่รับเรื่อง" },
}

const VEHICLE_SORTS: Record<string, SortDef<VehicleGroup>> = {
  plate:   (g) => g.plate,
  fleetNo: (g) => g.fleetNo,
  fleet:   (g) => g.fleet,
  plant:   (g) => g.plant,
  type:    (g) => g.vehicleType,
  tires:   (g) => g.rows.length,
  maxPct:  (g) => g.maxPct,
  accept:  (g) => g.acceptedAt ? new Date(g.acceptedAt).getTime() : 0,
}

const TIRE_FACETS: Record<string, FacetDef<DueRow>> = {
  plate:    { label: "ทะเบียน",   value: (r) => r.plate || "—" },
  position: { label: "ตำแหน่ง",   value: (r) => r.tirePosition || "ไม่ระบุตำแหน่ง" },
  product:  { label: "รุ่นยาง",    value: (r) => r.product || "ไม่ระบุรุ่น" },
  level:    { label: "ระดับ",      value: (r) => DUE_LABEL[r.level] },
  source:   { label: "แหล่ง",      value: (r) => SOURCE_LABEL[r.source] + (r.partial ? " (ไม่ครบ)" : "") },
}

const TIRE_SORTS: Record<string, SortDef<DueRow>> = {
  plate:    (r) => r.plate,
  position: (r) => positionOrder(r.tirePosition),
  product:  (r) => r.product,
  changeIn: (r) => r.changeIn ? new Date(r.changeIn).getTime() : 0,
  kmUsed:   (r) => r.kmUsed || 0,
  spec:     (r) => r.specDistance || 0,
  pct:      (r) => r.usedPct ?? -1,
}

export function TireDuePage({ branchFilter, onOpenVehicle }: {
  branchFilter: string
  onOpenVehicle: (v: { branch: string; plate: string }) => void
}) {
  const [rows, setRows]       = useState<DueRow[]>([])
  const [summary, setSummary] = useState<Summary>({})
  const [vehicles, setVehicles] = useState<Vehicles>({ over: 0, due: 0, warn: 0, alert: 0 })
  const [meta, setMeta]       = useState<{
    computedAt: string | null; dataThrough: string | null; atms: { branch: string; syncedAt: string | null }[]
  }>({ computedAt: null, dataThrough: null, atms: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [group, setGroup]     = useState("alert")
  const [unit, setUnit]       = useState<"head" | "trailer" | "all">("all")
  const [q, setQ]             = useState("")
  const [view, setView]       = useState<"vehicle" | "tire" | "dashboard">("vehicle")
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
      setMeta({ computedAt: d.computedAt ?? null, dataThrough: d.dataThrough ?? null, atms: Array.isArray(d.atms) ? d.atms : [] })
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

  // ดึงประวัติเปลี่ยนยางล่าสุดจาก ATMS ทีละสาขา แล้วคำนวณระยะใหม่ครั้งเดียวตอนสาขาสุดท้าย
  // ไม่งั้นเปลี่ยนยางเสร็จแล้วแท็บนี้ยังค้างยางชุดเก่าจนถึง cron รอบถัดไป
  async function syncAtms() {
    const branches = branchesFor(branchFilter)
    const { isConfirmed } = await swalConfirm(
      "ดึงข้อมูลจาก ATMS?",
      `อัปเดตประวัติเปลี่ยนยาง${branches.map(branchLabel).join(" + ")} แล้วคำนวณระยะใหม่ทั้งฟลีต ใช้เวลาราว 1–2 นาที`,
    )
    if (!isConfirmed) return
    let phpsessid: string | undefined
    let count = 0
    try {
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i]
        setSyncing(b)
        const post = () => fetch("/api/tire-change/sync", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ branch: b, rebuild: i === branches.length - 1, ...(phpsessid ? { phpsessid } : {}) }),
        })
        let res = await post()
        // ยังไม่ผูก/รหัสเปลี่ยน → กรอกบัญชี ATMS ครั้งเดียว (หรือวาง PHPSESSID แทน) แล้วลองใหม่ จนสำเร็จหรือกดยกเลิก
        while (res.status === 401) {
          const next = await askAtmsAuth(await res.json().catch(() => ({})))
          if (!next) return
          phpsessid = next.phpsessid
          res = await post()
        }
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(`${branchLabel(b)}: ${d.error ?? "Sync ไม่สำเร็จ"}`)
        count += d.count ?? 0
      }
      swalToast("success", `ดึงข้อมูล ATMS สำเร็จ ${fmtNum(count)} รายการ`)
      await load()
    } catch (e) {
      swalError((e as Error).message)
    } finally {
      setSyncing(null)
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
    const ordered = view === "vehicle" ? vehicleFilter.rows.flatMap((g) => g.rows) : tireFilter.rows
    if (ordered.length === 0) { swalError("ไม่มีรายการให้ส่งออก"); return }

    const scope  = branchFilter ? branchLabel(branchFilter) : "ทุกสาขา"
    const gLabel = [...GROUPS, ...OTHER_GROUPS].find((g) => g.key === group)?.label ?? "ต้องจัดการ"
    const filters = [
      gLabel,
      scope,
      unit === "head" ? "เฉพาะหัว" : unit === "trailer" ? "เฉพาะหาง" : null,
      q ? `ค้นหา "${q}"` : null,
      ...colFilter.describe(),
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
            fleet:    r.fleet || "",
            plant:    r.plant || "",
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
  const showPct    = group !== "nospec"

  const groups = useMemo<VehicleGroup[]>(() => {
    const m = new Map<string, VehicleGroup>()
    for (const r of rows) {
      const key = `${r.branch}|${r.plate}`
      let g = m.get(key)
      if (!g) {
        g = { branch: r.branch, plate: r.plate, fleetNo: r.fleetNo ?? "", vehicleType: r.vehicleType ?? "",
              fleet: r.fleet ?? "", plant: r.plant ?? "",
              rows: [], acceptedAt: null, acceptedBy: "", over: 0, due: 0, warn: 0, maxPct: 0 }
        m.set(key, g)
      }
      // ยางของคันเดียวกันบางเส้นอาจเก็บเบอร์รถไม่ครบ — เอาค่าแรกที่เจอ
      if (!g.fleetNo     && r.fleetNo)     g.fleetNo     = r.fleetNo
      if (!g.vehicleType && r.vehicleType) g.vehicleType = r.vehicleType
      if (!g.fleet       && r.fleet)       g.fleet       = r.fleet
      if (!g.plant       && r.plant)       g.plant       = r.plant
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

  // แต่ละมุมมองจำตัวกรองของตัวเองไว้ — สลับรายคัน/รายเส้นไปมาแล้วไม่หาย
  const vehicleFilter = useColFilter(groups, VEHICLE_FACETS, VEHICLE_SORTS)
  const tireFilter    = useColFilter(rows, TIRE_FACETS, TIRE_SORTS)
  const colFilter     = view === "vehicle" ? vehicleFilter : tireFilter

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
      <FreshnessBar
        loading={loading && !meta.computedAt}
        items={[
          { label: "ข้อมูลจาก ATMS ล่าสุด",        at: oldestTime(meta.atms.map((a) => a.syncedAt)) },
          { label: "ข้อมูลระยะทาง GPS ล่าสุด",     at: meta.computedAt },
        ]}
        actions={<>
          <button type="button" onClick={syncAtms} disabled={busy || syncing !== null} className={freshBtn} style={fontThai}>
            <CloudDownload size={13} className={"text-[#1B8C4B] " + (syncing ? "animate-pulse" : "")} />
            {syncing ? `กำลังดึง ${branchLabel(syncing)}...` : "ดึงข้อมูล ATMS"}
          </button>
          <button type="button" onClick={recalc} disabled={busy || syncing !== null} className={freshBtn} style={fontThai}>
            <RefreshCw size={13} className={"text-[#1B8C4B] " + (busy ? "animate-spin" : "")} />
            {busy ? "กำลังคำนวณ..." : "คำนวณระยะ GPS ใหม่"}
          </button>
        </>}
      />

      {/* การ์ดสรุป — คลิกเพื่อกรอง */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <DueStatCard
          label="ต้องจัดการ" tone="total" value={alertTotal} vehicles={vehicles.alert} hint="เกินกำหนด + ถึงกำหนดเปลี่ยน"
          active={group === "alert"} onClick={() => setGroup("alert")}
        />
        {GROUPS.map((g) => (
          <DueStatCard
            key={g.key} label={g.label} tone={g.key as DueTone} value={summary[g.key] ?? 0}
            vehicles={vehicles[g.key as keyof Vehicles] ?? 0} hint={g.hint}
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
            { key: "dashboard", label: "แดชบอร์ด" },
          ] as const).map((o) => (
            <button
              key={o.key} type="button" onClick={() => setView(o.key)}
              className={[
                "inline-flex items-center gap-1 rounded-[9px] px-3 py-1 text-[12px] font-medium transition-colors",
                view === o.key ? "bg-[#14271C] dark:bg-white text-white dark:text-gray-900" : "text-[#6B7C72] dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5",
              ].join(" ")}
              style={fontThai}
            >
              {o.key === "dashboard" && <LayoutDashboard size={12} />}
              {o.label}
            </button>
          ))}
        </div>

        {view !== "dashboard" && <button type="button" onClick={exportExcel}
          className={btnSmall + " inline-flex items-center gap-1.5 border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 text-[12px] text-[#14271C] dark:text-white"}
          style={fontThai}>
          <FileSpreadsheet size={12} className="text-[#1B8C4B]" /> Excel
        </button>}

        {view !== "dashboard" && colFilter.active && (
          <button type="button" onClick={colFilter.clear}
            className="text-[12px] text-[#9AA8A0] underline-offset-4 transition-colors hover:text-[#14271C] hover:underline dark:hover:text-white"
            style={fontThai}>
            ล้างตัวกรองคอลัมน์
          </button>
        )}

        <div className="relative ml-auto min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาทะเบียน / เบอร์รถ..." className={inp + " w-full pl-8"} />
        </div>
      </div>

      {view === "dashboard" ? (
        <TireDueDashboard
          rows={rows} loading={loading}
          scopeLabel={branchFilter ? branchLabel(branchFilter) : "ทุกสาขา"}
          groupLabel={[...GROUPS, ...OTHER_GROUPS].find((g) => g.key === group)?.label ?? "ต้องจัดการ"}
          onOpenVehicle={onOpenVehicle}
        />
      ) : view === "vehicle" ? (
        <VehicleTable
          groups={vehicleFilter.rows} ctx={vehicleFilter.ctx} filtered={vehicleFilter.active}
          opened={opened} onToggle={toggleOpen} loading={loading}
          onOpenVehicle={onOpenVehicle} onSnooze={snooze} onSnoozeVehicle={snoozeVehicle}
          onAcceptVehicle={acceptVehicle} snoozedView={group === "snoozed"}
        />
      ) : (
        <TireTable
          rows={tireFilter.rows} ctx={tireFilter.ctx} filtered={tireFilter.active}
          showPct={showPct} loading={loading}
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


// คอลัมน์ "จัดการ" ติดขวาเสมอ — ตารางกว้างเลื่อนแนวนอนแล้วปุ่มยังอยู่ในจอ
const actTh = thCls + " sticky right-0 z-20 w-[1%] bg-[#F6FAF7] text-right dark:bg-[#151a10]"
const actTd = (bg = "bg-white dark:bg-[#151a10]") =>
  "sticky right-0 z-[1] w-[1%] whitespace-nowrap px-3 py-1.5 text-right shadow-[-10px_0_10px_-10px_rgba(20,39,28,.18)] " +
  bg + " group-hover:bg-[#F6FAF7] dark:group-hover:bg-[#1a2015]"

// ── การ์ดสรุปตามระดับ — สีไล่ตามความหนัก แดง > ส้ม > เหลือง ──────────────────
// "ต้องจัดการ" เป็นยอดรวม ไม่ใช่ระดับ จึงใช้โทนกลาง (เดิมแดงซ้ำกับ "เกินกำหนด" อ่านแยกไม่ออก)
type DueTone = "total" | "over" | "due" | "warn"

const DUE_TONE: Record<DueTone, { dot: string; num: string; active: string }> = {
  total: {
    dot: "bg-[#1B8C4B]", num: "text-[#14271C] dark:text-white",
    active: "border-[#1B8C4B] bg-[#F4FAF6] shadow-[inset_0_0_0_1px_#1B8C4B] dark:border-green-400/60 dark:bg-green-500/5 dark:shadow-none",
  },
  over: {
    dot: "bg-red-500", num: "text-red-700 dark:text-red-400",
    active: "border-red-400 bg-red-50/60 shadow-[inset_0_0_0_1px_#f87171] dark:border-red-400/60 dark:bg-red-500/5 dark:shadow-none",
  },
  due: {
    dot: "bg-orange-500", num: "text-orange-700 dark:text-orange-400",
    active: "border-orange-400 bg-orange-50/60 shadow-[inset_0_0_0_1px_#fb923c] dark:border-orange-400/60 dark:bg-orange-500/5 dark:shadow-none",
  },
  warn: {
    dot: "bg-amber-400", num: "text-amber-700 dark:text-amber-400",
    active: "border-amber-400 bg-amber-50/60 shadow-[inset_0_0_0_1px_#fbbf24] dark:border-amber-400/60 dark:bg-amber-500/5 dark:shadow-none",
  },
}

function DueStatCard({ label, tone, value, vehicles, hint, active, onClick }: {
  label:    string
  tone:     DueTone
  value:    number
  vehicles: number
  hint:     string
  active:   boolean
  onClick:  () => void
}) {
  const t = DUE_TONE[tone]
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={[
        "flex flex-col rounded-[14px] border px-4 py-3 text-left transition-colors",
        active ? t.active : "border-[#E3E9E5] bg-white hover:border-[#C5CFC9] hover:bg-[#FAFCFB] dark:border-white/8 dark:bg-[#151a10] dark:hover:border-white/20",
      ].join(" ")}
      style={fontThai}>
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
        <span className="truncate text-[12px] font-medium text-[#3D4F44] dark:text-gray-300">{label}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#6B7C72] dark:text-gray-400">{fmtNum(vehicles)} คัน</span>
      </span>
      <span className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-[26px] leading-none tabular-nums ${value === 0 ? "text-[#C5CFC9] dark:text-gray-600" : t.num}`} style={fontHead}>
          {fmtNum(value)}
        </span>
        <span className="text-[11px] text-[#9AA8A0]">เส้น</span>
      </span>
      <span className="mt-1.5 truncate text-[10.5px] text-[#9AA8A0]">{hint}</span>
    </button>
  )
}

// ── ตาราง "รายเส้น" — 1 แถว = ยาง 1 เส้น ────────────────────────────────────
function TireTable({ rows, ctx, filtered, showPct, loading, onOpenVehicle, onSnooze }: {
  rows:          DueRow[]
  ctx:           ColHeadCtx
  filtered:      boolean
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
                    <ColHead ctx={ctx} className={thCls} label="ทะเบียน"
                      sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
                    <ColHead ctx={ctx} className={thCls} label="ตำแหน่ง"
                      sortKey="position" sortLabels={["หน้า → หลัง", "หลัง → หน้า"]} facetKey="position" />
                    <ColHead ctx={ctx} className={thCls} label="รุ่นยาง"
                      sortKey="product" sortLabels={["รุ่น ก → ฮ", "รุ่น ฮ → ก"]} facetKey="product" />
                    <ColHead ctx={ctx} className={thCls} label="เปลี่ยนเข้า"
                      sortKey="changeIn" sortLabels={["นานแล้วก่อน", "ล่าสุดก่อน"]} />
                    <ColHead ctx={ctx} className={thCls} label="วิ่งไปแล้ว"
                      sortKey="kmUsed" sortLabels={["น้อย → มาก", "มาก → น้อย"]} />
                    <ColHead ctx={ctx} className={thCls} label="ระยะกำหนด"
                      sortKey="spec" sortLabels={["น้อย → มาก", "มาก → น้อย"]} />
                    {showPct && (
                      <ColHead ctx={ctx} className={thCls} label="ใช้ไป"
                        sortKey="pct" sortLabels={["น้อย → มาก", "มาก → น้อย"]} facetKey="level" />
                    )}
                    <ColHead ctx={ctx} className={thCls} label="แหล่ง" facetKey="source" />
                    <th className={actTh}>จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F0] dark:divide-white/8">
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>
                      {filtered ? "ไม่มีรายการตรงกับตัวกรองคอลัมน์" : "ไม่มีรายการในกลุ่มนี้"}
                    </td></tr>
                  ) : rows.map((r) => {
                    const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                    return (
                      <tr key={r._id} className={"group hover:bg-[#F6FAF7] dark:hover:bg-[#1a2015]" + (snoozedOn ? " [&>td:not(:last-child)]:opacity-55" : "")}>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })}
                              className="inline-flex items-center gap-1.5 font-semibold text-[#14271C] dark:text-white hover:text-[#1B8C4B]">
                              <Truck size={12} className="text-[#9AA8A0]" />
                              {r.plate}
                            </button>
                            <span className={`rounded px-1.5 py-px text-[10px] leading-4 ${branchChipCls(r.branch)}`} style={fontThai}>
                              {branchLabel(r.branch)}
                            </span>
                          </div>
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
                        <td className={actTd()}>
                          <div className="inline-flex items-center gap-1">
                            <IconAction icon={ArrowUpRight} label={`เปิดหน้ารถ ${r.plate}`} tone="primary"
                              onClick={() => onOpenVehicle({ branch: r.branch, plate: r.plate })} />
                            <RowMenu label={`จัดการ ${r.plate} · ${r.tirePosition}`} items={[
                              { label: "เปิดหน้ารถ", icon: Truck, onSelect: () => onOpenVehicle({ branch: r.branch, plate: r.plate }) },
                              { label: snoozedOn ? "เปิดการแจ้งเตือนอีกครั้ง" : "พักการแจ้งเตือนเส้นนี้", icon: snoozedOn ? BellRing : BellOff,
                                onSelect: () => onSnooze(r, !snoozedOn), divider: true },
                            ]} />
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
function VehicleTable({ groups, ctx, filtered, opened, onToggle, loading, onOpenVehicle, onSnooze, onSnoozeVehicle, onAcceptVehicle, snoozedView }: {
  groups:          VehicleGroup[]
  ctx:             ColHeadCtx
  filtered:        boolean
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
              <ColHead ctx={ctx} className={thCls} label="ทะเบียน"
                sortKey="plate" sortLabels={["ทะเบียน ก → ฮ", "ทะเบียน ฮ → ก"]} facetKey="plate" />
              <ColHead ctx={ctx} className={thCls} label="เบอร์รถ"
                sortKey="fleetNo" sortLabels={["เบอร์รถ น้อย → มาก", "เบอร์รถ มาก → น้อย"]} facetKey="fleetNo" />
              <ColHead ctx={ctx} className={thCls} label="ฟลีท"
                sortKey="fleet" sortLabels={["ฟลีท ก → ฮ", "ฟลีท ฮ → ก"]} facetKey="fleet" />
              <ColHead ctx={ctx} className={thCls} label="แพล้นท์"
                sortKey="plant" sortLabels={["แพล้นท์ ก → ฮ", "แพล้นท์ ฮ → ก"]} facetKey="plant" />
              <ColHead ctx={ctx} className={thCls} label="ประเภทรถ"
                sortKey="type" sortLabels={["ประเภท ก → ฮ", "ประเภท ฮ → ก"]} facetKey="type" />
              <ColHead ctx={ctx} className={thCls} label="ยางที่ต้องเปลี่ยน"
                sortKey="tires" sortLabels={["น้อยเส้นก่อน", "หลายเส้นก่อน"]} facetKey="level" />
              <ColHead ctx={ctx} className={thCls} label="ใช้ไปมากสุด"
                sortKey="maxPct" sortLabels={["น้อย → มาก", "มาก → น้อย"]} />
              <ColHead ctx={ctx} className={thCls} label="รับเรื่อง"
                sortKey="accept" sortLabels={["ยังไม่รับก่อน", "รับล่าสุดก่อน"]} facetKey="accept" />
              <th className={actTh}>จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF2F0] dark:divide-white/8">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>กำลังโหลด...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-gray-400" style={fontThai}>
                {filtered ? "ไม่มีรายการตรงกับตัวกรองคอลัมน์" : "ไม่มีรายการในกลุ่มนี้"}
              </td></tr>
            ) : groups.map((g) => {
              const key    = `${g.branch}|${g.plate}`
              const isOpen = opened.has(key)
              const level  = vehicleLevel(g)
              return (
                <React.Fragment key={key}>
                  <tr className={"group cursor-pointer hover:bg-[#F6FAF7] dark:hover:bg-[#1a2015]" + (isOpen ? " bg-[#F6FAF7] dark:bg-[#1a2015]" : "")} onClick={() => onToggle(key)}>
                    <td className={tdCls}>
                      <div className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={13} className="text-[#9AA8A0]" /> : <ChevronRight size={13} className="text-[#9AA8A0]" />}
                        <span className="font-semibold text-[#14271C] dark:text-white">{g.plate}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] leading-4 ${branchChipCls(g.branch)}`} style={fontThai}>
                          {branchLabel(g.branch)}
                        </span>
                      </div>
                    </td>
                    <td className={tdCls + " font-mono text-[#14271C] dark:text-white"}>{g.fleetNo || "—"}</td>
                    <td className={tdCls + " whitespace-nowrap"} style={fontThai}>{g.fleet || "—"}</td>
                    <td className={tdCls + " max-w-[160px] truncate"} style={fontThai} title={g.plant}>{g.plant || "—"}</td>
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
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#9AA8A0]" style={fontThai}>
                          <span className="h-1.5 w-1.5 rounded-full bg-[#C5CFC9]" /> ยังไม่รับเรื่อง
                        </span>
                      )}
                    </td>
                    <td className={actTd(isOpen ? "bg-[#F6FAF7] dark:bg-[#1a2015]" : undefined)}>
                      <div className="inline-flex items-center gap-1">
                        {/* ช่องแรกเว้นไว้เท่ากันทุกแถว — ปุ่มเปิดหน้ารถ/เมนูจะได้ตรงแนวเดียวกัน */}
                        {g.acceptedAt
                          ? <span className="inline-block w-7" aria-hidden />
                          : <IconAction icon={CheckCircle2} label={`รับเรื่อง ${g.plate}`} onClick={() => onAcceptVehicle(g, true)} />}
                        <IconAction icon={ArrowUpRight} label={`เปิดหน้ารถ ${g.plate}`} tone="primary"
                          onClick={() => onOpenVehicle({ branch: g.branch, plate: g.plate })} />
                        <RowMenu label={`จัดการ ${g.plate}`} items={[
                          { label: "รับเรื่อง", icon: CheckCircle2, hidden: !!g.acceptedAt, onSelect: () => onAcceptVehicle(g, true) },
                          { label: "ยกเลิกรับเรื่อง", icon: Undo2, hidden: !g.acceptedAt, onSelect: () => onAcceptVehicle(g, false) },
                          { label: snoozedView ? "เปิดการแจ้งเตือนทั้งคัน" : "พักการแจ้งเตือนทั้งคัน", icon: snoozedView ? BellRing : BellOff,
                            onSelect: () => onSnoozeVehicle(g, !snoozedView) },
                          { label: isOpen ? "ซ่อนยางรายเส้น" : `ดูยางรายเส้น (${g.rows.length})`, icon: ChevronsUpDown,
                            onSelect: () => onToggle(key), divider: true },
                          { label: "เปิดหน้ารถ", icon: Truck, onSelect: () => onOpenVehicle({ branch: g.branch, plate: g.plate }) },
                        ]} />
                      </div>
                    </td>
                  </tr>

                  {isOpen && g.rows.map((r) => {
                    const snoozedOn = !!r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                    return (
                      <tr key={r._id} className={"group bg-[#FAFCFB] dark:bg-[#171d12]" + (snoozedOn ? " [&>td:not(:last-child)]:opacity-55" : "")}>
                        <td className={tdCls + " pl-8"} style={fontThai}>{r.tirePosition || "—"}</td>
                        <td className={tdCls + " max-w-[200px] truncate"} style={fontThai} title={`${r.product} ${r.serialNo}`} colSpan={4}>
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
                        <td className={tdCls} style={fontThai}>
                          {snoozedOn && <span className="text-[10.5px] text-[#9AA8A0]">พักถึง {fmtDateOnly(r.snoozedUntil)}</span>}
                        </td>
                        <td className={actTd("bg-[#FAFCFB] dark:bg-[#171d12]")}>
                          <div className="inline-flex items-center gap-1">
                            <span className="inline-block w-7" aria-hidden />
                            <IconAction icon={snoozedOn ? BellRing : BellOff}
                              label={snoozedOn ? `เปิดการแจ้งเตือน ${r.tirePosition}` : `พักการแจ้งเตือน ${r.tirePosition}`}
                              onClick={() => onSnooze(r, !snoozedOn)} />
                            <span className="inline-block w-7" aria-hidden />
                          </div>
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
